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
  e.preventDefault();
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

  if (_isIOS() && !_isStandalone()) {
    setTimeout(function () { _showInstallPrompt(true); }, 2500);
  }
});
