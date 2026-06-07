// ─────────────────────────────────────────────────────────────────
// Nestra — export.js
// Exportación de datos a CSV. Módulo global `exportador` (sin import/export,
// igual que db.js/format.js). Nota: el objeto NO puede llamarse `export`
// porque es palabra reservada de JavaScript.
//
// Depende de globales ya cargados:
//   - format.js → formatFecha (no usado aquí; CSV usa ISO crudo)
// ─────────────────────────────────────────────────────────────────

var exportador = (function () {

  // _campo(v) — escapa un valor para CSV: comillas si contiene coma,
  // comilla, salto de línea o retorno. Las comillas internas se duplican.
  function _campo(v) {
    var s = String(v == null ? '' : v);
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // _isoHoy() — fecha de hoy 'YYYY-MM-DD' (hora local) para el nombre de archivo.
  function _isoHoy() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // _descargar(contenido, nombre) — dispara la descarga de un texto como archivo.
  // Fallback iOS Safari (Blob/download flaky): abre data: URL en pestaña nueva.
  // Returns: true si usó la descarga normal, false si cayó al fallback.
  function _descargar(contenido, nombre, mime) {
    try {
      var blob = new Blob([contenido], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return true;
    } catch (err) {
      var data = 'data:' + mime + ',' + encodeURIComponent(contenido);
      window.open(data, '_blank');
      return false;
    }
  }

  // exportCSV(transacciones) — genera y descarga un CSV de las transacciones dadas.
  // Columnas: Fecha, Tipo, Ámbito, Categoría, Monto, Nota.
  //   - Fecha: ISO 'YYYY-MM-DD' (ordenable en Excel).
  //   - Monto: número crudo con 2 decimales y punto (no "S/ ..." ni miles).
  //   - BOM UTF-8 al inicio → Excel abre con tildes correctas.
  // Recibe el array ya filtrado/visible (la vista decide qué exportar).
  // Returns: { ok: bool, count: number, fallback: bool }.
  function exportCSV(transacciones) {
    var datos = transacciones || [];
    if (!datos.length) {
      return { ok: false, count: 0, fallback: false };
    }

    var cols = ['Fecha', 'Tipo', 'Ámbito', 'Categoría', 'Monto', 'Nota'];
    var lineas = [cols.join(',')];

    datos.forEach(function (t) {
      lineas.push([
        _campo(String(t.fecha).split('T')[0]),
        _campo(t.tipo),
        _campo(t.ambito),
        _campo(t.categorias ? t.categorias.nombre : ''),
        _campo(Number(t.monto).toFixed(2)),
        _campo(t.nota || ''),
      ].join(','));
    });

    var contenido = '﻿' + lineas.join('\r\n'); // BOM → Excel UTF-8
    var nombre = 'nestra-historial-' + _isoHoy() + '.csv';
    var ok = _descargar(contenido, nombre, 'text/csv;charset=utf-8;');
    return { ok: true, count: datos.length, fallback: !ok };
  }

  return { exportCSV: exportCSV };
})();
