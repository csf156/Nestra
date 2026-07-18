// Nestra — motor de sincronización de la outbox.
// Corre EN LA PÁGINA (el JWT de Supabase vive aquí, no en el SW).
// Dispara: evento 'online', 'visibilitychange'→visible, carga inicial, y
// mensaje 'NESTRA_SYNC' del Service Worker (Background Sync en Chrome/Android).

let _syncing = false;

// _serverRow(entity, id) — lee la fila actual del servidor para LWW.
async function _serverRow(entity, id) {
  const table = entity === 'metas' ? 'metas' : entity; // metas: tabla base, no la vista
  const { data, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

// _replayOp(op) — sincroniza una operación de alta. Devuelve:
//   'done'  → completada, quitar de la outbox.
//   'retry' → error de RED: cortar el lote y reintentar en el próximo disparo.
//   'skip'  → error real por fila (validación/constraint/RLS): marcada 'error',
//             NO bloquea a las siguientes ops del lote.
async function _replayOp(op) {
  const { entity, payload } = op;

  if (op.entity === 'recibo') {
    try {
      const pend = await reciboQueueGet(op.payload.transaccion_id);
      if (!pend || !pend.blob) return 'done'; // ya subido o sin blob
      const { error } = await supabase.storage.from('recibos')
        .upload(op.payload.path, pend.blob, { contentType: 'image/webp', upsert: true });
      if (error) throw error;
      const { data: upd, error: upErr } = await supabase.from('transacciones')
        .update({ recibo_path: op.payload.path, updated_at: new Date().toISOString() })
        .eq('id', op.payload.transaccion_id).select('id');
      if (upErr) throw upErr;
      if (!upd || !upd.length) return 'retry'; // la tx aún no existe en server (insert pendiente) → reintentar, conservar blob
      await reciboQueueRemove(op.payload.transaccion_id);
      return 'done';
    } catch (err) {
      if (!navigator.onLine || /failed to fetch|networkerror|load failed/i.test((err && err.message) + '')) return 'retry';
      console.error('Sync recibo falló:', err.message || err);
      await outboxSetStatus(op.op_id, 'error', (err && err.message) + '');
      return 'skip';
    }
  }

  if (op.entity === 'delete_transaccion') {
    try {
      await _serverDeleteTransaccion(op.payload.id);
      try { const db = await nestraDB(); await db.delete('transacciones', op.payload.id); } catch (_) {}
      return 'done';
    } catch (err) {
      if (!navigator.onLine || /failed to fetch|networkerror|load failed/i.test((err && err.message) + '')) return 'retry';
      console.error('Sync delete falló:', err.message || err);
      await outboxSetStatus(op.op_id, 'error', (err && err.message) + '');
      return 'skip';
    }
  }

  if (op.entity === 'delete_recurrente') {
    try {
      const { error } = await supabase.from('recurrentes').delete().eq('id', op.payload.id);
      if (error) throw error;
      try { const db = await nestraDB(); await db.delete('recurrentes', op.payload.id); } catch (_) {}
      return 'done';
    } catch (err) {
      if (!navigator.onLine || /failed to fetch|networkerror|load failed/i.test((err && err.message) + '')) return 'retry';
      console.error('Sync delete_recurrente falló:', err.message || err);
      await outboxSetStatus(op.op_id, 'error', (err && err.message) + '');
      return 'skip';
    }
  }

  if (op.entity === 'gasto_hogar') {
    try {
      const p = op.payload;
      const { data, error } = await supabase.rpc('registrar_gasto_hogar', {
        p_grupo_id: p.grupo_id,
        p_fecha: p.fecha,
        p_categoria_id: p.categoria_id,
        p_nota: p.nota,
        p_partes: p.partes,
      });
      if (error) throw error;
      // El RPC genera sus propios ids server-side (no reusa los del client
      // optimista) -> las filas optimistas mirroreadas offline quedan
      // huérfanas bajo el mismo grupo_id. Limpiarlas antes de mirrorear
      // las filas reales para no dejar duplicados fantasma en el espejo.
      try {
        const db = await nestraDB();
        const todas = await db.getAll('transacciones');
        const idsViejos = todas.filter((t) => t.grupo_id === p.grupo_id).map((t) => t.id);
        for (const idViejo of idsViejos) await db.delete('transacciones', idViejo);
      } catch (_) {}
      for (const fila of data || []) await mirrorPut('transacciones', fila);
      return 'done';
    } catch (err) {
      if (!navigator.onLine || /failed to fetch|networkerror|load failed/i.test((err && err.message) + '')) return 'retry';
      console.error('Sync gasto_hogar falló:', err.message || err);
      await outboxSetStatus(op.op_id, 'error', (err && err.message) + '');
      return 'skip';
    }
  }

  if (op.entity === 'ingest_estado') {
    try {
      const { id, updated_at } = op.payload;
      // Guardia LWW: si el servidor tiene una escritura más nueva, gana el server.
      const { data: server, error: readErr } = await supabase
        .from('ingest_pendientes').select('*').eq('id', id).maybeSingle();
      if (readErr) throw readErr;
      if (server && Date.parse(server.updated_at || 0) > Date.parse(updated_at || 0)) {
        await mirrorPut('ingest_pendientes', server); // el server gana; re-espejar
        return 'done';
      }
      const patch = { ...op.payload };
      delete patch.id; // id va en el .eq, no en el SET
      const { data, error } = await supabase
        .from('ingest_pendientes').update(patch).eq('id', id).select().maybeSingle();
      if (error) throw error;
      if (data) await mirrorPut('ingest_pendientes', data);
      return 'done';
    } catch (err) {
      if (!navigator.onLine || /failed to fetch|networkerror|load failed/i.test((err && err.message) + '')) return 'retry';
      console.error('Sync ingest_estado falló:', err.message || err);
      await outboxSetStatus(op.op_id, 'error', (err && err.message) + '');
      return 'skip';
    }
  }

  try {
    const server = await _serverRow(entity, payload.id);
    const winner = window.lwwWinner(payload, server);
    if (winner === 'server') {
      if (server) await mirrorPut(entity, server);
      return 'done';
    }
    const { data, error } = await supabase.from(entity).upsert(payload, { onConflict: 'id' }).select().single();
    if (error) throw error;
    await mirrorPut(entity, data);
    return 'done';
  } catch (err) {
    if (!navigator.onLine || /failed to fetch|networkerror|load failed/i.test((err && err.message) + '')) {
      return 'retry'; // error de red → reintentar luego, sigue pending
    }
    console.error('Sync op fallida (entity=' + entity + ', id=' + payload.id + '):', err.message || err);
    await outboxSetStatus(op.op_id, 'error', (err && err.message) + '');
    return 'skip'; // error real → no reintentar, pero no bloquea al resto del lote
  }
}

// syncOutbox() — vacía la outbox FIFO. Idempotente y reentrante-seguro.
// Una fila con error real ('skip') no detiene al resto; solo un error de red
// ('retry') corta el lote para reintentar entero en el próximo disparo.
async function syncOutbox() {
  if (_syncing || !navigator.onLine) return;
  if (typeof isAuthenticated === 'function' && !isAuthenticated()) return;
  _syncing = true;
  try {
    const ops = await outboxPending();
    for (const op of ops) {
      if (op.status === 'error') continue; // requiere intervención; no reintentar en bucle
      const result = await _replayOp(op);
      if (result === 'done') await outboxRemove(op.op_id);
      else if (result === 'retry') break; // corte por red
      // 'skip' → seguir con la siguiente op del lote
    }
  } finally {
    _syncing = false;
    notifyPendingChanged();
  }
}

// notifyPendingChanged() — emite un evento global con el conteo pendiente.
async function notifyPendingChanged() {
  try {
    const count = await outboxCount();
    window.dispatchEvent(new CustomEvent('nestra:pending', { detail: { count } }));
  } catch (_) {}
}

// Disparadores.
window.addEventListener('online', syncOutbox);
window.addEventListener('focus', syncOutbox);
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncOutbox(); });
window.addEventListener('load', () => { setTimeout(syncOutbox, 1200); });
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'NESTRA_SYNC') syncOutbox();
  });
}

window.syncOutbox = syncOutbox;
window.notifyPendingChanged = notifyPendingChanged;

// ── UI: banner offline + badge de pendientes ──────────────────
// El banner es fijo; medimos su altura real y la exponemos en
// --offline-banner-h para que el CSS empuje el contenido (y la sidebar en
// desktop) y NO lo tape. La clase body.nestra-offline activa ese empuje.
function _updateOfflineBanner() {
  const b = document.getElementById('offlineBanner');
  if (!b) return;
  const offline = !navigator.onLine;
  b.hidden = !offline;
  document.body.classList.toggle('nestra-offline', offline);
  if (offline) {
    // Leer offsetHeight fuerza el layout: alto real disponible al instante
    // (sin depender de requestAnimationFrame, que no corre si la pestaña
    // no está visible).
    document.body.style.setProperty('--offline-banner-h', b.offsetHeight + 'px');
  } else {
    document.body.style.removeProperty('--offline-banner-h');
  }
}
function _updatePendingBadge(count) {
  const badge = document.getElementById('pendingBadge');
  const text = document.getElementById('pendingBadgeText');
  if (!badge) return;
  if (count > 0) {
    badge.hidden = false;
    if (text) text.textContent = count + (count === 1 ? ' cambio por sincronizar' : ' cambios por sincronizar');
  } else {
    badge.hidden = true;
  }
}
window.addEventListener('online', _updateOfflineBanner);
window.addEventListener('offline', _updateOfflineBanner);
window.addEventListener('nestra:pending', (e) => _updatePendingBadge(e.detail.count));
document.addEventListener('DOMContentLoaded', () => {
  _updateOfflineBanner();
  notifyPendingChanged();
});
