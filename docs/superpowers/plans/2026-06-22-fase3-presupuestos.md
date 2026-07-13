# Fase 3 — Presupuestos por categoría · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir al usuario fijar un límite mensual personal por categoría de gasto y ver, en el dashboard, cada presupuesto con su gasto del mes y una barra de progreso que cambia de color al cruzar umbrales (verde <70%, ámbar 70–100%, rojo >100% con badge "superado").

**Architecture:** Nueva tabla `presupuestos` (por-usuario, RLS `auth.uid()=user_id`), distinta del `categorias.limite_mensual` global existente. La lógica de color/umbral vive en un módulo puro nuevo `js/presupuestos.js` (ESM + export a `window`, igual que `insights.js`) y se unit-testea. El acceso a datos pasa por `db.js` (espejo IndexedDB + outbox como `metas`). La UI de definición vive en una sección nueva de `configuracion.html`; la visualización en una sección nueva del `dashboard.html`.

**Tech Stack:** Vanilla JS (IIFE/globales, `var`, `escHtml`), Supabase (PostgREST + RLS), IndexedDB vía `idb` vendorizado, `node:test` para unit tests. Estilo editorial oscuro ya aprobado (acento champagne `#c9a84c`, barras finas, íconos Tabler en chips tintados).

**Decisiones de diseño (confirmadas con el usuario):**
- **Alcance del gasto:** solo los gastos del usuario activo (`user_id = auth.uid()`, cualquier ámbito), del mes en curso, en esa categoría.
- **UI de definición:** sección nueva "Presupuestos" en `configuracion.html`.
- **Offline:** patrón completo (espejo IndexedDB + outbox para altas), igual que `metas`.

**Notas / límites conocidos (documentar, no resolver aquí):**
- `presupuestos.limite_mensual` por-usuario NO sustituye a `categorias.limite_mensual` (global, lo usa `alerts.js`). Coexisten: las alertas del panel siguen sobre el límite global; los presupuestos son la vista personal nueva.
- Igual que `metas`, solo el **alta** es offline (outbox). Editar/borrar requieren conexión.
- `sync.js` ya sincroniza cualquier `entity` genéricamente (`supabase.from(entity).upsert(..., {onConflict:'id'})`, línea 30) — **no requiere cambios**. Un alta del mismo presupuesto en dos dispositivos offline puede chocar con el `unique(user_id,categoria_id,periodo)` al sincronizar (queda en `error`, no bloquea el lote). Aceptable para esta fase.

---

## File Structure

- **Create** `supabase/migrations/20260622_presupuestos.sql` — tabla + RLS + trigger `updated_at`.
- **Modify** `supabase/schema.sql` — reflejar la tabla en el esquema canónico (tabla, RLS enable, política).
- **Create** `js/presupuestos.js` — módulo puro: `estadoPresupuesto(gastado, limite)`. ESM export + `window`.
- **Create** `test/presupuestos-estado.test.mjs` — unit tests del módulo puro.
- **Modify** `index.html` — cargar `js/presupuestos.js` como módulo.
- **Modify** `js/nestra-db.js` — añadir store `presupuestos` al espejo + bump de versión IndexedDB.
- **Modify** `js/db.js` — `getPresupuestos`, `getGastosPorCategoriaMes`, `insertPresupuesto`, `updatePresupuesto`, `deletePresupuesto`.
- **Modify** `views/configuracion.html` — sección "Presupuestos" (definir límite por categoría de gasto).
- **Modify** `views/dashboard.html` — sección "Presupuestos del mes" (chip + barra 2px + badge).

---

## Task 1: Migración SQL — tabla `presupuestos`

**Files:**
- Create: `supabase/migrations/20260622_presupuestos.sql`
- Modify: `supabase/schema.sql` (sección de tablas + sección RLS)

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/20260622_presupuestos.sql` con este contenido exacto:

```sql
-- =====================================================================
-- Nestra — Migración: presupuestos por categoría (FASE 3)
-- ---------------------------------------------------------------------
-- Tabla `presupuestos`: límite mensual PERSONAL por categoría (por-usuario).
-- Distinta de categorias.limite_mensual (global, compartido, usado por
-- alerts.js). RLS estricta: cada usuario solo ve/edita los suyos.
-- updated_at + trigger para LWW (espejo offline), igual que el resto.
-- Idempotente: if not exists / drop if exists. Ejecutar en SQL Editor.
-- =====================================================================

create table if not exists public.presupuestos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  categoria_id  uuid not null references public.categorias (id) on delete cascade,
  monto_limite  numeric(10,2) not null check (monto_limite > 0),
  periodo       text not null default 'mensual' check (periodo = 'mensual'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Un presupuesto por (usuario, categoría, periodo).
create unique index if not exists idx_presupuestos_user_cat_periodo
  on public.presupuestos (user_id, categoria_id, periodo);

-- Índice para la lectura por usuario (RLS / dashboard).
create index if not exists idx_presupuestos_user_id
  on public.presupuestos (user_id);

-- RLS: estrictamente por dueño (no compartido con el hogar).
alter table public.presupuestos enable row level security;

drop policy if exists "presupuestos_acceso" on public.presupuestos;
create policy "presupuestos_acceso"
  on public.presupuestos for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- updated_at: reusa la función compartida set_updated_at() (ya existe).
drop trigger if exists trg_presupuestos_updated_at on public.presupuestos;
create trigger trg_presupuestos_updated_at
  before update on public.presupuestos
  for each row execute function public.set_updated_at();
```

- [ ] **Step 2: Aplicar la migración en Supabase**

Aplicar vía MCP de Supabase (herramienta `apply_migration`, name `presupuestos_fase3`) con el SQL anterior, o pegar en el SQL Editor del proyecto v2.

Verificar después con `list_tables` (o `mcp__supabase__execute_sql`):
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'presupuestos' order by ordinal_position;
```
Expected: filas para `id, user_id, categoria_id, monto_limite, periodo, created_at, updated_at`.

Y verificar RLS:
```sql
select polname from pg_policies where tablename = 'presupuestos';
```
Expected: `presupuestos_acceso`.

- [ ] **Step 3: Reflejar la tabla en `supabase/schema.sql`**

En `supabase/schema.sql`, tras el bloque de la tabla `desafios` (la última tabla, alrededor de la línea 131), añadir:

```sql
-- 1.7 presupuestos ----------------------------------------------------
-- Límite mensual PERSONAL por categoría (por-usuario). Distinta de
-- categorias.limite_mensual (global). RLS estricta por dueño.
create table public.presupuestos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  categoria_id  uuid not null references public.categorias (id) on delete cascade,
  monto_limite  numeric(10,2) not null check (monto_limite > 0),
  periodo       text not null default 'mensual' check (periodo = 'mensual'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, categoria_id, periodo)
);
```

En la sección 2 (ROW LEVEL SECURITY), junto a los demás `enable row level security` (alrededor de la línea 216), añadir:

```sql
alter table public.presupuestos enable row level security;
```

Y tras la política de `desafios` (final de la sección de políticas), añadir:

```sql
-- 2.7 presupuestos ----------------------------------------------------
-- Estrictamente por dueño: cada usuario solo ve/edita los suyos.
create policy "presupuestos_acceso"
  on public.presupuestos for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260622_presupuestos.sql supabase/schema.sql
git commit -m "feat(presupuestos): tabla presupuestos por-usuario con RLS"
```

---

## Task 2: Módulo puro `estadoPresupuesto` (TDD)

**Files:**
- Create: `js/presupuestos.js`
- Test: `test/presupuestos-estado.test.mjs`

Patrón de referencia: `js/insights.js` (ESM `export { ... }` al final + `if (typeof window !== 'undefined') window.x = x`). Los tests importan vía `import` de ESM y corren con `node --test`.

**Contrato de `estadoPresupuesto(gastado, limite)`:**
- `gastado`, `limite`: números. `limite <= 0` o inválido → retorna `null` (sin presupuesto válido).
- Retorna objeto:
  - `pctReal`: número entero `round(gastado/limite*100)` SIN tope (puede ser >100, p.ej. 120).
  - `ancho`: número entero acotado a `[0, 100]` (ancho de la barra en %).
  - `color`: `'verde'` si `ratio < 0.70`; `'ambar'` si `0.70 <= ratio <= 1.0`; `'rojo'` si `ratio > 1.0`.
  - `superado`: `true` si `ratio > 1.0`, si no `false`.
  - (`ratio = gastado / limite`)

- [ ] **Step 1: Escribir el test que falla**

Crear `test/presupuestos-estado.test.mjs`:

```js
import assert from 'node:assert';
import { test } from 'node:test';
import { estadoPresupuesto } from '../js/presupuestos.js';

test('límite inválido (0, negativo, NaN) → null', () => {
  assert.strictEqual(estadoPresupuesto(50, 0), null);
  assert.strictEqual(estadoPresupuesto(50, -10), null);
  assert.strictEqual(estadoPresupuesto(50, NaN), null);
  assert.strictEqual(estadoPresupuesto(50, null), null);
});

test('gasto 0 → verde, 0%', () => {
  const e = estadoPresupuesto(0, 100);
  assert.strictEqual(e.color, 'verde');
  assert.strictEqual(e.pctReal, 0);
  assert.strictEqual(e.ancho, 0);
  assert.strictEqual(e.superado, false);
});

test('justo por debajo del 70% → verde', () => {
  const e = estadoPresupuesto(69, 100);
  assert.strictEqual(e.color, 'verde');
  assert.strictEqual(e.pctReal, 69);
});

test('exactamente 70% → ámbar', () => {
  const e = estadoPresupuesto(70, 100);
  assert.strictEqual(e.color, 'ambar');
  assert.strictEqual(e.superado, false);
});

test('exactamente 100% → ámbar, no superado', () => {
  const e = estadoPresupuesto(100, 100);
  assert.strictEqual(e.color, 'ambar');
  assert.strictEqual(e.superado, false);
  assert.strictEqual(e.ancho, 100);
});

test('por encima del 100% → rojo + superado, pctReal sin tope, ancho acotado', () => {
  const e = estadoPresupuesto(120, 100);
  assert.strictEqual(e.color, 'rojo');
  assert.strictEqual(e.superado, true);
  assert.strictEqual(e.pctReal, 120);
  assert.strictEqual(e.ancho, 100);
});

test('redondeo de pctReal', () => {
  // 33.333... → 33
  assert.strictEqual(estadoPresupuesto(100, 300).pctReal, 33);
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test test/presupuestos-estado.test.mjs`
Expected: FAIL — `Cannot find module '../js/presupuestos.js'` (el archivo no existe aún).

- [ ] **Step 3: Implementar el módulo mínimo**

Crear `js/presupuestos.js`:

```js
// ─────────────────────────────────────────────────────────────────
// Nestra — presupuestos.js
// Módulo PURO: clasifica un gasto contra su límite mensual.
// Sin dependencias, sin I/O. ESM export + export a window (igual que
// insights.js) para que lo use el dashboard (script no-módulo).
//
// Umbrales (Fase 3): verde <70%, ámbar 70–100%, rojo >100% (superado).
// ─────────────────────────────────────────────────────────────────

// estadoPresupuesto(gastado, limite) — clasifica el gasto contra el límite.
// limite <= 0 / inválido → null. Retorna { pctReal, ancho, color, superado }.
function estadoPresupuesto(gastado, limite) {
  const g = Number(gastado);
  const l = Number(limite);
  if (!Number.isFinite(l) || l <= 0) return null;
  const gg = Number.isFinite(g) ? g : 0;

  const ratio = gg / l;
  const pctReal = Math.round(ratio * 100);
  const ancho = Math.max(0, Math.min(100, pctReal));

  let color;
  if (ratio < 0.70) color = 'verde';
  else if (ratio <= 1.0) color = 'ambar';
  else color = 'rojo';

  return { pctReal, ancho, color, superado: ratio > 1.0 };
}

if (typeof window !== 'undefined') {
  window.estadoPresupuesto = estadoPresupuesto;
}

export { estadoPresupuesto };
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `node --test test/presupuestos-estado.test.mjs`
Expected: PASS — todos los tests verdes.

- [ ] **Step 5: Commit**

```bash
git add js/presupuestos.js test/presupuestos-estado.test.mjs
git commit -m "feat(presupuestos): estadoPresupuesto puro + tests de umbrales"
```

---

## Task 3: Cargar el módulo en `index.html`

**Files:**
- Modify: `index.html:150` (junto a la carga de `insights.js`)

- [ ] **Step 1: Añadir el `<script>` del módulo**

En `index.html`, localizar la línea:
```html
    <script type="module" src="js/insights.js"></script>
```
e insertar justo después:
```html
    <script type="module" src="js/presupuestos.js"></script>
```

- [ ] **Step 2: Verificar que `window.estadoPresupuesto` queda expuesto**

Levantar el dev server (`preview_start` si no corre) y, en la consola del preview (`preview_eval`):
```js
typeof window.estadoPresupuesto
```
Expected: `"function"`.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(presupuestos): cargar módulo presupuestos.js en el shell"
```

---

## Task 4: Espejo IndexedDB — store `presupuestos`

**Files:**
- Modify: `js/nestra-db.js:9-10` (versión + lista de stores)

- [ ] **Step 1: Añadir el store y bumpear la versión**

En `js/nestra-db.js`, localizar:
```js
const NESTRA_IDB_VERSION = 1;
const MIRROR_STORES = ['transacciones', 'categorias', 'metas', 'prestamos'];
```
y reemplazar por:
```js
const NESTRA_IDB_VERSION = 2;
const MIRROR_STORES = ['transacciones', 'categorias', 'metas', 'prestamos', 'presupuestos'];
```

(El callback de `upgrade` ya itera `MIRROR_STORES` y crea los stores que falten con `keyPath:'id'`; el bump de versión a 2 dispara ese upgrade para crear `presupuestos`.)

- [ ] **Step 2: Verificar la creación del store**

Recargar el preview (`preview_eval`: `window.location.reload()`), luego en consola:
```js
(async () => {
  const db = await idb.openDB('nestra', 2);
  return Array.from(db.objectStoreNames);
})()
```
Expected: array que incluye `"presupuestos"` (además de `transacciones, categorias, metas, prestamos, outbox`).

- [ ] **Step 3: Commit**

```bash
git add js/nestra-db.js
git commit -m "feat(presupuestos): añadir store presupuestos al espejo IndexedDB (v2)"
```

---

## Task 5: Capa de datos en `db.js`

**Files:**
- Modify: `js/db.js` (añadir una sección PRESUPUESTOS tras la sección METAS, antes de PRÉSTAMOS, ~línea 922)

- [ ] **Step 1: Añadir las funciones de datos**

En `js/db.js`, insertar este bloque completo justo antes del comentario `// ═══...PRÉSTAMOS`:

```js
// ═══════════════════════════════════════════════════════════════════
// PRESUPUESTOS
// ═══════════════════════════════════════════════════════════════════

// getPresupuestos() — presupuestos del usuario activo (RLS los acota),
// con la categoría embebida (nombre, icono, color, tipo) para el render.
// Online: query a Supabase + espejo. Offline: espejo local.
// Returns: array o [].
async function getPresupuestos() {
  return _mirroredRead('presupuestos', async () => {
    const { data, error } = await supabase
      .from('presupuestos')
      .select('*, categorias(nombre, icono, color, tipo)');
    if (error) throw error;
    return data || [];
  });
}

// getGastosPorCategoriaMes(mes, anio) — gasto del usuario activo por
// categoría en el mes dado. Solo tipo='gasto' y user_id = usuario activo
// (cualquier ámbito). Usa getTransacciones (espejado) para que funcione
// offline; filtra el autor en cliente.
// Returns: objeto { [categoria_id]: total }. {} en error.
async function getGastosPorCategoriaMes(mes, anio) {
  try {
    const userId = _requireUserId();
    const { desde, hasta } = _rangoMes(mes, anio);
    const txs = await getTransacciones({
      tipo: 'gasto',
      fecha_desde: desde,
      fecha_hasta: hasta,
    });
    const mapa = {};
    (txs || []).forEach((t) => {
      if (t.user_id !== userId) return; // solo gastos propios
      mapa[t.categoria_id] = (mapa[t.categoria_id] || 0) + Number(t.monto);
    });
    return mapa;
  } catch (err) {
    console.error('Error en getGastosPorCategoriaMes():', err.message || err);
    return {};
  }
}

// insertPresupuesto(datos) — crea un presupuesto.
// datos: { categoria_id, monto_limite }. periodo se fija a 'mensual'.
// user_id se fuerza al usuario activo (RLS exige auth.uid()=user_id).
// Soporta offline (outbox + espejo), igual que insertMeta.
// Returns: fila insertada (o fila optimista _pending:true). Lanza en fallo.
async function insertPresupuesto(datos) {
  const fila = {
    id:           crypto.randomUUID(),
    categoria_id: datos.categoria_id,
    monto_limite: datos.monto_limite,
    periodo:      'mensual',
    user_id:      _requireUserId(),
    updated_at:   new Date().toISOString(),
  };

  if (!navigator.onLine) {
    await outboxAdd('presupuestos', fila);
    await mirrorPut('presupuestos', { ...fila, _pending: true });
    if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
    return { ...fila, _pending: true };
  }
  try {
    const { data, error } = await supabase
      .from('presupuestos').insert(fila).select().single();
    if (error) throw error;
    await mirrorPut('presupuestos', data);
    return data;
  } catch (err) {
    if (_isNetworkError(err)) {
      await outboxAdd('presupuestos', fila);
      await mirrorPut('presupuestos', { ...fila, _pending: true });
      if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
      return { ...fila, _pending: true };
    }
    console.error('Error en insertPresupuesto():', err.message || err);
    throw err;
  }
}

// updatePresupuesto(id, datos) — actualiza un presupuesto (p.ej. monto_limite).
// Online-only (igual que updateMeta). Returns: fila actualizada. Lanza en fallo.
async function updatePresupuesto(id, datos) {
  try {
    const { data, error } = await supabase
      .from('presupuestos')
      .update(datos)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    await mirrorPut('presupuestos', data);
    return data;
  } catch (err) {
    console.error('Error en updatePresupuesto():', err.message || err);
    throw err;
  }
}

// deletePresupuesto(id) — borra un presupuesto (quita el límite de la categoría).
// Online-only. Returns: undefined. Lanza en fallo.
async function deletePresupuesto(id) {
  try {
    const { error } = await supabase
      .from('presupuestos')
      .delete()
      .eq('id', id);
    if (error) throw error;
    if (typeof mirrorDelete === 'function') await mirrorDelete('presupuestos', id);
  } catch (err) {
    console.error('Error en deletePresupuesto():', err.message || err);
    throw err;
  }
}
```

> **Nota para el implementador:** `js/nestra-db.js` NO expone un `mirrorDelete` (solo `mirrorReplace`, `mirrorPut`, `mirrorGetAll`). El `if (typeof mirrorDelete === 'function')` evalúa `false` → es un noop intencional: el siguiente `getPresupuestos()` online re-espeja el conjunto correcto vía `mirrorReplace`. Dejar la línea tal cual (defensiva, sin efecto hoy). No añadir un `mirrorDelete` en esta fase.

- [ ] **Step 2: Verificar en consola (online)**

Con sesión activa en el preview, en consola (`preview_eval`):
```js
(async () => {
  const before = await getPresupuestos();
  const cats = await getCategorias('gasto');
  const nuevo = await insertPresupuesto({ categoria_id: cats[0].id, monto_limite: 500 });
  const after = await getPresupuestos();
  await deletePresupuesto(nuevo.id);
  return { antes: before.length, despues: after.length, creado: nuevo.monto_limite };
})()
```
Expected: `despues === antes + 1`, `creado === 500`. (El `deletePresupuesto` final limpia la prueba.)

- [ ] **Step 3: Commit**

```bash
git add js/db.js
git commit -m "feat(presupuestos): CRUD + gasto por categoría del mes en db.js"
```

---

## Task 6: UI de definición — sección "Presupuestos" en Configuración

**Files:**
- Modify: `views/configuracion.html` (markup nuevo + CSS + JS dentro del IIFE existente)

La sección lista las categorías de **gasto activas**; cada fila muestra el chip de ícono, el nombre y un input numérico con el límite actual (vacío = sin presupuesto). Al cambiar el valor:
- vacío y antes tenía presupuesto → `deletePresupuesto`
- valor > 0 y no tenía → `insertPresupuesto`
- valor > 0 y ya tenía → `updatePresupuesto`

- [ ] **Step 1: Añadir el markup de la sección**

En `views/configuracion.html`, tras el cierre de la sección de Categorías (`</section>` de `#cfgCatSection`, línea 47) e **antes** de `<!-- S3: Preferencias -->`, insertar:

```html
  <!-- S2.5: Presupuestos -->
  <section class="cfg-card" id="cfgPresupSection" style="display:none">
    <h2 class="cfg-section-label">Presupuestos mensuales</h2>
    <p class="cfg-presup-hint">Define un límite mensual por categoría de gasto. El dashboard mostrará tu avance.</p>
    <ul class="cfg-presup-lista" id="cfgPresupLista" role="list"></ul>
  </section>
```

- [ ] **Step 2: Añadir el CSS de la sección**

En el bloque `<style>` de `configuracion.html`, antes del comentario `/* Modal */` (línea ~467), insertar:

```css
    /* Presupuestos */
    .cfg-presup-hint {
      font-size: var(--font-size-sm);
      color: var(--text-secondary);
      margin: 0 0 var(--space-md);
      line-height: 1.4;
    }
    .cfg-presup-lista { list-style: none; padding: 0; margin: 0; }
    .cfg-presup-item {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: var(--space-sm) 0;
      border-bottom: 1px solid var(--border-light);
    }
    .cfg-presup-item:last-child { border-bottom: none; }
    .cfg-presup-chip {
      width: 32px; height: 32px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      border-radius: var(--radius-sm);
      background: var(--bg-light);
      color: var(--text-secondary);
    }
    .cfg-presup-chip .cat-icono { width: 18px; height: 18px; }
    .cfg-presup-nombre {
      flex: 1; min-width: 0;
      font-weight: var(--font-weight-medium);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .cfg-presup-input-wrap {
      display: flex; align-items: center; gap: 4px;
      flex-shrink: 0;
    }
    .cfg-presup-prefijo { font-size: var(--font-size-sm); color: var(--text-secondary); }
    .cfg-presup-input {
      width: 96px;
      padding: var(--space-sm);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-md);
      background: var(--bg-light);
      color: inherit;
      font-size: var(--font-size-sm);
      text-align: right;
      font-variant-numeric: tabular-nums;
      box-sizing: border-box;
    }
    .cfg-presup-input:focus { outline: none; border-color: var(--color-primary); }
```

- [ ] **Step 3: Añadir el JS de render + guardado**

En el IIFE de `configuracion.html`, justo antes de `/* ── Dark mode ── */` (línea ~1023), insertar:

```js
    /* ── Presupuestos ───────────────────────────────────── */
    var _presupuestos = []; // filas existentes: { id, categoria_id, monto_limite, ... }

    function _presupDeCat(catId) {
      return _presupuestos.find(function (p) { return p.categoria_id === catId; }) || null;
    }

    function renderPresupItem(cat) {
      var p = _presupDeCat(cat.id);
      var val = p ? p.monto_limite : '';
      var icono = (typeof iconoCategoria === 'function') ? iconoCategoria(cat.icono) : '';
      return '<li class="cfg-presup-item" data-cat-id="' + escHtml(cat.id) + '">' +
        '<span class="cfg-presup-chip">' + icono + '</span>' +
        '<span class="cfg-presup-nombre">' + escHtml(cat.nombre) + '</span>' +
        '<span class="cfg-presup-input-wrap">' +
          '<span class="cfg-presup-prefijo">S/</span>' +
          '<input type="number" class="cfg-presup-input" min="0" step="0.01" ' +
            'inputmode="decimal" placeholder="—" ' +
            'value="' + escHtml(String(val)) + '" ' +
            'aria-label="Límite mensual de ' + escHtml(cat.nombre) + '">' +
        '</span>' +
      '</li>';
    }

    function renderPresupuestos(cats, presupuestos) {
      _presupuestos = presupuestos || [];
      var gasto = (cats || []).filter(function (c) {
        return c.tipo === 'gasto' && c.estado !== 'archivada';
      });
      var ul = $('cfgPresupLista');
      if (!gasto.length) {
        ul.innerHTML = '<li style="color:var(--text-secondary);font-size:var(--font-size-sm);padding:var(--space-sm) 0">Sin categorías de gasto.</li>';
      } else {
        ul.innerHTML = gasto.map(renderPresupItem).join('');
      }
      $('cfgPresupSection').style.display = 'block';
    }

    // Guardar al perder foco / cambiar el input (insert / update / delete).
    $('cfgPresupLista').addEventListener('change', async function (e) {
      var input = e.target.closest('.cfg-presup-input');
      if (!input) return;
      var li = input.closest('.cfg-presup-item');
      var catId = li.dataset.catId;
      var existente = _presupDeCat(catId);
      var raw = input.value.trim();
      var monto = raw === '' ? null : parseFloat(raw);

      input.disabled = true;
      try {
        if (monto === null || isNaN(monto) || monto <= 0) {
          // Sin valor válido → borrar si existía.
          if (existente) {
            await deletePresupuesto(existente.id);
            _presupuestos = _presupuestos.filter(function (p) { return p.id !== existente.id; });
            input.value = '';
            mostrarToast('Presupuesto eliminado', 3000);
          } else {
            input.value = '';
          }
        } else if (existente) {
          var act = await updatePresupuesto(existente.id, { monto_limite: monto });
          existente.monto_limite = act.monto_limite;
          mostrarToast('Presupuesto actualizado', 3000);
        } else {
          var nuevo = await insertPresupuesto({ categoria_id: catId, monto_limite: monto });
          _presupuestos.push(nuevo);
          mostrarToast('Presupuesto guardado', 3000);
        }
      } catch (err) {
        mostrarToast('No se pudo guardar el presupuesto', 4000);
        // Restaurar el valor previo conocido.
        input.value = existente ? existente.monto_limite : '';
      } finally {
        input.disabled = false;
      }
    });
```

- [ ] **Step 4: Cargar los presupuestos en `cargar()`**

En la función `cargar()` de `configuracion.html` (línea ~1152), localizar:
```js
        var res = await Promise.all([getProfiles(), getCategoriasConFavorito(null, true)]);
        renderPerfiles(res[0]);
        renderCategorias(res[1]);
```
y reemplazar por:
```js
        var res = await Promise.all([
          getProfiles(),
          getCategoriasConFavorito(null, true),
          getPresupuestos(),
        ]);
        renderPerfiles(res[0]);
        renderCategorias(res[1]);
        renderPresupuestos(res[1], res[2]);
```

- [ ] **Step 5: Verificar la UI**

En el preview, navegar a `#configuracion`. Comprobar (`preview_snapshot` / `preview_screenshot`):
1. Aparece la sección "Presupuestos mensuales" con una fila por cada categoría de gasto (chip + nombre + input `S/`).
2. Escribir `300` en una categoría (`preview_fill`) y disparar `change` (blur). Aparece el toast "Presupuesto guardado".
3. Recargar `#configuracion`: el input conserva `300` (persistido).
4. Borrar el valor (vacío) → toast "Presupuesto eliminado"; tras recargar, queda vacío.

Revisar `preview_console_logs`: sin errores.

- [ ] **Step 6: Commit**

```bash
git add views/configuracion.html
git commit -m "feat(presupuestos): sección de definición en Configuración"
```

---

## Task 7: Visualización en el dashboard

**Files:**
- Modify: `views/dashboard.html` (markup + CSS + render + carga)

Estilo editorial oscuro aprobado: chip 24×24 tintado con el color de la categoría, barra de **2px**, colores por umbral (verde/ámbar/rojo), badge "superado". `role="progressbar"` en la barra (a11y).

- [ ] **Step 1: Añadir el contenedor en el markup**

En `views/dashboard.html`, tras la sección de Alertas (`<section id="dashAlertas" ...></section>`, línea 50) e **antes** de `<!-- ── SECCIÓN 5 — Últimas transacciones ── -->`, insertar:

```html
  <!-- ── SECCIÓN 4.5 — Presupuestos del mes ───────────────────── -->
  <section class="card dash-presup-card" id="dashPresupCard" aria-labelledby="presupTitle" style="display:none">
    <h2 class="dash-card-title" id="presupTitle">Presupuestos del mes</h2>
    <div id="dashPresupBody" aria-live="polite"></div>
  </section>
```

- [ ] **Step 2: Añadir el CSS**

En el bloque `<style>` de `dashboard.html`, tras el bloque `/* ── Metas ── */` (antes de `/* Fondos de emergencia */`, línea ~365), insertar:

```css
  /* ── Presupuestos ───────────────────────────────────────── */
  .dash-presup {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    padding: var(--space-sm) 0;
  }
  .dash-presup + .dash-presup { border-top: 1px solid var(--border-light); }
  .dash-presup-chip {
    width: 24px; height: 24px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    border-radius: var(--radius-sm);
  }
  .dash-presup-chip .cat-icono { width: 14px; height: 14px; }
  .dash-presup-main { flex: 1; min-width: 0; }
  .dash-presup-head {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: var(--space-sm); margin-bottom: 6px;
  }
  .dash-presup-nombre {
    font-weight: var(--font-weight-semibold);
    color: var(--text-dark);
    font-size: var(--font-size-sm);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .dash-presup-cifras {
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .dash-presup-bar {
    height: 2px;
    background: var(--border-light);
    border-radius: 9999px;
    overflow: hidden;
  }
  .dash-presup-bar-fill {
    height: 100%;
    border-radius: 9999px;
    transition: width 0.4s ease-out;
  }
  .dash-presup-bar-fill--verde { background: var(--color-success); }
  .dash-presup-bar-fill--ambar { background: var(--color-warning); }
  .dash-presup-bar-fill--rojo  { background: var(--color-danger); }
  .dash-presup-badge {
    display: inline-block;
    margin-left: var(--space-sm);
    padding: 1px var(--space-sm);
    border-radius: var(--radius-sm);
    font-size: 0.62rem;
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-danger);
    background: color-mix(in srgb, var(--color-danger) 14%, transparent);
    vertical-align: middle;
  }
  @media (prefers-reduced-motion: reduce) {
    .dash-presup-bar-fill { transition: none; }
  }
```

- [ ] **Step 3: Añadir la función de render**

En el `<script>` del dashboard, junto a las demás funciones `render*` (p.ej. tras `renderInsights`, línea ~550), insertar:

```js
    // ── Render: presupuestos del mes ──────────────────────────
    // Cada presupuesto: chip tintado con el color de la categoría, nombre,
    // gastado/límite, barra 2px coloreada por umbral y badge si está superado.
    function renderPresupuestos(presupuestos, gastoPorCat) {
      const card = $('dashPresupCard');
      const body = $('dashPresupBody');
      if (!card || !body) return;
      const lista = presupuestos || [];
      if (!lista.length) { card.style.display = 'none'; return; }

      const rows = lista.map((p) => {
        const cat = p.categorias || {};
        const limite = Number(p.monto_limite) || 0;
        const gastado = Number((gastoPorCat || {})[p.categoria_id] || 0);
        const est = (typeof estadoPresupuesto === 'function')
          ? estadoPresupuesto(gastado, limite) : null;
        if (!est) return '';

        const color = cat.color || '#c9a84c'; // acento champagne por defecto
        const chipStyle = 'background:' + color + '22;color:' + color + ';';
        const icon = (typeof iconoCategoria === 'function') ? iconoCategoria(cat.icono) : '';
        const badge = est.superado
          ? '<span class="dash-presup-badge">superado</span>' : '';

        return `<div class="dash-presup">
          <span class="dash-presup-chip" style="${chipStyle}" aria-hidden="true">${icon}</span>
          <div class="dash-presup-main">
            <div class="dash-presup-head">
              <span class="dash-presup-nombre">${esc(cat.nombre || 'Categoría')}${badge}</span>
              <span class="dash-presup-cifras">${esc(formatMonto(gastado))} / ${esc(formatMonto(limite))}</span>
            </div>
            <div class="dash-presup-bar" role="progressbar"
                 aria-valuenow="${est.pctReal}" aria-valuemin="0" aria-valuemax="100"
                 aria-label="Presupuesto de ${esc(cat.nombre || 'categoría')}: ${est.pctReal}%">
              <div class="dash-presup-bar-fill dash-presup-bar-fill--${est.color}" style="width:${est.ancho}%;"></div>
            </div>
          </div>
        </div>`;
      }).join('');

      body.innerHTML = rows;
      card.style.display = 'block';
    }
```

> **Nota:** el chip usa `color + '22'` (alfa ~13% en hex de 8 dígitos) para el fondo tintado a partir del color de la categoría. Si algún `cat.color` no fuese hex de 6 dígitos, el fondo simplemente no se tintará (degrada con elegancia). El número de gasto NO se tinta; la barra es el único indicador de color por umbral, y el badge "superado" añade un canal no-cromático (texto) para cumplir WCAG 1.4.1.

- [ ] **Step 4: Cargar los datos**

En el `(async function cargar(){ ... })()` del dashboard (línea ~662), añadir las dos cargas al `Promise.allSettled` y luego renderizar.

Localizar el array del `allSettled` y añadir, al final de la lista (tras `cargarInsights(),`):
```js
        getPresupuestos(),
        getGastosPorCategoriaMes(mes, anio),
```
Actualizar la desestructuración para recibir los dos nuevos valores. La línea actual:
```js
      const [hogar, personal, alertas, txs, metas, acumHogar, acumPersonal, ahorrosHogar, ahorrosPersonal, insights] = await Promise.allSettled([
```
pasa a:
```js
      const [hogar, personal, alertas, txs, metas, acumHogar, acumPersonal, ahorrosHogar, ahorrosPersonal, insights, presupuestos, gastosCat] = await Promise.allSettled([
```

Y tras la línea `if (insights.status === 'fulfilled') renderInsights(insights.value);`, añadir:
```js
      if (presupuestos.status === 'fulfilled') {
        const gMap = gastosCat.status === 'fulfilled' ? gastosCat.value : {};
        renderPresupuestos(presupuestos.value, gMap);
      }
```

- [ ] **Step 5: Verificar en el preview**

En el dashboard del preview:
1. `preview_snapshot`: aparece la card "Presupuestos del mes" con una fila por presupuesto (solo si hay alguno definido en Task 6).
2. `preview_inspect` sobre `.dash-presup-bar`: `height` computado = `2px`.
3. `preview_console_logs`: sin errores.

(La verificación funcional de umbrales/colores va en Task 8.)

- [ ] **Step 6: Commit**

```bash
git add views/dashboard.html
git commit -m "feat(presupuestos): tarjeta de presupuestos del mes en el dashboard"
```

---

## Task 8: Verificación end-to-end (umbrales de color)

**Files:** (ninguno — solo verificación manual en el preview)

Reproduce el criterio de aceptación del encargo: **crear presupuesto → registrar gasto → la barra actualiza color al cruzar umbrales.**

- [ ] **Step 1: Preparar — crear presupuesto**

1. Iniciar sesión en el preview con la cuenta de prueba (ver memoria `nestra-v2-test-account`).
2. En `#configuracion` → "Presupuestos mensuales": fijar un límite de `S/ 100` en una categoría de gasto concreta (p.ej. "Comida"). Anotar la categoría.

- [ ] **Step 2: Verde (<70%)**

1. Registrar un gasto de `S/ 50` en esa categoría, fecha = hoy (vía FAB → modal de transacción).
2. Ir al dashboard. `preview_screenshot`.
3. `preview_inspect` sobre `.dash-presup-bar-fill` de esa fila:
   - clase incluye `dash-presup-bar-fill--verde`
   - `width` computado ≈ `50%`
   - cifras: `S/ 50.00 / S/ 100.00`, sin badge.

- [ ] **Step 3: Ámbar (70–100%)**

1. Registrar otro gasto de `S/ 30` en la misma categoría (total = 80).
2. Recargar el dashboard. `preview_screenshot`.
3. Verificar: clase `dash-presup-bar-fill--ambar`, `width` ≈ `80%`, sin badge "superado".

- [ ] **Step 4: Rojo (>100%) + badge**

1. Registrar otro gasto de `S/ 40` (total = 120).
2. Recargar el dashboard. `preview_screenshot`.
3. Verificar: clase `dash-presup-bar-fill--rojo`, `width` = `100%` (acotado), cifras `S/ 120.00 / S/ 100.00`, y aparece el badge **"superado"**. `aria-valuenow="120"`.

- [ ] **Step 5: Confirmar tests unitarios y consola limpia**

Run: `node --test test/presupuestos-estado.test.mjs`
Expected: PASS.

`preview_console_logs` en cada paso: sin errores.

- [ ] **Step 6: Limpieza de datos de prueba**

Borrar las transacciones de prueba (Historial) y el presupuesto de prueba (Configuración) creados para la verificación, para no dejar ruido en la cuenta de prueba.

---

## Self-Review

**1. Cobertura del spec:**
- ✅ Tabla `presupuestos` (user_id, categoria_id, monto_limite, periodo mensual) con RLS `auth.uid()=user_id` siguiendo el patrón existente → Task 1.
- ✅ UI para definir límite mensual por categoría → Task 6.
- ✅ Dashboard muestra ícono (chip 24×24 tintado), nombre, gastado/límite, barra 2px verde<70 / ámbar 70–100 / rojo>100 con badge "superado" → Task 7 + módulo Task 2.
- ✅ Cálculo del gasto sobre transacciones del mes en curso de esa categoría (gastos del usuario activo) → `getGastosPorCategoriaMes` Task 5.
- ✅ Patrones existentes (IIFE, `var`, `escHtml`, capa db.js, espejo+outbox, ESM dual-export) → respetados.
- ✅ Verificación: crear presupuesto, registrar gasto, barra cambia color al cruzar umbrales → Task 8.

**2. Placeholders:** ninguno — todo el código va completo. La única instrucción condicional (helper `mirrorDelete` en Task 5) lleva fallback explícito.

**3. Consistencia de tipos / nombres:**
- `estadoPresupuesto` → `{ pctReal, ancho, color, superado }`; el dashboard usa exactamente esas claves (Task 7 Step 3). ✔
- `getGastosPorCategoriaMes` retorna objeto-mapa `{ [categoria_id]: total }`; el dashboard lo lee con `gastoPorCat[p.categoria_id]`. ✔
- Clases CSS `dash-presup-bar-fill--{verde|ambar|rojo}` coinciden con los valores de `color`. ✔
- `getPresupuestos` embebe `categorias(nombre, icono, color, tipo)`; el render lee `p.categorias`. ✔
- Store `'presupuestos'` consistente entre `nestra-db.js`, `_mirroredRead`, `outboxAdd`, `mirrorPut`. ✔
