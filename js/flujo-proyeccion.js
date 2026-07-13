// Nestra — proyección de flujo de caja del mes (función pura, sin red).
// Recorre día-a-día desde hoy hasta fin de mes aplicando recurrentes y
// aportes a metas. Marca el primer día en que el saldo proyectado < 0.

function _p2(n) { return n < 10 ? '0' + n : String(n); }
function _iso(anio, mes1, dia) { return anio + '-' + _p2(mes1) + '-' + _p2(dia); }

// ¿una recurrente cae el día `dia` del mes (>= díaActual ya filtrado por el caller)?
function _caeEnDia(rec, dia) {
  var base = Number(rec.dia_cargo) || 1;
  var f = rec.frecuencia || 'mensual';
  if (f === 'mensual') return dia === base;
  if (f === 'quincenal') return dia === base || dia === base + 15;
  if (f === 'semanal') return dia >= base && (dia - base) % 7 === 0;
  return dia === base;
}

function proyectarFlujo(opts) {
  opts = opts || {};
  var saldo = Number(opts.saldoInicial) || 0;
  var hoy = opts.hoy instanceof Date ? opts.hoy : new Date();
  var recurrentes = (opts.recurrentes || []).filter(function (r) { return r && r.activo !== false; });
  var aportes = opts.aportesMeta || [];

  var anio = hoy.getFullYear();
  var mes1 = hoy.getMonth() + 1;             // 1-based
  var diaHoy = hoy.getDate();
  var ultimoDia = new Date(anio, mes1, 0).getDate(); // día 0 del mes siguiente = último de éste

  var dias = [];
  var primerDiaNegativo = null;

  for (var dia = diaHoy; dia <= ultimoDia; dia++) {
    recurrentes.forEach(function (r) {
      if (!_caeEnDia(r, dia)) return;
      var m = Number(r.monto) || 0;
      saldo += (r.tipo === 'ingreso' ? m : -m);
    });
    aportes.forEach(function (a) {
      if (Number(a.dia) === dia) saldo -= (Number(a.monto) || 0);
    });

    saldo = Math.round(saldo * 100) / 100;
    var fecha = _iso(anio, mes1, dia);
    dias.push({ fecha: fecha, saldo: saldo });
    if (saldo < 0 && primerDiaNegativo === null) primerDiaNegativo = fecha;
  }

  return { dias: dias, primerDiaNegativo: primerDiaNegativo, saldoFinal: saldo };
}

if (typeof window !== 'undefined') window.proyectarFlujo = proyectarFlujo;

export { proyectarFlujo };
