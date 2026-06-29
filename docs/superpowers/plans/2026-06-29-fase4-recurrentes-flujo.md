# Fase 4 — Recurrentes + Flujo de caja proyectado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Driver para UI: **frontend-design**. **TDD** para los módulos puros.

**Goal:** Implementar las dos partes faltantes de la Fase 4 — gastos/ingresos **recurrentes** (tabla + detección + alta manual + vista en configuración) y la **proyección de flujo de caja** día-a-día del mes (card nueva en gráficos) — sin tocar presupuestos ni el flujo histórico.

**Architecture:** Tabla `recurrentes` por-usuario (RLS, espejo IndexedDB, outbox offline, LWW) igual al patrón de préstamos/presupuestos. Dos módulos puros testeables: `recurrentes-detect.js` (detección por reglas) y `flujo-proyeccion.js` (proyección día-a-día). UI: sección en `#configuracion` y card `chart9` en `#graficos`. Saldo inicial de la proyección = neto del mes (ingresos−gastos de las tx del mes).

**Tech Stack:** Vanilla JS (IIFE, `var`, `escHtml`), módulos ES (`export` + `window.*`), Supabase + RLS, IndexedDB (idb), Chart.js 4, Workbox SW, node `--test` para los puros. Sin build, sin AI externa.

---

## Convenciones del repo (no romper)

- JS de vista: IIFE, `var`, `escHtml()` en contenido de usuario.
- Módulos puros: `export { ... }` al final + `if (typeof window !== 'undefined') window.x = x;`, cargados con `<script type="module">`.
- Datos: `_mirroredRead(store, fetcher)` para leer; alta/edición con `outboxAdd`/`mirrorPut` cuando offline; `crypto.randomUUID()` + `updated_at` ISO para LWW.
- Tests: `test/*.test.mjs`, `node --test`, importan del módulo `../js/x.js`.
- Migraciones: idempotentes, RLS por dueño, trigger `set_updated_at` reusado. **Solo a la instancia Supabase v2, nunca a producción.**

---

## File Structure

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `supabase/migrations/20260629_recurrentes.sql` | Tabla `recurrentes` + RLS + trigger | Crear |
| `js/nestra-db.js` | Añadir store `recurrentes`, bump versión IDB 4→5 | Modificar |
| `js/db.js` | `getRecurrentes` / `upsertRecurrente` / `deleteRecurrente` | Modificar |
| `js/sync.js` | Handler outbox `delete_recurrente` | Modificar |
| `js/recurrentes-detect.js` | `detectarRecurrentes(txs, existentes, hoy)` puro | Crear |
| `js/flujo-proyeccion.js` | `proyectarFlujo({...})` puro | Crear |
| `test/recurrentes-detect.test.mjs` | Tests del detector | Crear |
| `test/flujo-proyeccion.test.mjs` | Tests de la proyección | Crear |
| `views/configuracion.html` | Sección "Gastos recurrentes" (lista, alta manual, detectados) | Modificar |
| `views/graficos.html` | Card `chart9` "Proyección de saldo" | Modificar |
| `index.html` | Cargar los 2 módulos nuevos | Modificar |
| `sw.js` | Precache de los 2 módulos + bump `SHELL_VERSION` | Modificar |

---

## Task 0: Migración + store IndexedDB

**Files:**
- Create: `supabase/migrations/20260629_recurrentes.sql`
- Modify: `js/nestra-db.js:9` (versión), `js/nestra-db.js:10` (`MIRROR_STORES`)

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/20260629_recurrentes.sql`:

```sql
-- =====================================================================
-- Nestra — Migración: recurrentes (FASE 4)
-- ---------------------------------------------------------------------
-- Gastos/ingresos recurrentes por-usuario (suscripciones, sueldo, renta).
-- `tipo` cubre ingreso fijo y gasto recurrente (ambos alimentan la
-- proyección de flujo de caja). RLS estricta por dueño. updated_at + trigger
-- para LWW (espejo offline). Idempotente. Ejecutar en SQL Editor de v2.
-- =====================================================================

create table if not exists public.recurrentes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  descripcion   text not null,
  monto         numeric(10,2) not null check (monto > 0),
  tipo          text not null default 'gasto' check (tipo in ('gasto','ingreso')),
  categoria_id  uuid references public.categorias (id) on delete set null,
  frecuencia    text not null default 'mensual'
                  check (frecuencia in ('mensual','quincenal','semanal')),
  dia_cargo     smallint check (dia_cargo between 1 and 31),
  proximo_cargo date,
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_recurrentes_user on public.recurrentes (user_id);

alter table public.recurrentes enable row level security;

drop policy if exists "recurrentes_acceso" on public.recurrentes;
create policy "recurrentes_acceso"
  on public.recurrentes for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop trigger if exists trg_recurrentes_updated_at on public.recurrentes;
create trigger trg_recurrentes_updated_at
  before update on public.recurrentes
  for each row execute function public.set_updated_at();
```

- [ ] **Step 2: Aplicar la migración a la instancia v2**

Aplicar vía MCP de Supabase (`apply_migration`, name `recurrentes`) o pegando el SQL en el SQL Editor del proyecto **v2**. NO aplicar a producción. Verificar: `select * from public.recurrentes limit 0;` no da error.

- [ ] **Step 3: Añadir el store al espejo IndexedDB**

En `js/nestra-db.js` línea 10, añadir `'recurrentes'` al array y subir la versión (línea 9):

```js
const NESTRA_IDB_VERSION = 5;
const MIRROR_STORES = ['transacciones', 'categorias', 'metas', 'prestamos', 'presupuestos', 'plantillas', 'recurrentes'];
```

El `upgrade()` ya crea cualquier store de `MIRROR_STORES` que falte (keyPath `'id'`), así que el bump a 5 crea `recurrentes` automáticamente.

- [ ] **Step 4: Verificar el store**

Arrancar preview (ver [[nestra-v2-test-account]]), abrir DevTools → Application → IndexedDB → `nestra` v5 → confirmar el object store `recurrentes`. `preview_console_logs` sin errores de upgrade.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260629_recurrentes.sql js/nestra-db.js
git commit -m "feat(fase4): tabla recurrentes con RLS + store IndexedDB (v5)"
```

---

## Task 1: CRUD de recurrentes en db.js + delete offline

**Files:**
- Modify: `js/db.js` (añadir bloque RECURRENTES, p.ej. tras el bloque PRESUPUESTOS ~L953)
- Modify: `js/sync.js` (handler `delete_recurrente`, junto al de `delete_transaccion` ~L46)

- [ ] **Step 1: Añadir el CRUD en db.js**

Insertar tras la función `getGastosPorCategoriaMes` (después de L953):

```js
// ═══════════════════════════════════════════════════════════════════
// RECURRENTES (Fase 4)
// ═══════════════════════════════════════════════════════════════════

// getRecurrentes() — recurrentes del usuario activo (espejado, offline-safe).
// Returns: array ordenado por created_at, o [] en error.
async function getRecurrentes() {
  const rows = await _mirroredRead('recurrentes', async () => {
    const { data, error } = await supabase
      .from('recurrentes')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  });
  return rows || [];
}

// upsertRecurrente(fila) — alta o edición. Si `fila.id` falta, genera uno.
// Online: upsert + mirror. Offline: outbox + mirror optimista.
// Returns: fila persistida (o optimista con _pending:true). Lanza Error en fallo real.
async function upsertRecurrente(fila) {
  const row = {
    id: fila.id || crypto.randomUUID(),
    user_id: _requireUserId(),
    descripcion: fila.descripcion,
    monto: Number(fila.monto),
    tipo: fila.tipo === 'ingreso' ? 'ingreso' : 'gasto',
    categoria_id: fila.categoria_id || null,
    frecuencia: fila.frecuencia || 'mensual',
    dia_cargo: fila.dia_cargo != null ? Number(fila.dia_cargo) : null,
    proximo_cargo: fila.proximo_cargo || null,
    activo: fila.activo !== false,
    updated_at: new Date().toISOString(),
  };

  if (!navigator.onLine) {
    await outboxAdd('recurrentes', row);
    await mirrorPut('recurrentes', { ...row, _pending: true });
    if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
    return { ...row, _pending: true };
  }
  try {
    const { data, error } = await supabase
      .from('recurrentes').upsert(row, { onConflict: 'id' }).select().single();
    if (error) throw error;
    await mirrorPut('recurrentes', data);
    return data;
  } catch (err) {
    if (_isNetworkError(err)) {
      await outboxAdd('recurrentes', row);
      await mirrorPut('recurrentes', { ...row, _pending: true });
      if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
      return { ...row, _pending: true };
    }
    console.error('Error en upsertRecurrente():', err.message || err);
    throw err;
  }
}

// deleteRecurrente(id) — borra. Online: server + espejo. Offline: outbox.
async function deleteRecurrente(id) {
  if (!navigator.onLine) {
    await outboxAdd('delete_recurrente', { id });
    try { const db = await nestraDB(); await db.delete('recurrentes', id); } catch (_) {}
    if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
    return;
  }
  try {
    const { error } = await supabase.from('recurrentes').delete().eq('id', id);
    if (error) throw error;
    try { const db = await nestraDB(); await db.delete('recurrentes', id); } catch (_) {}
  } catch (err) {
    if (_isNetworkError(err)) {
      await outboxAdd('delete_recurrente', { id });
      try { const db = await nestraDB(); await db.delete('recurrentes', id); } catch (_) {}
      if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
      return;
    }
    console.error('Error en deleteRecurrente():', err.message || err);
    throw err;
  }
}

if (typeof window !== 'undefined') {
  window.getRecurrentes = getRecurrentes;
  window.upsertRecurrente = upsertRecurrente;
  window.deleteRecurrente = deleteRecurrente;
}
```

> Nota: comprobar al final de `db.js` si ya hay un bloque `window.* = ...` con las demás funciones. Si el repo expone las funciones por estar en scope global del script clásico (db.js se carga SIN `type=module`, ver index.html L199), el bloque `if (typeof window...)` es redundante pero inofensivo. Si causara doble-declaración, omitir ese bloque (las funciones ya son globales).

- [ ] **Step 2: Añadir el handler de delete offline en sync.js**

En `js/sync.js`, tras el bloque `if (op.entity === 'delete_transaccion')` (~L62), añadir:

```js
  if (op.entity === 'delete_recurrente') {
    try {
      const { error } = await supabase.from('recurrentes').delete().eq('id', op.payload.id);
      if (error) throw error;
      try { const db = await nestraDB(); await db.delete('recurrentes', op.payload.id); } catch (_) {}
      return 'done';
    } catch (err) {
      if (!navigator.onLine || /failed to fetch|networkerror|load failed/i.test((err && err.message) + '')) return 'retry';
      console.error('Sync delete_recurrente falló:', err.message || err);
      await outboxSetStatus(op.op_id, 'error', (err && err.message) + '');
      return 'skip';
    }
  }
```

(La ruta genérica de `_replayOp` ya cubre el **upsert** de la entidad `recurrentes` vía `_serverRow` + `lwwWinner` + `upsert`.)

- [ ] **Step 3: Verificar CRUD en preview (consola)**

En `#configuracion` (con sesión), `preview_eval`:
```js
await upsertRecurrente({descripcion:'Netflix', monto:44.9, tipo:'gasto', frecuencia:'mensual', dia_cargo:5});
(await getRecurrentes()).map(r => r.descripcion + ' ' + r.monto);
```
Expected: array que incluye `"Netflix 44.9"`. Luego borrar:
```js
var rs = await getRecurrentes(); await deleteRecurrente(rs[rs.length-1].id); (await getRecurrentes()).length;
```
Expected: longitud decrementa. `preview_console_logs` limpio.

- [ ] **Step 4: Commit**

```bash
git add js/db.js js/sync.js
git commit -m "feat(fase4): CRUD recurrentes (espejado + outbox offline) y delete sync"
```

---

## Task 2: Detector puro `recurrentes-detect.js` (TDD)

**Files:**
- Create: `js/recurrentes-detect.js`
- Test: `test/recurrentes-detect.test.mjs`

Contrato:
`detectarRecurrentes(txs, existentes, hoy)` → array de candidatos
`{ descripcion, monto, tipo, categoria_id, frecuencia:'mensual', proximo_cargo, ocurrencias }`.
Regla: agrupar por `(categoria_id, monto redondeado dentro de tolerancia)`, tolerancia `max(2, monto*0.05)`; candidato si ≥2 ocurrencias con separación media 25–35 días; excluir grupos cuya `(categoria_id, monto±tol)` ya exista en `existentes`. `txs` = transacciones `{ id, tipo, monto, categoria_id, fecha:'YYYY-MM-DD', nota }`.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/recurrentes-detect.test.mjs`:

```js
import assert from 'node:assert';
import { test } from 'node:test';
import { detectarRecurrentes } from '../js/recurrentes-detect.js';

const HOY = new Date(2026, 5, 29); // 2026-06-29

function tx(monto, fecha, categoria_id = 'c1', nota = 'Netflix', tipo = 'gasto') {
  return { id: fecha + monto, tipo, monto, categoria_id, fecha, nota };
}

test('dos cargos mensuales iguales → candidato', () => {
  const txs = [tx(44.9, '2026-04-05'), tx(44.9, '2026-05-05'), tx(44.9, '2026-06-05')];
  const out = detectarRecurrentes(txs, [], HOY);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].categoria_id, 'c1');
  assert.strictEqual(out[0].frecuencia, 'mensual');
  assert.ok(out[0].monto >= 44 && out[0].monto <= 46);
  assert.ok(out[0].ocurrencias >= 2);
});

test('una sola ocurrencia → no candidato', () => {
  assert.strictEqual(detectarRecurrentes([tx(44.9, '2026-06-05')], [], HOY).length, 0);
});

test('montos dispares (no mensual estable) → no candidato', () => {
  const txs = [tx(10, '2026-04-05'), tx(80, '2026-05-05')];
  assert.strictEqual(detectarRecurrentes(txs, [], HOY).length, 0);
});

test('tolerancia ±5%: 100 y 103 se agrupan', () => {
  const txs = [tx(100, '2026-04-10', 'c2'), tx(103, '2026-05-10', 'c2')];
  assert.strictEqual(detectarRecurrentes(txs, [], HOY).length, 1);
});

test('excluye los ya registrados (mismo categoria + monto±tol)', () => {
  const txs = [tx(44.9, '2026-04-05'), tx(44.9, '2026-05-05')];
  const existentes = [{ categoria_id: 'c1', monto: 45, frecuencia: 'mensual' }];
  assert.strictEqual(detectarRecurrentes(txs, existentes, HOY).length, 0);
});

test('separación semanal (~7 días) no cuenta como mensual', () => {
  const txs = [tx(20, '2026-06-01'), tx(20, '2026-06-08'), tx(20, '2026-06-15')];
  assert.strictEqual(detectarRecurrentes(txs, [], HOY).length, 0);
});
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `node --test test/recurrentes-detect.test.mjs`
Expected: FALLA — `Cannot find module '../js/recurrentes-detect.js'` o `detectarRecurrentes is not a function`.

- [ ] **Step 3: Implementar el módulo**

Crear `js/recurrentes-detect.js`:

```js
// Nestra — detección de transacciones recurrentes (función pura, sin red).
// Agrupa por (categoria_id, monto ±tolerancia) y marca como candidato
// mensual los grupos con ≥2 ocurrencias separadas ~25–35 días.

function _diasEntre(aISO, bISO) {
  var a = new Date(aISO + 'T00:00:00');
  var b = new Date(bISO + 'T00:00:00');
  return Math.abs(Math.round((b - a) / 86400000));
}

function _tolerancia(monto) { return Math.max(2, monto * 0.05); }

// ¿el monto cae dentro de la tolerancia del centro del grupo?
function _coincide(monto, centro) { return Math.abs(monto - centro) <= _tolerancia(centro); }

function detectarRecurrentes(txs, existentes, hoy) {
  var lista = (txs || []).filter(function (t) {
    return t && t.categoria_id && Number(t.monto) > 0 && t.fecha;
  });
  existentes = existentes || [];

  // Agrupar por categoría, luego por cercanía de monto.
  var porCat = {};
  lista.forEach(function (t) {
    (porCat[t.categoria_id] = porCat[t.categoria_id] || []).push(t);
  });

  var candidatos = [];
  Object.keys(porCat).forEach(function (catId) {
    var items = porCat[catId].slice().sort(function (a, b) {
      return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0;
    });
    var usados = new Array(items.length).fill(false);

    for (var i = 0; i < items.length; i++) {
      if (usados[i]) continue;
      var grupo = [items[i]];
      usados[i] = true;
      var centro = Number(items[i].monto);
      for (var j = i + 1; j < items.length; j++) {
        if (!usados[j] && _coincide(Number(items[j].monto), centro)) {
          grupo.push(items[j]);
          usados[j] = true;
        }
      }
      if (grupo.length < 2) continue;

      // Validar cadencia mensual: separaciones consecutivas en 25–35 días.
      var mensual = true;
      for (var k = 1; k < grupo.length; k++) {
        var d = _diasEntre(grupo[k - 1].fecha, grupo[k].fecha);
        if (d < 25 || d > 35) { mensual = false; break; }
      }
      if (!mensual) continue;

      var montoProm = grupo.reduce(function (s, g) { return s + Number(g.monto); }, 0) / grupo.length;
      montoProm = Math.round(montoProm * 100) / 100;

      // Excluir si ya existe un recurrente equivalente.
      var yaExiste = existentes.some(function (e) {
        return e.categoria_id === catId && _coincide(montoProm, Number(e.monto));
      });
      if (yaExiste) continue;

      var ultima = grupo[grupo.length - 1];
      var prox = new Date(ultima.fecha + 'T00:00:00');
      prox.setMonth(prox.getMonth() + 1);
      var diaCargo = prox.getDate();

      candidatos.push({
        descripcion: (ultima.nota || '').trim() || 'Recurrente',
        monto: montoProm,
        tipo: ultima.tipo === 'ingreso' ? 'ingreso' : 'gasto',
        categoria_id: catId,
        frecuencia: 'mensual',
        dia_cargo: diaCargo,
        proximo_cargo: prox.toISOString().slice(0, 10),
        ocurrencias: grupo.length,
      });
    }
  });

  return candidatos;
}

if (typeof window !== 'undefined') window.detectarRecurrentes = detectarRecurrentes;

export { detectarRecurrentes };
```

- [ ] **Step 4: Ejecutar tests hasta verde**

Run: `node --test test/recurrentes-detect.test.mjs`
Expected: PASS (6 tests). Si falla el de tolerancia/semanal, revisar los umbrales `_coincide`/25–35.

- [ ] **Step 5: Commit**

```bash
git add js/recurrentes-detect.js test/recurrentes-detect.test.mjs
git commit -m "feat(fase4): detector puro de recurrentes (TDD)"
```

---

## Task 3: Proyección pura `flujo-proyeccion.js` (TDD)

**Files:**
- Create: `js/flujo-proyeccion.js`
- Test: `test/flujo-proyeccion.test.mjs`

Contrato:
`proyectarFlujo({ saldoInicial, hoy, recurrentes, aportesMeta })` →
`{ dias: [{ fecha:'YYYY-MM-DD', saldo:Number }], primerDiaNegativo: 'YYYY-MM-DD'|null, saldoFinal:Number }`.
- `hoy` = Date; el rango es de `hoy` (día actual) al último día de ese mes.
- `recurrentes` = activos `{ tipo, monto, frecuencia, dia_cargo }`. Mensual: cae en `dia_cargo`. Quincenal: `dia_cargo` y `dia_cargo+15`. Semanal: cada 7 días desde `dia_cargo`. Ingreso suma, gasto resta. Solo cuentan los días dentro del rango (≥ día de hoy).
- `aportesMeta` = `[{ dia:Number, monto:Number }]` (restan en su día). Lo arma la vista.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/flujo-proyeccion.test.mjs`:

```js
import assert from 'node:assert';
import { test } from 'node:test';
import { proyectarFlujo } from '../js/flujo-proyeccion.js';

// Junio 2026: 30 días. HOY = día 20 → proyecta días 20..30 (11 días).
const HOY = new Date(2026, 5, 20);

test('sin recurrentes ni aportes → línea plana, sin día negativo', () => {
  const r = proyectarFlujo({ saldoInicial: 500, hoy: HOY, recurrentes: [], aportesMeta: [] });
  assert.strictEqual(r.dias.length, 11);
  assert.strictEqual(r.dias[0].fecha, '2026-06-20');
  assert.strictEqual(r.dias[10].fecha, '2026-06-30');
  assert.strictEqual(r.saldoFinal, 500);
  assert.strictEqual(r.primerDiaNegativo, null);
});

test('gasto recurrente mensual el día 25 resta del saldo', () => {
  const r = proyectarFlujo({
    saldoInicial: 100, hoy: HOY,
    recurrentes: [{ tipo: 'gasto', monto: 40, frecuencia: 'mensual', dia_cargo: 25 }],
    aportesMeta: [],
  });
  assert.strictEqual(r.saldoFinal, 60);
  assert.strictEqual(r.primerDiaNegativo, null);
});

test('gasto que supera el saldo → marca primerDiaNegativo', () => {
  const r = proyectarFlujo({
    saldoInicial: 30, hoy: HOY,
    recurrentes: [{ tipo: 'gasto', monto: 50, frecuencia: 'mensual', dia_cargo: 22 }],
    aportesMeta: [],
  });
  assert.strictEqual(r.primerDiaNegativo, '2026-06-22');
  assert.strictEqual(r.saldoFinal, -20);
});

test('ingreso fijo mensual levanta el saldo', () => {
  const r = proyectarFlujo({
    saldoInicial: 0, hoy: HOY,
    recurrentes: [{ tipo: 'ingreso', monto: 200, frecuencia: 'mensual', dia_cargo: 28 }],
    aportesMeta: [],
  });
  assert.strictEqual(r.saldoFinal, 200);
});

test('aporte a meta resta en su día', () => {
  const r = proyectarFlujo({
    saldoInicial: 300, hoy: HOY, recurrentes: [],
    aportesMeta: [{ dia: 30, monto: 120 }],
  });
  assert.strictEqual(r.saldoFinal, 180);
});

test('recurrente con dia_cargo anterior a hoy no cuenta este mes', () => {
  const r = proyectarFlujo({
    saldoInicial: 100, hoy: HOY,
    recurrentes: [{ tipo: 'gasto', monto: 40, frecuencia: 'mensual', dia_cargo: 5 }],
    aportesMeta: [],
  });
  assert.strictEqual(r.saldoFinal, 100);
});
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `node --test test/flujo-proyeccion.test.mjs`
Expected: FALLA — módulo/función inexistente.

- [ ] **Step 3: Implementar el módulo**

Crear `js/flujo-proyeccion.js`:

```js
// Nestra — proyección de flujo de caja del mes (función pura, sin red).
// Recorre día-a-día desde hoy hasta fin de mes aplicando recurrentes y
// aportes a metas. Marca el primer día en que el saldo proyectado < 0.

function _p2(n) { return n < 10 ? '0' + n : String(n); }
function _iso(anio, mes1, dia) { return anio + '-' + _p2(mes1) + '-' + _p2(dia); }

// ¿una recurrente cae el día `dia` del mes (>= díaActual ya filtrado por el caller)?
function _caeEnDia(rec, dia) {
  var base = Number(rec.dia_cargo) || 1;
  var f = rec.frecuencia || 'mensual';
  if (f === 'mensual') return dia === base;
  if (f === 'quincenal') return dia === base || dia === base + 15;
  if (f === 'semanal') return dia >= base && (dia - base) % 7 === 0;
  return dia === base;
}

function proyectarFlujo(opts) {
  opts = opts || {};
  var saldo = Number(opts.saldoInicial) || 0;
  var hoy = opts.hoy instanceof Date ? opts.hoy : new Date();
  var recurrentes = (opts.recurrentes || []).filter(function (r) { return r && r.activo !== false; });
  var aportes = opts.aportesMeta || [];

  var anio = hoy.getFullYear();
  var mes1 = hoy.getMonth() + 1;             // 1-based
  var diaHoy = hoy.getDate();
  var ultimoDia = new Date(anio, mes1, 0).getDate(); // día 0 del mes siguiente = último de éste

  var dias = [];
  var primerDiaNegativo = null;

  for (var dia = diaHoy; dia <= ultimoDia; dia++) {
    recurrentes.forEach(function (r) {
      if (!_caeEnDia(r, dia)) return;
      var m = Number(r.monto) || 0;
      saldo += (r.tipo === 'ingreso' ? m : -m);
    });
    aportes.forEach(function (a) {
      if (Number(a.dia) === dia) saldo -= (Number(a.monto) || 0);
    });

    saldo = Math.round(saldo * 100) / 100;
    var fecha = _iso(anio, mes1, dia);
    dias.push({ fecha: fecha, saldo: saldo });
    if (saldo < 0 && primerDiaNegativo === null) primerDiaNegativo = fecha;
  }

  return { dias: dias, primerDiaNegativo: primerDiaNegativo, saldoFinal: saldo };
}

if (typeof window !== 'undefined') window.proyectarFlujo = proyectarFlujo;

export { proyectarFlujo };
```

- [ ] **Step 4: Ejecutar tests hasta verde**

Run: `node --test test/flujo-proyeccion.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add js/flujo-proyeccion.js test/flujo-proyeccion.test.mjs
git commit -m "feat(fase4): proyección pura de flujo de caja (TDD)"
```

---

## Task 4: Wiring de módulos (index.html + sw.js)

Cargar los puros antes de las vistas que los usan y precachearlos para offline.

**Files:**
- Modify: `index.html:208` (tras `presupuestos.js`)
- Modify: `sw.js:15` (versión) y `sw.js` (array precache)

- [ ] **Step 1: Cargar los módulos en index.html**

Tras la línea `<script type="module" src="js/presupuestos.js"></script>` (L208), añadir:

```html
    <script type="module" src="js/recurrentes-detect.js"></script>
    <script type="module" src="js/flujo-proyeccion.js"></script>
```

- [ ] **Step 2: Precache + bump de versión en sw.js**

Subir `SHELL_VERSION` (L15) al siguiente valor:

```js
const SHELL_VERSION = 'v15';
```

En el array `precacheAndRoute([...])`, junto a `js/presupuestos.js`, añadir:

```js
  { url: 'js/recurrentes-detect.js', revision: SHELL_VERSION },
  { url: 'js/flujo-proyeccion.js', revision: SHELL_VERSION },
```

- [ ] **Step 3: Verificar carga**

Recargar preview. `preview_eval`: `typeof window.detectarRecurrentes` → `"function"`; `typeof window.proyectarFlujo` → `"function"`. `preview_console_logs` sin 404 de los nuevos scripts.

- [ ] **Step 4: Commit**

```bash
git add index.html sw.js
git commit -m "feat(fase4): cargar y precachear módulos recurrentes/proyección (SW v15)"
```

---

## Task 5: Sección "Gastos recurrentes" en configuración

Vista grande. Reusar primitivas existentes: `.cat-chip`, `.signature-num`, `.input`, `.btn-primary`, `searchable-select.js`, `escHtml`, `getCategorias`, `getRecurrentes`, `upsertRecurrente`, `deleteRecurrente`, `getTransacciones`, `detectarRecurrentes`.

**Files:** Modify `views/configuracion.html` (markup de una sección nueva + bloque de script en el IIFE de la vista)

- [ ] **Step 1: Localizar el patrón de sección existente**

```bash
grep -nE "class=\"cfg-section|<section|id=\"cfg-|function cargarConfig|DOMContentLoaded|addEventListener\('submit'" views/configuracion.html | head -30
```
Identificar: (a) el contenedor donde insertar la sección, (b) cómo arranca el script de la vista (función init/carga), (c) cómo se construye el selector buscable de categoría en otras secciones (reusar el mismo helper).

- [ ] **Step 2: Añadir el markup de la sección**

Insertar una sección (seguir las clases `cfg-*` que uses en el repo; ejemplo con clases genéricas presentes):

```html
<section class="cfg-section" id="cfg-recurrentes">
  <h2 class="cfg-section-title">Gastos recurrentes</h2>
  <p class="cfg-section-desc">Suscripciones e ingresos fijos. Alimentan la proyección de saldo.</p>

  <div class="cfg-rec-total">
    Comprometido al mes: <span class="signature-num" id="recTotalMes">S/ 0.00</span>
  </div>

  <ul class="cfg-rec-lista" id="recLista" aria-live="polite"></ul>

  <div class="cfg-rec-detectados" id="recDetectadosWrap" hidden>
    <h3 class="cfg-rec-sub">Detectados en tu historial</h3>
    <ul class="cfg-rec-lista" id="recDetectados"></ul>
  </div>

  <form id="recForm" class="cfg-rec-form" autocomplete="off">
    <input class="input" id="recDesc" type="text" placeholder="Descripción (ej. Netflix)" required maxlength="80">
    <input class="input" id="recMonto" type="number" step="0.01" min="0.01" placeholder="Monto" required>
    <select class="input" id="recTipo">
      <option value="gasto">Gasto</option>
      <option value="ingreso">Ingreso</option>
    </select>
    <div id="recCatWrap"></div>
    <select class="input" id="recFrec">
      <option value="mensual">Mensual</option>
      <option value="quincenal">Quincenal</option>
      <option value="semanal">Semanal</option>
    </select>
    <input class="input" id="recDia" type="number" min="1" max="31" placeholder="Día de cargo (1-31)">
    <button class="btn-primary" type="submit">Agregar recurrente</button>
  </form>
</section>
```

Estilos mínimos en el `<style>` inline de la vista (tokens, no hex nuevos):

```css
.cfg-rec-total { margin: var(--space-sm) 0; color: var(--text-secondary); }
.cfg-rec-total .signature-num { font-size: var(--font-size-xl); color: var(--text-dark); }
.cfg-rec-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-xs); }
.cfg-rec-item { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm); border: 1px solid var(--border-light); border-radius: var(--radius-md); background: var(--bg-light-secondary); }
.cfg-rec-item .rec-meta { flex: 1; min-width: 0; }
.cfg-rec-item .rec-desc { color: var(--text-dark); }
.cfg-rec-item .rec-sub { color: var(--text-secondary); font-size: var(--font-size-sm); }
.cfg-rec-item .rec-monto { font-variant-numeric: tabular-nums; }
.cfg-rec-form { display: grid; gap: var(--space-sm); margin-top: var(--space-md); }
```

- [ ] **Step 3: Lógica de render y alta/borrado en el script de la vista**

Dentro del IIFE de la vista, añadir (y llamar `cargarRecurrentes()` en el arranque de la vista, junto al resto de cargas):

```js
async function cargarRecurrentes() {
  var lista = await getRecurrentes();
  var cats = await getCategorias(); // todas (gasto+ingreso) para resolver nombre/icono/color
  var catById = {};
  (cats || []).forEach(function (c) { catById[c.id] = c; });

  // Total mensual comprometido (solo gastos, normalizado a mensual).
  var factor = { mensual: 1, quincenal: 2, semanal: 4 };
  var total = (lista || []).filter(function (r) { return r.tipo === 'gasto' && r.activo !== false; })
    .reduce(function (s, r) { return s + Number(r.monto) * (factor[r.frecuencia] || 1); }, 0);
  document.getElementById('recTotalMes').textContent = 'S/ ' + total.toFixed(2);

  var ul = document.getElementById('recLista');
  ul.innerHTML = (lista && lista.length)
    ? lista.map(function (r) { return _recItemHTML(r, catById[r.categoria_id]); }).join('')
    : '<li class="cfg-rec-item rec-sub">Aún no tienes recurrentes.</li>';

  // Botones eliminar (delegación simple).
  Array.prototype.forEach.call(ul.querySelectorAll('[data-del]'), function (b) {
    b.addEventListener('click', async function () {
      await deleteRecurrente(b.getAttribute('data-del'));
      cargarRecurrentes();
    });
  });

  await cargarDetectados(lista);
}

function _recItemHTML(r, cat) {
  var color = (cat && cat.color) || 'var(--color-primary)';
  var icon = (typeof iconoCategoria === 'function' && cat) ? iconoCategoria(cat) : '';
  var signo = r.tipo === 'ingreso' ? '+' : '−';
  return '<li class="cfg-rec-item">'
    + '<span class="cat-chip" style="--chip-color:' + escHtml(color) + '">' + icon + '</span>'
    + '<span class="rec-meta"><span class="rec-desc">' + escHtml(r.descripcion) + '</span>'
    + '<span class="rec-sub"> · ' + escHtml(r.frecuencia) + (r.dia_cargo ? ' · día ' + r.dia_cargo : '') + '</span></span>'
    + '<span class="rec-monto">' + signo + ' S/ ' + Number(r.monto).toFixed(2) + '</span>'
    + '<button class="btn-icon" type="button" aria-label="Eliminar" data-del="' + escHtml(r.id) + '">✕</button>'
    + '</li>';
}

async function cargarDetectados(existentes) {
  var wrap = document.getElementById('recDetectadosWrap');
  var ul = document.getElementById('recDetectados');
  try {
    var hace120 = new Date(); hace120.setDate(hace120.getDate() - 120);
    var txs = await getTransacciones({ fecha_desde: hace120.toISOString().slice(0, 10) });
    var cands = detectarRecurrentes(txs || [], existentes || [], new Date());
    if (!cands.length) { wrap.hidden = true; ul.innerHTML = ''; return; }
    wrap.hidden = false;
    ul.innerHTML = cands.map(function (c, i) {
      return '<li class="cfg-rec-item">'
        + '<span class="rec-meta"><span class="rec-desc">' + escHtml(c.descripcion) + '</span>'
        + '<span class="rec-sub"> · ' + c.ocurrencias + ' veces · día ' + c.dia_cargo + '</span></span>'
        + '<span class="rec-monto">S/ ' + Number(c.monto).toFixed(2) + '</span>'
        + '<button class="btn-primary btn-sm" type="button" data-add="' + i + '">Marcar</button>'
        + '<button class="btn-icon" type="button" aria-label="Descartar" data-skip="' + i + '">✕</button>'
        + '</li>';
    }).join('');
    Array.prototype.forEach.call(ul.querySelectorAll('[data-add]'), function (b) {
      b.addEventListener('click', async function () {
        await upsertRecurrente(cands[Number(b.getAttribute('data-add'))]);
        cargarRecurrentes();
      });
    });
    Array.prototype.forEach.call(ul.querySelectorAll('[data-skip]'), function (b) {
      b.addEventListener('click', function () { b.closest('.cfg-rec-item').remove(); });
    });
  } catch (e) { wrap.hidden = true; }
}

document.getElementById('recForm').addEventListener('submit', async function (ev) {
  ev.preventDefault();
  var desc = document.getElementById('recDesc').value.trim();
  var monto = parseFloat(document.getElementById('recMonto').value);
  if (!desc || !(monto > 0)) return;
  await upsertRecurrente({
    descripcion: desc,
    monto: monto,
    tipo: document.getElementById('recTipo').value,
    categoria_id: (window._recCatSel && window._recCatSel.value) || null,
    frecuencia: document.getElementById('recFrec').value,
    dia_cargo: parseInt(document.getElementById('recDia').value, 10) || null,
  });
  ev.target.reset();
  cargarRecurrentes();
});
```

> El selector buscable de categoría (`#recCatWrap` → `window._recCatSel`): reusar el MISMO helper de `searchable-select.js` que ya usa el form de transacción/categoría en otras secciones de esta vista (ver Step 1). Inicializarlo con las categorías y guardar la selección en `window._recCatSel`. Si el repo expone una función como `crearSearchableSelect(container, opciones)`, usarla idéntica; no inventar API nueva.

- [ ] **Step 4: Verificar en preview**

`#configuracion`:
- Alta manual de "Netflix 44.9 mensual día 5" → aparece en la lista, total sube. Screenshot dark 390px.
- Eliminar → desaparece, total baja.
- Si hay historial con un gasto mensual repetido, el bloque "Detectados" lo propone; "Marcar" lo agrega.
- `preview_console_logs` limpio. Toggle a light → coherente.

- [ ] **Step 5: Commit**

```bash
git add views/configuracion.html
git commit -m "feat(fase4): sección recurrentes en configuración (lista, alta manual, detectados)"
```

---

## Task 6: Card "Proyección de saldo" en gráficos (`chart9`)

Añadir un noveno gráfico sin tocar los 8 existentes ni el flujo histórico (chart6).

**Files:** Modify `views/graficos.html` (markup card, `cargarDatos`, `render9`, `RENDERS`, `visiblesPara`, guard `for n<=9`)

- [ ] **Step 1: Añadir la card al markup**

Tras la card de chart8 "Proyección de metas" (~L71), añadir:

```html
    <section class="graf-card" data-graf="9">
      <h2 class="graf-card-title">Proyección de saldo</h2>
      <p class="graf-card-desc">Saldo proyectado del mes según recurrentes y aportes. ¿Llegas a fin de mes?</p>
      <div class="graf-canvas-wrap"><canvas id="chart9" aria-label="Proyección de saldo del mes"></canvas></div>
    </section>
```

- [ ] **Step 2: Incluir recurrentes en `cargarDatos`**

En `cargarDatos(ambito)`, antes de cada `return {...}`, ya se tiene `txMes`. Añadir una lectura de recurrentes y pasarla en ambos objetos de retorno. Al inicio de la función, tras `var categoriasGasto = await getCategorias('gasto');`, añadir:

```js
      var recurrentes = await getRecurrentes();
```

Y en **cada** objeto `return { ... }` (personal y hogar), añadir la propiedad:

```js
        recurrentes: recurrentes || [],
```

- [ ] **Step 3: Implementar `render9`**

Tras `render8` (~L576-… fin), añadir:

```js
    function render9(datos) {
      var hoy = new Date();
      var mesVista = estado.mes, anioVista = estado.anio;
      // Solo proyecta el mes en curso (proyección hacia adelante).
      if (mesVista !== hoy.getMonth() + 1 || anioVista !== hoy.getFullYear()) {
        setEstado(9, 'vacio'); return;
      }

      // Saldo inicial = neto del mes hasta hoy (ingresos − gastos de txMes).
      var neto = (datos.txMes || []).reduce(function (s, t) {
        return s + (t.tipo === 'ingreso' ? Number(t.monto) : -Number(t.monto));
      }, 0);

      var recs = (datos.recurrentes || []).filter(function (r) { return r.activo !== false; });

      // Aportes a metas: aporte mensual planificado, programado al último día del mes.
      var ultimoDia = new Date(anioVista, mesVista, 0).getDate();
      var aportesMeta = [];
      (datos.metas || []).forEach(function (mw) {
        var mt = mw.meta;
        var restante = Number(mt.monto_objetivo) - Number(mt.monto_actual);
        if (restante > 0) aportesMeta.push({ dia: ultimoDia, monto: 0 }); // ver nota
      });
      // Nota: si existe una función de aporte planificado (p.ej. en safe-to-spend),
      // usar su monto aquí en vez de 0. Para v1, dejar 0 si no hay fuente fiable
      // (la proyección refleja recurrentes; metas se suman cuando haya dato).

      if (!recs.length && neto === 0) { setEstado(9, 'vacio'); return; }

      var proy = proyectarFlujo({ saldoInicial: neto, hoy: hoy, recurrentes: recs, aportesMeta: aportesMeta });
      if (!proy.dias.length) { setEstado(9, 'vacio'); return; }

      setEstado(9, 'ok');
      var labels = proy.dias.map(function (d) { return Number(d.fecha.slice(8, 10)); });
      var valores = proy.dias.map(function (d) { return d.saldo; });
      var negIdx = proy.primerDiaNegativo
        ? proy.dias.findIndex(function (d) { return d.fecha === proy.primerDiaNegativo; })
        : -1;

      charts.chart9 = new Chart($('chart9'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Saldo proyectado',
            data: valores,
            borderColor: cssVar('--color-primary'),
            backgroundColor: 'transparent',
            pointRadius: valores.map(function (_, i) { return i === negIdx ? 5 : 0; }),
            pointBackgroundColor: cssVar('--color-danger'),
            tension: 0.2,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: function (it) { return ' S/ ' + Number(it.raw).toFixed(2); } } },
          },
          scales: {
            x: { ticks: _tickOpts(cssVar('--text-secondary')), grid: { display: false } },
            y: { ticks: _tickOpts(cssVar('--text-secondary')), grid: { color: cssVar('--border-light') } },
          },
        },
      });
    }
```

- [ ] **Step 4: Registrar render9 en `RENDERS`, `visiblesPara` y el guard**

Buscar la definición del array de renders y el guard de Chart:
```bash
grep -nE "RENDERS|visiblesPara|for \(var n = 1; n <= 8" views/graficos.html
```
- En el array `RENDERS` (orden 1..8), añadir `render9` al final.
- En `visiblesPara`, añadir `9` a **ambos** arrays: `[1,2,4,5,7,8,9]` (personal) y `[1,2,3,4,5,6,7,8,9]` (hogar).
- En el guard `for (var n = 1; n <= 8; n++) setEstado(n, 'error');` cambiar `8` → `9`.

- [ ] **Step 5: Verificar en preview**

`#graficos` en el mes actual:
- Con recurrentes creados (Task 5), aparece la línea de proyección; si un gasto excede el saldo, hay punto rojo en el día negativo. Screenshot dark 390px + 1024px.
- Mes anterior (botón ‹): la card muestra estado "vacío" (solo proyecta el mes en curso).
- `preview_console_logs` sin errores de Chart.js. Toggle light → ejes/línea legibles.

- [ ] **Step 6: Commit**

```bash
git add views/graficos.html
git commit -m "feat(fase4): card proyección de saldo (chart9) en gráficos"
```

---

## Task 7: Smoke final + push de despliegue

- [ ] **Step 1: Correr toda la suite de tests**

Run: `node --test test/`
Expected: PASS (incluye los nuevos `recurrentes-detect` y `flujo-proyeccion`, sin romper los existentes).

- [ ] **Step 2: Recorrido funcional en preview (dark + light)**

Login → `#configuracion` (alta + detección + borrado de recurrente) → `#graficos` (proyección con día negativo) → recargar (persiste) → modo avión: alta de recurrente queda `_pending`, reconectar → sync la sube. `preview_console_logs` limpio en cada paso.

- [ ] **Step 3: Verificar PWA shell nuevo**

`preview_eval`: `navigator.serviceWorker.controller` no nulo. Cache `nestra-precache` contiene `js/recurrentes-detect.js` y `js/flujo-proyeccion.js`.

- [ ] **Step 4: Push a v2 (deploy Cloudflare Pages)**

```bash
git push origin v2
```
Esperar ~1-2 min el build. Verificar live:
```bash
curl -sL https://nestra-8rl.pages.dev/sw.js | grep SHELL_VERSION
```
Expected: `const SHELL_VERSION = 'v15';`. En el teléfono, cerrar/reabrir la PWA para tomar el shell nuevo.

---

## Self-Review (autor del plan)

**1. Cobertura del spec:**
- ✅ Tabla `recurrentes` + RLS + trigger → Task 0.
- ✅ Espejo IndexedDB + CRUD offline (LWW) → Task 0 (store), Task 1 (CRUD + delete sync).
- ✅ Detección por reglas (≥2 ocurrencias mensuales, tolerancia, excluye existentes) → Task 2 (TDD).
- ✅ Proyección día-a-día con primer día negativo, ingresos/gastos/aportes → Task 3 (TDD).
- ✅ Vista recurrentes en configuración (lista, total comprometido, detectados, alta manual) → Task 5.
- ✅ Card proyección en gráficos sin tocar el flujo histórico → Task 6.
- ✅ Wiring + precache + bump SW → Task 4; deploy → Task 7.
- ✅ Presupuestos NO se toca; chart6 NO se toca; detector excluye duplicados.

**2. Placeholders:** el único punto abierto es el monto de aporte a meta en `render9` (Task 6 Step 3), dejado explícitamente en 0 para v1 con nota de cómo conectarlo si hay fuente fiable — la proyección de recurrentes (núcleo del spec) está completa. No bloquea.

**3. Consistencia de tipos/nombres:** `detectarRecurrentes(txs, existentes, hoy)` y `proyectarFlujo({saldoInicial, hoy, recurrentes, aportesMeta})` usados igual en tests, módulos y `render9`/configuración. Campos de fila (`descripcion, monto, tipo, categoria_id, frecuencia, dia_cargo, proximo_cargo, activo`) idénticos entre migración, `upsertRecurrente`, detector y UI. `SHELL_VERSION='v15'`, IDB v5.

**Riesgo conocido:** la API exacta del selector buscable (`searchable-select.js`) y las clases `cfg-*` de configuración deben confirmarse contra el repo en Task 5 Step 1 antes de codear el markup; el plan indica reusar el helper existente, no inventar API.
