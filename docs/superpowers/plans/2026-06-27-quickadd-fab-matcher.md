# Quick-add entrada principal + matcher por tokens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El botón + abre un panel quick-add que parsea texto y guarda la transacción directamente (con tipo/ámbito/categoría inferidos), mostrando una confirmación con Deshacer / Editar categoría; la categoría se infiere con un matcher por tokens que aprende del historial.

**Architecture:** App vanilla sin build. Funciones puras (tokenize/scoreCategorias/matchCategoria, parser) en módulos ESM testeados con `node --test`. Aprendizaje por token en IndexedDB (`autocat_tok`). El panel rápido vive dentro de `views/transaccion.html` (no segundo modal); guarda con `insertTransaccion`/`insertSplit` ya existentes. Deploy: push a `v2` → Cloudflare Pages (`nestra-8rl.pages.dev`).

**Tech Stack:** HTML/CSS/JS vanilla, Supabase JS, idb (IndexedDB), Workbox SW, `node:test`. frontend-design para el panel y la confirmación.

**Spec:** [docs/superpowers/specs/2026-06-27-quickadd-fab-matcher-design.md](../specs/2026-06-27-quickadd-fab-matcher-design.md)

---

## File Structure

**Modificar:**
- `js/autocat.js` — reescribe matcher: `tokenize`, `scoreCategorias`, `matchCategoria`, `SEED`(=KEYWORDS); conserva `normalizeDesc`; elimina `matchAutocat`.
- `test/autocat.test.mjs` — reescrito (tablas tokenize/score/match).
- `js/parse-quickadd.js` — extrae tipo/ámbito; categoría vía `matchCategoria(ctx)`; elimina `categoria_keyword`.
- `test/parse-quickadd.test.mjs` — ampliado (tipo/ámbito/ctx).
- `js/nestra-db.js` — IDB v4: store `autocat_tok`; helpers `autocatLearnTokens`/`autocatLearned`; retira `autocatLearn`/`autocatDict`.
- `js/db.js` — 3 sitios de aprendizaje pasan a `autocatLearnTokens(tokenize(nota), cat)`.
- `views/transaccion.html` — panel rápido + guardado directo + confirmación; blur-handler usa matcher.
- `views/dashboard.html` — elimina tarjeta `#qaForm` + `initQuickAdd`.
- `sw.js` — `SHELL_VERSION` v11 → v12.

**Convenciones (leer):**
- Puros: `export {…}` + `window.*` (patrón [share-parse.js](../../../js/share-parse.js)); cargados como `<script type="module">`. Tests `node --test test/x.test.mjs`.
- `db.js`/`nestra-db.js` funciones globales (db.js por hoisting; nestra-db.js con `window.*`).
- Vistas corren como classic scripts (globals alcanzables).
- `getCategorias(tipo)` ya filtra por tipo y devuelve `[{id,nombre,icono,...}]`.

---

## Task 1: Matcher por tokens en `js/autocat.js` (TDD)

**Files:**
- Modify: `js/autocat.js`
- Test: `test/autocat.test.mjs` (reescribir)

- [ ] **Step 1: Reescribir el test** — reemplaza TODO `test/autocat.test.mjs`:

```js
// test/autocat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDesc, tokenize, scoreCategorias, matchCategoria, SEED } from '../js/autocat.js';

test('normalizeDesc quita tildes, baja caja, colapsa espacios', () => {
  assert.equal(normalizeDesc('  Café  CON Leche '), 'cafe con leche');
});

test('tokenize: stopwords fuera + singular simple', () => {
  assert.deepEqual(tokenize('Llantas para bicicleta'), ['llanta', 'bicicleta']);
});

test('tokenize: numérico suelto y len<2 fuera', () => {
  assert.deepEqual(tokenize('uber 15 a'), ['uber']);
});

test('tokenize: meses→mes (es,len>4); mes intacto', () => {
  assert.deepEqual(tokenize('meses'), ['mes']);
  assert.deepEqual(tokenize('mes'), ['mes']);
});

test('scoreCategorias: token en nombre de categoría custom → +2', () => {
  const cats = [{ id: 'c1', nombre: 'Partes de bicicleta' }, { id: 'c2', nombre: 'Comida' }];
  const s = scoreCategorias(['bicicleta'], { categorias: cats });
  assert.equal(s.c1, 2);
  assert.equal(s.c2 || 0, 0);
});

test('scoreCategorias: aprendido domina (3*freq)', () => {
  const cats = [{ id: 'c1', nombre: 'Otros' }];
  const s = scoreCategorias(['uber'], { learned: { uber: { c1: 3 } }, categorias: cats });
  assert.equal(s.c1, 9);
});

test('scoreCategorias: semilla +1 resuelta por nombre', () => {
  const cats = [{ id: 'cT', nombre: 'Transporte' }];
  const s = scoreCategorias(['uber'], { categorias: cats, seed: { uber: 'Transporte' } });
  assert.equal(s.cT, 1);
});

test('matchCategoria: máximo único sobre umbral → id', () => {
  const cats = [{ id: 'cT', nombre: 'Transporte' }, { id: 'cC', nombre: 'Comida' }];
  const id = matchCategoria(['uber'], { categorias: cats, seed: { uber: 'Transporte' } });
  assert.equal(id, 'cT');
});

test('matchCategoria: empate → null', () => {
  const cats = [{ id: 'a', nombre: 'Alfa' }, { id: 'b', nombre: 'Beta' }];
  const ctx = { learned: { x: { a: 1, b: 1 } }, categorias: cats };
  assert.equal(matchCategoria(['x'], ctx), null);
});

test('matchCategoria: sin señal → null', () => {
  assert.equal(matchCategoria(['zzz'], { categorias: [{ id: 'c1', nombre: 'Comida' }] }), null);
});

test('SEED incluye semillas es-PE', () => {
  assert.equal(SEED.uber, 'Transporte');
  assert.equal(SEED.almuerzo, 'Comida');
});
```

- [ ] **Step 2: Correr → falla**

Run: `node --test test/autocat.test.mjs`
Expected: FAIL (`tokenize`/`scoreCategorias`/`matchCategoria`/`SEED` no exportados).

- [ ] **Step 3: Reescribir `js/autocat.js`** (reemplazar TODO el archivo):

```js
// js/autocat.js — normalización + matcher de categoría por tokens (scoring).
// Sin AI, determinista. Carga: <script type="module"> (window.*) y ESM en Node.

function normalizeDesc(s) {
  return String(s ?? '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

const STOP = new Set([
  'de','del','la','el','los','las','un','una','unos','unas',
  'y','o','a','en','con','por','para','mi','mis','su','sus','lo','al',
]);

function _singular(w) {
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}

// tokenize(desc) → tokens normalizados, sin stopwords ni numéricos, singular simple.
function tokenize(desc) {
  const norm = normalizeDesc(desc);
  if (!norm) return [];
  return norm.split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((t) => !/^\d+$/.test(t))
    .filter((t) => !STOP.has(t))
    .map(_singular)
    .filter((t) => t.length >= 2);
}

// scoreCategorias(tokens, ctx) → { [categoria_id]: score }.
// ctx: { learned:{token:{catId:freq}}, categorias:[{id,nombre}], seed:{token:nombre} }
function scoreCategorias(tokens, ctx) {
  const learned = (ctx && ctx.learned) || {};
  const categorias = (ctx && ctx.categorias) || [];
  const seed = (ctx && ctx.seed) || {};
  const scores = {};
  const add = (id, n) => { if (id) scores[id] = (scores[id] || 0) + n; };
  const catTok = categorias.map((c) => ({ id: c.id, nombre: c.nombre, toks: new Set(tokenize(c.nombre)) }));
  for (const tok of tokens) {
    if (learned[tok]) for (const id in learned[tok]) add(id, 3 * learned[tok][id]);
    for (const c of catTok) if (c.toks.has(tok)) add(c.id, 2);
    if (seed[tok]) {
      const sn = normalizeDesc(seed[tok]);
      for (const c of categorias) if (normalizeDesc(c.nombre) === sn) add(c.id, 1);
    }
  }
  return scores;
}

// matchCategoria(tokens, ctx, umbral=1) → categoria_id | null. Empate → null.
function matchCategoria(tokens, ctx, umbral = 1) {
  const scores = scoreCategorias(tokens, ctx);
  let best = null, bestScore = -1, tie = false;
  for (const id in scores) {
    const s = scores[id];
    if (s > bestScore) { bestScore = s; best = id; tie = false; }
    else if (s === bestScore) { tie = true; }
  }
  if (best == null || bestScore < umbral || tie) return null;
  return best;
}

// Diccionario semilla token → NOMBRE de categoría (es-PE).
const SEED = {
  uber:'Transporte', taxi:'Transporte', pasaje:'Transporte', combi:'Transporte',
  metro:'Transporte', gasolina:'Transporte',
  almuerzo:'Comida', cena:'Comida', desayuno:'Comida', cafe:'Comida',
  menu:'Comida', restaurante:'Comida',
  mercado:'Mercado', super:'Mercado', verdura:'Mercado',
  luz:'Servicios', agua:'Servicios', internet:'Servicios', recarga:'Servicios',
  celular:'Servicios',
  farmacia:'Salud', clinica:'Salud',
  cine:'Ocio', bar:'Ocio',
};

if (typeof window !== 'undefined') {
  window.normalizeDesc = normalizeDesc;
  window.tokenize = tokenize;
  window.scoreCategorias = scoreCategorias;
  window.matchCategoria = matchCategoria;
  window.NESTRA_SEED = SEED;
}
export { normalizeDesc, tokenize, scoreCategorias, matchCategoria, SEED };
```

> Nota: las claves de `SEED` van SIN tildes (se comparan contra tokens ya normalizados; `tokenize('café')`→`cafe`).

- [ ] **Step 4: Correr → pasa**

Run: `node --test test/autocat.test.mjs`
Expected: PASS (11).

- [ ] **Step 5: Commit**

```bash
git add js/autocat.js test/autocat.test.mjs
git commit -m "feat(quickadd): matcher de categoría por tokens con scoring (TDD)"
```
(Termina el cuerpo del commit con: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)

---

## Task 2: Parser tipo/ámbito + categoría vía matcher (TDD)

**Files:**
- Modify: `js/parse-quickadd.js`
- Test: `test/parse-quickadd.test.mjs` (reescribir)

- [ ] **Step 1: Reescribir el test** — reemplaza TODO `test/parse-quickadd.test.mjs`:

```js
// test/parse-quickadd.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from '../js/parse-quickadd.js';

const HOY = '2026-06-24';
// ctx con categorías de gasto + semilla, para inferencia
const CATS = [{ id: 'cT', nombre: 'Transporte' }, { id: 'cC', nombre: 'Comida' }, { id: 'cB', nombre: 'Partes de bicicleta' }];
const CTX = { categorias: CATS, seed: { uber: 'Transporte', taxi: 'Transporte', almuerzo: 'Comida' } };
const p = (text, ctx = CTX) => parseQuickAdd(text, { hoy: HOY, ctx });

test('gasto/personal por defecto + monto + categoría inferida', () => {
  const r = p('Uber 15');
  assert.equal(r.tipo, 'gasto');
  assert.equal(r.ambito, 'personal');
  assert.equal(r.monto, 15);
  assert.equal(r.categoria_id, 'cT');
  assert.equal(r.descripcion, 'Uber');
  assert.equal(r.fecha, HOY);
});

test('decimal con S/ + categoría', () => {
  const r = p('almuerzo S/12.50');
  assert.equal(r.monto, 12.5);
  assert.equal(r.categoria_id, 'cC');
});

test('ahorro hogar: tipo+ámbito, sin categoría', () => {
  const r = p('ahorro hogar 50');
  assert.equal(r.tipo, 'ahorro');
  assert.equal(r.ambito, 'hogar');
  assert.equal(r.monto, 50);
  assert.equal(r.categoria_id, null);
  assert.equal(r.descripcion, null);
});

test('ingreso con descripción', () => {
  const r = p('ingreso trabajo 100');
  assert.equal(r.tipo, 'ingreso');
  assert.equal(r.ambito, 'personal');
  assert.equal(r.monto, 100);
  assert.equal(r.descripcion, 'trabajo');
});

test('categoría custom por nombre, sin historial', () => {
  const r = p('llantas para bicicleta 100');
  assert.equal(r.categoria_id, 'cB'); // "bicicleta" ∈ "Partes de bicicleta"
});

test('keyword de tipo/ámbito se quita de la descripción', () => {
  const r = p('ahorro hogar viaje 200');
  assert.equal(r.descripcion, 'viaje');
});

test('sin categoría inferible → null', () => {
  assert.equal(p('chuches 5').categoria_id, null);
});

test('fecha relativa ayer', () => {
  assert.equal(p('15 taxi ayer').fecha, '2026-06-23');
});

test('sin monto → monto null', () => {
  assert.equal(p('recarga').monto, null);
});

test('nunca lanza con vacío/null', () => {
  assert.equal(parseQuickAdd('', { hoy: HOY }).monto, null);
  assert.equal(parseQuickAdd(null, { hoy: HOY }).monto, null);
});
```

- [ ] **Step 2: Correr → falla**

Run: `node --test test/parse-quickadd.test.mjs`
Expected: FAIL (espera `tipo`/`ambito`/`categoria_id` vía ctx; el archivo aún usa `categoria_keyword`).

- [ ] **Step 3: Editar `js/parse-quickadd.js`**

Cambiar el import (línea 3):
```js
import { tokenize, matchCategoria } from './autocat.js';
```

Reemplazar la firma + cuerpo de `parseQuickAdd` (desde `function parseQuickAdd` hasta su `return out;`) por:
```js
const _FECHAS = { hoy: 0, ayer: -1, anteayer: -2, 'mañana': 1, manana: 1 };

function parseQuickAdd(text, opts = {}) {
  const hoy = opts.hoy;
  const ctx = opts.ctx || {};
  const out = { tipo: 'gasto', ambito: 'personal', descripcion: null, monto: null, categoria_id: null, fecha: hoy };
  if (text == null) return out;
  let str = String(text).trim();
  if (!str) return out;

  // 1. Fecha relativa.
  let fecha = hoy;
  str = str.replace(/\b(anteayer|ayer|hoy|mañana|manana)\b/i, (m) => {
    if (hoy) fecha = _addDays(hoy, _FECHAS[m.toLowerCase()] ?? 0);
    return ' ';
  });
  out.fecha = fecha;

  // 2. Tipo (default gasto).
  str = str.replace(/\b(ingreso|ahorro)\b/i, (m) => { out.tipo = m.toLowerCase(); return ' '; });

  // 3. Ámbito (default personal).
  str = str.replace(/\b(hogar|personal)\b/i, (m) => { out.ambito = m.toLowerCase(); return ' '; });

  // 4. Monto. Si hay S/<num>, ese gana; si no, el mayor.
  let monto = null;
  const conS = str.match(/S\/\.?\s*([\d.,]+)/i);
  if (conS) {
    monto = _normalizeNum(conS[1]);
    str = str.replace(conS[0], ' ');
  } else {
    const re = /\d[\d.,]*\d|\d/g;
    let m, best = null, bestRaw = null, bestIdx = -1;
    while ((m = re.exec(str)) !== null) {
      const n = _normalizeNum(m[0]);
      if (n != null && (best == null || n > best)) { best = n; bestRaw = m[0]; bestIdx = m.index; }
    }
    monto = best;
    if (bestIdx >= 0) str = str.slice(0, bestIdx) + ' ' + str.slice(bestIdx + bestRaw.length);
  }
  out.monto = (monto != null && monto > 0) ? monto : null;

  // 5. Descripción.
  const desc = str.replace(/S\/\.?/ig, ' ').replace(/\s+/g, ' ').trim();
  out.descripcion = desc || null;

  // 6. Categoría: ahorro no lleva; resto vía matcher por tokens.
  if (out.tipo !== 'ahorro') {
    out.categoria_id = matchCategoria(tokenize(desc), ctx);
  }
  return out;
}
```

> `_normalizeNum` y `_addDays` ya existen en el archivo — no los dupliques. `normalizeDesc` ya no se usa aquí (lo usa el matcher); puedes quitar su import si quedó.

- [ ] **Step 4: Correr → pasa (ambos archivos)**

Run: `node --test test/autocat.test.mjs test/parse-quickadd.test.mjs`
Expected: PASS (autocat 11 + parse-quickadd 10 = 21).

- [ ] **Step 5: Commit**

```bash
git add js/parse-quickadd.js test/parse-quickadd.test.mjs
git commit -m "feat(quickadd): parser reconoce tipo/ámbito y categoría por matcher de tokens (TDD)"
```
(Cierra el cuerpo con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)

---

## Task 3: IndexedDB v4 — aprendizaje por token

**Files:**
- Modify: `js/nestra-db.js`

- [ ] **Step 1: Subir versión + crear store**

En `js/nestra-db.js`:
- `const NESTRA_IDB_VERSION = 3;` → `= 4;`
- En `upgrade(db)`, tras el bloque de `recibos_pendientes`, añadir:
```js
        if (!db.objectStoreNames.contains('autocat_tok')) {
          db.createObjectStore('autocat_tok', { keyPath: 'token' });
        }
        if (db.objectStoreNames.contains('autocat')) {
          db.deleteObjectStore('autocat'); // store viejo desc→cat (sin uso)
        }
```

- [ ] **Step 2: Reemplazar helpers**

Quitar `autocatLearn` y `autocatDict` (las funciones y sus `window.autocatLearn`/`window.autocatDict`). Añadir en su lugar:
```js
// ── autocat por token: { token, cats:{ [catId]: count } } ──────
async function autocatLearnTokens(tokens, categoriaId) {
  if (!categoriaId || !tokens || !tokens.length) return;
  try {
    const db = await nestraDB();
    const tx = db.transaction('autocat_tok', 'readwrite');
    for (const token of tokens) {
      if (!token) continue;
      const prev = await tx.store.get(token);
      const cats = (prev && prev.cats) || {};
      cats[categoriaId] = (cats[categoriaId] || 0) + 1;
      await tx.store.put({ token, cats });
    }
    await tx.done;
  } catch (err) { console.error('autocatLearnTokens falló:', err); }
}
async function autocatLearned() {
  try {
    const db = await nestraDB();
    const all = await db.getAll('autocat_tok');
    const out = {};
    for (const r of all) out[r.token] = r.cats || {};
    return out;
  } catch (err) { console.error('autocatLearned falló:', err); return {}; }
}
```
Y en el bloque `window.*`: quitar `window.autocatLearn`/`window.autocatDict`, añadir:
```js
window.autocatLearnTokens = autocatLearnTokens;
window.autocatLearned = autocatLearned;
```

- [ ] **Step 3: Verificar**

Run: `grep -n "autocat_tok\|autocatLearnTokens\|autocatLearned\|NESTRA_IDB_VERSION = 4" js/nestra-db.js`
Expected: store creado, helpers definidos + exportados, versión 4. `grep -n "autocatLearn\b\|autocatDict" js/nestra-db.js` → sin resultados (eliminados).

- [ ] **Step 4: Commit**

```bash
git add js/nestra-db.js
git commit -m "feat(quickadd): IndexedDB v4 autocat_tok + helpers de aprendizaje por token"
```
(Cierra con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)

---

## Task 4: Aprendizaje por token en `js/db.js`

**Files:**
- Modify: `js/db.js`

- [ ] **Step 1: Reemplazar las 3 llamadas de aprendizaje**

En `insertTransaccion` hay 3 bloques que llaman `autocatLearn` (rama offline-early sobre `fila`, rama online sobre `data`, rama catch sobre `fila`). Reemplazar CADA uno:

Bloque viejo (3 variantes, con `fila` o `data`):
```js
    if (typeof autocatLearn === 'function' && <X>.nota && <X>.categoria_id) {
      const dn = (typeof normalizeDesc === 'function') ? normalizeDesc(<X>.nota) : null;
      if (dn) await autocatLearn(dn, <X>.categoria_id);
    }
```
Nuevo (mismo `<X>` = `fila` o `data` según el bloque):
```js
    if (typeof autocatLearnTokens === 'function' && typeof tokenize === 'function' && <X>.nota && <X>.categoria_id) {
      await autocatLearnTokens(tokenize(<X>.nota), <X>.categoria_id);
    }
```

- [ ] **Step 2: Verificar**

Run: `grep -n "autocatLearn\b\|autocatLearnTokens\|tokenize(" js/db.js`
Expected: 0 `autocatLearn(` legacy; 3 usos de `autocatLearnTokens(tokenize(...))`.
Run: `node --test test/*.test.mjs`
Expected: PASS (suite completa; db.js no se importa en tests).

- [ ] **Step 3: Commit**

```bash
git add js/db.js
git commit -m "feat(quickadd): insertTransaccion aprende categoría por token"
```
(Cierra con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)

---

## Task 5: Panel rápido + guardado directo + confirmación en `views/transaccion.html`

**Files:**
- Modify: `views/transaccion.html`

Contexto: el modal carga esta vista en `#transaccionModalContent`. El script IIFE
(líneas ~527+) tiene `form` (`#transaccionForm`), `tipoEl/ambitoEl/categoriaEl/montoEl/fechaEl/notaEl`,
`_setTipo(v)`, `_setAmbito(v)`, `cargarCategorias(autoSelectId)`, `mostrarExito(catId)`, `esc()`,
`_salir()`, `editTx`. Globales: `parseQuickAdd`, `tokenize`, `matchCategoria`, `window.NESTRA_SEED`,
`autocatLearned`, `getCategorias`, `insertTransaccion`, `updateTransaccion`, `deleteTransaccion`.

- [ ] **Step 1: Markup del panel** — al inicio de `.tx-card` (antes de `#txExito`), insertar:

```html
<!-- ── Panel rápido (entrada principal) ───────────────────────── -->
<div id="txQuickPanel" class="tx-quick" style="display:none;">
  <label for="txQuickInput" class="tx-quick-label">Registro rápido</label>
  <div class="tx-quick-row">
    <input type="text" id="txQuickInput" class="tx-quick-input" autocomplete="off"
           inputmode="text" placeholder='Ej: "Uber 15", "ahorro hogar 50", "ingreso trabajo 100"'
           aria-label="Registro rápido de transacción" />
    <button type="button" id="txQuickAdd" class="btn btn-primary tx-quick-add">Agregar</button>
  </div>
  <div id="txQuickChips" class="tx-plantillas" aria-label="Plantillas"></div>
  <p id="txQuickError" class="form-error" role="alert" style="display:none;"></p>
  <button type="button" id="txQuickMas" class="tx-quick-mas">Más opciones (formulario completo)</button>
</div>

<!-- ── Confirmación post-guardado ──────────────────────────────── -->
<div id="txQuickConfirm" class="tx-quick-confirm" style="display:none;" aria-live="polite">
  <p id="txQuickConfirmMsg" class="tx-quick-confirm-msg"></p>
  <div id="txQuickEditCat" style="display:none; margin:var(--space-sm) 0;">
    <select id="txQuickEditSelect" class="cfg-select"></select>
  </div>
  <div class="tx-quick-confirm-actions">
    <button type="button" id="txQuickUndo" class="btn btn-secondary btn-sm">Deshacer</button>
    <button type="button" id="txQuickEditBtn" class="btn btn-secondary btn-sm">Editar categoría</button>
    <button type="button" id="txQuickDone" class="btn btn-primary btn-sm">Listo</button>
  </div>
</div>
```

- [ ] **Step 2: Envolver el form para poder ocultarlo**

El form `#transaccionForm` y el `.tx-header` deben ocultarse en modo rápido. En el script,
definir helpers de modo (añadir dentro del IIFE, tras declarar `form`):
```js
    const elQuickPanel = document.getElementById('txQuickPanel');
    const elHeader = document.querySelector('.tx-header');
    function _modoRapido() {
      elQuickPanel.style.display = 'block';
      form.style.display = 'none';
      if (elHeader) elHeader.style.display = 'none';
      document.getElementById('txQuickConfirm').style.display = 'none';
      setTimeout(() => { document.getElementById('txQuickInput').focus(); }, 50);
    }
    function _modoForm() {
      elQuickPanel.style.display = 'none';
      document.getElementById('txQuickConfirm').style.display = 'none';
      if (elHeader) elHeader.style.display = '';
      form.style.display = '';
    }
```

- [ ] **Step 3: Decidir modo inicial**

Localizar dónde se consume `window._quickAddPrefill` / `editTx` en la carga inicial. Sustituir
la apertura por defecto: si es **alta nueva** (sin `editTx` y sin `window._sharePrefill`/`_quickAddPrefill`),
abrir en **modo rápido**; en edición/share, modo form. Al final del init (donde hoy decide qué mostrar),
añadir:
```js
    const _esAltaNueva = !editTx && !window._quickAddPrefill && !window._sharePrefill;
    if (_esAltaNueva) _modoRapido(); else _modoForm();
```
> Si `_quickAddPrefill`/`_sharePrefill` no existen como variables, usar `window._quickAddPrefill`/`window._sharePrefill`. Verificar los nombres exactos con `grep -n "_sharePrefill\|_quickAddPrefill" views/transaccion.html`.

- [ ] **Step 4: Construir ctx + parsear + guardar directo**

Añadir en el script:
```js
    function _hoyISO() {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }
    async function _ctxPara(tipo) {
      const learned = (typeof autocatLearned === 'function') ? await autocatLearned() : {};
      const cats = await getCategorias(tipo === 'ahorro' ? 'gasto' : tipo); // ahorro no usa cats
      const seed = window.NESTRA_SEED || {};
      return { learned, categorias: cats.map((c) => ({ id: c.id, nombre: c.nombre })), seed };
    }
    // _quickTokens / _quickTxId / _quickTipo: estado para confirmación
    let _quickTokens = [], _quickTxId = null, _quickTipo = 'gasto';

    async function _quickAgregar() {
      const errEl = document.getElementById('txQuickError');
      errEl.style.display = 'none';
      const txt = document.getElementById('txQuickInput').value.trim();
      if (!txt) return;
      // primer parse para conocer tipo (categorías dependen del tipo)
      const pre = parseQuickAdd(txt, { hoy: _hoyISO(), ctx: {} });
      const ctx = await _ctxPara(pre.tipo);
      const r = parseQuickAdd(txt, { hoy: _hoyISO(), ctx });
      if (r.monto == null) { errEl.textContent = 'No detecté un monto. Ej: "Uber 15".'; errEl.style.display = 'block'; return; }
      _quickTokens = tokenize(r.descripcion || '');
      _quickTipo = r.tipo;
      // gasto/ingreso sin categoría → caer al form prellenado
      if (r.tipo !== 'ahorro' && !r.categoria_id) {
        _prefillForm(r);
        _modoForm();
        document.getElementById('categoriaGroup').classList.add('tx-cat-needed');
        return;
      }
      // guardar directo
      try {
        const tx = await insertTransaccion({
          tipo: r.tipo, ambito: r.ambito,
          categoria_id: r.tipo === 'ahorro' ? null : r.categoria_id,
          monto: r.monto, fecha: r.fecha, nota: r.descripcion,
        });
        _quickTxId = tx && tx.id;
        _mostrarConfirm(r);
      } catch (e) {
        errEl.textContent = 'No se pudo guardar. Reintenta.'; errEl.style.display = 'block';
      }
    }
```
> `_prefillForm(r)` aplica r al form (tipo/ámbito/monto/fecha/nota/categoría). Si ya existe un
> consumidor de `_quickAddPrefill`, reusarlo; si no, implementarlo:
```js
    function _prefillForm(r) {
      _setTipo(r.tipo); _setAmbito(r.ambito);
      montoEl.value = r.monto || '';
      notaEl.value = r.descripcion || '';
      if (r.fecha) fechaEl.value = r.fecha;
      // categoría se elige manualmente (resaltada)
    }
```

- [ ] **Step 5: Confirmación + Deshacer + Editar categoría**

```js
    function _fmtMonto(m) { return 'S/' + Number(m).toFixed(2); }
    function _nombreCat(id, cats) { const c = cats.find((x) => x.id === id); return c ? c.nombre : ''; }
    async function _mostrarConfirm(r) {
      const msg = document.getElementById('txQuickConfirmMsg');
      const cats = r.tipo === 'ahorro' ? [] : await getCategorias(r.tipo);
      const tipoTxt = r.tipo === 'gasto' ? 'gasto' : (r.tipo === 'ingreso' ? 'ingreso' : 'ahorro');
      const hogar = r.ambito === 'hogar' ? ' (hogar)' : '';
      if (r.tipo === 'ahorro') {
        msg.innerHTML = 'Registré un <b class="qc-em">' + tipoTxt + '</b> de <b class="qc-em">' + esc(_fmtMonto(r.monto)) + '</b>' + esc(hogar);
      } else {
        const cn = _nombreCat(r.categoria_id, cats);
        msg.innerHTML = 'Registré un <b class="qc-em">' + tipoTxt + '</b> por <b class="qc-em">' + esc(_fmtMonto(r.monto)) +
          '</b> en <b class="qc-em">' + esc(cn) + '</b>' + esc(hogar);
      }
      // poblar select de edición (solo gasto/ingreso)
      const editWrap = document.getElementById('txQuickEditCat');
      const sel = document.getElementById('txQuickEditSelect');
      const editBtn = document.getElementById('txQuickEditBtn');
      editWrap.style.display = 'none';
      if (r.tipo === 'ahorro') { editBtn.style.display = 'none'; }
      else {
        editBtn.style.display = '';
        sel.innerHTML = cats.map((c) => '<option value="' + c.id + '"' + (c.id === r.categoria_id ? ' selected' : '') + '>' + esc(c.nombre) + '</option>').join('');
      }
      elQuickPanel.style.display = 'none';
      document.getElementById('txQuickConfirm').style.display = 'block';
      if (window._modalMode) window._modalRefresh = true;
    }
    // Wiring
    document.getElementById('txQuickAdd').addEventListener('click', _quickAgregar);
    document.getElementById('txQuickInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); _quickAgregar(); } });
    document.getElementById('txQuickMas').addEventListener('click', () => { _modoForm(); });
    document.getElementById('txQuickDone').addEventListener('click', () => { _salir(); });
    document.getElementById('txQuickUndo').addEventListener('click', async () => {
      if (_quickTxId) { try { await deleteTransaccion(_quickTxId); } catch (_) {} }
      _quickTxId = null; window._modalRefresh = true; _salir();
    });
    document.getElementById('txQuickEditBtn').addEventListener('click', () => {
      document.getElementById('txQuickEditCat').style.display = 'block';
    });
    document.getElementById('txQuickEditSelect').addEventListener('change', async (e) => {
      const nuevo = e.target.value;
      if (!_quickTxId || !nuevo) return;
      try {
        await updateTransaccion(_quickTxId, { categoria_id: nuevo });
        if (typeof autocatLearnTokens === 'function') await autocatLearnTokens(_quickTokens, nuevo);
        // refrescar mensaje
        const cats = await getCategorias(_quickTipo);
        document.getElementById('txQuickConfirmMsg').innerHTML =
          'Actualicé la categoría a <b class="qc-em">' + esc(_nombreCat(nuevo, cats)) + '</b>';
        document.getElementById('txQuickEditCat').style.display = 'none';
      } catch (_) {}
    });
```

- [ ] **Step 6: Chips de plantilla en el panel**

Reusar la lógica de `pintarPlantillas` existente pero apuntando a `#txQuickChips`. Si la función
existente apunta a `#txPlantillas` (dentro del form), generalizarla para pintar también en
`#txQuickChips`. Al tocar un chip: `insertTransaccion` directo → `_mostrarConfirm` con los datos del
chip (tipo/ámbito/categoría/monto). Verificar el nombre real de la función:
`grep -n "pintarPlantillas\|txPlantillas" views/transaccion.html` y reusar.

- [ ] **Step 7: Blur-handler del form usa el matcher nuevo**

Reemplazar el blur-handler actual de `notaEl` (que usa `autocatDict`/`matchAutocat`) por:
```js
    notaEl.addEventListener('blur', async () => {
      if (categoriaEl.value) return;
      if (typeof matchCategoria !== 'function' || typeof tokenize !== 'function' || typeof autocatLearned !== 'function') return;
      if (tipoEl.value === 'ahorro') return;
      const cats = await getCategorias(tipoEl.value);
      const ctx = { learned: await autocatLearned(), categorias: cats.map((c) => ({ id: c.id, nombre: c.nombre })), seed: window.NESTRA_SEED || {} };
      const catId = matchCategoria(tokenize(notaEl.value), ctx);
      if (catId) { categoriaEl.value = catId; categoriaEl.dispatchEvent(new Event('change')); }
    });
```

- [ ] **Step 8: Verificar en navegador** (server local `preview_start nestra`, login con cuenta de prueba)

Abrir el + → panel rápido. Probar `Uber 15` → confirmación "Registré un gasto por S/15.00 en Transporte" (si existe la categoría) → Deshacer / Editar / Listo. `ahorro hogar 50` → ahorro sin categoría. `Más opciones` → form completo. Sin errores en consola.

- [ ] **Step 9: Commit**

```bash
git add views/transaccion.html
git commit -m "feat(quickadd): panel rápido con guardado directo y confirmación (deshacer/editar categoría)"
```
(Cierra con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)

---

## Task 6: frontend-design del panel y la confirmación

**Files:**
- Modify: `views/transaccion.html` (bloque `<style>`)

**Usar el skill `frontend-design`** para pulir. Requisitos concretos:
- `.tx-quick`: input grande y prominente (font-size ≥ 1.1rem, alto cómodo), botón Agregar primario al lado (en móvil puede ir debajo, full-width). `.tx-quick-mas` discreto (link/botón terciario, subrayado sutil).
- `.tx-quick-confirm`: tarjeta con check (usar `assets/tabler-sprite.svg#tabler-circle-check`), mensaje legible. Clase `.qc-em` (las partes resaltadas: monto/tipo/categoría) en **color de acento** (`var(--color-primary)` o success) y `font-weight` fuerte; el resto del texto en color normal. Acciones alineadas, táctiles (≥44px alto).
- Mobile-first; reusar tokens del proyecto (`--space-*`, `--radius-*`, `--color-*`, `--text-*`). Sin librerías nuevas.

- [ ] **Step 1: Añadir estilos** (en el `<style>` de la vista), p.ej.:
```css
.tx-quick { padding: var(--space-sm) 0; }
.tx-quick-label { display:block; font-weight:var(--font-weight-semibold); margin-bottom:var(--space-xs); }
.tx-quick-row { display:flex; gap:var(--space-sm); }
.tx-quick-input { flex:1; font-size:1.1rem; padding:var(--space-sm); }
.tx-quick-add { white-space:nowrap; }
.tx-quick-mas { display:block; margin-top:var(--space-md); background:none; border:none;
  color:var(--text-secondary); text-decoration:underline; cursor:pointer; font-size:var(--font-size-sm); }
.tx-quick-confirm { text-align:center; padding:var(--space-md); }
.tx-quick-confirm-msg { font-size:1.05rem; line-height:1.5; }
.qc-em { color:var(--color-primary); font-weight:var(--font-weight-bold); }
.tx-quick-confirm-actions { display:flex; gap:var(--space-sm); justify-content:center; flex-wrap:wrap; margin-top:var(--space-md); }
@media (max-width: 480px) {
  .tx-quick-row { flex-direction:column; }
  .tx-quick-add { width:100%; }
}
```
> Verificar nombres reales de tokens CSS en `css/base.css` (p.ej. `--color-primary`, `--text-secondary`); ajustar si difieren (usar fallback `var(--color-primary, #...)`).

- [ ] **Step 2: Verificar visual** en navegador (móvil con `preview_resize` 390px y desktop): input prominente, resaltados en color, acciones táctiles, "Más opciones" discreto. `preview_screenshot` como evidencia.

- [ ] **Step 3: Commit**
```bash
git add views/transaccion.html
git commit -m "style(quickadd): frontend-design del panel rápido y la confirmación"
```
(Cierra con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)

---

## Task 7: Quitar la tarjeta `#qaForm` del dashboard

**Files:**
- Modify: `views/dashboard.html`

- [ ] **Step 1: Eliminar markup** — quitar el bloque `<div class="card qa-card"> … </div>` (sección "1.6 Registro rápido", ~líneas 14-21).

- [ ] **Step 2: Eliminar script** — quitar la IIFE `initQuickAdd` completa (~líneas 898+, la que referencia `qaForm`/`parseQuickAdd`/`autocatDict`).

- [ ] **Step 3: Eliminar CSS** — quitar las reglas `.qa-card`/`.qa-form`/`.qa-input`/`.qa-btn` del `<style>`.

- [ ] **Step 4: Verificar**

Run: `grep -n "qaForm\|qa-card\|initQuickAdd\|autocatDict\|categoria_keyword" views/dashboard.html`
Expected: sin resultados.
Cargar el dashboard en navegador → sin la tarjeta y sin errores de consola (el + del FAB hace el quick-add).

- [ ] **Step 5: Commit**
```bash
git add views/dashboard.html
git commit -m "refactor(quickadd): quitar tarjeta quick-add del dashboard (el FAB la reemplaza)"
```
(Cierra con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)

---

## Task 8: Bump SW + deploy

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: Bump versión** — en `sw.js`: `const SHELL_VERSION = 'v11';` → `'v12';`.

- [ ] **Step 2: Suite completa verde**

Run: `node --test test/*.test.mjs`
Expected: PASS (incluye autocat 11 + parse-quickadd 10 + los demás existentes).

- [ ] **Step 3: Commit + push (deploy)**
```bash
git add sw.js
git commit -m "chore(quickadd): bump SHELL_VERSION v12 para refrescar shell"
git push origin v2
```
(Cierra el cuerpo del commit con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)

- [ ] **Step 4: Verificar deploy live**

Run (tras ~1-2 min de build de Pages):
`curl -sL https://nestra-8rl.pages.dev/sw.js | grep -o "SHELL_VERSION = '[^']*'"`
Expected: `SHELL_VERSION = 'v12'`.
`curl -sL https://nestra-8rl.pages.dev/js/autocat.js | grep -c "matchCategoria"` → ≥1.
En el teléfono: cerrar/reabrir la PWA; el + abre el panel rápido.

---

## Self-Review (cobertura del spec)

- FAB → quick-add primero (modo rápido): Task 5 (modo inicial + panel). ✓
- Guardado directo + confirmación (monto/tipo/categoría resaltados): Task 5 (lógica) + Task 6 (estilo). ✓
- Deshacer / Editar categoría (select inline, aprende): Task 5. ✓
- "Más opciones" → form completo: Task 5 (`#txQuickMas` → `_modoForm`). ✓
- Tipo (gasto/ingreso/ahorro) + ámbito (personal/hogar) por keyword: Task 2 (parser). ✓
- Matcher por tokens (3 capas, umbral, empate→null, singular, stopwords): Task 1. ✓
- Sin categoría (gasto/ingreso) → form prellenado; ahorro directo: Task 5 (`_quickAgregar`). ✓
- Aprendizaje por token (IDB v4) online+offline: Task 3 + Task 4. ✓
- Quitar `#qaForm` del dashboard: Task 7. ✓
- Deploy a Pages (ver en teléfono/laptop): Task 8 (push + verificación live). ✓
- frontend-design: Task 6. ✓
- TDD puros: Task 1, Task 2. ✓
- Anti-duplicación: reusa modal, chips, getCategorias, insert/update/deleteTransaccion, normalizeDesc. ✓
