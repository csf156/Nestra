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

// contextoContraparte(fila, previos) → { veces, primeraVez, ultimaFecha,
// montoTipico } | null. `previos` son otras filas de la MISMA cola (no una
// consulta nueva — "usa datos que ya existen", plan Etapa B). La clave es
// contraparte si la hay, si no comercio (igual prioridad que notaDePendiente):
// el contexto sirve sobre todo para personas, pero un comercio repetido
// también es señal útil. Normaliza con normalizarContraparte para que
// variantes de mayúsculas/tildes/espacios cuenten como la misma entidad.
function contextoContraparte(fila, previos) {
  if (!fila) return null;
  const clave = fila.contraparte || fila.comercio;
  if (!clave) return null;
  const claveNorm = normalizarContraparte(clave);
  const matches = (previos || []).filter(function (p) {
    const k = (p && (p.contraparte || p.comercio)) || '';
    return k && normalizarContraparte(k) === claveNorm;
  });
  if (!matches.length) {
    return { veces: 1, primeraVez: true, ultimaFecha: null, montoTipico: null };
  }
  // "Típico" = el monto de la ocurrencia más reciente, no una moda/promedio:
  // sin eso no hay forma de definir "típico" con una sola fila de ejemplo, y
  // el monto más reciente es el que mejor predice el próximo (la mayoría de
  // contrapartes repetidas cobran/pagan lo mismo cada vez).
  let ultimo = matches[0];
  matches.forEach(function (p) { if (p.fecha > ultimo.fecha) ultimo = p; });
  return {
    veces: matches.length + 1,
    primeraVez: false,
    ultimaFecha: ultimo.fecha || null,
    montoTipico: Number(ultimo.monto) || null,
  };
}

// agruparPorDia(filas) → [{ fecha, filas }], fecha más reciente primero;
// dentro de cada día, hora más reciente primero. NO clona las filas — mismas
// referencias que entraron, para que el llamador pueda resolver el índice
// real en _filas vía indexOf() y no romper data-rev-check/alias/chip, que
// apuntan a la posición en _filas (no a la posición pintada en pantalla;
// ver Task B3 del plan 2026-09-07-sesion-y-contexto-cola.md).
function agruparPorDia(filas) {
  const porFecha = {};
  const orden = [];
  // 'revisar-manual' llega con fecha null (el Worker no pudo parsear el
  // formato, así que tampoco hay fecha del movimiento) — aparte, al final,
  // en vez de que el sort() alfabético las cuele arriba de todo (String(null)
  // = "null", que ordena ANTES que cualquier "2026-...", y con .reverse()
  // terminaría primero de todos).
  const sinFecha = [];
  (filas || []).forEach(function (f) {
    if (!f) return;
    if (!f.fecha) { sinFecha.push(f); return; }
    if (!porFecha[f.fecha]) { porFecha[f.fecha] = []; orden.push(f.fecha); }
    porFecha[f.fecha].push(f);
  });
  const fechas = orden.slice().sort().reverse();
  const grupos = fechas.map(function (fecha) {
    const grupo = porFecha[fecha].slice().sort(function (a, b) {
      const ha = a.hora || '';
      const hb = b.hora || '';
      if (ha === hb) return 0;
      if (!ha) return 1;    // sin hora, al final del día
      if (!hb) return -1;
      return ha < hb ? 1 : -1;   // desc: hora más reciente primero
    });
    return { fecha, filas: grupo };
  });
  if (sinFecha.length) grupos.push({ fecha: null, filas: sinFecha });
  return grupos;
}

if (typeof window !== 'undefined') {
  window.loteable = loteable;
  window.resumenLote = resumenLote;
  window.notaDePendiente = notaDePendiente;
  window.normalizarContraparte = normalizarContraparte;
  window.aliasDe = aliasDe;
  window.contextoContraparte = contextoContraparte;
  window.agruparPorDia = agruparPorDia;
}
export {
  loteable, resumenLote, notaDePendiente, normalizarContraparte, aliasDe,
  contextoContraparte, agruparPorDia,
};
