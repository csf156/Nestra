# Fase 1 — Integraciones nativas faltantes (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar las tres integraciones nativas de la Fase 1 que faltaron en la v2 de Nestra: App Shortcuts, Web Share Target y desbloqueo biométrico WebAuthn (candado local).

**Architecture:** App vanilla sin build, scripts clásicos cargados en orden desde `index.html`, Service Worker con Workbox 7 vendorizado. Las tres features son aditivas: (6) shortcuts es solo manifest; (7) share target añade un handler `fetch` POST en el SW que cachea el payload y redirige a la app, donde un script de página abre el modal de transacción precargado; (8) WebAuthn es un candado de UX **client-only** — la aserción NO se verifica en backend, solo desbloquea la UI sobre la sesión Supabase ya válida. Lógica pura (parseo de monto compartido) se aísla en un módulo ESM testeable con `node --test`.

**Tech Stack:** HTML/CSS/JS vanilla, Workbox 7, idb, Web Share Target API, WebAuthn (`navigator.credentials`), node:test para tests unitarios.

**Decisión de diseño confirmada con el usuario:** WebAuthn = **candado local** (sin verificación en servidor). `credentials.create` registra; el `rawId` se guarda en `localStorage`; al abrir con sesión válida + biométrico activado, `credentials.get` desbloquea la UI. Fallback a sesión normal (login con contraseña) si no hay WebAuthn o el usuario cancela.

**Nota sobre context7:** Web Share Target y WebAuthn son APIs de plataforma (no librerías de registro), por lo que context7 no aporta docs útiles; la verificación real es la prueba manual en preview exigida por la spec (Task 5).

---

### Task 1: App Shortcuts en el manifest (item 6)

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: Añadir el array `shortcuts` al manifest**

Edita `manifest.json` y añade `shortcuts` después del array `icons` (antes del `}` final). Los dos accesos que pide la spec: "＋ Gasto" → `#transaccion` y "Ver mes" → `#resumen`.

```json
  "shortcuts": [
    {
      "name": "Nuevo gasto",
      "short_name": "＋ Gasto",
      "description": "Registrar una transacción rápida",
      "url": "/#transaccion",
      "icons": [{ "src": "assets/icon-192.png", "sizes": "192x192", "type": "image/png" }]
    },
    {
      "name": "Ver mes",
      "short_name": "Ver mes",
      "description": "Resumen del mes actual",
      "url": "/#resumen",
      "icons": [{ "src": "assets/icon-192.png", "sizes": "192x192", "type": "image/png" }]
    }
  ]
```

El bloque `icons` actual termina en `]` sin coma final; añade la coma tras ese `]` y luego el bloque `shortcuts`.

- [ ] **Step 2: Verificar JSON válido**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Verificar que `#transaccion` abre el formulario**

`#transaccion` debe resolver a algo útil. Comprueba en `js/router.js` si existe una ruta `transaccion`. Si NO existe, el shortcut "＋ Gasto" debe apuntar a una ruta que abra el modal. Usa `grep`:

Run: `grep -n "transaccion\|resumen" js/router.js`
Expected: confirmar que `resumen` es una ruta válida. Si `transaccion` no es ruta, cambia el `url` del primer shortcut a `/#dashboard?nuevo=1` y añade en `js/router.js`/`index.html` un listener que, si `location.search` incluye `nuevo=1`, llame `abrirModalTransaccion()`. Documenta cuál de las dos opciones aplicaste.

- [ ] **Step 4: Commit**

```bash
git add manifest.json js/router.js
git commit -m "feat(fase1): app shortcuts (Gasto, Ver mes) en el manifest"
```

---

### Task 2: Web Share Target — parser de monto (item 7, lógica pura primero / TDD)

**Files:**
- Create: `js/share-parse.js`
- Test: `test/share-parse.test.mjs`

- [ ] **Step 1: Escribir el test que falla**

Crea `test/share-parse.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSharedMonto } from '../js/share-parse.js';

test('extrae monto con prefijo S/ y decimales', () => {
  assert.equal(parseSharedMonto('Te Yapearon S/ 50.00 de Juan Perez'), 50);
});

test('extrae monto con separador de miles', () => {
  assert.equal(parseSharedMonto('Pago de 1,250.50 soles'), 1250.5);
});

test('coma como separador decimal', () => {
  assert.equal(parseSharedMonto('Almuerzo 25,90'), 25.9);
});

test('numero entero suelto', () => {
  assert.equal(parseSharedMonto('150'), 150);
});

test('S/ pegado al numero', () => {
  assert.equal(parseSharedMonto('Cobro S/8'), 8);
});

test('texto sin monto devuelve null', () => {
  assert.equal(parseSharedMonto('captura sin importe'), null);
});

test('entrada nula devuelve null', () => {
  assert.equal(parseSharedMonto(null), null);
});

test('cero o negativo no es valido', () => {
  assert.equal(parseSharedMonto('S/ 0.00'), null);
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `node --test test/share-parse.test.mjs`
Expected: FAIL — `Cannot find module '../js/share-parse.js'`

- [ ] **Step 3: Implementar el módulo**

Crea `js/share-parse.js` (módulo ESM con doble export, igual idiom que `js/sync-lww.js`):

```javascript
// js/share-parse.js — extrae un monto de texto compartido (Web Share Target).
// Cárgalo como <script type="module"> (expone window.parseSharedMonto) y como
// módulo ESM en Node (export). Heurística es-PE: prefijo S/, miles con coma,
// decimal con punto o coma.

function _normalizeNum(raw) {
  let s = String(raw).replace(/\s/g, '');
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const tho = dec === '.' ? ',' : '.';
    s = s.split(tho).join('');
    if (dec === ',') s = s.replace(',', '.');
  } else if (hasComma) {
    if (/,\d{1,2}$/.test(s)) s = s.replace(',', '.');
    else s = s.split(',').join('');
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseSharedMonto(text) {
  if (text == null) return null;
  const str = String(text);
  let m = str.match(/S\/\.?\s*([\d.,]+)/i);
  if (!m) m = str.match(/(\d[\d.,]*\d|\d)/);
  if (!m) return null;
  const n = _normalizeNum(m[1] || m[0]);
  return (n != null && n > 0) ? n : null;
}

if (typeof window !== 'undefined') { window.parseSharedMonto = parseSharedMonto; }
export { parseSharedMonto };
```

- [ ] **Step 4: Ejecutar el test para verificar que pasa**

Run: `node --test test/share-parse.test.mjs`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add js/share-parse.js test/share-parse.test.mjs
git commit -m "feat(fase1): parser puro de monto para share target + tests"
```

---

### Task 3: Web Share Target — manifest + handler en SW + script de página (item 7)

**Files:**
- Modify: `manifest.json`
- Modify: `sw.js`
- Create: `js/share-target.js`
- Modify: `views/transaccion.html:803-836` (rama de carga inicial — leer prefill)
- Modify: `views/transaccion.html` (añadir contenedor de preview de imagen)
- Modify: `index.html:142-164` (cargar scripts nuevos)

- [ ] **Step 1: Registrar el share target en el manifest**

Añade a `manifest.json`, tras el bloque `shortcuts` (con coma entre ambos):

```json
  "share_target": {
    "action": "share-target",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "title": "title",
      "text": "text",
      "url": "url",
      "files": [{ "name": "image", "accept": ["image/*", "image/png", "image/jpeg"] }]
    }
  }
```

`action` es relativo al `scope` `/` → la PWA recibirá el POST en `/share-target`.

- [ ] **Step 2: Verificar JSON válido**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Añadir el handler `fetch` del share en el SW**

En `sw.js`, añade **antes** del bloque `// ── Web Push` (línea ~93), un listener `fetch` que solo intercepta el POST del share (cualquier otra request la siguen manejando las rutas de Workbox):

```javascript
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
```

- [ ] **Step 4: Crear el script de página que consume el share**

Crea `js/share-target.js` (script clásico). Lee `?shared=1`, recupera el payload de la cache, calcula prefill (monto vía `parseSharedMonto`, nota = texto compartido, imagen vía object URL), espera a que haya sesión y abre el modal:

```javascript
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
```

- [ ] **Step 5: Añadir el contenedor de preview de imagen al formulario**

En `views/transaccion.html`, justo después de la apertura del `<form id="transaccionForm" novalidate>` (línea 32), añade:

```html
      <!-- Preview de captura compartida (Web Share Target) -->
      <div id="txSharePreview" class="tx-share-preview" style="display:none;">
        <img id="txShareImg" alt="Captura compartida" />
        <p class="form-hint">Captura recibida. Verifica el monto detectado o ingrésalo manualmente.</p>
      </div>
```

Y añade al bloque `<style>` de esa vista (antes de `</style>`, línea ~451):

```css
  .tx-share-preview {
    margin-bottom: var(--space-md);
    padding: var(--space-sm);
    background: var(--bg-light-secondary);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
  }
  .tx-share-preview img {
    max-width: 100%;
    max-height: 180px;
    border-radius: var(--radius-sm);
    display: block;
    margin: 0 auto var(--space-xs);
  }
```

- [ ] **Step 6: Leer el prefill en la carga inicial del formulario**

En `views/transaccion.html`, en la rama `else` de la carga inicial (líneas 832-835, el caso de alta nueva), reemplaza:

```javascript
    } else {
      cargarCategorias();
      _mostrarAporteHogar();
    }
```

por:

```javascript
    } else {
      cargarCategorias();
      _mostrarAporteHogar();
      // Prefill desde Web Share Target (captura de Yape, etc.). Se consume una vez.
      const sp = window._sharePrefill || null;
      window._sharePrefill = null;
      if (sp) {
        if (sp.monto != null) montoEl.value = sp.monto;
        if (sp.nota) notaEl.value = sp.nota;
        if (sp.imageURL) {
          const prev = document.getElementById('txSharePreview');
          const img = document.getElementById('txShareImg');
          if (prev && img) { img.src = sp.imageURL; prev.style.display = 'block'; }
        }
      }
    }
```

Nota: el modal precarga la imagen como ayuda visual; no se persiste (no hay columna de imagen en transacciones). El usuario confirma/corrige el monto detectado.

- [ ] **Step 7: Cargar los scripts nuevos en index.html**

En `index.html`, tras `<script src="js/db.js"></script>` (línea 158) añade el módulo de parseo, y junto a `js/pwa.js`/`js/push.js` (línea 403-404) añade el consumidor:

Tras la línea 158 (`<script src="js/db.js"></script>`):
```html
    <script type="module" src="js/share-parse.js"></script>
```

Tras la línea 404 (`<script src="js/push.js"></script>`):
```html
    <script src="js/share-target.js"></script>
```

- [ ] **Step 8: Commit**

```bash
git add manifest.json sw.js js/share-target.js views/transaccion.html index.html
git commit -m "feat(fase1): web share target (SW handler + prefill del modal con imagen)"
```

---

### Task 4: Desbloqueo biométrico WebAuthn — candado local (item 8)

**Files:**
- Create: `js/webauthn.js`
- Modify: `index.html` (snippet head de bloqueo temprano + overlay #bioLock + CSS + carga del script)
- Modify: `views/configuracion.html` (toggle opt-in en Preferencias + init)

- [ ] **Step 1: Crear el módulo WebAuthn**

Crea `js/webauthn.js` (script clásico). Candado local: registra una credencial de plataforma, guarda el `rawId` en `localStorage`, y al desbloquear hace `credentials.get` con `userVerification:'required'`. La aserción NO se verifica en servidor — es un gate de UX sobre la sesión Supabase ya válida.

```javascript
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
```

- [ ] **Step 2: Añadir el bloqueo temprano + overlay + CSS en index.html**

(a) En el `<head>` de `index.html`, justo después del IIFE del tema (línea 12, cierre `</script>`), añade un segundo script inline que marca `bio-locked` **antes** de renderizar, evitando flash de datos:

```html
    <script>
      (function () {
        try {
          if (localStorage.getItem('nestra-bio-enabled') === '1' &&
              localStorage.getItem('sb-token')) {
            document.documentElement.classList.add('bio-locked');
          }
        } catch (e) {}
      })();
    </script>
    <style>
      #bioLock { display: none; }
      html.bio-locked #bioLock {
        display: flex;
        position: fixed; inset: 0; z-index: 9999;
        flex-direction: column; align-items: center; justify-content: center;
        gap: 1rem; padding: 2rem; text-align: center;
        background: var(--bg-light, #fff); color: var(--text-dark, #111);
      }
      #bioLock .bio-lock-icon { width: 56px; height: 56px; opacity: 0.85; }
      #bioLock h2 { margin: 0; font-size: 1.25rem; }
      #bioLock p { margin: 0; color: var(--text-secondary, #666); max-width: 22rem; }
      #bioLock .bio-pass-btn {
        background: none; border: none; color: var(--text-secondary, #666);
        text-decoration: underline; cursor: pointer; font-size: 0.9rem;
      }
    </style>
```

(b) En el `<body>`, justo después de `<body class="no-chrome">` (línea 35), añade el overlay:

```html
    <!-- Candado biométrico (WebAuthn) — visible solo si html.bio-locked -->
    <div id="bioLock" role="dialog" aria-modal="true" aria-labelledby="bioLockTitle">
      <svg class="bio-lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.5" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      <h2 id="bioLockTitle">Nestra está bloqueada</h2>
      <p>Verifica tu identidad para acceder a tus datos.</p>
      <button type="button" class="btn btn-primary" id="bioUnlock">Desbloquear</button>
      <p id="bioLockStatus" role="alert" aria-live="assertive"></p>
      <button type="button" class="bio-pass-btn" id="bioUsePassword">Usar mi contraseña</button>
    </div>
```

(c) Carga el script tras `js/push.js` (línea 404):

```html
    <script src="js/webauthn.js"></script>
```

- [ ] **Step 3: Añadir el toggle opt-in en Configuración**

En `views/configuracion.html`, dentro de la sección Preferencias, tras el `pushToggleRow` (línea 70), añade la fila del toggle biométrico:

```html
      <div class="cfg-pref-row" id="bioToggleRow" hidden>
        <span class="cfg-pref-nombre">Desbloqueo biométrico</span>
        <button type="button" class="cfg-toggle" id="bioToggle"
                role="switch" aria-checked="false" aria-label="Activar desbloqueo biométrico">
          <span class="cfg-toggle-thumb"></span>
        </button>
      </div>
```

- [ ] **Step 4: Inicializar el toggle biométrico**

En `views/configuracion.html`, dentro del IIFE, junto al `initPushToggle()` (tras la línea 1334), añade:

```javascript
    (async function initBioToggle() {
      if (typeof webauthnSupported !== 'function' || !webauthnSupported()) return;
      var avail = false;
      try { avail = await webauthnPlatformAvailable(); } catch (e) {}
      if (!avail) return;
      var row = document.getElementById('bioToggleRow');
      var toggle = document.getElementById('bioToggle');
      if (!row || !toggle) return;
      row.hidden = false;

      function paint(on) {
        toggle.setAttribute('aria-checked', on ? 'true' : 'false');
        toggle.setAttribute('aria-label', on ? 'Desactivar desbloqueo biométrico' : 'Activar desbloqueo biométrico');
      }
      paint(webauthnIsEnabled());

      toggle.addEventListener('click', async function () {
        if (webauthnIsEnabled()) {
          webauthnDisable();
          paint(false);
          mostrarToast('Desbloqueo biométrico desactivado', 3000);
          return;
        }
        toggle.disabled = true;
        try {
          var ok = await webauthnRegister();
          paint(ok);
          mostrarToast(ok ? 'Desbloqueo biométrico activado' : 'No se pudo registrar', 3500);
        } catch (err) {
          paint(false);
          mostrarToast(err.message || 'No se pudo registrar la biometría', 4000);
        } finally {
          toggle.disabled = false;
        }
      });
    })();
```

- [ ] **Step 5: Commit**

```bash
git add js/webauthn.js index.html views/configuracion.html
git commit -m "feat(fase1): desbloqueo biometrico WebAuthn (candado local opt-in)"
```

---

### Task 5: Precache del SW + bump de versión + verificación manual en preview

**Files:**
- Modify: `sw.js:15` (SHELL_VERSION) y `sw.js:18-51` (lista de precache)

- [ ] **Step 1: Añadir los archivos nuevos al precache y subir SHELL_VERSION**

En `sw.js`, cambia `const SHELL_VERSION = 'v5';` por `'v6'`. Añade a la lista `precacheAndRoute` (tras `js/push.js`, línea 39):

```javascript
  { url: 'js/share-parse.js', revision: SHELL_VERSION },
  { url: 'js/share-target.js', revision: SHELL_VERSION },
  { url: 'js/webauthn.js', revision: SHELL_VERSION },
```

- [ ] **Step 2: Correr la suite de tests completa (no romper nada)**

Run: `node --test test/`
Expected: PASS, incluyendo los 8 nuevos de `share-parse.test.mjs`.

- [ ] **Step 3: Verificación manual en preview — Shortcuts (item 6)**

Arranca el preview (`preview_start`). En DevTools → Application → Manifest, confirma que aparecen los 2 shortcuts y el share_target. (Long-press del ícono real requiere instalación en dispositivo; documenta que el manifest está correcto y que el long-press es verificable solo tras instalar.)

- [ ] **Step 4: Verificación manual en preview — Share Target (item 7)**

Simula el flujo sin depender de otra app: con sesión iniciada, navega a `/?shared=1` tras inyectar un payload de prueba en la cache vía `preview_eval`:

```javascript
caches.open('nestra-share').then(c => c.put('/__share_data__',
  new Response(JSON.stringify({ title:'Yape', text:'Te Yapearon S/ 50.00 de Ana', url:'', hasImage:false }),
  { headers:{'Content-Type':'application/json'} })))
  .then(() => location.href = './?shared=1');
```

Expected: se abre el modal de transacción con monto = `50` y nota con el texto. Toma `preview_screenshot`.

- [ ] **Step 5: Verificación manual en preview — WebAuthn (item 8) — SEGURIDAD, con cuidado**

WebAuthn requiere un autenticador. En Chrome DevTools → More tools → WebAuthn, habilita un **virtual authenticator** (CTAP2, internal transport, "Supports user verification" ON). Luego:
  1. En Configuración, activa el toggle "Desbloqueo biométrico" → debe registrar sin error y quedar `aria-checked="true"`. Verifica en consola que `localStorage['nestra-bio-enabled'] === '1'`.
  2. Recarga la app. Debe aparecer el overlay `#bioLock` (datos ocultos). Pulsa "Desbloncar" → el virtual authenticator resuelve `get()` → el overlay desaparece y se ven los datos.
  3. Prueba el fallback: pulsa "Usar mi contraseña" → debe ir a `#login`.
  4. Prueba sin soporte: deshabilita el virtual authenticator y confirma que `webauthnUnlock()` devuelve `true` (no deja al usuario encerrado).

Toma `preview_screenshot` del overlay bloqueado y de la app desbloqueada. Revisa `preview_console_logs` por errores.

- [ ] **Step 6: Commit**

```bash
git add sw.js
git commit -m "chore(fase1): precache de scripts nuevos + bump SHELL_VERSION v6"
```

---

## Self-Review

**Spec coverage (8 items de la Fase 1):**
1. manifest base / iOS meta — ya existía ✅ (sin tarea)
2. SW Workbox shell + Supabase network-first — ya existía ✅
3. IndexedDB espejo (idb) — ya existía ✅
4. Background Sync + badge — ya existía ✅ (page-side outbox; iOS sin Background Sync nativo, documentado)
5. Banner offline + install prompt custom — ya existía ✅
6. App shortcuts → **Task 1** ✅
7. Web Share Target → **Task 2 (parser) + Task 3 (manifest/SW/página)** ✅
8. WebAuthn biométrico → **Task 4** ✅
   Precache/versionado de lo nuevo + pruebas manuales → **Task 5** ✅

**Estrategia de conflictos:** sin cambios — LWW por `updated_at` (`js/sync-lww.js`) sigue vigente; ninguna feature nueva escribe filas que entren en conflicto (share solo precarga el form; webauthn es local).

**Placeholder scan:** sin TODO/TBD; todo el código está completo. Único punto condicional explícito: Task 1 Step 3 (ruta `#transaccion` vs `?nuevo=1`) — se resuelve verificando `js/router.js` y se documenta la opción aplicada.

**Type consistency:** `window._sharePrefill` se escribe en `js/share-target.js` y se lee en `views/transaccion.html` con la misma forma `{monto, nota, imageURL}`. `webauthn*` helpers se definen en `js/webauthn.js` y se consumen en `views/configuracion.html` e `index.html` con las mismas firmas. Claves `localStorage` (`nestra-bio-enabled`, `nestra-bio-credid`, `nestra-bio-userhandle`) consistentes entre el snippet head, `webauthn.js` y la verificación.
