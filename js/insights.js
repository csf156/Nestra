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

if (typeof window !== 'undefined') {
  // (se completará con generarInsights / cargarInsights en tareas posteriores)
}

export { diaISO, restarDias, parseFechaISO, fmtS, filtrarVentana, detectCrecimiento };
