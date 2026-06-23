# Fase 6 — Notificaciones Push (Web Push)

**Fecha:** 2026-06-23
**Estado:** Diseño aprobado, pendiente plan de implementación
**Depende de:** Fase 1 (PWA + Service Worker ya en producción)

## Objetivo

Enviar notificaciones push a los usuarios de Nestra v2 (PWA vanilla, sin build) usando
la **Web Push API** con claves **VAPID** y una **Supabase Edge Function** disparada por
`pg_cron` diario. Tres disparadores: presupuesto sobre su límite, recordatorio de aporte
a meta, y préstamo pendiente de cobro/pago.

El permiso de notificación se pide en un **momento contextual** (tras crear el primer
presupuesto/meta/préstamo), nunca al abrir la app. Toggle manual de respaldo en config.

## Decisiones tomadas

1. **Evaluación server-side por cron diario.** La Edge Function consulta la DB y decide
   qué enviar. Única fuente de verdad, funciona aunque la app nunca se abra, no duplica
   la lógica de presupuesto del cliente ni depende de eventos del cliente (offline-first).
2. **Permiso contextual por disparador + toggle en config.** Se pide permiso justo después
   de la primera acción relacionada con cada disparador; además un interruptor manual
   "Activar notificaciones" en la vista de configuración.
3. **Librería de envío:** `npm:web-push` dentro de la Edge Function (Deno soporta el
   especificador `npm:`; Deno hace polyfill de `node:crypto`). Fallback documentado:
   `jsr:@negrel/webpush` (Deno puro) si el polyfill diera problemas.
4. **Anti-spam:** tabla `notificaciones_log` con clave de deduplicación por periodo. No se
   reenvía el mismo aviso dos veces en el mismo periodo.

## Arquitectura

```
[Cliente PWA]                      [Supabase]                         [Push service]
  push.js                            push_subscriptions  (RLS)         (FCM / Mozilla / …)
   ├─ pide permiso (contextual)      notificaciones_log
   ├─ pushManager.subscribe(VAPID)
   └─ upsert subscription ───────────►
                                      pg_cron (diario 08:00)
                                        └─ net.http_post ──► Edge Function `enviar-notificaciones`
                                                               ├─ service-role client
                                                               ├─ evalúa 3 disparadores
                                                               ├─ dedupe vs notificaciones_log
                                                               └─ web-push.sendNotification ──► [push service] ──► SW push event
  sw.js
   ├─ 'push'           → showNotification(title, body, icon, data.url)
   └─ 'notificationclick' → focus/open app en data.url
```

## Componentes

### 1. Migraciones DB

**`push_subscriptions`**
| col | tipo | notas |
|-----|------|-------|
| `id` | uuid pk default gen_random_uuid() | |
| `user_id` | uuid not null | FK `auth.users(id)` on delete cascade |
| `endpoint` | text not null unique | identidad de la suscripción |
| `p256dh` | text not null | clave pública del cliente |
| `auth` | text not null | secreto auth del cliente |
| `user_agent` | text | diagnóstico/limpieza |
| `created_at` | timestamptz default now() | |

RLS: el usuario hace `select/insert/update/delete` solo de sus filas
(`user_id = auth.uid()`). La Edge Function usa service-role (salta RLS).

**`notificaciones_log`**
| col | tipo | notas |
|-----|------|-------|
| `id` | uuid pk | |
| `user_id` | uuid not null | |
| `tipo` | text not null | `presupuesto` \| `meta` \| `prestamo` |
| `ref_id` | uuid | id del presupuesto/meta/préstamo |
| `clave_dedupe` | text not null | p.ej. `presupuesto:<id>:2026-06` |
| `enviada_at` | timestamptz default now() | |

Índice único en (`user_id`, `clave_dedupe`). Insert sirve de candado: si ya existe, no
se reenvía.

### 2. Service Worker (`sw.js`)

Añadir dos listeners (no rompen el precache existente; subir `SHELL_VERSION` a `v5`):

```js
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || 'Nestra', {
    body: data.body || '',
    icon: 'assets/icon-192.png',
    badge: 'assets/icon-192.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((cs) => {
      const c = cs.find((w) => 'focus' in w);
      if (c) { c.focus(); c.navigate(url); return; }
      return self.clients.openWindow(url);
    }));
});
```

### 3. Cliente (`js/push.js`, nuevo, precacheado por sw)

- `VAPID_PUBLIC_KEY` — constante (clave pública, no secreta) en `js/config.js`.
- `urlBase64ToUint8Array(base64)` — helper para `applicationServerKey`.
- `pushSupported()` — `'serviceWorker' in navigator && 'PushManager' in window`.
- `async pushSubscribe()`:
  1. si no soportado → return.
  2. `Notification.requestPermission()`; si `!== 'granted'` → return.
  3. `reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.
  4. `upsert` en `push_subscriptions` (onConflict `endpoint`) con `user_id` actual.
- `async pushUnsubscribe()` — `subscription.unsubscribe()` + delete por endpoint.
- **Disparo contextual:** en los flujos de guardado de presupuesto / meta / préstamo,
  la **primera vez** que el usuario crea uno (y aún `Notification.permission === 'default'`),
  mostrar un mini-prompt propio ("¿Te aviso si te pasas del límite?" / "¿Te recuerdo
  aportar?" / "¿Te aviso cuando toque cobrar/pagar?") con botón que llama `pushSubscribe()`.
  Guardar bandera `localStorage` para no repetir el ofrecimiento por disparador.
- **Toggle manual:** en la vista de configuración, interruptor "Activar notificaciones"
  → `pushSubscribe()` / `pushUnsubscribe()`. Refleja el estado real de la suscripción.

### 4. Edge Function `enviar-notificaciones`

`supabase/functions/enviar-notificaciones/index.ts` (Deno). Cliente service-role.
`web-push` configurado con `setVapidDetails(subject, VAPID_PUBLIC, VAPID_PRIVATE)` desde
secrets. Lógica:

Para cada usuario con suscripciones activas, evaluar (consultas SQL/RPC):

- **presupuesto:** por cada `presupuesto` del usuario, sumar `transacciones` (gasto) de la
  categoría en el periodo actual (mes para `periodo='mensual'`); si `gasto >= monto_limite`
  → candidato. `clave_dedupe = presupuesto:<id>:<YYYY-MM>`.
- **meta:** por cada `meta` con `estado` activo y `monto_actual < monto_objetivo`, si **no
  hubo `aportes_meta` en el mes actual** → recordatorio. `clave_dedupe = meta:<id>:<YYYY-MM>`.
- **prestamo:** por cada `prestamo` con `estado` pendiente y `fecha_devolucion <= hoy + 3d`
  → aviso de cobro/pago. `clave_dedupe = prestamo:<id>:<fecha_devolucion>`.

Por cada candidato:
1. `insert` en `notificaciones_log` con `clave_dedupe`; si viola el único → ya enviado, skip.
2. `web-push.sendNotification(sub, JSON.stringify({title, body, url}))` a cada suscripción
   del usuario.
3. Si la respuesta es `410`/`404` → `delete` de esa fila de `push_subscriptions`.

> **Nota de planificación:** confirmar columnas de `transacciones` (categoria_id, monto,
> fecha, tipo, user_id) y la semántica exacta de `presupuestos.periodo` y de
> `prestamos.estado` al escribir el plan; el gasto y los filtros dependen de ello.

### 5. Programación (`pg_cron`)

Migración que habilita `pg_cron` + `pg_net` y agenda:

```sql
select cron.schedule('enviar-notificaciones-diario', '0 8 * * *', $$
  select net.http_post(
    url := '<project-url>/functions/v1/enviar-notificaciones',
    headers := jsonb_build_object('Authorization', 'Bearer <service-role-or-cron-secret>',
                                  'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
$$);
```

Sin columna de timezone por usuario → hora fija única (08:00 del servidor). Mejora futura:
hora por usuario. Fuera de alcance ahora (YAGNI).

### 6. Claves VAPID

- Generar **una vez** (`web-push generate-vapid-keys`).
- Pública → `VAPID_PUBLIC_KEY` en `js/config.js` (no secreta).
- Privada + `VAPID_SUBJECT` (mailto:) → **secrets de la Edge Function**
  (`supabase secrets set`). Nunca en el cliente ni en git.

## Flujo de datos

1. Usuario crea su primer presupuesto → mini-prompt → `pushSubscribe()` → fila en
   `push_subscriptions`.
2. Cron 08:00 → Edge Function → evalúa, dedupe, envía.
3. Push service entrega → SW `push` → `showNotification`.
4. Tap → `notificationclick` → abre/enfoca Nestra en la vista relevante.

## Manejo de errores

- Permiso denegado: silencioso, no insistir; el toggle de config permite reintentar.
- Suscripción caduca (`410`/`404` al enviar): borrar fila, no reintentar.
- Edge Function falla por usuario: capturar por-usuario, continuar con el resto; loguear.
- `notificaciones_log` insert como candado idempotente evita duplicados aunque el cron corra dos veces.
- iOS: push solo funciona en PWA instalada (iOS 16.4+); `pushSupported()` lo cubre al
  comprobar `PushManager`. Coherente con [[nestra-v2-pwa-offline]] (iOS sin Background Sync).

## Pruebas

- **DB:** RLS de `push_subscriptions` (usuario A no ve filas de B); unicidad de `endpoint`
  y de (`user_id`,`clave_dedupe`).
- **SW:** simular `push` event con payload → `showNotification` llamado con título/cuerpo;
  `notificationclick` enfoca/abre la URL.
- **Cliente:** `pushSubscribe` con permiso concedido/denegado; upsert idempotente por endpoint.
- **Edge Function:** unit de cada detector (presupuesto sobre/bajo límite, meta con/sin
  aporte del mes, préstamo dentro/fuera de ventana); dedupe (segundo run no reenvía);
  limpieza en `410`.
- **E2E manual:** suscribir en navegador real, invocar la función a mano, confirmar
  notificación recibida y tap abre la vista correcta.

## Fuera de alcance (YAGNI)

- Hora de envío por usuario / timezone.
- Disparo en tiempo real al cruzar el presupuesto (event-driven).
- Preferencias granulares por tipo de notificación.
- Notificaciones agrupadas o ricas (imágenes, acciones).
