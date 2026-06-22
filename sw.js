// sw.js — KILL SWITCH (temporal)
// El deploy v2 (revertido en PR #3) dejó un service worker instalado en los
// clientes de csf156.github.io que sigue sirviendo el db.js cacheado de v2
// (escribe la columna `updated_at`, que la BD de v1 no tiene) → rompe el alta
// de transacciones. El revert no puede desinstalar un SW ya instalado.
//
// Este archivo reemplaza a ese SW vía el mecanismo de update del navegador:
// al activarse borra todas las cachés, se des-registra a sí mismo y recarga
// las pestañas abiertas, devolviendo el origen al estado v1 (sin SW, red
// directa). Seguro de eliminar una vez todos los clientes estén sanos.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) { /* noop */ }
    try {
      await self.registration.unregister();
    } catch (e) { /* noop */ }
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) client.navigate(client.url);
    } catch (e) { /* noop */ }
  })());
});

// Sin fetch handler: las peticiones van directo a la red (sin intercepción).
