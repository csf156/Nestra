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
const SHELL_VERSION = 'v28';

// App shell precache (manual). revision = versión para invalidar al cambiar.
precaching.precacheAndRoute([
  { url: 'index.html', revision: SHELL_VERSION },
  { url: 'css/base.css', revision: SHELL_VERSION },
  { url: 'css/layout.css', revision: SHELL_VERSION },
  { url: 'css/components.css', revision: SHELL_VERSION },
  { url: 'js/config.js', revision: SHELL_VERSION },
  { url: 'js/supabase.js', revision: SHELL_VERSION },
  { url: 'js/auth.js', revision: SHELL_VERSION },
  { url: 'js/moneda.js', revision: SHELL_VERSION },
  { url: 'js/format.js', revision: SHELL_VERSION },
  { url: 'js/iconos.js', revision: SHELL_VERSION },
  { url: 'js/ui.js', revision: SHELL_VERSION },
  { url: 'js/sparkline.js', revision: SHELL_VERSION },
  { url: 'js/export.js', revision: SHELL_VERSION },
  { url: 'js/db.js', revision: SHELL_VERSION },
  { url: 'js/alerts.js', revision: SHELL_VERSION },
  { url: 'js/insights.js', revision: SHELL_VERSION },
  { url: 'js/safe-to-spend.js', revision: SHELL_VERSION },
  { url: 'js/hogar-desequilibrio.js', revision: SHELL_VERSION },
  { url: 'js/hogar-partes.js', revision: SHELL_VERSION },
  { url: 'js/hogar-aporte.js', revision: SHELL_VERSION },
  { url: 'js/presupuestos.js', revision: SHELL_VERSION },
  { url: 'js/presupuestos-orden.js', revision: SHELL_VERSION },
  { url: 'js/recurrentes-detect.js', revision: SHELL_VERSION },
  { url: 'js/brujula.js', revision: SHELL_VERSION },
  { url: 'js/flujo-proyeccion.js', revision: SHELL_VERSION },
  { url: 'js/router.js', revision: SHELL_VERSION },
  { url: 'js/sidebar.js', revision: SHELL_VERSION },
  { url: 'js/nestra-db.js', revision: SHELL_VERSION },
  { url: 'js/sync-lww.js', revision: SHELL_VERSION },
  { url: 'js/sync.js', revision: SHELL_VERSION },
  { url: 'js/pwa.js', revision: SHELL_VERSION },
  { url: 'js/push.js', revision: SHELL_VERSION },
  { url: 'js/share-parse.js', revision: SHELL_VERSION },
  { url: 'js/autocat.js', revision: SHELL_VERSION },
  { url: 'js/parse-quickadd.js', revision: SHELL_VERSION },
  { url: 'js/searchable-select.js', revision: SHELL_VERSION },
  { url: 'js/share-target.js', revision: SHELL_VERSION },
  { url: 'js/webauthn.js', revision: SHELL_VERSION },
  { url: 'js/vendor/idb-umd.js', revision: SHELL_VERSION },
  { url: 'manifest.json', revision: SHELL_VERSION },
  { url: 'assets/nestra_logo.png', revision: SHELL_VERSION },
  { url: 'assets/nestra_logo_dark.png', revision: SHELL_VERSION },
  { url: 'assets/tabler-sprite.svg', revision: SHELL_VERSION },
  { url: 'assets/icon-192.png', revision: SHELL_VERSION },
  { url: 'assets/icon-512.png', revision: SHELL_VERSION },
  { url: 'assets/fonts/Outfit-Regular.woff2', revision: SHELL_VERSION },
  { url: 'assets/fonts/Outfit-SemiBold.woff2', revision: SHELL_VERSION },
  { url: 'assets/fonts/PlayfairDisplay-Regular.woff2', revision: SHELL_VERSION },
  { url: 'assets/fonts/PlayfairDisplay-SemiBold.woff2', revision: SHELL_VERSION },
]);

// Vistas HTML (views/*.html) — el router las hace fetch. NetworkFirst: online
// siempre trae la última versión (así los cambios se ven sin esperar a un 2º
// reload); offline cae al último cacheado. SWR servía la copia vieja primero.
routing.registerRoute(
  ({ url }) => /\/views\/.*\.html$/.test(url.pathname),
  new strategies.NetworkFirst({
    cacheName: 'nestra-views',
    networkTimeoutSeconds: 3,
    plugins: [
      new cacheableResponse.CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
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

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// ── Web Share Target (Fase 1) ─────────────────────────────────
// Recibe el POST multipart del share, guarda el payload en una cache
// y redirige a la app con ?shared=1. La página (js/share-target.js)
// lo consume y abre el modal de transacción precargado.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(_handleShareTarget(event.request));
  }
});

async function _handleShareTarget(request) {
  try {
    const form = await request.formData();
    const payload = {
      title: form.get('title') || '',
      text: form.get('text') || '',
      url: form.get('url') || '',
      hasImage: false,
    };
    const file = form.get('image');
    const cache = await caches.open('nestra-share');
    if (file && file.size) {
      payload.hasImage = true;
      await cache.put('/__share_image__',
        new Response(file, { headers: { 'Content-Type': file.type || 'image/png' } }));
    }
    await cache.put('/__share_data__',
      new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } }));
  } catch (err) {
    // Si algo falla, igual redirigimos para no dejar al usuario en una pantalla rota.
  }
  return Response.redirect('./?shared=1', 303);
}

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
