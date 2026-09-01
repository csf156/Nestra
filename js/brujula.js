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
    // Distinguir "no hay dato" de "te lo gastaste". Sin ingreso registrado ni
    // respaldo del mes anterior, la liquidez sale 0 por falta de información,
    // no por exceso de gasto: decirle "no te queda margen" el día 1 del mes es
    // un número falso (bug reportado el 2026-09-01).
    if (!(m.ingresos > 0)) {
      return { nivel: 'sin-datos', comodo: 0, tope: 0, sugerido: 0,
        razon: 'Todavía no registras ingresos este mes, así que no puedo calcular tu margen. Anota tu ingreso y vuelve a preguntar.' };
    }
    return { nivel: 'sin-margen', comodo: 0, tope: 0, sugerido: 0,
      razon: 'Este mes no te queda margen en ' + categoria.nombre + '. Revisa tus gastos o espera al próximo ciclo.' };
  }
  // Cuando el margen se apoya en el ingreso del mes pasado (aún no hay ingreso
  // este mes), decirlo: el número es utilizable pero no es un hecho.
  var nota = m.ingresoEstimado ? ' Es un estimado con tu ingreso del mes pasado.' : '';
  if (!(monto > 0)) {
    return { nivel: 'consulta', comodo: comodo, tope: tope, sugerido: tope,
      razon: 'Puedes gastar tranquilo hasta ' + comodo + '; tu tope este mes es ' + tope + '.' + nota };
  }
  if (monto <= comodo) {
    return { nivel: 'recomendable', comodo: comodo, tope: tope, sugerido: tope,
      razon: 'Te alcanza sin apuros en ' + categoria.nombre + '.' + nota };
  }
  if (monto <= tope) {
    return { nivel: 'cautela', comodo: comodo, tope: tope, sugerido: tope,
      razon: 'Cabe, pero ajustado: pasas tu zona cómoda (' + comodo + ').' + nota };
  }
  return { nivel: 'no', comodo: comodo, tope: tope, sugerido: tope,
    razon: 'Superarías tu tope de este mes (' + tope + ').' + nota };
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

// sugerirMicroahorro(metas, liquidezMes, hoy) — nudge de ahorro para el dashboard.
// Elige la meta en curso más cercana a su fecha límite. Sugiere 10% de la
// liquidez sin pasar del faltante. Devuelve { meta_id, meta, sugerido, texto } o null.
function sugerirMicroahorro(metas, liquidezMes, hoy) {
  if (!(liquidezMes > 0)) return null;
  var enCurso = (metas || []).filter(function (m) {
    return m.estado === 'en_curso' && Number(m.monto_actual) < Number(m.monto_objetivo);
  });
  if (!enCurso.length) return null;
  enCurso.sort(function (a, b) {
    var fa = a.fecha_limite || '9999-12-31';
    var fb = b.fecha_limite || '9999-12-31';
    return fa < fb ? -1 : fa > fb ? 1 : 0;
  });
  var meta = enCurso[0];
  var faltante = Number(meta.monto_objetivo) - Number(meta.monto_actual);
  var sugerido = Math.min(Math.round(liquidezMes * 0.1), Math.round(faltante));
  if (sugerido <= 0) return null;
  return {
    meta_id: meta.id, meta: meta.nombre, sugerido: sugerido,
    texto: 'Aparta ' + sugerido + ' y te acercas a ' + meta.nombre + '.',
  };
}

if (typeof window !== 'undefined') { window.calcularRango = calcularRango; window.planMeta = planMeta; window.costoOportunidad = costoOportunidad; window.sugerirMicroahorro = sugerirMicroahorro; }

export { calcularRango, planMeta, costoOportunidad, sugerirMicroahorro };
