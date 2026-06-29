// Nestra — detección de transacciones recurrentes (función pura, sin red).
// Agrupa por (categoria_id, monto ±tolerancia) y marca como candidato
// mensual los grupos con ≥2 ocurrencias separadas ~25–35 días.

function _diasEntre(aISO, bISO) {
  var a = new Date(aISO + 'T00:00:00');
  var b = new Date(bISO + 'T00:00:00');
  return Math.abs(Math.round((b - a) / 86400000));
}

function _tolerancia(monto) { return Math.max(2, monto * 0.05); }

// ¿el monto cae dentro de la tolerancia del centro del grupo?
function _coincide(monto, centro) { return Math.abs(monto - centro) <= _tolerancia(centro); }

function detectarRecurrentes(txs, existentes, hoy) {
  var lista = (txs || []).filter(function (t) {
    return t && t.categoria_id && Number(t.monto) > 0 && t.fecha;
  });
  existentes = existentes || [];

  // Agrupar por categoría, luego por cercanía de monto.
  var porCat = {};
  lista.forEach(function (t) {
    (porCat[t.categoria_id] = porCat[t.categoria_id] || []).push(t);
  });

  var candidatos = [];
  Object.keys(porCat).forEach(function (catId) {
    var items = porCat[catId].slice().sort(function (a, b) {
      return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0;
    });
    var usados = new Array(items.length).fill(false);

    for (var i = 0; i < items.length; i++) {
      if (usados[i]) continue;
      var grupo = [items[i]];
      usados[i] = true;
      var centro = Number(items[i].monto);
      for (var j = i + 1; j < items.length; j++) {
        if (!usados[j] && _coincide(Number(items[j].monto), centro)) {
          grupo.push(items[j]);
          usados[j] = true;
        }
      }
      if (grupo.length < 2) continue;

      // Validar cadencia mensual: separaciones consecutivas en 25–35 días.
      var mensual = true;
      for (var k = 1; k < grupo.length; k++) {
        var d = _diasEntre(grupo[k - 1].fecha, grupo[k].fecha);
        if (d < 25 || d > 35) { mensual = false; break; }
      }
      if (!mensual) continue;

      var montoProm = grupo.reduce(function (s, g) { return s + Number(g.monto); }, 0) / grupo.length;
      montoProm = Math.round(montoProm * 100) / 100;

      // Excluir si ya existe un recurrente equivalente.
      var yaExiste = existentes.some(function (e) {
        return e.categoria_id === catId && _coincide(montoProm, Number(e.monto));
      });
      if (yaExiste) continue;

      var ultima = grupo[grupo.length - 1];
      var prox = new Date(ultima.fecha + 'T00:00:00');
      prox.setMonth(prox.getMonth() + 1);
      var diaCargo = prox.getDate();

      candidatos.push({
        descripcion: (ultima.nota || '').trim() || 'Recurrente',
        monto: montoProm,
        tipo: ultima.tipo === 'ingreso' ? 'ingreso' : 'gasto',
        categoria_id: catId,
        frecuencia: 'mensual',
        dia_cargo: diaCargo,
        proximo_cargo: prox.toISOString().slice(0, 10),
        ocurrencias: grupo.length,
      });
    }
  });

  return candidatos;
}

if (typeof window !== 'undefined') window.detectarRecurrentes = detectarRecurrentes;

export { detectarRecurrentes };
