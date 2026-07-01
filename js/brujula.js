// Nestra — Brújula (mentor financiero). Funciones puras, sin DOM ni red.
// Testeable con node; las vistas las consumen vía window.* (ver export al final).

// calcularRango(monto, m, categoria) — techo de gasto para una categoría.
// Devuelve { nivel, comodo, tope, razon, sugerido }. Si monto no es > 0,
// nivel='consulta' (solo muestra el rango). Ver contrato en el plan.
function calcularRango(monto, m, categoria) {
  var tieneLimite = categoria.limite_mensual != null;
  var margenCat = tieneLimite ? Math.max(0, m.limite - m.gastoMes) : Infinity;
  var liquidez = Math.max(0, m.ingresos - m.gastos - m.recurrentesPendientes - m.colchonMetas);
  var topeRaw = tieneLimite ? Math.min(margenCat, liquidez) : liquidez;

  var ritmoRapido = false;
  if (tieneLimite && m.limite > 0) {
    var objetivoSemanal = m.limite * 7 / m.diasMes;
    var ritmoSemanal = (m.gastoSemana / Math.max(m.diasSemana, 1)) * 7;
    ritmoRapido = ritmoSemanal > objetivoSemanal;
  }
  var tope = Math.round(topeRaw);
  var comodo = ritmoRapido ? Math.round(topeRaw * 0.7) : tope;

  if (tope <= 0) {
    return { nivel: 'sin-margen', comodo: 0, tope: 0, sugerido: 0,
      razon: 'Este mes no te queda margen en ' + categoria.nombre + '. Revisa tus gastos o espera al próximo ciclo.' };
  }
  if (!(monto > 0)) {
    return { nivel: 'consulta', comodo: comodo, tope: tope, sugerido: tope,
      razon: 'Puedes gastar tranquilo hasta ' + comodo + '; tu tope este mes es ' + tope + '.' };
  }
  if (monto <= comodo) {
    return { nivel: 'recomendable', comodo: comodo, tope: tope, sugerido: tope,
      razon: 'Te alcanza sin apuros en ' + categoria.nombre + '.' };
  }
  if (monto <= tope) {
    return { nivel: 'cautela', comodo: comodo, tope: tope, sugerido: tope,
      razon: 'Cabe, pero ajustado: pasas tu zona cómoda (' + comodo + ').' };
  }
  return { nivel: 'no', comodo: comodo, tope: tope, sugerido: tope,
    razon: 'Superarías tu tope de este mes (' + tope + ').' };
}

// planMeta(monto, tope, hoy) — plan de ahorro para una compra que no cabe.
// Horizonte fijo de 3 meses. Devuelve { faltante, aporteMes, fechaMeta }.
function planMeta(monto, tope, hoy) {
  var MESES_PLAN = 3;
  var faltante = Math.max(0, Math.round(monto - tope));
  var aporteMes = Math.ceil(monto / MESES_PLAN);
  var y = hoy.getFullYear();
  var mIdx = hoy.getMonth() + MESES_PLAN;
  var fecha = new Date(y, mIdx, 1);
  var p = function (n) { return String(n).padStart(2, '0'); };
  var fechaMeta = fecha.getFullYear() + '-' + p(fecha.getMonth() + 1) + '-01';
  return { faltante: faltante, aporteMes: aporteMes, fechaMeta: fechaMeta };
}

// costoOportunidad(monto, categoria, metaCritica) — empujón anti-impulso.
// Solo para categorías NO esenciales (esencial === false explícito) y con meta.
// Devuelve { n, texto } o null.
function costoOportunidad(monto, categoria, metaCritica) {
  if (categoria.esencial !== false) return null;
  if (!metaCritica || !(metaCritica.aporteTipico > 0)) return null;
  var n = Math.max(1, Math.round(monto / metaCritica.aporteTipico));
  return {
    n: n,
    texto: 'Esto equivale a ' + n + ' aporte' + (n === 1 ? '' : 's') +
      ' a ' + metaCritica.nombre + '. ¿Es necesario ahora? Dale 48 h.',
  };
}

if (typeof window !== 'undefined') { window.calcularRango = calcularRango; window.planMeta = planMeta; window.costoOportunidad = costoOportunidad; }

export { calcularRango, planMeta, costoOportunidad };
