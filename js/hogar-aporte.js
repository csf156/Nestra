// ─────────────────────────────────────────────────────────────────
// Nestra — hogar-aporte.js (Fase 6.3, re-basado)
// Aporte real de un miembro al hogar en un rango: gasto hogar (su parte de
// gastos compartidos) + ahorro hogar (lo que apartó para metas/fondo).
// Deliberadamente incluye AMBOS flujos, a diferencia del desequilibrio
// (hogar-desequilibrio.js), que es solo-gastos: "aporte esperado" significa
// "cuánto acordamos poner al hogar al mes", cualquiera sea la vía.
// Puro y determinista. Dual-export como safe-to-spend.js.
// ─────────────────────────────────────────────────────────────────
'use strict';

function aporteRealPorMiembro(transacciones, userId, rango) {
  var desde = rango && rango.desde, hasta = rango && rango.hasta;
  return (transacciones || []).reduce(function (sum, t) {
    if (t.user_id !== userId) return sum;
    if (t.ambito !== 'hogar') return sum;
    if (t.tipo !== 'gasto' && t.tipo !== 'ahorro') return sum;
    if (desde && t.fecha < desde) return sum;
    if (hasta && t.fecha > hasta) return sum;
    return sum + (Number(t.monto) || 0);
  }, 0);
}

if (typeof window !== 'undefined') {
  window.aporteRealPorMiembro = aporteRealPorMiembro;
}

export { aporteRealPorMiembro };
