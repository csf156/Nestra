// ─────────────────────────────────────────────────────────────────
// Nestra — hogar-balance.js (Fase 6)
// Lógica pura del balance "quién debe qué" (50/50 de gastos hogar) y del
// reparto de disolución (% de aporte de ingresos). Determinista, testeable.
// Dual-export como safe-to-spend.js / insights.js.
// ─────────────────────────────────────────────────────────────────
'use strict';

// neto = (pagóA - pagóB)/2, ajustado por liquidaciones.
// liquidación de=X a=Y monto m  ⇒ X ya le pagó m a Y, baja la deuda de X hacia Y.
function calcularBalanceHogar(transacciones, liquidaciones, uidA, uidB) {
  var pagoA = 0, pagoB = 0;
  (transacciones || []).forEach(function (t) {
    if (t.ambito !== 'hogar' || t.tipo !== 'gasto') return;
    if (t.user_id === uidA) pagoA += Number(t.monto) || 0;
    else if (t.user_id === uidB) pagoB += Number(t.monto) || 0;
  });
  var neto = (pagoA - pagoB) / 2; // >0 ⇒ B le debe a A
  (liquidaciones || []).forEach(function (l) {
    var m = Number(l.monto) || 0;
    if (l.de_user === uidB && l.a_user === uidA) neto -= m;       // B pagó a A
    else if (l.de_user === uidA && l.a_user === uidB) neto += m;  // A pagó a B
  });
  neto = Math.round(neto * 100) / 100;
  return {
    neto: Math.abs(neto),
    acreedor: neto >= 0 ? uidA : uidB,
    deudor:   neto >= 0 ? uidB : uidA,
    pagoA: pagoA, pagoB: pagoB
  };
}

// reparto del ahorro neto por % de aporte histórico de ingresos.
function repartoDisolucion(ingresosA, ingresosB, ahorro) {
  var a = Number(ingresosA) || 0, b = Number(ingresosB) || 0, s = Number(ahorro) || 0;
  var pctA = (a + b) === 0 ? 0.5 : a / (a + b);
  var recibeA = Math.round(s * pctA * 100) / 100;
  return { pctA: pctA, recibeA: recibeA, recibeB: Math.round((s - recibeA) * 100) / 100 };
}

if (typeof window !== 'undefined') {
  window.calcularBalanceHogar = calcularBalanceHogar;
  window.repartoDisolucion = repartoDisolucion;
}

export { calcularBalanceHogar, repartoDisolucion };
