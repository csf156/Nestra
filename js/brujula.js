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

if (typeof window !== 'undefined') window.calcularRango = calcularRango;

export { calcularRango };
