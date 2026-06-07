# Design: CSV → XLSX Export

**Date:** 2026-06-07  
**Status:** Approved  
**Scope:** Replace CSV download with XLSX in historial view

---

## Context

`js/export.js` currently generates a UTF-8 BOM CSV via string concatenation and Blob download.
The app is vanilla JS with no bundler. All scripts loaded via `<script>` in `index.html`.

---

## Goal

Replace the CSV export in `#historial` with an XLSX file download.
Single button, single format — no CSV fallback kept.

---

## Architecture

SheetJS (xlsx.js) loaded from jsDelivr CDN. No npm, no local vendor file.
`export.js` remains a global IIFE module (`exportador`). Only internal implementation changes.

**Public API change:**

| Before | After |
|---|---|
| `exportador.exportCSV(txs)` | `exportador.exportXLSX(txs)` |
| Returns `{ ok, count, fallback }` | Returns `{ ok, count, fallback }` (same shape) |

---

## Files Changed

### `index.html`
Add SheetJS CDN script **before** `export.js`, with `defer` to avoid blocking render:

```html
<script defer src="https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js"></script>
<script defer src="js/export.js"></script>
```

> Note: `export.js` currently has no `defer`. Both scripts must be deferred together so
> `XLSX` global is available when `export.js` initializes. Check that other scripts
> loaded after them are also deferred or placed at end of `<body>`.

### `js/export.js`
Full rewrite of export logic. Keep IIFE structure, `_isoHoy()` helper, `_descargar()` removed
(SheetJS handles download). Add:

```js
function exportXLSX(transacciones) {
  if (typeof XLSX === 'undefined') {
    // SheetJS CDN failed to load
    return { ok: false, count: 0, fallback: false };
  }

  var datos = transacciones || [];
  if (!datos.length) return { ok: false, count: 0, fallback: false };

  // Map to plain objects with Spanish headers
  var filas = datos.map(function (t) {
    return {
      'Fecha':      String(t.fecha).split('T')[0],
      'Tipo':       t.tipo || '',
      'Ámbito':     t.ambito || '',
      'Categoría':  t.categorias ? t.categorias.nombre : '',
      'Monto':      Number(t.monto),          // numeric cell → Excel sums work
      'Nota':       t.nota || ''
    };
  });

  var ws = XLSX.utils.json_to_sheet(filas);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Historial');

  var nombre = 'nestra-historial-' + _isoHoy() + '.xlsx';

  try {
    XLSX.writeFile(wb, nombre);
    return { ok: true, count: datos.length, fallback: false };
  } catch (err) {
    // iOS Safari fallback: base64 data URL
    try {
      var b64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
      var dataUrl = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + b64;
      window.open(dataUrl, '_blank');
      return { ok: true, count: datos.length, fallback: true };
    } catch (err2) {
      return { ok: false, count: 0, fallback: false };
    }
  }
}

return { exportXLSX: exportXLSX };
```

### `views/historial.html`
Two-line change in the export click handler:

```js
// Before
var res = exportador.exportCSV(datosVisibles());
if (!res.ok) { mostrarToast('No hay movimientos para exportar.', ...); }
else if (!res.fallback) { mostrarToast('CSV descargado (' + res.count + ')', ...); }

// After
var res = exportador.exportXLSX(datosVisibles());
if (!res.ok) { mostrarToast('No hay movimientos para exportar.', ...); }
else if (!res.fallback) { mostrarToast('Excel descargado (' + res.count + ' filas)', ...); }
```

Button label in HTML also changes: `Exportar CSV` → `Exportar Excel`.

---

## Data Shape

Columns identical to previous CSV — same source fields, same order:

| Column | Source | Type in XLSX |
|---|---|---|
| Fecha | `t.fecha` split at T | Text (ISO string) |
| Tipo | `t.tipo` | Text |
| Ámbito | `t.ambito` | Text |
| Categoría | `t.categorias.nombre` | Text |
| Monto | `t.monto` | **Number** (not string — enables Excel SUM) |
| Nota | `t.nota` | Text |

Sheet name: `Historial`.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `XLSX` global undefined (CDN failed) | `{ ok: false }` → toast "No hay movimientos para exportar" (reuses existing path) |
| Empty filtered list | `{ ok: false }` → same toast |
| `writeFile` throws (iOS Safari) | Fallback: base64 `data:` URL opened in new tab |
| Both download paths throw | `{ ok: false }` → toast |

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| jsDelivr CDN downtime | Low (99.9% SLA) | `typeof XLSX === 'undefined'` guard |
| `defer` load order broken | Medium if other scripts lack `defer` | Audit script tags in index.html during impl |
| iOS XLSX open (not download) | High on Safari | base64 fallback opens in new tab; acceptable |
| SheetJS version breaking change | Low | Pin to `xlsx@0.18.5` in CDN URL |

---

## Out of Scope

- PDF export
- Keeping CSV as secondary option
- Column formatting (bold headers, column widths) — can be added later with `ws['!cols']`
- Persisting filter state
