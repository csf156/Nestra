# Concepto nuevo + buscador de categoría — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando el quick-add no infiere categoría, preguntar "¿a qué categoría?" con un selector buscable y aprender de la elección; y dar un selector de categoría con buscador (typeahead en tiempo real) en el form clásico y en las correcciones del quick-add — sin tocar el matching.

**Architecture:** App vanilla sin build. Componente reusable `searchableSelect` que ENVUELVE un `<select>` nativo (lo deja como fuente de verdad: setea `value` + dispara `change`), con una función pura `filterOptions` testeable. El prompt "concepto nuevo" es un panel dentro de `views/transaccion.html` que reusa la confirmación. Deploy: push a `v2` → Cloudflare Pages.

**Tech Stack:** HTML/CSS/JS vanilla, idb, Workbox SW, `node:test`. frontend-design para el combobox.

**Spec:** [docs/superpowers/specs/2026-06-28-concepto-nuevo-buscador-categoria-design.md](../specs/2026-06-28-concepto-nuevo-buscador-categoria-design.md)

---

## File Structure

**Crear:**
- `js/searchable-select.js` — `filterOptions(opciones, query)` (pura) + `searchableSelect(nativeSelect, opts)` (combobox). Global + ESM.
- `test/searchable-select.test.mjs` — tabla de casos de `filterOptions`.

**Modificar:**
- `views/transaccion.html` — buscador en `#categoria` (form clásico) y `#txQuickEditSelect`; panel `#txQuickAsk` (concepto nuevo) + integración en `_quickAgregar`; estilos del combobox/panel.
- `index.html` — registrar `<script src="js/searchable-select.js">`.
- `sw.js` — precache `js/searchable-select.js` + bump `SHELL_VERSION` v13 → v14.

**Convenciones:** puros `export {…}` + `window.*` (patrón share-parse), `<script type="module">`; tests `node --test`. `views` corren como classic scripts (globals alcanzables). `normalizeDesc` es global (de autocat.js). `getCategorias(tipo)`, `insertTransaccion`, `updateTransaccion`, `autocatLearnTokens`, `tokenize` globales.

---

## Task 1: `filterOptions` + componente `searchableSelect` (TDD)

**Files:**
- Create: `js/searchable-select.js`, `test/searchable-select.test.mjs`

- [ ] **Step 1: Escribir el test** — `test/searchable-select.test.mjs`:

```js
// test/searchable-select.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterOptions } from '../js/searchable-select.js';

const OPTS = [
  { value: '1', text: 'Comida' },
  { value: '2', text: 'Transporte' },
  { value: '3', text: 'Café y antojos' },
];

test('filtra por substring', () => {
  assert.deepEqual(filterOptions(OPTS, 'tra').map((o) => o.value), ['2']);
});

test('match sin tildes (cafe → Café)', () => {
  assert.deepEqual(filterOptions(OPTS, 'cafe').map((o) => o.value), ['3']);
});

test('substring en medio', () => {
  assert.deepEqual(filterOptions(OPTS, 'porte').map((o) => o.value), ['2']);
});

test('query vacío → todas, orden preservado', () => {
  assert.deepEqual(filterOptions(OPTS, '').map((o) => o.value), ['1', '2', '3']);
});

test('sin coincidencias → []', () => {
  assert.deepEqual(filterOptions(OPTS, 'zzz'), []);
});

test('no lanza con entradas raras', () => {
  assert.deepEqual(filterOptions([], 'x'), []);
  assert.deepEqual(filterOptions(OPTS, null).length, 3);
});
```

- [ ] **Step 2: Correr → falla**

Run: `node --test test/searchable-select.test.mjs`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Crear `js/searchable-select.js`**

```js
// js/searchable-select.js — combobox con buscador que envuelve un <select> nativo.
// El <select> sigue siendo la fuente de verdad (value + evento change). Sin libs.
// filterOptions es pura y testeable. Carga: <script> clásico (window.*) y ESM en Node.
import { normalizeDesc } from './autocat.js';

// filterOptions(opciones, query) → subconjunto cuyo text contiene query (sin tildes).
function filterOptions(opciones, query) {
  const list = Array.isArray(opciones) ? opciones : [];
  const q = normalizeDesc(query || '');
  if (!q) return list.slice();
  return list.filter((o) => normalizeDesc(o.text).includes(q));
}

// searchableSelect(nativeSelect, opts) → reemplaza visualmente el select por
// input + lista filtrable. opts.specialItems: [{value,text}] pinneados al final
// (ej. "+ Nueva categoría"). Idempotente.
function searchableSelect(nativeSelect, opts) {
  if (!nativeSelect || nativeSelect.dataset.ssEnhanced === '1') {
    if (nativeSelect && nativeSelect._ssSync) nativeSelect._ssSync();
    return;
  }
  opts = opts || {};
  const special = opts.specialItems || [];
  nativeSelect.dataset.ssEnhanced = '1';
  nativeSelect.style.display = 'none';

  const wrap = document.createElement('div');
  wrap.className = 'ss-wrap';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'ss-input';
  input.setAttribute('role', 'combobox');
  input.setAttribute('autocomplete', 'off');
  input.placeholder = opts.placeholder || 'Buscar…';
  const list = document.createElement('ul');
  list.className = 'ss-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.appendChild(input);
  wrap.appendChild(list);
  nativeSelect.parentNode.insertBefore(wrap, nativeSelect.nextSibling);

  let activeIdx = -1, current = [];

  // Lee las opciones reales del select EN VIVO (excluye placeholder '' y __nueva__).
  function realOptions() {
    return Array.from(nativeSelect.options)
      .filter((o) => o.value !== '' && o.value !== '__nueva__')
      .map((o) => ({ value: o.value, text: o.text }));
  }
  function selectedText() {
    const o = nativeSelect.selectedOptions[0];
    return (o && o.value && o.value !== '__nueva__') ? o.text : '';
  }
  function sync() { input.value = selectedText(); }
  nativeSelect._ssSync = sync;

  function render(items) {
    current = items;
    activeIdx = -1;
    list.innerHTML = items.map((it, i) =>
      `<li class="ss-item" role="option" data-value="${it.value}" data-i="${i}">${it.text}</li>`
    ).join('');
    list.hidden = items.length === 0;
  }
  function open() {
    const items = filterOptions(realOptions(), input.value).concat(special);
    render(items);
    list.hidden = items.length === 0;
  }
  function choose(value, text) {
    nativeSelect.value = value;
    input.value = (value === '__nueva__') ? '' : text;
    list.hidden = true;
    nativeSelect.dispatchEvent(new Event('change'));
  }

  input.addEventListener('focus', open);
  input.addEventListener('input', () => {
    const items = filterOptions(realOptions(), input.value).concat(special);
    render(items);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden && (e.key === 'ArrowDown')) { open(); return; }
    if (e.key === 'ArrowDown') { activeIdx = Math.min(activeIdx + 1, current.length - 1); _hl(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { activeIdx = Math.max(activeIdx - 1, 0); _hl(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (activeIdx >= 0 && current[activeIdx]) { const it = current[activeIdx]; choose(it.value, it.text); e.preventDefault(); } }
    else if (e.key === 'Escape') { list.hidden = true; }
  });
  function _hl() {
    Array.from(list.children).forEach((li, i) => li.classList.toggle('ss-active', i === activeIdx));
  }
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('.ss-item');
    if (!li) return;
    e.preventDefault();
    const it = current[Number(li.dataset.i)];
    if (it) choose(it.value, it.text);
  });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) list.hidden = true; });

  sync();
}

if (typeof window !== 'undefined') {
  window.filterOptions = filterOptions;
  window.searchableSelect = searchableSelect;
}
export { filterOptions, searchableSelect };
```

- [ ] **Step 4: Correr → pasa**

Run: `node --test test/searchable-select.test.mjs`
Expected: PASS (6). (El componente DOM no se testea en Node; solo `filterOptions`.)

- [ ] **Step 5: Registrar en `index.html`** — tras `<script type="module" src="js/parse-quickadd.js"></script>` añadir:
```html
    <script type="module" src="js/searchable-select.js"></script>
```

- [ ] **Step 6: Precache + bump SW** — en `sw.js`: `SHELL_VERSION` `'v13'`→`'v14'`; tras la línea `{ url: 'js/parse-quickadd.js', revision: SHELL_VERSION },` añadir:
```js
  { url: 'js/searchable-select.js', revision: SHELL_VERSION },
```

- [ ] **Step 7: Commit**
```bash
git add js/searchable-select.js test/searchable-select.test.mjs index.html sw.js
git commit -m "feat(buscador): searchableSelect + filterOptions (TDD) + registro/precache"
```
(Cierra el cuerpo con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)

---

## Task 2: Buscador en el form clásico (`#categoria`)

**Files:**
- Modify: `views/transaccion.html`

- [ ] **Step 1: Aplicar el combobox tras poblar categorías**

En `cargarCategorias(tipo)` ([transaccion.html](../../../views/transaccion.html) ~800), dentro del `try`, JUSTO después de `if (_esPrestamo() && !editTx) _mostrarPrestamo();` (tras setear `autoSelectId`), añadir:
```js
        if (typeof searchableSelect === 'function') {
          searchableSelect(categoriaEl, { specialItems: [{ value: '__nueva__', text: '+ Nueva categoría' }], placeholder: 'Buscar categoría…' });
          if (categoriaEl._ssSync) categoriaEl._ssSync();
        }
```
> Como `cargarCategorias` reconstruye las `<option>`, `searchableSelect` es idempotente (no re-envuelve) y `_ssSync()` refleja la selección actual. El combobox lee las opciones en vivo, así que el nuevo set se filtra bien.

- [ ] **Step 2: Sincronizar tras cambios programáticos de categoría**

Buscar dónde el código setea `categoriaEl.value` por código fuera de `cargarCategorias` (el handler `change` que hace `categoriaEl.value=''` en `__nueva__`, y `_prefillForm`/prefill). Tras esos, llamar `if (categoriaEl._ssSync) categoriaEl._ssSync();`. En el handler `change` (`categoriaEl.addEventListener('change'...)`), al final del callback añadir:
```js
      if (categoriaEl._ssSync) categoriaEl._ssSync();
```

- [ ] **Step 3: Verificar en navegador** (`preview_start nestra`, login)

Form clásico (Más opciones): el campo de categoría es un buscador; escribir filtra en tiempo real; elegir selecciona; "+ Nueva categoría" sigue abriendo el mini-form; categoría "Dinero que prestamos" sigue mostrando los campos de préstamo. Sin errores de consola.

- [ ] **Step 4: Commit**
```bash
git add views/transaccion.html
git commit -m "feat(buscador): selector de categoría con buscador en el form clásico"
```
(Cierra con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)

---

## Task 3: Panel "concepto nuevo" en quick-add

**Files:**
- Modify: `views/transaccion.html`

- [ ] **Step 1: Markup** — tras `#txQuickConfirm` (cierre `</div>`), añadir:
```html
<div id="txQuickAsk" class="tx-quick-confirm" style="display:none;" aria-live="polite">
  <p id="txQuickAskMsg" class="tx-quick-confirm-msg"></p>
  <div class="tx-quick-ask-cat">
    <select id="txQuickAskSelect"></select>
  </div>
  <p id="txQuickAskError" class="form-error" role="alert" style="display:none;"></p>
  <div class="tx-quick-confirm-actions">
    <button type="button" id="txQuickAskSave" class="btn btn-primary btn-sm">Guardar</button>
    <button type="button" id="txQuickAskMas" class="btn btn-secondary btn-sm">Más opciones</button>
  </div>
</div>
```

- [ ] **Step 2: Reemplazar el caer-al-form por el prompt**

En `_quickAgregar`, reemplazar el bloque:
```js
        if (r.tipo !== 'ahorro' && !r.categoria_id) {
          _prefillForm(r);
          _modoForm();
          document.getElementById('categoriaGroup').classList.add('tx-cat-needed');
          return;
        }
```
por:
```js
        if (r.tipo !== 'ahorro' && !r.categoria_id) {
          await _mostrarAsk(r);
          return;
        }
```

- [ ] **Step 3: Lógica del prompt** — añadir en el IIFE (junto a `_mostrarConfirm`):
```js
    let _askR = null;
    async function _mostrarAsk(r) {
      _askR = r;
      _quickTokens = tokenize(r.descripcion || '');
      _quickTipo = r.tipo;
      const msg = document.getElementById('txQuickAskMsg');
      const tipoTxt = r.tipo === 'ingreso' ? 'ingreso' : 'gasto';
      if (r.descripcion) {
        msg.innerHTML = '«<b class="qc-em">' + esc(r.descripcion) + '</b>» es nuevo para mí. ¿A qué categoría lo agrego?';
      } else {
        msg.innerHTML = '¿A qué categoría agrego este ' + tipoTxt + ' de <b class="qc-em">' + esc(_fmtMonto(r.monto)) + '</b>?';
      }
      const sel = document.getElementById('txQuickAskSelect');
      const cats = await getCategorias(r.tipo);
      sel.innerHTML = '<option value="">Selecciona…</option>' +
        cats.map((c) => '<option value="' + c.id + '">' + esc(c.nombre) + '</option>').join('');
      if (typeof searchableSelect === 'function') searchableSelect(sel, { placeholder: 'Buscar categoría…' });
      else sel.style.display = '';
      document.getElementById('txQuickAskError').style.display = 'none';
      elQuickPanel.style.display = 'none';
      document.getElementById('txQuickConfirm').style.display = 'none';
      document.getElementById('txQuickAsk').style.display = 'block';
    }
    document.getElementById('txQuickAskSave').addEventListener('click', async () => {
      const sel = document.getElementById('txQuickAskSelect');
      const errEl = document.getElementById('txQuickAskError');
      const catId = sel.value;
      if (!catId) { errEl.textContent = 'Elige una categoría.'; errEl.style.display = 'block'; return; }
      try {
        const r = _askR;
        const tx = await insertTransaccion({
          tipo: r.tipo, ambito: r.ambito, categoria_id: catId,
          monto: r.monto, fecha: r.fecha, nota: r.descripcion,
        });
        _quickTxId = tx && tx.id;
        if (typeof autocatLearnTokens === 'function') await autocatLearnTokens(_quickTokens, catId);
        await _mostrarConfirm(Object.assign({}, r, { categoria_id: catId }));
      } catch (e) {
        console.error('quickAsk save:', e);
        errEl.textContent = 'No se pudo guardar. Reintenta.'; errEl.style.display = 'block';
      }
    });
    document.getElementById('txQuickAskMas').addEventListener('click', () => {
      if (_askR) _prefillForm(_askR);
      document.getElementById('txQuickAsk').style.display = 'none';
      _modoForm();
    });
```
> `_mostrarConfirm` ocultará `#txQuickAsk`? No: añade al inicio de `_mostrarConfirm` el ocultar del ask:
> en `_mostrarConfirm`, donde hace `elQuickPanel.style.display='none'`, añadir también
> `document.getElementById('txQuickAsk').style.display = 'none';`.

- [ ] **Step 4: Verificar** — quick-add con concepto desconocido (ej. "pollo broaster 18", sin historial ni match) → aparece el panel "concepto nuevo" con buscador → elegir categoría → guarda + confirmación. Repetir "pollo broaster 20" → ahora auto-detecta (aprendido). "Más opciones" abre el form prellenado.

- [ ] **Step 5: Commit**
```bash
git add views/transaccion.html
git commit -m "feat(quickadd): prompt 'concepto nuevo' que pregunta categoría y aprende"
```
(Cierra con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)

---

## Task 4: Buscador en "editar categoría" (confirmación)

**Files:**
- Modify: `views/transaccion.html`

- [ ] **Step 1: Aplicar combobox al poblar el select de edición**

En `_mostrarConfirm`, tras poblar `#txQuickEditSelect` (`sel.innerHTML = cats.map(...)`), añadir:
```js
        if (typeof searchableSelect === 'function') { searchableSelect(sel, { placeholder: 'Buscar categoría…' }); if (sel._ssSync) sel._ssSync(); }
```
(El `change` existente sobre `#txQuickEditSelect` ya hace `updateTransaccion` + `autocatLearnTokens`; el combobox dispara ese `change`.)

> Nota: en `_mostrarConfirm` el select de edición se re-puebla cada vez. `searchableSelect` es
> idempotente; `_ssSync()` refleja la categoría preseleccionada.

- [ ] **Step 2: Verificar** — guardar una tx, en la confirmación tocar "Editar categoría" → el desplegable es buscable; elegir otra categoría actualiza el mensaje y aprende.

- [ ] **Step 3: Commit**
```bash
git add views/transaccion.html
git commit -m "feat(buscador): selector buscable en editar categoría de la confirmación"
```
(Cierra con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)

---

## Task 5: frontend-design del combobox y el panel "concepto nuevo"

**Files:**
- Modify: `views/transaccion.html` (bloque `<style>`)

**Usar el skill `frontend-design`.** Leer `css/base.css` para los tokens reales
(`--space-*`, `--radius-*`, `--color-primary`, `--border-light`, `--bg-light`, `--text-dark`,
`--text-secondary`, `--font-size-*`). Requisitos:
- `.ss-wrap { position: relative; }` para anclar la lista.
- `.ss-input`: igual de prominente que un input normal del form (alto ≥44px, borde, radius,
  focus ring con `--color-primary`). Mismo ancho que el select que reemplaza (100%).
- `.ss-list`: `position:absolute; z-index:20;` bajo el input, fondo `--bg-light`, borde,
  radius, `max-height: 240px; overflow:auto;` sombra suave; ancho 100%.
- `.ss-item`: padding cómodo (≥40px alto táctil), `cursor:pointer`; `.ss-item:hover` y
  `.ss-item.ss-active` con fondo `--border-light`/tinte primario.
- `.tx-quick-ask-cat`: margen vertical; el `#txQuickAskSelect` queda oculto (lo reemplaza el combobox).
- Mobile-first (390px) y desktop. Sin libs.

- [ ] **Step 1: Añadir estilos** (en el `<style>` de la vista) con los tokens reales (ajustar fallbacks si difieren). Ejemplo base:
```css
.ss-wrap { position: relative; }
.ss-input { width: 100%; min-height: 44px; padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-light); border-radius: var(--radius-md); background: var(--bg-light);
  color: var(--text-dark); font-size: var(--font-size-base); }
.ss-input:focus { outline: none; border-color: var(--color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 20%, transparent); }
.ss-list { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 20; margin: 0;
  padding: var(--space-xs); list-style: none; background: var(--bg-light);
  border: 1px solid var(--border-light); border-radius: var(--radius-md);
  max-height: 240px; overflow-y: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.12); }
.ss-item { padding: var(--space-sm) var(--space-md); border-radius: var(--radius-sm);
  cursor: pointer; min-height: 40px; display: flex; align-items: center; }
.ss-item:hover, .ss-item.ss-active { background: var(--border-light); }
.tx-quick-ask-cat { margin: var(--space-md) 0; text-align: left; }
```

- [ ] **Step 2: Verificar visual** (`preview_resize` 390 + desktop): input prominente, lista flotante legible, ítems táctiles, filtrado en vivo. `preview_screenshot` como evidencia.

- [ ] **Step 3: Commit**
```bash
git add views/transaccion.html
git commit -m "style(buscador): frontend-design del combobox y panel concepto nuevo"
```
(Cierra con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)

---

## Task 6: Deploy

**Files:** (sin cambios de código; ya se bumpeó SW en Task 1)

- [ ] **Step 1: Suite completa**

Run: `node --test test/*.test.mjs`
Expected: PASS (incluye searchable-select + los existentes).

- [ ] **Step 2: Commit (si quedó algo) + push**
```bash
git add -A
git commit -m "chore(buscador): deploy concepto nuevo + buscador de categoría" || true
git push origin v2
```

- [ ] **Step 3: Verificar deploy live**

Run (tras ~1-2 min):
`curl -sL https://nestra-8rl.pages.dev/sw.js | grep -o "SHELL_VERSION = '[^']*'"` → `v14`.
`curl -sL https://nestra-8rl.pages.dev/js/searchable-select.js | grep -c "filterOptions"` → ≥1.
En el teléfono: cerrar/reabrir la PWA (se auto-recargará por `controllerchange`).

---

## Self-Review (cobertura del spec)
- A. searchableSelect (envuelve native, value+change) + filterOptions pura TDD: Task 1. ✓
- A. tests tildes/substring/vacío/sin-match: Task 1 Step 1. ✓
- B. prompt "concepto nuevo" reemplaza caer-al-form; guarda+aprende+confirma: Task 3. ✓
- B. mensaje genérico si descripción vacía: Task 3 Step 3. ✓
- B. editar categoría buscable: Task 4. ✓
- C. buscador en form clásico, preserva `__nueva__`/préstamo: Task 2. ✓
- frontend-design: Task 5. ✓
- Deploy a Pages: Task 6. ✓
- No tocar matching: ninguna tarea modifica `js/autocat.js` salvo importar `normalizeDesc`. ✓
- Type consistency: `searchableSelect`, `filterOptions`, `_ssSync`, `_mostrarAsk`, `_askR`, `_mostrarConfirm` consistentes entre tareas. ✓
