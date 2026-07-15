// ─────────────────────────────────────────────────────────────────
// Nestra — hogar-desequilibrio.js (Fase 6.3)
// Desequilibrio de aportes: cuánto puso cada miembro en gastos COMPARTIDOS
// del hogar (histórico completo, sin reset) contra un objetivo de reparto.
// Es prospectivo ("B debería aportar más en los próximos gastos"), no una
// deuda. El ahorro al hogar NO cuenta aquí (decisión de diseño: se acredita
// aparte, en la disolución, por ahorro real aportado).
// Determinista, sin red. Dual-export como safe-to-spend.js / insights.js.
// ─────────────────────────────────────────────────────────────────
'use strict';

// calcularDesequilibrioHogar(transacciones, ajustes, uidA, uidB, objetivo)
//   transacciones: filas con { tipo, ambito, user_id, monto }. Solo cuentan
//     tipo='gasto' && ambito='hogar'.
//   ajustes: pagos en efectivo ya registrados: [{ de_user, a_user, monto }].
//   objetivo: { modo: '50_50'|'proporcional', esperadoA?, esperadoB? }.
//     'proporcional' cae a 50/50 si esperadoA+esperadoB es 0.
// Returns: { brecha, debeAportarMas, yaAportoDeMas, pagoA, pagoB }.
//   brecha=0 ⇒ debeAportarMas y yaAportoDeMas son null (van igual).
function calcularDesequilibrioHogar(transacciones, ajustes, uidA, uidB, objetivo) {
  var pagoA = 0, pagoB = 0;
  (transacciones || []).forEach(function (t) {
    if (t.ambito !== 'hogar' || t.tipo !== 'gasto') return;
    if (t.user_id === uidA) pagoA += Number(t.monto) || 0;
    else if (t.user_id === uidB) pagoB += Number(t.monto) || 0;
  });

  var objetivoA = 0.5;
  if (objetivo && objetivo.modo === 'proporcional') {
    var eA = Number(objetivo.esperadoA) || 0, eB = Number(objetivo.esperadoB) || 0;
    if (eA + eB > 0) objetivoA = eA / (eA + eB);
  }

  // >0 ⇒ A puso de más ⇒ B debería aportar más en los próximos gastos.
  var neto = pagoA - objetivoA * (pagoA + pagoB);

  (ajustes || []).forEach(function (a) {
    var m = Number(a.monto) || 0;
    if (a.de_user === uidB && a.a_user === uidA) neto -= m; // B ya compensó a A
    else if (a.de_user === uidA && a.a_user === uidB) neto += m; // A ya compensó a B
  });

  neto = Math.round(neto * 100) / 100;
  return {
    brecha: Math.abs(neto),
    debeAportarMas: neto > 0 ? uidB : (neto < 0 ? uidA : null),
    yaAportoDeMas: neto > 0 ? uidA : (neto < 0 ? uidB : null),
    pagoA: pagoA,
    pagoB: pagoB,
  };
}

if (typeof window !== 'undefined') {
  window.calcularDesequilibrioHogar = calcularDesequilibrioHogar;
}

export { calcularDesequilibrioHogar };
