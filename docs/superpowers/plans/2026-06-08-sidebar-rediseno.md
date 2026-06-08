# Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace emoji nav icons with monochrome inline SVG, add collapse/expand toggle with localStorage persistence, and implement a functional pill-style active nav indicator.

**Architecture:** A single CSS custom property `--sidebar-width` drives both `nav { width }` and `main { margin-left }` on desktop; `body.sidebar-collapsed` overrides the variable to `64px`. A new `js/sidebar.js` reads/writes `localStorage` and handles the toggle. `js/router.js` gains `setActiveNav(hash)` called after each route load. All markup changes live in `index.html`.

**Tech Stack:** Vanilla JS (IIFE), CSS custom properties + `color-mix()`, Lucide-style inline SVG (no CDN, no build step), `localStorage`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `css/layout.css` | Modify | CSS variables, collapsed state, pill active, toggle styles, SVG icon sizing |
| `js/sidebar.js` | **Create** | Toggle click handler, localStorage read/write, aria updates |
| `js/router.js` | Modify | `setActiveNav(hash)` function, call it after each route load |
| `index.html` | Modify | SVG icons (7 nav items + logout), toggle button markup, `<script src="js/sidebar.js">` |

---

## SVG Reference (Lucide 24px, stroke-only)

All SVGs share these attributes on the `<svg>` element:
```
viewBox="0 0 24 24" aria-hidden="true" class="nav-icon"
```
The `.nav-icon` class (defined in Task 1) sets `width`, `height`, `stroke`, `fill`, `stroke-width`, etc. — the SVG elements themselves only need `viewBox` and `aria-hidden`.

| Item | Inner paths |
|---|---|
| Dashboard | `<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>` |
| Transacción | `<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>` |
| Historial | `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>` |
| Gráficos | `<path d="M3 3v18h18"/><path d="M7 16V11"/><path d="M11 16V8"/><path d="M15 16V5"/>` |
| Metas | `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>` |
| Oráculo | `<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>` |
| Configuración | `<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>` |
| Logout | `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>` |
| Toggle (expanded → collapse) | `<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>` |
| Toggle (collapsed → expand) | `<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/>` |

---

### Task 1: CSS — variables, collapsed state, pill active, toggle styles

**Files:**
- Modify: `css/layout.css`

Context: `layout.css` has no `:root` block today. Desktop sidebar is `width: 220px` (hardcoded) and `main { margin-left: 220px }` (hardcoded). Active indicator uses `border-left: 3px solid`. Mobile bottom bar stays structurally unchanged — only `.nav-icon` sizing changes (emoji → SVG).

- [ ] **Step 1: Read the full current `css/layout.css`**

Open `css/layout.css`. The sections to touch:
  - Line 125-128: `.nav-icon { font-size: 1.2rem; }` → replace with SVG sizing
  - Lines 140-144: `nav a.active` (mobile) → keep `border-top`, remove font/color duplication later in desktop block
  - Lines 163: `width: 220px` inside `@media (min-width: 768px) nav { ... }` → replace with var
  - Lines 210-213: `nav a { border-left: 3px solid transparent; transition: ... }` → remove border-left, add border-radius
  - Lines 219-222: `nav a:hover { border-left: ... }` → replace with background tint
  - Lines 224-229: `nav a.active` (desktop override) → replace border-left with pill
  - Lines 232-236: `main { margin-left: 220px; }` → replace with var

- [ ] **Step 2: Add `:root` block and `body.sidebar-collapsed` rules at the top of `layout.css`**

Insert immediately after the opening comment block (before `body { display: flex; ... }`):

```css
/* ─────────────────────────────────────────────────────────────── */
/* Sidebar Width Tokens                                             */
/* ─────────────────────────────────────────────────────────────── */

:root {
  --sidebar-width: 240px;
  --sidebar-width-collapsed: 64px;
}

/* Collapsed state — desktop only, driven by js/sidebar.js         */
@media (min-width: 768px) {
  body.sidebar-collapsed {
    --sidebar-width: var(--sidebar-width-collapsed);
  }

  body.sidebar-collapsed .navbar-brand {
    display: none;
  }

  body.sidebar-collapsed .nav-label {
    display: none;
  }

  body.sidebar-collapsed .user-info {
    display: none;
  }

  body.sidebar-collapsed .user-chip {
    justify-content: center;
    padding: var(--space-sm) 0;
  }

  body.sidebar-collapsed nav a {
    justify-content: center;
    padding: var(--space-md) var(--space-sm);
  }
}
```

- [ ] **Step 3: Update `.nav-icon` to SVG sizing**

Find and replace the current `.nav-icon` rule:

```css
/* BEFORE */
.nav-icon {
  font-size: 1.2rem;
  line-height: 1;
}
```

Replace with:

```css
.nav-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}
```

- [ ] **Step 4: Update hardcoded `220px` in desktop `nav` to use var**

Find inside `@media (min-width: 768px) { nav { ... } }`:

```css
/* BEFORE */
    width: 220px;
```

Replace with:

```css
    width: var(--sidebar-width);
    transition: width 0.2s ease;
```

- [ ] **Step 5: Update desktop `nav a` — remove border-left, add border-radius + transition**

Find inside `@media (min-width: 768px)`:

```css
  nav a {
    flex-direction: row;    /* sidebar: icon + label in a row */
    gap: var(--space-sm);
    width: 100%;
    height: auto;
    padding: var(--space-md);
    font-size: var(--font-size-base);
    border-bottom: none;
    border-left: 3px solid transparent;
    transition: border-left 0.2s, color 0.2s;
  }
```

Replace with:

```css
  nav a {
    flex-direction: row;    /* sidebar: icon + label in a row */
    gap: var(--space-sm);
    width: 100%;
    height: auto;
    padding: var(--space-md);
    font-size: var(--font-size-base);
    border-bottom: none;
    border-left: none;
    border-radius: var(--radius-md);
    transition: background 0.2s, color 0.2s;
  }
```

- [ ] **Step 6: Update desktop `nav a:hover` — replace border-left with background tint**

Find:

```css
  nav a:hover {
    color: var(--color-primary);
    border-left: 3px solid var(--color-primary);
  }
```

Replace with:

```css
  nav a:hover {
    color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
    text-decoration: none;
  }
```

- [ ] **Step 7: Update desktop `nav a.active` — replace border-left with pill**

Find:

```css
  nav a.active {
    color: var(--color-primary);
    border-top: none;          /* reset mobile border-top indicator */
    border-left: 3px solid var(--color-primary);
    border-bottom: none;
  }
```

Replace with:

```css
  nav a.active {
    color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    border-top: none;
    border-left: none;
    border-bottom: none;
  }
```

- [ ] **Step 8: Update hardcoded `220px` in desktop `main` to use var**

Find:

```css
  /* Main Content — Desktop Layout */
  main {
    flex: 1;
    margin-left: 220px;
    margin-bottom: 0;
  }
```

Replace with:

```css
  /* Main Content — Desktop Layout */
  main {
    flex: 1;
    margin-left: var(--sidebar-width);
    margin-bottom: 0;
    transition: margin-left 0.2s ease;
  }
```

- [ ] **Step 9: Add `.sidebar-toggle` button styles**

Append at the end of `layout.css` (before final closing, after the scrollbar section):

```css
/* ─────────────────────────────────────────────────────────────── */
/* Sidebar Toggle Button — Desktop Only                             */
/* ─────────────────────────────────────────────────────────────── */

.sidebar-toggle {
  display: none; /* hidden on mobile */
}

@media (min-width: 768px) {
  .sidebar-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
    padding: var(--space-sm);
    border-radius: var(--radius-md);
    transition: color 0.2s, background 0.2s;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    align-self: flex-end;
    margin-bottom: var(--space-sm);
  }

  .sidebar-toggle:hover {
    color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
  }

  .sidebar-toggle .nav-icon {
    pointer-events: none;
  }
}

/* Reduced motion — disable sidebar transitions */
@media (prefers-reduced-motion: reduce) {
  nav,
  main {
    transition: none;
  }
}
```

- [ ] **Step 10: Commit CSS changes**

```bash
git add css/layout.css
git commit -m "style: sidebar CSS variables, collapsed state, pill active indicator, SVG icon sizing"
```

---

### Task 2: Create `js/sidebar.js`

**Files:**
- Create: `js/sidebar.js`

Context: New file, loaded after `router.js` in `index.html` (added in Task 4). Runs as IIFE matching the codebase's module pattern. Reads `localStorage` on load to restore state, then wires the toggle button.

- [ ] **Step 1: Create `js/sidebar.js` with the following content**

```js
// sidebar.js — Collapse/expand sidebar toggle with localStorage persistence
// Loaded after router.js in index.html.
// Depends on: #sidebarToggle button being present in index.html (desktop only via CSS).

(function () {
  'use strict';

  var STORAGE_KEY = 'sidebar-collapsed';

  // SVG inner paths for panel-left-close (expanded → click to collapse)
  var SVG_CLOSE =
    '<svg viewBox="0 0 24 24" aria-hidden="true" class="nav-icon">' +
    '<rect width="18" height="18" x="3" y="3" rx="2"/>' +
    '<path d="M9 3v18"/>' +
    '<path d="m16 15-3-3 3-3"/>' +
    '</svg>';

  // SVG inner paths for panel-left-open (collapsed → click to expand)
  var SVG_OPEN =
    '<svg viewBox="0 0 24 24" aria-hidden="true" class="nav-icon">' +
    '<rect width="18" height="18" x="3" y="3" rx="2"/>' +
    '<path d="M9 3v18"/>' +
    '<path d="m14 9 3 3-3 3"/>' +
    '</svg>';

  function readStorage() {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch (e) {
      return false; // private mode or blocked — default to expanded
    }
  }

  function writeStorage(collapsed) {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? 'true' : 'false');
    } catch (e) {
      // silent — toggle still works for this session
    }
  }

  function applyState(collapsed) {
    document.body.classList.toggle('sidebar-collapsed', collapsed);

    var btn = document.getElementById('sidebarToggle');
    if (!btn) return;

    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    btn.setAttribute('aria-label', collapsed ? 'Expandir menú' : 'Contraer menú');
    btn.innerHTML = collapsed ? SVG_OPEN : SVG_CLOSE;
  }

  // Init: restore persisted state on page load
  applyState(readStorage());

  // Wire toggle button
  var toggleBtn = document.getElementById('sidebarToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      var collapsed = !document.body.classList.contains('sidebar-collapsed');
      writeStorage(collapsed);
      applyState(collapsed);
    });
  }
})();
```

- [ ] **Step 2: Verify file exists**

```bash
ls js/sidebar.js
```

Expected output: `js/sidebar.js` (no error).

- [ ] **Step 3: Commit**

```bash
git add js/sidebar.js
git commit -m "feat: sidebar.js — collapse/expand toggle with localStorage persistence"
```

---

### Task 3: Add `setActiveNav` to `js/router.js`

**Files:**
- Modify: `js/router.js`

Context: `router.js` has a `handleRouteChange()` async function. After `loadView(route.view)`, it calls `updateUserChip()` but **never sets the active nav link** — the `nav a.active` CSS class is defined but nothing applies it. The fix: add `setActiveNav(hash)` and call it from `handleRouteChange` after `setChromeVisible`.

- [ ] **Step 1: Add `setActiveNav` function to `router.js`**

Insert the function immediately before `async function handleRouteChange()` (around line 124):

```js
// setActiveNav(hash) — Mark the matching nav link as active
// Args: hash (string) — current route hash, e.g. 'dashboard', 'metas'
// Called after each successful route load for protected (chrome-visible) routes.
function setActiveNav(hash) {
  var links = document.querySelectorAll('.nav-link');
  links.forEach(function (link) {
    var active = link.getAttribute('href') === '#' + hash;
    link.classList.toggle('active', active);
    if (active) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}
```

- [ ] **Step 2: Call `setActiveNav` in `handleRouteChange`**

Inside `handleRouteChange`, find the block:

```js
    // Hide navbar on public views, show it inside the app
    setChromeVisible(!isPublic);

    // Load the matching view from views/
    await loadView(route.view);

    // Actualizar chip de usuario en vistas protegidas (sesión activa)
    if (!isPublic && typeof updateUserChip === 'function') {
      updateUserChip();
    }
```

Replace with:

```js
    // Hide navbar on public views, show it inside the app
    setChromeVisible(!isPublic);

    // Load the matching view from views/
    await loadView(route.view);

    // Mark matching nav link as active (only when nav is visible)
    if (!isPublic) {
      setActiveNav(hash);
    }

    // Actualizar chip de usuario en vistas protegidas (sesión activa)
    if (!isPublic && typeof updateUserChip === 'function') {
      updateUserChip();
    }
```

- [ ] **Step 3: Commit**

```bash
git add js/router.js
git commit -m "feat: setActiveNav — apply .active + aria-current to matching nav link on route change"
```

---

### Task 4: Update `index.html` — SVG icons, toggle button, sidebar.js script tag

**Files:**
- Modify: `index.html`

Context: `index.html` has 7 nav items with `<span class="nav-icon">emoji</span>`. The logout button uses `🔓`. No toggle button exists. `js/sidebar.js` is not yet loaded. The `ul` has `class="navbar-links"` (keep as-is).

- [ ] **Step 1: Add the sidebar toggle button inside `.navbar-brand`**

Find in `index.html`:

```html
            <div class="navbar-brand">
                <img src="assets/nestra_logo.png?v=2" alt="Nestra" class="navbar-logo brand-logo--light" />
                <img src="assets/nestra_logo_dark.png?v=2" alt="Nestra" class="navbar-logo brand-logo--dark" />
            </div>
```

Replace with:

```html
            <div class="navbar-brand">
                <img src="assets/nestra_logo.png?v=2" alt="Nestra" class="navbar-logo brand-logo--light" />
                <img src="assets/nestra_logo_dark.png?v=2" alt="Nestra" class="navbar-logo brand-logo--dark" />
            </div>
            <!-- Toggle collapse — desktop only (hidden on mobile via CSS) -->
            <button id="sidebarToggle" class="sidebar-toggle"
                    aria-label="Contraer menú" aria-expanded="true" type="button">
                <!-- Icon injected by js/sidebar.js on load -->
            </button>
```

- [ ] **Step 2: Replace Dashboard nav icon**

Find:

```html
                    <a href="#dashboard" class="nav-link">
                        <span class="nav-icon">📊</span>
                        <span class="nav-label">Dashboard</span>
                    </a>
```

Replace with:

```html
                    <a href="#dashboard" class="nav-link" title="Dashboard">
                        <svg viewBox="0 0 24 24" aria-hidden="true" class="nav-icon"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
                        <span class="nav-label">Dashboard</span>
                    </a>
```

- [ ] **Step 3: Replace Transacción nav icon**

Find:

```html
                    <a href="#transaccion" class="nav-link">
                        <span class="nav-icon">💳</span>
                        <span class="nav-label">Transacción</span>
                    </a>
```

Replace with:

```html
                    <a href="#transaccion" class="nav-link" title="Transacción">
                        <svg viewBox="0 0 24 24" aria-hidden="true" class="nav-icon"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                        <span class="nav-label">Transacción</span>
                    </a>
```

- [ ] **Step 4: Replace Historial nav icon**

Find:

```html
                    <a href="#historial" class="nav-link">
                        <span class="nav-icon">📜</span>
                        <span class="nav-label">Historial</span>
                    </a>
```

Replace with:

```html
                    <a href="#historial" class="nav-link" title="Historial">
                        <svg viewBox="0 0 24 24" aria-hidden="true" class="nav-icon"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>
                        <span class="nav-label">Historial</span>
                    </a>
```

- [ ] **Step 5: Replace Gráficos nav icon**

Find:

```html
                    <a href="#graficos" class="nav-link">
                        <span class="nav-icon">📊</span>
                        <span class="nav-label">Gráficos</span>
                    </a>
```

Replace with:

```html
                    <a href="#graficos" class="nav-link" title="Gráficos">
                        <svg viewBox="0 0 24 24" aria-hidden="true" class="nav-icon"><path d="M3 3v18h18"/><path d="M7 16V11"/><path d="M11 16V8"/><path d="M15 16V5"/></svg>
                        <span class="nav-label">Gráficos</span>
                    </a>
```

- [ ] **Step 6: Replace Metas nav icon**

Find:

```html
                    <a href="#metas" class="nav-link">
                        <span class="nav-icon">🎯</span>
                        <span class="nav-label">Metas</span>
                    </a>
```

Replace with:

```html
                    <a href="#metas" class="nav-link" title="Metas">
                        <svg viewBox="0 0 24 24" aria-hidden="true" class="nav-icon"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
                        <span class="nav-label">Metas</span>
                    </a>
```

- [ ] **Step 7: Replace Oráculo nav icon**

Find:

```html
                    <a href="#decisiones" class="nav-link">
                        <span class="nav-icon">🔮</span>
                        <span class="nav-label">Oráculo</span>
                    </a>
```

Replace with:

```html
                    <a href="#decisiones" class="nav-link" title="Oráculo">
                        <svg viewBox="0 0 24 24" aria-hidden="true" class="nav-icon"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>
                        <span class="nav-label">Oráculo</span>
                    </a>
```

- [ ] **Step 8: Replace Configuración nav icon**

Find:

```html
                    <a href="#configuracion" class="nav-link">
                        <span class="nav-icon">⚙️</span>
                        <span class="nav-label">Configuración</span>
                    </a>
```

Replace with:

```html
                    <a href="#configuracion" class="nav-link" title="Configuración">
                        <svg viewBox="0 0 24 24" aria-hidden="true" class="nav-icon"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                        <span class="nav-label">Configuración</span>
                    </a>
```

- [ ] **Step 9: Replace logout button emoji with SVG**

Find:

```html
                    <button class="logout-btn" data-logout-trigger type="button">
                        <span aria-hidden="true">🔓</span> Cerrar sesión
                    </button>
```

Replace with:

```html
                    <button class="logout-btn" data-logout-trigger type="button">
                        <svg viewBox="0 0 24 24" aria-hidden="true" class="nav-icon"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
                        Cerrar sesión
                    </button>
```

- [ ] **Step 10: Add `js/sidebar.js` script tag**

Find near the bottom of `index.html`:

```html
    <script src="js/router.js"></script>
```

Replace with:

```html
    <script src="js/router.js"></script>
    <script src="js/sidebar.js"></script>
```

- [ ] **Step 11: Commit `index.html` changes**

```bash
git add index.html
git commit -m "feat: replace nav emoji icons with inline SVG, add sidebar collapse toggle"
```

---

## Verification Checklist (browser, no test framework)

Open the app in a browser (live server or direct file). Work through these checks:

**Desktop (≥768px viewport):**
- [ ] Sidebar shows 7 nav items with monochrome SVG icons — no emojis visible.
- [ ] Logout chip shows SVG icon (no 🔓).
- [ ] Click the toggle button → sidebar collapses to ~64px showing only icons; `main` content area reflows without horizontal scroll or overlap.
- [ ] Labels hidden when collapsed; icons centered; logo hidden.
- [ ] Reload page → sidebar stays collapsed (localStorage persisted).
- [ ] Click toggle again → sidebar expands to 240px; labels reappear.
- [ ] Reload page → sidebar stays expanded.
- [ ] Navigate between routes (e.g. Dashboard → Metas → Historial) → the active link gets a visible tinted background pill + `--color-primary` icon/text color.
- [ ] `aria-current="page"` on the active link (inspect element).
- [ ] `aria-expanded` on toggle button matches visual state.
- [ ] Hover non-active links → light tint, no border-left artifact.
- [ ] Dark mode: icons and pill look correct with `currentColor` + `color-mix`.

**Mobile (<768px viewport):**
- [ ] Bottom bar visible; toggle button NOT visible.
- [ ] SVG icons display correctly at 20px in bottom bar.
- [ ] No horizontal overflow.
- [ ] `body.sidebar-collapsed` (if set) has no visible effect on mobile layout.

**Auth views (login/register):**
- [ ] Nav hidden (`body.no-chrome`); no regressions.

---

## Edge Cases Handled

| Scenario | Behavior |
|---|---|
| `localStorage` blocked (private mode) | `try/catch` in `sidebar.js` — toggle works in session, no persist |
| Route not in nav (e.g. `resumen`, `prestamos`) | No link gets `.active` — safe, no error |
| Mobile with `sidebar-collapsed` in localStorage | CSS `@media (min-width: 768px)` scopes all collapsed rules — mobile unaffected |
| Login/register (`no-chrome`) | Nav hidden; `setActiveNav` still runs (harmless — no links visible) |
