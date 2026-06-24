// ─────────────────────────────────────────────────────────────────
// Nestra — safe-to-spend.js
// "¿Cuánto puedo gastar hoy?" — el número hero del dashboard (Fase 2).
// Ámbito PERSONAL, periodo = mes calendario actual. Puro y determinista
// (hoy inyectado); única parte impura: cargarSafeToSpend() lee de db.js.
// Patrón dual-export como insights.js. Un número malo mata la confianza →
// guardas estrictas: sin ingreso estimable devuelve null; nunca negativo crudo.
// ─────────────────────────────────────────────────────────────────
'use strict';

// fmtS — idéntico a insights.js (se duplica deliberadamente: módulos independientes).
function fmtS(n) {
  const r = Math.round(Number(n) || 0);
  return 'S/' + String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function parseFechaISO(iso) {
  const [y, m, dd] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, dd);
}

function diaISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// mediana(nums) — mediana numérica (ordena copia). [] → 0.
function mediana(nums) {
  const a = nums.slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// calcularSafeToSpend(transacciones, metas, { hoy }) — número hero personal.
// Devuelve null (no mostrar) | {estado:'ok',diario,restanteMes,diasRestantes}
// | {estado:'excedido',exceso,diasRestantes}.
function calcularSafeToSpend(transacciones, metas, opts) {
  const hoy = opts.hoy;
  const y = hoy.getFullYear(), mo = hoy.getMonth();
  const diasDelMes = new Date(y, mo + 1, 0).getDate();
  const diasRestantes = diasDelMes - hoy.getDate() + 1; // incluye hoy, ≥1
  const ymActual = diaISO(hoy).slice(0, 7);

  const personales = (transacciones || []).filter((t) => t.ambito === 'personal' && t.fecha);

  // Ingreso del mes actual.
  let ingresoMes = 0;
  for (const t of personales) {
    if (t.tipo === 'ingreso' && t.fecha.slice(0, 7) === ymActual) ingresoMes += Number(t.monto) || 0;
  }
  const ingresoEstimado = Math.max(ingresoMes, baselineIngreso(personales, ymActual));
  if (ingresoEstimado <= 0) return null;

  // Gasto acumulado del mes (todos los gastos personales del mes).
  let gastoAcumulado = 0;
  for (const t of personales) {
    if (t.tipo === 'gasto' && t.fecha.slice(0, 7) === ymActual) gastoAcumulado += Number(t.monto) || 0;
  }

  const fijosComprometidos = calcularFijosComprometidos(personales, hoy);
  const aporteMetasRestante = calcularAporteMetas(metas, hoy, diasRestantes, diasDelMes);

  const numerador = ingresoEstimado - gastoAcumulado - fijosComprometidos - aporteMetasRestante;
  if (numerador < 0) {
    return { estado: 'excedido', exceso: Math.round(-numerador), diasRestantes };
  }
  return {
    estado: 'ok',
    diario: Math.round(numerador / diasRestantes),
    restanteMes: Math.round(numerador),
    diasRestantes,
  };
}

// baselineIngreso — promedio del ingreso personal de hasta 3 meses calendario
// CERRADOS previos (ym < ymActual). Cubre el bug día-1 (sueldo que aún no cae).
function baselineIngreso(personales, ymActual) {
  const porMes = new Map();
  for (const t of personales) {
    if (t.tipo !== 'ingreso') continue;
    const ym = t.fecha.slice(0, 7);
    if (ym >= ymActual) continue;
    porMes.set(ym, (porMes.get(ym) || 0) + (Number(t.monto) || 0));
  }
  const cerrados = [...porMes.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 3);
  if (!cerrados.length) return 0;
  return cerrados.reduce((s, [, v]) => s + v, 0) / cerrados.length;
}

// calcularFijosComprometidos — infiere categorías "fijas" del historial (sin esquema):
// gasto personal en ≥2 de los 3 meses cerrados previos. estimadoMensual = mediana de
// sus totales mensuales. Reserva max(0, estimado − gastadoEsteMes) (remanente no pagado).
function calcularFijosComprometidos(personales, hoy) {
  const ymActual = diaISO(hoy).slice(0, 7);
  // 3 meses cerrados previos (YYYY-MM).
  const cerrados = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    cerrados.push(diaISO(d).slice(0, 7));
  }
  // catId → { ym → total } sobre los meses cerrados.
  const porCat = new Map();
  const gastadoEsteMes = new Map();
  for (const t of personales) {
    if (t.tipo !== 'gasto') continue;
    const ym = t.fecha.slice(0, 7);
    const cat = t.categoria_id != null ? t.categoria_id : '∅';
    const monto = Number(t.monto) || 0;
    if (ym === ymActual) {
      gastadoEsteMes.set(cat, (gastadoEsteMes.get(cat) || 0) + monto);
    } else if (cerrados.includes(ym)) {
      let m = porCat.get(cat);
      if (!m) { m = new Map(); porCat.set(cat, m); }
      m.set(ym, (m.get(ym) || 0) + monto);
    }
  }
  let total = 0;
  for (const [cat, porMes] of porCat) {
    if (porMes.size < 2) continue; // <2 meses cerrados → no fija
    const estimado = mediana([...porMes.values()]);
    const yaPagado = gastadoEsteMes.get(cat) || 0;
    total += Math.max(0, estimado - yaPagado);
  }
  return total;
}

// Stub reemplazado en Task 5.
function calcularAporteMetas(_metas, _hoy, _diasRestantes, _diasDelMes) { return 0; }

async function cargarSafeToSpend() {
  try {
    const [transacciones, metas] = await Promise.all([
      window.getTransacciones(),
      window.getMetas(),
    ]);
    const hoy = new Date();
    return calcularSafeToSpend(transacciones || [], metas || [], { hoy });
  } catch (err) {
    console.error('Error en cargarSafeToSpend():', err && (err.message || err));
    return null;
  }
}

if (typeof window !== 'undefined') {
  window.calcularSafeToSpend = calcularSafeToSpend;
  window.cargarSafeToSpend = cargarSafeToSpend;
}

export { fmtS, mediana, calcularSafeToSpend, baselineIngreso, calcularFijosComprometidos, calcularAporteMetas, cargarSafeToSpend };
