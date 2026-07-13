# Fase 6.1 — Hogar opt-in — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer el "hogar" opt-in real: nada de ámbito hogar se muestra hasta crear/unir un hogar; #hogar gana "aporte real vs esperado por miembro" + enlace a config; Configuración gana una sección "Hogar" (aporte esperado + renombrar).

**Architecture:** Scoping pasa de `ambito` a `hogar_id` (personal = `hogar_id IS NULL`, hogar = `NOT NULL`) — equivalente para filas marcadas, arregla legacy. Un estado global `window.hogarState` + helper `tieneHogar()` + evento `hogar:changed` gobiernan el gating. SQL nuevo mínimo (columna `aporte_esperado` + 2 RPCs).

**Tech Stack:** Postgres/Supabase (RLS, RPC), JS vanilla ESM (node:test), PWA sin build.

**Spec:** `docs/superpowers/specs/2026-06-30-fase6-1-hogar-optin-design.md`

**Regla de seguridad:** el SQL nuevo se revisa a mano y se aplica SOLO a v2.

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `supabase/migrations/20260630_fase6_1_hogar_config.sql` | Crear | Columna `aporte_esperado` + RPCs `set_aporte_esperado`, `renombrar_hogar`. |
| `js/hogar-aporte.js` | Crear | Función pura `aporteRealPorMiembro` (real vs esperado). Dual-export. |
| `test/hogar-aporte.test.mjs` | Crear | Tests de la función pura. |
| `js/db.js` | Modificar | `window.hogarState`, `tieneHogar()`, refresco en crear/unir/disolver, wrappers nuevos, scoping por `hogar_id`, `getEstadoHogar` trae `aporte_esperado`, `getTransacciones`/`getMetas` traen `hogar_id`. |
| `js/safe-to-spend.js` | Modificar | Scoping por `hogar_id` en vez de `ambito`. |
| `js/auth.js` | Modificar | Cargar/limpiar `window.hogarState` en `loadProfile`/logout. |
| `views/transaccion.html`, `views/metas.html` | Modificar | Ocultar toggle ámbito sin hogar; forzar personal. |
| `views/dashboard.html` | Modificar | Gating de cards hogar; card personal por scope `hogar_id IS NULL`. |
| `views/graficos.html`, `views/resumen.html` | Modificar | Gating de superficies hogar; default Personal. |
| `views/hogar.html` | Modificar | Aporte real vs esperado por miembro + botón "Configuración del hogar →". |
| `views/configuracion.html` | Modificar | Sección acordeón "Hogar" (aporte esperado + renombrar). |
| `sw.js` | Modificar | Precache `js/hogar-aporte.js`; bump `SHELL_VERSION` v18→v19. |

---

## Task 1: Migración SQL — aporte_esperado + RPCs

**Files:**
- Create: `supabase/migrations/20260630_fase6_1_hogar_config.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- supabase/migrations/20260630_fase6_1_hogar_config.sql
-- Fase 6.1 — config de hogar (aporte esperado + renombrar). SOLO v2. Idempotente.

begin;

alter table public.hogar_miembros
  add column if not exists aporte_esperado numeric(10,2) not null default 0;

-- Fija el aporte esperado mensual de un miembro del hogar del llamante.
-- Pareja acuerda: cualquier miembro puede fijar el de ambos.
create or replace function public.set_aporte_esperado(p_miembro uuid, p_monto numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_hogar uuid := public.auth_hogar_id();
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  if p_monto is null or p_monto < 0 then raise exception 'Monto inválido'; end if;
  if not exists (select 1 from public.hogar_miembros
                 where hogar_id = v_hogar and user_id = p_miembro) then
    raise exception 'El miembro no pertenece a tu hogar';
  end if;
  update public.hogar_miembros set aporte_esperado = round(p_monto, 2)
   where hogar_id = v_hogar and user_id = p_miembro;
end; $$;

create or replace function public.renombrar_hogar(p_nombre text)
returns void language plpgsql security definer set search_path = public as $$
declare v_hogar uuid := public.auth_hogar_id();
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  update public.hogares set nombre = coalesce(nullif(trim(p_nombre),''), nombre)
   where id = v_hogar;
end; $$;

grant execute on function public.set_aporte_esperado(uuid, numeric) to authenticated;
grant execute on function public.renombrar_hogar(text)             to authenticated;

commit;
```

- [ ] **Step 2: Verificar**

Run: `grep -nE "aporte_esperado|set_aporte_esperado|renombrar_hogar" supabase/migrations/20260630_fase6_1_hogar_config.sql`
Expected: la columna y las 2 funciones presentes.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260630_fase6_1_hogar_config.sql
git commit -m "feat(fase6.1): columna aporte_esperado + RPCs set_aporte_esperado/renombrar_hogar"
```

> **Nota:** NO aplicar a ninguna DB aquí. Revisión manual + aplicar en SQL Editor de v2 (Task 11).

---

## Task 2: Función pura `aporteRealPorMiembro` (TDD)

**Files:**
- Create: `test/hogar-aporte.test.mjs`
- Create: `js/hogar-aporte.js`

- [ ] **Step 1: Escribir los tests**

```javascript
// test/hogar-aporte.test.mjs
import assert from 'node:assert';
import { test } from 'node:test';
import { aporteRealPorMiembro } from '../js/hogar-aporte.js';

const H = 'hogar1';
function tx(user_id, tipo, monto, hogar_id = H, fecha = '2026-06-10') {
  return { user_id, tipo, monto, hogar_id, fecha };
}
const RANGO = { desde: '2026-06-01', hasta: '2026-06-30' };

test('suma ingresos hogar + gastos hogar del miembro en el rango', () => {
  const txs = [
    tx('A', 'ingreso', 500), tx('A', 'gasto', 100),
    tx('B', 'gasto', 40),
  ];
  const r = aporteRealPorMiembro(txs, 'A', RANGO);
  assert.strictEqual(r, 600);
});

test('ignora filas de otro miembro', () => {
  const txs = [tx('A', 'ingreso', 500), tx('B', 'ingreso', 999)];
  assert.strictEqual(aporteRealPorMiembro(txs, 'A', RANGO), 500);
});

test('ignora filas sin hogar_id (personales)', () => {
  const txs = [tx('A', 'gasto', 100, null), tx('A', 'gasto', 50)];
  assert.strictEqual(aporteRealPorMiembro(txs, 'A', RANGO), 50);
});

test('ignora ahorro y fechas fuera de rango', () => {
  const txs = [
    tx('A', 'ahorro', 300), tx('A', 'gasto', 70, H, '2026-05-30'),
    tx('A', 'gasto', 20, H, '2026-06-15'),
  ];
  assert.strictEqual(aporteRealPorMiembro(txs, 'A', RANGO), 20);
});

test('sin filas → 0', () => {
  assert.strictEqual(aporteRealPorMiembro([], 'A', RANGO), 0);
});
```

- [ ] **Step 2: Correr para ver fallar**

Run: `node --test test/hogar-aporte.test.mjs`
Expected: FAIL — `Cannot find module '../js/hogar-aporte.js'`.

- [ ] **Step 3: Implementar**

```javascript
// ─────────────────────────────────────────────────────────────────
// Nestra — hogar-aporte.js (Fase 6.1)
// Aporte real de un miembro al hogar en un rango: ingresos del hogar +
// gastos del hogar que pagó (tipo in ingreso/gasto, hogar_id != null).
// Puro y determinista. Dual-export como safe-to-spend.js.
// ─────────────────────────────────────────────────────────────────
'use strict';

function aporteRealPorMiembro(transacciones, userId, rango) {
  var desde = rango && rango.desde, hasta = rango && rango.hasta;
  return (transacciones || []).reduce(function (sum, t) {
    if (t.user_id !== userId) return sum;
    if (t.hogar_id == null) return sum;                 // solo del hogar
    if (t.tipo !== 'ingreso' && t.tipo !== 'gasto') return sum; // no ahorro
    if (desde && t.fecha < desde) return sum;
    if (hasta && t.fecha > hasta) return sum;
    return sum + (Number(t.monto) || 0);
  }, 0);
}

if (typeof window !== 'undefined') {
  window.aporteRealPorMiembro = aporteRealPorMiembro;
}

export { aporteRealPorMiembro };
```

- [ ] **Step 4: Correr para ver pasar**

Run: `node --test test/hogar-aporte.test.mjs`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add test/hogar-aporte.test.mjs js/hogar-aporte.js
git commit -m "feat(fase6.1): funcion pura aporteRealPorMiembro (TDD)"
```

---

## Task 3: db.js — estado global de hogar + wrappers + getEstadoHogar

**Files:**
- Modify: `js/db.js`

- [ ] **Step 1: Añadir `tieneHogar()`, refrescar `window.hogarState`, wrappers, y `aporte_esperado` en getEstadoHogar**

En `js/db.js`, modificar `getEstadoHogar` para traer `aporte_esperado` en el select de miembros y para cachear el resultado en `window.hogarState`:

```javascript
// Reemplazar el select de miembros dentro de getEstadoHogar:
//   .from('hogar_miembros').select('user_id, rol, joined_at, aporte_esperado').eq(...)
// y al final, antes del return, cachear:
//   const estado = { hogar: hogarRes.data, miembros: ..., codigo: ..., rol: miembro.rol };
//   if (typeof window !== 'undefined') window.hogarState = estado;
//   return estado;
```

Añadir helper y hacer que crear/unir/disolver refresquen el estado y emitan el evento. Reemplazar los cuerpos de `crearHogar`, `unirseHogar`, `disolverHogar` para que, tras el RPC, refresquen:

```javascript
function tieneHogar() {
  return !!(typeof window !== 'undefined' && window.hogarState && window.hogarState.hogar);
}

async function _refrescarHogarState() {
  try { await getEstadoHogar(); }      // getEstadoHogar ya cachea en window.hogarState
  catch (e) { if (typeof window !== 'undefined') window.hogarState = null; }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('hogar:changed'));
  }
}

async function crearHogar(nombre) {
  const { data, error } = await supabase.rpc('crear_hogar', { p_nombre: nombre });
  if (error) throw error;
  await _refrescarHogarState();
  return data;
}
async function unirseHogar(codigo) {
  const { data, error } = await supabase.rpc('unirse_hogar', { p_codigo: codigo });
  if (error) throw error;
  await _refrescarHogarState();
  return data;
}
async function disolverHogar() {
  const { data, error } = await supabase.rpc('disolver_hogar');
  if (error) throw error;
  await _refrescarHogarState();
  return data;
}

async function setAporteEsperado(miembroUserId, monto) {
  const { error } = await supabase.rpc('set_aporte_esperado', { p_miembro: miembroUserId, p_monto: monto });
  if (error) throw error;
  await _refrescarHogarState();
}
async function renombrarHogar(nombre) {
  const { error } = await supabase.rpc('renombrar_hogar', { p_nombre: nombre });
  if (error) throw error;
  await _refrescarHogarState();
}
```

> Las funciones `crearHogar`/`unirseHogar`/`disolverHogar` YA EXISTEN (Fase 6) — reemplazar su cuerpo para añadir `await _refrescarHogarState()`, no duplicarlas. Verificar nombres antes de pegar.

- [ ] **Step 2: Asegurar que `getTransacciones` y `getMetas` traen `hogar_id`**

Abrir `js/db.js`, localizar el `.select(...)` de `getTransacciones` y `getMetas`. Añadir `hogar_id` a la lista de columnas seleccionadas (necesario para el scoping cliente de safe-to-spend y el aporte por miembro). Si usan `select('*')`, ya viene; si listan columnas, añadir `hogar_id`.

- [ ] **Step 3: Verificar (sin duplicados, syntax)**

Run: `grep -nc "async function crearHogar\|function tieneHogar\|async function setAporteEsperado" js/db.js && node --check js/db.js && echo OK`
Expected: cada función una sola vez; `node --check` OK.

- [ ] **Step 4: Commit**

```bash
git add js/db.js
git commit -m "feat(fase6.1): window.hogarState + tieneHogar() + refresco/evento + wrappers config + aporte_esperado"
```

---

## Task 4: db.js — scoping por hogar_id en las 6 funciones de balance

**Files:**
- Modify: `js/db.js`

- [ ] **Step 1: Cambiar el filtro de scoping de `ambito` a `hogar_id` en estas funciones**

En `js/db.js`, en cada función, reemplazar:
- `.eq('ambito', 'personal')` → `.is('hogar_id', null)`
- `.eq('ambito', 'hogar')` → `.not('hogar_id', 'is', null)`

Funciones a tocar (verificar cada una): `getBalanceHogar`, `getBalancePersonal`, `getSaldoAcumuladoHogar`, `getSaldoAcumuladoPersonal`, `getAhorrosHogar`, `getAhorrosPersonal`. Las personales conservan su `.eq('user_id', userId)`; las de hogar NO llevan filtro de user_id (RLS limita al hogar).

Ejemplo (getBalancePersonal):
```javascript
    const { data, error } = await supabase
      .from('transacciones')
      .select('tipo, monto, aporte_id')
      .eq('user_id', userId)
      .is('hogar_id', null)              // antes: .eq('ambito', 'personal')
      .neq('tipo', 'ahorro')
      .gte('fecha', desde)
      .lte('fecha', hasta);
```

También en `getGastoCategoria(categoria_id, ambito, ...)`: si filtra por `ambito`, mapear el parámetro a `hogar_id` (`ambito==='hogar'` → `.not('hogar_id','is',null)`, si no `.is('hogar_id', null)`).

- [ ] **Step 2: Verificar que NINGUNA función de balance siga usando ambito para scoping**

Run: `grep -n "eq('ambito'" js/db.js`
Expected: 0 resultados en las funciones de balance (el `ambito` solo puede quedar como dato de inserción, no como filtro de scoping). Si quedan, convertirlas.

Run: `node --check js/db.js && echo OK`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add js/db.js
git commit -m "feat(fase6.1): scoping por hogar_id en funciones de balance (legacy hogar cuenta personal sin hogar)"
```

---

## Task 5: safe-to-spend.js — scoping por hogar_id

**Files:**
- Modify: `js/safe-to-spend.js`
- Modify: `test/safe-to-spend.test.mjs` (los fixtures usan `ambito:'personal'`; añadir `hogar_id`)

- [ ] **Step 1: Cambiar el filtro de `ambito` a `hogar_id`**

En `js/safe-to-spend.js`:
- Línea ~47: `(transacciones || []).filter((t) => t.ambito === 'personal' && t.fecha)` → `(transacciones || []).filter((t) => t.hogar_id == null && t.fecha)`
- Línea ~137: `if (m.ambito !== 'personal') continue;` → `if (m.hogar_id != null) continue;`

- [ ] **Step 2: Actualizar los fixtures del test para que reflejen el nuevo scoping**

En `test/safe-to-spend.test.mjs`, las helpers `ing`/`gas` crean `{ ambito: 'personal', ... }`. Añadir `hogar_id: null` a esas helpers para que sigan contando como personales bajo el nuevo filtro. (No cambiar las aserciones — los montos esperados no cambian.)

```javascript
function ing(monto, fechaISO) { return { tipo: 'ingreso', ambito: 'personal', hogar_id: null, monto, fecha: fechaISO }; }
function gas(monto, fechaISO, categoria_id = 'c1') { return { tipo: 'gasto', ambito: 'personal', hogar_id: null, monto, fecha: fechaISO, categoria_id }; }
```

- [ ] **Step 3: Correr la suite de safe-to-spend**

Run: `node --test test/safe-to-spend.test.mjs`
Expected: PASS (mismos asserts, ahora bajo scoping por hogar_id).

- [ ] **Step 4: Commit**

```bash
git add js/safe-to-spend.js test/safe-to-spend.test.mjs
git commit -m "feat(fase6.1): safe-to-spend scoping por hogar_id"
```

---

## Task 6: auth.js — cargar/limpiar window.hogarState

**Files:**
- Modify: `js/auth.js`

- [ ] **Step 1: Cargar el estado de hogar tras cargar el perfil; limpiarlo en logout**

En `js/auth.js`, al final de `loadProfile(userId)` (que se llama tras cada sesión válida — líneas ~54, ~223, ~271), añadir la carga del estado de hogar:

```javascript
  // Estado de hogar para el gating de UI (Fase 6.1).
  try { if (typeof getEstadoHogar === 'function') await getEstadoHogar(); } // cachea en window.hogarState
  catch (e) { window.hogarState = null; }
```

En el/los punto(s) donde se hace logout (`window.currentUser = null;`), añadir también `window.hogarState = null;`.

- [ ] **Step 2: Verificar**

Run: `grep -n "hogarState\|getEstadoHogar" js/auth.js`
Expected: carga en loadProfile + limpieza en logout.

- [ ] **Step 3: Commit**

```bash
git add js/auth.js
git commit -m "feat(fase6.1): cargar window.hogarState tras login, limpiar en logout"
```

---

## Task 7: Gating del toggle ámbito (transacción + metas)

**Files:**
- Modify: `views/transaccion.html`
- Modify: `views/metas.html`

- [ ] **Step 1: transaccion.html — ocultar el toggle sin hogar y forzar personal**

En `views/transaccion.html`, el toggle son `#btnAmbitoPersonal` / `#btnAmbitoHogar` (líneas ~104-106) con hidden `#ambito`. Envolver ese par en un contenedor identificable si no lo está (buscar el `div`/fila que los contiene) y, en el script de init de la vista, ocultarlo cuando `!tieneHogar()` y forzar `_setAmbito('personal')`:

```javascript
    // Gating Fase 6.1: sin hogar, no se ofrece el ámbito hogar.
    (function gateAmbito() {
      var fila = btnAmbitoPersonal.closest('.tx-seg, .tx-toggle, .form-row') || btnAmbitoPersonal.parentElement;
      function aplicar() {
        var hay = (typeof tieneHogar === 'function') && tieneHogar();
        if (fila) fila.style.display = hay ? '' : 'none';
        if (!hay) _setAmbito('personal');
      }
      aplicar();
      window.addEventListener('hogar:changed', aplicar);
    })();
```

> Antes de pegar, confirmar el nombre de la clase del contenedor del toggle inspeccionando el markup alrededor de la línea 104; ajustar el selector de `closest(...)`.

- [ ] **Step 2: metas.html — mismo gating del selector de ámbito**

En `views/metas.html`, localizar el control de ámbito (buscar `ambito`/`hogar` en el form de meta). Ocultarlo sin hogar y forzar `personal` con el mismo patrón (`tieneHogar()` + listener `hogar:changed`).

- [ ] **Step 3: Verificar (preview)**

Levantar preview, ir a `#transaccion`: sin hogar, el toggle ámbito no aparece y el ámbito queda personal. (Si no hay forma de simular hogar en preview sin DB, basta confirmar el estado sin hogar y la ausencia de errores en consola.)

- [ ] **Step 4: Commit**

```bash
git add views/transaccion.html views/metas.html
git commit -m "feat(fase6.1): ocultar toggle ambito sin hogar (transaccion + metas)"
```

---

## Task 8: Gating del dashboard

**Files:**
- Modify: `views/dashboard.html`

- [ ] **Step 1: Ocultar las superficies de hogar sin hogar**

En `views/dashboard.html`:
- La card "Balance del hogar" es `<section ... aria-labelledby="hogarTitle">` (línea ~23). Darle un id (`id="dashHogarCard"`) si no lo tiene y ocultarla cuando `!tieneHogar()`.
- La línea "↳ de eso, aporte al hogar" del card personal (render `renderPersonal`, ~línea 631): ocultarla/omitirla sin hogar.
- La card "quién debe qué" (`#dashDeudaCard`, IIFE `cargarDeudaHogar`): condicionarla a `tieneHogar()` además del check actual.
- Los badges "Hogar/Personal" en la lista de transacciones (~762): sin hogar, no renderizar el badge (todo es personal).

Añadir, en el script del dashboard, una función que aplique el gating y re-aplique en `hogar:changed`:

```javascript
    function aplicarGatingHogar() {
      var hay = (typeof tieneHogar === 'function') && tieneHogar();
      var card = document.getElementById('dashHogarCard');
      if (card) card.style.display = hay ? '' : 'none';
      // la card de deuda ya se autogestiona; el resto se decide en cada render.
    }
    window.addEventListener('hogar:changed', function () { aplicarGatingHogar(); /* y recargar si aplica */ });
```

> El card personal con scoping por `hogar_id IS NULL` (Task 4) ya incluye, sin hogar, todo el dinero del usuario (personal + legacy hogar). No hace falta cambiar `renderPersonal` salvo ocultar la sub-línea de aporte.

- [ ] **Step 2: Verificar (preview)**

Sin hogar: no aparece card "Balance del hogar", ni "quién debe qué", ni la sub-línea de aporte, ni badges. El card personal muestra el total del usuario. Sin errores en consola.

- [ ] **Step 3: Commit**

```bash
git add views/dashboard.html
git commit -m "feat(fase6.1): gating de cards/badges hogar en dashboard"
```

---

## Task 9: Gating de gráficos + resumen

**Files:**
- Modify: `views/graficos.html`
- Modify: `views/resumen.html`

- [ ] **Step 1: graficos.html — ocultar toggle/gráficos hogar; default Personal**

En `views/graficos.html`:
- El segmento `data-ambito="hogar"`/`"personal"` (líneas 15-16): sin hogar, ocultar el contenedor del segmento y forzar `estado.ambito = 'personal'` (línea ~170 inicializa en `'hogar'`; cambiar el default a `'personal'`).
- Las queries ya pasarán por `hogar_id` (Task 4 / getTransacciones con filtros) — el modo personal pide `getTransacciones({ ambito:'personal' })`; cambiar esos filtros a basarse en pertenencia: usar el helper de db.js o pedir sin ámbito y filtrar cliente por `hogar_id==null`. Mínimo: para el modo personal, asegurar que incluye filas con `hogar_id null` (legacy). Implementación simple: en `cargarDatos('personal')`, pedir `getTransacciones({ fecha_desde, fecha_hasta })` y filtrar cliente `x.hogar_id == null`.
- Aplicar gating con `tieneHogar()` + listener `hogar:changed`.

- [ ] **Step 2: resumen.html — ocultar la sección hogar sin hogar**

En `views/resumen.html`, localizar la(s) sección(es) de hogar (buscar `hogar`). Ocultarlas cuando `!tieneHogar()`. El export XLSX puede seguir incluyendo todo (es un dump).

- [ ] **Step 3: Verificar (preview)**

Sin hogar: gráficos sin segmento hogar (solo personal), resumen sin sección hogar. Con datos legacy, el modo personal los incluye.

- [ ] **Step 4: Commit**

```bash
git add views/graficos.html views/resumen.html
git commit -m "feat(fase6.1): gating de graficos (default personal) + resumen sin hogar"
```

---

## Task 10: #hogar — aporte real vs esperado + enlace a config

**Files:**
- Modify: `views/hogar.html`

- [ ] **Step 1: Añadir la sección de aporte por miembro y el botón a config**

En `views/hogar.html`, dentro de `renderConHogar` (ya tiene `estado.miembros`, `txs`, `uidActual`), añadir una card que liste, por miembro, el aporte real vs esperado del mes. Usar `window.aporteRealPorMiembro(txs, m.user_id, rango)` y `m.aporte_esperado`. El rango del mes se calcula con las utilidades existentes (o inline: primer/último día del mes actual).

```javascript
      // Card: aporte real vs esperado por miembro (mes en curso).
      var hoy = new Date();
      var rango = {
        desde: new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0,10),
        hasta: new Date(hoy.getFullYear(), hoy.getMonth()+1, 0).toISOString().slice(0,10),
      };
      var aporteCard = '<div class="hogar-card"><h2 class="hogar-card-title">Aporte del mes</h2>' +
        miembros.map(function (m) {
          var real = (typeof aporteRealPorMiembro === 'function') ? aporteRealPorMiembro(txs, m.user_id, rango) : 0;
          var esp  = Number(m.aporte_esperado) || 0;
          var quien = (m.user_id === uidActual) ? 'Tú' : 'Tu pareja';
          var barra = esp > 0
            ? '<div class="hogar-balance-sub">' + escHtml(fmt(real)) + ' de ' + escHtml(fmt(esp)) +
              ' (' + Math.min(100, Math.round(real / esp * 100)) + '%)</div>'
            : '<div class="hogar-balance-sub">' + escHtml(fmt(real)) + ' (sin meta de aporte)</div>';
          return '<p class="hogar-card-sub" style="margin:0 0 4px"><strong>' + escHtml(quien) + '</strong></p>' + barra;
        }).join('') +
        '</div>';
```

Insertar `aporteCard` en el `cont.innerHTML` (entre la card de balance y la zona de peligro). Añadir, en la card del hogar o como acción, el botón a config:

```javascript
        '<button type="button" class="btn btn-secondary btn-sm" id="hogarBtnConfig">Configuración del hogar →</button>'
```

y el listener:
```javascript
      if ($('hogarBtnConfig')) $('hogarBtnConfig').addEventListener('click', function () { location.hash = '#configuracion'; });
```

Cargar `js/hogar-aporte.js` en `index.html` como módulo (junto a `hogar-balance.js`).

- [ ] **Step 2: Verificar sintaxis del script inline**

Run: `awk '/^  <script>/{f=1;next} /^  <\/script>/{f=0} f' views/hogar.html > /tmp/h.js && node --check /tmp/h.js && echo OK`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add views/hogar.html index.html
git commit -m "feat(fase6.1): #hogar aporte real vs esperado por miembro + enlace a Configuracion"
```

---

## Task 11: Configuración — sección "Hogar" (aporte esperado + renombrar)

**Files:**
- Modify: `views/configuracion.html`

- [ ] **Step 1: Añadir una sección acordeón "Hogar" siguiendo el patrón existente**

En `views/configuracion.html`, replicar el patrón de las secciones acordeón (`<section class="cfg-card cfg-acord" id="cfgHogarSection" style="display:none">` con head button + body). El body contiene: input de nombre (botón "Guardar" → `renombrarHogar`), y un input de aporte esperado por cada miembro (botón "Guardar" → `setAporteEsperado(miembroUserId, monto)`).

En el script de configuración, mostrar la sección solo con `tieneHogar()` y poblarla desde `window.hogarState`:

```javascript
    (function initHogarConfig() {
      function render() {
        var sec = document.getElementById('cfgHogarSection');
        if (!sec) return;
        var hay = (typeof tieneHogar === 'function') && tieneHogar();
        sec.style.display = hay ? '' : 'none';
        if (!hay) return;
        var st = window.hogarState;
        // poblar nombre + inputs de aporte por miembro desde st.hogar / st.miembros
        // (ver helpers escHtml/$ existentes de la vista)
        // ... construir el body con st.hogar.nombre y st.miembros[].aporte_esperado ...
        // listeners:
        //   guardar nombre  → await renombrarHogar(valor); render();
        //   guardar aporte  → await setAporteEsperado(m.user_id, valor); render();
      }
      render();
      window.addEventListener('hogar:changed', render);
    })();
```

> Seguir el estilo y helpers de la propia vista (`escHtml`, `$`, clases `cfg-*`). El nombre de miembro: usar "Tú"/"Tu pareja" comparando con `window.currentUser.id` (no hay nombres de miembro en `hogarState`).

- [ ] **Step 2: Verificar (preview + sintaxis)**

Run: `awk '/<script>/{f=1} f' views/configuracion.html | node --check /dev/stdin 2>&1 | head -1 || true`
(Confirmar visualmente que la sección Hogar solo aparece con hogar.)

- [ ] **Step 3: Commit**

```bash
git add views/configuracion.html
git commit -m "feat(fase6.1): seccion Hogar en Configuracion (renombrar + aporte esperado por miembro)"
```

---

## Task 12: Service worker + verificación + deploy

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: Precache de hogar-aporte.js + bump de versión**

En `sw.js`, añadir `{ url: 'js/hogar-aporte.js', revision: SHELL_VERSION }` junto a `hogar-balance.js`, y subir `SHELL_VERSION` de `'v18'` a `'v19'`.

Run: `grep -n "SHELL_VERSION\|hogar-aporte" sw.js`
Expected: `v19` + el asset presente.

- [ ] **Step 2: Suite JS completa**

Run: `node --test test/*.test.mjs`
Expected: todo verde (incluye `hogar-aporte` y `safe-to-spend`).

- [ ] **Step 3: Commit**

```bash
git add sw.js
git commit -m "feat(fase6.1): precache hogar-aporte + bump SHELL_VERSION v19"
```

- [ ] **Step 4: Aplicar migración en v2 + verificación manual**

1. Revisar a mano `supabase/migrations/20260630_fase6_1_hogar_config.sql` y aplicarlo en el SQL Editor de v2 (NO producción).
2. Con cuenta SIN hogar: confirmar que NADA de hogar se muestra (dashboard, gráficos, transacción, metas, resumen) y que los totales personales incluyen las filas legacy.
3. Crear hogar → aparece el UI de hogar; las filas legacy migran a hogar (backfill). #hogar muestra aporte real vs esperado. Botón lleva a Configuración › Hogar. Fijar aporte esperado y nombre; verificar persistencia.
4. Disolver → todo hogar vuelve a ocultarse.

- [ ] **Step 5: Deploy**

```bash
git push origin v2
```
Verificar: `curl -sL https://nestra-8rl.pages.dev/sw.js | grep SHELL_VERSION` → `v19`. (Confirmar con el usuario antes de push — outward-facing.)

---

## Self-Review (cobertura del spec)

- **Parte 1 (estado global + scoping):** Tasks 3, 4, 6. ✓
- **Parte 2 (gating):** Tasks 7 (transacción/metas), 8 (dashboard), 9 (gráficos/resumen). ✓
- **Parte 3 (#hogar):** Tasks 2 (función pura), 10 (UI). ✓
- **Parte 4 (config Hogar):** Tasks 1 (SQL), 11 (UI). ✓
- **SQL nuevo:** Task 1. ✓ · **safe-to-spend scoping:** Task 5. ✓ · **sw/deploy:** Task 12. ✓

**Puntos a confirmar contra el código real en ejecución (marcados en el plan, no son fallos):**
- Selector del contenedor del toggle ámbito en transacción/metas (Task 7).
- Columnas exactas en los `select` de `getTransacciones`/`getMetas` (Task 3 Step 2).
- Estructura exacta de la sección hogar en resumen (Task 9 Step 2).
- Helpers/patrón de la vista configuración para construir la sección (Task 11).
