// ─────────────────────────────────────────────────────────────────
// Nestra — hogar-balance.js (Fase 6)
// Lógica pura del balance "quién debe qué" (50/50 de gastos hogar) y del
// reparto de disolución (% de aporte de ingresos). Determinista, testeable.
// Dual-export como safe-to-spend.js / insights.js.
// ─────────────────────────────────────────────────────────────────
'use strict';

// Balance "quién debe qué" del hogar. modo:
//   '50_50' (default)     → parte justa = mitad de los gastos hogar.
//   'proporcional'        → parte justa pesada por los ingresos hogar del mes;
//                           cae a 50/50 si ambos ingresos son 0.
// neto ajustado por liquidaciones (de=X a=Y ⇒ X ya pagó m a Y).
function calcularBalanceHogar(transacciones, liquidaciones, uidA, uidB, modo) {
  var pagoA = 0, pagoB = 0, ingA = 0, ingB = 0;
  (transacciones || []).forEach(function (t) {
    if (t.ambito !== 'hogar' && t.hogar_id == null) return; // solo hogar
    var m = Number(t.monto) || 0;
    if (t.tipo === 'gasto') {
      if (t.user_id === uidA) pagoA += m;
      else if (t.user_id === uidB) pagoB += m;
    } else if (t.tipo === 'ingreso') {
      if (t.user_id === uidA) ingA += m;
      else if (t.user_id === uidB) ingB += m;
    }
  });

  var neto;
  if (modo === 'proporcional' && (ingA + ingB) > 0) {
    var pesoA = ingA / (ingA + ingB);
    neto = pagoA - pesoA * (pagoA + pagoB);   // >0 ⇒ B le debe a A
  } else {
    neto = (pagoA - pagoB) / 2;               // 50/50 (default y fallback)
  }

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
