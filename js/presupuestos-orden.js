// ─────────────────────────────────────────────────────────────────
// Nestra — presupuestos-orden.js (Tanda 1, #7)
// Orden de la card "Presupuestos del mes" del dashboard. Puro y determinista.
// Dual-export como safe-to-spend.js / hogar-desequilibrio.js.
// ─────────────────────────────────────────────────────────────────
'use strict';

// _consumo(fila) — fracción del límite ya gastada. Un límite en 0 no puede
// dividirse: con gasto encima cuenta como excedido (Infinity), sin gasto no es
// urgente (0). El llamador ya filtra limite > 0, pero la función no lo asume.
function _consumo(fila) {
  var limite = Number(fila.limite) || 0;
  var gastado = Number(fila.gastado) || 0;
  if (limite <= 0) return gastado > 0 ? Infinity : 0;
  return gastado / limite;
}

// ordenarPresupuestos(filas, criterio, direccion) → filas ordenadas (copia).
//   filas:     [{ id, nombre, gastado, limite, esHogar }]
//   criterio:  'limite' (cercanía al límite) | 'gasto' (monto gastado).
//              Cualquier otro valor cae a 'limite'.
//   direccion: 'asc' | 'desc' (default).
// No muta la entrada. El orden es estable: en empate manda el orden de entrada.
// El agrupado personal-primero se pierde a propósito: el orden elegido manda y
// las filas de hogar ya se distinguen por su badge.
function ordenarPresupuestos(filas, criterio, direccion) {
  var valor = criterio === 'gasto'
    ? function (f) { return Number(f.gastado) || 0; }
    : _consumo;
  var signo = direccion === 'asc' ? -1 : 1;
  return (filas || [])
    .map(function (f, i) { return { f: f, i: i }; })
    .sort(function (a, b) {
      var va = valor(a.f), vb = valor(b.f);
      if (va === vb) return a.i - b.i;   // estable
      return va < vb ? signo : -signo;   // Infinity se compara bien acá
    })
    .map(function (x) { return x.f; });
}

if (typeof window !== 'undefined') {
  window.ordenarPresupuestos = ordenarPresupuestos;
}

export { ordenarPresupuestos };
