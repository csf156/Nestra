// ─────────────────────────────────────────────────────────────────
// Nestra — hogar-aporte.js (Fase 6.3 · Tanda 2)
// Aporte real de un miembro al hogar en un rango, desglosado en gasto
// (su parte de gastos compartidos) y ahorro (lo que apartó para metas/fondo).
//
// Devuelve los dos por separado Y su total. El total es legítimo acá, a
// diferencia del desequilibrio: la card compara a cada miembro contra SU
// propia meta mensual (hogar_miembros.aporte_esperado = "cuánto acordamos
// poner al hogar al mes"), no contra el otro miembro. "¿Cumplí lo que
// acordé?" no tiene el problema de doble conteo que hace que las brechas de
// hogar-desequilibrio.js no se puedan sumar.
//
// El desglose existe porque con aporte_esperado en 0 no hay meta contra la
// que medir, y dos totales lado a lado se leen como una carrera — insinuando
// que quien ahorró 450 aportó más que quien gastó 125, cuando esos 450 le
// vuelven al disolver.
//
// Puro y determinista. Dual-export como safe-to-spend.js.
// ─────────────────────────────────────────────────────────────────
'use strict';

// aporteRealPorMiembro(transacciones, userId, rango)
//   rango: { desde, hasta } en ISO (YYYY-MM-DD); ambos opcionales.
// Returns: { gasto, ahorro, total } — solo filas de ambito='hogar' del miembro.
function aporteRealPorMiembro(transacciones, userId, rango) {
  var desde = rango && rango.desde, hasta = rango && rango.hasta;
  var gasto = 0, ahorro = 0;
  (transacciones || []).forEach(function (t) {
    if (t.user_id !== userId) return;
    if (t.ambito !== 'hogar') return;
    if (t.tipo !== 'gasto' && t.tipo !== 'ahorro') return;
    if (desde && t.fecha < desde) return;
    if (hasta && t.fecha > hasta) return;
    var m = Number(t.monto) || 0;
    if (t.tipo === 'gasto') gasto += m; else ahorro += m;
  });
  var r2 = function (n) { return Math.round(n * 100) / 100; };
  gasto = r2(gasto); ahorro = r2(ahorro);
  return { gasto: gasto, ahorro: ahorro, total: r2(gasto + ahorro) };
}

if (typeof window !== 'undefined') {
  window.aporteRealPorMiembro = aporteRealPorMiembro;
}

export { aporteRealPorMiembro };
