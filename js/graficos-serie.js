// ─────────────────────────────────────────────────────────────────
// Nestra — graficos-serie.js (Tanda 3, #2)
// Agrupa transacciones en una serie temporal por día, mes o trimestre.
// NO acumula: cada periodo lleva lo suyo. El acumulado era el bug — aplanaba
// los picos y no dejaba ver los periodos de mayor gasto.
// (El chart "Ahorro acumulado" sí acumula, pero eso es otro gráfico y ahí es
// el punto: mide cómo crece el bote.)
// Puro y determinista. Dual-export como safe-to-spend.js.
// ─────────────────────────────────────────────────────────────────
'use strict';

function _p2(n) { return n < 10 ? '0' + n : String(n); }

// Aritmética de meses en un solo eje (anio*12 + mes-1) para no pelearse con
// los cruces de año hacia atrás.
function _mesesAtras(mes, anio, k) {
  var t = (anio * 12 + (mes - 1)) - k;
  return { mes: (t % 12) + 1, anio: Math.floor(t / 12) };
}

var _MES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Clave del periodo al que cae una fecha. Se parsea la cadena ISO a mano en vez
// de con new Date(): 'YYYY-MM-DD' se interpreta como UTC y el equivalente local
// puede caer el día anterior según la zona horaria.
function _bucketDe(fechaISO, granularidad) {
  var s = String(fechaISO).split('T')[0];
  var y = parseInt(s.slice(0, 4), 10), m = parseInt(s.slice(5, 7), 10);
  if (granularidad === 'meses') return y + '-' + _p2(m);
  return y + '-T' + Math.ceil(m / 3);
}

// Los n periodos que terminan en `hasta`, del más viejo al más nuevo.
function _periodos(granularidad, hasta, n) {
  var out = [];
  if (granularidad === 'meses') {
    for (var i = n - 1; i >= 0; i--) {
      var p = _mesesAtras(hasta.mes, hasta.anio, i);
      out.push({ clave: p.anio + '-' + _p2(p.mes), label: _MES3[p.mes - 1] });
    }
    return out;
  }
  var tHasta = Math.ceil(hasta.mes / 3);
  for (var j = n - 1; j >= 0; j--) {
    var tt = (hasta.anio * 4 + (tHasta - 1)) - j;
    var anio = Math.floor(tt / 4), tri = (tt % 4) + 1;
    out.push({ clave: anio + '-T' + tri, label: 'T' + tri + ' ' + String(anio).slice(2) });
  }
  return out;
}

// agruparSerie(transacciones, granularidad, hasta, n) → [{ label, gasto, ingreso }]
//   granularidad: 'dias' | 'meses' | 'trimestres'
//   hasta: { mes, anio } — el último periodo de la ventana (el del navegador).
//   n: cuántos periodos (12 meses / 8 trimestres). Se ignora en 'dias', donde
//      la ventana es el mes entero de `hasta`.
// Solo cuentan tipo 'gasto' e 'ingreso'; el ahorro no es ni una cosa ni la otra.
// Los periodos sin datos salen en 0: se dibujan, no se saltan.
function agruparSerie(transacciones, granularidad, hasta, n) {
  if (granularidad === 'dias') {
    var dias = new Date(Date.UTC(hasta.anio, hasta.mes, 0)).getUTCDate();
    var g = new Array(dias).fill(0), ing = new Array(dias).fill(0);
    (transacciones || []).forEach(function (t) {
      var s = String(t.fecha).split('T')[0];
      if (parseInt(s.slice(0, 4), 10) !== hasta.anio) return;
      if (parseInt(s.slice(5, 7), 10) !== hasta.mes) return;
      var d = parseInt(s.slice(8, 10), 10) - 1;
      if (d < 0 || d >= dias) return;
      if (t.tipo === 'gasto') g[d] += Number(t.monto) || 0;
      else if (t.tipo === 'ingreso') ing[d] += Number(t.monto) || 0;
    });
    return g.map(function (v, k) {
      return { label: String(k + 1), gasto: Math.round(v * 100) / 100, ingreso: Math.round(ing[k] * 100) / 100 };
    });
  }

  var periodos = _periodos(granularidad, hasta, n);
  var idx = {};
  periodos.forEach(function (p, k) { idx[p.clave] = k; });
  var gs = new Array(periodos.length).fill(0), is = new Array(periodos.length).fill(0);
  (transacciones || []).forEach(function (t) {
    if (t.tipo !== 'gasto' && t.tipo !== 'ingreso') return;
    var k = idx[_bucketDe(t.fecha, granularidad)];
    if (k === undefined) return;   // fuera de la ventana
    if (t.tipo === 'gasto') gs[k] += Number(t.monto) || 0;
    else is[k] += Number(t.monto) || 0;
  });
  return periodos.map(function (p, k) {
    return { label: p.label, gasto: Math.round(gs[k] * 100) / 100, ingreso: Math.round(is[k] * 100) / 100 };
  });
}

if (typeof window !== 'undefined') {
  window.agruparSerie = agruparSerie;
}

export { agruparSerie };
