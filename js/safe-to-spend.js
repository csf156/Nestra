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
// Devuelve null (no mostrar) | {estado:'ok',diario,restanteMes,diasRestantes,desglose}
// | {estado:'excedido',exceso,diasRestantes,desglose}.
//
// `desglose` expone las piezas que el cálculo ya hacía internamente, para que la
// card pueda explicar de dónde sale el número en vez de mostrarlo a secas:
//   { ingresoEstimado, gastosFijos, ahorroMetas, disponible, yaGastado }
// con disponible = ingresoEstimado − gastosFijos − ahorroMetas, y la identidad
// disponible − yaGastado = restanteMes (o −exceso). Redondeados: son para mostrar.
function calcularSafeToSpend(transacciones, metas, opts) {
  const hoy = opts.hoy;
  const y = hoy.getFullYear(), mo = hoy.getMonth();
  const diasDelMes = new Date(y, mo + 1, 0).getDate();
  const diasRestantes = diasDelMes - hoy.getDate() + 1; // incluye hoy, ≥1
  const ymActual = diaISO(hoy).slice(0, 7);

  const personales = (transacciones || []).filter((t) => t.hogar_id == null && t.fecha);

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
  const aporteMetasRestanteCrudo = calcularAporteMetas(metas, hoy, diasRestantes, diasDelMes);

  // Techo de la reserva de metas: nunca más del 50% de lo que queda tras los
  // fijos. Sin esto, una meta con poco margen (fecha cercana, poco ahorrado)
  // podía exigir MÁS de lo que entra en el mes — calcularAporteMetas nunca
  // recibía el ingreso, así que no tenía con qué acotrarse, y el disponible
  // podía salir negativo (un "te pasaste por" fabricado por la reserva, no
  // por gasto real). Caso real: ingreso S/502, una meta exigía reservar S/903.
  const techoMetas = Math.max(0, ingresoEstimado - fijosComprometidos) * 0.5;
  const aporteMetasRestante = Math.min(aporteMetasRestanteCrudo, techoMetas);

  const numerador = ingresoEstimado - gastoAcumulado - fijosComprometidos - aporteMetasRestante;

  // El desglose se redondea a partir de los MISMOS valores redondeados que se
  // muestran, no de los crudos: así la resta que ve el usuario cuadra en
  // pantalla. Redondear cada pieza por su lado dejaba sumas que fallaban por 1.
  const ingresoR = Math.round(ingresoEstimado);
  const fijosR = Math.round(fijosComprometidos);
  const metasR = Math.round(aporteMetasRestante);

  // Metas "fuera de ritmo": solo se nombran cuando el techo realmente recortó
  // algo, y solo las que por sí solas —ya prorrateadas al ritmo de hoy— exceden
  // el techo (no se le echa la culpa a una meta razonable de un problema de
  // conjunto; ver test de dos metas modestas que solo se pasan al sumarse). Se
  // compara la contribución PRORRATEADA (misma escala que techoMetas), aunque
  // lo que se muestra es planMensual sin prorratear ("necesitarías S/2,000
  // este mes") — es lo que el usuario puede accionar.
  let metasFueraDeRitmo = [];
  if (aporteMetasRestanteCrudo > techoMetas + 0.005) {
    metasFueraDeRitmo = (metas || [])
      .map((m) => ({ nombre: m.nombre, planMensual: _planMensualMeta(m, hoy) }))
      .filter((x) => x.planMensual != null && x.planMensual * (diasRestantes / diasDelMes) > techoMetas)
      .map((x) => ({ nombre: x.nombre, planMensual: Math.round(x.planMensual) }));
  }

  const desglose = {
    ingresoEstimado: ingresoR,
    gastosFijos: fijosR,
    ahorroMetas: metasR,
    disponible: ingresoR - fijosR - metasR,
    yaGastado: Math.round(gastoAcumulado),
    metasFueraDeRitmo,
  };

  if (numerador < 0) {
    return {
      estado: 'excedido',
      exceso: desglose.yaGastado - desglose.disponible,
      diasRestantes,
      desglose,
    };
  }
  return {
    estado: 'ok',
    diario: Math.round(numerador / diasRestantes),
    restanteMes: desglose.disponible - desglose.yaGastado,
    diasRestantes,
    desglose,
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
    if (t.categoria_id == null) continue; // sin categoría → muy poca señal para inferir "fija"
    const ym = t.fecha.slice(0, 7);
    const cat = t.categoria_id;
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

// _planMensualMeta(meta, hoy) — cuánto exige la meta POR MES para llegar a
// tiempo, sin prorratear por días restantes, o null si no aplica (hogar,
// fondo de emergencia, no en curso, sin objetivo/fecha, ya cubierta o
// vencida). Compartida por calcularAporteMetas (que sí prorratea, para no
// duplicar las mismas guardas) y por el detector de metas fuera de ritmo.
function _planMensualMeta(m, hoy) {
  if (m.hogar_id != null) return null;
  if (m.estado !== 'en_curso') return null;
  if (m.es_fondo_emergencia) return null;
  const objetivo = Number(m.monto_objetivo) || 0;
  const actual = Number(m.monto_actual) || 0;
  if (objetivo <= 0) return null;
  if (!m.fecha_limite) return null;
  const restante = objetivo - actual;
  if (restante <= 0) return null;
  const diasHastaLimite = Math.floor((parseFechaISO(m.fecha_limite) - hoy) / 86400000);
  if (!(diasHastaLimite > 0)) return null; // vencido, NaN o fecha inválida → no prorratear
  const mesesRestantes = Math.max(1, Math.ceil(diasHastaLimite / 30));
  return restante / mesesRestantes;
}

// calcularAporteMetas — reserva la cuota de ahorro pendiente del mes. Por cada meta
// personal en curso (no fondo emergencia) con objetivo>0 y fecha_limite futura:
// planMensual = (objetivo−actual)/mesesRestantes; reserva planMensual×(díasRest/díasMes).
// Sin techo propio: quien llama (calcularSafeToSpend) acota el total contra el
// ingreso. Se mantiene así — sin cambiar su firma ni su retorno (un número) —
// porque graficos.html también la usa para la proyección de metas, donde no
// aplica el mismo techo del hero del dashboard.
function calcularAporteMetas(metas, hoy, diasRestantes, diasDelMes) {
  let total = 0;
  for (const m of (metas || [])) {
    const planMensual = _planMensualMeta(m, hoy);
    if (planMensual == null) continue;
    total += planMensual * (diasRestantes / diasDelMes);
  }
  return total;
}

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
  window.calcularAporteMetas = calcularAporteMetas;
}

export { fmtS, mediana, calcularSafeToSpend, baselineIngreso, calcularFijosComprometidos, calcularAporteMetas, cargarSafeToSpend };
