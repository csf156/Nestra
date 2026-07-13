# Prompt "concepto nuevo" + selector de categoría con buscador (diseño)

Fecha: 2026-06-28
Estado: aprobado (brainstorming) → pendiente plan de implementación

## Objetivo

Dos mejoras a la captura por quick-add, sin tocar el matching por tokens:

1. **Prompt "concepto nuevo".** Cuando el matcher NO infiere categoría para un gasto/ingreso
   del quick-add, en vez de abrir el formulario completo, mostrar un panel (estilo
   confirmación) que diga *"«<descripción>» es nuevo para mí. ¿A qué categoría lo agrego?"*
   con un selector de categoría; al elegir, guarda la transacción y **aprende por token**.
2. **Selector de categoría con buscador** (typeahead en tiempo real): un combobox que filtra
   las categorías según se escribe, reusable; aplicado al panel "concepto nuevo", a "editar
   categoría" y al `<select>` de categoría del **formulario clásico**.

Offline-first, vanilla, sin AI. El matcher (`js/autocat.js`) NO cambia.

## Contexto actual

- Quick-add vive en `views/transaccion.html`. `_quickAgregar()`: si gasto/ingreso sin
  `categoria_id` → hoy hace `_prefillForm(r); _modoForm()` (abre el form completo). Esto se
  reemplaza por el prompt "concepto nuevo".
- Confirmación `#txQuickConfirm` + "editar categoría" (`#txQuickEditSelect`) ya existen.
- Form clásico: `<select id="categoria">` poblado por `cargarCategorias(tipo)`; su evento
  `change` maneja `__nueva__` ("+ Nueva categoría") y la detección de préstamo
  (`CAT_PRESTAMO = 'Dinero que prestamos'` vía `categoriaEl.selectedOptions[0].text`).
- `getCategorias(tipo)` devuelve `[{id, nombre, icono, ...}]`. `insertTransaccion`,
  `updateTransaccion`, `autocatLearnTokens`, `tokenize`, `parseQuickAdd` son globales.
- Estado del panel: `_quickTokens`, `_quickTxId`, `_quickTipo` (ya existen).

## Decisiones (brainstorming)

- NO modificar el matching por tokens.
- "Concepto nuevo" reemplaza el caer-al-form en el caso sin-categoría; tras elegir, guarda
  directo + aprende + muestra la confirmación normal (Deshacer / Editar categoría).
- Buscador = combobox vanilla que **envuelve el `<select>` nativo** (lo mantiene como fuente
  de verdad: setea `value` + dispara `change`) → la lógica existente sigue intacta.
- Filtro en tiempo real (evento `input`), sin botones ni teclas.
- Se aplica solo en `transaccion.html` (las 3 selecciones de categoría ahí). No en
  configuración (YAGNI).

---

## PARTE A — Selector de categoría con buscador (`js/searchable-select.js`)

### A.1 Función pura (TDD)
`filterOptions(opciones, query)` → subconjunto que coincide.
- `opciones`: `[{ value, text }]`.
- normaliza query y cada `text` (reusar `normalizeDesc` de autocat.js: lowercase, sin tildes),
  match por **substring** (incluye). query vacío → todas.
- conserva el orden original.
- las opciones especiales (value `''` placeholder, `'__nueva__'`) las maneja el wiring, NO
  `filterOptions` (recibe solo opciones reales). El placeholder se excluye antes de pasar.

### A.2 Componente (wiring DOM)
`searchableSelect(nativeSelect, opts)`:
- Oculta `nativeSelect` (no lo elimina — sigue siendo la fuente de verdad).
- Inserta un wrapper con: `<input type="text" role="combobox">` + `<ul role="listbox">`.
- Al **foco**/click del input: abre la lista con todas las opciones reales del select.
- Al **escribir** (`input`): `filterOptions(opcionesActuales, input.value)` → re-renderiza `<li>`s.
  Lee las opciones del `nativeSelect` EN VIVO cada vez (soporta listas que se recargan, p.ej.
  `cargarCategorias` reconstruye el select al cambiar de tipo).
- `opts.specialItems` (opcional): items fijos al final, p.ej. `[{ value:'__nueva__', text:'+ Nueva categoría' }]` para el form clásico; siempre visibles (no se filtran).
- Al **elegir** un `<li>` (click o Enter): `nativeSelect.value = value`; `input.value = text`
  (vacío para `__nueva__`); `nativeSelect.dispatchEvent(new Event('change'))`; cierra la lista.
- Teclado: ↑/↓ mueven resaltado, Enter elige, Esc cierra. Click fuera cierra.
- Si el `nativeSelect.value` cambia por código (p.ej. autocat prefill / prellenado), exponer
  `wrapper.sync()` para reflejar el texto en el input; llamarlo tras cambios programáticos.
- Idempotente: no envolver dos veces el mismo select (marcar con `dataset`).

Carga: `<script>` clásico en `index.html` (global `window.searchableSelect`, `window.filterOptions`)
+ ESM export para tests. Precache en `sw.js` + bump `SHELL_VERSION`.

### A.3 Tests (TDD)
`test/searchable-select.test.mjs`:
- `filterOptions([{value:'1',text:'Comida'},{value:'2',text:'Transporte'}], 'tra')` → `[{Transporte}]`.
- match sin tildes: query `'cafe'` matchea `text:'Café'`.
- substring en medio: `'porte'` → Transporte.
- query vacío → todas, orden preservado.
- sin coincidencias → `[]`.

---

## PARTE B — Prompt "concepto nuevo" en quick-add (`views/transaccion.html`)

### B.1 Markup
Nuevo panel hermano del confirm, oculto por defecto:
```html
<div id="txQuickAsk" class="tx-quick-confirm" style="display:none;" aria-live="polite">
  <p id="txQuickAskMsg" class="tx-quick-confirm-msg"></p>
  <div class="tx-quick-ask-cat">
    <select id="txQuickAskSelect"></select>
  </div>
  <div class="tx-quick-confirm-actions">
    <button type="button" id="txQuickAskSave" class="btn btn-primary btn-sm">Guardar</button>
    <button type="button" id="txQuickAskMas" class="btn btn-secondary btn-sm">Más opciones</button>
  </div>
</div>
```

### B.2 Comportamiento
- En `_quickAgregar`, reemplazar el bloque actual sin-categoría:
  ```js
  if (r.tipo !== 'ahorro' && !r.categoria_id) {
    _prefillForm(r); _modoForm();
    document.getElementById('categoriaGroup').classList.add('tx-cat-needed');
    return;
  }
  ```
  por: `await _mostrarAsk(r); return;`
- `_mostrarAsk(r)`:
  - guarda `_askR = r` (monto/tipo/ambito/desc/fecha) y `_quickTokens = tokenize(r.descripcion||'')`.
  - mensaje: `«<descripción>» es nuevo para mí. ¿A qué categoría lo agrego?` (descripción resaltada con `qc-em`); si la descripción es vacía, usar un genérico: `¿A qué categoría agrego este <tipo> de <S/monto>?`.
  - poblar `#txQuickAskSelect` con `getCategorias(r.tipo)` (opciones reales) y aplicar
    `searchableSelect(...)`.
  - ocultar panel/confirm, mostrar `#txQuickAsk`.
- **Guardar** (`#txQuickAskSave`): leer `#txQuickAskSelect.value`; si vacío → error inline
  ("Elige una categoría"). Si ok → `insertTransaccion({tipo,ambito,categoria_id,monto,fecha,nota})`
  → `_quickTxId = tx.id` → `autocatLearnTokens(_quickTokens, catId)` → `_mostrarConfirm({...r, categoria_id:catId})`.
- **Más opciones** (`#txQuickAskMas`): `_prefillForm(_askR); _modoForm();` (form completo prellenado).
- Reusa estilos `.tx-quick-confirm`/`.qc-em`.

### B.3 Editar categoría con buscador
Aplicar `searchableSelect(#txQuickEditSelect)` cuando se muestra la confirmación (en
`_mostrarConfirm`, tras poblar el select). El `change` existente ya actualiza + aprende.

---

## PARTE C — Buscador en el form clásico
En `cargarCategorias(tipo)`, tras poblar `#categoria` (incluido el `<option value="__nueva__">`),
aplicar/refrescar `searchableSelect(categoriaEl, { specialItems: [{value:'__nueva__', text:'+ Nueva categoría'}] })`.
- El placeholder `<option value="">Selecciona una categoría</option>` se trata como vacío
  (no aparece como ítem; el input vacío = sin selección).
- Como `cargarCategorias` reconstruye las `<option>`, el componente debe leer opciones en vivo
  (A.2); tras reconstruir, llamar `wrapper.sync()` para reflejar la selección actual (o limpiar).
- El evento `change` sigue disparando la lógica de `__nueva__` y préstamo SIN cambios.
- En edición (`editTx`) y prefill, tras setear `categoriaEl.value` programáticamente, llamar `sync()`.

---

## Orden de implementación (capas)
1. `js/searchable-select.js`: `filterOptions` (pura) + componente, **TDD** (`test/searchable-select.test.mjs`). Registrar en `index.html` + precache.
2. Aplicar al form clásico `#categoria` (specialItems `__nueva__`; preservar préstamo/nueva-cat).
3. Panel "concepto nuevo" `#txQuickAsk` + integrar en `_quickAgregar` (reemplaza caer-al-form).
4. Buscador en "editar categoría" (`#txQuickEditSelect`).
5. `frontend-design` del combobox y del panel "concepto nuevo".
6. Bump `SHELL_VERSION` + commit + push (deploy a Pages).

## Verificación
- Unit (node:test): `filterOptions` (tildes, substring, vacío, sin match).
- Live (`nestra-8rl.pages.dev`): quick-add con concepto desconocido (ej. "pollo broaster 18")
  → panel "concepto nuevo" con buscador → elegir "Comida" → guarda + confirma + (segunda vez
  "pollo broaster" ya se auto-detecta). Buscador filtra en tiempo real en el form clásico y en
  editar categoría. Préstamo y "+ Nueva categoría" siguen funcionando. Cerrar/reabrir PWA (SW nuevo).

## Anti-duplicación
Reusar: `normalizeDesc` (filtro sin tildes), confirmación `.tx-quick-confirm`/`.qc-em`,
`getCategorias`, `insertTransaccion`, `autocatLearnTokens`, `tokenize`, `_mostrarConfirm`,
`_prefillForm`. Un solo componente `searchableSelect` para las 3 selecciones.
