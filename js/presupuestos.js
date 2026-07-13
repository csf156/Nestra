// ─────────────────────────────────────────────────────────────────
// Nestra — presupuestos.js
// Módulo PURO: clasifica un gasto contra su límite mensual.
// Sin dependencias, sin I/O. ESM export + export a window (igual que
// insights.js) para que lo use el dashboard (script no-módulo).
//
// Umbrales (Fase 3): verde <70%, ámbar 70–100%, rojo >100% (superado).
// ─────────────────────────────────────────────────────────────────

// estadoPresupuesto(gastado, limite) — clasifica el gasto contra el límite.
// limite <= 0 / inválido → null. Retorna { pctReal, ancho, color, superado }.
function estadoPresupuesto(gastado, limite) {
  const g = Number(gastado);
  const l = Number(limite);
  if (!Number.isFinite(l) || l <= 0) return null;
  const gg = Number.isFinite(g) ? g : 0;

  const ratio = gg / l;
  const pctReal = Math.round(ratio * 100);
  const ancho = Math.max(0, Math.min(100, pctReal));

  let color;
  if (ratio < 0.70) color = 'verde';
  else if (ratio <= 1.0) color = 'ambar';
  else color = 'rojo';

  return { pctReal, ancho, color, superado: ratio > 1.0 };
}

if (typeof window !== 'undefined') {
  window.estadoPresupuesto = estadoPresupuesto;
}

export { estadoPresupuesto };
