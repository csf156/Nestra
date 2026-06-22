// ─────────────────────────────────────────────────────────────────
// Nestra — insights.js
// Motor de insights analíticos (Fase 2). Corre en el cliente, lee 90
// días de historial y genera insight cards priorizadas para el dashboard.
//
// Detectores PUROS y deterministas: reciben arrays planos + `hoy` (Date)
// inyectado y devuelven insights (o []). Sin Date.now() interno, sin red,
// sin DOM → testeables con datos sintéticos. Única parte impura:
// cargarInsights(), que lee de db.js.
//
// Patrón dual-export (como sync-lww.js): window.* en navegador + export ESM
// para los tests. Cargar en index.html con <script type="module">.
//
// NO cubre presupuesto/límite de categoría: eso vive en alerts.js.
// ─────────────────────────────────────────────────────────────────
'use strict';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// Plural correcto: lunes-viernes invariantes; domingo/sábado pluralizan.
const DIAS_PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];

// diaISO(d) — Date → 'YYYY-MM-DD' en hora local.
function diaISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// restarDias(d, n) — nueva Date n días antes de d (medianoche local).
function restarDias(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n);
}

// parseFechaISO(iso) — 'YYYY-MM-DD' → Date medianoche local.
function parseFechaISO(iso) {
  const [y, m, dd] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, dd);
}

// fmtS(n) — número → 'S/1,234' (redondeado, separador de miles, determinista).
function fmtS(n) {
  const r = Math.round(Number(n) || 0);
  return 'S/' + String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// filtrarVentana(txs, hoy, dias) — transacciones con fecha en [hoy-dias, hoy].
function filtrarVentana(transacciones, hoy, dias) {
  const desde = diaISO(restarDias(hoy, dias));
  const hoyISO = diaISO(hoy);
  return (transacciones || []).filter(
    (t) => t.fecha && t.fecha >= desde && t.fecha <= hoyISO
  );
}

// detectCrecimiento(transacciones, { hoy, umbralPct?, baselineMin? })
// Compara gasto por categoría×ámbito: últimos 30d vs promedio mensual de los
// 60d previos. Devuelve hasta 2 insights (crecimiento warn / caída good).
function detectCrecimiento(transacciones, opts) {
  const hoy = opts.hoy;
  const UMBRAL = opts.umbralPct != null ? opts.umbralPct : 25;
  const BASE_MIN = opts.baselineMin != null ? opts.baselineMin : 50;
  const actualDesde = diaISO(restarDias(hoy, 30));
  const baseDesde = diaISO(restarDias(hoy, 90));
  const hoyISO = diaISO(hoy);

  const grupos = new Map();
  for (const t of transacciones) {
    if (t.tipo !== 'gasto' || !t.fecha) continue;
    if (t.fecha < baseDesde || t.fecha > hoyISO) continue;
    const key = t.categoria_id + '|' + t.ambito;
    let g = grupos.get(key);
    if (!g) {
      g = {
        categoria_id: t.categoria_id, ambito: t.ambito,
        nombre: (t.categorias && t.categorias.nombre) || 'Sin categoría',
        actualSum: 0, actualCount: 0, baseSum: 0, baseCount: 0,
      };
      grupos.set(key, g);
    }
    if (t.fecha >= actualDesde) { g.actualSum += Number(t.monto); g.actualCount++; }
    else { g.baseSum += Number(t.monto); g.baseCount++; }
  }

  const out = [];
  for (const g of grupos.values()) {
    const baseMensual = g.baseSum / 2; // 60 días ≈ 2 meses
    if (baseMensual < BASE_MIN || g.baseCount < 3 || g.actualCount < 2) continue;
    const pct = Math.round((g.actualSum - baseMensual) / baseMensual * 100);
    const ambLabel = g.ambito === 'hogar' ? 'hogar' : 'personal';
    const subtexto = `${fmtS(g.actualSum)} este mes vs ${fmtS(baseMensual)} tu promedio`;
    if (pct >= UMBRAL) {
      out.push({
        id: `crecimiento:${g.categoria_id}:${g.ambito}`, tipo: 'warn', icono: 'trending-up',
        titulo: `${g.nombre} (${ambLabel}) subió ${pct}%`, subtexto,
        accion: { label: 'Ver historial', href: '#historial' },
        meta: { ambito: g.ambito, categoria_id: g.categoria_id, pct, magnitud: Math.min(1, pct / 100) },
      });
    } else if (pct <= -UMBRAL) {
      const abs = Math.abs(pct);
      out.push({
        id: `caida:${g.categoria_id}:${g.ambito}`, tipo: 'good', icono: 'trending-down',
        titulo: `${g.nombre} (${ambLabel}) bajó ${abs}%`, subtexto,
        accion: { label: 'Ver historial', href: '#historial' },
        meta: { ambito: g.ambito, categoria_id: g.categoria_id, pct, magnitud: Math.min(1, abs / 100) },
      });
    }
  }
  out.sort((a, b) => Math.abs(b.meta.pct) - Math.abs(a.meta.pct));
  return out.slice(0, 2);
}

// detectDiaAnomalo(transacciones, { hoy, factor?, minOcc?, minTotal? })
// Detecta el día de la semana cuyo gasto promedio (por fecha distinta) es
// ≥ factor× el promedio de los DEMÁS días. Comparar contra los demás días (no
// contra un promedio global que se auto-incluye) mantiene el multiplicador del
// título coherente con las cifras del subtexto. Ventana 90d, gasto de ambos
// ámbitos. Devuelve 1 insight info o [].
function detectDiaAnomalo(transacciones, opts) {
  const hoy = opts.hoy;
  const FACTOR = opts.factor != null ? opts.factor : 1.8;
  const MIN_OCC = opts.minOcc != null ? opts.minOcc : 6;
  const MIN_TOTAL = opts.minTotal != null ? opts.minTotal : 100;
  const desde = diaISO(restarDias(hoy, 90));
  const hoyISO = diaISO(hoy);

  const sumPorDia = [0, 0, 0, 0, 0, 0, 0];
  const fechasPorWd = [new Set(), new Set(), new Set(), new Set(), new Set(), new Set(), new Set()];
  const fechasTotal = new Set();
  let total = 0;
  for (const t of transacciones) {
    if (t.tipo !== 'gasto' || !t.fecha) continue;
    if (t.fecha < desde || t.fecha > hoyISO) continue;
    const wd = parseFechaISO(t.fecha).getDay();
    const m = Number(t.monto);
    sumPorDia[wd] += m; total += m;
    fechasPorWd[wd].add(t.fecha); fechasTotal.add(t.fecha);
  }
  if (total < MIN_TOTAL || fechasTotal.size === 0) return [];

  let mejor = null;
  for (let wd = 0; wd < 7; wd++) {
    const occ = fechasPorWd[wd].size;       // fechas distintas con gasto ese weekday
    if (occ < MIN_OCC) continue;
    const otrosDias = fechasTotal.size - occ;
    if (otrosDias <= 0) continue;           // sin días de comparación
    const promWd = sumPorDia[wd] / occ;
    const promOtros = (total - sumPorDia[wd]) / otrosDias;
    if (promOtros <= 0) continue;
    const ratio = promWd / promOtros;
    if (ratio >= FACTOR && (!mejor || ratio > mejor.ratio)) {
      mejor = { wd, ratio, promWd, promOtros, occ };
    }
  }
  if (!mejor) return [];

  const veces = Math.round(mejor.ratio * 10) / 10;
  const dia = DIAS_PLURAL[mejor.wd];
  return [{
    id: `dia-anomalo:${mejor.wd}`, tipo: 'info', icono: 'calendar-stats',
    titulo: `Gastas ${veces}x más los ${dia}`,
    subtexto: `${fmtS(mejor.promWd)} en promedio los ${dia} vs ${fmtS(mejor.promOtros)} los demás días`,
    accion: null,
    meta: { wd: mejor.wd, ratio: mejor.ratio, magnitud: Math.min(1, (mejor.ratio - 1) / 2) },
  }];
}

// detectProyeccionMeta(metas, { hoy }) — proyecta, al ritmo actual de aporte,
// si cada meta en curso llegará a su objetivo antes de su fecha límite.
// good = llega a tiempo; warn = se atrasa. Ignora fondos de emergencia.
function detectProyeccionMeta(metas, opts) {
  const hoy = opts.hoy;
  const out = [];
  for (const m of metas) {
    if (m.es_fondo_emergencia) continue;
    if (m.estado !== 'en_curso') continue;
    const objetivo = Number(m.monto_objetivo);
    const actual = Number(m.monto_actual);
    if (!objetivo || objetivo <= 0) continue;
    if (!m.fecha_limite || !m.fecha_inicio) continue;
    if (!(actual > 0)) continue;

    const inicio = parseFechaISO(m.fecha_inicio);
    const limite = parseFechaISO(m.fecha_limite);
    const diasTranscurridos = Math.floor((hoy - inicio) / 86400000);
    if (diasTranscurridos <= 0) continue;
    const restante = objetivo - actual;
    if (restante <= 0) continue;
    const ritmoDiario = actual / diasTranscurridos;
    if (!(ritmoDiario > 0)) continue;

    const diasFalt = Math.ceil(restante / ritmoDiario);
    const proy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + diasFalt);

    if (proy <= limite) {
      const holguraDias = Math.floor((limite - proy) / 86400000);
      out.push({
        id: `meta-ok:${m.id}`, tipo: 'good', icono: 'target-arrow',
        titulo: `A este ritmo alcanzas ${m.nombre} en ${MESES[proy.getMonth()]}`,
        subtexto: `Proyección ${diaISO(proy)} · meta ${m.fecha_limite}`,
        accion: { label: 'Ver meta', href: '#metas' },
        meta: { ambito: m.ambito, meta_id: m.id, magnitud: Math.min(1, holguraDias / 90) },
      });
    } else {
      const atrasoDias = Math.floor((proy - limite) / 86400000);
      const meses = Math.round(atrasoDias / 30);
      const atrasoTxt = atrasoDias >= 30
        ? `${meses} mes${meses === 1 ? '' : 'es'}`
        : `${atrasoDias} día${atrasoDias === 1 ? '' : 's'}`;
      out.push({
        id: `meta-tarde:${m.id}`, tipo: 'warn', icono: 'target-arrow',
        titulo: `${m.nombre} va atrasada ~${atrasoTxt}`,
        subtexto: `A este ritmo llegas el ${diaISO(proy)} · meta ${m.fecha_limite}`,
        accion: { label: 'Ver meta', href: '#metas' },
        meta: { ambito: m.ambito, meta_id: m.id, magnitud: Math.min(1, atrasoDias / 90) },
      });
    }
  }
  return out;
}

// detectRitmoMensual(transacciones, { hoy, umbralPct?, minDias? })
// Proyecta el gasto total del mes en curso a fin de mes y lo compara con el
// total del mes anterior. warn si sube ≥15%, good si baja ≥15%.
function detectRitmoMensual(transacciones, opts) {
  const hoy = opts.hoy;
  const UMBRAL = opts.umbralPct != null ? opts.umbralPct : 15;
  const MIN_DIAS = opts.minDias != null ? opts.minDias : 5;
  const y = hoy.getFullYear(), mo = hoy.getMonth();
  const diaDelMes = hoy.getDate();
  if (diaDelMes < MIN_DIAS) return [];
  const diasDelMes = new Date(y, mo + 1, 0).getDate();
  const inicioMesISO = diaISO(new Date(y, mo, 1));
  const hoyISO = diaISO(hoy);

  const prevY = mo === 0 ? y - 1 : y;
  const prevMo = mo === 0 ? 11 : mo - 1;
  const inicioPrevISO = diaISO(new Date(prevY, prevMo, 1));
  const finPrevISO = diaISO(new Date(prevY, prevMo, new Date(prevY, prevMo + 1, 0).getDate()));

  let gastoMes = 0, gastoPrev = 0;
  for (const t of transacciones) {
    if (t.tipo !== 'gasto' || !t.fecha) continue;
    if (t.fecha >= inicioMesISO && t.fecha <= hoyISO) gastoMes += Number(t.monto);
    else if (t.fecha >= inicioPrevISO && t.fecha <= finPrevISO) gastoPrev += Number(t.monto);
  }
  if (gastoPrev <= 0) return [];

  const proyeccion = gastoMes / diaDelMes * diasDelMes;
  const pct = Math.round((proyeccion - gastoPrev) / gastoPrev * 100);
  const subtexto = `Proyección ${fmtS(proyeccion)} este mes vs ${fmtS(gastoPrev)} el mes pasado`;
  if (pct >= UMBRAL) {
    return [{
      id: 'ritmo-mes', tipo: 'warn', icono: 'chart-line',
      titulo: `Vas camino a gastar ${pct}% más que el mes pasado`, subtexto,
      accion: null, meta: { pct, magnitud: Math.min(1, pct / 100) },
    }];
  } else if (pct <= -UMBRAL) {
    const abs = Math.abs(pct);
    return [{
      id: 'ritmo-mes', tipo: 'good', icono: 'chart-line',
      titulo: `Vas camino a gastar ${abs}% menos que el mes pasado`, subtexto,
      accion: null, meta: { pct, magnitud: Math.min(1, abs / 100) },
    }];
  }
  return [];
}

// detectBuenMes(transacciones, { hoy, umbralPct? }) — compara el gasto del
// último mes calendario CERRADO con el promedio de los meses cerrados previos.
// good si gastó ≥15% menos. Excluye el mes en curso (comparación completa).
function detectBuenMes(transacciones, opts) {
  const hoy = opts.hoy;
  const UMBRAL = opts.umbralPct != null ? opts.umbralPct : 15;
  const porMes = new Map();
  for (const t of transacciones) {
    if (t.tipo !== 'gasto' || !t.fecha) continue;
    const ym = t.fecha.slice(0, 7);
    porMes.set(ym, (porMes.get(ym) || 0) + Number(t.monto));
  }
  const ymActual = diaISO(hoy).slice(0, 7);
  const cerrados = [...porMes.entries()]
    .filter(([ym]) => ym < ymActual)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)); // desc por mes
  if (cerrados.length < 2) return [];

  const [ymUlt, gastoUlt] = cerrados[0];
  const previos = cerrados.slice(1);
  const promPrevios = previos.reduce((s, [, v]) => s + v, 0) / previos.length;
  if (promPrevios <= 0) return [];
  const pct = Math.round((gastoUlt - promPrevios) / promPrevios * 100);
  if (pct > -UMBRAL) return [];

  const abs = Math.abs(pct);
  const mm = Number(ymUlt.split('-')[1]);
  return [{
    id: 'buen-mes', tipo: 'good', icono: 'circle-check',
    titulo: `En ${MESES[mm - 1]} gastaste ${abs}% menos que tu promedio`,
    subtexto: `${fmtS(gastoUlt)} vs ${fmtS(promPrevios)} de promedio mensual`,
    accion: null, meta: { pct, magnitud: Math.min(1, abs / 100) },
  }];
}

const PESO_TIPO = { alert: 3, warn: 2, good: 1.5, info: 1 };

// priorizar(insights, { cap? }) — calcula score, ordena desc y capa (default 6).
function priorizar(insights, opts) {
  const cap = (opts && opts.cap != null) ? opts.cap : 6;
  const conScore = insights.map((i) => {
    const peso = PESO_TIPO[i.tipo] != null ? PESO_TIPO[i.tipo] : 1;
    const mag = (i.meta && typeof i.meta.magnitud === 'number') ? i.meta.magnitud : 0;
    return Object.assign({}, i, { score: peso * (1 + mag) });
  });
  conScore.sort((a, b) => b.score - a.score);
  return conScore.slice(0, cap);
}

// generarInsights({ transacciones, categorias, metas, hoy }) — orquesta todos
// los detectores (cada uno aislado en try/catch), prioriza y capa. Puro.
function generarInsights(datos) {
  const transacciones = datos.transacciones || [];
  const metas = datos.metas || [];
  const opts = { hoy: datos.hoy || new Date() };
  let all = [];
  const corre = (fn, arg) => { try { all = all.concat(fn(arg, opts)); } catch (e) { console.error('insight detector falló:', e && e.message); } };
  corre(detectCrecimiento, transacciones);
  corre(detectDiaAnomalo, transacciones);
  corre(detectProyeccionMeta, metas);
  corre(detectRitmoMensual, transacciones);
  corre(detectBuenMes, transacciones);
  return priorizar(all, {});
}

// cargarInsights() — ÚNICA parte impura. Lee de db.js (globales en window),
// recorta a 90 días y delega en generarInsights. try/catch → [] (nunca tumba
// el dashboard). No se unit-testea; la lógica de recorte vive en filtrarVentana.
async function cargarInsights() {
  try {
    const [transacciones, categorias, metas] = await Promise.all([
      window.getTransacciones(),
      window.getCategorias(),
      window.getMetas(),
    ]);
    const hoy = new Date();
    const recientes = filtrarVentana(transacciones || [], hoy, 90);
    return generarInsights({ transacciones: recientes, categorias: categorias || [], metas: metas || [], hoy });
  } catch (err) {
    console.error('Error en cargarInsights():', err && (err.message || err));
    return [];
  }
}

if (typeof window !== 'undefined') {
  window.generarInsights = generarInsights;
  window.cargarInsights = cargarInsights;
}

export { diaISO, restarDias, parseFechaISO, fmtS, filtrarVentana, detectCrecimiento, detectDiaAnomalo, detectProyeccionMeta, detectRitmoMensual, detectBuenMes, priorizar, generarInsights, cargarInsights };
