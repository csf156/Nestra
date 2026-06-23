// js/webauthn.js — desbloqueo biométrico (candado LOCAL, Fase 1).
// IMPORTANTE: la aserción NO se verifica en backend. Es un candado de UX sobre
// la sesión Supabase ya válida (window.currentUser / localStorage 'sb-token').
// register: navigator.credentials.create → guarda rawId en localStorage.
// unlock: navigator.credentials.get (userVerification required) → libera la UI.

const _BIO_ENABLED = 'nestra-bio-enabled';
const _BIO_CREDID = 'nestra-bio-credid';
const _BIO_HANDLE = 'nestra-bio-userhandle';

function _bufToB64u(buf) {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _b64uToBuf(b64u) {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (b64u.length % 4)) % 4);
  const str = atob(b64);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes.buffer;
}
function _randomBuf(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

function webauthnSupported() {
  return typeof window !== 'undefined' &&
    !!window.PublicKeyCredential &&
    !!(navigator.credentials && navigator.credentials.create);
}

async function webauthnPlatformAvailable() {
  if (!webauthnSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (_) { return false; }
}

function webauthnIsEnabled() {
  try {
    return localStorage.getItem(_BIO_ENABLED) === '1' && !!localStorage.getItem(_BIO_CREDID);
  } catch (_) { return false; }
}

function webauthnDisable() {
  try {
    localStorage.removeItem(_BIO_ENABLED);
    localStorage.removeItem(_BIO_CREDID);
    localStorage.removeItem(_BIO_HANDLE);
  } catch (_) {}
}

async function webauthnRegister() {
  if (!webauthnSupported()) return false;
  const user = window.currentUser;
  if (!user) throw new Error('Necesitas una sesión activa para registrar la biometría.');

  // userHandle estable por usuario (no PII), persistido para futuros get().
  let handleB64 = null;
  try { handleB64 = localStorage.getItem(_BIO_HANDLE); } catch (_) {}
  const handle = handleB64 ? new Uint8Array(_b64uToBuf(handleB64)) : _randomBuf(16);

  const options = {
    challenge: _randomBuf(32),
    rp: { name: 'Nestra', id: location.hostname },
    user: {
      id: handle,
      name: user.email || 'nestra-user',
      displayName: (window.currentProfile && window.currentProfile.nombre) || user.email || 'Nestra',
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },   // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'preferred',
    },
    timeout: 60000,
    attestation: 'none',
  };

  const cred = await navigator.credentials.create({ publicKey: options });
  if (!cred) return false;
  try {
    localStorage.setItem(_BIO_CREDID, _bufToB64u(cred.rawId));
    localStorage.setItem(_BIO_HANDLE, _bufToB64u(handle.buffer || handle));
    localStorage.setItem(_BIO_ENABLED, '1');
  } catch (_) { return false; }
  return true;
}

async function webauthnUnlock() {
  if (!webauthnIsEnabled()) return true; // sin candado → desbloqueado
  if (!webauthnSupported()) return true; // navegador sin soporte → fallback: no bloquear
  let credId = null;
  try { credId = localStorage.getItem(_BIO_CREDID); } catch (_) {}
  if (!credId) return true;

  const options = {
    challenge: _randomBuf(32),
    rpId: location.hostname,
    allowCredentials: [{
      type: 'public-key',
      id: _b64uToBuf(credId),
      transports: ['internal', 'hybrid'],
    }],
    userVerification: 'required',
    timeout: 60000,
  };
  const assertion = await navigator.credentials.get({ publicKey: options });
  return !!assertion;
}

// ── Boot: si la app arrancó bloqueada, esperar tap para desbloquear ──
function _bioUnlockUI() {
  document.documentElement.classList.remove('bio-locked');
}
async function _bioAttempt() {
  const status = document.getElementById('bioLockStatus');
  if (status) status.textContent = '';
  try {
    const ok = await webauthnUnlock();
    if (ok) _bioUnlockUI();
    else if (status) status.textContent = 'Verificación cancelada. Intenta de nuevo.';
  } catch (err) {
    if (status) status.textContent = 'No se pudo verificar. Intenta de nuevo o usa tu contraseña.';
  }
}
document.addEventListener('DOMContentLoaded', function () {
  if (!document.documentElement.classList.contains('bio-locked')) return;
  const unlockBtn = document.getElementById('bioUnlock');
  const passBtn = document.getElementById('bioUsePassword');
  if (unlockBtn) unlockBtn.addEventListener('click', _bioAttempt);
  if (passBtn) passBtn.addEventListener('click', function () {
    _bioUnlockUI();
    if (typeof logout === 'function') logout();
  });
});

if (typeof window !== 'undefined') {
  window.webauthnSupported = webauthnSupported;
  window.webauthnPlatformAvailable = webauthnPlatformAvailable;
  window.webauthnIsEnabled = webauthnIsEnabled;
  window.webauthnDisable = webauthnDisable;
  window.webauthnRegister = webauthnRegister;
  window.webauthnUnlock = webauthnUnlock;
}
