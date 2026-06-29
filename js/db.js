// ─────────────────────────────────────────────────────────────────
// Nestra — db.js
// Capa de datos: centraliza TODAS las queries a Supabase.
// Ninguna vista hace queries directas — todo pasa por este módulo.
//
// Patrón: funciones globales (sin import/export), igual que el resto
// del codebase. Depende de globales ya cargados:
//   - supabase        (cliente, de supabase.js)
//   - getCurrentUser()(usuario activo, de auth.js)
//
// Convención de retorno:
//   - Lecturas → array u objeto de datos (o [] / null en error).
//   - Escrituras → fila insertada/actualizada, o lanza Error.
// Todos los errores se loguean en consola; las escrituras re-lanzan
// para que la vista muestre feedback.
// ─────────────────────────────────────────────────────────────────


// ─── Helpers internos ─────────────────────────────────────────────

// _rangoMes(mes, anio) — primer y último día del mes en formato ISO.
// mes: 1–12. Retorna { desde: 'YYYY-MM-01', hasta: 'YYYY-MM-DD' }.
function _rangoMes(mes, anio) {
  const mm = String(mes).padStart(2, '0');
  const desde = `${anio}-${mm}-01`;
  // new Date(anio, mes, 0) → último día del mes (mes es 1-based aquí).
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const hasta = `${anio}-${mm}-${String(ultimoDia).padStart(2, '0')}`;
  return { desde, hasta };
}

// _rangoSemana(ref?) — lunes 00:00 de la semana actual → hoy (hora local).
// Semana ISO (lunes primer día). ref: Date opcional (default: hoy).
// Retorna { desde: 'YYYY-MM-DD', hasta: 'YYYY-MM-DD', diasTranscurridos }.
function _rangoSemana(ref) {
  const hoy = ref ? new Date(ref) : new Date();
  const dow = hoy.getDay();              // 0=domingo … 6=sábado
  const offsetLunes = (dow + 6) % 7;     // días desde el lunes
  const lunes = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - offsetLunes);
  const fmt = (d) => d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
  return { desde: fmt(lunes), hasta: fmt(hoy), diasTranscurridos: offsetLunes + 1 };
}

// _requireUserId() — id del usuario activo o lanza si no hay sesión.
function _requireUserId() {
  const user = getCurrentUser();
  if (!user || !user.id) {
    throw new Error('No hay sesión activa');
  }
  return user.id;
}

// _mirroredRead(store, fetcher) — ejecuta `fetcher()` (query a Supabase).
// Online OK → espeja el resultado en IndexedDB y lo devuelve.
// Fallo/offline → devuelve el espejo local de `store`.
async function _mirroredRead(store, fetcher) {
  try {
    if (!navigator.onLine) throw new Error('offline');
    const rows = await fetcher();
    if (typeof mirrorReplace === 'function') await mirrorReplace(store, rows);
    return rows;
  } catch (err) {
    console.warn('_mirroredRead(' + store + ') usa espejo local:', err.message || err);
    if (typeof mirrorGetAll === 'function') return await mirrorGetAll(store);
    return [];
  }
}


// _isNetworkError(err) — heurística: ¿el fallo es por falta de red?
function _isNetworkError(err) {
  if (!navigator.onLine) return true;
  const msg = (err && (err.message || err)) + '';
  return /failed to fetch|networkerror|load failed|fetch/i.test(msg);
}


// ═══════════════════════════════════════════════════════════════════
// TRANSACCIONES
// ═══════════════════════════════════════════════════════════════════

// getTransacciones(filtros) — lista transacciones visibles (RLS aplica).
// filtros (todos opcionales): { ambito, categoria_id, tipo,
//                               fecha_desde, fecha_hasta }
// Returns: array de transacciones (con categoria embebida) o [].
async function getTransacciones(filtros = {}) {
  // Fetch SIN filtros server-side: así el espejo guarda SIEMPRE el set completo y
  // una llamada filtrada (p.ej. getGastoCategoria) no lo sobreescribe parcialmente.
  // Los filtros y el orden se aplican en cliente (online y offline por igual).
  const rows = await _mirroredRead('transacciones', async () => {
    const { data, error } = await supabase
      .from('transacciones')
      .select('*, categorias(nombre, tipo, color, icono)');
    if (error) throw error;
    return data || [];
  });

  const out = rows.filter((t) =>
    (!filtros.ambito       || t.ambito === filtros.ambito) &&
    (!filtros.categoria_id || t.categoria_id === filtros.categoria_id) &&
    (!filtros.tipo         || t.tipo === filtros.tipo) &&
    (!filtros.fecha_desde  || t.fecha >= filtros.fecha_desde) &&
    (!filtros.fecha_hasta  || t.fecha <= filtros.fecha_hasta)
  );
  // Orden: fecha desc, luego created_at desc (fechas/ISO comparables como string).
  out.sort((a, b) => {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
    const ca = a.created_at || '', cb = b.created_at || '';
    return ca < cb ? 1 : (ca > cb ? -1 : 0);
  });
  return out;
}

// getUltimasTransacciones(limite) — N transacciones más recientes.
// Returns: array (máx. `limite`) o [].
async function getUltimasTransacciones(limite = 5) {
  try {
    const { data, error } = await supabase
      .from('transacciones')
      .select('*, categorias(nombre, tipo, color, icono)')
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limite);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error en getUltimasTransacciones():', err.message || err);
    return [];
  }
}

// insertTransaccion(datos) — crea una transacción.
// datos: { tipo, ambito, categoria_id, monto, fecha?, nota? }
// El user_id se fuerza al usuario activo (RLS exige auth.uid()=user_id).
// Returns: fila insertada (o fila optimista con _pending:true si offline). Lanza Error en fallo.
async function insertTransaccion(datos) {
  const userId = _requireUserId();
  const fila = {
    id:           crypto.randomUUID(),
    tipo:         datos.tipo,
    ambito:       datos.ambito,
    categoria_id: datos.categoria_id,
    monto:        datos.monto,
    nota:         datos.nota ?? null,
    split_id:     datos.split_id ?? null,
    user_id:      userId,
    fecha:        datos.fecha || undefined,
    updated_at:   new Date().toISOString(),
  };
  if (!fila.fecha) delete fila.fecha;

  if (!navigator.onLine) {
    await outboxAdd('transacciones', fila);
    await mirrorPut('transacciones', { ...fila, _pending: true });
    if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
    if (typeof autocatLearnTokens === 'function' && typeof tokenize === 'function' && fila.nota && fila.categoria_id) {
      await autocatLearnTokens(tokenize(fila.nota), fila.categoria_id);
    }
    return { ...fila, _pending: true };
  }

  try {
    const { data, error } = await supabase
      .from('transacciones').insert(fila).select().single();
    if (error) throw error;
    if (data.tipo === 'ahorro') await _distribuirAhorroTx(data);
    await mirrorPut('transacciones', data);
    if (typeof autocatLearnTokens === 'function' && typeof tokenize === 'function' && data.nota && data.categoria_id) {
      await autocatLearnTokens(tokenize(data.nota), data.categoria_id);
    }
    return data;
  } catch (err) {
    if (_isNetworkError(err)) {
      await outboxAdd('transacciones', fila);
      await mirrorPut('transacciones', { ...fila, _pending: true });
      if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
      if (typeof autocatLearnTokens === 'function' && typeof tokenize === 'function' && fila.nota && fila.categoria_id) {
        await autocatLearnTokens(tokenize(fila.nota), fila.categoria_id);
      }
      return { ...fila, _pending: true };
    }
    console.error('Error en insertTransaccion():', err.message || err);
    throw err;
  }
}

// _distribuirAhorroTx(tx) — si la transacción es de tipo 'ahorro', invoca el
// RPC distribuir_ahorro (reparte entre metas del ámbito + fondo). Los aportes
// directos ya asignan su monto a mano; nunca se reparten. Best-effort (no lanza).
async function _distribuirAhorroTx(tx) {
  try {
    if (!tx || tx.tipo !== 'ahorro') return;
    if (tx.es_aporte_directo) return;
    const { error } = await supabase.rpc('distribuir_ahorro', { p_transaccion_id: tx.id });
    if (error) throw error;
  } catch (err) {
    console.error('Aviso: no se pudo repartir el ahorro entre metas:', err.message || err);
  }
}

// _reDistribuirAhorro(txId, nuevoTipo) — re-reparte aportes_meta tras editar
// una transacción. Borra los aportes previos del tx y re-invoca distribuir_ahorro
// si el nuevo tipo sigue siendo 'ahorro'. Best-effort: no lanza, no revierte.
async function _reDistribuirAhorro(txId, nuevoTipo) {
  try {
    const { error: errDel } = await supabase
      .from('aportes_meta')
      .delete()
      .eq('transaccion_id', txId);
    if (errDel) throw errDel;

    if (nuevoTipo === 'ahorro') {
      const { error: errRpc } = await supabase.rpc('distribuir_ahorro', { p_transaccion_id: txId });
      if (errRpc) throw errRpc;
    }
  } catch (err) {
    console.error('Aviso: no se pudo re-distribuir el ahorro tras editar:', err.message || err);
  }
}

// updateTransaccion(id, datos) — actualiza campos de una transacción.
// datos: subconjunto de { tipo, ambito, categoria_id, monto, fecha, nota }
// Returns: fila actualizada. Lanza Error en fallo.
async function updateTransaccion(id, datos) {
  try {
    const { data, error } = await supabase
      .from('transacciones')
      .update(datos)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en updateTransaccion():', err.message || err);
    throw err;
  }
}

// _serverDeleteTransaccion(id) — borra en el servidor. Si la fila tiene
// aporte_id, borra ambas mitades. Usado online y en el replay de la outbox.
async function _serverDeleteTransaccion(id) {
  const { data: fila, error: errLeer } = await supabase
    .from('transacciones').select('id, aporte_id').eq('id', id).single();
  if (errLeer) throw errLeer;
  let query = supabase.from('transacciones').delete();
  query = (fila && fila.aporte_id) ? query.eq('aporte_id', fila.aporte_id) : query.eq('id', id);
  const { error } = await query;
  if (error) throw error;
}

// deleteTransaccion(id) — borra una transacción (offline-first).
// Online: borra en servidor + espejo. Offline / error de red: quita del espejo
// y encola un op 'delete_transaccion' que se replica al reconectar.
async function deleteTransaccion(id) {
  async function _offline() {
    try { const db = await nestraDB(); await db.delete('transacciones', id); } catch (_) {}
    await outboxAdd('delete_transaccion', { id });
    if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
  }
  if (!navigator.onLine) { await _offline(); return; }
  try {
    await _serverDeleteTransaccion(id);
    try { const db = await nestraDB(); await db.delete('transacciones', id); } catch (_) {}
  } catch (err) {
    if (_isNetworkError(err)) { await _offline(); return; }
    console.error('Error en deleteTransaccion():', err.message || err);
    throw err;
  }
}

// insertAporteHogar(monto, categoria_id, nota, fecha) — aporte al hogar.
// Crea atómicamente dos transacciones vinculadas por un mismo aporte_id:
//   1. Gasto PERSONAL del usuario activo (sale de su balance personal),
//      usando la categoría de gasto que se pasa en `categoria_id`.
//   2. Ingreso del HOGAR (entra al balance compartido), usando una
//      categoría de TIPO ingreso resuelta automáticamente (preferencia:
//      "Aporte al hogar" → "Otros ingresos" → primera categoría ingreso).
//      Así el ingreso no contamina una categoría de gasto en los gráficos.
// PostgREST inserta ambas filas en una sola sentencia (.insert([a, b])):
// es atómico server-side — si una falla, no se crea ninguna. deleteTransaccion
// limpia ambas mitades por aporte_id.
// Returns: array con las dos filas insertadas. Lanza Error en fallo.
async function insertAporteHogar(monto, categoria_id, nota, fecha) {
  try {
    if (!navigator.onLine) throw new Error('Esta acción requiere conexión a internet.');
    const userId = _requireUserId();
    const aporteId = crypto.randomUUID();

    // Resolver categoría de tipo ingreso para la mitad del hogar.
    const catsIngreso = await getCategorias('ingreso');
    if (!catsIngreso.length) {
      throw new Error('No hay categorías de ingreso para el aporte al hogar');
    }
    const catIngreso =
      catsIngreso.find((c) => c.nombre === 'Aporte al hogar') ||
      catsIngreso.find((c) => c.nombre === 'Otros ingresos') ||
      catsIngreso[0];

    const base = {
      monto,
      nota: nota ?? null,
      user_id: userId,
      aporte_id: aporteId,
    };
    if (fecha) base.fecha = fecha;

    const filas = [
      { ...base, tipo: 'gasto',   ambito: 'personal', categoria_id },
      { ...base, tipo: 'ingreso', ambito: 'hogar',    categoria_id: catIngreso.id },
    ];

    const { data, error } = await supabase
      .from('transacciones')
      .insert(filas)
      .select();
    if (error) throw error;

    // Repartir el aporte entre las metas del hogar vía RPC atómico. Best-effort:
    // el aporte y su aporte_id ya existen (balances correctos); un fallo del
    // reparto NO debe revertir las transacciones ni propagarse.
    try {
      const { error: errRpc } = await supabase.rpc('distribuir_aporte_hogar', { p_aporte_id: aporteId });
      if (errRpc) throw errRpc;
    } catch (errRpc) {
      console.error('Aviso: no se pudo repartir el aporte entre metas del hogar:', errRpc.message || errRpc);
    }
    return data;
  } catch (err) {
    console.error('Error en insertAporteHogar():', err.message || err);
    throw err;
  }
}


// ═══════════════════════════════════════════════════════════════════
// BALANCES
// ═══════════════════════════════════════════════════════════════════

// getBalanceHogar(mes, anio) — totales del hogar para el mes dado.
// Returns: { ingresos, gastos, balance }. Ceros en error.
async function getBalanceHogar(mes, anio) {
  try {
    const { desde, hasta } = _rangoMes(mes, anio);
    const { data, error } = await supabase
      .from('transacciones')
      .select('tipo, monto')
      .eq('ambito', 'hogar')
      .neq('tipo', 'ahorro')
      .gte('fecha', desde)
      .lte('fecha', hasta);
    if (error) throw error;

    let ingresos = 0, gastos = 0;
    (data || []).forEach((t) => {
      if (t.tipo === 'ingreso') ingresos += Number(t.monto);
      else if (t.tipo === 'gasto') gastos += Number(t.monto);
    });
    return { ingresos, gastos, balance: ingresos - gastos };
  } catch (err) {
    console.error('Error en getBalanceHogar():', err.message || err);
    return { ingresos: 0, gastos: 0, balance: 0 };
  }
}

// getBalancePersonal(mes, anio) — totales personales del usuario activo.
// El aporte al hogar ya es un gasto personal (con aporte_id); por eso
// `gastos` lo incluye y `aporte_realizado` lo reporta por separado como
// subconjunto informativo (no se resta dos veces).
// Returns: { ingresos, gastos, aporte_realizado, balance }. Ceros en error.
async function getBalancePersonal(mes, anio) {
  try {
    const userId = _requireUserId();
    const { desde, hasta } = _rangoMes(mes, anio);
    const { data, error } = await supabase
      .from('transacciones')
      .select('tipo, monto, aporte_id')
      .eq('ambito', 'personal')
      .eq('user_id', userId)
      .neq('tipo', 'ahorro')
      .gte('fecha', desde)
      .lte('fecha', hasta);
    if (error) throw error;

    let ingresos = 0, gastos = 0, aporte_realizado = 0;
    (data || []).forEach((t) => {
      const monto = Number(t.monto);
      if (t.tipo === 'ingreso') {
        ingresos += monto;
      } else if (t.tipo === 'gasto') {
        gastos += monto;
        if (t.aporte_id) aporte_realizado += monto;
      }
    });
    return { ingresos, gastos, aporte_realizado, balance: ingresos - gastos };
  } catch (err) {
    console.error('Error en getBalancePersonal():', err.message || err);
    return { ingresos: 0, gastos: 0, aporte_realizado: 0, balance: 0 };
  }
}


// getSaldoAcumuladoHogar() — balance del hogar sumando todos los tiempos (sin filtro de mes).
// Returns: { ingresos, gastos, balance }. Ceros en error.
async function getSaldoAcumuladoHogar() {
  try {
    const { data, error } = await supabase
      .from('transacciones')
      .select('tipo, monto')
      .eq('ambito', 'hogar')
      .neq('tipo', 'ahorro');
    if (error) throw error;
    let ingresos = 0, gastos = 0;
    (data || []).forEach((t) => {
      if (t.tipo === 'ingreso') ingresos += Number(t.monto);
      else if (t.tipo === 'gasto') gastos += Number(t.monto);
    });
    return { ingresos, gastos, balance: ingresos - gastos };
  } catch (err) {
    console.error('Error en getSaldoAcumuladoHogar():', err.message || err);
    return { ingresos: 0, gastos: 0, balance: 0 };
  }
}

// getSaldoAcumuladoPersonal() — balance personal acumulado (todos los tiempos).
// Returns: { ingresos, gastos, aporte_realizado, balance }. Ceros en error.
async function getSaldoAcumuladoPersonal() {
  try {
    const userId = _requireUserId();
    const { data, error } = await supabase
      .from('transacciones')
      .select('tipo, monto, aporte_id')
      .eq('ambito', 'personal')
      .eq('user_id', userId)
      .neq('tipo', 'ahorro');
    if (error) throw error;
    let ingresos = 0, gastos = 0, aporte_realizado = 0;
    (data || []).forEach((t) => {
      const monto = Number(t.monto);
      if (t.tipo === 'ingreso') {
        ingresos += monto;
      } else if (t.tipo === 'gasto') {
        gastos += monto;
        if (t.aporte_id) aporte_realizado += monto;
      }
    });
    return { ingresos, gastos, aporte_realizado, balance: ingresos - gastos };
  } catch (err) {
    console.error('Error en getSaldoAcumuladoPersonal():', err.message || err);
    return { ingresos: 0, gastos: 0, aporte_realizado: 0, balance: 0 };
  }
}

// getAhorrosHogar(mes, anio) — total de ahorros (tipo='ahorro') del hogar en el mes.
// Returns: número (0 en error o sin ahorros).
async function getAhorrosHogar(mes, anio) {
  try {
    const { desde, hasta } = _rangoMes(mes, anio);
    const { data, error } = await supabase
      .from('transacciones')
      .select('monto')
      .eq('ambito', 'hogar')
      .eq('tipo', 'ahorro')
      .gte('fecha', desde)
      .lte('fecha', hasta);
    if (error) throw error;
    return (data || []).reduce((sum, t) => sum + Number(t.monto), 0);
  } catch (err) {
    console.error('Error en getAhorrosHogar():', err.message || err);
    return 0;
  }
}

// getAhorrosPersonal(mes, anio) — total de ahorros (tipo='ahorro') personales del usuario en el mes.
// Returns: número (0 en error o sin ahorros).
async function getAhorrosPersonal(mes, anio) {
  try {
    const userId = _requireUserId();
    const { desde, hasta } = _rangoMes(mes, anio);
    const { data, error } = await supabase
      .from('transacciones')
      .select('monto')
      .eq('ambito', 'personal')
      .eq('user_id', userId)
      .eq('tipo', 'ahorro')
      .gte('fecha', desde)
      .lte('fecha', hasta);
    if (error) throw error;
    return (data || []).reduce((sum, t) => sum + Number(t.monto), 0);
  } catch (err) {
    console.error('Error en getAhorrosPersonal():', err.message || err);
    return 0;
  }
}


// ═══════════════════════════════════════════════════════════════════
// CATEGORÍAS
// ═══════════════════════════════════════════════════════════════════

// getCategorias(tipo) — categorías activas. tipo opcional: 'gasto'|'ingreso'.
// Returns: array ordenado por nombre o [].
// El fetcher trae TODAS las categorías (sin filtrar por estado/tipo) para que
// el espejo IndexedDB siempre contenga el conjunto completo. El filtrado se
// aplica en cliente para que offline también funcione correctamente.
async function getCategorias(tipo = null, incluirArchivadas = false) {
  const rows = await _mirroredRead('categorias', async () => {
    const { data, error } = await supabase
      .from('categorias').select('*').order('nombre', { ascending: true });
    if (error) throw error;
    return data || [];
  });
  // Filtrado client-side (aplica también al espejo offline).
  return rows.filter((c) =>
    (incluirArchivadas || c.estado === 'activa') && (!tipo || c.tipo === tipo)
  );
}

// getCategoriasConFavorito(tipo?) — todas las categorías activas (de `tipo` si se da)
// + bandera `favorita` para el usuario activo. Para la gestión en Configuración.
// Returns: [{ ...categoria, favorita: bool }] o [].
async function getCategoriasConFavorito(tipo = null, incluirArchivadas = false) {
  try {
    const cats = await getCategorias(tipo, incluirArchivadas);
    const { data: favs, error } = await supabase
      .from('categorias_favoritas')
      .select('categoria_id'); // RLS lo acota al usuario activo
    if (error) throw error;
    const favSet = new Set((favs || []).map((f) => f.categoria_id));
    return cats.map((c) => ({ ...c, favorita: favSet.has(c.id) }));
  } catch (err) {
    console.error('Error en getCategoriasConFavorito():', err.message || err);
    return [];
  }
}

// getCategoriasFavoritas(tipo?) — solo las categorías marcadas favoritas por el
// usuario activo (de `tipo` si se da). Para el Oráculo. Returns: [categoria] o [].
async function getCategoriasFavoritas(tipo = null) {
  const cats = await getCategoriasConFavorito(tipo);
  return cats.filter((c) => c.favorita);
}

// toggleFavorita(categoria_id, on) — marca (on=true) o desmarca (on=false) una
// categoría como favorita del usuario activo. Idempotente (upsert por unique).
// Lanza Error en fallo para que la UI revierta el toggle optimista.
async function toggleFavorita(categoria_id, on) {
  try {
    if (on) {
      const userId = _requireUserId();
      const { error } = await supabase
        .from('categorias_favoritas')
        .upsert({ categoria_id: categoria_id, user_id: userId }, { onConflict: 'user_id,categoria_id' });
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('categorias_favoritas')
        .delete()
        .eq('categoria_id', categoria_id); // RLS limita al usuario activo
      if (error) throw error;
    }
  } catch (err) {
    console.error('Error en toggleFavorita():', err.message || err);
    throw err;
  }
}

// getGastoCategoria(categoria_id, ambito, fecha_desde, fecha_hasta) — suma de
// GASTOS de una categoría en el rango y ámbito dados. Para el oráculo.
// Returns: número (0 en error o sin gastos).
async function getGastoCategoria(categoria_id, ambito, fecha_desde, fecha_hasta) {
  try {
    const txs = await getTransacciones({
      categoria_id: categoria_id,
      ambito: ambito,
      tipo: 'gasto',
      fecha_desde: fecha_desde,
      fecha_hasta: fecha_hasta,
    });
    return (txs || []).reduce((acc, t) => acc + Number(t.monto), 0);
  } catch (err) {
    console.error('Error en getGastoCategoria():', err.message || err);
    return 0;
  }
}

// insertCategoria(datos) — crea categoría.
// datos: { nombre, tipo, limite_mensual?, color? }
// Returns: fila insertada. Lanza Error en fallo.
async function insertCategoria(datos) {
  try {
    const fila = { ...datos, user_id: _requireUserId() };
    const { data, error } = await supabase
      .from('categorias')
      .insert(fila)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en insertCategoria():', err.message || err);
    throw err;
  }
}

// updateCategoria(id, datos) — actualiza categoría.
// Returns: fila actualizada. Lanza Error en fallo.
async function updateCategoria(id, datos) {
  try {
    const { data, error } = await supabase
      .from('categorias')
      .update(datos)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en updateCategoria():', err.message || err);
    throw err;
  }
}

// deleteCategoria(id) — borra categoría. Falla si tiene transacciones
// (FK on delete restrict); la vista debe ofrecer reasignar o archivar.
// Returns: undefined. Lanza Error en fallo.
async function deleteCategoria(id) {
  try {
    const { error } = await supabase
      .from('categorias')
      .delete()
      .eq('id', id);
    if (error) throw error;
  } catch (err) {
    console.error('Error en deleteCategoria():', err.message || err);
    throw err;
  }
}

// archivarCategoria(id) — oculta sin borrar (estado='archivada').
// Returns: fila actualizada. Lanza Error en fallo.
async function archivarCategoria(id) {
  try {
    const { data, error } = await supabase
      .from('categorias')
      .update({ estado: 'archivada' })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en archivarCategoria():', err.message || err);
    throw err;
  }
}

// desarchivarCategoria(id) — reactiva una categoría archivada (estado='activa').
// Returns: fila actualizada. Lanza Error en fallo.
async function desarchivarCategoria(id) {
  try {
    const { data, error } = await supabase
      .from('categorias')
      .update({ estado: 'activa' })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en desarchivarCategoria():', err.message || err);
    throw err;
  }
}


// ═══════════════════════════════════════════════════════════════════
// PERFILES
// ═══════════════════════════════════════════════════════════════════

// getProfiles() — ambos perfiles (RLS permite leer los dos).
// Returns: array de perfiles o [].
async function getProfiles() {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('nombre', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error en getProfiles():', err.message || err);
    return [];
  }
}

// getAportesPorMiembro(mes, anio) — aporte real al hogar por cada miembro en el
// mes dado, junto al esperado de su perfil. Para el gráfico "aporte real vs. esperado".
// Real = SUMA de transacciones con aporte_id != null en el mes, agrupado por user_id.
// Returns: [{ user_id, nombre, esperado, real }] (un elemento por perfil) o [].
// RLS: perfiles del hogar y transacciones de aporte visibles entre miembros.
async function getAportesPorMiembro(mes, anio) {
  try {
    const { desde, hasta } = _rangoMes(mes, anio);
    const [profiles, txs] = await Promise.all([
      getProfiles(),
      supabase
        .from('transacciones')
        .select('user_id, monto')
        .not('aporte_id', 'is', null)
        .gte('fecha', desde)
        .lte('fecha', hasta),
    ]);
    if (txs.error) throw txs.error;

    const realPorUser = new Map();
    (txs.data || []).forEach((t) => {
      realPorUser.set(t.user_id, (realPorUser.get(t.user_id) || 0) + Number(t.monto));
    });

    return (profiles || []).map((p) => ({
      user_id: p.user_id,
      nombre: p.nombre,
      esperado: Number(p.aporte_mensual_esperado) || 0,
      real: realPorUser.get(p.user_id) || 0,
    }));
  } catch (err) {
    console.error('Error en getAportesPorMiembro():', err.message || err);
    return [];
  }
}

// updateProfile(datos) — actualiza el perfil del usuario activo.
// datos: { nombre?, aporte_mensual_esperado? }
// RLS solo permite editar el propio perfil (user_id = auth.uid()).
// Returns: fila actualizada. Lanza Error en fallo.
async function updateProfile(datos) {
  try {
    const userId = _requireUserId();
    const { data, error } = await supabase
      .from('profiles')
      .update(datos)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en updateProfile():', err.message || err);
    throw err;
  }
}


// ═══════════════════════════════════════════════════════════════════
// METAS
// ═══════════════════════════════════════════════════════════════════

// getMetas(ambito) — metas visibles con progreso derivado (RLS: hogar + propias).
// Lee la vista metas_con_progreso: monto_actual = SUMA de aportes_meta (no manual).
// Incluye importancia y es_fondo_emergencia. Los fondos (fecha_limite NULL) van al
// final del orden (nullsFirst: false). ambito opcional: 'personal' | 'hogar'.
// Returns: array o [].
// Online: lee la vista metas_con_progreso (cálculos en BD). Mirror almacenado bajo
// store 'metas'. Offline: devuelve el espejo completo, filtrado por ambito en cliente.
async function getMetas(ambito = null) {
  const rows = await _mirroredRead('metas', async () => {
    const { data, error } = await supabase
      .from('metas_con_progreso')
      .select('*')
      .order('fecha_limite', { ascending: true, nullsFirst: false });
    if (error) throw error;
    return data || [];
  });
  return ambito ? rows.filter((m) => m.ambito === ambito) : rows;
}

// getAportesDeMeta(meta_id) — aportes recibidos por una meta, con su transacción
// de origen embebida (auditoría / desglose). Returns: array o [].
async function getAportesDeMeta(meta_id) {
  try {
    const { data, error } = await supabase
      .from('aportes_meta')
      .select('*, transacciones(fecha, monto, nota)')
      .eq('meta_id', meta_id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error en getAportesDeMeta():', err.message || err);
    return [];
  }
}

// getAllAportesMeta() — todos los aportes_meta del usuario activo (RLS aplica).
// Usado para exportación de respaldo completo.
// Returns: array de filas. Vacío en fallo (no lanza).
async function getAllAportesMeta() {
  try {
    const { data, error } = await supabase
      .from('aportes_meta')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error en getAllAportesMeta():', err.message || err);
    return [];
  }
}

// getAporteMetaMes(meta_id, mes, anio) — suma de aportes a una meta en el mes dado.
// Usado para la variación porcentual mensual del fondo de emergencia.
// Returns: número (0 en error o sin aportes).
async function getAporteMetaMes(meta_id, mes, anio) {
  try {
    const { desde, hasta } = _rangoMes(mes, anio);
    // created_at es timestamptz (UTC). Los límites del mes son hora local de
    // Perú (UTC-5); sin el offset, PostgREST los interpreta como UTC y se
    // pierden aportes de fin de mes por la tarde-noche. Anclar a -05:00.
    const { data, error } = await supabase
      .from('aportes_meta')
      .select('monto, created_at')
      .eq('meta_id', meta_id)
      .gte('created_at', `${desde}T00:00:00-05:00`)
      .lte('created_at', `${hasta}T23:59:59.999-05:00`);
    if (error) throw error;
    return (data || []).reduce((acc, a) => acc + Number(a.monto), 0);
  } catch (err) {
    console.error('Error en getAporteMetaMes():', err.message || err);
    return 0;
  }
}

// insertMeta(datos) — crea meta.
// datos: { nombre, tipo, horizonte, ambito, monto_objetivo,
//          fecha_limite, monto_actual?, fecha_inicio?, nota?, categoria_id? }
// Fase 0: every meta is owner-scoped (hogar sharing deferred to Fase 5).
// Returns: fila insertada (o fila optimista con _pending:true si offline). Lanza Error en fallo.
async function insertMeta(datos) {
  const fila = { ...datos, id: crypto.randomUUID(), user_id: _requireUserId(), updated_at: new Date().toISOString() };

  if (!navigator.onLine) {
    await outboxAdd('metas', fila);
    await mirrorPut('metas', { ...fila, _pending: true });
    if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
    return { ...fila, _pending: true };
  }
  try {
    const { data, error } = await supabase.from('metas').insert(fila).select().single();
    if (error) throw error;
    await mirrorPut('metas', data);
    return data;
  } catch (err) {
    if (_isNetworkError(err)) {
      await outboxAdd('metas', fila);
      await mirrorPut('metas', { ...fila, _pending: true });
      if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
      return { ...fila, _pending: true };
    }
    console.error('Error en insertMeta():', err.message || err);
    throw err;
  }
}

// updateMeta(id, datos) — actualiza meta. Soporta cualquier campo: nombre, tipo, categoria_id, etc.
// Returns: fila actualizada. Lanza Error en fallo.
async function updateMeta(id, datos) {
  try {
    const { data, error } = await supabase
      .from('metas')
      .update(datos)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en updateMeta():', err.message || err);
    throw err;
  }
}

// deleteMeta(id) — borra meta.
// Returns: undefined. Lanza Error en fallo.
async function deleteMeta(id) {
  try {
    const { error } = await supabase
      .from('metas')
      .delete()
      .eq('id', id);
    if (error) throw error;
  } catch (err) {
    console.error('Error en deleteMeta():', err.message || err);
    throw err;
  }
}

// insertAporteDirecto(meta_id, monto, fecha, nota) — aporte 100% a una meta.
// Vía RPC atómica aporte_directo_meta: crea un gasto en categoría Ahorro
// marcado como aporte directo y lo asigna íntegro a la meta; el excedente
// sobre el objetivo va al fondo de emergencia del ámbito de la meta. NO
// dispara el reparto por peso ni marca la meta como lograda.
// Returns: id (uuid) de la transacción creada. Lanza Error en fallo.
async function insertAporteDirecto(meta_id, monto, fecha, nota) {
  try {
    if (!navigator.onLine) throw new Error('Esta acción requiere conexión a internet.');
    const { data, error } = await supabase.rpc('aporte_directo_meta', {
      p_meta_id: meta_id,
      p_monto: monto,
      p_fecha: fecha || null,
      p_nota: nota || null,
    });
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en insertAporteDirecto():', err.message || err);
    throw err;
  }
}


// ═══════════════════════════════════════════════════════════════════
// PRESUPUESTOS
// ═══════════════════════════════════════════════════════════════════

// getGastosPorCategoriaMes(mes, anio) — gasto del usuario activo por
// categoría en el mes dado. Solo tipo='gasto' y user_id = usuario activo
// (cualquier ámbito). Usa getTransacciones (espejado) para que funcione
// offline; filtra el autor en cliente.
// Returns: objeto { [categoria_id]: total }. {} en error.
async function getGastosPorCategoriaMes(mes, anio) {
  try {
    const userId = _requireUserId();
    const { desde, hasta } = _rangoMes(mes, anio);
    const txs = await getTransacciones({
      tipo: 'gasto',
      fecha_desde: desde,
      fecha_hasta: hasta,
    });
    const mapa = {};
    (txs || []).forEach((t) => {
      if (t.user_id !== userId) return; // solo gastos propios
      mapa[t.categoria_id] = (mapa[t.categoria_id] || 0) + Number(t.monto);
    });
    return mapa;
  } catch (err) {
    console.error('Error en getGastosPorCategoriaMes():', err.message || err);
    return {};
  }
}


// ═══════════════════════════════════════════════════════════════════
// RECURRENTES (Fase 4)
// ═══════════════════════════════════════════════════════════════════

// getRecurrentes() — recurrentes del usuario activo (espejado, offline-safe).
// Returns: array ordenado por created_at, o [] en error.
async function getRecurrentes() {
  const rows = await _mirroredRead('recurrentes', async () => {
    const { data, error } = await supabase
      .from('recurrentes')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  });
  return rows || [];
}

// upsertRecurrente(fila) — alta o edición. Si `fila.id` falta, genera uno.
// Online: upsert + mirror. Offline: outbox + mirror optimista.
// Returns: fila persistida (o optimista con _pending:true). Lanza Error en fallo real.
async function upsertRecurrente(fila) {
  const row = {
    id: fila.id || crypto.randomUUID(),
    user_id: _requireUserId(),
    descripcion: fila.descripcion,
    monto: Number(fila.monto),
    tipo: fila.tipo === 'ingreso' ? 'ingreso' : 'gasto',
    categoria_id: fila.categoria_id || null,
    frecuencia: fila.frecuencia || 'mensual',
    dia_cargo: fila.dia_cargo != null ? Number(fila.dia_cargo) : null,
    proximo_cargo: fila.proximo_cargo || null,
    activo: fila.activo !== false,
    updated_at: new Date().toISOString(),
  };

  if (!navigator.onLine) {
    await outboxAdd('recurrentes', row);
    await mirrorPut('recurrentes', { ...row, _pending: true });
    if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
    return { ...row, _pending: true };
  }
  try {
    const { data, error } = await supabase
      .from('recurrentes').upsert(row, { onConflict: 'id' }).select().single();
    if (error) throw error;
    await mirrorPut('recurrentes', data);
    return data;
  } catch (err) {
    if (_isNetworkError(err)) {
      await outboxAdd('recurrentes', row);
      await mirrorPut('recurrentes', { ...row, _pending: true });
      if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
      return { ...row, _pending: true };
    }
    console.error('Error en upsertRecurrente():', err.message || err);
    throw err;
  }
}

// deleteRecurrente(id) — borra. Online: server + espejo. Offline: outbox.
async function deleteRecurrente(id) {
  if (!navigator.onLine) {
    await outboxAdd('delete_recurrente', { id });
    try { const db = await nestraDB(); await db.delete('recurrentes', id); } catch (_) {}
    if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
    return;
  }
  try {
    const { error } = await supabase.from('recurrentes').delete().eq('id', id);
    if (error) throw error;
    try { const db = await nestraDB(); await db.delete('recurrentes', id); } catch (_) {}
  } catch (err) {
    if (_isNetworkError(err)) {
      await outboxAdd('delete_recurrente', { id });
      try { const db = await nestraDB(); await db.delete('recurrentes', id); } catch (_) {}
      if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
      return;
    }
    console.error('Error en deleteRecurrente():', err.message || err);
    throw err;
  }
}


// ═══════════════════════════════════════════════════════════════════
// PRÉSTAMOS
// ═══════════════════════════════════════════════════════════════════

// getPrestamos(estado) — préstamos con su transacción embebida.
// estado opcional: 'pendiente' | 'devuelto'.
// Returns: array o [].
async function getPrestamos(estado = null) {
  const rows = await _mirroredRead('prestamos', async () => {
    const { data, error } = await supabase
      .from('prestamos')
      .select('*, transacciones(fecha, monto, ambito, nota, user_id, tipo)');
    if (error) throw error;
    return data || [];
  });
  return estado ? rows.filter((p) => p.estado === estado) : rows;
}

// insertPrestamo(transaccion_id, deudor, estado?) — registra un préstamo nuevo.
// estado: 'pendiente' (default) | 'devuelto' (para registrar préstamos ya saldados).
// Llamar DESPUÉS de insertar la transacción de gasto asociada.
// Returns: fila insertada (o fila optimista con _pending:true si offline). Lanza Error en fallo.
async function insertPrestamo(transaccion_id, deudor, estado = 'pendiente') {
  const fila = { id: crypto.randomUUID(), transaccion_id, deudor, estado, user_id: _requireUserId(), updated_at: new Date().toISOString() };

  if (!navigator.onLine) {
    await outboxAdd('prestamos', fila);
    await mirrorPut('prestamos', { ...fila, _pending: true });
    if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
    return { ...fila, _pending: true };
  }
  try {
    const { data, error } = await supabase.from('prestamos').insert(fila).select().single();
    if (error) throw error;
    await mirrorPut('prestamos', data);
    return data;
  } catch (err) {
    if (_isNetworkError(err)) {
      await outboxAdd('prestamos', fila);
      await mirrorPut('prestamos', { ...fila, _pending: true });
      if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
      return { ...fila, _pending: true };
    }
    console.error('Error en insertPrestamo():', err.message || err);
    throw err;
  }
}

// marcarDevuelto(prestamo_id, transaccion_id) — cierra un préstamo.
// Orden seguro: marca el préstamo como 'devuelto' PRIMERO; solo si ese
// update tiene éxito registra el ingreso de devolución. Así un fallo al
// marcar no deja un ingreso duplicado huérfano. El ingreso es best-effort
// (si falta la categoría o falla, el préstamo igual queda cerrado).
// Returns: { prestamo, ingreso } (ingreso null si no se pudo crear).
// Lanza Error si falla marcar el préstamo.
async function marcarDevuelto(prestamo_id, transaccion_id) {
  try {
    // 1. Leer la transacción original para replicar monto/ámbito.
    const { data: original, error: errOrig } = await supabase
      .from('transacciones')
      .select('monto, ambito')
      .eq('id', transaccion_id)
      .single();
    if (errOrig) throw errOrig;

    // 2. Marcar el préstamo como devuelto (operación principal).
    const { data: prestamo, error: errPrestamo } = await supabase
      .from('prestamos')
      .update({ estado: 'devuelto', fecha_devolucion: (function () { var d = new Date(); var p = function (n) { return n < 10 ? '0' + n : String(n); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })() })
      .eq('id', prestamo_id)
      .select()
      .single();
    if (errPrestamo) throw errPrestamo;

    // 3. Registrar el ingreso de devolución (best-effort, post-cierre).
    let ingreso = null;
    try {
      const cats = await getCategorias('ingreso');
      const catDevolucion = cats.find(
        (c) => c.nombre === 'Devolución de préstamo'
      );
      if (catDevolucion) {
        ingreso = await insertTransaccion({
          tipo: 'ingreso',
          ambito: original.ambito,
          categoria_id: catDevolucion.id,
          monto: original.monto,
          nota: 'Devolución de préstamo',
        });
      } else {
        console.warn('marcarDevuelto: categoría "Devolución de préstamo" no encontrada; se omite el ingreso automático.');
      }
    } catch (errIngreso) {
      console.error('marcarDevuelto: préstamo cerrado pero no se pudo registrar el ingreso:', errIngreso.message || errIngreso);
    }

    return { prestamo, ingreso };
  } catch (err) {
    console.error('Error en marcarDevuelto():', err.message || err);
    throw err;
  }
}


// ═══════════════════════════════════════════════════════════════════
// DESAFÍOS
// ═══════════════════════════════════════════════════════════════════

// getDesafios(estado) — desafíos visibles (RLS: hogar + propios personales).
// estado opcional: 'activo' | 'completado' | 'abandonado'.
// Returns: array o [].
async function getDesafios(estado = null) {
  try {
    let query = supabase
      .from('desafios')
      .select('*, categorias(nombre, color)')
      .order('fecha_inicio', { ascending: false });
    if (estado) query = query.eq('estado', estado);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error en getDesafios():', err.message || err);
    return [];
  }
}

// insertDesafio(datos) — crea desafío.
// datos: { titulo, ambito, duracion_dias, descripcion?, fecha_inicio?,
//          categoria_id? }
// Fase 0: owner-scoped (hogar sharing deferred to Fase 5).
// fecha_fin se calcula en la BD (columna generada).
// Returns: fila insertada. Lanza Error en fallo.
async function insertDesafio(datos) {
  try {
    const fila = { ...datos };
    // Fase 0: owner-scoped (hogar sharing deferred to Fase 5).
    fila.user_id = _requireUserId();
    const { data, error } = await supabase
      .from('desafios')
      .insert(fila)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en insertDesafio():', err.message || err);
    throw err;
  }
}

// updateDesafio(id, datos) — actualiza desafío (p. ej. estado).
// Returns: fila actualizada. Lanza Error en fallo.
async function updateDesafio(id, datos) {
  try {
    const { data, error } = await supabase
      .from('desafios')
      .update(datos)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en updateDesafio():', err.message || err);
    throw err;
  }
}


// ═══════════════════════════════════════════════════════════════════
// RESUMEN
// ═══════════════════════════════════════════════════════════════════

// getResumenMensual(mes, anio) — cierre del mes: balances + desglose.
// Combina balance del hogar, balance personal del usuario activo, y el
// desglose de gastos por categoría (hogar + personales propios) del mes.
// Returns: { hogar, personal, porCategoria } — porCategoria es array de
//          { categoria_id, nombre, total }. Estructura vacía en error.
async function getResumenMensual(mes, anio) {
  try {
    const userId = _requireUserId();
    const { desde, hasta } = _rangoMes(mes, anio);

    const [hogar, personal] = await Promise.all([
      getBalanceHogar(mes, anio),
      getBalancePersonal(mes, anio),
    ]);

    // Gastos del mes visibles (hogar + personales propios) por categoría.
    const { data, error } = await supabase
      .from('transacciones')
      .select('categoria_id, monto, categorias(nombre)')
      .eq('tipo', 'gasto')
      .gte('fecha', desde)
      .lte('fecha', hasta);
    if (error) throw error;

    const mapa = new Map();
    (data || []).forEach((t) => {
      const prev = mapa.get(t.categoria_id) || {
        categoria_id: t.categoria_id,
        nombre: t.categorias ? t.categorias.nombre : '—',
        total: 0,
      };
      prev.total += Number(t.monto);
      mapa.set(t.categoria_id, prev);
    });
    const porCategoria = Array.from(mapa.values())
      .sort((a, b) => b.total - a.total);

    return { hogar, personal, porCategoria };
  } catch (err) {
    console.error('Error en getResumenMensual():', err.message || err);
    return {
      hogar: { ingresos: 0, gastos: 0, balance: 0 },
      personal: { ingresos: 0, gastos: 0, aporte_realizado: 0, balance: 0 },
      porCategoria: [],
    };
  }
}


// ═══════════════════════════════════════════════════════════════════
// REASIGNACIÓN Y RESET
// ═══════════════════════════════════════════════════════════════════

// reasignarCategoria(fromId, toId) — Cambia la categoría de todas las
// transacciones que usan fromId por toId.
// Usado antes de eliminar una categoría con historial.
// Returns: { count: N } donde N = filas actualizadas. Lanza Error en fallo.
async function reasignarCategoria(fromId, toId) {
  try {
    const { data, error } = await supabase
      .from('transacciones')
      .update({ categoria_id: toId })
      .eq('categoria_id', fromId)
      .eq('user_id', _requireUserId())
      .select('id');
    if (error) throw error;
    return { count: (data || []).length };
  } catch (err) {
    console.error('Error en reasignarCategoria():', err.message || err);
    throw err;
  }
}

// resetearDatosUsuario() — Elimina todas las transacciones del usuario activo.
// Cascades en Supabase borran prestamos y aportes_meta asociados.
// IRREVERSIBLE. Returns: undefined. Lanza Error en fallo.
async function resetearDatosUsuario() {
  try {
    const userId = _requireUserId();
    const { error } = await supabase
      .from('transacciones')
      .delete()
      .eq('user_id', userId);
    if (error) throw error;
  } catch (err) {
    console.error('Error en resetearDatosUsuario():', err.message || err);
    throw err;
  }
}


// ═══════════════════════════════════════════════════════════════════
// PLANTILLAS (Fase 3)
// ═══════════════════════════════════════════════════════════════════
async function getPlantillas() {
  return await _mirroredRead('plantillas', async () => {
    const { data, error } = await supabase.from('plantillas').select('*').order('orden');
    if (error) throw error;
    return data || [];
  });
}
async function insertPlantilla(datos) {
  const userId = _requireUserId();
  const fila = {
    id: crypto.randomUUID(), user_id: userId,
    nombre: datos.nombre, monto: datos.monto,
    categoria_id: datos.categoria_id ?? null,
    tipo: datos.tipo || 'gasto', ambito: datos.ambito || 'personal',
    orden: datos.orden ?? 0, updated_at: new Date().toISOString(),
  };
  if (!navigator.onLine) {
    await outboxAdd('plantillas', fila);
    await mirrorPut('plantillas', { ...fila, _pending: true });
    if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
    return { ...fila, _pending: true };
  }
  try {
    const { data, error } = await supabase.from('plantillas').insert(fila).select().single();
    if (error) throw error;
    await mirrorPut('plantillas', data);
    return data;
  } catch (err) {
    if (_isNetworkError(err)) {
      await outboxAdd('plantillas', fila);
      await mirrorPut('plantillas', { ...fila, _pending: true });
      if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
      return { ...fila, _pending: true };
    }
    console.error('Error en insertPlantilla():', err.message || err); throw err;
  }
}
async function deletePlantilla(id) {
  try {
    const { error } = await supabase.from('plantillas').delete().eq('id', id);
    if (error) throw error;
    const db = await nestraDB(); await db.delete('plantillas', id);
  } catch (err) { console.error('Error en deletePlantilla():', err.message || err); throw err; }
}

// ═══════════════════════════════════════════════════════════════════
// SPLIT (Fase 3) — N transacciones con el mismo split_id
// ═══════════════════════════════════════════════════════════════════
// lineas: [{ categoria_id, monto }]. Comparten tipo/ambito/fecha/nota.
async function insertSplit(comun, lineas) {
  const splitId = crypto.randomUUID();
  const creadas = [];
  for (const ln of lineas) {
    const row = await insertTransaccion({
      tipo: comun.tipo, ambito: comun.ambito,
      categoria_id: ln.categoria_id, monto: ln.monto,
      fecha: comun.fecha, nota: comun.nota,
      split_id: splitId,
    });
    creadas.push(row);
  }
  return { split_id: splitId, transacciones: creadas };
}
async function deleteSplit(splitId) {
  const todas = await getTransacciones();
  const ids = todas.filter((t) => t.split_id === splitId).map((t) => t.id);
  for (const id of ids) await deleteTransaccion(id);
}

// ═══════════════════════════════════════════════════════════════════
// RECIBO (Fase 3) — Storage privado, path = {user_id}/{tx_id}.webp
// ═══════════════════════════════════════════════════════════════════
async function subirRecibo(transaccionId, blob) {
  const userId = _requireUserId();
  const path = `${userId}/${transaccionId}.webp`;
  if (!navigator.onLine) {
    await reciboQueueAdd(transaccionId, blob, userId);
    await outboxAdd('recibo', { id: transaccionId, transaccion_id: transaccionId, path });
    if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
    return { path, _pending: true };
  }
  try {
    const { error } = await supabase.storage.from('recibos')
      .upload(path, blob, { contentType: 'image/webp', upsert: true });
    if (error) throw error;
    await updateTransaccion(transaccionId, { recibo_path: path });
    return { path };
  } catch (err) {
    if (_isNetworkError(err)) {
      await reciboQueueAdd(transaccionId, blob, userId);
      await outboxAdd('recibo', { id: transaccionId, transaccion_id: transaccionId, path });
      if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
      return { path, _pending: true };
    }
    console.error('Error en subirRecibo():', err.message || err); throw err;
  }
}
async function getReciboUrl(path) {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from('recibos').createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  } catch (err) { console.error('getReciboUrl falló:', err.message || err); return null; }
}

// ═══════════════════════════════════════════════════════════════════
// HOGAR COMPARTIDO (Fase 6)
// ═══════════════════════════════════════════════════════════════════

// getEstadoHogar() — estado del hogar del usuario actual.
// Returns: { hogar, miembros[], codigo, rol } o null si no pertenece a ningún hogar.
async function getEstadoHogar() {
  const { data: miembro, error } = await supabase
    .from('hogar_miembros').select('hogar_id, rol').limit(1).maybeSingle();
  if (error || !miembro) return null;
  const { data: hogar } = await supabase
    .from('hogares').select('*').eq('id', miembro.hogar_id).maybeSingle();
  const { data: miembros } = await supabase
    .from('hogar_miembros').select('user_id, rol, joined_at').eq('hogar_id', miembro.hogar_id);
  const { data: codigo } = await supabase
    .from('hogar_codigos').select('codigo, expira_at')
    .eq('hogar_id', miembro.hogar_id).eq('usado', false)
    .gt('expira_at', new Date().toISOString()).order('created_at', { ascending: false })
    .limit(1).maybeSingle();
  return { hogar, miembros: miembros || [], codigo: codigo || null, rol: miembro.rol };
}

// crearHogar(nombre) — crea un hogar y agrega al usuario como creador.
// Returns: { hogar_id, codigo } (RPC crear_hogar). Lanza Error en fallo.
async function crearHogar(nombre) {
  const { data, error } = await supabase.rpc('crear_hogar', { p_nombre: nombre });
  if (error) throw error;
  return data;
}

// generarCodigoHogar() — genera un código de invitación de 6 dígitos.
// Returns: código (char(6)) (RPC generar_codigo). Lanza Error en fallo.
async function generarCodigoHogar() {
  const { data, error } = await supabase.rpc('generar_codigo');
  if (error) throw error;
  return data;
}

// unirseHogar(codigo) — une al usuario a un hogar mediante código.
// Returns: { hogar_id } (RPC unirse_hogar). Lanza Error en fallo.
async function unirseHogar(codigo) {
  const { data, error } = await supabase.rpc('unirse_hogar', { p_codigo: codigo });
  if (error) throw error;
  return data;
}

// saldarHogar(deUser, aUser, monto, nota) — registra una liquidación entre miembros.
// Returns: id (uuid) de la liquidación (RPC saldar_hogar). Lanza Error en fallo.
async function saldarHogar(deUser, aUser, monto, nota) {
  const { data, error } = await supabase.rpc('saldar_hogar', {
    p_de: deUser, p_a: aUser, p_monto: monto, p_nota: nota || null });
  if (error) throw error;
  return data;
}

// disolverHogar() — disuelve el hogar: reparte ahorro, reasigna metas al creador
// y registra liquidación final. Returns: { pct_creador, ahorro, recibe_creador,
// recibe_otro } (RPC disolver_hogar). Lanza Error en fallo.
async function disolverHogar() {
  const { data, error } = await supabase.rpc('disolver_hogar');
  if (error) throw error;
  return data;
}

// getLiquidacionesHogar() — liquidaciones del hogar (para el cálculo del balance en cliente).
// Returns: array de { de_user, a_user, monto, fecha } o [].
async function getLiquidacionesHogar() {
  const { data, error } = await supabase
    .from('hogar_liquidaciones').select('de_user, a_user, monto, fecha');
  if (error) return [];
  return data || [];
}

// subscribeHogar(hogarId, onChange) — suscripción realtime a cambios de
// transacciones/metas del hogar. onChange se llama en cada INSERT/UPDATE/DELETE.
// Returns: el channel para luego hacer supabase.removeChannel(channel), o null.
function subscribeHogar(hogarId, onChange) {
  if (!hogarId) return null;
  const ch = supabase.channel('hogar-' + hogarId)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'transacciones', filter: 'hogar_id=eq.' + hogarId },
        onChange)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'metas', filter: 'hogar_id=eq.' + hogarId },
        onChange)
    .subscribe();
  return ch;
}
