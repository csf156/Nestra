# Nestra Fase 1 — PWA Instalable Offline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir Nestra v2 en una PWA instalable que funcione offline como app nativa iOS: app shell cacheado, espejo local en IndexedDB, alta offline en cola con sincronización automática al reconectar, banner offline y prompt de instalación propios.

**Architecture:** App estática vanilla (sin build step), SPA hash-based. Todas las escrituras y lecturas pasan por `js/db.js` → ese es el único punto de intercepción para offline. Service Worker con Workbox (vendorizado, cargado por `importScripts`) cachea el app shell (cache-first) y las llamadas REST a Supabase (network-first con fallback a cache). Una capa IndexedDB (`idb` vendorizado) espeja transacciones/categorías/metas/préstamos y aloja una **outbox** de operaciones pendientes con UUID generado en cliente. El motor de sync corre **en la página** (no en el SW, porque el JWT de Supabase vive en `localStorage` del documento), disparado por eventos `online`/`visibilitychange`/carga; Background Sync del SW es una mejora progresiva solo en Chrome/Android (iOS Safari no soporta `SyncManager`). Resolución de conflictos: **last-write-wins por `updated_at`** (columna + trigger nuevos en el schema).

**Tech Stack:** HTML/CSS/JS vanilla (globals, sin módulos), Supabase JS 2.x (CDN), Workbox 7 (vendorizado), idb 8 (vendorizado), IndexedDB, Service Worker API, Web App Manifest, Python+Pillow (generación de iconos), Node (vendorizado de deps + test unitario del comparador LWW).

---

## Alcance y decisiones (confirmadas con el usuario)

- **Conflictos:** migración añade `updated_at` + trigger a `transacciones`, `categorias`, `metas`, `prestamos`. LWW por `updated_at`.
- **Escritura offline:** alta (insert) de **transacciones, metas y préstamos**. Ediciones/borrados offline NO entran en Fase 1 (requieren conexión). Aporte al hogar (`insertAporteHogar`) y aporte directo (`insertAporteDirecto`) NO funcionan offline porque dependen de RPC server-side — la UI debe avisar "requiere conexión".
- **Lectura offline:** espejo en IndexedDB de las 4 entidades + cache de respuestas REST por Workbox.
- **Deps:** Workbox e idb vendorizados en `js/vendor/` (funcionan 100% offline, sin depender del CDN en frío).
- **Sync:** corre en la página. iOS-compatible vía `online`/`visibilitychange`. Background Sync = mejora progresiva.

## Estructura de archivos

**Crear:**
- `manifest.json` — Web App Manifest.
- `sw.js` — Service Worker (Workbox).
- `assets/icon-192.png`, `assets/icon-512.png`, `assets/icon-maskable-512.png` — iconos PWA.
- `js/vendor/idb-umd.js` — idb 8 UMD (global `idb`).
- `js/vendor/workbox/*.prod.js` — runtime Workbox 7 vendorizado.
- `js/nestra-db.js` — capa IndexedDB (stores espejo + outbox + helpers).
- `js/sync-lww.js` — comparador LWW puro (testeable en Node y navegador).
- `js/sync.js` — motor de sync de la outbox + badge + listeners online/visibility/SW.
- `js/pwa.js` — registro del SW + prompt de instalación custom + hint iOS.
- `supabase/migrations/20260621_updated_at_lww.sql` — migración.
- `test/sync-lww.test.mjs` — test unitario del comparador LWW (Node).
- `scripts/gen-icons.py` — generador de iconos (Pillow).

**Modificar:**
- `index.html` — meta tags iOS, link manifest, iconos, banner offline + badge DOM, cargar `js/vendor/idb-umd.js`, `js/nestra-db.js`, `js/sync-lww.js`, `js/sync.js`, `js/pwa.js`.
- `js/db.js` — espejo en lecturas + intercepción de escrituras a outbox cuando offline.
- `css/components.css` — estilos del banner offline, badge pendiente, prompt de instalación.
- `supabase/schema_v2_fresh.sql` — reflejar `updated_at` + trigger en la fuente de verdad.

---

## Task 0: Vendorizar Workbox e idb

**Files:**
- Create: `js/vendor/idb-umd.js`
- Create: `js/vendor/workbox/workbox-core.prod.js`
- Create: `js/vendor/workbox/workbox-routing.prod.js`
- Create: `js/vendor/workbox/workbox-strategies.prod.js`
- Create: `js/vendor/workbox/workbox-precaching.prod.js`
- Create: `js/vendor/workbox/workbox-expiration.prod.js`
- Create: `js/vendor/workbox/workbox-cacheable-response.prod.js`
- Create: `js/vendor/workbox/workbox-background-sync.prod.js`

- [ ] **Step 1: Descargar idb UMD y los módulos prod de Workbox 7**

Run (Git Bash):
```bash
cd "C:/Users/csf93/Desktop/Nestra/..Nestra-v2"
mkdir -p js/vendor/workbox
curl -fsSL https://cdn.jsdelivr.net/npm/idb@8.0.0/build/umd.js -o js/vendor/idb-umd.js
WB=https://storage.googleapis.com/workbox-cdn/releases/7.3.0
for m in core routing strategies precaching expiration cacheable-response background-sync; do
  curl -fsSL "$WB/workbox-$m.prod.js" -o "js/vendor/workbox/workbox-$m.prod.js"
done
```

- [ ] **Step 2: Verificar que los archivos existen y no están vacíos**

Run:
```bash
cd "C:/Users/csf93/Desktop/Nestra/..Nestra-v2"
ls -l js/vendor/idb-umd.js js/vendor/workbox/*.prod.js
head -c 60 js/vendor/idb-umd.js; echo
```
Expected: 8 archivos listados con tamaño > 1 KB cada uno. `idb-umd.js` empieza con algo tipo `(function(global,factory)` (UMD). Si algún archivo pesa < 500 bytes, la descarga falló — reintentar.

- [ ] **Step 3: Verificar que idb expone el global `idb`**

Run:
```bash
cd "C:/Users/csf93/Desktop/Nestra/..Nestra-v2"
grep -c "openDB" js/vendor/idb-umd.js
grep -c "workbox" js/vendor/workbox/workbox-core.prod.js
```
Expected: ambos `grep -c` devuelven un número ≥ 1.

- [ ] **Step 4: Commit**

```bash
git add js/vendor/
git commit -m "chore(pwa): vendor Workbox 7 runtime and idb 8 UMD"
```

---

## Task 1: Migración LWW — columna `updated_at` + trigger

**Files:**
- Create: `supabase/migrations/20260621_updated_at_lww.sql`
- Modify: `supabase/schema_v2_fresh.sql` (reflejar el end-state)

**Contexto:** Ninguna tabla tiene `updated_at`. LWW lo necesita. El trigger lo mantiene en cada UPDATE; el DEFAULT lo fija en INSERT. `categorias`/`metas`/`prestamos` tampoco tienen `created_at`, pero para Fase 1 solo necesitamos `updated_at`.

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/20260621_updated_at_lww.sql`:
```sql
-- Fase 1 PWA — LWW: updated_at + trigger en las tablas espejadas offline.
-- Idempotente: usa add column if not exists y create or replace.

-- 1. Columnas updated_at (default now() cubre INSERT y filas existentes).
alter table public.transacciones add column if not exists updated_at timestamptz not null default now();
alter table public.categorias   add column if not exists updated_at timestamptz not null default now();
alter table public.metas        add column if not exists updated_at timestamptz not null default now();
alter table public.prestamos    add column if not exists updated_at timestamptz not null default now();

-- 2. Función trigger compartida: sella updated_at en cada UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 3. Triggers por tabla (drop+create para reaplicar sin error).
drop trigger if exists trg_transacciones_updated_at on public.transacciones;
create trigger trg_transacciones_updated_at
  before update on public.transacciones
  for each row execute function public.set_updated_at();

drop trigger if exists trg_categorias_updated_at on public.categorias;
create trigger trg_categorias_updated_at
  before update on public.categorias
  for each row execute function public.set_updated_at();

drop trigger if exists trg_metas_updated_at on public.metas;
create trigger trg_metas_updated_at
  before update on public.metas
  for each row execute function public.set_updated_at();

drop trigger if exists trg_prestamos_updated_at on public.prestamos;
create trigger trg_prestamos_updated_at
  before update on public.prestamos
  for each row execute function public.set_updated_at();
```

- [ ] **Step 2: Aplicar la migración a la instancia v2 vía Supabase MCP**

Usar la herramienta `mcp__supabase__apply_migration` con:
- `name`: `20260621_updated_at_lww`
- `query`: el contenido completo del SQL del Step 1.

(La instancia v2 es `ombnhxueclqfeyjzhroz`, la que el MCP tiene configurada. NO tocar producción v1.)

- [ ] **Step 3: Verificar que las columnas existen**

Usar `mcp__supabase__execute_sql` con:
```sql
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and column_name = 'updated_at'
  and table_name in ('transacciones','categorias','metas','prestamos')
order by table_name;
```
Expected: 4 filas, una por tabla.

- [ ] **Step 4: Verificar que el trigger sella updated_at en UPDATE**

Usar `mcp__supabase__execute_sql`:
```sql
select tgname, tgrelid::regclass as tabla
from pg_trigger
where tgname like 'trg_%_updated_at'
order by tabla;
```
Expected: 4 triggers, uno por tabla.

- [ ] **Step 5: Reflejar el end-state en `schema_v2_fresh.sql`**

En `supabase/schema_v2_fresh.sql`, añadir `updated_at timestamptz not null default now()` a las definiciones `create table` de `transacciones` (tras `created_at`), `categorias` (tras `estado`), `metas` (tras `categoria_id`) y `prestamos` (tras `fecha_devolucion`). Tras el bloque de tablas (antes de la sección 2 ÍNDICES), añadir la función `set_updated_at()` y los 4 triggers (copiar tal cual del Step 1). Esto mantiene el archivo como fuente de verdad reproducible en una instancia nueva.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260621_updated_at_lww.sql supabase/schema_v2_fresh.sql
git commit -m "feat(db): add updated_at + trigger for LWW conflict resolution"
```

---

## Task 2: Manifest, iconos y meta tags iOS

**Files:**
- Create: `scripts/gen-icons.py`
- Create: `assets/icon-192.png`, `assets/icon-512.png`, `assets/icon-maskable-512.png`
- Create: `manifest.json`
- Modify: `index.html:5-8` (head: meta iOS + link manifest + iconos)

- [ ] **Step 1: Escribir el generador de iconos**

Crear `scripts/gen-icons.py`:
```python
# Genera los iconos PWA a partir de assets/nestra_logo.png con Pillow.
# - icon-192 / icon-512: logo centrado sobre fondo blanco (any).
# - icon-maskable-512: logo en el safe zone (80%) sobre fondo de marca (maskable).
from PIL import Image
import os

SRC = "assets/nestra_logo.png"
BG = (255, 255, 255, 255)          # fondo "any"
BG_MASK = (255, 255, 255, 255)     # fondo maskable (cambiar a color de marca si se desea)

def make(out, size, pad_ratio, bg):
    base = Image.new("RGBA", (size, size), bg)
    logo = Image.open(SRC).convert("RGBA")
    box = int(size * pad_ratio)
    w, h = logo.size
    scale = min(box / w, box / h)
    logo = logo.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    x = (size - logo.size[0]) // 2
    y = (size - logo.size[1]) // 2
    base.alpha_composite(logo, (x, y))
    base.convert("RGB").save(out, "PNG")
    print("wrote", out)

if __name__ == "__main__":
    os.makedirs("assets", exist_ok=True)
    make("assets/icon-192.png", 192, 0.72, BG)
    make("assets/icon-512.png", 512, 0.72, BG)
    # maskable: contenido dentro del safe zone (~80% diámetro → pad 0.6 lado)
    make("assets/icon-maskable-512.png", 512, 0.6, BG_MASK)
```

- [ ] **Step 2: Generar los iconos y verificar dimensiones**

Run:
```bash
cd "C:/Users/csf93/Desktop/Nestra/..Nestra-v2"
python scripts/gen-icons.py
python -c "from PIL import Image; [print(p, Image.open(p).size) for p in ['assets/icon-192.png','assets/icon-512.png','assets/icon-maskable-512.png']]"
```
Expected:
```
assets/icon-192.png (192, 192)
assets/icon-512.png (512, 512)
assets/icon-maskable-512.png (512, 512)
```

- [ ] **Step 3: Escribir `manifest.json`**

Crear `manifest.json` en la raíz:
```json
{
  "name": "Nestra — Gestor de Finanzas",
  "short_name": "Nestra",
  "description": "Gestor de finanzas personales y del hogar.",
  "lang": "es",
  "dir": "ltr",
  "start_url": "/#dashboard",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "icons": [
    { "src": "assets/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "assets/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "assets/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 4: Añadir link al manifest, meta tags iOS e iconos en `index.html`**

En `index.html`, reemplazar las líneas 7-8 (los dos links de icon/apple-touch-icon actuales) por:
```html
    <link rel="icon" type="image/png" href="assets/nestra_logo.png">
    <link rel="manifest" href="manifest.json">
    <meta name="theme-color" content="#ffffff">

    <!-- iOS PWA -->
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="apple-mobile-web-app-title" content="Nestra">
    <link rel="apple-touch-icon" href="assets/icon-192.png">
    <link rel="apple-touch-icon" sizes="512x512" href="assets/icon-512.png">
```

- [ ] **Step 5: Verificar manifest e iconos en el preview**

- `preview_start` (servidor estático en la raíz del proyecto).
- `preview_eval`:
```js
(async () => {
  const m = await fetch('/manifest.json').then(r => r.json());
  const i192 = (await fetch('/assets/icon-192.png')).status;
  const i512 = (await fetch('/assets/icon-512.png')).status;
  return { name: m.name, start_url: m.start_url, display: m.display, icons: m.icons.length, i192, i512 };
})()
```
Expected: `{ name: "Nestra — Gestor de Finanzas", start_url: "/#dashboard", display: "standalone", icons: 3, i192: 200, i512: 200 }`.
- `preview_eval` para meta iOS:
```js
({
  manifest: !!document.querySelector('link[rel=manifest]'),
  iosCapable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content,
  appleIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')
})
```
Expected: `{ manifest: true, iosCapable: "yes", appleIcon: "assets/icon-192.png" }`.

- [ ] **Step 6: Commit**

```bash
git add scripts/gen-icons.py assets/icon-192.png assets/icon-512.png assets/icon-maskable-512.png manifest.json index.html
git commit -m "feat(pwa): add web app manifest, PWA icons and iOS meta tags"
```

---

## Task 3: Service Worker con Workbox (app shell + Supabase)

**Files:**
- Create: `sw.js`
- Modify: `index.html` (cargar `js/pwa.js` al final del `<body>` — creado en Task 9; aquí solo registramos el SW inline temporalmente o adelantamos un registro mínimo)

**Nota de estrategia (no-build):** Workbox se carga con `importScripts` de los módulos vendorizados (Task 0). No usamos `self.__WB_MANIFEST` (eso requiere build): la precache list es manual. Supabase REST = network-first con fallback a cache. El SW vive en la raíz para tener scope `/`.

- [ ] **Step 1: Escribir `sw.js`**

Crear `sw.js` en la raíz:
```js
/* Nestra Service Worker — Workbox 7 (vendorizado, sin build) */
importScripts(
  'js/vendor/workbox/workbox-core.prod.js',
  'js/vendor/workbox/workbox-strategies.prod.js',
  'js/vendor/workbox/workbox-routing.prod.js',
  'js/vendor/workbox/workbox-precaching.prod.js',
  'js/vendor/workbox/workbox-expiration.prod.js',
  'js/vendor/workbox/workbox-cacheable-response.prod.js'
);

const { precaching, routing, strategies, expiration, cacheableResponse, core } = workbox;
core.setCacheNameDetails({ prefix: 'nestra' });

// Sube esta versión cuando cambies el app shell para forzar refresco de precache.
const SHELL_VERSION = 'v1';

// App shell precache (manual). revision = versión para invalidar al cambiar.
precaching.precacheAndRoute([
  { url: 'index.html', revision: SHELL_VERSION },
  { url: 'css/base.css', revision: SHELL_VERSION },
  { url: 'css/layout.css', revision: SHELL_VERSION },
  { url: 'css/components.css', revision: SHELL_VERSION },
  { url: 'js/config.js', revision: SHELL_VERSION },
  { url: 'js/supabase.js', revision: SHELL_VERSION },
  { url: 'js/auth.js', revision: SHELL_VERSION },
  { url: 'js/format.js', revision: SHELL_VERSION },
  { url: 'js/iconos.js', revision: SHELL_VERSION },
  { url: 'js/export.js', revision: SHELL_VERSION },
  { url: 'js/db.js', revision: SHELL_VERSION },
  { url: 'js/alerts.js', revision: SHELL_VERSION },
  { url: 'js/router.js', revision: SHELL_VERSION },
  { url: 'js/sidebar.js', revision: SHELL_VERSION },
  { url: 'js/nestra-db.js', revision: SHELL_VERSION },
  { url: 'js/sync-lww.js', revision: SHELL_VERSION },
  { url: 'js/sync.js', revision: SHELL_VERSION },
  { url: 'js/pwa.js', revision: SHELL_VERSION },
  { url: 'js/vendor/idb-umd.js', revision: SHELL_VERSION },
  { url: 'manifest.json', revision: SHELL_VERSION },
  { url: 'assets/nestra_logo.png', revision: SHELL_VERSION },
  { url: 'assets/nestra_logo_dark.png', revision: SHELL_VERSION },
  { url: 'assets/tabler-sprite.svg', revision: SHELL_VERSION },
  { url: 'assets/icon-192.png', revision: SHELL_VERSION },
  { url: 'assets/icon-512.png', revision: SHELL_VERSION },
]);

// Vistas HTML (views/*.html) — el router las hace fetch. Stale-while-revalidate:
// rápidas offline, se refrescan en segundo plano online.
routing.registerRoute(
  ({ url, request }) => request.destination === '' || /\/views\/.*\.html$/.test(url.pathname),
  new strategies.StaleWhileRevalidate({ cacheName: 'nestra-views' })
);
routing.registerRoute(
  ({ url }) => /\/views\/.*\.html$/.test(url.pathname),
  new strategies.StaleWhileRevalidate({ cacheName: 'nestra-views' })
);

// CDNs de terceros usados por el shell (supabase-js, xlsx, chart.js): cache-first.
routing.registerRoute(
  ({ url }) => url.origin === 'https://cdn.jsdelivr.net',
  new strategies.CacheFirst({
    cacheName: 'nestra-cdn',
    plugins: [
      new cacheableResponse.CacheableResponsePlugin({ statuses: [0, 200] }),
      new expiration.ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  })
);

// Supabase REST (lecturas GET): network-first con fallback a cache.
// Solo GET — los POST/PATCH offline los maneja la outbox en la página, no aquí.
routing.registerRoute(
  ({ url, request }) =>
    url.hostname.endsWith('.supabase.co') &&
    url.pathname.startsWith('/rest/') &&
    request.method === 'GET',
  new strategies.NetworkFirst({
    cacheName: 'nestra-supabase-rest',
    networkTimeoutSeconds: 5,
    plugins: [
      new cacheableResponse.CacheableResponsePlugin({ statuses: [0, 200] }),
      new expiration.ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 }),
    ],
  })
);

// Activación inmediata cuando la página lo pide (botón "actualizar").
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
```

- [ ] **Step 2: Registrar el SW (registro mínimo temporal en index.html)**

Al final del `<body>` de `index.html`, justo antes de `</body>`, añadir:
```html
    <script>
      // Registro del Service Worker (PWA). El prompt de instalación y la lógica
      // ampliada llegan en js/pwa.js (Task 9).
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
          navigator.serviceWorker.register('sw.js').then(function (reg) {
            console.log('SW registrado, scope:', reg.scope);
          }).catch(function (err) {
            console.error('SW registro falló:', err);
          });
        });
      }
    </script>
```
(En Task 9 este bloque se mueve/integra en `js/pwa.js`.)

- [ ] **Step 3: Verificar que el SW se activa y precachea el shell**

- `preview_start` (si no corre ya), luego `preview_eval`:
```js
(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const ready = await navigator.serviceWorker.ready;
  const keys = await caches.keys();
  return { hasReg: !!reg, active: !!ready.active, caches: keys };
})()
```
Expected: `hasReg: true`, `active: true`, y `caches` incluye una clave de precache (`nestra-precache-...`) tras recargar una vez.
- `preview_console_logs`: debe aparecer "SW registrado, scope:".

- [ ] **Step 4: Verificar que el app shell carga offline**

- `preview_eval` para simular: recargar dos veces (la 1ª instala, la 2ª sirve desde SW).
```js
window.location.reload()
```
- Tras recargar, comprobar que el shell precacheado responde desde cache:
```js
(async () => {
  const c = await caches.match('index.html');
  const css = await caches.match('css/components.css');
  return { indexCached: !!c, cssCached: !!css };
})()
```
Expected: `{ indexCached: true, cssCached: true }`.

- [ ] **Step 5: Commit**

```bash
git add sw.js index.html
git commit -m "feat(pwa): add Workbox service worker with app-shell and Supabase caching"
```

---

## Task 4: Capa IndexedDB (espejo + outbox) y comparador LWW

**Files:**
- Create: `js/sync-lww.js`
- Create: `test/sync-lww.test.mjs`
- Create: `js/nestra-db.js`
- Modify: `index.html` (cargar `js/vendor/idb-umd.js`, `js/sync-lww.js`, `js/nestra-db.js` antes de `js/db.js`)

- [ ] **Step 1: Escribir el test del comparador LWW (falla primero)**

Crear `test/sync-lww.test.mjs`:
```js
import assert from 'node:assert';
import { test } from 'node:test';
import { lwwWinner } from '../js/sync-lww.js';

test('local gana si su updated_at es más nuevo que el del servidor', () => {
  const local = { id: 'a', updated_at: '2026-06-21T10:00:01Z' };
  const server = { id: 'a', updated_at: '2026-06-21T10:00:00Z' };
  assert.strictEqual(lwwWinner(local, server), 'local');
});

test('server gana si su updated_at es más nuevo', () => {
  const local = { id: 'a', updated_at: '2026-06-21T10:00:00Z' };
  const server = { id: 'a', updated_at: '2026-06-21T10:00:05Z' };
  assert.strictEqual(lwwWinner(local, server), 'server');
});

test('si no hay fila en server, gana local', () => {
  const local = { id: 'a', updated_at: '2026-06-21T10:00:00Z' };
  assert.strictEqual(lwwWinner(local, null), 'local');
});

test('empate exacto → server (idempotente, no reescribe)', () => {
  const local = { id: 'a', updated_at: '2026-06-21T10:00:00Z' };
  const server = { id: 'a', updated_at: '2026-06-21T10:00:00Z' };
  assert.strictEqual(lwwWinner(local, server), 'server');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run:
```bash
cd "C:/Users/csf93/Desktop/Nestra/..Nestra-v2"
node --test test/sync-lww.test.mjs
```
Expected: FALLA con error de import / `lwwWinner is not a function` (el archivo aún no existe).

- [ ] **Step 3: Escribir el comparador LWW (dual browser/Node)**

Crear `js/sync-lww.js`:
```js
// Comparador last-write-wins por updated_at. Puro y testeable.
// Devuelve 'local' o 'server' indicando qué versión debe prevalecer.
// Empate exacto → 'server' (no reescribimos, evita churn idempotente).
function lwwWinner(local, server) {
  if (!server) return 'local';
  if (!local) return 'server';
  const l = Date.parse(local.updated_at || 0) || 0;
  const s = Date.parse(server.updated_at || 0) || 0;
  return l > s ? 'local' : 'server';
}

// Export dual: ESM (Node test) y global (navegador, scripts no-módulo).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lwwWinner };
}
export { lwwWinner };
```
**Nota:** el navegador carga este archivo como `<script>` clásico (no módulo). El `export` al final lanzaría error en un `<script>` clásico. Para soportar ambos: en el navegador lo cargaremos como módulo NO; en su lugar definimos `window.lwwWinner = lwwWinner;` y el test Node usa una copia ESM. Para evitar duplicar lógica, **ajustar** el archivo así (versión final):
```js
// js/sync-lww.js — comparador LWW. Cárgalo como <script> clásico en el navegador
// (define window.lwwWinner) y como módulo ESM en Node (export al final).
function lwwWinner(local, server) {
  if (!server) return 'local';
  if (!local) return 'server';
  const l = Date.parse(local.updated_at || 0) || 0;
  const s = Date.parse(server.updated_at || 0) || 0;
  return l > s ? 'local' : 'server';
}
if (typeof window !== 'undefined') { window.lwwWinner = lwwWinner; }
export { lwwWinner };
```
En el navegador, un `<script>` clásico con `export` da SyntaxError. Por eso **cargaremos `js/sync-lww.js` como `<script type="module">`** en index.html (ver Step 6). Como módulo, `window.lwwWinner = lwwWinner` lo expone igualmente a los scripts clásicos (db.js/sync.js) que corren después.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run:
```bash
cd "C:/Users/csf93/Desktop/Nestra/..Nestra-v2"
node --test test/sync-lww.test.mjs
```
Expected: PASS (4 tests passing).

- [ ] **Step 5: Escribir la capa IndexedDB `js/nestra-db.js`**

Crear `js/nestra-db.js`:
```js
// Nestra — capa IndexedDB (espejo local + outbox de operaciones pendientes).
// Depende del global `idb` (js/vendor/idb-umd.js). Expone funciones globales.
//
// Stores espejo (keyPath 'id'): transacciones, categorias, metas, prestamos.
// Store outbox (keyPath 'op_id', autoincrement): operaciones de alta pendientes.
//   { op_id, entity, payload, status:'pending'|'syncing'|'error', error?, created_at }

const NESTRA_IDB_NAME = 'nestra';
const NESTRA_IDB_VERSION = 1;
const MIRROR_STORES = ['transacciones', 'categorias', 'metas', 'prestamos'];

let _nestraDbPromise = null;

function nestraDB() {
  if (!_nestraDbPromise) {
    _nestraDbPromise = idb.openDB(NESTRA_IDB_NAME, NESTRA_IDB_VERSION, {
      upgrade(db) {
        MIRROR_STORES.forEach((name) => {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id' });
          }
        });
        if (!db.objectStoreNames.contains('outbox')) {
          const ob = db.createObjectStore('outbox', { keyPath: 'op_id', autoIncrement: true });
          ob.createIndex('status', 'status');
          ob.createIndex('created_at', 'created_at');
        }
      },
    });
  }
  return _nestraDbPromise;
}

// mirrorReplace(store, rows) — reemplaza el contenido del store con `rows`.
// Usado tras una lectura online exitosa para mantener el espejo fresco.
async function mirrorReplace(store, rows) {
  try {
    const db = await nestraDB();
    const tx = db.transaction(store, 'readwrite');
    await tx.store.clear();
    for (const row of rows) {
      if (row && row.id != null) await tx.store.put(row);
    }
    await tx.done;
  } catch (err) {
    console.error('mirrorReplace(' + store + ') falló:', err);
  }
}

// mirrorPut(store, row) — inserta/actualiza una fila en el espejo (alta optimista).
async function mirrorPut(store, row) {
  try {
    const db = await nestraDB();
    await db.put(store, row);
  } catch (err) {
    console.error('mirrorPut(' + store + ') falló:', err);
  }
}

// mirrorGetAll(store) — lee todas las filas del espejo (lectura offline).
async function mirrorGetAll(store) {
  try {
    const db = await nestraDB();
    return await db.getAll(store);
  } catch (err) {
    console.error('mirrorGetAll(' + store + ') falló:', err);
    return [];
  }
}

// outboxAdd(entity, payload) — encola una operación de alta pendiente.
// Returns: el registro outbox creado (con op_id).
async function outboxAdd(entity, payload) {
  const db = await nestraDB();
  const rec = { entity, payload, status: 'pending', created_at: new Date().toISOString() };
  const op_id = await db.add('outbox', rec);
  return { ...rec, op_id };
}

// outboxPending() — lista operaciones pendientes en orden FIFO (created_at asc).
async function outboxPending() {
  try {
    const db = await nestraDB();
    const all = await db.getAllFromIndex('outbox', 'created_at');
    return all.filter((o) => o.status === 'pending' || o.status === 'error');
  } catch (err) {
    console.error('outboxPending() falló:', err);
    return [];
  }
}

// outboxCount() — número de operaciones pendientes (para el badge).
async function outboxCount() {
  return (await outboxPending()).length;
}

// outboxSetStatus(op_id, status, error?) — actualiza el estado de una op.
async function outboxSetStatus(op_id, status, error) {
  const db = await nestraDB();
  const rec = await db.get('outbox', op_id);
  if (!rec) return;
  rec.status = status;
  if (error !== undefined) rec.error = error;
  await db.put('outbox', rec);
}

// outboxRemove(op_id) — borra una op (tras sincronizar con éxito).
async function outboxRemove(op_id) {
  const db = await nestraDB();
  await db.delete('outbox', op_id);
}

window.nestraDB = nestraDB;
window.mirrorReplace = mirrorReplace;
window.mirrorPut = mirrorPut;
window.mirrorGetAll = mirrorGetAll;
window.outboxAdd = outboxAdd;
window.outboxPending = outboxPending;
window.outboxCount = outboxCount;
window.outboxSetStatus = outboxSetStatus;
window.outboxRemove = outboxRemove;
```

- [ ] **Step 6: Cargar los nuevos scripts en `index.html`**

En `index.html`, en el bloque de scripts (tras `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js...">` y ANTES de `js/config.js`), añadir el vendor de idb; y justo ANTES de `js/db.js` añadir la capa IDB y el comparador. Resultado del bloque relevante:
```html
    <!-- IndexedDB (idb vendorizado) -->
    <script src="js/vendor/idb-umd.js"></script>

    <!-- Application Scripts (in order) -->
    <script src="js/config.js"></script>
    <script src="js/supabase.js"></script>
    <script src="js/auth.js"></script>
    <script src="js/format.js"></script>
    <script src="js/iconos.js"></script>
    <!-- xlsx + chart.js (sin cambios) -->
    <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js" integrity="sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js" integrity="sha384-Sse/HDqcypGpyTDpvZOJNnG0TT3feGQUkF9H+mnRvic+LjR+K1NhTt8f51KIQ3v3" crossorigin="anonymous"></script>
    <script src="js/export.js"></script>
    <!-- PWA / offline: comparador LWW (módulo: expone window.lwwWinner) + capa IndexedDB -->
    <script type="module" src="js/sync-lww.js"></script>
    <script src="js/nestra-db.js"></script>
    <script src="js/db.js"></script>
    <script src="js/alerts.js"></script>
    <script src="js/router.js"></script>
    <script src="js/sidebar.js"></script>
```

- [ ] **Step 7: Verificar la capa IDB en el preview**

- `preview_eval` (recargar primero si hace falta):
```js
(async () => {
  const rec = await outboxAdd('transacciones', { id: 'test-1', monto: 5 });
  const count = await outboxCount();
  await mirrorPut('categorias', { id: 'c1', nombre: 'X', updated_at: '2026-06-21T00:00:00Z' });
  const cats = await mirrorGetAll('categorias');
  await outboxRemove(rec.op_id);
  const after = await outboxCount();
  return { added: rec.op_id != null, count, cats: cats.length, after, lww: window.lwwWinner({updated_at:'2026-06-21T01:00:00Z'}, {updated_at:'2026-06-21T00:00:00Z'}) };
})()
```
Expected: `added: true`, `count: 1`, `cats: 1`, `after: 0`, `lww: "local"`.

- [ ] **Step 8: Commit**

```bash
git add js/sync-lww.js test/sync-lww.test.mjs js/nestra-db.js index.html
git commit -m "feat(offline): add IndexedDB mirror/outbox layer and LWW comparator"
```

---

## Task 5: Lecturas con espejo (db.js)

**Files:**
- Modify: `js/db.js` (getTransacciones, getUltimasTransacciones, getCategorias, getMetas, getPrestamos)

**Patrón:** intentar la query a Supabase; si tiene éxito, espejar el resultado en IndexedDB y devolverlo; si falla (offline / error de red), devolver el espejo de IndexedDB. Mantener el contrato actual (devolver array).

- [ ] **Step 1: Añadir helper de lectura con espejo al final de la sección de helpers de db.js**

En `js/db.js`, tras `_requireUserId()` (línea ~53), añadir:
```js
// _mirroredRead(store, fetcher) — ejecuta `fetcher()` (query a Supabase).
// Online OK → espeja el resultado en IndexedDB y lo devuelve.
// Fallo/offline → devuelve el espejo local de `store`.
// Sólo se usa para listas "planas" espejables (sin joins anidados que no
// queramos guardar; los joins se guardan tal cual y bastan para lectura offline).
async function _mirroredRead(store, fetcher) {
  try {
    if (!navigator.onLine) throw new Error('offline');
    const rows = await fetcher();
    if (typeof mirrorReplace === 'function') await mirrorReplace(store, rows);
    return rows;
  } catch (err) {
    console.warn('_mirroredRead(' + store + ') usa espejo local:', err.message || err);
    if (typeof mirrorGetAll === 'function') return await mirrorGetAll(store);
    return [];
  }
}
```

- [ ] **Step 2: Envolver `getTransacciones` para espejar**

Reemplazar el cuerpo de `getTransacciones` (líneas ~64-85) por una versión que delega la query en `_mirroredRead`:
```js
async function getTransacciones(filtros = {}) {
  return _mirroredRead('transacciones', async () => {
    let query = supabase
      .from('transacciones')
      .select('*, categorias(nombre, tipo, color, icono)')
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false });

    if (filtros.ambito)       query = query.eq('ambito', filtros.ambito);
    if (filtros.categoria_id) query = query.eq('categoria_id', filtros.categoria_id);
    if (filtros.tipo)         query = query.eq('tipo', filtros.tipo);
    if (filtros.fecha_desde)  query = query.gte('fecha', filtros.fecha_desde);
    if (filtros.fecha_hasta)  query = query.lte('fecha', filtros.fecha_hasta);

    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];
    // Filtrado offline: si venimos del espejo, _mirroredRead no aplica filtros;
    // por eso el filtrado fino offline se hace en quien consume. Para Fase 1, la
    // vista historial pide sin filtro o por mes; aceptamos espejo completo offline.
    return rows;
  });
}
```
**Nota:** offline el espejo devuelve TODAS las transacciones (sin aplicar `filtros`). Es aceptable para Fase 1 (historial/dashboard re-filtran en cliente lo que necesitan, y el dashboard usa balances — ver Step 5). Documentarlo con el comentario de arriba.

- [ ] **Step 3: Envolver `getCategorias`, `getMetas`, `getPrestamos`**

Reemplazar `getCategorias` (líneas ~466-482) usando `_mirroredRead('categorias', ...)`:
```js
async function getCategorias(tipo = null, incluirArchivadas = false) {
  const rows = await _mirroredRead('categorias', async () => {
    let query = supabase.from('categorias').select('*').order('nombre', { ascending: true });
    if (!incluirArchivadas) query = query.eq('estado', 'activa');
    if (tipo) query = query.eq('tipo', tipo);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  });
  // Filtrado client-side (aplica también al espejo offline).
  return rows.filter((c) =>
    (incluirArchivadas || c.estado === 'activa') && (!tipo || c.tipo === tipo)
  );
}
```
Reemplazar `getMetas` (líneas ~729-744). Nota: lee de la vista `metas_con_progreso`, pero el espejo lo guardamos bajo el store `metas`:
```js
async function getMetas(ambito = null) {
  const rows = await _mirroredRead('metas', async () => {
    let query = supabase
      .from('metas_con_progreso')
      .select('*')
      .order('fecha_limite', { ascending: true, nullsFirst: false });
    if (ambito) query = query.eq('ambito', ambito);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  });
  return ambito ? rows.filter((m) => m.ambito === ambito) : rows;
}
```
Reemplazar `getPrestamos` (líneas ~889-903):
```js
async function getPrestamos(estado = null) {
  const rows = await _mirroredRead('prestamos', async () => {
    let query = supabase
      .from('prestamos')
      .select('*, transacciones(fecha, monto, ambito, nota, user_id, tipo)');
    if (estado) query = query.eq('estado', estado);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  });
  return estado ? rows.filter((p) => p.estado === estado) : rows;
}
```

- [ ] **Step 4: Verificar lectura online (espeja) en el preview**

- Iniciar sesión en el preview (si la app lo requiere) y navegar a `#historial` para forzar `getTransacciones`.
- `preview_eval`:
```js
(async () => {
  await getCategorias();          // online → espeja
  await getTransacciones();
  const cats = await mirrorGetAll('categorias');
  const txs = await mirrorGetAll('transacciones');
  return { cats: cats.length, txs: txs.length };
})()
```
Expected: `cats` y `txs` ≥ 0 y consistentes con los datos reales (si la cuenta tiene datos, > 0).

- [ ] **Step 5: Verificar lectura offline (sirve espejo) en el preview**

- `preview_eval` para forzar offline lógico:
```js
(async () => {
  const realDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  const cats = await getCategorias();      // debe venir del espejo
  Object.defineProperty(navigator, 'onLine', realDesc || { configurable: true, get: () => true });
  return { offlineCats: cats.length };
})()
```
Expected: `offlineCats` igual al número espejado en el Step 4 (no 0 si había datos).

- [ ] **Step 6: Commit**

```bash
git add js/db.js
git commit -m "feat(offline): mirror Supabase reads to IndexedDB with offline fallback"
```

---

## Task 6: Escrituras offline → outbox (db.js)

**Files:**
- Modify: `js/db.js` (insertTransaccion, insertMeta, insertPrestamo; guard en insertAporteHogar/insertAporteDirecto)

**Patrón:** generar `id` con `crypto.randomUUID()` y `updated_at` cliente ANTES de escribir. Si online, insertar en Supabase como hoy (pero con id/updated_at explícitos para idempotencia). Si offline (o el insert lanza error de red), encolar en outbox, espejar la fila optimista y devolverla. Las funciones que dependen de RPC (aporte hogar/directo) lanzan error claro offline.

- [ ] **Step 1: Añadir helper de detección de error de red al bloque de helpers**

En `js/db.js`, tras `_mirroredRead` (Task 5), añadir:
```js
// _isNetworkError(err) — heurística: ¿el fallo es por falta de red?
// Supabase/fetch lanzan TypeError "Failed to fetch" sin conexión.
function _isNetworkError(err) {
  if (!navigator.onLine) return true;
  const msg = (err && (err.message || err)) + '';
  return /failed to fetch|networkerror|load failed|fetch/i.test(msg);
}
```

- [ ] **Step 2: Reescribir `insertTransaccion` con soporte outbox**

Reemplazar `insertTransaccion` (líneas ~109-140) por:
```js
async function insertTransaccion(datos) {
  const userId = _requireUserId();
  const fila = {
    id:           crypto.randomUUID(),
    tipo:         datos.tipo,
    ambito:       datos.ambito,
    categoria_id: datos.categoria_id,
    monto:        datos.monto,
    nota:         datos.nota ?? null,
    user_id:      userId,
    fecha:        datos.fecha || undefined,
    updated_at:   new Date().toISOString(),
  };
  if (!fila.fecha) delete fila.fecha;

  // Offline → encolar y devolver fila optimista (status pending para la UI).
  if (!navigator.onLine) {
    await outboxAdd('transacciones', fila);
    await mirrorPut('transacciones', { ...fila, _pending: true });
    if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
    return { ...fila, _pending: true };
  }

  try {
    const { data, error } = await supabase
      .from('transacciones').insert(fila).select().single();
    if (error) throw error;
    if (data.tipo === 'gasto') await _distribuirSiAhorro(data);
    await mirrorPut('transacciones', data);
    return data;
  } catch (err) {
    if (_isNetworkError(err)) {
      await outboxAdd('transacciones', fila);
      await mirrorPut('transacciones', { ...fila, _pending: true });
      if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
      return { ...fila, _pending: true };
    }
    console.error('Error en insertTransaccion():', err.message || err);
    throw err;
  }
}
```

- [ ] **Step 3: Reescribir `insertMeta` con soporte outbox**

Reemplazar `insertMeta` (líneas ~808-824) por:
```js
async function insertMeta(datos) {
  const fila = { ...datos, id: crypto.randomUUID(), user_id: _requireUserId(), updated_at: new Date().toISOString() };

  if (!navigator.onLine) {
    await outboxAdd('metas', fila);
    await mirrorPut('metas', { ...fila, _pending: true });
    if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
    return { ...fila, _pending: true };
  }
  try {
    const { data, error } = await supabase.from('metas').insert(fila).select().single();
    if (error) throw error;
    await mirrorPut('metas', data);
    return data;
  } catch (err) {
    if (_isNetworkError(err)) {
      await outboxAdd('metas', fila);
      await mirrorPut('metas', { ...fila, _pending: true });
      if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
      return { ...fila, _pending: true };
    }
    console.error('Error en insertMeta():', err.message || err);
    throw err;
  }
}
```

- [ ] **Step 4: Reescribir `insertPrestamo` con soporte outbox**

Reemplazar `insertPrestamo` (líneas ~909-922) por:
```js
async function insertPrestamo(transaccion_id, deudor, estado = 'pendiente') {
  const fila = { id: crypto.randomUUID(), transaccion_id, deudor, estado, user_id: _requireUserId(), updated_at: new Date().toISOString() };

  if (!navigator.onLine) {
    await outboxAdd('prestamos', fila);
    await mirrorPut('prestamos', { ...fila, _pending: true });
    if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
    return { ...fila, _pending: true };
  }
  try {
    const { data, error } = await supabase.from('prestamos').insert(fila).select().single();
    if (error) throw error;
    await mirrorPut('prestamos', data);
    return data;
  } catch (err) {
    if (_isNetworkError(err)) {
      await outboxAdd('prestamos', fila);
      await mirrorPut('prestamos', { ...fila, _pending: true });
      if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
      return { ...fila, _pending: true };
    }
    console.error('Error en insertPrestamo():', err.message || err);
    throw err;
  }
}
```

- [ ] **Step 5: Guard offline en funciones RPC-dependientes**

En `insertAporteHogar` (línea ~248) y `insertAporteDirecto` (línea ~865), añadir como PRIMERA línea del `try` (o antes de la lógica):
```js
    if (!navigator.onLine) throw new Error('Esta acción requiere conexión a internet.');
```
(Aporte al hogar crea filas vinculadas + RPC; aporte directo es 100% RPC. No son seguros offline en Fase 1.)

- [ ] **Step 6: Verificar alta offline (encola + optimista) en el preview**

- Asegurar sesión activa en el preview.
- `preview_eval`:
```js
(async () => {
  const cats = await getCategorias('gasto');
  if (!cats.length) return { skip: 'sin categorías de gasto' };
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  const tx = await insertTransaccion({ tipo:'gasto', ambito:'personal', categoria_id: cats[0].id, monto: 1.23, nota:'offline-test' });
  const pend = await outboxCount();
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  return { pendingFlag: tx._pending === true, hasId: !!tx.id, pendingCount: pend };
})()
```
Expected: `{ pendingFlag: true, hasId: true, pendingCount: 1 }`.

- [ ] **Step 7: Commit**

```bash
git add js/db.js
git commit -m "feat(offline): queue offline inserts (tx/metas/prestamos) to outbox"
```

---

## Task 7: Motor de sincronización (js/sync.js)

**Files:**
- Create: `js/sync.js`
- Modify: `index.html` (cargar `js/sync.js` tras `js/db.js`)

**Comportamiento:** al reconectar (`online`), al volver a foreground (`visibilitychange`), al cargar la app y cuando el SW lo pida (mensaje), vaciar la outbox FIFO: por cada op, comprobar LWW contra el servidor (¿ya existe una fila más nueva?) y hacer upsert si local gana; quitar la op al terminar. Notificar a la UI los cambios de pendientes. Reintentos: si una op falla por red, se queda `pending`; si falla por error real (validación), se marca `error` y se deja para inspección (no bloquea el resto).

- [ ] **Step 1: Escribir `js/sync.js`**

Crear `js/sync.js`:
```js
// Nestra — motor de sincronización de la outbox.
// Corre EN LA PÁGINA (el JWT de Supabase vive aquí, no en el SW).
// Dispara: evento 'online', 'visibilitychange'→visible, carga inicial, y
// mensaje 'NESTRA_SYNC' del Service Worker (Background Sync en Chrome/Android).

let _syncing = false;

// _serverRow(entity, id) — lee la fila actual del servidor para LWW.
async function _serverRow(entity, id) {
  const table = entity === 'metas' ? 'metas' : entity; // metas: tabla base, no la vista
  const { data, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

// _replayOp(op) — sincroniza una operación de alta. Devuelve true si se completó
// (y debe quitarse de la outbox), false si debe reintentarse luego.
async function _replayOp(op) {
  const { entity, payload } = op;
  try {
    const server = await _serverRow(entity, payload.id);
    const winner = window.lwwWinner(payload, server);
    if (winner === 'server') {
      // El servidor ya tiene una versión igual o más nueva → no reescribir.
      if (server) await mirrorPut(entity, server);
      return true;
    }
    // Local gana → upsert idempotente por id (re-ejecutable sin duplicar).
    const { data, error } = await supabase.from(entity).upsert(payload, { onConflict: 'id' }).select().single();
    if (error) throw error;
    await mirrorPut(entity, data);
    return true;
  } catch (err) {
    if (!navigator.onLine || /failed to fetch|networkerror|load failed/i.test((err && err.message) + '')) {
      return false; // error de red → reintentar luego, sigue pending
    }
    // Error real (p.ej. validación/RLS) → marcar para inspección, no bloquear.
    console.error('Sync op fallida (entity=' + entity + ', id=' + payload.id + '):', err.message || err);
    await outboxSetStatus(op.op_id, 'error', (err && err.message) + '');
    return false;
  }
}

// syncOutbox() — vacía la outbox FIFO. Idempotente y reentrante-seguro.
async function syncOutbox() {
  if (_syncing || !navigator.onLine) return;
  if (typeof isAuthenticated === 'function' && !isAuthenticated()) return;
  _syncing = true;
  try {
    const ops = await outboxPending();
    for (const op of ops) {
      if (op.status === 'error') continue; // requiere intervención; no reintentar en bucle
      const done = await _replayOp(op);
      if (done) await outboxRemove(op.op_id);
      else break; // corte por red: parar y reintentar en el próximo disparo
    }
  } finally {
    _syncing = false;
    notifyPendingChanged();
  }
}

// notifyPendingChanged() — emite un evento global con el conteo pendiente.
// La UI (Task 8) escucha 'nestra:pending' para pintar el badge.
async function notifyPendingChanged() {
  try {
    const count = await outboxCount();
    window.dispatchEvent(new CustomEvent('nestra:pending', { detail: { count } }));
  } catch (_) {}
}

// Disparadores.
window.addEventListener('online', syncOutbox);
window.addEventListener('focus', syncOutbox);
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncOutbox(); });
window.addEventListener('load', () => { setTimeout(syncOutbox, 1200); });
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'NESTRA_SYNC') syncOutbox();
  });
}

window.syncOutbox = syncOutbox;
window.notifyPendingChanged = notifyPendingChanged;
```

- [ ] **Step 2: Cargar `js/sync.js` en index.html**

En `index.html`, tras `<script src="js/db.js"></script>` (y antes de `js/router.js`), añadir:
```html
    <script src="js/sync.js"></script>
```

- [ ] **Step 3: Verificar el ciclo offline→online en el preview (automatizado)**

- Sesión activa. `preview_eval`:
```js
(async () => {
  const cats = await getCategorias('gasto');
  if (!cats.length) return { skip: 'sin categorías' };
  // 1. Offline: crear → encola
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  const tx = await insertTransaccion({ tipo:'gasto', ambito:'personal', categoria_id: cats[0].id, monto: 2.5, nota:'sync-test-'+Date.now() });
  const pendBefore = await outboxCount();
  // 2. Online: sincronizar
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  await syncOutbox();
  const pendAfter = await outboxCount();
  // 3. Confirmar que existe en el servidor
  const { data } = await supabase.from('transacciones').select('id,monto').eq('id', tx.id).maybeSingle();
  return { pendBefore, pendAfter, syncedToServer: !!data, serverMonto: data && data.monto };
})()
```
Expected: `{ pendBefore: 1, pendAfter: 0, syncedToServer: true, serverMonto: 2.5 }`.

- [ ] **Step 4: Limpiar el dato de prueba**

`preview_eval`:
```js
(async () => {
  const { data } = await supabase.from('transacciones').select('id').ilike('nota','sync-test-%');
  for (const r of (data||[])) await supabase.from('transacciones').delete().eq('id', r.id);
  return { borradas: (data||[]).length };
})()
```

- [ ] **Step 5: Commit**

```bash
git add js/sync.js index.html
git commit -m "feat(offline): outbox sync engine with LWW upsert on reconnect"
```

---

## Task 8: Banner offline + badge de pendientes (UI)

**Files:**
- Modify: `index.html` (DOM del banner + badge)
- Modify: `css/components.css` (estilos)
- Modify: `js/sync.js` o nuevo bloque inline — wiring de visibilidad

**Diseño (usar skill `frontend-design`):** banner fino fijo arriba cuando `!navigator.onLine` ("Sin conexión — los cambios se guardarán y sincronizarán al volver"). Badge contador junto al chip de usuario / FAB cuando hay pendientes ("N por sincronizar"), que desaparece al llegar a 0. Respetar variables CSS existentes (`--color-warning`, `--space-*`, etc.).

- [ ] **Step 1: Añadir el DOM del banner y badge en index.html**

Tras `<body class="no-chrome">` (línea 15), añadir:
```html
    <!-- Banner offline (oculto por defecto; lo controla js de PWA) -->
    <div id="offlineBanner" class="offline-banner" role="status" aria-live="polite" hidden>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
      <span>Sin conexión — tus cambios se guardan y se sincronizarán al volver.</span>
    </div>
    <!-- Badge de pendientes por sincronizar (oculto si 0) -->
    <div id="pendingBadge" class="pending-badge" role="status" aria-live="polite" hidden>
      <span class="pending-badge-dot" aria-hidden="true"></span>
      <span id="pendingBadgeText">0 por sincronizar</span>
    </div>
```

- [ ] **Step 2: Estilos en css/components.css**

Añadir al final de `css/components.css`:
```css
/* ── PWA: banner offline + badge pendientes ───────────────────── */
.offline-banner {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-md);
  background: var(--color-warning, #f59e0b);
  color: #1f2937;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  box-shadow: var(--shadow-sm);
  animation: offlineSlideDown 0.2s ease-out;
}
.offline-banner[hidden] { display: none; }
@keyframes offlineSlideDown { from { transform: translateY(-100%); } to { transform: translateY(0); } }

.pending-badge {
  position: fixed;
  bottom: calc(var(--space-lg) + 64px); /* sobre el FAB */
  right: var(--space-lg);
  z-index: 999;
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  background: var(--color-primary);
  color: #fff;
  border-radius: var(--radius-pill, 999px);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  box-shadow: var(--shadow-md);
}
.pending-badge[hidden] { display: none; }
.pending-badge-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #fff; opacity: 0.9;
  animation: pendingPulse 1.4s ease-in-out infinite;
}
@keyframes pendingPulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }
```

- [ ] **Step 3: Wiring de visibilidad (añadir a js/sync.js)**

Al final de `js/sync.js`, añadir:
```js
// ── UI: banner offline + badge de pendientes ──────────────────
function _updateOfflineBanner() {
  const b = document.getElementById('offlineBanner');
  if (b) b.hidden = navigator.onLine;
}
function _updatePendingBadge(count) {
  const badge = document.getElementById('pendingBadge');
  const text = document.getElementById('pendingBadgeText');
  if (!badge) return;
  if (count > 0) {
    badge.hidden = false;
    if (text) text.textContent = count + (count === 1 ? ' por sincronizar' : ' por sincronizar');
  } else {
    badge.hidden = true;
  }
}
window.addEventListener('online', _updateOfflineBanner);
window.addEventListener('offline', _updateOfflineBanner);
window.addEventListener('nestra:pending', (e) => _updatePendingBadge(e.detail.count));
document.addEventListener('DOMContentLoaded', () => {
  _updateOfflineBanner();
  notifyPendingChanged();
});
```

- [ ] **Step 4: Verificar banner y badge en el preview**

- `preview_eval` (forzar offline + disparar eventos):
```js
(async () => {
  window.dispatchEvent(new Event('offline'));
  const bannerVisible = !document.getElementById('offlineBanner').hidden;
  window.dispatchEvent(new CustomEvent('nestra:pending', { detail: { count: 3 } }));
  const badge = document.getElementById('pendingBadge');
  const badgeVisible = !badge.hidden;
  const txt = document.getElementById('pendingBadgeText').textContent;
  window.dispatchEvent(new Event('online'));
  window.dispatchEvent(new CustomEvent('nestra:pending', { detail: { count: 0 } }));
  return { bannerVisible, badgeVisible, txt, bannerHiddenOnline: document.getElementById('offlineBanner').hidden, badgeHiddenAtZero: badge.hidden };
})()
```
Expected: `{ bannerVisible: true, badgeVisible: true, txt: "3 por sincronizar", bannerHiddenOnline: true, badgeHiddenAtZero: true }`.
- `preview_screenshot` con el banner forzado visible para revisar el diseño (disparar `offline` y `nestra:pending` count 2 antes del screenshot).

- [ ] **Step 5: Commit**

```bash
git add index.html css/components.css js/sync.js
git commit -m "feat(pwa): offline banner and pending-sync badge UI"
```

---

## Task 9: Prompt de instalación custom + hint iOS (js/pwa.js)

**Files:**
- Create: `js/pwa.js`
- Modify: `index.html` (mover el registro del SW a js/pwa.js; añadir DOM del prompt; cargar js/pwa.js)

**Diseño (usar skill `frontend-design`):** capturar `beforeinstallprompt` (Chrome/Android), prevenir el banner nativo y mostrar una tarjeta propia ("Instala Nestra") con botón "Instalar" → `deferredPrompt.prompt()`. En iOS (sin `beforeinstallprompt`) y no-standalone, mostrar un hint: "Toca Compartir ⬆ y 'Añadir a pantalla de inicio'". No mostrar nada si ya está instalada (`display-mode: standalone` o `navigator.standalone`). Persistir "descartado" en localStorage.

- [ ] **Step 1: Añadir el DOM del prompt en index.html**

Antes de `</body>` (tras los modales existentes), añadir:
```html
    <!-- Prompt de instalación PWA (custom; oculto por defecto) -->
    <div id="installPrompt" class="install-prompt" role="dialog" aria-labelledby="installPromptTitle" hidden>
      <img src="assets/icon-192.png" alt="" class="install-prompt-icon" width="44" height="44">
      <div class="install-prompt-body">
        <p class="install-prompt-title" id="installPromptTitle">Instala Nestra</p>
        <p class="install-prompt-text" id="installPromptText">Añádela a tu pantalla de inicio para abrirla como una app.</p>
      </div>
      <div class="install-prompt-actions">
        <button type="button" class="btn btn-secondary btn-small" id="installDismiss">Ahora no</button>
        <button type="button" class="btn btn-primary btn-small" id="installAccept">Instalar</button>
      </div>
    </div>
```

- [ ] **Step 2: Estilos del prompt en css/components.css**

Añadir al final de `css/components.css`:
```css
/* ── PWA: prompt de instalación custom ─────────────────────────── */
.install-prompt {
  position: fixed;
  left: 50%; bottom: var(--space-lg);
  transform: translateX(-50%);
  z-index: 1001;
  display: flex;
  align-items: center;
  gap: var(--space-md);
  width: calc(100% - 2 * var(--space-md));
  max-width: 420px;
  padding: var(--space-md);
  background: var(--bg-light, #fff);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg, 16px);
  box-shadow: var(--shadow-lg, 0 10px 30px rgba(0,0,0,.18));
  animation: installSlideUp 0.25s ease-out;
}
.install-prompt[hidden] { display: none; }
@keyframes installSlideUp { from { transform: translate(-50%, 20px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
.install-prompt-icon { border-radius: var(--radius-md); flex-shrink: 0; }
.install-prompt-body { flex: 1; min-width: 0; }
.install-prompt-title { margin: 0 0 2px; font-weight: var(--font-weight-bold); color: var(--text-dark); }
.install-prompt-text { margin: 0; font-size: var(--font-size-xs); color: var(--text-secondary); }
.install-prompt-actions { display: flex; flex-direction: column; gap: var(--space-xs); flex-shrink: 0; }
@media (min-width: 420px) { .install-prompt-actions { flex-direction: row; } }
```

- [ ] **Step 3: Escribir js/pwa.js (registro SW + prompt)**

Crear `js/pwa.js`:
```js
// Nestra — PWA: registro del Service Worker + prompt de instalación custom.

// ── Registro del Service Worker ───────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js')
      .then(function (reg) { console.log('SW registrado, scope:', reg.scope); })
      .catch(function (err) { console.error('SW registro falló:', err); });
  });
}

// ── Detección de instalada ────────────────────────────────────
function _isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}
function _isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
const _INSTALL_DISMISS_KEY = 'nestra-install-dismissed';

// ── Prompt custom (Chrome/Android) ────────────────────────────
let _deferredPrompt = null;

function _showInstallPrompt(iosMode) {
  if (_isStandalone()) return;
  if (localStorage.getItem(_INSTALL_DISMISS_KEY) === '1') return;
  const el = document.getElementById('installPrompt');
  const accept = document.getElementById('installAccept');
  const text = document.getElementById('installPromptText');
  if (!el) return;
  if (iosMode) {
    if (text) text.textContent = "Toca Compartir y luego 'Añadir a pantalla de inicio'.";
    if (accept) accept.style.display = 'none';
  }
  el.hidden = false;
}

window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();           // suprime el banner nativo del browser
  _deferredPrompt = e;
  _showInstallPrompt(false);
});

window.addEventListener('appinstalled', function () {
  const el = document.getElementById('installPrompt');
  if (el) el.hidden = true;
  _deferredPrompt = null;
});

document.addEventListener('DOMContentLoaded', function () {
  const accept = document.getElementById('installAccept');
  const dismiss = document.getElementById('installDismiss');
  if (accept) accept.addEventListener('click', async function () {
    if (!_deferredPrompt) return;
    _deferredPrompt.prompt();
    try { await _deferredPrompt.userChoice; } catch (_) {}
    _deferredPrompt = null;
    const el = document.getElementById('installPrompt');
    if (el) el.hidden = true;
  });
  if (dismiss) dismiss.addEventListener('click', function () {
    const el = document.getElementById('installPrompt');
    if (el) el.hidden = true;
    localStorage.setItem(_INSTALL_DISMISS_KEY, '1');
  });

  // iOS: no hay beforeinstallprompt → mostrar hint si no está instalada.
  if (_isIOS() && !_isStandalone()) {
    setTimeout(function () { _showInstallPrompt(true); }, 2500);
  }
});
```

- [ ] **Step 4: Quitar el registro SW inline y cargar js/pwa.js**

En `index.html`, **eliminar** el bloque `<script>` de registro de SW añadido en Task 3 Step 2 (el que llama `navigator.serviceWorker.register('sw.js')`). Añadir, antes de `</body>` (después del DOM del install prompt):
```html
    <script src="js/pwa.js"></script>
```

- [ ] **Step 5: Verificar el prompt en el preview**

- `preview_eval` (simular beforeinstallprompt):
```js
(async () => {
  localStorage.removeItem('nestra-install-dismissed');
  let prompted = false;
  const fake = new Event('beforeinstallprompt');
  fake.prompt = () => { prompted = true; };
  fake.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(fake);
  const visible = !document.getElementById('installPrompt').hidden;
  document.getElementById('installAccept').click();
  await new Promise(r => setTimeout(r, 50));
  const hiddenAfter = document.getElementById('installPrompt').hidden;
  return { visible, prompted, hiddenAfter };
})()
```
Expected: `{ visible: true, prompted: true, hiddenAfter: true }`.
- `preview_screenshot` con el prompt visible (re-disparar `beforeinstallprompt` antes) para revisar diseño.

- [ ] **Step 6: Commit**

```bash
git add js/pwa.js index.html css/components.css
git commit -m "feat(pwa): custom install prompt with iOS add-to-home-screen hint"
```

---

## Task 10: Verificación end-to-end offline→online (manual con preview)

**Files:** ninguno (solo verificación). Si aparecen bugs, volver a la tarea correspondiente.

- [ ] **Step 1: Reset limpio del SW y caches en el preview**

`preview_eval`:
```js
(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const r of regs) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  return { unregistered: regs.length };
})()
```
Luego `preview_eval`: `window.location.reload()` dos veces (instala + activa SW limpio).

- [ ] **Step 2: Verificar instalabilidad (criterios PWA)**

`preview_eval`:
```js
(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const manifest = await fetch('/manifest.json').then(r=>r.json());
  return {
    sw: !!(reg && reg.active),
    manifest: manifest.display === 'standalone' && manifest.start_url === '/#dashboard',
    icons: manifest.icons.some(i=>i.sizes==='192x192') && manifest.icons.some(i=>i.sizes==='512x512'),
    maskable: manifest.icons.some(i=>i.purpose==='maskable')
  };
})()
```
Expected: todos `true`.

- [ ] **Step 3: Flujo completo offline→online (transacción)**

Con sesión activa, `preview_eval`:
```js
(async () => {
  const cats = await getCategorias('gasto');
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  window.dispatchEvent(new Event('offline'));
  const tx = await insertTransaccion({ tipo:'gasto', ambito:'personal', categoria_id: cats[0].id, monto: 9.99, nota:'e2e-'+Date.now() });
  const banner = !document.getElementById('offlineBanner').hidden;
  const pend = await outboxCount();
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  window.dispatchEvent(new Event('online'));
  await new Promise(r=>setTimeout(r, 1500)); // dar tiempo al sync por evento online
  const pendAfter = await outboxCount();
  const { data } = await supabase.from('transacciones').select('id,monto').eq('id', tx.id).maybeSingle();
  // limpieza
  if (data) await supabase.from('transacciones').delete().eq('id', tx.id);
  return { banner, pend, pendAfter, synced: !!data };
})()
```
Expected: `{ banner: true, pend: 1, pendAfter: 0, synced: true }`.

- [ ] **Step 4: Verificar lectura offline real**

`preview_eval`: cargar datos online, luego forzar offline y navegar a `#historial` / `#metas`; confirmar que las vistas renderizan desde el espejo sin errores en consola.
```js
(async () => {
  await getTransacciones(); await getMetas(); await getCategorias();
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  const t = await getTransacciones(); const m = await getMetas();
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  return { txOffline: t.length, metasOffline: m.length };
})()
```
Expected: conteos coherentes con los datos reales (no error).
- `preview_console_logs`: sin errores rojos no esperados.

- [ ] **Step 5: Verificar app shell offline (recarga sin red)**

`preview_eval` para confirmar que con SW activo el shell se sirve de cache:
```js
(async () => {
  const shell = await caches.match('index.html');
  const view = await caches.match('css/components.css');
  return { shellCached: !!shell, cssCached: !!view };
})()
```
Expected: ambos `true`.

- [ ] **Step 6: Screenshot final de evidencia**

`preview_screenshot` del dashboard con la app funcionando (y opcionalmente con el banner offline forzado) para adjuntar como prueba.

- [ ] **Step 7: Commit final / tag de fase**

```bash
git add -A
git commit -m "test(pwa): verify Fase 1 offline-online PWA flow end-to-end" --allow-empty
```

---

## Self-Review (cobertura del spec)

- **Requisito 1 (manifest + iconos + iOS meta):** Task 2. ✓ (`manifest.json` con display:standalone, start_url:/#dashboard, iconos 192/512 + maskable; meta apple-* + apple-touch-icon en index.html).
- **Requisito 2 (SW Workbox: shell cache-first, Supabase network-first):** Task 3. ✓ (precache del shell, Supabase REST GET network-first con fallback cache, CDN cache-first, vistas SWR).
- **Requisito 3 (IndexedDB espejo de tx/categorías/metas/préstamos con idb):** Task 4 (capa) + Task 5 (espejo en lecturas). ✓
- **Requisito 4 (Background Sync: alta offline status pending + badge + auto-sync al reconectar):** Task 6 (outbox) + Task 7 (sync) + Task 8 (badge). ✓ con la nota iOS: sync page-driven por `online`/`visibilitychange` (Background Sync del SW como mejora progresiva).
- **Requisito 5 (banner offline propio + install prompt custom):** Task 8 (banner) + Task 9 (install prompt + hint iOS). ✓
- **Conflictos (LWW por updated_at):** Task 1 (schema) + Task 4 (comparador) + Task 7 (aplicación en replay). ✓
- **Prueba manual offline→online con preview:** verificación en cada task + Task 10 end-to-end. ✓

**Limitaciones declaradas (intencionales en Fase 1):**
- Offline solo cubre ALTAS de transacciones/metas/préstamos. Ediciones y borrados requieren conexión.
- `insertAporteHogar` e `insertAporteDirecto` requieren conexión (dependen de RPC server-side) — guard explícito.
- Lectura offline de `getTransacciones` devuelve el espejo completo sin aplicar filtros de fecha/ámbito server-side (las vistas re-filtran en cliente).
