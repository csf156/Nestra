# Fase 6 — Notificaciones Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enviar notificaciones push (Web Push + VAPID) cuando un presupuesto pasa su límite, una meta lleva un mes sin aporte, o un préstamo lleva >30 días pendiente; disparadas por una Supabase Edge Function en cron diario.

**Architecture:** Cliente PWA pide permiso en momento contextual y guarda la suscripción en `push_subscriptions` (Supabase, RLS por usuario). `pg_cron` invoca diariamente la Edge Function `enviar-notificaciones`, que evalúa los 3 disparadores contra la DB, deduplica vía `notificaciones_log`, y envía con `web-push`. El Service Worker recibe el evento `push` y muestra la notificación.

**Tech Stack:** JS vanilla sin build, Workbox 7 (vendorizado), Supabase (Postgres + RLS + Edge Functions Deno), `npm:web-push`, `pg_cron` + `pg_net`, Web Push API / VAPID.

---

## File Structure

| Archivo | Responsabilidad | Acción |
|---------|-----------------|--------|
| `supabase/migrations/20260623_push_subscriptions.sql` | Tablas `push_subscriptions` + `notificaciones_log` + RLS | Crear |
| `supabase/migrations/20260623_cron_notificaciones.sql` | Habilitar `pg_cron`/`pg_net` + agendar el job | Crear |
| `supabase/tests/push_rls_test.sql` | Verificación RLS + unicidad | Crear |
| `sw.js` | Listeners `push` + `notificationclick`; precache de `push.js`; bump `SHELL_VERSION` | Modificar |
| `js/config.js` | Constante `VAPID_PUBLIC_KEY` | Modificar |
| `js/push.js` | Soporte/permiso/subscribe/unsubscribe + prompt contextual | Crear |
| `index.html` | Cargar `js/push.js` | Modificar |
| `views/configuracion.html` | Prompt contextual tras crear presupuesto + toggle manual | Modificar |
| `views/metas.html` | Prompt contextual tras crear meta | Modificar |
| `views/prestamos.html` | Prompt contextual tras registrar préstamo | Modificar |
| `supabase/functions/enviar-notificaciones/detectors.ts` | Funciones puras: deciden qué enviar | Crear |
| `supabase/functions/enviar-notificaciones/detectors.test.ts` | `deno test` de los detectores | Crear |
| `supabase/functions/enviar-notificaciones/index.ts` | Orquestación: query DB, dedupe, `web-push`, limpieza | Crear |

**Datos confirmados del esquema:** `transacciones`(fecha date, tipo text, ambito, user_id, categoria_id, monto numeric); gasto = `tipo='gasto'`. `presupuestos`(categoria_id, monto_limite, periodo siempre `'mensual'`). `metas`(monto_objetivo, monto_actual, estado activo=`'en_curso'`, fecha_limite). `aportes_meta`(meta_id, monto, created_at, user_id). `prestamos`(deudor, estado `'pendiente'|'devuelto'`, fecha_devolucion=fecha de saldo NULL si pendiente) enlaza `transacciones(fecha, monto)`.

---

## Task 1: Migración de tablas `push_subscriptions` + `notificaciones_log`

**Files:**
- Create: `supabase/migrations/20260623_push_subscriptions.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- =====================================================================
-- Nestra — Migración: push notifications (FASE 6)
-- ---------------------------------------------------------------------
-- push_subscriptions: una fila por dispositivo/navegador suscrito.
-- notificaciones_log: candado idempotente anti-spam por periodo.
-- RLS estricta por dueño. La Edge Function usa service-role (salta RLS).
-- Idempotente: if not exists / drop if exists. Reusa set_updated_at().
-- =====================================================================

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_acceso" on public.push_subscriptions;
create policy "push_subscriptions_acceso"
  on public.push_subscriptions for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.notificaciones_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  tipo          text not null check (tipo in ('presupuesto', 'meta', 'prestamo')),
  ref_id        uuid,
  clave_dedupe  text not null,
  enviada_at    timestamptz not null default now()
);

-- Candado idempotente: mismo aviso, mismo periodo => no se reenvía.
create unique index if not exists idx_notif_log_user_clave
  on public.notificaciones_log (user_id, clave_dedupe);

alter table public.notificaciones_log enable row level security;

-- El usuario puede LEER su historial; solo service-role inserta.
drop policy if exists "notif_log_lectura" on public.notificaciones_log;
create policy "notif_log_lectura"
  on public.notificaciones_log for select
  to authenticated
  using ((select auth.uid()) = user_id);
```

- [ ] **Step 2: Aplicar la migración**

Usar la herramienta MCP `apply_migration` con name `20260623_push_subscriptions` y el SQL anterior. (No hay CLI Supabase en PATH; se aplica vía MCP al proyecto v2 `ombnhxueclqfeyjzhroz`.)

- [ ] **Step 3: Verificar que las tablas existen**

Ejecutar vía MCP `execute_sql`:
```sql
select table_name from information_schema.tables
where table_schema='public' and table_name in ('push_subscriptions','notificaciones_log')
order by table_name;
```
Expected: dos filas — `notificaciones_log`, `push_subscriptions`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260623_push_subscriptions.sql
git commit -m "feat(fase6): tablas push_subscriptions y notificaciones_log + RLS"
```

---

## Task 2: Test de aislamiento RLS y unicidad

**Files:**
- Create: `supabase/tests/push_rls_test.sql`

- [ ] **Step 1: Escribir el test SQL**

```sql
-- Verificación manual (ejecutar en SQL Editor con un usuario auth real o via service-role
-- simulando dos user_id distintos). Comprueba: unicidad de endpoint, unicidad de
-- (user_id, clave_dedupe). No depende de RLS de sesión; valida constraints.

-- 1. endpoint único: el segundo insert debe fallar.
do $$
declare uid uuid := gen_random_uuid();
begin
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (uid, 'https://test.endpoint/abc', 'k1', 'a1');
  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
      values (uid, 'https://test.endpoint/abc', 'k2', 'a2');
    raise exception 'FALLO: endpoint duplicado se aceptó';
  exception when unique_violation then
    raise notice 'OK: endpoint único respetado';
  end;
  delete from public.push_subscriptions where endpoint = 'https://test.endpoint/abc';
end $$;

-- 2. (user_id, clave_dedupe) único: el segundo insert debe fallar.
do $$
declare uid uuid := gen_random_uuid();
begin
  insert into public.notificaciones_log (user_id, tipo, clave_dedupe)
    values (uid, 'presupuesto', 'presupuesto:x:2026-06');
  begin
    insert into public.notificaciones_log (user_id, tipo, clave_dedupe)
      values (uid, 'presupuesto', 'presupuesto:x:2026-06');
    raise exception 'FALLO: clave_dedupe duplicada se aceptó';
  exception when unique_violation then
    raise notice 'OK: dedupe único respetado';
  end;
  delete from public.notificaciones_log where clave_dedupe = 'presupuesto:x:2026-06';
end $$;
```

- [ ] **Step 2: Ejecutar el test**

Pegar el contenido en MCP `execute_sql`.
Expected: dos `NOTICE`: `OK: endpoint único respetado` y `OK: dedupe único respetado`. Sin excepción `FALLO`.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/push_rls_test.sql
git commit -m "test(fase6): unicidad endpoint y dedupe en tablas push"
```

---

## Task 3: Generar claves VAPID y configurar secrets

**Files:**
- Modify: `js/config.js`

- [ ] **Step 1: Generar el par de claves VAPID**

Una vez, en cualquier máquina con Node:
```bash
npx web-push generate-vapid-keys
```
Expected: imprime `Public Key:` y `Private Key:` (Base64 URL-safe). Guardar ambas.

- [ ] **Step 2: Añadir la clave pública a `js/config.js`**

Al final de `js/config.js` (tras `SUPABASE_ANON_KEY`), añadir:
```javascript
// VAPID public key (NO secreta) para suscripción Web Push. La privada vive
// como secret de la Edge Function `enviar-notificaciones`, nunca en el cliente.
const VAPID_PUBLIC_KEY = 'PEGAR_AQUI_LA_PUBLIC_KEY';
```
Reemplazar `PEGAR_AQUI_LA_PUBLIC_KEY` por la Public Key del Step 1.

- [ ] **Step 3: Configurar los secrets de la Edge Function**

En el dashboard de Supabase (Project Settings → Edge Functions → Secrets) o, si se instala el CLI, `supabase secrets set`, definir:
- `VAPID_PUBLIC_KEY` = la misma Public Key.
- `VAPID_PRIVATE_KEY` = la Private Key del Step 1.
- `VAPID_SUBJECT` = `mailto:csf156@gmail.com`.

Expected: tres secrets listados en el proyecto.

- [ ] **Step 4: Commit**

```bash
git add js/config.js
git commit -m "feat(fase6): VAPID public key en config.js"
```

---

## Task 4: Listeners `push` y `notificationclick` en el Service Worker

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: Añadir los listeners al final de `sw.js`**

Tras el listener `activate` existente (línea ~90), añadir:
```javascript
// ── Web Push (Fase 6) ─────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = {}; }
  const title = data.title || 'Nestra';
  const options = {
    body: data.body || '',
    icon: 'assets/icon-192.png',
    badge: 'assets/icon-192.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => 'focus' in c);
      if (existing) { existing.focus(); if ('navigate' in existing) existing.navigate(url); return; }
      return self.clients.openWindow(url);
    })
  );
});
```

- [ ] **Step 2: Añadir `js/push.js` al precache y bump de versión**

En `sw.js`, dentro del array de `precacheAndRoute`, tras la línea de `js/pwa.js` (línea ~38) añadir:
```javascript
  { url: 'js/push.js', revision: SHELL_VERSION },
```
Y cambiar `const SHELL_VERSION = 'v4';` (línea 15) a:
```javascript
const SHELL_VERSION = 'v5';
```

- [ ] **Step 3: Verificar registro del SW sin errores**

Iniciar el preview (`preview_start`), recargar, y revisar `preview_console_logs`.
Expected: log `SW registrado, scope: ...` y ausencia de errores de sintaxis/registro del SW.

- [ ] **Step 4: Commit**

```bash
git add sw.js
git commit -m "feat(fase6): SW push + notificationclick; precache push.js; SHELL_VERSION v5"
```

---

## Task 5: Módulo cliente `js/push.js`

**Files:**
- Create: `js/push.js`
- Modify: `index.html`

- [ ] **Step 1: Crear `js/push.js`**

```javascript
// Nestra — Web Push (Fase 6): soporte, permiso, subscribe/unsubscribe y
// prompt contextual. Depende de `supabase` (js/supabase.js), `VAPID_PUBLIC_KEY`
// (js/config.js) y un usuario autenticado.

// VAPID public key Base64 URL-safe → Uint8Array para applicationServerKey.
function _urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// pushSupported() — el navegador soporta SW + Push + Notification.
function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// _currentUserId() — id del usuario autenticado, o null.
async function _currentUserId() {
  try {
    const { data } = await supabase.auth.getUser();
    return data && data.user ? data.user.id : null;
  } catch (_) { return null; }
}

// pushIsSubscribed() — true si hay una suscripción activa en este navegador.
async function pushIsSubscribed() {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

// pushSubscribe() — pide permiso, suscribe y persiste en Supabase.
// Returns: true si quedó suscrito, false si no (sin soporte/permiso/login).
async function pushSubscribe() {
  if (!pushSupported()) return false;
  const userId = await _currentUserId();
  if (!userId) return false;

  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return false;

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: sub.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent,
  }, { onConflict: 'endpoint' });
  if (error) { console.error('pushSubscribe upsert:', error.message); return false; }
  return true;
}

// pushUnsubscribe() — cancela la suscripción local y borra la fila.
async function pushUnsubscribe() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch (_) {}
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

// pushOfrecerContextual(clave, mensaje) — ofrece activar push UNA vez por clave.
// Solo si: soportado, permiso aún 'default', y no se ofreció antes (localStorage).
// Usa confirm() nativo para no añadir UI; si acepta, llama pushSubscribe().
async function pushOfrecerContextual(clave, mensaje) {
  if (!pushSupported()) return;
  if (Notification.permission !== 'default') return;
  const flag = 'nestra-push-ofrecido-' + clave;
  if (localStorage.getItem(flag) === '1') return;
  localStorage.setItem(flag, '1');
  if (window.confirm(mensaje)) await pushSubscribe();
}
```

- [ ] **Step 2: Cargar `js/push.js` en `index.html`**

En `index.html`, junto a las demás etiquetas `<script src="js/...">` (después de `js/pwa.js`), añadir:
```html
    <script src="js/push.js"></script>
```

- [ ] **Step 3: Verificar que las funciones existen en runtime**

Con el preview corriendo y sesión iniciada, ejecutar `preview_eval`:
```javascript
typeof pushSupported + ',' + typeof pushSubscribe + ',' + pushSupported()
```
Expected: `function,function,true` (en un navegador con soporte; si el preview no soporta Push, `...,false` es aceptable — confirma que las funciones cargan).

- [ ] **Step 4: Commit**

```bash
git add js/push.js index.html
git commit -m "feat(fase6): cliente push.js (subscribe/unsubscribe/prompt contextual)"
```

---

## Task 6: Prompt contextual tras crear presupuesto + toggle en configuración

**Files:**
- Modify: `views/configuracion.html`

- [ ] **Step 1: Disparar el prompt tras crear un presupuesto**

En `views/configuracion.html`, localizar la línea ~1145:
```javascript
          var nuevo = await insertPresupuesto({ categoria_id: catId, monto_limite: monto });
```
Inmediatamente después de que esa operación tenga éxito (tras refrescar la UI del presupuesto, dentro del mismo handler), añadir:
```javascript
          if (typeof pushOfrecerContextual === 'function') {
            pushOfrecerContextual('presupuesto',
              '¿Quieres que te avise si te pasas del límite de un presupuesto?');
          }
```

- [ ] **Step 2: Añadir el toggle manual de notificaciones**

En la sección de ajustes de `views/configuracion.html`, añadir un control (cerca de otros toggles de la vista). Markup:
```html
<div class="config-row" id="pushToggleRow" hidden>
  <label for="pushToggle">Notificaciones push</label>
  <input type="checkbox" id="pushToggle">
</div>
```
Y en el script de la vista, tras cargar la vista, inicializar y cablear el toggle:
```javascript
(async function initPushToggle() {
  if (typeof pushSupported !== 'function' || !pushSupported()) return;
  var row = document.getElementById('pushToggleRow');
  var toggle = document.getElementById('pushToggle');
  if (!row || !toggle) return;
  row.hidden = false;
  toggle.checked = await pushIsSubscribed();
  toggle.addEventListener('change', async function () {
    if (toggle.checked) {
      var ok = await pushSubscribe();
      toggle.checked = ok;            // refleja el resultado real (permiso denegado => off)
    } else {
      await pushUnsubscribe();
    }
  });
})();
```

- [ ] **Step 3: Verificar el toggle en el preview**

Con el preview y sesión iniciada, navegar a Configuración. Ejecutar `preview_snapshot` y confirmar que aparece "Notificaciones push" con un checkbox. (La concesión real de permiso no se puede automatizar en el preview; basta confirmar que el control se renderiza y no lanza errores en `preview_console_logs`.)

- [ ] **Step 4: Commit**

```bash
git add views/configuracion.html
git commit -m "feat(fase6): prompt contextual presupuesto + toggle push en configuración"
```

---

## Task 7: Prompt contextual tras crear meta y préstamo

**Files:**
- Modify: `views/metas.html`
- Modify: `views/prestamos.html`

- [ ] **Step 1: Meta — disparar el prompt tras `insertMeta`**

En `views/metas.html`, localizar la llamada a `insertMeta(...)` dentro del handler de guardar. Tras el éxito (refrescada la lista), añadir:
```javascript
          if (typeof pushOfrecerContextual === 'function') {
            pushOfrecerContextual('meta',
              '¿Quieres que te recuerde aportar a tus metas cada mes?');
          }
```

- [ ] **Step 2: Préstamo — disparar el prompt tras `insertPrestamo`**

En `views/prestamos.html`, localizar la llamada a `insertPrestamo(...)`. Tras el éxito, añadir:
```javascript
          if (typeof pushOfrecerContextual === 'function') {
            pushOfrecerContextual('prestamo',
              '¿Quieres que te avise de préstamos pendientes desde hace tiempo?');
          }
```

- [ ] **Step 3: Verificar carga de ambas vistas sin error**

Con el preview, navegar a Metas y a Préstamos. `preview_console_logs` no debe mostrar errores (`pushOfrecerContextual` está definido globalmente por `push.js`).

- [ ] **Step 4: Commit**

```bash
git add views/metas.html views/prestamos.html
git commit -m "feat(fase6): prompt contextual push en metas y préstamos"
```

---

## Task 8: Detectores puros de la Edge Function (TDD con `deno test`)

**Files:**
- Create: `supabase/functions/enviar-notificaciones/detectors.ts`
- Test: `supabase/functions/enviar-notificaciones/detectors.test.ts`

> Estos detectores son funciones puras: reciben datos ya leídos de la DB y `hoy`, y
> devuelven la lista de avisos a enviar. Se prueban con `deno test` sin red ni DB.

- [ ] **Step 1: Escribir el test fallido**

```typescript
// supabase/functions/enviar-notificaciones/detectors.test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { detectarPresupuestos, detectarMetas, detectarPrestamos } from './detectors.ts';

const HOY = new Date('2026-06-23T08:00:00Z');

Deno.test('presupuesto: gasto >= límite produce aviso', () => {
  const presupuestos = [{ id: 'p1', categoria_id: 'c1', monto_limite: 100, categoria_nombre: 'Comida' }];
  const gastoPorCat = new Map([['c1', 120]]);
  const r = detectarPresupuestos(presupuestos, gastoPorCat, HOY);
  assertEquals(r.length, 1);
  assertEquals(r[0].clave_dedupe, 'presupuesto:p1:2026-06');
  assertEquals(r[0].tipo, 'presupuesto');
});

Deno.test('presupuesto: gasto < límite NO produce aviso', () => {
  const presupuestos = [{ id: 'p1', categoria_id: 'c1', monto_limite: 100, categoria_nombre: 'Comida' }];
  const r = detectarPresupuestos(presupuestos, new Map([['c1', 80]]), HOY);
  assertEquals(r.length, 0);
});

Deno.test('meta: en_curso sin aporte este mes produce aviso', () => {
  const metas = [{ id: 'm1', nombre: 'Viaje', estado: 'en_curso', monto_actual: 50, monto_objetivo: 500 }];
  const metasConAporteEsteMes = new Set<string>(); // ninguna
  const r = detectarMetas(metas, metasConAporteEsteMes, HOY);
  assertEquals(r.length, 1);
  assertEquals(r[0].clave_dedupe, 'meta:m1:2026-06');
});

Deno.test('meta: con aporte este mes NO produce aviso', () => {
  const metas = [{ id: 'm1', nombre: 'Viaje', estado: 'en_curso', monto_actual: 50, monto_objetivo: 500 }];
  const r = detectarMetas(metas, new Set(['m1']), HOY);
  assertEquals(r.length, 0);
});

Deno.test('meta: ya cumplida NO produce aviso', () => {
  const metas = [{ id: 'm1', nombre: 'Viaje', estado: 'en_curso', monto_actual: 500, monto_objetivo: 500 }];
  const r = detectarMetas(metas, new Set(), HOY);
  assertEquals(r.length, 0);
});

Deno.test('prestamo: pendiente >30 días produce aviso', () => {
  const prestamos = [{ id: 'l1', deudor: 'Ana', estado: 'pendiente', fecha: '2026-05-01', monto: 50 }];
  const r = detectarPrestamos(prestamos, HOY);
  assertEquals(r.length, 1);
  assertEquals(r[0].clave_dedupe, 'prestamo:l1:2026-06');
});

Deno.test('prestamo: pendiente <=30 días NO produce aviso', () => {
  const prestamos = [{ id: 'l1', deudor: 'Ana', estado: 'pendiente', fecha: '2026-06-10', monto: 50 }];
  const r = detectarPrestamos(prestamos, HOY);
  assertEquals(r.length, 0);
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `deno test supabase/functions/enviar-notificaciones/detectors.test.ts`
Expected: FAIL — `Module not found "./detectors.ts"` (aún no existe).

> Si `deno` no está en PATH, instalarlo (`https://deno.land`) o ejecutar dentro del contenedor de Supabase CLI. La lógica es pura JS; alternativa: portar el test a Node si fuera necesario.

- [ ] **Step 3: Implementar `detectors.ts`**

```typescript
// supabase/functions/enviar-notificaciones/detectors.ts
// Detectores puros de la Fase 6. Sin red ni DB: reciben datos + `hoy`.

export interface Aviso {
  tipo: 'presupuesto' | 'meta' | 'prestamo';
  ref_id: string;
  clave_dedupe: string;
  title: string;
  body: string;
  url: string;
}

function periodoMes(hoy: Date): string {
  const y = hoy.getUTCFullYear();
  const m = String(hoy.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export interface PresupuestoRow {
  id: string; categoria_id: string; monto_limite: number; categoria_nombre: string;
}
export function detectarPresupuestos(
  presupuestos: PresupuestoRow[], gastoPorCat: Map<string, number>, hoy: Date,
): Aviso[] {
  const mes = periodoMes(hoy);
  const out: Aviso[] = [];
  for (const p of presupuestos) {
    const gasto = gastoPorCat.get(p.categoria_id) || 0;
    if (gasto >= p.monto_limite) {
      out.push({
        tipo: 'presupuesto', ref_id: p.id, clave_dedupe: `presupuesto:${p.id}:${mes}`,
        title: 'Presupuesto superado',
        body: `Te pasaste del límite en ${p.categoria_nombre}.`,
        url: '/#/configuracion',
      });
    }
  }
  return out;
}

export interface MetaRow {
  id: string; nombre: string; estado: string; monto_actual: number; monto_objetivo: number;
}
export function detectarMetas(
  metas: MetaRow[], metasConAporteEsteMes: Set<string>, hoy: Date,
): Aviso[] {
  const mes = periodoMes(hoy);
  const out: Aviso[] = [];
  for (const m of metas) {
    if (m.estado !== 'en_curso') continue;
    if (m.monto_actual >= m.monto_objetivo) continue;
    if (metasConAporteEsteMes.has(m.id)) continue;
    out.push({
      tipo: 'meta', ref_id: m.id, clave_dedupe: `meta:${m.id}:${mes}`,
      title: 'Recordatorio de meta',
      body: `Aún no has aportado a "${m.nombre}" este mes.`,
      url: '/#/metas',
    });
  }
  return out;
}

export interface PrestamoRow {
  id: string; deudor: string; estado: string; fecha: string | null; monto: number | null;
}
function diasEntre(desdeISO: string, hoy: Date): number {
  const d = new Date(desdeISO + 'T00:00:00Z').getTime();
  return Math.floor((hoy.getTime() - d) / (1000 * 60 * 60 * 24));
}
export function detectarPrestamos(prestamos: PrestamoRow[], hoy: Date): Aviso[] {
  const mes = periodoMes(hoy);
  const out: Aviso[] = [];
  for (const p of prestamos) {
    if (p.estado !== 'pendiente' || !p.fecha) continue;
    const dias = diasEntre(p.fecha, hoy);
    if (dias > 30) {
      out.push({
        tipo: 'prestamo', ref_id: p.id, clave_dedupe: `prestamo:${p.id}:${mes}`,
        title: 'Préstamo pendiente',
        body: `El préstamo a ${p.deudor} lleva ${dias} días pendiente.`,
        url: '/#/prestamos',
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Ejecutar el test para verificar que pasa**

Run: `deno test supabase/functions/enviar-notificaciones/detectors.test.ts`
Expected: PASS — `ok | 7 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/enviar-notificaciones/detectors.ts supabase/functions/enviar-notificaciones/detectors.test.ts
git commit -m "feat(fase6): detectores puros + tests deno (presupuesto/meta/préstamo)"
```

---

## Task 9: Orquestación de la Edge Function `index.ts`

**Files:**
- Create: `supabase/functions/enviar-notificaciones/index.ts`

- [ ] **Step 1: Implementar `index.ts`**

```typescript
// supabase/functions/enviar-notificaciones/index.ts
// Edge Function (Deno). Invocada por pg_cron a diario. Evalúa los 3 disparadores,
// deduplica vía notificaciones_log y envía con web-push. Usa service-role.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import {
  detectarPresupuestos, detectarMetas, detectarPrestamos, type Aviso,
} from './detectors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

function mesActual(hoy: Date): { desde: string; hasta: string } {
  const y = hoy.getUTCFullYear(), m = hoy.getUTCMonth();
  const p = (n: number) => String(n).padStart(2, '0');
  const desde = `${y}-${p(m + 1)}-01`;
  const finMes = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const hasta = `${y}-${p(m + 1)}-${p(finMes)}`;
  return { desde, hasta };
}

Deno.serve(async () => {
  const db = createClient(SUPABASE_URL, SERVICE_ROLE);
  const hoy = new Date();
  const { desde, hasta } = mesActual(hoy);

  // Usuarios con al menos una suscripción activa.
  const { data: subs } = await db.from('push_subscriptions').select('*');
  const userIds = [...new Set((subs || []).map((s) => s.user_id))];
  const subsPorUser = new Map<string, typeof subs>();
  for (const s of (subs || [])) {
    const arr = subsPorUser.get(s.user_id) || [];
    arr.push(s); subsPorUser.set(s.user_id, arr);
  }

  let enviadas = 0;
  for (const userId of userIds) {
    try {
      const avisos = await evaluarUsuario(db, userId, hoy, desde, hasta);
      for (const aviso of avisos) {
        // Candado idempotente: si ya existe la clave, saltar.
        const { error: lockErr } = await db.from('notificaciones_log').insert({
          user_id: userId, tipo: aviso.tipo, ref_id: aviso.ref_id, clave_dedupe: aviso.clave_dedupe,
        });
        if (lockErr) continue; // unique_violation => ya enviado
        await enviarAUsuario(db, subsPorUser.get(userId) || [], aviso);
        enviadas++;
      }
    } catch (e) {
      console.error(`usuario ${userId} falló:`, e instanceof Error ? e.message : e);
    }
  }
  return new Response(JSON.stringify({ ok: true, enviadas }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

async function evaluarUsuario(
  db: ReturnType<typeof createClient>, userId: string, hoy: Date, desde: string, hasta: string,
): Promise<Aviso[]> {
  // Presupuestos + gasto del mes por categoría.
  const { data: presup } = await db
    .from('presupuestos')
    .select('id, categoria_id, monto_limite, categorias(nombre)')
    .eq('user_id', userId);
  const { data: gastos } = await db
    .from('transacciones')
    .select('categoria_id, monto')
    .eq('user_id', userId).eq('tipo', 'gasto').gte('fecha', desde).lte('fecha', hasta);
  const gastoPorCat = new Map<string, number>();
  for (const g of (gastos || [])) {
    gastoPorCat.set(g.categoria_id, (gastoPorCat.get(g.categoria_id) || 0) + Number(g.monto));
  }
  const presupuestos = (presup || []).map((p) => ({
    id: p.id, categoria_id: p.categoria_id, monto_limite: Number(p.monto_limite),
    categoria_nombre: (p.categorias && (p.categorias as { nombre: string }).nombre) || 'una categoría',
  }));

  // Metas + qué metas tienen aporte este mes.
  const { data: metas } = await db
    .from('metas').select('id, nombre, estado, monto_actual, monto_objetivo').eq('user_id', userId);
  const { data: aportes } = await db
    .from('aportes_meta').select('meta_id').eq('user_id', userId).gte('created_at', desde + 'T00:00:00Z');
  const conAporte = new Set<string>((aportes || []).map((a) => a.meta_id));
  const metasRows = (metas || []).map((m) => ({
    id: m.id, nombre: m.nombre, estado: m.estado,
    monto_actual: Number(m.monto_actual), monto_objetivo: Number(m.monto_objetivo),
  }));

  // Préstamos pendientes + fecha de la transacción.
  const { data: prest } = await db
    .from('prestamos').select('id, deudor, estado, transacciones(fecha, monto)').eq('user_id', userId);
  const prestamosRows = (prest || []).map((p) => ({
    id: p.id, deudor: p.deudor, estado: p.estado,
    fecha: (p.transacciones as { fecha: string } | null)?.fecha ?? null,
    monto: (p.transacciones as { monto: number } | null)?.monto ?? null,
  }));

  return [
    ...detectarPresupuestos(presupuestos, gastoPorCat, hoy),
    ...detectarMetas(metasRows, conAporte, hoy),
    ...detectarPrestamos(prestamosRows, hoy),
  ];
}

async function enviarAUsuario(
  db: ReturnType<typeof createClient>,
  subs: Array<{ endpoint: string; p256dh: string; auth: string }>,
  aviso: Aviso,
) {
  const payload = JSON.stringify({ title: aviso.title, body: aviso.body, url: aviso.url });
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload,
      );
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) {
        await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      } else {
        console.error('sendNotification falló:', status, e instanceof Error ? e.message : e);
      }
    }
  }
}
```

- [ ] **Step 2: Desplegar la función**

Desde el dashboard de Supabase (Edge Functions → Deploy) o, con CLI instalado:
`supabase functions deploy enviar-notificaciones --project-ref ombnhxueclqfeyjzhroz`.
Expected: la función `enviar-notificaciones` aparece como deployed. `SUPABASE_URL` y
`SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase automáticamente; los `VAPID_*` se
definieron en Task 3 Step 3.

- [ ] **Step 3: Invocar manualmente y verificar respuesta**

Invocar la función (dashboard → Invoke, o `curl` con header `Authorization: Bearer <anon o service>`).
Expected: HTTP 200 con cuerpo `{"ok":true,"enviadas":N}`. Con datos de prueba sembrados
(un presupuesto superado y una suscripción real), `N >= 1` y llega una notificación al navegador.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/enviar-notificaciones/index.ts
git commit -m "feat(fase6): Edge Function enviar-notificaciones (query + dedupe + web-push)"
```

---

## Task 10: Programar el cron diario

**Files:**
- Create: `supabase/migrations/20260623_cron_notificaciones.sql`

- [ ] **Step 1: Escribir la migración del cron**

```sql
-- =====================================================================
-- Nestra — Migración: cron diario de notificaciones push (FASE 6)
-- ---------------------------------------------------------------------
-- Habilita pg_cron + pg_net y agenda la invocación diaria (08:00 UTC)
-- de la Edge Function enviar-notificaciones. Idempotente.
-- Reemplazar <PROJECT_REF> y <SERVICE_ROLE_KEY> antes de aplicar.
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Quitar el job si ya existía (re-ejecución idempotente).
select cron.unschedule('enviar-notificaciones-diario')
where exists (select 1 from cron.job where jobname = 'enviar-notificaciones-diario');

select cron.schedule(
  'enviar-notificaciones-diario',
  '0 8 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/enviar-notificaciones',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 2: Aplicar la migración**

Reemplazar `<PROJECT_REF>` por `ombnhxueclqfeyjzhroz` y `<SERVICE_ROLE_KEY>` por el service-role
key del proyecto v2 (Project Settings → API). Aplicar vía MCP `apply_migration` name
`20260623_cron_notificaciones`.

> Seguridad: el service-role key queda dentro de la definición del cron job en la DB
> (no en git: la migración versionada lleva el placeholder). Alternativa más segura si se
> desea: usar Supabase Vault y leer la clave con `vault.decrypted_secrets`.

- [ ] **Step 3: Verificar que el job quedó agendado**

MCP `execute_sql`:
```sql
select jobname, schedule, active from cron.job where jobname = 'enviar-notificaciones-diario';
```
Expected: una fila — `enviar-notificaciones-diario | 0 8 * * * | t`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260623_cron_notificaciones.sql
git commit -m "feat(fase6): cron diario que invoca la Edge Function de notificaciones"
```

---

## Task 11: Verificación E2E manual y cierre

**Files:** ninguno (verificación).

- [ ] **Step 1: Sembrar datos de prueba**

Con la cuenta de prueba ([[nestra-v2-test-account]]): crear un presupuesto con `monto_limite`
bajo y una transacción `gasto` de esa categoría que lo supere.

- [ ] **Step 2: Suscribirse en un navegador real**

Abrir la PWA (Chrome desktop/Android — iOS requiere instalarla, iOS 16.4+). Ir a Configuración
→ activar "Notificaciones push" → aceptar el permiso. Confirmar (MCP `execute_sql`) que
`select count(*) from push_subscriptions` aumentó en 1.

- [ ] **Step 3: Invocar la función y confirmar la notificación**

Invocar `enviar-notificaciones` manualmente. Expected: llega una notificación "Presupuesto
superado"; al tocarla, abre Nestra en Configuración. `select count(*) from notificaciones_log`
muestra la fila con `clave_dedupe = presupuesto:<id>:<YYYY-MM>`.

- [ ] **Step 4: Confirmar la deduplicación**

Invocar la función una segunda vez. Expected: respuesta `{"ok":true,"enviadas":0}` (la clave
ya existe en `notificaciones_log`); no llega una segunda notificación.

- [ ] **Step 5: Confirmar limpieza de suscripción muerta**

Desuscribir desde el navegador (toggle off) o borrar la suscripción del navegador, luego
invocar la función. Expected: ningún error fatal; si el endpoint quedó muerto, la fila se
borra de `push_subscriptions` al recibir 410/404.

---

## Self-Review

**Cobertura del spec:**
- push_subscriptions + notificaciones_log + RLS → Task 1. ✓
- SW push/notificationclick → Task 4. ✓
- Cliente subscribe/unsubscribe + prompt contextual → Tasks 5–7. ✓
- Toggle manual en config → Task 6. ✓
- Edge Function 3 detectores + dedupe + cleanup 410 → Tasks 8–9. ✓
- pg_cron diario → Task 10. ✓
- VAPID keys + secrets → Task 3. ✓
- E2E → Task 11. ✓

**Consistencia de tipos:** `Aviso` (tipo/ref_id/clave_dedupe/title/body/url) definido en
Task 8, usado idéntico en Task 9. Funciones cliente (`pushSupported`, `pushSubscribe`,
`pushUnsubscribe`, `pushIsSubscribed`, `pushOfrecerContextual`) definidas en Task 5, usadas
con la misma firma en Tasks 6–7. `clave_dedupe` con formato `tipo:id:YYYY-MM` consistente
entre detectores y la verificación E2E.

**Notas de entorno:** sin `deno`/`supabase` CLI en PATH → migraciones vía MCP `apply_migration`,
funciones vía dashboard (o instalar CLI). Tests de detectores requieren `deno` (lógica pura,
portable a Node si hace falta).
