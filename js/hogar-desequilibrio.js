// ─────────────────────────────────────────────────────────────────
// Nestra — hogar-desequilibrio.js (Fase 6.3 · Tanda 2)
// Desequilibrio de aportes: cuánto puso cada miembro al hogar contra un
// objetivo de reparto, histórico completo y sin reset. Es prospectivo
// ("B debería aportar más de acá en adelante"), no una deuda.
//
// Hay DOS métricas, deliberadamente separadas y nunca sumadas:
//
//   gasto  — gastos compartidos. El dinero se gastó y no vuelve: si pusiste
//            de más, estás abajo de verdad. Un pago en efectivo entre los dos
//            (hogar_liquidaciones) lo zanja.
//   ahorro — ahorro al hogar. El dinero está aparcado y VUELVE a quien lo
//            puso al disolver (disolver_hogar reparte el bote por ahorro real:
//            pot × ahorroA/(ahorroA+ahorroB) = ahorroA). Nadie está abajo, así
//            que un pago en efectivo NO lo zanja — solo se cierra ahorrando.
//
// Por eso desequilibrioAhorroHogar NO recibe `ajustes`: hace inexpresable
// restar un pago en efectivo de una brecha que el pago no mueve.
//
// NO SUMAR LAS DOS BRECHAS. Con los datos reales del hogar apuntan a miembros
// distintos y el total invierte la conclusión, apoyándose en dinero que vuelve.
// Ver docs/superpowers/specs/2026-07-16-tanda2-desequilibrio-gasto-ahorro-design.md
// y el test 'datos reales: gasto y ahorro apuntan a miembros distintos'.
//
// Determinista, sin red. Dual-export como safe-to-spend.js / insights.js.
// ─────────────────────────────────────────────────────────────────
'use strict';

// _brecha(transacciones, tipo, ajustes, uidA, uidB, objetivo)
//   Núcleo compartido. `ajustes` puede ser null (el caso del ahorro).
//   objetivo: { modo: '50_50'|'proporcional', esperadoA?, esperadoB? }.
//     'proporcional' cae a 50/50 si esperadoA+esperadoB es 0.
// Returns: { brecha, debeAportarMas, yaAportoDeMas, pagoA, pagoB }.
//   brecha=0 ⇒ debeAportarMas y yaAportoDeMas son null (van igual).
function _brecha(transacciones, tipo, ajustes, uidA, uidB, objetivo) {
  var pagoA = 0, pagoB = 0;
  (transacciones || []).forEach(function (t) {
    if (t.ambito !== 'hogar' || t.tipo !== tipo) return;
    if (t.user_id === uidA) pagoA += Number(t.monto) || 0;
    else if (t.user_id === uidB) pagoB += Number(t.monto) || 0;
  });

  var objetivoA = 0.5;
  if (objetivo && objetivo.modo === 'proporcional') {
    var eA = Number(objetivo.esperadoA) || 0, eB = Number(objetivo.esperadoB) || 0;
    if (eA + eB > 0) objetivoA = eA / (eA + eB);
  }

  // >0 ⇒ A puso de más ⇒ B debería aportar más de acá en adelante.
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

// desequilibrioGastoHogar(transacciones, ajustes, uidA, uidB, objetivo)
//   Solo cuenta tipo='gasto' && ambito='hogar'.
//   ajustes: pagos en efectivo ya registrados: [{ de_user, a_user, monto }].
//   pagoA/pagoB = lo que gastó cada uno en el hogar.
function desequilibrioGastoHogar(transacciones, ajustes, uidA, uidB, objetivo) {
  return _brecha(transacciones, 'gasto', ajustes, uidA, uidB, objetivo);
}

// desequilibrioAhorroHogar(transacciones, uidA, uidB, objetivo)
//   Solo cuenta tipo='ahorro' && ambito='hogar'.
//   SIN `ajustes` a propósito: un pago en efectivo no mueve el bote, así que no
//   puede zanjar esta brecha. La firma lo hace inexpresable.
//   pagoA/pagoB = lo que ahorró cada uno al hogar (el nombre se conserva del
//   núcleo compartido; acá significan "ahorró", no "pagó").
function desequilibrioAhorroHogar(transacciones, uidA, uidB, objetivo) {
  return _brecha(transacciones, 'ahorro', null, uidA, uidB, objetivo);
}

if (typeof window !== 'undefined') {
  window.desequilibrioGastoHogar = desequilibrioGastoHogar;
  window.desequilibrioAhorroHogar = desequilibrioAhorroHogar;
}

export { desequilibrioGastoHogar, desequilibrioAhorroHogar };
