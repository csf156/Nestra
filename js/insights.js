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

if (typeof window !== 'undefined') {
  // (se completará con generarInsights / cargarInsights en tareas posteriores)
}

export { diaISO, restarDias, parseFechaISO, fmtS, filtrarVentana };
