// ─────────────────────────────────────────────────────────────────
// Nestra — hogar-aporte.js (Fase 6.1)
// Aporte real de un miembro al hogar en un rango: ingresos del hogar +
// gastos del hogar que pagó (tipo in ingreso/gasto, hogar_id != null).
// Puro y determinista. Dual-export como safe-to-spend.js.
// ─────────────────────────────────────────────────────────────────
'use strict';

function aporteRealPorMiembro(transacciones, userId, rango) {
  var desde = rango && rango.desde, hasta = rango && rango.hasta;
  return (transacciones || []).reduce(function (sum, t) {
    if (t.user_id !== userId) return sum;
    if (t.hogar_id == null) return sum;                 // solo del hogar
    if (t.tipo !== 'ingreso' && t.tipo !== 'gasto') return sum; // no ahorro
    if (desde && t.fecha < desde) return sum;
    if (hasta && t.fecha > hasta) return sum;
    return sum + (Number(t.monto) || 0);
  }, 0);
}

if (typeof window !== 'undefined') {
  window.aporteRealPorMiembro = aporteRealPorMiembro;
}

export { aporteRealPorMiembro };
