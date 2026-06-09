// ─────────────────────────────────────────────────────────────────
// Nestra — export.js
// Exportación de datos a XLSX (Excel) vía SheetJS. Módulo global
// `exportador` (sin import/export, igual que db.js/format.js).
//
// Depende de globales ya cargados:
//   - XLSX (SheetJS, desde CDN en index.html)
// ─────────────────────────────────────────────────────────────────

var exportador = (function () {

  var _MESES = ['enero','febrero','marzo','abril','mayo','junio',
                'julio','agosto','septiembre','octubre','noviembre','diciembre'];

  // _mesAnio() — 'mes-año' en español (ej. 'junio-2026') para el nombre de archivo.
  function _mesAnio() {
    var d = new Date();
    return _MESES[d.getMonth()] + '-' + d.getFullYear();
  }

  // exportXLSX(transacciones) — genera y descarga un .xlsx de las transacciones dadas.
  // Columnas: Fecha, Tipo, Ámbito, Categoría, Monto, Nota.
  //   - Fecha: ISO 'YYYY-MM-DD'.
  //   - Monto: número crudo (celda numérica → Excel suma).
  // Recibe el array ya filtrado/visible (la vista decide qué exportar).
  // Returns:
  //   éxito → { ok: true, count: number }
  //   fallo → { ok: false, count: 0, reason: 'sin-libreria'|'sin-datos'|'descarga-fallo' }
  function exportXLSX(transacciones) {
    if (typeof XLSX === 'undefined') {
      return { ok: false, count: 0, reason: 'sin-libreria' };
    }

    var datos = transacciones || [];
    if (!datos.length) {
      return { ok: false, count: 0, reason: 'sin-datos' };
    }

    var filas = datos.map(function (t) {
      return {
        'Fecha':     String(t.fecha).split('T')[0],
        'Tipo':      t.tipo || '',
        'Ámbito':    t.ambito || '',
        'Categoría': t.categorias ? t.categorias.nombre : '',
        'Monto':     Number(t.monto) || 0,
        'Nota':      t.nota || ''
      };
    });

    var ws = XLSX.utils.json_to_sheet(filas);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Historial');

    var nombre = 'nestra-historial-' + _mesAnio() + '.xlsx';

    try {
      XLSX.writeFile(wb, nombre);
      return { ok: true, count: datos.length };
    } catch (err) {
      return { ok: false, count: 0, reason: 'descarga-fallo' };
    }
  }

  // exportPDF() — abre diálogo de impresión del navegador.
  // views/resumen.html incluye @media print CSS para layout limpio.
  // Returns: undefined (el navegador maneja el flujo).
  function exportPDF() {
    window.print();
  }

  // exportJSON(datos) — genera y descarga un archivo .json con el respaldo completo.
  // datos: objeto { transacciones, categorias, metas, perfiles, ... }
  // Returns: { ok: true } | { ok: false, reason: 'sin-datos'|'descarga-fallo' }
  function exportJSON(datos) {
    if (!datos || Object.keys(datos).length === 0) {
      return { ok: false, reason: 'sin-datos' };
    }
    try {
      var json   = JSON.stringify(datos, null, 2);
      var blob   = new Blob([json], { type: 'application/json' });
      var url    = URL.createObjectURL(blob);
      var link   = document.createElement('a');
      var hoy    = new Date();
      var pad    = function (n) { return n < 10 ? '0' + n : String(n); };
      var nombre = 'nestra-respaldo-' +
                   hoy.getFullYear() + '-' + pad(hoy.getMonth() + 1) + '-' + pad(hoy.getDate()) +
                   '.json';
      link.href     = url;
      link.download = nombre;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'descarga-fallo' };
    }
  }

  return { exportXLSX: exportXLSX, exportPDF: exportPDF, exportJSON: exportJSON };
})();
