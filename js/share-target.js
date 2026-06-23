// js/share-target.js — consume el payload del Web Share Target.
// Depende de window.parseSharedMonto (js/share-parse.js),
// isAuthenticated() (js/auth.js) y abrirModalTransaccion() (index.html).

function _whenAuthed(timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    (function check() {
      if (typeof isAuthenticated === 'function' && isAuthenticated()) return resolve(true);
      if (Date.now() - start > (timeoutMs || 6000)) return resolve(false);
      setTimeout(check, 250);
    })();
  });
}

async function _consumeShare() {
  const params = new URLSearchParams(location.search);
  if (params.get('shared') !== '1') return;
  // Limpia el query para que un reload no re-dispare el share.
  history.replaceState(null, '', location.pathname + location.hash);

  let payload = null;
  let imageURL = null;
  try {
    const cache = await caches.open('nestra-share');
    const res = await cache.match('/__share_data__');
    if (res) payload = await res.json();
    if (payload && payload.hasImage) {
      const img = await cache.match('/__share_image__');
      if (img) imageURL = URL.createObjectURL(await img.blob());
    }
    await cache.delete('/__share_data__');
    await cache.delete('/__share_image__');
  } catch (err) {
    console.error('share consume:', err);
    return;
  }
  if (!payload) return;

  const texto = [payload.title, payload.text, payload.url]
    .filter(Boolean).join(' ').trim();
  const monto = (typeof parseSharedMonto === 'function') ? parseSharedMonto(texto) : null;

  window._sharePrefill = { monto, nota: texto || null, imageURL };

  const ok = await _whenAuthed();
  if (!ok) return; // sin sesión: el prefill queda listo si el usuario abre el form luego
  if (typeof abrirModalTransaccion === 'function') abrirModalTransaccion();
}

document.addEventListener('DOMContentLoaded', _consumeShare);
