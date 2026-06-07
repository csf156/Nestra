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
        'Monto':     Number(t.monto),
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

  return { exportXLSX: exportXLSX };
})();
