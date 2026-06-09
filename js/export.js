// ─────────────────────────────────────────────────────────────────
// Nestra — export.js
// Módulo global `exportador` (sin import/export, igual que db.js).
//
// API pública:
//   exportXLSX(transacciones)   → descarga .xlsx  (Excel, vía SheetJS)
//   exportPDF(resumenMensual)   → window.print() con encabezado limpio
//   exportJSON()                → async; respaldo completo de la cuenta
//
// Dependencias (globales cargadas en index.html):
//   - XLSX (SheetJS, CDN)                          → exportXLSX
//   - db.js: getTransacciones, getCategorias,      → exportJSON
//            getMetas, getPrestamos, getDesafios,
//            getProfiles, getAllAportesMeta
// ─────────────────────────────────────────────────────────────────

var exportador = (function () {

  var _MESES = ['enero','febrero','marzo','abril','mayo','junio',
                'julio','agosto','septiembre','octubre','noviembre','diciembre'];

  var _MESES_CAP = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  // _mesAnio() — 'mes-año' (ej. 'junio-2026') para nombre de archivo XLSX.
  function _mesAnio() {
    var d = new Date();
    return _MESES[d.getMonth()] + '-' + d.getFullYear();
  }

  // _fechaIso() — 'YYYY-MM-DD' local para nombre de archivo.
  function _fechaIso() {
    var d   = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // _descargar(nombre, texto, mime) — fuerza descarga de un blob de texto.
  // Returns: true en éxito, false si el navegador falla.
  function _descargar(nombre, texto, mime) {
    try {
      var blob = new Blob([texto], { type: mime });
      var url  = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href     = url;
      link.download = nombre;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return true;
    } catch (err) {
      return false;
    }
  }

  // _safe(fn, arg) — invoca un getter de db.js de forma tolerante.
  // Si la función no existe o lanza/rechaza, resuelve a [] en vez de romper
  // todo el respaldo. Returns: Promise que siempre resuelve.
  function _safe(fn, arg) {
    if (typeof fn !== 'function') return Promise.resolve([]);
    try {
      return Promise.resolve(fn(arg)).catch(function () { return []; });
    } catch (err) {
      return Promise.resolve([]);
    }
  }

  // ───────────────────────────────────────────────────────────────
  // exportXLSX(transacciones)  — SIN CAMBIOS desde la versión inicial.
  // Genera y descarga un .xlsx de las transacciones dadas.
  // Columnas: Fecha, Tipo, Ámbito, Categoría, Monto, Nota.
  //   - Fecha: ISO 'YYYY-MM-DD'.
  //   - Monto: número crudo (celda numérica → Excel suma).
  // Recibe el array ya filtrado/visible (la vista decide qué exportar).
  // Returns:
  //   éxito → { ok: true, count: number }
  //   fallo → { ok: false, count: 0, reason: 'sin-libreria'|'sin-datos'|'descarga-fallo' }
  // ───────────────────────────────────────────────────────────────
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

  // ───────────────────────────────────────────────────────────────
  // exportPDF(resumenMensual) — imprime la vista vía window.print().
  //
  // No reconstruye el contenido: imprime el DOM vivo del resumen mensual
  // (KPIs + tabla de categorías ya renderizados). Lo que añade:
  //   1. Encabezado de impresión "Nestra — Resumen [Mes Año]".
  //   2. Estilo @media print que oculta nav, botones y FAB; muestra el
  //      encabezado y fuerza la tabla de categorías (no las tarjetas).
  // Ambos se inyectan temporalmente y se limpian tras imprimir.
  //
  // resumenMensual: { mes:1-12, anio:YYYY } — solo para el rótulo.
  //   Si se omite, usa el mes/año actual.
  // Returns: undefined (el navegador maneja el diálogo de impresión).
  // ───────────────────────────────────────────────────────────────
  function exportPDF(resumenMensual) {
    var info = resumenMensual || {};
    var hoy  = new Date();
    var mes  = info.mes  || (hoy.getMonth() + 1);
    var anio = info.anio || hoy.getFullYear();
    var titulo = 'Nestra — Resumen ' + (_MESES_CAP[mes - 1] || '') + ' ' + anio;

    // Estilo de impresión inyectado (scoped al momento de imprimir).
    var style = document.createElement('style');
    style.id = 'nestra-print-style';
    style.textContent =
      '.nestra-print-header { display: none; }' +
      '@media print {' +
        'nav, .fab, .res-export, .resumen-export, .res-nav-mes,' +
        '.res-toast, [data-export-hide] { display: none !important; }' +
        '.nestra-print-header { display: block !important; }' +
        '.res-cat-lista { display: none !important; }' +
        '.res-cat-tabla-wrap { display: block !important; }' +
        '@page { margin: 1.5cm; }' +
      '}';

    // Encabezado: solo visible en impresión.
    var header = document.createElement('div');
    header.className = 'nestra-print-header';
    header.textContent = titulo;
    header.style.cssText =
      'font-size:18px;font-weight:700;margin:0 0 16px;padding-bottom:8px;' +
      'border-bottom:2px solid #059669;color:#111827;';

    document.head.appendChild(style);
    document.body.insertBefore(header, document.body.firstChild);

    var limpiado = false;
    function cleanup() {
      if (limpiado) return;
      limpiado = true;
      if (style.parentNode)  style.parentNode.removeChild(style);
      if (header.parentNode) header.parentNode.removeChild(header);
      window.removeEventListener('afterprint', cleanup);
    }

    window.addEventListener('afterprint', cleanup);
    window.print();
    // Fallback: algunos navegadores no emiten 'afterprint'.
    setTimeout(cleanup, 1500);
  }

  // ───────────────────────────────────────────────────────────────
  // exportJSON() — async. Respaldo completo y restaurable de la cuenta.
  //
  // Lee todas las tablas visibles del usuario (RLS limita a hogar +
  // datos propios) y descarga un único JSON con una clave por tabla.
  //   transacciones | categorias | metas | prestamos | desafios |
  //   perfiles | aportes_meta
  // Más metadata: { version:'1.0', exportado:ISO }.
  //
  // Nombre: nestra-respaldo-YYYY-MM-DD.json
  // Returns (Promise):
  //   { ok: true }
  //   { ok: false, reason: 'descarga-fallo' }
  // ───────────────────────────────────────────────────────────────
  async function exportJSON() {
    try {
      var res = await Promise.all([
        _safe(typeof getTransacciones  === 'function' ? getTransacciones  : null, {}),
        _safe(typeof getCategorias     === 'function' ? getCategorias     : null),
        _safe(typeof getMetas          === 'function' ? getMetas          : null),
        _safe(typeof getPrestamos      === 'function' ? getPrestamos      : null),
        _safe(typeof getDesafios       === 'function' ? getDesafios       : null),
        _safe(typeof getProfiles       === 'function' ? getProfiles       : null),
        _safe(typeof getAllAportesMeta === 'function' ? getAllAportesMeta : null),
      ]);

      var datos = {
        _meta: {
          app:       'Nestra',
          version:   '1.0',
          exportado: new Date().toISOString(),
        },
        transacciones: res[0],
        categorias:    res[1],
        metas:         res[2],
        prestamos:     res[3],
        desafios:      res[4],
        perfiles:      res[5],
        aportes_meta:  res[6],
      };

      var ok = _descargar(
        'nestra-respaldo-' + _fechaIso() + '.json',
        JSON.stringify(datos, null, 2),
        'application/json'
      );

      return ok ? { ok: true } : { ok: false, reason: 'descarga-fallo' };
    } catch (err) {
      console.error('Error en exportJSON():', err.message || err);
      return { ok: false, reason: 'descarga-fallo' };
    }
  }

  return {
    exportXLSX: exportXLSX,
    exportPDF:  exportPDF,
    exportJSON: exportJSON,
  };
})();
