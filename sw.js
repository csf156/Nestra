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
const SHELL_VERSION = 'v3';

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
  { url: 'assets/fonts/Outfit-Regular.woff2', revision: SHELL_VERSION },
  { url: 'assets/fonts/Outfit-SemiBold.woff2', revision: SHELL_VERSION },
  { url: 'assets/fonts/PlayfairDisplay-Regular.woff2', revision: SHELL_VERSION },
  { url: 'assets/fonts/PlayfairDisplay-SemiBold.woff2', revision: SHELL_VERSION },
]);

// Vistas HTML (views/*.html) — el router las hace fetch. Stale-while-revalidate.
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
