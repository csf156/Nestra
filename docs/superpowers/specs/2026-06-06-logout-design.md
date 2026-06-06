# Diseño: Logout con chip de usuario

**Fecha:** 2026-06-06
**Estado:** Aprobado

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
  <div class="user-avatar" id="userAvatar">C</div>
  <div class="user-info">
    <span class="user-name" id="userChipName">Carlos</span>
    <button class="logout-btn" id="logoutBtn" type="button">⏻ Cerrar sesión</button>
  </div>
</div>
```

- `.user-avatar`: círculo verde (`--color-primary`), inicial en mayúscula del nombre o email.
- `.user-name`: nombre del perfil (`currentProfile.nombre`) o parte local del email.
- `.logout-btn`: texto `⏻ Cerrar sesión`, color danger, sin borde.
- El chip se muestra solo cuando `body` NO tiene `.no-chrome` (protegido por CSS).

### 2. Modal de confirmación

HTML estático en `index.html`, oculto por defecto. Se muestra al clic en cualquier botón de logout.

```html
<div class="modal-overlay" id="logoutModal" role="dialog" aria-modal="true"
     aria-labelledby="logoutModalTitle" hidden>
  <div class="modal">
    <p class="modal-icon">⚠️</p>
    <h2 class="modal-title" id="logoutModalTitle">¿Cerrar sesión?</h2>
    <p class="modal-body">Serás redirigido al inicio de sesión.</p>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="logoutCancelBtn">Cancelar</button>
      <button class="btn btn-danger" id="logoutConfirmBtn">Salir</button>
    </div>
  </div>
</div>
```

**Comportamiento:**
- Clic en `#logoutBtn` (sidebar) o `#logoutBtnConfig` (configuración) → muestra modal.
- `#logoutCancelBtn` o clic en `.modal-overlay` fuera del `.modal` → cierra modal.
- `Escape` → cierra modal.
- `#logoutConfirmBtn` → llama `logout()` (async), muestra spinner en botón durante ejecución.
- Focus trap: foco queda entre `#logoutCancelBtn` y `#logoutConfirmBtn` mientras modal está abierto.
- Al abrir modal: foco va a `#logoutCancelBtn` (acción segura por defecto).
- `aria-modal="true"`, `role="dialog"`, `aria-labelledby` apuntando al título.

### 3. Vista Configuración (`views/configuracion.html`)

Vista nueva. Contiene:
1. **Chip de usuario** — mismo avatar + nombre + email (visible en móvil donde el sidebar está oculto).
2. **Sección Preferencias** — placeholder vacío para futura configuración (título + texto "Próximamente").
3. **Sección Cuenta** — botón `⏻ Cerrar sesión` con `id="logoutBtnConfig"`.

El botón de logout en la vista llama al mismo modal (referenciado por ID en `index.html`).

### 4. Estilos (`css/components.css`)

Clases nuevas:

```css
/* Chip de usuario */
.user-chip          /* flex row, padding, redondeado, fondo oscuro-secundario */
.user-avatar        /* círculo 36px, color primary, texto blanco, centrado */
.user-info          /* flex column, gap pequeño */
.user-name          /* texto normal, color text-dark */
.logout-btn         /* sin fondo, sin borde, color danger, cursor pointer */

/* Ocultar chip en móvil (no hay room en bottom bar) */
.user-chip          /* display: none en móvil, display: flex en ≥768px */

/* Modal */
.modal-overlay      /* fixed inset-0, background rgba negro 50%, z-index alto, flex center */
.modal              /* background bg-light, border, border-radius-lg, padding, max-width 380px */
.modal-icon         /* font-size grande, text-center */
.modal-title        /* text-dark, bold, text-center */
.modal-body         /* text-secondary, text-center, margin-bottom */
.modal-actions      /* flex, gap, justify-center */
```

### 5. Lógica JS

Inline en `index.html` (script al final del body, después de los scripts existentes):

```javascript
// Rellena chip con datos del usuario autenticado
function updateUserChip() {
  const profile = window.currentProfile;
  const user = window.currentUser;
  const nombre = (profile?.nombre) || (user?.email?.split('@')[0]) || '?';
  const initial = nombre.charAt(0).toUpperCase();
  document.getElementById('userAvatar').textContent = initial;
  document.getElementById('userChipName').textContent = nombre;
}

// Modal helpers
function showLogoutModal() { ... }
function hideLogoutModal() { ... }
// Focus trap, Escape listener, overlay-click listener

// Confirmar logout
document.getElementById('logoutConfirmBtn').addEventListener('click', async () => {
  // Mostrar spinner en botón, deshabilitar ambos botones
  await logout();
  // logout() ya redirige — este código no se alcanza
});
```

`updateUserChip()` se llama desde el router después de cargar cualquier vista protegida (o al evento `hashchange` si el chip ya está en el DOM).

**Actualización del chip:** El chip vive en el DOM estático de `index.html`. `updateUserChip()` debe llamarse cuando:
- La sesión se restaura en `initAuth()` (ya existente).
- El router carga una vista protegida (hook en `handleRouteChange`).

## Archivos modificados

| Archivo | Tipo | Descripción |
|---|---|---|
| `index.html` | modificar | Chip usuario, modal de confirmación, script de lógica |
| `css/components.css` | modificar | `.user-chip`, `.modal`, `.modal-overlay`, `.logout-btn` |
| `views/configuracion.html` | crear | Vista completa con chip y botón logout |
| `js/auth.js` | sin cambios | `logout()` ya implementado |
| `js/router.js` | modificar mínimo | Llamar `updateUserChip()` post-carga de vistas protegidas |

## Accesibilidad

- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` en el modal.
- Focus trap mientras modal abierto (Tab/Shift+Tab).
- `Escape` cierra modal.
- Botón "Salir" con `aria-busy="true"` y spinner durante ejecución.
- Contraste: avatar verde (#059669) sobre blanco ≥ 4.5:1 ✓

## Fuera de alcance

- Edición de perfil desde Configuración (Fase 2).
- Toggle de tema claro/oscuro desde Configuración (pendiente).
- Realtime profiles (comentado en auth.js, TODO existente).
