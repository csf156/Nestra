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

// normalizarContraparte(s) — clave estable para buscar el alias. Reutiliza la
// misma normalización que autocat (minúsculas, sin tildes, espacios
// colapsados) para que las variantes del banco caigan en la misma entrada.
function normalizarContraparte(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

// aliasDe(nombre, mapa) → alias | null. mapa: { nombre_norm: alias }.
function aliasDe(nombre, mapa) {
  if (!nombre || !mapa) return null;
  return mapa[normalizarContraparte(nombre)] || null;
}

// notaDePendiente(fila, bancoLabel, aliases) — texto base de la transacción.
// El alias gana: es lo que el usuario reconoce, y además es sobre lo que
// autocat aprende (insertTransaccion tokeniza la nota), así que un alias corto
// y estable enseña mucho mejor que un nombre completo que nunca se repite.
function notaDePendiente(fila, bancoLabel, aliases) {
  if (!fila) return '';
  const labels = bancoLabel || {};
  const ali = aliasDe(fila.comercio, aliases) || aliasDe(fila.contraparte, aliases);
  if (ali) return ali;
  return fila.comercio || fila.contraparte || fila.raw_subject ||
    ('Correo ' + (labels[fila.banco] || fila.banco));
}

if (typeof window !== 'undefined') {
  window.loteable = loteable;
  window.resumenLote = resumenLote;
  window.notaDePendiente = notaDePendiente;
  window.normalizarContraparte = normalizarContraparte;
  window.aliasDe = aliasDe;
}
export { loteable, resumenLote, notaDePendiente, normalizarContraparte, aliasDe };
