// js/revisar-lote.js — lógica pura del modo lote de #revisar.
// Sin DOM ni red: qué fila se puede confirmar sin abrirla, cómo se parte la
// lista, y cómo se arma la nota de la transacción. Carga doble:
// <script type="module"> (window.*) en la PWA y ESM en node:test.

// loteable(fila, catId) — true si la fila se puede confirmar sin abrir la card.
// Reglas fijadas en el plan 2026-09-01: solo 'pendiente', gasto/ingreso, con
// monto>0, fecha, moneda local y categoría ya resuelta. 'revisar-manual' llega
// sin tipo/monto/fecha por definición: siempre a mano.
function loteable(fila, catId) {
  if (!fila) return false;
  if (fila.estado !== 'pendiente') return false;
  if (fila.tipo !== 'gasto' && fila.tipo !== 'ingreso') return false;
  if (!(Number(fila.monto) > 0)) return false;
  if (!fila.fecha) return false;
  if (fila.moneda_original && String(fila.moneda_original).toUpperCase() !== 'PEN') return false;
  return !!catId;
}

// resumenLote(filas) → { n, total } para la barra de acciones.
function resumenLote(filas) {
  const ls = filas || [];
  let total = 0;
  ls.forEach(function (f) { total += Number(f.monto) || 0; });
  return { n: ls.length, total: Math.round(total * 100) / 100 };
}

// notaDePendiente(fila, bancoLabel) — texto base de la transacción.
// Misma regla que usaba confirmar() en views/revisar.html: se extrae acá para
// que la confirmación de a una y la de lote no puedan divergir.
function notaDePendiente(fila, bancoLabel) {
  if (!fila) return '';
  const labels = bancoLabel || {};
  return fila.comercio || fila.contraparte || fila.raw_subject ||
    ('Correo ' + (labels[fila.banco] || fila.banco));
}

if (typeof window !== 'undefined') {
  window.loteable = loteable;
  window.resumenLote = resumenLote;
  window.notaDePendiente = notaDePendiente;
}
export { loteable, resumenLote, notaDePendiente };
