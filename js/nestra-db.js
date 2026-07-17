// Nestra — capa IndexedDB (espejo local + outbox de operaciones pendientes).
// Depende del global `idb` (js/vendor/idb-umd.js). Expone funciones globales.
//
// Stores espejo (keyPath 'id'): transacciones, categorias, metas, prestamos,
//   presupuestos, plantillas, recurrentes, ingest_pendientes.
// Store outbox (keyPath 'op_id', autoincrement): operaciones de alta pendientes.
//   { op_id, entity, payload, status:'pending'|'syncing'|'error', error?, created_at }

const NESTRA_IDB_NAME = 'nestra';
const NESTRA_IDB_VERSION = 6;
const MIRROR_STORES = ['transacciones', 'categorias', 'metas', 'prestamos', 'presupuestos', 'plantillas', 'recurrentes', 'ingest_pendientes'];

let _nestraDbPromise = null;

function nestraDB() {
  if (!_nestraDbPromise) {
    _nestraDbPromise = idb.openDB(NESTRA_IDB_NAME, NESTRA_IDB_VERSION, {
      upgrade(db) {
        MIRROR_STORES.forEach((name) => {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id' });
          }
        });
        if (!db.objectStoreNames.contains('outbox')) {
          const ob = db.createObjectStore('outbox', { keyPath: 'op_id', autoIncrement: true });
          ob.createIndex('status', 'status');
          ob.createIndex('created_at', 'created_at');
        }
        if (!db.objectStoreNames.contains('autocat')) {
          db.createObjectStore('autocat', { keyPath: 'desc_norm' });
        }
        if (!db.objectStoreNames.contains('recibos_pendientes')) {
          db.createObjectStore('recibos_pendientes', { keyPath: 'transaccion_id' });
        }
        if (!db.objectStoreNames.contains('autocat_tok')) {
          db.createObjectStore('autocat_tok', { keyPath: 'token' });
        }
        if (db.objectStoreNames.contains('autocat')) {
          db.deleteObjectStore('autocat'); // store viejo desc→cat (sin uso)
        }
      },
    });
  }
  return _nestraDbPromise;
}

async function mirrorReplace(store, rows) {
  try {
    const db = await nestraDB();
    const tx = db.transaction(store, 'readwrite');
    await tx.store.clear();
    for (const row of rows) {
      if (row && row.id != null) await tx.store.put(row);
    }
    await tx.done;
  } catch (err) {
    console.error('mirrorReplace(' + store + ') falló:', err);
  }
}

async function mirrorPut(store, row) {
  try {
    const db = await nestraDB();
    await db.put(store, row);
  } catch (err) {
    console.error('mirrorPut(' + store + ') falló:', err);
  }
}

async function mirrorGetAll(store) {
  try {
    const db = await nestraDB();
    return await db.getAll(store);
  } catch (err) {
    console.error('mirrorGetAll(' + store + ') falló:', err);
    return [];
  }
}

async function outboxAdd(entity, payload) {
  const db = await nestraDB();
  const rec = { entity, payload, status: 'pending', created_at: new Date().toISOString() };
  const op_id = await db.add('outbox', rec);
  return { ...rec, op_id };
}

async function outboxPending() {
  try {
    const db = await nestraDB();
    const all = await db.getAllFromIndex('outbox', 'created_at');
    return all.filter((o) => o.status === 'pending' || o.status === 'error');
  } catch (err) {
    console.error('outboxPending() falló:', err);
    return [];
  }
}

async function outboxCount() {
  return (await outboxPending()).length;
}

async function outboxSetStatus(op_id, status, error) {
  const db = await nestraDB();
  const rec = await db.get('outbox', op_id);
  if (!rec) return;
  rec.status = status;
  if (error !== undefined) rec.error = error;
  await db.put('outbox', rec);
}

async function outboxRemove(op_id) {
  const db = await nestraDB();
  await db.delete('outbox', op_id);
}

// ── autocat por token: { token, cats:{ [catId]: count } } ──────
async function autocatLearnTokens(tokens, categoriaId) {
  if (!categoriaId || !tokens || !tokens.length) return;
  try {
    const db = await nestraDB();
    const tx = db.transaction('autocat_tok', 'readwrite');
    for (const token of tokens) {
      if (!token) continue;
      const prev = await tx.store.get(token);
      const cats = (prev && prev.cats) || {};
      cats[categoriaId] = (cats[categoriaId] || 0) + 1;
      await tx.store.put({ token, cats });
    }
    await tx.done;
  } catch (err) { console.error('autocatLearnTokens falló:', err); }
}
async function autocatLearned() {
  try {
    const db = await nestraDB();
    const all = await db.getAll('autocat_tok');
    const out = {};
    for (const r of all) out[r.token] = r.cats || {};
    return out;
  } catch (err) { console.error('autocatLearned falló:', err); return {}; }
}
// ── recibos pendientes (foto offline) ──────────────────────────
async function reciboQueueAdd(transaccionId, blob, userId) {
  const db = await nestraDB();
  await db.put('recibos_pendientes', { transaccion_id: transaccionId, blob, user_id: userId, created_at: new Date().toISOString() });
}
async function reciboQueueGet(transaccionId) {
  const db = await nestraDB();
  return await db.get('recibos_pendientes', transaccionId);
}
async function reciboQueueRemove(transaccionId) {
  const db = await nestraDB();
  await db.delete('recibos_pendientes', transaccionId);
}

window.nestraDB = nestraDB;
window.mirrorReplace = mirrorReplace;
window.mirrorPut = mirrorPut;
window.mirrorGetAll = mirrorGetAll;
window.outboxAdd = outboxAdd;
window.outboxPending = outboxPending;
window.outboxCount = outboxCount;
window.outboxSetStatus = outboxSetStatus;
window.outboxRemove = outboxRemove;
window.autocatLearnTokens = autocatLearnTokens;
window.autocatLearned = autocatLearned;
window.reciboQueueAdd = reciboQueueAdd;
window.reciboQueueGet = reciboQueueGet;
window.reciboQueueRemove = reciboQueueRemove;
