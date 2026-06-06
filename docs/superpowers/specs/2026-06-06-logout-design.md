# Diseño: Logout con chip de usuario

**Fecha:** 2026-06-06
**Estado:** Aprobado (post code-review)

## Resumen

Agregar opción de cerrar sesión a la aplicación Nestra. Ubicación: chip de usuario en el sidebar (desktop) y sección "Cuenta" en la vista Configuración (móvil). Confirmación via modal antes de ejecutar logout.

## Contexto

- La función `logout()` ya existe en `js/auth.js` — limpia estado, token y redirige a `#login`.
- El navbar en `index.html` no tiene chip de usuario ni botón de logout.
- La vista `views/configuracion.html` no existe aún.
- Breakpoint móvil/desktop: 768px (bottom bar móvil, sidebar desktop).

## Diseño

### 1. Chip de usuario — Sidebar desktop

Ubicado debajo del logo (`navbar-brand`), encima de los nav links.

**Estructura HTML (en `index.html` dentro de `.navbar-container`):**
```html
<div class="user-chip" id="userChip">
  <div class="user-avatar" id="userAvatar">?</div>
  <div class="user-info">
    <span class="user-name" id="userChipName"></span>
    <button class="logout-btn" id="logoutBtn" type="button">
      <span aria-hidden="true">🔓</span> Cerrar sesión
    </button>
  </div>
</div>
```

- `.user-avatar`: círculo verde (`--color-primary`), inicial en mayúscula. Usa `Array.from(nombre)[0]` para manejar caracteres no-ASCII (ñ, é, á...) correctamente. Fallback: `?`.
- `.user-name`: `currentProfile.nombre` o parte local del email (antes del `@`), con `.trim()` aplicado.
- `.logout-btn`: icono 🔓 (emoji con soporte universal) + texto "Cerrar sesión", color danger, sin borde.
- **Icono ⏻ (U+23FB) descartado** — no tiene soporte uniforme en todas las fuentes/SO.
- El chip se oculta por CSS en móvil (`display: none` base, `display: flex` en `@media (min-width: 768px)`). También oculto cuando `body.no-chrome` (vistas públicas). **El chip nunca flashea en login** porque el CSS base lo oculta por defecto.

### 2. Modal de confirmación

HTML estático en `index.html` (no en una vista inyectada) para que sea accesible tanto desde el sidebar como desde `views/configuracion.html`. Oculto con atributo `hidden` por defecto.

**Justificación de ubicación en `index.html`:** El modal debe persistir en el DOM sin importar qué vista esté cargada en `#app`. Si estuviese en una vista inyectada, desaparecería al navegar a otra ruta.

```html
<div class="modal-overlay" id="logoutModal" role="dialog" aria-modal="true"
     aria-labelledby="logoutModalTitle" hidden>
  <div class="modal" id="logoutModalDialog">
    <p class="modal-icon" aria-hidden="true">⚠️</p>
    <h2 class="modal-title" id="logoutModalTitle">¿Cerrar sesión?</h2>
    <p class="modal-body">Serás redirigido al inicio de sesión.</p>
    <p class="modal-error" id="logoutModalError" role="alert" aria-live="assertive" style="display:none;"></p>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="logoutCancelBtn">Cancelar</button>
      <button class="btn btn-danger" id="logoutConfirmBtn">
        <span id="logoutConfirmText">Salir</span>
        <span id="logoutConfirmSpinner" class="spinner" role="status" aria-label="Cerrando sesión" style="display:none;"></span>
      </button>
    </div>
  </div>
</div>
```

**Comportamiento:**
- Abrir: clic en cualquier elemento con `data-logout-trigger` → muestra modal, foco a `#logoutCancelBtn`.
- Cerrar (cancelar): clic en `#logoutCancelBtn`, `Escape`, o clic en `.modal-overlay` fuera de `#logoutModalDialog`.
- `#logoutConfirmBtn` → spinner, deshabilita ambos botones, llama `await logout()`.
  - **Error:** si `logout()` lanza, muestra mensaje en `#logoutModalError`, restaura botones. No cierra el modal.
  - **Éxito:** `logout()` redirige a `#login` — el modal desaparece al destruirse el DOM por navegación.
- **Focus trap** (Tab / Shift+Tab):
  - Elementos focusables dentro del modal: `#logoutCancelBtn`, `#logoutConfirmBtn`.
  - Tab en `#logoutConfirmBtn` → vuelve a `#logoutCancelBtn`.
  - Shift+Tab en `#logoutCancelBtn` → va a `#logoutConfirmBtn`.
  - Implementado con `keydown` listener que intercepta Tab cuando el foco está en los extremos.

**Patrón para múltiples triggers (extensible):**
Todos los botones de logout usan `data-logout-trigger` en lugar de IDs hardcodeados. El listener usa `document.querySelectorAll('[data-logout-trigger]')`. Así, vistas futuras pueden agregar su propio botón sin cambiar JS.

```html
<!-- Sidebar -->
<button class="logout-btn" data-logout-trigger type="button">🔓 Cerrar sesión</button>
<!-- Vista Configuración -->
<button class="btn btn-danger-outline" data-logout-trigger type="button">🔓 Cerrar sesión</button>
```

### 3. Vista Configuración (`views/configuracion.html`)

Vista nueva. Contiene:
1. **Chip informativo de usuario** — avatar + nombre + email (visible en móvil donde el sidebar está oculto). Solo lectura, sin botón logout propio de chip.
2. **Sección Preferencias** — texto "Próximamente" (placeholder para Fase 2).
3. **Sección Cuenta** — botón con `data-logout-trigger`. Al clic abre el modal de `index.html`.

### 4. Estilos (`css/components.css`)

Clases nuevas:

```css
/* Chip de usuario */
.user-chip       /* display:none base; flex row en ≥768px y sin body.no-chrome */
.user-avatar     /* círculo 36px, bg var(--color-primary), texto blanco, centrado */
.user-info       /* flex column, gap 2px */
.user-name       /* font-weight semibold, color var(--text-dark) */
.logout-btn      /* bg:none, border:none, color var(--color-danger), font-size-sm, cursor pointer */
.logout-btn:hover /* opacity 0.8 o subrayado */

/* Modal */
.modal-overlay   /* fixed inset-0, background rgba(0,0,0,0.5), z-index:200, display:flex, align+justify center */
.modal           /* bg var(--bg-light), border var(--border-light), border-radius-lg, padding var(--space-xl), max-width:380px, width:90% */
.modal-icon      /* font-size 2rem, text-align center, margin-bottom */
.modal-title     /* font-size-xl, font-weight-bold, text-dark, text-center */
.modal-body      /* text-secondary, text-center, margin-bottom */
.modal-error     /* color var(--color-danger), font-size-sm, text-center, margin-bottom */
.modal-actions   /* display:flex, gap var(--space-md), justify-content center */
```

### 5. Lógica JS

Inline en `index.html` (script al final del body, después de los scripts existentes):

```javascript
// updateUserChip() — rellena chip con datos del usuario autenticado
// Llamar: (a) al final de initAuth() cuando sesión existe,
//         (b) en handleRouteChange() para vistas protegidas
function updateUserChip() {
  const profile = window.currentProfile;
  const user = window.currentUser;
  const nombre = ((profile?.nombre) || (user?.email?.split('@')[0]) || '').trim();
  // Array.from() maneja correctamente caracteres multi-byte (é, ñ, á, emojis)
  const initial = nombre ? Array.from(nombre)[0].toUpperCase() : '?';
  document.getElementById('userAvatar').textContent = initial;
  document.getElementById('userChipName').textContent = nombre || '—';
}

// Abrir modal
function showLogoutModal() {
  const modal = document.getElementById('logoutModal');
  modal.removeAttribute('hidden');
  document.getElementById('logoutModalError').style.display = 'none';
  document.getElementById('logoutCancelBtn').focus();
}

// Cerrar modal
function hideLogoutModal() {
  document.getElementById('logoutModal').setAttribute('hidden', '');
}

// Focus trap (Tab / Shift+Tab)
document.getElementById('logoutModal').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideLogoutModal(); return; }
  if (e.key !== 'Tab') return;
  const cancel = document.getElementById('logoutCancelBtn');
  const confirm = document.getElementById('logoutConfirmBtn');
  if (e.shiftKey && document.activeElement === cancel) {
    e.preventDefault(); confirm.focus();
  } else if (!e.shiftKey && document.activeElement === confirm) {
    e.preventDefault(); cancel.focus();
  }
});

// Clic fuera del dialog cierra
document.getElementById('logoutModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) hideLogoutModal();
});

// Triggers (sidebar + cualquier vista con data-logout-trigger)
// Usa delegación: escucha en document para cubrir vistas inyectadas dinámicamente
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-logout-trigger]')) showLogoutModal();
});

// Confirmar logout
document.getElementById('logoutConfirmBtn').addEventListener('click', async () => {
  const confirmBtn = document.getElementById('logoutConfirmBtn');
  const cancelBtn = document.getElementById('logoutCancelBtn');
  const errorEl = document.getElementById('logoutModalError');
  const spinner = document.getElementById('logoutConfirmSpinner');
  const text = document.getElementById('logoutConfirmText');

  // Estado de carga
  confirmBtn.disabled = true;
  cancelBtn.disabled = true;
  confirmBtn.setAttribute('aria-busy', 'true');
  spinner.style.display = 'inline-block';
  text.style.display = 'none';
  errorEl.style.display = 'none';

  try {
    await logout(); // redirige a #login si éxito
  } catch (err) {
    // Mostrar error, restaurar botones
    errorEl.textContent = 'Error al cerrar sesión. Intenta de nuevo.';
    errorEl.style.display = 'block';
    confirmBtn.disabled = false;
    cancelBtn.disabled = false;
    confirmBtn.removeAttribute('aria-busy');
    spinner.style.display = 'none';
    text.style.display = 'inline';
  }
});

document.getElementById('logoutCancelBtn').addEventListener('click', hideLogoutModal);
```

### 6. Cambios en `js/router.js`

En `handleRouteChange()`, después de `await loadView(route.view)` en rutas protegidas:
```javascript
if (!isPublic && typeof updateUserChip === 'function') {
  updateUserChip();
}
```

### 7. Cambios en `js/auth.js`

Al final de `initAuth()`, después de `await loadProfile(user.id)`:
```javascript
if (typeof updateUserChip === 'function') {
  updateUserChip();
}
```

## Archivos modificados

| Archivo | Tipo | Descripción |
|---|---|---|
| `index.html` | modificar | Chip usuario, modal de confirmación, script de lógica |
| `css/components.css` | modificar | `.user-chip`, `.modal`, `.modal-overlay`, `.logout-btn` |
| `views/configuracion.html` | crear | Vista con chip informativo + botón logout |
| `js/router.js` | modificar mínimo | Llamar `updateUserChip()` post-carga de vistas protegidas |
| `js/auth.js` | modificar mínimo | Llamar `updateUserChip()` al restaurar sesión en `initAuth()` |

## Accesibilidad

- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` en el modal.
- Focus trap (Tab/Shift+Tab) entre los dos botones del modal.
- `Escape` cierra modal.
- Botón "Salir" con `aria-busy="true"` y spinner durante ejecución.
- Error de logout con `role="alert"` + `aria-live="assertive"`.
- Icono 🔓 con `aria-hidden="true"` (decorativo).
- Contraste: avatar verde (#059669) sobre blanco ≥ 4.5:1 ✓

## Fuera de alcance

- Edición de perfil desde Configuración (Fase 2).
- Toggle de tema claro/oscuro desde Configuración (Fase 2).
- Realtime profiles (comentado en auth.js, TODO existente).
