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
| Returns `{ ok, count, fallback }` | Returns `{ ok, count, fallback }` on success; `{ ok:false, count:0, reason }` on failure |

`reason` ∈ `'sin-libreria'` (CDN failed) \| `'sin-datos'` (empty list) \| `'descarga-fallo'` (both download paths threw).

---

## Files Changed

### `index.html`
Add one plain SheetJS CDN `<script>` line, matching the existing Supabase CDN pattern
(line 75 — classic script, no `defer`). Place it among the application scripts, e.g. right
before `js/export.js`:

```html
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<script src="js/export.js"></script>
```

> Why no `defer`: `export.js` does NOT reference `XLSX` at load time — it only defines the
> `exportador` IIFE. `XLSX` is touched lazily inside `exportXLSX()`, which runs on the export
> button click, long after page + CDN have loaded. So script order relative to `export.js` is
> irrelevant, and `defer` would only diverge from the project's existing classic-script
> convention. The `typeof XLSX === 'undefined'` guard covers the rare not-yet-loaded case.

### `js/export.js`
Full rewrite of export logic. Keep IIFE structure, `_isoHoy()` helper, `_descargar()` removed
(SheetJS handles download). Add:

```js
function exportXLSX(transacciones) {
  if (typeof XLSX === 'undefined') {
    // SheetJS CDN failed to load — distinct reason from "no data"
    return { ok: false, count: 0, reason: 'sin-libreria' };
  }

  var datos = transacciones || [];
  if (!datos.length) return { ok: false, count: 0, reason: 'sin-datos' };

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
      return { ok: false, count: 0, reason: 'descarga-fallo' };
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
if (!res.ok) {
  var msg = res.reason === 'sin-libreria'
    ? 'No se pudo cargar el exportador. Revisa tu conexión.'
    : res.reason === 'descarga-fallo'
      ? 'No se pudo generar el archivo.'
      : 'No hay movimientos para exportar.';
  mostrarToast(msg, null, null, 3000);
} else if (!res.fallback) {
  mostrarToast('Excel descargado (' + res.count + ' filas)', null, null, 3000);
}
// fallback (iOS): se abrió en pestaña nueva, sin toast.
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

| Scenario | `reason` | Toast |
|---|---|---|
| `XLSX` global undefined (CDN failed) | `sin-libreria` | "No se pudo cargar el exportador. Revisa tu conexión." |
| Empty filtered list | `sin-datos` | "No hay movimientos para exportar." |
| `writeFile` throws (iOS Safari) | — | Fallback: base64 `data:` URL in new tab (no toast) |
| Both download paths throw | `descarga-fallo` | "No se pudo generar el archivo." |

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| jsDelivr CDN downtime | Low (99.9% SLA) | `typeof XLSX === 'undefined'` guard → `sin-libreria` toast |
| iOS XLSX open (not download) | High on Safari | base64 fallback opens in new tab; acceptable |
| SheetJS version breaking change | Low | Pin to `xlsx@0.18.5` in CDN URL |

---

## Out of Scope

- PDF export
- Keeping CSV as secondary option
- Column formatting (bold headers, column widths) — can be added later with `ws['!cols']`
- Persisting filter state
