# Fase 3 — Captura Excepcional Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reducir el registro manual de una transacción de ~5 taps a 1, con quick-add parseado, auto-categorización aprendida, plantillas 1-tap, split multi-categoría, undo en toast y foto de recibo — todo offline-first.

**Architecture:** App vanilla sin build. JS por globales (`<script>`) salvo módulos ESM (`type="module"`). Datos vía `js/db.js` → Supabase con espejo IndexedDB + outbox (`js/nestra-db.js`, `js/sync.js`) y LWW por `updated_at`. Funciones puras del parser/matcher en archivos ESM testeados con `node --test`. Split = N transacciones reales con `split_id` (Fase 2 las lee por `categoria_id` sin cambios). Foto = bucket privado Storage, path guardado en `recibo_path`, URL firmada on-demand; offline encola el blob.

**Tech Stack:** HTML/CSS/JS vanilla, Supabase JS v2.108, idb (IndexedDB), Workbox SW, `node:test`.

**Spec:** [docs/superpowers/specs/2026-06-24-fase3-captura-design.md](../specs/2026-06-24-fase3-captura-design.md)

---

## File Structure

**Crear:**
- `supabase/migrations/20260624_fase3_captura.sql` — `split_id`, `recibo_path`, tabla `plantillas`, bucket+RLS `recibos`.
- `js/parse-quickadd.js` — parser puro free-text → `{descripcion, monto, categoria_id, categoria_keyword, fecha}`.
- `js/autocat.js` — `normalizeDesc`, `matchAutocat`, diccionario keyword es-PE.
- `test/parse-quickadd.test.mjs`, `test/autocat.test.mjs` — tablas de casos.

**Modificar:**
- `js/nestra-db.js` — IndexedDB v3: store `autocat`, `recibos_pendientes`, mirror `plantillas`.
- `js/db.js` — helpers: plantillas CRUD, autocat learn/lookup, recibo queue, `insertSplit`, `deleteSplit`.
- `js/sync.js` — branch outbox `recibo` (upload diferido a Storage).
- `views/dashboard.html` — zona quick-add + chips de plantilla.
- `views/transaccion.html` — autocat prefill, chips plantilla, toggle split, input foto.
- `views/historial.html` — undo en toast, agrupado por `split_id`, thumbnail recibo.
- `views/configuracion.html` — gestión CRUD de plantillas.
- `index.html` — `<script>` de `parse-quickadd.js`, `autocat.js`.
- `sw.js` — precache nuevos JS + bump `SHELL_VERSION` v9→v10.

---

## Convenciones del codebase (leer antes de empezar)

- **Globales vs ESM:** archivos puros testeables exponen `export {…}` Y `if (typeof window!=='undefined') window.x = x;` (patrón de [js/share-parse.js](../../../js/share-parse.js)). Se cargan como `<script type="module">`.
- **db.js:** funciones globales (sin import). Escrituras devuelven la fila o lanzan. Patrón offline: si `!navigator.onLine` o `_isNetworkError(err)` → `outboxAdd(entity, fila)` + `mirrorPut` con `_pending:true` + `notifyPendingChanged()`. Ver `insertTransaccion` ([js/db.js:138](../../../js/db.js)).
- **IndexedDB:** `js/nestra-db.js`. Subir `NESTRA_IDB_VERSION` y crear stores en `upgrade()` condicionalmente.
- **Tests:** `node --test test/<archivo>.test.mjs`. Importan de `../js/*.js`. Patrón en [test/share-parse.test.mjs](../../../test/share-parse.test.mjs).
- **Nuevos JS:** registrar `<script>` en `index.html` (orden: tras `db.js`) Y en `sw.js` PRECACHE, y **bump `SHELL_VERSION`**.
- **NO duplicar:** reusar `parseSharedMonto`/`_normalizeNum`, `mostrarToast(onAccion)`, patrón `aporte_id`, `iconoCategoria`.

---

## Task 1: Migración SQL + Storage

**Files:**
- Create: `supabase/migrations/20260624_fase3_captura.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- Fase 3: captura excepcional — split, recibo, plantillas, bucket recibos.

-- 1. transacciones: split_id + recibo_path
alter table public.transacciones add column if not exists split_id    uuid;
alter table public.transacciones add column if not exists recibo_path text;
create index if not exists idx_transacciones_split_id on public.transacciones (split_id);

-- 2. plantillas
create table if not exists public.plantillas (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  nombre       text not null,
  monto        numeric(10,2) not null check (monto > 0),
  categoria_id uuid references public.categorias (id) on delete cascade,
  tipo         text not null default 'gasto' check (tipo in ('gasto','ingreso','ahorro')),
  ambito       text not null default 'personal' check (ambito in ('personal','hogar')),
  orden        int  not null default 0,
  updated_at   timestamptz not null default now()
);
create index if not exists idx_plantillas_user_id on public.plantillas (user_id);

alter table public.plantillas enable row level security;
create policy "plantillas_select" on public.plantillas for select to authenticated
  using (user_id = (select auth.uid()));
create policy "plantillas_insert" on public.plantillas for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "plantillas_update" on public.plantillas for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "plantillas_delete" on public.plantillas for delete to authenticated
  using (user_id = (select auth.uid()));

drop trigger if exists trg_plantillas_updated_at on public.plantillas;
create trigger trg_plantillas_updated_at before update on public.plantillas
  for each row execute function public.set_updated_at();

-- 3. bucket privado recibos
insert into storage.buckets (id, name, public)
values ('recibos', 'recibos', false)
on conflict (id) do nothing;

create policy "recibos_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'recibos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "recibos_select" on storage.objects for select to authenticated
  using (bucket_id = 'recibos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "recibos_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'recibos' and (storage.foldername(name))[1] = (select auth.uid())::text);
```

> **Nota:** confirmar el nombre real de la función del trigger `updated_at` en
> `supabase/migrations/20260621_updated_at_lww.sql` (aquí se asume `public.set_updated_at()`).
> Si difiere, ajustar la línea del trigger.

- [ ] **Step 2: Verificar nombre de la función trigger**

Run: `grep -rn "create.*function.*updated_at\|set_updated_at\|trg_.*updated_at" supabase/migrations/20260621_updated_at_lww.sql supabase/schema_v2_fresh.sql`
Expected: ver el nombre exacto. Ajustar el `execute function` del Step 1 si es distinto.

- [ ] **Step 3: Aplicar la migración** (manual por el usuario en Supabase, o vía MCP `apply_migration`).

Expected: tabla `plantillas` creada, columnas nuevas en `transacciones`, bucket `recibos` privado, 6 policies nuevas.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260624_fase3_captura.sql
git commit -m "feat(fase3): migración split_id, recibo_path, plantillas y bucket recibos"
```

---

## Task 2: Parser puro `parse-quickadd.js` (TDD)

**Files:**
- Create: `js/parse-quickadd.js`, `js/autocat.js` (autocat se completa en Task 3, aquí solo `normalizeDesc`)
- Test: `test/parse-quickadd.test.mjs`

- [ ] **Step 1: Escribir el test fallido**

```js
// test/parse-quickadd.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from '../js/parse-quickadd.js';

const KW = { uber:'Transporte', taxi:'Transporte', almuerzo:'Comida', cine:'Ocio' };
const HOY = '2026-06-24';
const base = (text, autocat={}) => parseQuickAdd(text, { hoy: HOY, keywords: KW, autocat });

test('monto simple + descripción', () => {
  const r = base('Uber 15');
  assert.equal(r.monto, 15);
  assert.equal(r.descripcion, 'Uber');
  assert.equal(r.categoria_keyword, 'Transporte');
  assert.equal(r.fecha, HOY);
});

test('decimal con punto y S/', () => {
  const r = base('S/12.50 almuerzo');
  assert.equal(r.monto, 12.5);
  assert.equal(r.categoria_keyword, 'Comida');
  assert.equal(r.descripcion, 'almuerzo');
});

test('decimal con coma', () => {
  assert.equal(base('taxi S/ 7,50 anteayer').monto, 7.5);
});

test('fecha relativa ayer', () => {
  assert.equal(base('15 taxi ayer').fecha, '2026-06-23');
});

test('fecha relativa anteayer', () => {
  assert.equal(base('taxi S/ 7,50 anteayer').fecha, '2026-06-22');
});

test('multi-palabra y espacios colapsados', () => {
  const r = base('  café   con   leche 8 ');
  assert.equal(r.monto, 8);
  assert.equal(r.descripcion, 'café con leche');
});

test('varios números sin S/ → el mayor', () => {
  assert.equal(base('cine 2 entradas 40').monto, 40);
});

test('con S/ gana el número de S/ aunque haya otro mayor', () => {
  assert.equal(base('combo 100 puntos S/ 30').monto, 30);
});

test('sin monto → monto null (parse fallido)', () => {
  assert.equal(base('recarga').monto, null);
});

test('categoría desde autocat tiene prioridad sobre keyword', () => {
  const r = base('uber 10', { uber: 'cat-uuid-1' });
  assert.equal(r.categoria_id, 'cat-uuid-1');
});

test('sin categoría inferible → categoria_id null', () => {
  const r = base('chuches 5');
  assert.equal(r.categoria_id, null);
  assert.equal(r.categoria_keyword, null);
});

test('nunca lanza con entrada vacía/null', () => {
  assert.equal(parseQuickAdd('', { hoy: HOY }).monto, null);
  assert.equal(parseQuickAdd(null, { hoy: HOY }).monto, null);
});
```

- [ ] **Step 2: Correr el test → debe fallar**

Run: `node --test test/parse-quickadd.test.mjs`
Expected: FAIL — `Cannot find module '../js/parse-quickadd.js'`.

- [ ] **Step 3: Implementar `parse-quickadd.js`**

```js
// js/parse-quickadd.js — parser de reglas para quick-add (free-text → transacción).
// Sin AI. Reusa _normalizeNum de share-parse (re-implementado local para no acoplar import).
// Carga: <script type="module"> (expone window.parseQuickAdd) y ESM en Node.
import { normalizeDesc } from './autocat.js';

function _normalizeNum(raw) {
  let s = String(raw).replace(/\s/g, '');
  const hasDot = s.includes('.'), hasComma = s.includes(',');
  if (hasDot && hasComma) {
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const tho = dec === '.' ? ',' : '.';
    s = s.split(tho).join('');
    if (dec === ',') s = s.replace(',', '.');
  } else if (hasComma) {
    if (/,\d{1,2}$/.test(s)) s = s.replace(',', '.');
    else s = s.split(',').join('');
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function _addDays(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

const _FECHAS = { hoy: 0, ayer: -1, anteayer: -2, 'mañana': 1, manana: 1 };

function parseQuickAdd(text, opts = {}) {
  const hoy = opts.hoy;
  const keywords = opts.keywords || {};
  const autocat = opts.autocat || {};
  const out = { descripcion: null, monto: null, categoria_id: null, categoria_keyword: null, fecha: hoy };
  if (text == null) return out;
  let str = String(text).trim();
  if (!str) return out;

  // 1. Fecha relativa: token aislado.
  let fecha = hoy;
  str = str.replace(/\b(anteayer|ayer|hoy|mañana|manana)\b/i, (m) => {
    fecha = _addDays(hoy, _FECHAS[m.toLowerCase()] ?? 0);
    return ' ';
  });
  out.fecha = fecha;

  // 2. Monto. Si hay S/<num>, ese gana. Si no, el mayor número plausible.
  let monto = null;
  const conS = str.match(/S\/\.?\s*([\d.,]+)/i);
  if (conS) {
    monto = _normalizeNum(conS[1]);
    str = str.replace(conS[0], ' ');
  } else {
    const nums = str.match(/\d[\d.,]*\d|\d/g) || [];
    let best = null, bestRaw = null;
    for (const raw of nums) {
      const n = _normalizeNum(raw);
      if (n != null && (best == null || n > best)) { best = n; bestRaw = raw; }
    }
    monto = best;
    if (bestRaw != null) {
      // quita SOLO la primera aparición del token elegido
      str = str.replace(bestRaw, ' ');
    }
  }
  out.monto = (monto != null && monto > 0) ? monto : null;

  // 3. Descripción: lo que queda, sin S/ sobrante, espacios colapsados.
  let desc = str.replace(/S\/\.?/ig, ' ').replace(/\s+/g, ' ').trim();
  out.descripcion = desc || null;

  // 4. Categoría: autocat (por desc normalizada) tiene prioridad; luego keyword substring.
  const descNorm = normalizeDesc(desc);
  if (descNorm && autocat[descNorm]) {
    out.categoria_id = autocat[descNorm];
  } else if (descNorm) {
    for (const kw in keywords) {
      if (descNorm.includes(normalizeDesc(kw))) { out.categoria_keyword = keywords[kw]; break; }
    }
  }
  return out;
}

if (typeof window !== 'undefined') { window.parseQuickAdd = parseQuickAdd; }
export { parseQuickAdd };
```

> Depende de `normalizeDesc` (Task 3 Step 3 lo crea). Implementar primero el `normalizeDesc` mínimo en `js/autocat.js`:
> ```js
> // js/autocat.js (mínimo para Task 2; se amplía en Task 3)
> function normalizeDesc(s) {
>   return String(s ?? '').toLowerCase().normalize('NFD')
>     .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
> }
> if (typeof window !== 'undefined') { window.normalizeDesc = normalizeDesc; }
> export { normalizeDesc };
> ```

- [ ] **Step 4: Correr el test → debe pasar**

Run: `node --test test/parse-quickadd.test.mjs`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add js/parse-quickadd.js js/autocat.js test/parse-quickadd.test.mjs
git commit -m "feat(fase3): parser puro quick-add con tabla de casos (TDD)"
```

---

## Task 3: Matcher `autocat.js` (TDD)

**Files:**
- Modify: `js/autocat.js`
- Test: `test/autocat.test.mjs`

- [ ] **Step 1: Escribir el test fallido**

```js
// test/autocat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDesc, matchAutocat, KEYWORDS } from '../js/autocat.js';

test('normalizeDesc quita tildes, baja caja, colapsa espacios', () => {
  assert.equal(normalizeDesc('  Café  CON Leche '), 'cafe con leche');
});

test('match exacto', () => {
  assert.equal(matchAutocat('uber', { uber: 'c1' }), 'c1');
});

test('match por substring (clave del dict dentro de la desc)', () => {
  assert.equal(matchAutocat('uber eats', { uber: 'c1' }), 'c1');
});

test('sin match → null', () => {
  assert.equal(matchAutocat('chuches', { uber: 'c1' }), null);
});

test('exacto gana sobre substring', () => {
  assert.equal(matchAutocat('taxi', { taxi: 'cT', 'taxi aeropuerto': 'cA' }), 'cT');
});

test('KEYWORDS incluye categorías es-PE base', () => {
  assert.equal(KEYWORDS.uber, 'Transporte');
  assert.equal(KEYWORDS.almuerzo, 'Comida');
});
```

- [ ] **Step 2: Correr → debe fallar**

Run: `node --test test/autocat.test.mjs`
Expected: FAIL — `matchAutocat`/`KEYWORDS` no exportados.

- [ ] **Step 3: Ampliar `js/autocat.js`**

```js
// js/autocat.js — normalización + matcher determinista descripcion→categoria.
// Sin fuzzy. Carga: <script type="module"> (window.*) y ESM en Node.

function normalizeDesc(s) {
  return String(s ?? '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

// matchAutocat(descNorm, dict) → categoria_id o null.
// dict: { descNormGuardada: categoria_id }. Exacto primero; luego una clave
// del dict que sea substring de descNorm. Sin Levenshtein.
function matchAutocat(descNorm, dict) {
  if (!descNorm || !dict) return null;
  if (dict[descNorm]) return dict[descNorm];
  for (const key in dict) {
    if (key && descNorm.includes(key)) return dict[key];
  }
  return null;
}

// Diccionario keyword → NOMBRE de categoría (es-PE). Ampliable.
const KEYWORDS = {
  uber:'Transporte', taxi:'Transporte', pasaje:'Transporte', combi:'Transporte',
  metro:'Transporte', gasolina:'Transporte',
  almuerzo:'Comida', cena:'Comida', desayuno:'Comida', 'café':'Comida',
  cafe:'Comida', 'menú':'Comida', menu:'Comida', restaurante:'Comida',
  mercado:'Mercado', super:'Mercado', verdura:'Mercado',
  luz:'Servicios', agua:'Servicios', internet:'Servicios', recarga:'Servicios',
  celular:'Servicios',
  farmacia:'Salud', 'clínica':'Salud', clinica:'Salud',
  cine:'Ocio', bar:'Ocio',
};

if (typeof window !== 'undefined') {
  window.normalizeDesc = normalizeDesc;
  window.matchAutocat = matchAutocat;
  window.NESTRA_KEYWORDS = KEYWORDS;
}
export { normalizeDesc, matchAutocat, KEYWORDS };
```

- [ ] **Step 4: Correr ambos tests → pasan**

Run: `node --test test/autocat.test.mjs test/parse-quickadd.test.mjs`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add js/autocat.js test/autocat.test.mjs
git commit -m "feat(fase3): matcher autocat determinista + diccionario es-PE (TDD)"
```

---

## Task 4: IndexedDB v3 + registro de scripts

**Files:**
- Modify: `js/nestra-db.js`, `index.html`, `sw.js`

- [ ] **Step 1: Subir versión IDB y crear stores**

En `js/nestra-db.js`:
- Cambiar `const NESTRA_IDB_VERSION = 2;` → `= 3;`
- Cambiar `MIRROR_STORES = [...,'presupuestos'];` → añadir `'plantillas'`.
- En `upgrade(db)`, tras el bloque de `outbox`, añadir:

```js
        if (!db.objectStoreNames.contains('autocat')) {
          db.createObjectStore('autocat', { keyPath: 'desc_norm' });
        }
        if (!db.objectStoreNames.contains('recibos_pendientes')) {
          db.createObjectStore('recibos_pendientes', { keyPath: 'transaccion_id' });
        }
```

- Añadir helpers al final (antes de los `window.*`):

```js
// ── autocat: diccionario descripcion→categoria aprendido ──────
async function autocatLearn(descNorm, categoriaId) {
  if (!descNorm || !categoriaId) return;
  try {
    const db = await nestraDB();
    const prev = await db.get('autocat', descNorm);
    await db.put('autocat', {
      desc_norm: descNorm, categoria_id: categoriaId,
      count: (prev && prev.count || 0) + 1, updated_at: new Date().toISOString(),
    });
  } catch (err) { console.error('autocatLearn falló:', err); }
}
async function autocatDict() {
  try {
    const db = await nestraDB();
    const all = await db.getAll('autocat');
    const dict = {};
    for (const r of all) dict[r.desc_norm] = r.categoria_id;
    return dict;
  } catch (err) { console.error('autocatDict falló:', err); return {}; }
}
// ── recibos pendientes (foto offline) ──────────────────────────
async function reciboQueueAdd(transaccionId, blob, userId) {
  const db = await nestraDB();
  await db.put('recibos_pendientes', { transaccion_id: transaccionId, blob, user_id: userId, created_at: new Date().toISOString() });
}
async function reciboQueueGet(transaccionId) {
  const db = await nestraDB();
  return await db.get('recibos_pendientes', transaccionId);
}
async function reciboQueueRemove(transaccionId) {
  const db = await nestraDB();
  await db.delete('recibos_pendientes', transaccionId);
}
```

- Añadir a los exports `window.*`:

```js
window.autocatLearn = autocatLearn;
window.autocatDict = autocatDict;
window.reciboQueueAdd = reciboQueueAdd;
window.reciboQueueGet = reciboQueueGet;
window.reciboQueueRemove = reciboQueueRemove;
```

- [ ] **Step 2: Registrar nuevos JS en `index.html`**

Tras la línea `<script src="js/db.js"></script>` (`index.html:199`), añadir:

```html
    <script type="module" src="js/autocat.js"></script>
    <script type="module" src="js/parse-quickadd.js"></script>
```

- [ ] **Step 3: Precache + bump versión en `sw.js`**

- Cambiar `const SHELL_VERSION = 'v9';` → `'v10'`.
- En el array PRECACHE, tras `{ url: 'js/share-parse.js', revision: SHELL_VERSION },` añadir:

```js
  { url: 'js/autocat.js', revision: SHELL_VERSION },
  { url: 'js/parse-quickadd.js', revision: SHELL_VERSION },
```

- [ ] **Step 4: Verificar carga sin error**

Levantar server (Task 11 da el comando) y en consola del navegador: `typeof window.parseQuickAdd === 'function' && typeof window.autocatDict === 'function'`.
Expected: `true`. Sin errores de IDB upgrade.

- [ ] **Step 5: Commit**

```bash
git add js/nestra-db.js index.html sw.js
git commit -m "feat(fase3): IndexedDB v3 (autocat, recibos_pendientes, plantillas) + registro scripts, precache v10"
```

---

## Task 5: Helpers `db.js` — plantillas, split, recibo, autocat en insert

**Files:**
- Modify: `js/db.js`

- [ ] **Step 1: Aprender autocat tras insertar (modificar `insertTransaccion`)**

En `insertTransaccion` ([js/db.js:138](../../../js/db.js)), tras obtener `data` exitoso (rama online, antes de `return data;`) y también en la rama offline (sobre `fila`), aprender la categoría:

En la rama online, tras `await mirrorPut('transacciones', data);`:
```js
    if (typeof autocatLearn === 'function' && data.nota && data.categoria_id) {
      const dn = (typeof normalizeDesc === 'function') ? normalizeDesc(data.nota) : null;
      if (dn) await autocatLearn(dn, data.categoria_id);
    }
```
(No hace falta aprender en offline; se aprenderá al ver la tx ya guardada. YAGNI.)

- [ ] **Step 2: Añadir CRUD de plantillas + split + recibo helpers**

Al final de `js/db.js`, antes de cualquier export final (el archivo usa globales; solo añadir funciones):

```js
// ═══════════════════════════════════════════════════════════════════
// PLANTILLAS (Fase 3)
// ═══════════════════════════════════════════════════════════════════
async function getPlantillas() {
  return await _mirroredRead('plantillas', async () => {
    const { data, error } = await supabase.from('plantillas').select('*').order('orden');
    if (error) throw error;
    return data || [];
  });
}
async function insertPlantilla(datos) {
  const userId = _requireUserId();
  const fila = {
    id: crypto.randomUUID(), user_id: userId,
    nombre: datos.nombre, monto: datos.monto,
    categoria_id: datos.categoria_id ?? null,
    tipo: datos.tipo || 'gasto', ambito: datos.ambito || 'personal',
    orden: datos.orden ?? 0, updated_at: new Date().toISOString(),
  };
  if (!navigator.onLine) {
    await outboxAdd('plantillas', fila);
    await mirrorPut('plantillas', { ...fila, _pending: true });
    if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
    return { ...fila, _pending: true };
  }
  try {
    const { data, error } = await supabase.from('plantillas').insert(fila).select().single();
    if (error) throw error;
    await mirrorPut('plantillas', data);
    return data;
  } catch (err) {
    if (_isNetworkError(err)) {
      await outboxAdd('plantillas', fila);
      await mirrorPut('plantillas', { ...fila, _pending: true });
      if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
      return { ...fila, _pending: true };
    }
    console.error('Error en insertPlantilla():', err.message || err); throw err;
  }
}
async function deletePlantilla(id) {
  try {
    const { error } = await supabase.from('plantillas').delete().eq('id', id);
    if (error) throw error;
    const db = await nestraDB(); await db.delete('plantillas', id);
  } catch (err) { console.error('Error en deletePlantilla():', err.message || err); throw err; }
}

// ═══════════════════════════════════════════════════════════════════
// SPLIT (Fase 3) — N transacciones con el mismo split_id
// ═══════════════════════════════════════════════════════════════════
// lineas: [{ categoria_id, monto }]. Comparten tipo/ambito/fecha/nota.
async function insertSplit(comun, lineas) {
  const splitId = crypto.randomUUID();
  const creadas = [];
  for (const ln of lineas) {
    const row = await insertTransaccion({
      tipo: comun.tipo, ambito: comun.ambito,
      categoria_id: ln.categoria_id, monto: ln.monto,
      fecha: comun.fecha, nota: comun.nota,
    });
    // marca el split_id (insertTransaccion no lo conoce): patch local + outbox/online.
    row.split_id = splitId;
    await updateTransaccion(row.id, { split_id: splitId });
    creadas.push(row);
  }
  return { split_id: splitId, transacciones: creadas };
}
async function deleteSplit(splitId) {
  const todas = await getTransacciones();
  const ids = todas.filter((t) => t.split_id === splitId).map((t) => t.id);
  for (const id of ids) await deleteTransaccion(id);
}

// ═══════════════════════════════════════════════════════════════════
// RECIBO (Fase 3) — Storage privado, path = {user_id}/{tx_id}.webp
// ═══════════════════════════════════════════════════════════════════
async function subirRecibo(transaccionId, blob) {
  const userId = _requireUserId();
  const path = `${userId}/${transaccionId}.webp`;
  if (!navigator.onLine) {
    await reciboQueueAdd(transaccionId, blob, userId);
    await outboxAdd('recibo', { id: transaccionId, transaccion_id: transaccionId, path });
    if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
    return { path, _pending: true };
  }
  try {
    const { error } = await supabase.storage.from('recibos')
      .uploadBinary ? await supabase.storage.from('recibos').uploadBinary(path, blob, { contentType: 'image/webp', upsert: true })
                    : await supabase.storage.from('recibos').upload(path, blob, { contentType: 'image/webp', upsert: true });
    if (error) throw error;
    await updateTransaccion(transaccionId, { recibo_path: path });
    return { path };
  } catch (err) {
    if (_isNetworkError(err)) {
      await reciboQueueAdd(transaccionId, blob, userId);
      await outboxAdd('recibo', { id: transaccionId, transaccion_id: transaccionId, path });
      if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
      return { path, _pending: true };
    }
    console.error('Error en subirRecibo():', err.message || err); throw err;
  }
}
async function getReciboUrl(path) {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from('recibos').createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  } catch (err) { console.error('getReciboUrl falló:', err.message || err); return null; }
}
```

> **Nota técnica:** el browser JS client de Supabase usa `.upload(path, fileOrBlob, opts)`.
> `uploadBinary` es de SDKs no-JS. El operador ternario arriba es feo — al implementar,
> **usar directamente** `await supabase.storage.from('recibos').upload(path, blob, { contentType: 'image/webp', upsert: true })`
> y borrar la rama `uploadBinary`. Se deja la nota para no copiar mal.

- [ ] **Step 3: Exponer helpers (si el archivo declara `window.*` al final)**

Verificar el patrón de export de `db.js`:
Run: `grep -n "window\.\(getTransacciones\|insertTransaccion\)" js/db.js`
- Si las funciones se exponen vía `window.x = x`, añadir las nuevas igual. Si son globales por hoisting (función top-level sin `window.`), no hace falta. Replicar el patrón existente exactamente.

- [ ] **Step 4: Smoke test en consola** (con server corriendo, autenticado)

`await getPlantillas()` → `[]` o filas. `await insertPlantilla({nombre:'Test',monto:2,categoria_id:null})` → fila. Luego `await deletePlantilla(<id>)`.
Expected: sin error; aparece/desaparece en `await getPlantillas()`.

- [ ] **Step 5: Commit**

```bash
git add js/db.js
git commit -m "feat(fase3): db helpers plantillas, split (split_id), recibo Storage + aprende autocat"
```

---

## Task 6: Sync branch para foto diferida

**Files:**
- Modify: `js/sync.js`

- [ ] **Step 1: Manejar `entity === 'recibo'` en `_replayOp`**

En `js/sync.js`, al inicio de `_replayOp(op)` (antes de `const server = ...`), añadir:

```js
  if (op.entity === 'recibo') {
    try {
      const pend = await reciboQueueGet(op.payload.transaccion_id);
      if (!pend || !pend.blob) return 'done'; // ya subido o sin blob
      const { error } = await supabase.storage.from('recibos')
        .upload(op.payload.path, pend.blob, { contentType: 'image/webp', upsert: true });
      if (error) throw error;
      await supabase.from('transacciones')
        .update({ recibo_path: op.payload.path, updated_at: new Date().toISOString() })
        .eq('id', op.payload.transaccion_id);
      await reciboQueueRemove(op.payload.transaccion_id);
      return 'done';
    } catch (err) {
      if (!navigator.onLine || /failed to fetch|networkerror|load failed/i.test((err && err.message) + '')) return 'retry';
      console.error('Sync recibo falló:', err.message || err);
      await outboxSetStatus(op.op_id, 'error', (err && err.message) + '');
      return 'skip';
    }
  }
```

- [ ] **Step 2: Verificar offline→online**

Manual (Task 11): adjuntar foto offline → ver `recibos_pendientes` en IDB + badge pendiente → volver online → `syncOutbox` sube y `recibo_path` queda seteado.
Expected: blob desaparece de `recibos_pendientes`, thumbnail carga vía signed URL.

- [ ] **Step 3: Commit**

```bash
git add js/sync.js
git commit -m "feat(fase3): sync branch para upload diferido de recibo a Storage"
```

---

## Task 7: Quick-add UI en dashboard

**Files:**
- Modify: `views/dashboard.html`

- [ ] **Step 1: Añadir la zona quick-add (HTML)**

Cerca del top del dashboard (tras el hero safe-to-spend), añadir:

```html
<div class="card qa-card">
  <form id="qaForm" class="qa-form" autocomplete="off">
    <input type="text" id="qaInput" class="qa-input" inputmode="text"
           placeholder='Ej: "Uber 15", "almuerzo S/12.50 ayer"' aria-label="Registro rápido" />
    <button type="submit" class="btn btn-primary qa-btn" aria-label="Agregar">+</button>
  </form>
  <div id="qaChips" class="qa-chips" aria-label="Plantillas frecuentes"></div>
</div>
```

- [ ] **Step 2: Lógica del quick-add (script del dashboard)**

En el `<script>` del dashboard, tras cargar datos:

```js
(function initQuickAdd() {
  const form = document.getElementById('qaForm');
  const input = document.getElementById('qaInput');
  if (!form) return;
  const hoyISO = () => { const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const txt = input.value.trim();
    if (!txt) return;
    const autocat = (typeof autocatDict === 'function') ? await autocatDict() : {};
    const keywords = (typeof window.NESTRA_KEYWORDS === 'object') ? window.NESTRA_KEYWORDS : {};
    const parsed = parseQuickAdd(txt, { hoy: hoyISO(), keywords, autocat });
    // Resolver categoria_keyword (nombre) → categoria_id real
    if (!parsed.categoria_id && parsed.categoria_keyword) {
      const cats = await getCategorias();
      const hit = cats.find((c) => c.nombre.toLowerCase() === parsed.categoria_keyword.toLowerCase());
      if (hit) parsed.categoria_id = hit.id;
    }
    // Abrir el form de transacción prellenado como PREVIEW editable.
    window._editTx = null;
    window._quickAddPrefill = {
      tipo: 'gasto', ambito: 'personal',
      categoria_id: parsed.categoria_id || '', monto: parsed.monto || '',
      nota: parsed.descripcion || '', fecha: parsed.fecha,
      _forceCategoriaPick: !parsed.categoria_id,
    };
    input.value = '';
    if (typeof abrirModalTransaccion === 'function') abrirModalTransaccion();
    else window.location.hash = '#transaccion';
  });
})();
```

> `getCategorias` ya existe en `db.js` (verificar con `grep -n "function getCategorias" js/db.js`).
> El form de transacción debe leer `window._quickAddPrefill` (Task 8 Step 2).

- [ ] **Step 3: Estilos qa-card** (añadir al `<style>` del dashboard)

```css
.qa-card { padding: var(--space-md); }
.qa-form { display: flex; gap: var(--space-sm); }
.qa-input { flex: 1; }
.qa-btn { min-width: 48px; font-size: 1.4rem; line-height: 1; }
.qa-chips { display: flex; flex-wrap: wrap; gap: var(--space-xs); margin-top: var(--space-sm); }
```

- [ ] **Step 4: Verificar en navegador**

Escribir `Uber 15` → enviar → abre modal con monto 15, nota "Uber", categoría Transporte si existe.
Expected: preview editable correcto; `recarga` (sin monto) abre modal con monto vacío.

- [ ] **Step 5: Commit**

```bash
git add views/dashboard.html
git commit -m "feat(fase3): quick-add parseado en dashboard con preview editable"
```

---

## Task 8: Preview/prefill + autocat prefill + chips en form de transacción

**Files:**
- Modify: `views/transaccion.html`

- [ ] **Step 1: Verificar dónde el form lee prefills existentes**

Run: `grep -n "_editTx\|_quickAddPrefill\|window\._sharedPrefill\|sp\.\|abrirModalTransaccion" views/transaccion.html`
Expected: localizar el bloque que rellena el form (hay manejo de `editTx` y share prefill ~líneas 840-860).

- [ ] **Step 2: Aplicar `_quickAddPrefill`**

En el bloque de inicialización del form (junto al manejo de `editTx`), añadir tras él:

```js
    const qp = window._quickAddPrefill;
    if (qp) {
      tipoEl.value = qp.tipo || 'gasto';
      if (qp.monto) montoEl.value = qp.monto;
      if (qp.nota) notaEl.value = qp.nota;
      if (qp.fecha) document.getElementById('fecha').value = qp.fecha;
      if (qp.categoria_id) { categoriaEl.value = qp.categoria_id; categoriaEl.dispatchEvent(new Event('change')); }
      else if (qp._forceCategoriaPick) {
        document.getElementById('categoriaGroup').classList.add('tx-cat-needed');
      }
      window._quickAddPrefill = null;
    }
```

Añadir CSS en el `<style>`:
```css
.tx-cat-needed select { outline: 2px solid var(--color-warning); outline-offset: 2px; }
```

- [ ] **Step 3: Autocat prefill al escribir la nota**

Tras el listener de `notaEl` existente (o añadir uno), prellenar categoría si la desc ya fue vista:

```js
    notaEl.addEventListener('blur', async () => {
      if (categoriaEl.value) return; // no pisar elección manual
      if (typeof autocatDict !== 'function' || typeof matchAutocat !== 'function') return;
      const dict = await autocatDict();
      const catId = matchAutocat(normalizeDesc(notaEl.value), dict);
      if (catId) { categoriaEl.value = catId; categoriaEl.dispatchEvent(new Event('change')); }
    });
```

- [ ] **Step 4: Chips de plantilla 1-tap en el form**

Tras el grupo de tipo (o arriba del form), añadir contenedor:
```html
<div id="txPlantillas" class="tx-plantillas" aria-label="Plantillas"></div>
```
Y lógica (en init del form):
```js
    (async function pintarPlantillas() {
      const cont = document.getElementById('txPlantillas');
      if (!cont || typeof getPlantillas !== 'function') return;
      const ps = await getPlantillas();
      cont.innerHTML = ps.map((p) =>
        `<button type="button" class="chip chip-plantilla" data-id="${p.id}">${esc ? esc(p.nombre) : p.nombre} · S/${p.monto}</button>`
      ).join('');
      cont.querySelectorAll('[data-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const p = ps.find((x) => String(x.id) === btn.dataset.id);
          if (!p) return;
          btn.disabled = true;
          try {
            await insertTransaccion({ tipo: p.tipo, ambito: p.ambito, categoria_id: p.categoria_id, monto: p.monto, nota: p.nombre });
            if (typeof mostrarExito === 'function') mostrarExito(p.categoria_id);
          } catch (_) { btn.disabled = false; }
        });
      });
    })();
```

> Si `esc` no existe en este archivo, usar el nombre directamente (los nombres de plantilla
> son del propio usuario). Verificar: `grep -n "function esc" views/transaccion.html`.

CSS:
```css
.tx-plantillas { display:flex; flex-wrap:wrap; gap:var(--space-xs); margin-bottom:var(--space-md); }
.chip-plantilla { cursor:pointer; }
```

- [ ] **Step 5: Verificar**

Quick-add prefill llega correcto; escribir una nota ya usada autocompleta categoría; tap en chip de plantilla crea tx y muestra éxito.
Expected: los 3 flujos OK.

- [ ] **Step 6: Commit**

```bash
git add views/transaccion.html
git commit -m "feat(fase3): prefill quick-add, autocat prefill por nota y chips de plantilla 1-tap"
```

---

## Task 9: Split multi-categoría

**Files:**
- Modify: `views/transaccion.html`, `views/historial.html`

- [ ] **Step 1: UI de split en el form**

Tras el grupo de monto/fecha, añadir toggle + contenedor de líneas:
```html
<div class="form-group tx-split-toggle">
  <label><input type="checkbox" id="txSplitOn"> Dividir en varias categorías</label>
</div>
<div id="txSplitBox" class="tx-split-box" style="display:none;">
  <div id="txSplitLineas"></div>
  <button type="button" class="btn btn-secondary btn-small" id="txSplitAdd">+ Línea</button>
  <p class="form-hint">Suma líneas: <span id="txSplitSuma">0.00</span> / <span id="txSplitTotal">0.00</span></p>
  <span id="txSplitError" class="form-error" role="alert" style="display:none;"></span>
</div>
```

- [ ] **Step 2: Lógica de líneas + validación**

```js
    (function initSplit() {
      const on = document.getElementById('txSplitOn');
      const box = document.getElementById('txSplitBox');
      const lineasEl = document.getElementById('txSplitLineas');
      const sumaEl = document.getElementById('txSplitSuma');
      const totalEl = document.getElementById('txSplitTotal');
      if (!on) return;
      window._splitActivo = false;
      const catOptions = () => categoriaEl.innerHTML; // reusa las opciones ya cargadas
      function addLinea() {
        const div = document.createElement('div');
        div.className = 'tx-split-linea';
        div.innerHTML = `<select class="sp-cat">${catOptions()}</select>` +
          `<input type="number" class="sp-monto" step="0.01" min="0.01" placeholder="0.00">` +
          `<button type="button" class="sp-del" aria-label="Quitar">×</button>`;
        lineasEl.appendChild(div);
        div.querySelector('.sp-del').onclick = () => { div.remove(); recalc(); };
        div.querySelector('.sp-monto').addEventListener('input', recalc);
        recalc();
      }
      function recalc() {
        let s = 0;
        lineasEl.querySelectorAll('.sp-monto').forEach((i) => { s += parseFloat(i.value) || 0; });
        sumaEl.textContent = s.toFixed(2);
        totalEl.textContent = (parseFloat(montoEl.value) || 0).toFixed(2);
      }
      on.addEventListener('change', () => {
        window._splitActivo = on.checked;
        box.style.display = on.checked ? '' : 'none';
        document.getElementById('categoriaGroup').style.display = on.checked ? 'none' : '';
        if (on.checked && !lineasEl.children.length) { addLinea(); addLinea(); }
        recalc();
      });
      document.getElementById('txSplitAdd').onclick = addLinea;
      montoEl.addEventListener('input', recalc);
      window._leerSplit = function () {
        const lineas = [];
        lineasEl.querySelectorAll('.tx-split-linea').forEach((d) => {
          const cat = d.querySelector('.sp-cat').value;
          const m = parseFloat(d.querySelector('.sp-monto').value);
          if (cat && m > 0) lineas.push({ categoria_id: cat, monto: m });
        });
        return lineas;
      };
    })();
```

- [ ] **Step 3: Guardar split en el submit**

En el handler de submit del form, antes de la rama normal de `insertTransaccion`, añadir:

```js
      if (window._splitActivo) {
        const lineas = window._leerSplit();
        const total = parseFloat(montoEl.value) || 0;
        const suma = lineas.reduce((a, l) => a + l.monto, 0);
        const err = document.getElementById('txSplitError');
        if (lineas.length < 2) { err.textContent = 'Agrega al menos 2 líneas.'; err.style.display='block'; return; }
        if (Math.abs(suma - total) > 0.001) { err.textContent = `La suma (${suma.toFixed(2)}) debe igualar el total (${total.toFixed(2)}).`; err.style.display='block'; return; }
        err.style.display = 'none';
        await insertSplit(
          { tipo: tipoEl.value, ambito: document.getElementById('ambito').value, fecha: document.getElementById('fecha').value, nota: notaEl.value.trim() || null },
          lineas
        );
        if (typeof mostrarExito === 'function') mostrarExito(lineas[0].categoria_id);
        return;
      }
```

- [ ] **Step 4: Historial agrupa por split_id**

En `views/historial.html`, donde se construye la lista (`rawData` → render), agrupar filas con el mismo `split_id` bajo una cabecera. Localizar el render:
Run: `grep -n "rawData\|aplicarLocalYRender\|function render\|\.map(" views/historial.html | head`

Añadir, antes de pintar, una normalización que colapse splits:
```js
    function agruparSplits(rows) {
      const grupos = {}, salida = [];
      for (const t of rows) {
        if (!t.split_id) { salida.push(t); continue; }
        if (!grupos[t.split_id]) {
          grupos[t.split_id] = { ...t, _split: true, _lineas: [], monto: 0 };
          salida.push(grupos[t.split_id]);
        }
        grupos[t.split_id]._lineas.push(t);
        grupos[t.split_id].monto += Number(t.monto);
      }
      return salida;
    }
```
Aplicar `rows = agruparSplits(rows)` justo antes del map de render. En el render de un item con `_split`, mostrar badge "Dividido (N)" y, opcional, las líneas. El botón eliminar de un split llama `deleteSplit(t.split_id)` (ver Task 10 para el flujo undo/confirm).

- [ ] **Step 5: Verificar**

Crear tx con split de 2 categorías que suman el total → guarda 2 filas con mismo `split_id`. Historial muestra 1 item "Dividido (2)". Fase 2 (safe-to-spend/presupuestos) cuenta cada línea por su categoría.
Expected: suma validada; rechazo si no cuadra; agrupado correcto.

- [ ] **Step 6: Commit**

```bash
git add views/transaccion.html views/historial.html
git commit -m "feat(fase3): split multi-categoría (split_id) + agrupado en historial"
```

---

## Task 10: Undo en toast (borrado tx normal)

**Files:**
- Modify: `views/historial.html`

- [ ] **Step 1: Reemplazar el flujo de borrado normal por undo diferido**

Sustituir `pedirBorrado`/`abrirModalDelete` para tx **normal** (NO aporte, NO split que toca metas) por:

```js
    var _delTimer = null, _delPend = null;
    function pedirBorrado(id) {
      var tx = rawData.filter(function (t){ return String(t.id)===String(id); })[0];
      if (!tx) return;
      if (tx.aporte_id) { abrirModalAporte(tx); return; }      // irreversible → modal
      if (tx.split_id)  { borrarSplitConToast(tx); return; }   // split → undo de grupo
      borrarConToast(tx);
    }

    function _ejecutarBorrado() {
      if (!_delPend) return;
      var tx = _delPend; _delPend = null; _delTimer = null;
      deleteTransaccion(tx.id).catch(function(){ recargar(); });
    }
    function borrarConToast(tx) {
      // optimista: saca de UI, difiere el delete real 5s
      if (_delTimer) { clearTimeout(_delTimer); _ejecutarBorrado(); } // confirma el anterior pendiente
      _delPend = tx;
      rawData = rawData.filter(function(t){ return String(t.id)!==String(tx.id); });
      aplicarLocalYRender();
      mostrarToast('Movimiento eliminado', 'Deshacer', function () {
        clearTimeout(_delTimer); _delTimer = null;
        var restaurar = _delPend; _delPend = null;
        if (restaurar) { rawData.push(restaurar); aplicarLocalYRender(); }
      }, 5000);
      _delTimer = setTimeout(_ejecutarBorrado, 5000);
    }
    function borrarSplitConToast(tx) {
      if (_delTimer) { clearTimeout(_delTimer); _ejecutarBorrado(); }
      var grupoIds = rawData.filter(function(t){return t.split_id===tx.split_id;}).map(function(t){return t.id;});
      var backup = rawData.filter(function(t){return t.split_id===tx.split_id;});
      rawData = rawData.filter(function(t){ return t.split_id!==tx.split_id; });
      aplicarLocalYRender();
      var done = false;
      var timer = setTimeout(function(){ done=true; deleteSplit(tx.split_id).catch(function(){recargar();}); }, 5000);
      mostrarToast('Movimiento dividido eliminado', 'Deshacer', function(){
        if (done) return; clearTimeout(timer);
        rawData = rawData.concat(backup); aplicarLocalYRender();
      }, 5000);
    }
```

- [ ] **Step 2: Confirmar borrados pendientes al salir de la vista**

Si el router tiene cleanup, ejecutar `_ejecutarBorrado()` al desmontar. Si no, añadir:
```js
    window.addEventListener('beforeunload', _ejecutarBorrado);
```
Y al inicio de `recargar()`/navegación interna, llamar `if(_delTimer){clearTimeout(_delTimer); _ejecutarBorrado();}` para no perder el borrado.

- [ ] **Step 3: Verificar**

Borrar tx normal → desaparece + toast "Deshacer" 5s. Tap Deshacer < 5s → reaparece (no se borró en backend). Esperar 5s → borrado real. Aporte vinculado sigue pidiendo modal.
Expected: undo restaura; expiración confirma; aporte intacto con modal.

- [ ] **Step 4: Commit**

```bash
git add views/historial.html
git commit -m "feat(fase3): undo en toast para borrado de transacción (5s) + split"
```

---

## Task 11: Foto de recibo (compresión + upload + thumbnail)

**Files:**
- Modify: `views/transaccion.html`, `views/historial.html`

- [ ] **Step 1: Input de foto + compresión en el form**

HTML (en el form, tras la nota):
```html
<div class="form-group">
  <label for="reciboFile">Recibo <span class="label-opcional">(opcional)</span></label>
  <input type="file" id="reciboFile" accept="image/*" capture="environment">
  <img id="reciboPreview" class="recibo-preview" alt="Vista previa del recibo" style="display:none;">
</div>
```

Compresión (función en el script del form):
```js
    function comprimirImagen(file, maxLado, calidad) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          var w = img.width, h = img.height;
          if (w > h && w > maxLado) { h = Math.round(h * maxLado / w); w = maxLado; }
          else if (h > maxLado) { w = Math.round(w * maxLado / h); h = maxLado; }
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error('toBlob null')); }, 'image/webp', calidad);
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });
    }
    var _reciboBlob = null;
    document.getElementById('reciboFile').addEventListener('change', async function (e) {
      var file = e.target.files[0]; if (!file) return;
      _reciboBlob = await comprimirImagen(file, 1280, 0.7);
      var prev = document.getElementById('reciboPreview');
      prev.src = URL.createObjectURL(_reciboBlob); prev.style.display = 'block';
    });
```

- [ ] **Step 2: Subir tras guardar la transacción**

En el submit (rama normal, tras obtener la fila guardada `saved`), añadir:
```js
      if (_reciboBlob && saved && saved.id && typeof subirRecibo === 'function') {
        try { await subirRecibo(saved.id, _reciboBlob); } catch (_) {}
        _reciboBlob = null;
      }
```
> Verificar el nombre de la variable de la fila guardada en el submit actual:
> Run: `grep -n "await insertTransaccion\|const saved\|var saved\|= await insert" views/transaccion.html`
> Usar la variable real. Si no se captura, asignarla: `const saved = await insertTransaccion({...});`

CSS:
```css
.recibo-preview { max-width: 120px; border-radius: var(--radius-sm); margin-top: var(--space-sm); }
```

- [ ] **Step 3: Thumbnail en historial/detalle**

Donde se renderiza el detalle/fila de una tx con `recibo_path`, mostrar thumbnail:
```js
    async function pintarRecibo(containerEl, path) {
      if (!path || typeof getReciboUrl !== 'function') return;
      const url = await getReciboUrl(path);
      if (url) containerEl.innerHTML = `<img src="${url}" class="recibo-thumb" alt="Recibo">`;
    }
```
Llamar al expandir/ver detalle de una tx que tenga `recibo_path`. CSS:
```css
.recibo-thumb { max-width: 100%; border-radius: var(--radius-sm); margin-top: var(--space-sm); }
```

- [ ] **Step 4: Verificar (en teléfono vía túnel — ver sección abajo)**

Adjuntar foto con cámara → se comprime (webp) → guarda tx → upload a `recibos/{uid}/{txid}.webp` → thumbnail carga vía signed URL. Offline: queda en `recibos_pendientes`, sube al reconectar.
Expected: upload OK online; cola + upload diferido offline; thumbnail visible.

- [ ] **Step 5: Commit**

```bash
git add views/transaccion.html views/historial.html
git commit -m "feat(fase3): foto de recibo — compresión webp, upload a Storage privado y thumbnail firmado"
```

---

## Task 12: Gestión de plantillas en configuración

**Files:**
- Modify: `views/configuracion.html`

- [ ] **Step 1: Sección CRUD de plantillas**

Añadir una sección con: lista de plantillas existentes (nombre · monto · categoría) con botón borrar, y un mini-form (nombre, monto, categoría, tipo, ámbito) con botón "Crear".

```html
<section class="cfg-section">
  <h2>Plantillas rápidas</h2>
  <div id="cfgPlantillasLista"></div>
  <form id="cfgPlantillaForm" class="cfg-plantilla-form" autocomplete="off">
    <input type="text" id="cpNombre" placeholder="Nombre (ej: Pasaje)" maxlength="40" required>
    <input type="number" id="cpMonto" step="0.01" min="0.01" placeholder="Monto" required>
    <select id="cpCategoria"></select>
    <button type="submit" class="btn btn-primary btn-small">Crear</button>
  </form>
</section>
```

- [ ] **Step 2: Lógica CRUD**

```js
(function initCfgPlantillas() {
  const lista = document.getElementById('cfgPlantillasLista');
  const form = document.getElementById('cfgPlantillaForm');
  const selCat = document.getElementById('cpCategoria');
  if (!form || typeof getPlantillas !== 'function') return;
  async function cargarCats() {
    const cats = await getCategorias();
    selCat.innerHTML = '<option value="">Sin categoría</option>' +
      cats.map((c) => `<option value="${c.id}">${c.nombre}</option>`).join('');
  }
  async function pintar() {
    const ps = await getPlantillas();
    lista.innerHTML = ps.length ? ps.map((p) =>
      `<div class="cfg-plantilla-item"><span>${p.nombre} · S/${p.monto}</span>` +
      `<button type="button" class="btn btn-danger btn-small" data-del="${p.id}">Borrar</button></div>`
    ).join('') : '<p class="form-hint">Aún no hay plantillas.</p>';
    lista.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => { await deletePlantilla(b.dataset.del); pintar(); };
    });
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await insertPlantilla({
      nombre: document.getElementById('cpNombre').value.trim(),
      monto: parseFloat(document.getElementById('cpMonto').value),
      categoria_id: selCat.value || null,
      tipo: 'gasto', ambito: 'personal',
    });
    form.reset(); pintar();
  });
  cargarCats(); pintar();
})();
```

- [ ] **Step 3: Verificar**

Crear plantilla "Pasaje S/2" → aparece en lista y como chip en el form de transacción (Task 8) y dashboard. Borrar → desaparece. Sincroniza (tabla Supabase).
Expected: CRUD OK; chips reflejan cambios.

- [ ] **Step 4: Commit**

```bash
git add views/configuracion.html
git commit -m "feat(fase3): gestión CRUD de plantillas en configuración"
```

---

## Task 13: Verificación integral en teléfono

**Files:** ninguno (verificación).

- [ ] **Step 1: Levantar server local en el puerto del túnel Cloudflare**

El usuario tiene un túnel Cloudflare hacia su server local. Levantar un static server en ese puerto (confirmar puerto con el usuario; ejemplo 8080):

Run: `python -m http.server 8080` (desde la raíz del proyecto) — o el comando que ya use el túnel.

- [ ] **Step 2: Abrir el link Cloudflare en el teléfono** (HTTPS → SW + cámara funcionan).

- [ ] **Step 3: Checklist en el teléfono**
  - Quick-add: `Uber 15` → preview correcto → guardar.
  - Autocat: repetir una descripción ya usada → categoría se autocompleta.
  - Plantilla 1-tap: crear en config, tap en chip → tx creada.
  - Split: dividir en 2 categorías que suman el total → 2 filas, 1 item agrupado.
  - Undo: borrar → "Deshacer" 5s → restaurar; y dejar expirar.
  - Foto: adjuntar con cámara → comprime → thumbnail; probar offline (avión) → cola → online sube.
  - Fase 2: safe-to-spend/presupuestos cuentan cada línea de split por su categoría.

- [ ] **Step 4: Correr toda la suite de tests**

Run: `node --test test/*.test.mjs`
Expected: PASS (incluye los nuevos parse-quickadd y autocat, sin romper los existentes).

- [ ] **Step 5: Commit final (si hubo ajustes de verificación)**

```bash
git add -A
git commit -m "test(fase3): verificación integral en teléfono + suite completa"
```

---

## Self-Review (cobertura del spec)

- Quick-add parseado → Task 2 (parser) + Task 7 (UI) + Task 8 (preview). ✓
- Auto-categorización aprendida → Task 3 (matcher) + Task 4 (store) + Task 5 (learn en insert) + Task 8 (prefill). ✓
- Plantillas → Task 1 (tabla) + Task 5 (CRUD) + Task 8 (chips) + Task 12 (gestión). ✓
- Split → Task 1 (split_id) + Task 5 (insertSplit/deleteSplit) + Task 9 (UI + agrupado). ✓
- Undo en toast → Task 10. ✓
- Foto de recibo → Task 1 (bucket/recibo_path) + Task 5 (subirRecibo/getReciboUrl) + Task 6 (sync diferido) + Task 11 (UI). ✓
- Offline-first → outbox/mirror en cada helper + Task 6 (foto diferida). ✓
- Ver en teléfono → Task 13 (túnel Cloudflare, HTTPS). ✓
- TDD funciones puras → Task 2, Task 3 (rojo→verde). ✓
- No duplicar → reusa `_normalizeNum`, `mostrarToast(onAccion)`, patrón `aporte_id`, `iconoCategoria`. ✓
