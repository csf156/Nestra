# Rediseño de #revisar (swipe + offline + undo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir `views/revisar.html` en una bandeja de triage rápida — card compacta con swipe (confirmar/descartar), edición inline de categoría por chip+bottom-sheet, undo de ambas acciones, y funcionamiento offline real (lista, badge, confirmar/descartar por espejo IndexedDB + outbox con LWW).

**Architecture:** App PWA vanilla sin build. La vista lee/escribe por funciones globales en `js/db.js`; el offline usa el espejo IndexedDB (`js/nestra-db.js`) + una outbox FIFO cuyo replay vive en `js/sync.js`. Se añade la tabla `ingest_pendientes` al espejo, un op de outbox `ingest_estado` con guardia LWW por `updated_at` (columna nueva en base), y se reescriben confirmar/descartar offline-first. La vista maneja swipe, chip de categoría y una ventana de undo en memoria.

**Tech Stack:** JS vanilla (globals, sin módulos ES en la vista), `idb` vendored, Supabase JS v2, PostgREST/RLS, Service Worker Workbox NetworkFirst.

**Testing:** No hay harness de tests JS en el front-end (vanilla, sin build). La verificación de cada tarea es en el preview local (`preview_start` config `nestra`, :5050) con filas de prueba en la **cuenta throwaway** (nunca el hogar real — ver memoria `nestra-v2-test-account`), más `supabase/tests/schema_contract_test.sql` para la base. Evidencia = screenshots + consultas de estado, no "debería funcionar".

---

## File Structure

- `supabase/migrations/20260717_ingest_updated_at.sql` — **crear**: columna `updated_at` + backfill + trigger. Revisada por el usuario antes de aplicar.
- `supabase/tests/schema_contract_test.sql` — **modificar**: cubrir `ingest_pendientes.updated_at`.
- `js/nestra-db.js` — **modificar**: `MIRROR_STORES` += `ingest_pendientes`; `NESTRA_IDB_VERSION` 5→6.
- `js/db.js` — **modificar**: `getIngestPendientes`/`contarIngestPendientes` vía `_mirroredRead`; `confirmarIngestPendiente`/`descartarIngestPendiente` offline-first; `revertirIngestPendiente` (nuevo); todos fijan `updated_at`.
- `js/sync.js` — **modificar**: nuevo op `ingest_estado` con guardia LWW.
- `views/revisar.html` — **modificar**: card compacta, chip+bottom-sheet, swipe, gate de completitud, undo.
- `sw.js` — **modificar**: bump `SHELL_VERSION` v31→v32.

---

## Task 1: Migración — `updated_at` en `ingest_pendientes`

**Files:**
- Create: `supabase/migrations/20260717_ingest_updated_at.sql`
- Modify: `supabase/tests/schema_contract_test.sql`

LWW compara `updated_at`; la tabla no la tiene. Sin esta columna el op `ingest_estado` (Task 5) no puede resolver conflictos entre dispositivos.

- [ ] **Step 1: Escribir el SQL de la migración**

```sql
-- =====================================================================
-- Nestra — Migración: updated_at en ingest_pendientes (para LWW)
-- ---------------------------------------------------------------------
-- El cliente pasa a resolver confirmar/descartar offline por outbox con
-- Last-Write-Wins por updated_at (como transacciones). La tabla no tenía
-- la columna. Backfill con created_at para las filas existentes.
-- Trigger para que updated_at se mueva también si algún día se escribe
-- por SQL Editor o service-role sin fijarla (el cliente la fija explícito).
-- Idempotente.
-- =====================================================================

alter table public.ingest_pendientes
  add column if not exists updated_at timestamptz not null default now();

update public.ingest_pendientes
  set updated_at = coalesce(resolved_at, created_at)
  where updated_at is null or updated_at = created_at;

create or replace function public.touch_ingest_pendientes_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ingest_pendientes_updated_at on public.ingest_pendientes;
create trigger trg_ingest_pendientes_updated_at
  before update on public.ingest_pendientes
  for each row execute function public.touch_ingest_pendientes_updated_at();
```

- [ ] **Step 2: Que el usuario revise el SQL**

Mostrar el SQL al usuario y esperar OK explícito. Regla CLAUDE.md: nunca aplicar sin revisión; hay datos reales de 2 usuarios.

**IMPORTANTE sobre el trigger:** al fijar `updated_at = now()` en cada UPDATE, el trigger pisa el `updated_at` que manda el cliente. Para LWW el comparador usa el `updated_at` del *payload* del cliente contra el de la fila del servidor **antes** de escribir (Task 5 lee la fila server primero y decide). El trigger solo garantiza monotonía en el servidor. Confirmar con el usuario que este comportamiento es aceptable; si se quiere respetar el `updated_at` del cliente tal cual, quitar el trigger y fijarla solo desde el cliente. **Decisión por defecto de este plan: SIN trigger** — el cliente es el único escritor de `estado` y fija `updated_at` explícito; el trigger añade una pisada que complica el LWW. Dejar en el SQL solo el `add column` + `update` de backfill. (Quitar el bloque de función/trigger antes de aplicar salvo que el usuario lo pida.)

- [ ] **Step 3: Aplicar con `apply_migration`**

Usar la tool `mcp__supabase__apply_migration` (queda registrada), NO el SQL Editor. Nombre: `ingest_updated_at`.

- [ ] **Step 4: Verificar la cadena completa (introspección, no ledger)**

Vía `mcp__supabase__execute_sql`:

```sql
-- (a) columna existe
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='ingest_pendientes' and column_name='updated_at';

-- (b) grant es de tabla, no por columna (si fuera por columna la nueva no queda concedida)
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public' and table_name='ingest_pendientes' and grantee='authenticated';
```

Esperado: (a) una fila `timestamptz`, `NO`. (b) `UPDATE`/`SELECT`/etc a nivel tabla.

- [ ] **Step 5: Verificar que PostgREST ve la columna**

```bash
curl -sS "$(supabase_url)/rest/v1/ingest_pendientes?select=updated_at&limit=1" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" | head -c 200
```
Esperado: JSON (o `[]`), NO `400 column ... does not exist`. Si 400, la caché de esquema está rancia — reintentar tras unos segundos.

- [ ] **Step 6: Añadir la columna al contract test**

En `supabase/tests/schema_contract_test.sql`, en la sección de columnas frágiles de `ingest_pendientes`, añadir la aserción de `updated_at`. Seguir el patrón exacto de las columnas ya listadas ahí (leer el archivo primero y copiar la forma de una aserción de columna existente).

- [ ] **Step 7: Correr el contract test**

Vía `mcp__supabase__execute_sql` (solo lectura), pegar el contenido de `supabase/tests/schema_contract_test.sql`.
Esperado: imprime `ALL TESTS PASSED`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260717_ingest_updated_at.sql supabase/tests/schema_contract_test.sql
git commit -m "feat(db): updated_at en ingest_pendientes para LWW offline"
```

---

## Task 2: Espejo IndexedDB de `ingest_pendientes`

**Files:**
- Modify: `js/nestra-db.js:9-10`

Para que la lista y el badge carguen offline hace falta un object store espejo.

- [ ] **Step 1: Añadir el store y subir la versión de IDB**

En `js/nestra-db.js`, línea 9-10:

```javascript
const NESTRA_IDB_NAME = 'nestra';
const NESTRA_IDB_VERSION = 6;
const MIRROR_STORES = ['transacciones', 'categorias', 'metas', 'prestamos', 'presupuestos', 'plantillas', 'recurrentes', 'ingest_pendientes'];
```

El `upgrade()` ya crea cualquier store de `MIRROR_STORES` que falte (línea 18-22), así que subir la versión a 6 dispara la creación de `ingest_pendientes` sin más cambios.

- [ ] **Step 2: Actualizar el comentario de cabecera**

En `js/nestra-db.js:4`, añadir `ingest_pendientes` a la lista de stores espejo documentada:

```javascript
// Stores espejo (keyPath 'id'): transacciones, categorias, metas, prestamos,
//   presupuestos, plantillas, recurrentes, ingest_pendientes.
```

- [ ] **Step 3: Verificar en preview que la DB migra sin romper**

Arrancar preview (`preview_start` name `nestra`), abrir la app logueado, en la consola:
```javascript
(await nestraDB()).objectStoreNames
```
Esperado: incluye `'ingest_pendientes'`. Sin errores de `VersionError`/upgrade en consola.

- [ ] **Step 4: Commit**

```bash
git add js/nestra-db.js
git commit -m "feat(offline): espejo IndexedDB de ingest_pendientes (IDB v6)"
```

---

## Task 3: Lista y badge offline (`_mirroredRead`)

**Files:**
- Modify: `js/db.js:1633-1657`

- [ ] **Step 1: Reescribir `getIngestPendientes` con `_mirroredRead`**

`_mirroredRead(store, fetcher)` (ya existe, usado por `getTransacciones`) lee del servidor cuando hay red y escribe el set completo al espejo; offline lee del espejo. Reemplazar `getIngestPendientes` (db.js:1633):

```javascript
async function getIngestPendientes() {
  const rows = await _mirroredRead('ingest_pendientes', async () => {
    const { data, error } = await supabase
      .from('ingest_pendientes')
      .select('id, banco, tipo, monto, comercio, fecha, contraparte, monto_original, moneda_original, tasa_cambio, estado, transaccion_id, raw_subject, created_at, updated_at')
      .in('estado', ['pendiente', 'revisar-manual', 'confirmado', 'descartado']);
    if (error) throw error;
    return data || [];
  });
  // El espejo guarda el set completo; filtramos y ordenamos en cliente para que
  // el badge/undo vean estados no-pendientes sin re-fetch, igual que getTransacciones.
  return rows
    .filter((p) => p.estado === 'pendiente' || p.estado === 'revisar-manual')
    .sort((a, b) => (a.created_at < b.created_at ? 1 : (a.created_at > b.created_at ? -1 : 0)));
}
```

Nota: se agregan `transaccion_id` y `updated_at` al select (los necesita el undo y el LWW), y se traen también `confirmado`/`descartado` para que un undo optimista pueda re-mostrar la fila desde el espejo sin red. El filtro a pendientes se hace en cliente.

- [ ] **Step 2: Reescribir `contarIngestPendientes` sobre el espejo**

Reemplazar `contarIngestPendientes` (db.js:1645) para contar desde `getIngestPendientes` (que ya cae al espejo offline):

```javascript
async function contarIngestPendientes() {
  try {
    const filas = await getIngestPendientes();
    return filas.length;
  } catch (err) {
    console.error('Error en contarIngestPendientes():', err.message || err);
    return 0;
  }
}
```

- [ ] **Step 3: Verificar en preview (online y offline)**

Sembrar 2 filas de prueba (ver Task 10 Step 1 para el INSERT). Cargar #revisar online → aparecen. En DevTools → Network → Offline, recargar la vista → siguen apareciendo (del espejo). Badge del nav muestra el conteo en ambos casos.

- [ ] **Step 4: Commit**

```bash
git add js/db.js
git commit -m "feat(offline): lista y badge de #revisar desde el espejo"
```

---

## Task 4: Confirmar/descartar/revertir offline-first

**Files:**
- Modify: `js/db.js:1664-1684`

- [ ] **Step 1: Helper interno para aplicar un cambio de estado (mirror + outbox/red)**

Añadir en `js/db.js` (cerca de las funciones de ingest, ~db.js:1685) un helper que centraliza el patrón offline-first:

```javascript
// _aplicarIngestEstado(id, patch) — aplica un cambio de estado a un pendiente,
// offline-first y con LWW. `patch` NO incluye updated_at: lo fija aquí.
// Online: UPDATE directo + espejo. Offline / net-error: espejo optimista + outbox.
async function _aplicarIngestEstado(id, patch) {
  const updated_at = new Date().toISOString();
  const full = { ...patch, updated_at };

  async function _mirrorMerge() {
    try {
      const db = await nestraDB();
      const row = await db.get('ingest_pendientes', id);
      if (row) await db.put('ingest_pendientes', { ...row, ...full });
    } catch (_) {}
  }
  async function _offline() {
    await _mirrorMerge();
    await outboxAdd('ingest_estado', { id, ...full });
    if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
  }

  if (!navigator.onLine) { await _offline(); return; }
  try {
    const { error } = await supabase.from('ingest_pendientes').update(full).eq('id', id);
    if (error) throw error;
    await _mirrorMerge();
  } catch (err) {
    if (_isNetworkError(err)) { await _offline(); return; }
    console.error('Error en _aplicarIngestEstado():', err.message || err);
    throw err;
  }
}
```

(`_isNetworkError`, `outboxAdd`, `nestraDB`, `mirrorPut` ya existen y se usan en db.js.)

- [ ] **Step 2: Reescribir `confirmarIngestPendiente` sobre el helper**

Reemplazar la función (db.js:1664):

```javascript
// confirmarIngestPendiente(id, transaccionId, datos) — marca confirmado y enlaza
// la tx. `datos` {tipo,monto,fecha} escribe de vuelta lo editado (audita lo
// confirmado y satisface propuesta_completa cuando venía de 'revisar-manual').
// transaccionId puede ser null (hogar-split offline: los ids reales los genera
// el RPC en el servidor; el enlace se omite y la nota queda de referencia).
async function confirmarIngestPendiente(id, transaccionId, datos = {}) {
  const patch = { estado: 'confirmado', transaccion_id: transaccionId || null, resolved_at: new Date().toISOString() };
  if (datos.tipo != null) patch.tipo = datos.tipo;
  if (datos.monto != null) patch.monto = datos.monto;
  if (datos.fecha != null) patch.fecha = datos.fecha;
  await _aplicarIngestEstado(id, patch);
}
```

- [ ] **Step 3: Reescribir `descartarIngestPendiente`**

```javascript
// descartarIngestPendiente(id) — descarta la propuesta (no crea transacción).
async function descartarIngestPendiente(id) {
  await _aplicarIngestEstado(id, { estado: 'descartado', resolved_at: new Date().toISOString() });
}
```

- [ ] **Step 4: Añadir `revertirIngestPendiente` (para undo)**

```javascript
// revertirIngestPendiente(id) — devuelve un pendiente a 'pendiente' (undo de
// confirmar/descartar). Limpia el enlace de tx y resolved_at.
async function revertirIngestPendiente(id) {
  await _aplicarIngestEstado(id, { estado: 'pendiente', transaccion_id: null, resolved_at: null });
}
```

- [ ] **Step 5: Exponer `revertirIngestPendiente` como global**

Buscar dónde se exponen las otras (`window.confirmarIngestPendiente = ...`) y añadir:
```javascript
window.revertirIngestPendiente = revertirIngestPendiente;
```
(Si el archivo expone por lote/objeto, seguir ese patrón. Grep `confirmarIngestPendiente =` para ubicar el sitio exacto.)

- [ ] **Step 6: Verificar en preview**

Consola, con una fila de prueba `id` conocido:
```javascript
await confirmarIngestPendiente('<id>', null, {tipo:'gasto', monto:10, fecha:'2026-07-17'});
// luego, en base o REST: estado='confirmado'. Espejo: (await nestraDB()).get('ingest_pendientes','<id>') → estado confirmado.
await revertirIngestPendiente('<id>'); // vuelve a 'pendiente'
```

- [ ] **Step 7: Commit**

```bash
git add js/db.js
git commit -m "feat(offline): confirmar/descartar/revertir ingest offline-first"
```

---

## Task 5: Replay del op `ingest_estado` con LWW

**Files:**
- Modify: `js/sync.js` (añadir un bloque antes del caso genérico, ~sync.js:103)

- [ ] **Step 1: Añadir el handler del op**

En `js/sync.js`, dentro de `_replayOp(op)`, ANTES del bloque genérico (línea 104, el `try { const server = await _serverRow(...)`), añadir:

```javascript
  if (op.entity === 'ingest_estado') {
    try {
      const { id, updated_at } = op.payload;
      // Guardia LWW: si el servidor tiene una escritura más nueva, gana el server.
      const { data: server, error: readErr } = await supabase
        .from('ingest_pendientes').select('*').eq('id', id).maybeSingle();
      if (readErr) throw readErr;
      if (server && Date.parse(server.updated_at || 0) > Date.parse(updated_at || 0)) {
        await mirrorPut('ingest_pendientes', server); // el server gana; re-espejar
        return 'done';
      }
      const patch = { ...op.payload };
      delete patch.id; // id va en el .eq, no en el SET
      const { data, error } = await supabase
        .from('ingest_pendientes').update(patch).eq('id', id).select().maybeSingle();
      if (error) throw error;
      if (data) await mirrorPut('ingest_pendientes', data);
      return 'done';
    } catch (err) {
      if (!navigator.onLine || /failed to fetch|networkerror|load failed/i.test((err && err.message) + '')) return 'retry';
      console.error('Sync ingest_estado falló:', err.message || err);
      await outboxSetStatus(op.op_id, 'error', (err && err.message) + '');
      return 'skip';
    }
  }
```

Nota de orden FIFO: cuando se confirma offline, la vista encola primero el op de la tx (`transacciones` o `gasto_hogar`) y DESPUÉS `ingest_estado`. El replay es FIFO, así que la tx existe antes de que `ingest_estado` fije `transaccion_id` (evita violar el FK `transaccion_id → transacciones(id)`). Para hogar-split `transaccion_id` va null (los ids reales los genera el RPC server-side), así que no hay FK que violar.

- [ ] **Step 2: Verificar el replay offline→online en preview**

DevTools Offline. En #revisar, descartar una fila (swipe/botón — o por consola `await descartarIngestPendiente('<id>')`). Verificar op en outbox:
```javascript
(await nestraDB()).getAll('outbox')  // hay un ingest_estado pendiente
```
Volver a Online → esperar el auto-sync (o `await syncOutbox()`). La outbox queda vacía; en base la fila está `descartado`.

- [ ] **Step 3: Commit**

```bash
git add js/sync.js
git commit -m "feat(offline): replay ingest_estado con guardia LWW"
```

---

## Task 6: Card compacta + chip de categoría + bottom-sheet

**Files:**
- Modify: `views/revisar.html`

El rediseño mantiene toda la lógica de datos/validación existente (`confirmar`, `descartar`, partes de hogar, gate de tipo por ámbito) y cambia la presentación: compacta por defecto, expandible, con chip.

- [ ] **Step 1: CSS de card compacta, chip y bottom-sheet**

Añadir al `<style>` de `views/revisar.html` (mantener las clases `rev-*` existentes que se sigan usando en el modo expandido):

```css
  .rev-card { padding: var(--space-md); position: relative; overflow: hidden; }
  .rev-compact { display: flex; flex-direction: column; gap: 6px; cursor: pointer; }
  .rev-compact-top { display: flex; align-items: center; gap: var(--space-sm); }
  .rev-compact-monto { margin-left: auto; font-weight: var(--font-weight-bold); }
  .rev-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px;
    border-radius: var(--radius-pill, 999px); border: 1px solid var(--border-light);
    background: var(--bg-subtle, transparent); font-size: var(--font-size-sm); cursor: pointer; }
  .rev-chip--sugerida { border-style: dashed; }
  .rev-expandido { display: none; margin-top: var(--space-md); }
  .rev-card.is-expanded .rev-expandido { display: block; }
  .rev-card.is-expanded .rev-compact-hint { display: none; }
  /* bottom-sheet de categorías */
  .rev-sheet-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.4);
    display: none; z-index: 50; }
  .rev-sheet-backdrop.is-open { display: block; }
  .rev-sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 51;
    background: var(--bg-surface, #fff); border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    max-height: 70vh; overflow-y: auto; padding: var(--space-md);
    transform: translateY(100%); transition: transform .2s ease; }
  .rev-sheet.is-open { transform: translateY(0); }
  .rev-sheet-op { display: block; width: 100%; text-align: left; padding: var(--space-sm) var(--space-md);
    border: none; background: none; font-size: var(--font-size-md); cursor: pointer; border-radius: var(--radius-md); }
  .rev-sheet-op:hover, .rev-sheet-op.is-sel { background: var(--bg-subtle, #f3f4f6); }
  /* pistas de swipe */
  .rev-swipe-hint { position: absolute; top: 0; bottom: 0; display: flex; align-items: center;
    padding: 0 var(--space-lg); font-weight: var(--font-weight-semibold); color: #fff; opacity: 0; }
  .rev-swipe-hint--confirm { left: 0; background: var(--color-success); }
  .rev-swipe-hint--descartar { right: 0; background: var(--color-danger); }
```

- [ ] **Step 2: Reescribir `cardHTML` en dos zonas (compacta + expandida)**

`cardHTML(p, i)` conserva el cálculo de `sugerida`/`cats`/`original` y el bloque de partes. Reestructurar el HTML devuelto así (la zona expandida reusa los mismos ids `revMonto{i}`/`revFecha{i}`/`revTipo{i}`/`revAmbito{i}`/`revCat{i}` que ya consume el resto del script — NO renombrar):

```javascript
  return '<li class="card rev-card" id="revCard' + i + '" data-idx="' + i + '">' +
    '<div class="rev-swipe-hint rev-swipe-hint--confirm">Confirmar</div>' +
    '<div class="rev-swipe-hint rev-swipe-hint--descartar">Descartar</div>' +
    '<div class="rev-swipe-surface">' +
      // ── zona compacta ──
      '<div class="rev-compact" data-rev-expandir="' + i + '">' +
        '<div class="rev-compact-top">' +
          '<span class="badge badge-neutral rev-banco">' + esc(BANCO_LABEL[p.banco] || p.banco) + '</span>' +
          (manual ? '<span class="badge badge-warning">Formato no reconocido</span>' : '') +
          '<span class="rev-compact-monto">' + (p.monto != null ? fmt(p.monto) : '—') + '</span>' +
        '</div>' +
        (texto ? '<p class="rev-comercio">' + esc(texto) + '</p>' : '') +
        '<div class="rev-compact-top">' +
          '<button type="button" class="rev-chip' + (sugerida ? ' rev-chip--sugerida' : '') +
            '" data-rev-chip="' + i + '" id="revChip' + i + '">' +
            esc(nombreCat(cats, sugerida) || 'Sin categoría') +
          '</button>' +
          '<span class="rev-fecha-correo">' + esc((p.created_at || '').slice(0, 10)) + '</span>' +
        '</div>' +
      '</div>' +
      // ── zona expandida (todo lo de hoy) ──
      '<div class="rev-expandido">' +
        original +
        (manual && p.raw_subject ? '<p class="rev-raw">Asunto: ' + esc(p.raw_subject) + '</p>' : '') +
        '<div class="rev-grid">' +
          '<div class="rev-field"><label for="revMonto' + i + '">Monto</label>' +
            '<input type="number" step="0.01" min="0.01" id="revMonto' + i + '" value="' + (p.monto != null ? esc(p.monto) : '') + '"></div>' +
          '<div class="rev-field"><label for="revFecha' + i + '">Fecha</label>' +
            '<input type="date" id="revFecha' + i + '" value="' + esc(p.fecha || '') + '"></div>' +
          '<div class="rev-field"><label for="revTipo' + i + '">Tipo</label>' +
            '<select id="revTipo' + i + '">' +
              '<option value="gasto"' + (tipo === 'gasto' ? ' selected' : '') + '>Gasto</option>' +
              '<option value="ingreso"' + (tipo === 'ingreso' ? ' selected' : '') + '>Ingreso</option>' +
              '<option value="ahorro"' + (tipo === 'ahorro' ? ' selected' : '') + '>Ahorro</option>' +
            '</select></div>' +
          '<div class="rev-field"><label for="revAmbito' + i + '">Ámbito</label>' +
            '<select id="revAmbito' + i + '">' +
              '<option value="personal" selected>Personal</option>' +
              (hayHogar ? '<option value="hogar">Hogar</option>' : '') +
            '</select></div>' +
          '<div class="rev-field rev-field-full" id="revCatWrap' + i + '"><label for="revCat' + i + '">Categoría</label>' +
            '<select id="revCat' + i + '">' + opcionesCategoria(cats, sugerida) + '</select></div>' +
        '</div>' +
        (hayHogar ? (
        '<div id="revPartesGroup' + i + '" class="rev-partes" style="display:none">' +
          '<p class="rev-original" style="margin:0 0 6px">¿Quién puso cuánto?</p>' +
          '<div id="revPartesFilas' + i + '"></div>' +
          '<p id="revPartesRestante' + i + '" class="rev-partes-restante"></p>' +
          '<p class="rev-error" id="revPartesErr' + i + '"></p>' +
        '</div>') : '') +
      '</div>' +
      '<div class="rev-acciones">' +
        '<button type="button" class="btn btn-secondary" data-rev-descartar="' + i + '">Descartar</button>' +
        '<button type="button" class="btn btn-primary" data-rev-confirmar="' + i + '">Confirmar</button>' +
      '</div>' +
      '<p class="rev-error" id="revErr' + i + '"></p>' +
    '</div>' +
  '</li>';
```

- [ ] **Step 3: Añadir helper `nombreCat`**

Junto a `opcionesCategoria` en el script:

```javascript
  function nombreCat(cats, id) {
    if (!id) return null;
    var c = (cats || []).find(function (x) { return x.id === id; });
    return c ? c.nombre : null;
  }
```

- [ ] **Step 4: Sincronizar el `<select>` oculto ↔ chip**

El chip refleja `revCat{i}`. Cuando el bottom-sheet elige una categoría, actualizar AMBOS. Añadir al script el markup del sheet (una vez, al final del `<div class="rev">`), y las funciones:

```html
  <div class="rev-sheet-backdrop" id="revSheetBackdrop"></div>
  <div class="rev-sheet" id="revSheet" role="dialog" aria-label="Elegir categoría"></div>
```

```javascript
  var _sheetIdx = null;
  function abrirSheet(i) {
    _sheetIdx = i;
    var sel = document.getElementById('revCat' + i);
    var actual = sel ? sel.value : '';
    var opts = Array.prototype.map.call(sel.options, function (o) {
      return '<button type="button" class="rev-sheet-op' + (o.value === actual ? ' is-sel' : '') +
        '" data-val="' + esc(o.value) + '">' + esc(o.textContent) + '</button>';
    }).join('');
    document.getElementById('revSheet').innerHTML = opts;
    document.getElementById('revSheetBackdrop').classList.add('is-open');
    document.getElementById('revSheet').classList.add('is-open');
  }
  function cerrarSheet() {
    document.getElementById('revSheetBackdrop').classList.remove('is-open');
    document.getElementById('revSheet').classList.remove('is-open');
    _sheetIdx = null;
  }
  function elegirCategoria(val) {
    if (_sheetIdx == null) return;
    var i = _sheetIdx;
    var sel = document.getElementById('revCat' + i);
    if (sel) sel.value = val;
    var chip = document.getElementById('revChip' + i);
    if (chip) {
      chip.textContent = nombreCat(_cats[document.getElementById('revTipo' + i).value] || _cats.gasto, val) || 'Sin categoría';
      chip.classList.remove('rev-chip--sugerida');
    }
    cerrarSheet();
  }
```

Enlazar en el listener de `click` de `listaEl` y en el sheet:
```javascript
      var chipBtn = ev.target.closest('[data-rev-chip]');
      if (chipBtn) { ev.stopPropagation(); abrirSheet(Number(chipBtn.getAttribute('data-rev-chip'))); return; }
      var expandir = ev.target.closest('[data-rev-expandir]');
      if (expandir) { var card = expandir.closest('.rev-card'); card.classList.toggle('is-expanded'); return; }
```
```javascript
  document.getElementById('revSheet').addEventListener('click', function (ev) {
    var op = ev.target.closest('[data-val]');
    if (op) elegirCategoria(op.getAttribute('data-val'));
  });
  document.getElementById('revSheetBackdrop').addEventListener('click', cerrarSheet);
```

Nota: cuando `onTipoChange(i)` regenera `revCat{i}` (cambia el tipo), debe también refrescar el texto del chip. Añadir al final de `onTipoChange`: `var chip=document.getElementById('revChip'+i); if(chip){var s=document.getElementById('revCat'+i); chip.textContent=nombreCat(await catsPara(tipo), s.value)||'Sin categoría';}`

- [ ] **Step 5: Verificar en preview**

Cargar #revisar. Card se ve compacta. Tocar la card (fuera del chip) → expande. Tocar el chip → abre bottom-sheet, elegir otra categoría → chip cambia y el `<select>` oculto también (`document.getElementById('revCat0').value`). Confirmar usa la categoría elegida.

- [ ] **Step 6: Commit**

```bash
git add views/revisar.html
git commit -m "feat(revisar): card compacta + chip de categoría con bottom-sheet"
```

---

## Task 7: Swipe + gate de completitud

**Files:**
- Modify: `views/revisar.html`

- [ ] **Step 1: Función `pendienteCompleto(i)` (gate)**

Determina si la card `i` puede confirmarse de un swipe. Añadir al script:

```javascript
  function pendienteCompleto(i) {
    var monto = parseFloat(document.getElementById('revMonto' + i).value);
    var fecha = document.getElementById('revFecha' + i).value;
    var tipo = document.getElementById('revTipo' + i).value;
    var catId = document.getElementById('revCat' + i).value;
    if (!(monto > 0) || !fecha || !tipo) return false;
    if (tipo !== 'ahorro' && !catId) return false;
    // hogar-gasto con bloque de partes visible → exige partes válidas
    var grupo = document.getElementById('revPartesGroup' + i);
    if (grupo && grupo.style.display !== 'none') {
      var partes = leerPartes(i).filter(function (x) { return x.monto > 0; });
      if (!validarPartesGastoHogar(monto, partes).ok) return false;
    }
    return true;
  }
```

- [ ] **Step 2: Handlers de swipe (pointer events)**

Añadir gestión de swipe por card usando Pointer Events (funciona en touch y mouse). En `init()`, tras render, enlazar sobre `listaEl` con delegación por `pointerdown` en `.rev-swipe-surface`:

```javascript
  var _sw = null; // { i, startX, dx, surface, card }
  function swipeStart(ev) {
    if (ev.target.closest('input, select, textarea, button, .rev-expandido')) return; // no swipe sobre controles
    var card = ev.target.closest('.rev-card');
    if (!card) return;
    var surface = card.querySelector('.rev-swipe-surface');
    _sw = { i: Number(card.getAttribute('data-idx')), startX: ev.clientX, dx: 0, surface: surface, card: card };
    surface.setPointerCapture && surface.setPointerCapture(ev.pointerId);
  }
  function swipeMove(ev) {
    if (!_sw) return;
    _sw.dx = ev.clientX - _sw.startX;
    _sw.surface.style.transform = 'translateX(' + _sw.dx + 'px)';
    var card = _sw.card;
    var w = card.offsetWidth || 320;
    var conf = card.querySelector('.rev-swipe-hint--confirm');
    var desc = card.querySelector('.rev-swipe-hint--descartar');
    if (conf) conf.style.opacity = _sw.dx > 0 ? Math.min(1, _sw.dx / (w * 0.4)) : 0;
    if (desc) desc.style.opacity = _sw.dx < 0 ? Math.min(1, -_sw.dx / (w * 0.4)) : 0;
  }
  function swipeEnd() {
    if (!_sw) return;
    var s = _sw; _sw = null;
    var w = s.card.offsetWidth || 320;
    var umbral = w * 0.4;
    s.surface.style.transform = '';
    s.card.querySelectorAll('.rev-swipe-hint').forEach(function (h) { h.style.opacity = 0; });
    if (s.dx > umbral) {
      // swipe derecha → confirmar (o expandir si incompleto)
      if (pendienteCompleto(s.i)) { confirmar(s.i, s.card.querySelector('[data-rev-confirmar]')); }
      else { s.card.classList.add('is-expanded'); enfocarFaltante(s.i); }
    } else if (s.dx < -umbral) {
      descartar(s.i, s.card.querySelector('[data-rev-descartar]'));
    }
  }
  function enfocarFaltante(i) {
    var monto = document.getElementById('revMonto' + i);
    if (!(parseFloat(monto.value) > 0)) { monto.focus(); return; }
    var fecha = document.getElementById('revFecha' + i);
    if (!fecha.value) { fecha.focus(); return; }
    var cat = document.getElementById('revCat' + i);
    if (document.getElementById('revTipo' + i).value !== 'ahorro' && !cat.value) { cat.focus(); return; }
    var grupo = document.getElementById('revPartesGroup' + i);
    if (grupo && grupo.style.display !== 'none') { var f = grupo.querySelector('.rev-partes-monto'); if (f) f.focus(); }
  }
```

Enlazar:
```javascript
  listaEl.addEventListener('pointerdown', swipeStart);
  listaEl.addEventListener('pointermove', swipeMove);
  listaEl.addEventListener('pointerup', swipeEnd);
  listaEl.addEventListener('pointercancel', function () { if (_sw) { _sw.surface.style.transform=''; _sw=null; } });
```

Añadir CSS: `.rev-swipe-surface { transition: transform .15s ease; touch-action: pan-y; background: var(--bg-surface, #fff); position: relative; z-index: 1; }`

- [ ] **Step 3: Verificar en preview (desktop drag + responsive touch)**

`resize_window` mobile. Arrastrar una card completa a la derecha → confirma. Arrastrar una incompleta (p.ej. revisar-manual) a la derecha → expande y enfoca monto, NO confirma. Arrastrar a la izquierda → descarta. Umbral: soltar antes del 40% → snap-back sin acción. Botones siguen funcionando.

- [ ] **Step 4: Commit**

```bash
git add views/revisar.html
git commit -m "feat(revisar): swipe confirmar/descartar con gate de completitud"
```

---

## Task 8: Undo de confirmar y descartar

**Files:**
- Modify: `views/revisar.html`

Undo requiere: (a) toast con botón Deshacer, (b) reversión correcta. Confirmar-undo debe borrar la(s) tx creada(s). Para hogar-split hay que capturar TODAS las filas del grupo al confirmar.

- [ ] **Step 1: Capturar info de reversión al confirmar**

En `confirmar(i, btn)` (la función existente), tras crear la tx, guardar lo necesario para el undo. Modificar los dos caminos:

- Camino hogar-split (`registrarGastoHogar`): `var filas = await registrarGastoHogar(...)`. Guardar `var txIds = (filas||[]).filter(Boolean).map(function(f){return f.id;});` y pasar `transaccion_id` null al confirmar (los ids optimistas no sirven server-side). 
- Camino normal (`insertTransaccion`): `txIds = [tx.id]`.

Tras `await confirmarIngestPendiente(p.id, (txIds.length===1?txIds[0]:null), {tipo,monto,fecha})`, en vez de `quitarCard(i)` llamar:
```javascript
  quitarCardConUndo(i, { accion: 'confirmar', pendienteId: p.id, txIds: txIds });
```

- [ ] **Step 2: `descartar` con undo**

En `descartar(i, btn)`, tras `await descartarIngestPendiente(_filas[i].id)`, reemplazar `quitarCard(i)` por:
```javascript
  quitarCardConUndo(i, { accion: 'descartar', pendienteId: _filas[i].id });
```

- [ ] **Step 3: `quitarCardConUndo` + toast**

```javascript
  var _undoTimer = null;
  function quitarCardConUndo(i, ctx) {
    var card = document.getElementById('revCard' + i);
    if (card) card.style.display = 'none'; // ocultar, no remover (por si hay undo)
    if (typeof actualizarIngestBadge === 'function') actualizarIngestBadge();
    mostrarToastUndo(i, ctx);
  }
  function mostrarToastUndo(i, ctx) {
    if (_undoTimer) { clearTimeout(_undoTimer); finalizarUndo(); } // cierra el anterior en firme
    var t = document.getElementById('revUndoToast');
    t.querySelector('.rev-undo-msg').textContent = ctx.accion === 'confirmar' ? 'Confirmado' : 'Descartado';
    t.setAttribute('data-idx', i);
    t._ctx = ctx;
    t.classList.add('is-open');
    _undoTimer = setTimeout(finalizarUndo, 5000);
  }
  function finalizarUndo() {
    var t = document.getElementById('revUndoToast');
    var ctx = t._ctx; t._ctx = null;
    t.classList.remove('is-open');
    _undoTimer = null;
    if (!ctx) return;
    // aplicar en firme: quitar la card oculta de verdad
    var i = Number(t.getAttribute('data-idx'));
    var card = document.getElementById('revCard' + i);
    if (card) card.remove();
    _filas[i] = null;
    if (!_filas.some(Boolean)) renderVacio();
  }
  async function deshacer() {
    if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }
    var t = document.getElementById('revUndoToast');
    var ctx = t._ctx; t._ctx = null;
    t.classList.remove('is-open');
    if (!ctx) return;
    try {
      if (ctx.accion === 'confirmar') {
        for (var k = 0; k < (ctx.txIds || []).length; k++) {
          if (ctx.txIds[k]) await deleteTransaccion(ctx.txIds[k]);
        }
      }
      await revertirIngestPendiente(ctx.pendienteId);
      var i = Number(t.getAttribute('data-idx'));
      var card = document.getElementById('revCard' + i);
      if (card) card.style.display = ''; // re-mostrar en su sitio
      if (typeof actualizarIngestBadge === 'function') actualizarIngestBadge();
    } catch (e) {
      console.error('deshacer falló:', e);
      errGlobal.textContent = 'No se pudo deshacer. Revisa #historial.';
      errGlobal.style.display = 'block';
    }
  }
```

- [ ] **Step 4: Markup + CSS del toast**

Al final del `<div class="rev">`:
```html
  <div class="rev-undo-toast" id="revUndoToast" role="status">
    <span class="rev-undo-msg"></span>
    <button type="button" class="rev-undo-btn" id="revUndoBtn">Deshacer</button>
  </div>
```
```css
  .rev-undo-toast { position: fixed; left: 50%; bottom: calc(var(--space-lg) + env(safe-area-inset-bottom, 0));
    transform: translateX(-50%) translateY(200%); z-index: 60;
    background: var(--text-primary, #111); color: var(--bg-surface, #fff);
    padding: var(--space-sm) var(--space-md); border-radius: var(--radius-pill, 999px);
    display: flex; align-items: center; gap: var(--space-md); transition: transform .2s ease; box-shadow: var(--shadow-lg); }
  .rev-undo-toast.is-open { transform: translateX(-50%) translateY(0); }
  .rev-undo-btn { background: none; border: none; color: var(--color-primary-300, #7dd3fc);
    font-weight: var(--font-weight-bold); cursor: pointer; }
```
Enlazar: `document.getElementById('revUndoBtn').addEventListener('click', deshacer);`

- [ ] **Step 5: Ajustar `quitarCard` viejo**

`quitarCard(i)` original (usado por errores) se conserva para casos sin undo, pero las rutas de confirmar/descartar ahora usan `quitarCardConUndo`. Verificar que no queden llamadas dobles.

- [ ] **Step 6: Verificar en preview**

1. Descartar → toast "Descartado · Deshacer" → Deshacer → card vuelve, en base `pendiente`. 
2. Confirmar (personal) → Deshacer → tx borrada de #historial, pendiente vuelve. 
3. Confirmar (hogar-split, 2 pagadores, usar hogar de PRUEBAS) → Deshacer → todas las filas del grupo borradas. 
4. No deshacer en 5s → card desaparece en firme, tx/estado quedan.

- [ ] **Step 7: Commit**

```bash
git add views/revisar.html
git commit -m "feat(revisar): undo de confirmar y descartar (incl. hogar-split)"
```

---

## Task 9: Bump de SHELL_VERSION

**Files:**
- Modify: `sw.js:15`

- [ ] **Step 1: Subir la versión del shell**

En `sw.js:15`: `const SHELL_VERSION = 'v32';`

- [ ] **Step 2: Commit**

```bash
git add sw.js
git commit -m "chore: bump SHELL_VERSION a v32"
```

---

## Task 10: Verificación end-to-end en preview

**Files:** ninguno (verificación).

- [ ] **Step 1: Sembrar filas de prueba (cuenta throwaway)**

Vía `mcp__supabase__execute_sql` con el `user_id` de la cuenta throwaway (NO el hogar real). Un caso simple, uno de divisa fallida, uno revisar-manual:

```sql
insert into public.ingest_pendientes (user_id, message_id, banco, tipo, monto, comercio, fecha, estado, updated_at)
values
 ('<throwaway_uid>', 'test-simple-1', 'bcp', 'gasto', 42.50, 'Rappi', current_date, 'pendiente', now()),
 ('<throwaway_uid>', 'test-usd-1', 'bbva', 'gasto', 100, 'Amazon', current_date, 'pendiente', now()),
 ('<throwaway_uid>', 'test-manual-1', 'bbva', null, null, null, null, 'revisar-manual', now());
update public.ingest_pendientes set monto_original=27, moneda_original='USD', tasa_cambio=null
 where message_id='test-usd-1' and user_id='<throwaway_uid>';
update public.ingest_pendientes set raw_subject='Consumo no reconocido' where message_id='test-manual-1' and user_id='<throwaway_uid>';
```

- [ ] **Step 2: Recorrer la matriz de verificación**

Preview `nestra` :5050, logueado como la cuenta throwaway. Ejecutar y capturar screenshot de cada uno:
1. Swipe-confirmar "Rappi" (simple) → tx en #historial, pendiente `confirmado`.
2. Swipe-derecha en "Amazon" (divisa fallida) → expande y enfoca monto, no confirma.
3. Swipe-derecha en "test-manual" → expande, no confirma.
4. Chip → bottom-sheet → cambiar categoría de "Rappi" antes de confirmar → confirma con la elegida; en consola `await autocatLearned()` refleja el aprendizaje del token.
5. Descartar "Amazon" + Deshacer → vuelve a `pendiente`.
6. Confirmar "Rappi" + Deshacer → tx borrada, pendiente vuelve.
7. (hogar de PRUEBAS) confirmar un gasto repartido + Deshacer → filas del grupo borradas.
8. Offline (DevTools): recargar #revisar → lista+badge del espejo; descartar uno → op en outbox; Online → `syncOutbox()` vacía la outbox; base `descartado`.
9. Render: sembrar comercio `<img src=x onerror=alert(1)>` → se muestra como texto escapado, no ejecuta (revisar consola: sin alert).

- [ ] **Step 3: Limpiar filas de prueba**

```sql
delete from public.ingest_pendientes where message_id like 'test-%' and user_id='<throwaway_uid>';
```
(Y borrar las tx de prueba que hayan quedado confirmadas, desde #historial o por SQL con la nota correspondiente.)

- [ ] **Step 4: Correr `verification-before-completion`**

Antes de declarar listo, invocar la skill `superpowers:verification-before-completion` y adjuntar evidencia real (screenshots + salidas de consulta), no aserciones.

- [ ] **Step 5: Abrir PR a `main`**

`main` está protegida (push directo rechazado). `gh pr create` desde `feat/revisar-swipe-offline-undo`. Tras merge, verificar el deploy live con cache-buster:
```bash
curl -sL "https://nestra-8rl.pages.dev/sw.js?cb=$RANDOM" | grep SHELL_VERSION
```
Esperado: `v32`.

---

## Self-Review (contra el spec)

- **UX card compacta / chip / bottom-sheet** → Task 6. ✓
- **Swipe + gate de incompletos (manual/divisa/hogar)** → Task 7. ✓
- **Undo ambos, incl. hogar-split** → Task 8. ✓
- **Offline: espejo lista+badge** → Tasks 2, 3. ✓
- **Offline: outbox `ingest_estado` + LWW** → Tasks 4, 5. ✓
- **Migración `updated_at` + contract test + verificación de cadena** → Task 1. ✓
- **Seguridad de render (esc)** → preservada en Task 6 (todo por `esc()`), verificada en Task 10 Step 2.9. ✓
- **SHELL_VERSION bump + NetworkFirst + PR a main + cache-buster** → Tasks 9, 10. ✓
- **Verificación con evidencia** → Task 10. ✓

Consistencia de nombres: `_aplicarIngestEstado`, `revertirIngestPendiente`, `ingest_estado` (op), `pendienteCompleto`, `quitarCardConUndo`, `nombreCat`, `abrirSheet`/`elegirCategoria` — usados igual en todas las tareas. Ids de la vista (`revMonto{i}` etc.) reusados sin renombrar. ✓
