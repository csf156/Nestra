# XLSX Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CSV download in the historial view with an XLSX (Excel) file download via SheetJS.

**Architecture:** SheetJS loaded from jsDelivr CDN (classic `<script>`, no defer — matches existing Supabase CDN pattern). `js/export.js` keeps its `exportador` IIFE shape but swaps CSV string-building for `XLSX.utils.json_to_sheet` + `XLSX.writeFile`. The historial view updates its call site, toasts, and button labels.

**Tech Stack:** Vanilla JS (no bundler, no test framework), SheetJS `xlsx@0.18.5`, manual browser verification via preview tools.

**Testing note:** This project has no automated test framework. Each task ends with a manual verification step using the preview tools (preview_console_logs / preview_eval) plus a commit. The exact reference spec is `docs/superpowers/specs/2026-06-07-export-xlsx-design.md`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `index.html` | Script loading | Add one SheetJS CDN `<script>` line before `js/export.js` |
| `js/export.js` | Export module (`exportador`) | Rewrite: CSV → XLSX. Rename method `exportCSV` → `exportXLSX`. Return `reason` codes on failure |
| `views/historial.html` | Historial view | Update call site (line 1113), toast branches (1114-1119), static label (93), dynamic label (776) |

---

### Task 1: Load SheetJS from CDN

**Files:**
- Modify: `index.html:82` (insert before `<script src="js/export.js"></script>`)

- [ ] **Step 1: Add the CDN script tag**

In `index.html`, locate the application scripts block (lines 78-85). Insert the SheetJS CDN line immediately before `js/export.js`:

```html
    <script src="js/format.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
    <script src="js/export.js"></script>
    <script src="js/db.js"></script>
```

- [ ] **Step 2: Verify XLSX global loads**

Start the preview server (preview_start) if not running, load the app, then run via preview_eval:

```js
typeof XLSX
```

Expected: `"object"` (not `"undefined"`).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "build: load SheetJS (xlsx@0.18.5) from CDN"
```

---

### Task 2: Rewrite export.js — CSV to XLSX

**Files:**
- Modify: `js/export.js` (full rewrite of export logic; keep IIFE + `_isoHoy`, drop `_campo` and `_descargar`)

- [ ] **Step 1: Replace the module body**

Overwrite `js/export.js` with:

```js
// ─────────────────────────────────────────────────────────────────
// Nestra — export.js
// Exportación de datos a XLSX (Excel) vía SheetJS. Módulo global
// `exportador` (sin import/export, igual que db.js/format.js).
//
// Depende de globales ya cargados:
//   - XLSX (SheetJS, desde CDN en index.html)
// ─────────────────────────────────────────────────────────────────

var exportador = (function () {

  // _isoHoy() — fecha de hoy 'YYYY-MM-DD' (hora local) para el nombre de archivo.
  function _isoHoy() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // exportXLSX(transacciones) — genera y descarga un .xlsx de las transacciones dadas.
  // Columnas: Fecha, Tipo, Ámbito, Categoría, Monto, Nota.
  //   - Fecha: ISO 'YYYY-MM-DD'.
  //   - Monto: número crudo (celda numérica → Excel suma).
  // Recibe el array ya filtrado/visible (la vista decide qué exportar).
  // Returns:
  //   éxito → { ok: true, count: number, fallback: bool }
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

    var nombre = 'nestra-historial-' + _isoHoy() + '.xlsx';

    try {
      XLSX.writeFile(wb, nombre);
      return { ok: true, count: datos.length, fallback: false };
    } catch (err) {
      // Fallback iOS Safari: base64 data URL en pestaña nueva.
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
})();
```

- [ ] **Step 2: Verify the module exposes exportXLSX**

Reload the app, then via preview_eval:

```js
typeof exportador.exportXLSX
```

Expected: `"function"`. Also confirm `typeof exportador.exportCSV` is now `"undefined"` (old method gone).

- [ ] **Step 3: Smoke-test export with a stub row**

Via preview_eval:

```js
exportador.exportXLSX([{ fecha: '2026-06-01T00:00:00', tipo: 'gasto', ambito: 'hogar', categorias: { nombre: 'Comida' }, monto: 12.5, nota: 'prueba' }])
```

Expected: returns `{ ok: true, count: 1, fallback: false }` and triggers a file download (`nestra-historial-<hoy>.xlsx`). Check preview_console_logs for zero errors.

- [ ] **Step 4: Commit**

```bash
git add js/export.js
git commit -m "feat(export): replace CSV with XLSX via SheetJS"
```

---

### Task 3: Wire historial view to XLSX

**Files:**
- Modify: `views/historial.html:93` (static button label)
- Modify: `views/historial.html:776` (dynamic button label)
- Modify: `views/historial.html:1111-1120` (call site + toast branches)

- [ ] **Step 1: Update the static button label (line 93)**

```html
<button type="button" class="btn btn-primary btn-small" id="histExport">Exportar Excel</button>
```

- [ ] **Step 2: Update the dynamic button label (line 776)**

```js
$('histExport').textContent = 'Exportar Excel (' + datos.length + ')';
```

- [ ] **Step 3: Update the call site and toast branches (lines 1111-1120)**

Replace the existing block:

```js
    // ── Export XLSX (delega en el módulo exportador) ──────────
    $('histExport').addEventListener('click', function () {
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
    });
```

- [ ] **Step 4: Verify end-to-end in the browser**

Reload the app, navigate to `#historial` (sign in or use existing stub flow). Confirm via preview_snapshot the button reads "Exportar Excel (N)". Click it via preview_click on `#histExport`, then check preview_console_logs for zero errors and confirm a download or success toast "Excel descargado (N filas)".

- [ ] **Step 5: Verify the empty-state toast**

If a filter yields zero rows, the button still fires `sin-datos`. Via preview_eval simulate:

```js
exportador.exportXLSX([])
```

Expected: `{ ok: false, count: 0, reason: 'sin-datos' }`.

- [ ] **Step 6: Commit**

```bash
git add views/historial.html
git commit -m "feat(historial): export to Excel instead of CSV"
```

---

### Task 4: Final sweep — no stale CSV references

**Files:**
- Verify only (no guaranteed edits)

- [ ] **Step 1: Grep for leftover CSV references**

Run a content search for `exportCSV`, `CSV`, and `text/csv` across the repo (excluding the spec/plan docs). Expected: zero hits in `js/`, `views/`, `index.html`. If any remain, fix them inline and re-commit.

- [ ] **Step 2: Confirm the spec's "Files Changed" matches reality**

Three files touched: `index.html`, `js/export.js`, `views/historial.html`. No others.

- [ ] **Step 3: Final commit if step 1 found anything**

```bash
git add -A
git commit -m "chore: remove stale CSV references"
```

---

## Self-Review

**Spec coverage:**
- CDN load (spec "index.html") → Task 1 ✅
- export.js rewrite with `reason` codes (spec "js/export.js") → Task 2 ✅
- Call site + toast + label (spec "views/historial.html") → Task 3 ✅ (plus dynamic label at line 776 and static label at 93 — both caught beyond the spec's prose)
- Error handling table (`sin-libreria`/`sin-datos`/`descarga-fallo`) → Tasks 2 & 3 ✅
- iOS base64 fallback → Task 2 Step 1 ✅
- Numeric Monto cell → Task 2 Step 1 (`Number(t.monto)`) ✅

**Placeholder scan:** No TBD/TODO/placeholder steps. All code blocks are complete.

**Type consistency:** Method name `exportXLSX` consistent across Tasks 2 and 3. Return shape `{ ok, count, fallback }` / `{ ok, count, reason }` consistent between export.js (Task 2) and the toast logic (Task 3). `reason` values match the spec's error-handling table exactly.

**Note on line numbers:** Lines 776, 1111-1120 may drift if earlier edits change file length. Tasks are ordered so historial.html (Task 3) is edited in one pass; locate by content (`$('histExport')`, the export click handler) rather than trusting absolute line numbers.
