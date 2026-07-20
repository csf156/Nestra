# Reparto de ahorro registrado offline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un ahorro registrado sin conexión, tras reconectar y sincronizar, dispare `distribuir_ahorro` (reparto entre metas + fondo), con idempotencia para no duplicar aportes si el sync reintenta.

**Architecture:** Cambio de solo cliente (sin migración de base). Un predicado puro nuevo (`js/reparto-sync.js`, dual-export, unit-testeado) + refactor de `_distribuirAhorroTx` en `js/db.js` (idempotente, con estado de retorno) + enganche en el camino genérico de `js/sync.js`. Registro del script en `index.html` y `sw.js` + bump de `SHELL_VERSION`.

**Tech Stack:** JS vanilla sin build, `node:test` para la lógica pura, Service Worker con Workbox.

**Spec:** `docs/superpowers/specs/2026-07-19-reparto-ahorro-offline-design.md`

---

## Contexto que el ejecutor necesita

- **Tests**: el repo SÍ tiene tests (`test/*.test.mjs`, `node:test`), se corren por archivo: `node --test test/<archivo>.test.mjs` (la forma glob rompe por el path del worktree con puntos).
- **Módulos dual-export**: `js/sync-lww.js` es el patrón a copiar — expone `window.X` para los scripts clásicos Y `export { X }` para node:test. `js/db.js` y `js/sync.js` son scripts **clásicos** (funciones top-level = globales); `js/sync.js` ya llama a `window.lwwWinner` (definido por el módulo `sync-lww.js`), así que el patrón "clásico llama a lo que expone un módulo" ya está en uso.
- **El reparto** lo hace el RPC `distribuir_ahorro` (no se toca). `_distribuirAhorroTx(tx)` en `js/db.js:192` es el wrapper cliente actual (best-effort, sin retorno).
- **`_isNetworkError(err)`** ya existe en `js/db.js:73` para clasificar errores de red.
- **Verificación en navegador** exige sesión (redirige a `#login`). NO ingresar credenciales. Lo que no se pueda verificar con sesión, verificarlo por el unit test + lectura, y dejar el test de integración manual documentado para el usuario.

---

## Task 1: Predicado puro `esAhorroRepartible` (TDD)

**Files:**
- Create: `js/reparto-sync.js`
- Create: `test/reparto-sync.test.mjs`

- [ ] **Step 1: Escribir el test primero**

Crea `test/reparto-sync.test.mjs`:
```js
import assert from 'node:assert';
import { test } from 'node:test';
import { esAhorroRepartible } from '../js/reparto-sync.js';

test('un ahorro normal es repartible', () => {
  assert.strictEqual(esAhorroRepartible({ tipo: 'ahorro' }), true);
  assert.strictEqual(esAhorroRepartible({ tipo: 'ahorro', es_aporte_directo: false }), true);
});
test('un aporte directo NO se reparte (ya se asignó a mano)', () => {
  assert.strictEqual(esAhorroRepartible({ tipo: 'ahorro', es_aporte_directo: true }), false);
});
test('gasto e ingreso no se reparten', () => {
  assert.strictEqual(esAhorroRepartible({ tipo: 'gasto' }), false);
  assert.strictEqual(esAhorroRepartible({ tipo: 'ingreso' }), false);
});
test('null / undefined / sin tipo no rompe', () => {
  assert.strictEqual(esAhorroRepartible(null), false);
  assert.strictEqual(esAhorroRepartible(undefined), false);
  assert.strictEqual(esAhorroRepartible({}), false);
});
```

- [ ] **Step 2: Correr el test — debe FALLAR**

```
node --test test/reparto-sync.test.mjs
```
Esperado: falla al importar (`js/reparto-sync.js` no existe todavía).

- [ ] **Step 3: Crear el módulo**

Crea `js/reparto-sync.js`:
```js
// reparto-sync.js — regla pura: ¿esta transacción debe pasar por
// distribuir_ahorro? Dual-export como sync-lww.js (window para los scripts
// clásicos db.js/sync.js; ESM para node:test). Un aporte directo NO se reparte:
// aporte_directo_meta ya asignó su monto y marcó es_aporte_directo.
function esAhorroRepartible(tx) {
  return !!tx && tx.tipo === 'ahorro' && !tx.es_aporte_directo;
}

if (typeof window !== 'undefined') { window.esAhorroRepartible = esAhorroRepartible; }
export { esAhorroRepartible };
```

- [ ] **Step 4: Correr el test — debe PASAR**

```
node --test test/reparto-sync.test.mjs
```
Esperado: 4 tests PASS.

- [ ] **Step 5: Commit**
```bash
git add js/reparto-sync.js test/reparto-sync.test.mjs
git commit -m "feat(reparto): predicado puro esAhorroRepartible + test

Regla de '¿esta tx pasa por distribuir_ahorro?' extraída a un módulo
dual-export (como sync-lww.js) para poder unit-testearla y reusarla desde
db.js (online) y sync.js (offline→online). Aporte directo excluido: ya se
asignó a mano.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `_distribuirAhorroTx` idempotente y con estado de retorno

**Files:**
- Modify: `js/db.js` (función `_distribuirAhorroTx`, ~líneas 189-201; y el llamador online ~línea 168)

- [ ] **Step 1: Reemplazar `_distribuirAhorroTx`**

La función actual (`js/db.js:189-201`) es:
```js
// _distribuirAhorroTx(tx) — si la transacción es de tipo 'ahorro', invoca el
// RPC distribuir_ahorro (reparte entre metas del ámbito + fondo). Los aportes
// directos ya asignan su monto a mano; nunca se reparten. Best-effort (no lanza).
async function _distribuirAhorroTx(tx) {
  try {
    if (!tx || tx.tipo !== 'ahorro') return;
    if (tx.es_aporte_directo) return;
    const { error } = await supabase.rpc('distribuir_ahorro', { p_transaccion_id: tx.id });
    if (error) throw error;
  } catch (err) {
    console.error('Aviso: no se pudo repartir el ahorro entre metas:', err.message || err);
  }
}
```
Reemplázala por:
```js
// _distribuirAhorroTx(tx) — reparte un ahorro entre metas + fondo vía el RPC
// distribuir_ahorro. Usado por el camino online (insertTransaccion) y por el
// sync (ahorro creado offline, que se reparte al reconectar).
// Idempotente: si la tx ya tiene aportes, no reparte de nuevo — el sync puede
// reintentar un op cuyo upsert ya disparó el reparto, y un segundo RPC
// duplicaría los aportes.
// Devuelve 'done' | 'retry' | 'skip':
//   'done'  → repartido, ya estaba repartido, o no aplica (no es ahorro / aporte directo)
//   'retry' → error de red (RPC o conteo); el llamador de sync reintenta luego
//   'skip'  → error real; se loguea y no se reintenta (la tx igual quedó guardada)
async function _distribuirAhorroTx(tx) {
  try {
    if (typeof esAhorroRepartible === 'function' ? !esAhorroRepartible(tx)
        : !(tx && tx.tipo === 'ahorro' && !tx.es_aporte_directo)) {
      return 'done';
    }
    const { count, error: eCount } = await supabase
      .from('aportes_meta')
      .select('id', { count: 'exact', head: true })
      .eq('transaccion_id', tx.id);
    if (eCount) throw eCount;
    if (count > 0) return 'done';   // ya repartido: no duplicar

    const { error } = await supabase.rpc('distribuir_ahorro', { p_transaccion_id: tx.id });
    if (error) throw error;
    return 'done';
  } catch (err) {
    if (_isNetworkError(err) || !navigator.onLine) return 'retry';
    console.error('Aviso: no se pudo repartir el ahorro entre metas:', err.message || err);
    return 'skip';
  }
}
```
(El `typeof esAhorroRepartible === 'function' ? ... : ...` es una guarda por si el módulo aún no cargó; el fallback inline es la misma regla.)

- [ ] **Step 2: Simplificar el llamador online**

En `js/db.js:168`, la línea:
```js
    if (data.tipo === 'ahorro') await _distribuirAhorroTx(data);
```
cámbiala a:
```js
    await _distribuirAhorroTx(data);   // no-op salvo que sea un ahorro repartible
```
(La función ya filtra internamente; el camino online sigue siendo best-effort — ignora el retorno.)

- [ ] **Step 3: Verificar que no rompiste db.js**

```
node -e "require('fs').readFileSync('js/db.js','utf8'); console.log('lectura ok')"
```
No hay unit test de `_distribuirAhorroTx` (pega a supabase). Confirma por lectura que: la firma devuelve string en todos los caminos, el conteo usa `head:true` (no baja filas), y `_isNetworkError` existe (js/db.js:73).

- [ ] **Step 4: Commit**
```bash
git add js/db.js
git commit -m "refactor(reparto): _distribuirAhorroTx idempotente y con estado de retorno

Añade guarda de idempotencia (si la tx ya tiene aportes, no reparte de
nuevo) y devuelve 'done'|'retry'|'skip' para que el sync sepa si reintentar.
Usa esAhorroRepartible (con fallback inline por si el módulo no cargó). El
camino online sigue best-effort (ignora el retorno).

Prepara el enganche del reparto en el sync (ahorro creado offline).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Enganchar el reparto en el sync

**Files:**
- Modify: `js/sync.js` (camino genérico, ~líneas 130-148)

- [ ] **Step 1: Añadir el reparto tras el upsert de transacciones**

El camino genérico actual (`js/sync.js:130-148`) es:
```js
  try {
    const server = await _serverRow(entity, payload.id);
    const winner = window.lwwWinner(payload, server);
    if (winner === 'server') {
      if (server) await mirrorPut(entity, server);
      return 'done';
    }
    const { data, error } = await supabase.from(entity).upsert(payload, { onConflict: 'id' }).select().single();
    if (error) throw error;
    await mirrorPut(entity, data);
    return 'done';
  } catch (err) {
```
Cambia SOLO el tramo entre `await mirrorPut(entity, data);` y `return 'done';`:
```js
    const { data, error } = await supabase.from(entity).upsert(payload, { onConflict: 'id' }).select().single();
    if (error) throw error;
    await mirrorPut(entity, data);
    // Ahorro creado offline: al sincronizar, dispara el reparto entre metas +
    // fondo (idempotente; _distribuirAhorroTx salta si ya tiene aportes). Un
    // 'retry' deja la op pendiente para el próximo disparo; un 'skip' no
    // bloquea la tx (ya quedó guardada).
    if (entity === 'transacciones') {
      const rep = await _distribuirAhorroTx(data);
      if (rep === 'retry') return 'retry';
    }
    return 'done';
  } catch (err) {
```

- [ ] **Step 2: Verificar por lectura**

Confirma: el bloque nuevo solo corre para `entity === 'transacciones'`; `_distribuirAhorroTx` es global (definida en db.js, script clásico); un `'retry'` corta el lote en `syncOutbox` (js/sync.js:164) y reintenta; el camino `winner === 'server'` (arriba) NO reparte a propósito (si el server ya tiene la tx, su reparto ya corrió o correrá por su propio insert online — y la guarda de idempotencia lo cubriría igual).

- [ ] **Step 3: Commit**
```bash
git add js/sync.js
git commit -m "fix(sync): el ahorro creado offline se reparte al reconectar

El camino genérico del sync subía la tx con upsert pero no llamaba a
distribuir_ahorro, así que un ahorro registrado offline se sincronizaba sin
repartir. Ahora, tras el upsert de una transacción, dispara el reparto
(idempotente). Un error de red deja la op pendiente para reintentar.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Registrar el script nuevo (index.html + sw.js)

**Files:**
- Modify: `index.html` (~línea 184)
- Modify: `sw.js` (precache list + `SHELL_VERSION`)

- [ ] **Step 1: Añadir el script a index.html**

En `index.html`, tras la línea `<script type="module" src="js/sync-lww.js"></script>` (línea ~184), añade:
```html
    <script type="module" src="js/reparto-sync.js"></script>
```
Va como `type="module"` (dual-export, igual que sync-lww.js). Se carga antes de que db.js/sync.js lo usen en runtime.

- [ ] **Step 2: Añadir al precache del SW**

En `sw.js`, junto a `{ url: 'js/sync-lww.js', revision: SHELL_VERSION },` (línea ~50), añade:
```js
  { url: 'js/reparto-sync.js', revision: SHELL_VERSION },
```

- [ ] **Step 3: Bump de SHELL_VERSION**

En `sw.js` línea ~15, `const SHELL_VERSION = 'v36';` → `'v37'`. Verifica antes que siga en `v36`; si otro trabajo ya lo subió, usa el siguiente número real.

- [ ] **Step 4: Verificar en navegador que la app carga sin romper**

`preview_start` con `{ name: "nestra" }`. Navega a `http://localhost:5050/` y confirma en `read_console_messages` que no hay errores de carga (por ejemplo, que `js/reparto-sync.js` se sirve 200 y `window.esAhorroRepartible` queda definido):
```
javascript_tool: typeof window.esAhorroRepartible
```
Esperado: `"function"`. (No hace falta sesión para esto — el módulo carga en el boot.)

- [ ] **Step 5: Commit**
```bash
git add index.html sw.js
git commit -m "chore(sw): registra js/reparto-sync.js en el shell + SHELL_VERSION v37

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Verificación integral

**Files:** ninguno (verificación).

- [ ] **Step 1: Correr el unit test**
```
node --test test/reparto-sync.test.mjs
```
Esperado: 4/4 PASS.

- [ ] **Step 2: Confirmar que el shell carga limpio**

Con el server, `http://localhost:5050/`, revisa `read_console_messages` (sin errores) y `javascript_tool: typeof window.esAhorroRepartible` → `"function"`.

- [ ] **Step 3: Test de integración manual (documentar para el usuario)**

Si NO hay sesión disponible, NO ingreses credenciales; documenta estos pasos para que el usuario los corra con su cuenta/hogar de PRUEBA (nunca el hogar real):
1. En `#transaccion`, con el navegador **offline** (DevTools → Network → Offline), registra un ahorro. Debe quedar como pendiente (badge de pendientes sube) y sin aportes.
2. Vuelve **online**. El sync se dispara solo (evento `online`) o fuérzalo cambiando a otra vista y volviendo.
3. Verifica en `#metas` que las metas/fondo recibieron el reparto de ese ahorro, y que el pendiente desapareció.
4. **Idempotencia**: fuerza el sync otra vez (recarga online). Los aportes NO deben duplicarse — el total repartido debe seguir igual.

Si hay sesión con cuenta de prueba, ejecútalo tú y reporta el resultado.

- [ ] **Step 4: Confirmar que no se coló código de prueba**
```bash
git diff origin/main -- js/ index.html sw.js | grep -n "console.log\|debugger\|TODO" || echo "limpio"
```
Esperado: `limpio` (o solo los `console.error` legítimos preexistentes — revisa que no haya `console.log` nuevos).

---

## Cierre

`main` está protegida (push directo rechazado). Abrir PR y mergear:
```bash
git push -u origin fix/reparto-ahorro-offline
gh pr create --title "Fix: el ahorro registrado offline se reparte al reconectar" --body "..."
gh pr merge <N> --merge
```
(El usuario autorizó mergear PRs de mejora directo — memoria `nestra-migracion-v1-a-v2`.)

Tras el merge, verificar el deploy con cache-buster:
```bash
curl -sL "https://nestra-8rl.pages.dev/sw.js?cb=$RANDOM" | grep SHELL_VERSION
```
Esperado: `v37`. En el teléfono puede requerir cerrar/reabrir la PWA para tomar el shell nuevo (el reparto offline solo funciona con el js nuevo cacheado).

## Self-review (cobertura del spec)

- Ahorro offline queda pendiente → ya funciona (outbox); sin cambios. ✔
- Reparto al reconectar → Task 3 (enganche en sync). ✔
- Idempotencia (no duplicar) → Task 2 (guarda de conteo). ✔
- Predicado puro testeado → Task 1. ✔
- Aporte directo excluido → Task 1 (esAhorroRepartible) + Task 2. ✔
- Registro del script + precache + bump → Task 4. ✔
- No se toca la base → ninguna task usa apply_migration. ✔
- Camino online sin cambios de comportamiento → Task 2 Step 2 (solo delega la regla). ✔
- Edición offline fuera de alcance → declarado en el spec. ✔
