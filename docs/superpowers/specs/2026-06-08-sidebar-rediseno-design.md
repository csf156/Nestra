# Design: Rediseño del menú lateral (sidebar minimalista + collapse + íconos SVG)

**Date:** 2026-06-08
**Status:** Draft (pending user review)
**Scope:** `index.html` (markup del nav), `css/layout.css` (estilos), `js/router.js` (estado activo), nuevo `js/sidebar.js` (toggle + persistencia). No toca vistas, auth ni db.

---

## Context

El menú vive en un único lugar (`index.html`, `<nav id="navbar">`) y se estiliza en `css/layout.css`:

- **Mobile (<768px):** barra inferior fija de 60px; ícono apilado sobre label.
- **Desktop (≥768px):** sidebar fijo de **220px**; ícono + label en fila; indicador de activo por `border-left`.

Estado verificado:
- Los íconos son **emojis** (`<span class="nav-icon">📊</span>`). Dos repetidos: 📊 en Dashboard y en Gráficos. El logout usa 🔓.
- `main { margin-left: 220px }` (layout.css:234) está **hardcodeado**, acoplado al ancho del sidebar.
- La clase `nav a.active` está definida en CSS (layout.css:140, 224) pero **ningún JS la aplica** — el indicador de activo no funciona hoy; nada depende de esa clase.
- Tokens disponibles (`css/base.css`): `--color-primary` (#059669 claro / #34d399 oscuro), `--bg-light`, `--bg-light-secondary`, `--text-secondary`, `--border-light`, `--space-*`, `--radius-*`. **No** existe un token RGB del primary → para el fondo tenue se usa `color-mix`.
- Router: tabla `ROUTES` hash→vista; `setChromeVisible` togglea `body.no-chrome` en vistas públicas (login). El nav se oculta en `no-chrome`.

---

## Goal

Sidebar de escritorio limpio y minimalista:
1. **Íconos SVG monocromos** (line icons, `currentColor`) en lugar de emojis. Sin emojis en el menú ni en el logout.
2. **Estado activo** funcional: pill con fondo tenue (la clase activa hoy no se aplica → se implementa).
3. **Collapse / expand** del sidebar (solo desktop), con la elección recordada en `localStorage`.

Mobile conserva la barra inferior; solo cambian los íconos (emoji → SVG). El collapse es exclusivo de desktop.

---

## Decisiones (confirmadas)

- **Collapse:** arranca **expandido** por defecto; si el usuario colapsa, persiste entre recargas (`localStorage`, patrón del tema). Sin auto-colapsar por ancho.
- **Activo:** **pill** con fondo `color-mix(in srgb, var(--color-primary) 12%, transparent)` + ícono/texto en `--color-primary`. Se retira el `border-left` como indicador.
- **Íconos:** SVG **inline** (estilo Lucide/Feather), 24px, `stroke: currentColor`, `stroke-width: 2`, `fill: none`. Sin CDN ni build.

---

## Componentes

### 1. Markup (`index.html`)

Dentro de `<nav id="navbar">`, sobre `.navbar-container`:

- **Botón toggle** `#sidebarToggle` (solo visible en desktop vía CSS): ícono chevron/panel, `aria-label="Contraer menú"` / `"Expandir menú"`, `aria-expanded`. Colocado en la zona del brand.

Cada `.nav-link` cambia de:
```html
<a href="#dashboard" class="nav-link">
  <span class="nav-icon">📊</span>
  <span class="nav-label">Dashboard</span>
</a>
```
a:
```html
<a href="#dashboard" class="nav-link">
  <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true" ...>…</svg>
  <span class="nav-label">Dashboard</span>
</a>
```

Set de íconos (Lucide):
| Item | Ícono |
|---|---|
| Dashboard | `layout-dashboard` |
| Transacción | `credit-card` o `arrow-left-right` |
| Historial | `history` o `scroll-text` |
| Gráficos | `bar-chart-3` |
| Metas | `target` |
| Oráculo | `sparkles` o `wand-2` (reemplaza 🔮) |
| Configuración | `settings` |
| Logout (chip) | `log-out` (reemplaza 🔓) |
| Toggle | `panel-left-close` / `panel-left-open` |

La estructura de clases (`.nav-link`, `.nav-icon`, `.nav-label`) se conserva para no romper nada que dependa de ellas. El `href` hash no cambia.

### 2. Estilos (`css/layout.css`)

- **Variable de ancho:** `:root { --sidebar-width: 240px; --sidebar-width-collapsed: 64px; }`.
- `nav` (desktop) usa `width: var(--sidebar-width)`; `main` usa `margin-left: var(--sidebar-width)`. **Elimina el `220px` hardcodeado.**
- **Colapsado:** clase `body.sidebar-collapsed` redefine `--sidebar-width: var(--sidebar-width-collapsed)`. Así nav y main se reajustan juntos con una sola variable.
  - En colapsado: `.nav-label` y el wordmark del brand se ocultan; el `.nav-link` se centra; cada link mantiene `title` para tooltip.
- **Activo:** `.nav-link.active` (o `[aria-current="page"]`): fondo pill `color-mix`, color primary, `border-radius: var(--radius-md)`, sin `border-left`.
- **Toggle:** visible solo en `@media (min-width: 768px)`; oculto en mobile.
- **Transición:** `width`/`margin-left` con `transition: 0.2s ease`; respetar `prefers-reduced-motion`.
- **Íconos SVG:** `.nav-icon { width: 24px; height: 24px; flex-shrink: 0; }`.
- Mobile: las reglas de la barra inferior no cambian salvo el tamaño de `.nav-icon` (ahora SVG); `body.sidebar-collapsed` no aplica en mobile (la media query de collapse es desktop-only).

### 3. Lógica (`js/sidebar.js`, nuevo)

- Al cargar: leer `localStorage.getItem('sidebar-collapsed')`; si `'true'`, añadir `body.sidebar-collapsed` y fijar `aria-expanded=false` en el toggle.
- `#sidebarToggle` click: alterna `body.sidebar-collapsed`, persiste en `localStorage`, actualiza `aria-expanded` y `aria-label`, e intercambia el ícono del toggle.
- Se carga en `index.html` tras `router.js`.

### 4. Estado activo (`js/router.js`)

- Tras resolver la ruta en `handleRouteChange`, marcar el link correspondiente:
  - Quitar `.active` + `aria-current` de todos los `.nav-link`.
  - Añadir `.active` + `aria-current="page"` al `.nav-link` cuyo `href` = `#<ruta>`.
- Mejora neta: hoy no hay indicador funcional.

---

## Arquitectura

```
index.html
├── <nav>: + #sidebarToggle (SVG), nav-links con SVG inline en vez de emoji
└── logout-btn: SVG log-out en vez de 🔓; <script src="js/sidebar.js">

css/layout.css
├── :root --sidebar-width / --sidebar-width-collapsed
├── nav width + main margin-left → var(--sidebar-width)  (quita 220px)
├── body.sidebar-collapsed { --sidebar-width: 64px } + ocultar labels/wordmark
├── .nav-link.active → pill color-mix (quita border-left)
└── #sidebarToggle visible solo ≥768px

js/sidebar.js (nuevo)
└── leer/persistir collapse en localStorage; toggle aria + ícono

js/router.js
└── setActiveNav(ruta): .active + aria-current en el link de la ruta
```

---

## UI / UX (guía de diseño aplicada)

1. **Monocromo > multicolor.** Íconos line en `currentColor` heredan el tema; reducen el ruido visual del menú actual.
2. **El activo se siente, no grita.** Pill con tinte primary al 12% — presencia clara sin el borde duro.
3. **Collapse reversible y recordado.** El usuario controla la densidad; la app respeta su elección.
4. **Colapsado sigue navegable.** Solo íconos + tooltip (`title`); tap/click targets ≥44px.
5. **A11y:** `aria-current="page"` en el activo; `aria-expanded`/`aria-label` en el toggle; SVG con `aria-hidden` (el label da el nombre accesible); `prefers-reduced-motion` respetado; contraste del pill validado en claro y oscuro.
6. **Sin saltos de layout.** `--sidebar-width` sincroniza nav y main; transición suave de 0.2s.

---

## Manejo de errores / edge cases

| Escenario | Comportamiento |
|---|---|
| `localStorage` no disponible (modo privado) | toggle funciona en sesión; no persiste (try/catch silencioso) |
| Ruta sin link en el nav (ej. `resumen`, `prestamos`) | ningún link queda activo (no error) |
| Mobile | sin toggle; `body.sidebar-collapsed` ignorado por la media query; barra inferior intacta |
| Vistas públicas (login) | `body.no-chrome` oculta el nav; el toggle no aplica |

---

## Out of Scope

- **Barrido de emojis app-wide** (vistas, toasts, modales como el 🎉 de Metas, ⚠️ del logout modal) — tarea separada posterior.
- Reordenar o renombrar items del menú.
- Cambios en la barra inferior móvil más allá de los íconos SVG.
- Animación de overlay/off-canvas en mobile (el patrón móvil sigue siendo barra inferior).

---

## Verificación (navegador, sin framework de tests)

- [ ] Desktop: sidebar con íconos SVG monocromos, sin emojis; labels visibles.
- [ ] Toggle contrae a 64px (solo íconos + tooltip) y expande a 240px; `main` se reajusta sin desalineación.
- [ ] La elección de collapse persiste tras recargar (localStorage).
- [ ] El item de la página actual muestra el pill de fondo tenue + color primary; cambia al navegar.
- [ ] `aria-current="page"` en el activo; `aria-expanded` correcto en el toggle.
- [ ] Logout muestra ícono SVG (sin 🔓).
- [ ] Mobile: barra inferior intacta con íconos SVG; sin toggle; sin overflow horizontal.
- [ ] Modo claro y oscuro: íconos y pill con contraste correcto (`currentColor` + `color-mix`).
- [ ] Login/register: nav oculto (no-chrome) sin regresiones.
