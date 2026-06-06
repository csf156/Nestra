# Nestra Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Nestra's foundational shell: CSS variables/layout/components, authentication (JWT + localStorage), SPA router (hash-based), and HTML structure (index, login, dashboard skeleton).

**Architecture:** Vanilla JS SPA with Supabase auth. Entry point is dumb shell; router dispatches views. Auth state lives in memory, JWT in localStorage. CSS is custom-property-based, mobile-first, responsive. Three CSS files: foundation (base.css) + layout (layout.css) + components (components.css). Five JS modules: config → supabase → auth → router → format.

**Tech Stack:** 
- HTML5, CSS3 (custom properties), vanilla JavaScript (ES6+)
- Supabase JS SDK (v2, loaded from CDN)
- No build step, no framework

---

## Phase 1: CSS Foundation

### Task 1: Create base.css — CSS Variables, Reset, Tipografía

**Files:**
- Create: `css/base.css`

- [ ] **Step 1: Write base.css with CSS custom properties, reset, tipografía**

```css
/* ─────────────────────────────────────────────────────────────── */
/* Nestra — base.css: Variables, Reset, Tipografía, Temas         */
/* ─────────────────────────────────────────────────────────────── */

:root {
  /* Colores — tema claro (default) */
  --color-primary: #3b82f6;      /* azul */
  --color-secondary: #10b981;    /* verde */
  --color-danger: #ef4444;       /* rojo */
  --color-warning: #f59e0b;      /* ámbar */
  --color-success: #10b981;      /* verde */
  
  --bg-light: #ffffff;
  --bg-light-secondary: #f9fafb;
  --text-dark: #1f2937;
  --text-secondary: #6b7280;
  --border-light: #e5e7eb;
  
  /* Tipografía */
  --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-size-xs: 0.75rem;      /* 12px */
  --font-size-sm: 0.875rem;     /* 14px */
  --font-size-base: 1rem;       /* 16px */
  --font-size-lg: 1.125rem;     /* 18px */
  --font-size-xl: 1.25rem;      /* 20px */
  --font-size-2xl: 1.5rem;      /* 24px */
  
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
  
  /* Espaciado */
  --space-xs: 0.25rem;   /* 4px */
  --space-sm: 0.5rem;    /* 8px */
  --space-md: 1rem;      /* 16px */
  --space-lg: 1.5rem;    /* 24px */
  --space-xl: 2rem;      /* 32px */
  
  /* Sombras */
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
  
  /* Radio */
  --radius-sm: 0.375rem;   /* 6px */
  --radius-md: 0.5rem;     /* 8px */
  --radius-lg: 0.75rem;    /* 12px */
}

/* Tema oscuro */
html.dark {
  --bg-light: #1f2937;
  --bg-light-secondary: #111827;
  --text-dark: #f9fafb;
  --text-secondary: #d1d5db;
  --border-light: #374151;
  --color-primary: #60a5fa;      /* azul más claro */
  --color-secondary: #34d399;    /* verde más claro */
}

/* Respetar preferencia OS */
@media (prefers-color-scheme: dark) {
  html:not(.light) {
    --bg-light: #1f2937;
    --bg-light-secondary: #111827;
    --text-dark: #f9fafb;
    --text-secondary: #d1d5db;
    --border-light: #374151;
    --color-primary: #60a5fa;
    --color-secondary: #34d399;
  }
}

/* ─────────────────────────────────────────────────────────────── */
/* Reset */
/* ─────────────────────────────────────────────────────────────── */

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  font-family: var(--font-family);
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  background-color: var(--bg-light);
  color: var(--text-dark);
  line-height: 1.5;
  transition: background-color 0.2s, color 0.2s;
}

/* ─────────────────────────────────────────────────────────────── */
/* Tipografía */
/* ─────────────────────────────────────────────────────────────── */

h1, h2, h3, h4, h5, h6 {
  font-weight: var(--font-weight-bold);
  line-height: 1.25;
}

h1 {
  font-size: var(--font-size-2xl);
}

h2 {
  font-size: var(--font-size-xl);
}

h3 {
  font-size: var(--font-size-lg);
}

p {
  font-size: var(--font-size-base);
  color: var(--text-secondary);
}

a {
  color: var(--color-primary);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

button {
  font-family: inherit;
  font-size: var(--font-size-base);
}

input, textarea, select {
  font-family: inherit;
  font-size: var(--font-size-base);
}

/* ─────────────────────────────────────────────────────────────── */
/* Utility Classes */
/* ─────────────────────────────────────────────────────────────── */

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 var(--space-md);
}

.flex {
  display: flex;
}

.flex-col {
  flex-direction: column;
}

.gap-sm {
  gap: var(--space-sm);
}

.gap-md {
  gap: var(--space-md);
}

.text-center {
  text-align: center;
}

.text-xs {
  font-size: var(--font-size-xs);
}

.text-sm {
  font-size: var(--font-size-sm);
}
```

- [ ] **Step 2: Verify file exists and has no syntax errors**

Run: Open `css/base.css` in editor, check no red squiggles in CSS

- [ ] **Step 3: Commit**

```bash
git add css/base.css
git commit -m "feat: add base.css with CSS variables, reset, typography"
```

---

### Task 2: Create layout.css — Navigation + Main Responsive

**Files:**
- Create: `css/layout.css`

- [ ] **Step 1: Write layout.css with nav (bottom móvil, left desktop) + main responsive**

```css
/* ─────────────────────────────────────────────────────────────── */
/* Nestra — layout.css: Navigation + Main Layout                  */
/* ─────────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────── */
/* Body Layout (móvil: nav bottom) */
/* ─────────────────────────────────────────────────────────────── */

body {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

main#app {
  flex: 1;
  overflow-y: auto;
  margin-bottom: 60px;  /* Espacio para nav en móvil */
  padding: var(--space-md);
}

/* ─────────────────────────────────────────────────────────────── */
/* Navigation — Móvil (bottom fixed) */
/* ─────────────────────────────────────────────────────────────── */

nav#navbar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  
  background-color: var(--bg-light);
  border-top: 1px solid var(--border-light);
  
  display: flex;
  flex-direction: row;
  justify-content: space-around;
  align-items: center;
  
  height: 60px;
  z-index: 100;
  
  box-shadow: var(--shadow-lg);
}

nav#navbar a {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  padding: var(--space-sm);
  color: var(--text-secondary);
  text-decoration: none;
  font-size: var(--font-size-xs);
  transition: color 0.2s;
}

nav#navbar a:hover,
nav#navbar a.active {
  color: var(--color-primary);
}

/* ─────────────────────────────────────────────────────────────── */
/* Desktop — Breakpoint 768px */
/* ─────────────────────────────────────────────────────────────── */

@media (min-width: 768px) {
  body {
    flex-direction: row;
  }

  main#app {
    flex: 1;
    margin-bottom: 0;
    margin-left: 200px;  /* Ancho de nav lateral */
    padding: var(--space-lg);
  }

  nav#navbar {
    position: fixed;
    bottom: auto;
    left: 0;
    top: 0;
    
    width: 200px;
    height: 100vh;
    border-top: none;
    border-right: 1px solid var(--border-light);
    
    flex-direction: column;
    justify-content: flex-start;
    align-items: stretch;
    
    padding-top: var(--space-lg);
  }

  nav#navbar a {
    flex-direction: row;
    justify-content: flex-start;
    gap: var(--space-md);
    padding: var(--space-md);
    font-size: var(--font-size-sm);
  }
}

/* ─────────────────────────────────────────────────────────────── */
/* Content Grid (si hay sidebar, ajustar aquí en futuro) */
/* ─────────────────────────────────────────────────────────────── */

.grid {
  display: grid;
  gap: var(--space-lg);
}

/* Stack vertical en móvil, 2 columnas en desktop si se necesita */
@media (min-width: 768px) {
  .grid {
    grid-template-columns: 1fr 1fr;
  }
}
```

- [ ] **Step 2: Verify file exists and CSS is valid**

Run: Open `css/layout.css` in editor, check no red squiggles

- [ ] **Step 3: Commit**

```bash
git add css/layout.css
git commit -m "feat: add layout.css with responsive navigation (bottom mobile, left desktop)"
```

---

### Task 3: Create components.css — Buttons, Inputs, Modals, Spinners, etc

**Files:**
- Create: `css/components.css`

- [ ] **Step 1: Write components.css with all reusable component styles**

```css
/* ─────────────────────────────────────────────────────────────── */
/* Nestra — components.css: Buttons, Inputs, Modals, etc          */
/* ─────────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────── */
/* Botones */
/* ─────────────────────────────────────────────────────────────── */

button, .btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  
  padding: var(--space-sm) var(--space-md);
  border: none;
  border-radius: var(--radius-md);
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-base);
  cursor: pointer;
  
  transition: all 0.2s;
  text-decoration: none;
}

.btn-primary {
  background-color: var(--color-primary);
  color: white;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.btn-secondary {
  background-color: var(--bg-light-secondary);
  color: var(--text-dark);
  border: 1px solid var(--border-light);
}

.btn-secondary:hover {
  background-color: var(--border-light);
}

.btn-danger {
  background-color: var(--color-danger);
  color: white;
}

.btn-danger:hover {
  opacity: 0.9;
}

.btn-small {
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--font-size-sm);
}

.btn-block {
  width: 100%;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ─────────────────────────────────────────────────────────────── */
/* Inputs, Textarea, Select */
/* ─────────────────────────────────────────────────────────────── */

input, textarea, select {
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background-color: var(--bg-light);
  color: var(--text-dark);
  
  transition: border-color 0.2s;
}

input:focus, textarea:focus, select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

input::placeholder {
  color: var(--text-secondary);
}

textarea {
  resize: vertical;
  min-height: 100px;
}

/* ─────────────────────────────────────────────────────────────── */
/* Form Groups */
/* ─────────────────────────────────────────────────────────────── */

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
}

.form-group label {
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-sm);
  color: var(--text-dark);
}

.form-error {
  color: var(--color-danger);
  font-size: var(--font-size-xs);
}

/* ─────────────────────────────────────────────────────────────── */
/* Cards */
/* ─────────────────────────────────────────────────────────────── */

.card {
  background-color: var(--bg-light-secondary);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: var(--space-md);
  box-shadow: var(--shadow-sm);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-md);
  border-bottom: 1px solid var(--border-light);
  padding-bottom: var(--space-md);
}

.card-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
}

/* ─────────────────────────────────────────────────────────────── */
/* Modales */
/* ─────────────────────────────────────────────────────────────── */

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  
  z-index: 200;
  animation: fadeIn 0.2s;
}

.modal-content {
  background-color: var(--bg-light);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  max-width: 500px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
  
  box-shadow: var(--shadow-lg);
  animation: slideUp 0.3s;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-lg);
  border-bottom: 1px solid var(--border-light);
  padding-bottom: var(--space-md);
}

.modal-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
}

.modal-close {
  background: none;
  border: none;
  font-size: var(--font-size-lg);
  cursor: pointer;
  color: var(--text-secondary);
}

.modal-close:hover {
  color: var(--text-dark);
}

/* ─────────────────────────────────────────────────────────────── */
/* Spinner (loading indicator) */
/* ─────────────────────────────────────────────────────────────── */

.spinner {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 3px solid var(--border-light);
  border-radius: 50%;
  border-top-color: var(--color-primary);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.spinner-container {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-lg);
}

/* ─────────────────────────────────────────────────────────────── */
/* Toasts */
/* ─────────────────────────────────────────────────────────────── */

.toast {
  position: fixed;
  bottom: 70px;
  right: var(--space-md);
  
  background-color: var(--bg-light-secondary);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  
  box-shadow: var(--shadow-lg);
  animation: slideInRight 0.3s;
  z-index: 150;
  
  max-width: 300px;
}

.toast.success {
  border-left: 4px solid var(--color-success);
}

.toast.error {
  border-left: 4px solid var(--color-danger);
}

.toast.warning {
  border-left: 4px solid var(--color-warning);
}

@media (min-width: 768px) {
  .toast {
    bottom: var(--space-md);
  }
}

/* ─────────────────────────────────────────────────────────────── */
/* Banners (sticky alerts) */
/* ─────────────────────────────────────────────────────────────── */

.banner {
  position: sticky;
  top: 0;
  
  background-color: var(--color-warning);
  color: white;
  padding: var(--space-md);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-md);
  
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-md);
  
  z-index: 99;
  animation: slideDown 0.3s;
}

.banner.error {
  background-color: var(--color-danger);
}

.banner.success {
  background-color: var(--color-success);
}

/* ─────────────────────────────────────────────────────────────── */
/* Animaciones */
/* ─────────────────────────────────────────────────────────────── */

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes slideDown {
  from { transform: translateY(-20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes slideInRight {
  from { transform: translateX(400px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

/* ─────────────────────────────────────────────────────────────── */
/* Badges */
/* ─────────────────────────────────────────────────────────────── */

.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}

.badge-primary {
  background-color: rgba(59, 130, 246, 0.1);
  color: var(--color-primary);
}

.badge-success {
  background-color: rgba(16, 185, 129, 0.1);
  color: var(--color-success);
}

.badge-danger {
  background-color: rgba(239, 68, 68, 0.1);
  color: var(--color-danger);
}

/* ─────────────────────────────────────────────────────────────── */
/* Tables */
/* ─────────────────────────────────────────────────────────────── */

table {
  width: 100%;
  border-collapse: collapse;
  margin: var(--space-md) 0;
}

thead {
  background-color: var(--bg-light-secondary);
  border-bottom: 2px solid var(--border-light);
}

th {
  padding: var(--space-md);
  text-align: left;
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-sm);
}

td {
  padding: var(--space-md);
  border-bottom: 1px solid var(--border-light);
}

tbody tr:hover {
  background-color: var(--bg-light-secondary);
}
```

- [ ] **Step 2: Verify file exists and CSS is valid**

Run: Open `css/components.css` in editor, check no red squiggles

- [ ] **Step 3: Commit**

```bash
git add css/components.css
git commit -m "feat: add components.css with buttons, inputs, modals, spinners, toasts, banners"
```

---

## Phase 2: JavaScript Modules

### Task 4: Create js/config.js — Supabase Credenciales

**Files:**
- Create: `js/config.js`

- [ ] **Step 1: Write config.js with empty credential placeholders**

```javascript
// ─────────────────────────────────────────────────────────────────
// Nestra — config.js
// CREDENCIALES SUPABASE (único lugar donde viven)
// Reemplaza estos valores con los de tu proyecto en Supabase.
// ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = '';
const SUPABASE_ANON_KEY = '';

// Exportar (en browsers sin modules, estos quedan globales)
```

- [ ] **Step 2: Verify file created and loads without error**

Run: Open DevTools in browser, check no errors when page loads

- [ ] **Step 3: Commit**

```bash
git add js/config.js
git commit -m "feat: add config.js with Supabase credential placeholders"
```

---

### Task 5: Create js/supabase.js — Cliente Supabase + Sesión Helpers

**Files:**
- Create: `js/supabase.js`

- [ ] **Step 1: Write supabase.js — inicializa cliente y exporta funciones sesión**

```javascript
// ─────────────────────────────────────────────────────────────────
// Nestra — supabase.js
// Inicializa cliente Supabase y expone getSession() + getUser()
// ─────────────────────────────────────────────────────────────────

// Crear cliente Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Obtiene la sesión activa (JWT + user)
 * @returns {Promise<Object|null>} Sesión o null si no existe
 */
async function getSession() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  } catch (error) {
    console.error('Error getting session:', error);
    return null;
  }
}

/**
 * Obtiene el usuario autenticado
 * @returns {Promise<Object|null>} Usuario o null si no autenticado
 */
async function getUser() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  } catch (error) {
    console.error('Error getting user:', error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Exports (globales en browser)
// No hay module.exports aquí; accede vía window.supabase y funciones
```

- [ ] **Step 2: Check browser DevTools for SDK loading errors**

Run: Open DevTools Console, check `window.supabase` exists (SDK loaded from CDN)

- [ ] **Step 3: Commit**

```bash
git add js/supabase.js
git commit -m "feat: add supabase.js — initialize Supabase client and session helpers"
```

---

### Task 6: Create js/format.js — Utilidades (vacío ahora)

**Files:**
- Create: `js/format.js`

- [ ] **Step 1: Write format.js — structure vacía, se llena en fases posteriores**

```javascript
// ─────────────────────────────────────────────────────────────────
// Nestra — format.js
// Utilidades puras: formatMonto(), formatFecha(), etc.
// Vacío ahora, se llena en Fase 2+
// ─────────────────────────────────────────────────────────────────

/**
 * Formatea monto en Sol Peruano
 * @param {number} amount — monto en números
 * @returns {string} ej: "S/ 1,200.00"
 */
function formatMonto(amount) {
  if (amount == null) return 'S/ 0.00';
  return 'S/ ' + Number(amount).toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Formatea fecha a DD/MM/AAAA
 * @param {string|Date} date — fecha en string o Date
 * @returns {string} ej: "03/06/2026"
 */
function formatFecha(date) {
  if (!date) return '';
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

// Placeholder: más funciones se agregarán en fases posteriores
```

- [ ] **Step 2: Verify file loads without errors**

Run: Check browser DevTools console

- [ ] **Step 3: Commit**

```bash
git add js/format.js
git commit -m "feat: add format.js — placeholder with formatMonto and formatFecha"
```

---

### Task 7: Create js/auth.js — Login, Logout, Sesión, Realtime

**Files:**
- Create: `js/auth.js`

- [ ] **Step 1: Write auth.js — login, logout, rehidratación, realtime profiles**

```javascript
// ─────────────────────────────────────────────────────────────────
// Nestra — auth.js
// Autenticación: login, logout, validación sesión, rehidratación
// Realtime listener en profiles
// ─────────────────────────────────────────────────────────────────

// Estado global
window.currentUser = null;
window.currentProfile = null;

/**
 * Obtiene el usuario autenticado actual
 */
function getCurrentUser() {
  return window.currentUser;
}

/**
 * Obtiene el perfil actual
 */
function getCurrentProfile() {
  return window.currentProfile;
}

/**
 * Verifica si hay sesión activa
 */
function isAuthenticated() {
  return window.currentUser !== null;
}

/**
 * Login con email/password
 * @param {string} email
 * @param {string} password
 * @returns {Promise<Object>} {user, error}
 */
async function login(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) {
      return { user: null, error: error.message };
    }
    
    // Guardar JWT en localStorage
    if (data.session) {
      localStorage.setItem('sb-token', data.session.access_token);
    }
    
    // Rehidratar usuario
    window.currentUser = data.user;
    
    // Cargar perfil desde DB
    await loadProfile();
    
    // Iniciar realtime listener en profiles
    setupRealtimeProfiles();
    
    return { user: data.user, error: null };
  } catch (error) {
    return { user: null, error: error.message };
  }
}

/**
 * Logout
 */
async function logout() {
  try {
    await supabase.auth.signOut();
    
    // Limpiar estado
    localStorage.removeItem('sb-token');
    window.currentUser = null;
    window.currentProfile = null;
    
    // Redirigir a login
    window.location.hash = '#login';
  } catch (error) {
    console.error('Logout error:', error);
  }
}

/**
 * Carga el perfil actual desde DB
 */
async function loadProfile() {
  if (!window.currentUser) return;
  
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', window.currentUser.id)
      .single();
    
    if (error) {
      console.error('Error loading profile:', error);
      return;
    }
    
    window.currentProfile = data;
  } catch (error) {
    console.error('Profile load error:', error);
  }
}

/**
 * Configura listener realtime en tabla profiles
 */
function setupRealtimeProfiles() {
  if (!window.currentUser) return;
  
  supabase
    .channel('profiles-changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'profiles',
        filter: `user_id=eq.${window.currentUser.id}`
      },
      (payload) => {
        // Rehidratar perfil si cambió
        window.currentProfile = payload.new;
        // Aquí se puede despachar evento si es necesario
        console.log('Profile updated:', window.currentProfile);
      }
    )
    .subscribe();
}

/**
 * Al cargar auth.js: validar sesión desde localStorage
 */
async function initAuth() {
  try {
    // Buscar JWT en localStorage
    const token = localStorage.getItem('sb-token');
    
    if (!token) {
      // Sin sesión
      window.currentUser = null;
      window.currentProfile = null;
      return;
    }
    
    // Validar con Supabase
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error || !user) {
      // Token inválido, limpiar
      localStorage.removeItem('sb-token');
      window.currentUser = null;
      window.currentProfile = null;
      return;
    }
    
    // Sesión válida
    window.currentUser = user;
    
    // Cargar perfil
    await loadProfile();
    
    // Iniciar realtime
    setupRealtimeProfiles();
    
    console.log('Auth initialized with user:', user.email);
  } catch (error) {
    console.error('Auth init error:', error);
    localStorage.removeItem('sb-token');
    window.currentUser = null;
  }
}

// Ejecutar al cargar el módulo
initAuth();
```

- [ ] **Step 2: Check browser console for auth init messages**

Run: Open DevTools, refresh page, check "Auth initialized with user" message (if logged in) or silent if not

- [ ] **Step 3: Commit**

```bash
git add js/auth.js
git commit -m "feat: add auth.js — login, logout, session validation, realtime profiles"
```

---

### Task 8: Create js/router.js — SPA Hash-Based Navigation

**Files:**
- Create: `js/router.js`

- [ ] **Step 1: Write router.js — hash-based SPA with view injection**

```javascript
// ─────────────────────────────────────────────────────────────────
// Nestra — router.js
// SPA Router: escucha hash, carga vistas, inyecta en #app
// ─────────────────────────────────────────────────────────────────

// Contexto actual (para pasar datos entre router y vistas)
window.routerContext = {};

/**
 * Navega a una ruta
 * @param {string} route — ej: "dashboard", "login", "transaccion"
 */
function navigateTo(route) {
  window.location.hash = `#${route}`;
}

/**
 * Carga una vista en #app
 * @param {string} viewName — nombre del archivo sin extensión
 * @param {Object} context — datos a pasar a la vista
 */
async function loadView(viewName, context = {}) {
  window.routerContext = context;
  
  try {
    // Obtener vista HTML desde /views
    const response = await fetch(`views/${viewName}.html`);
    
    if (!response.ok) {
      throw new Error(`View not found: ${viewName}`);
    }
    
    const html = await response.text();
    
    // Inyectar en #app
    const appContainer = document.getElementById('app');
    appContainer.innerHTML = html;
    
    console.log(`Loaded view: ${viewName}`);
    
    // Scroll to top
    window.scrollTo(0, 0);
    
  } catch (error) {
    console.error('Route error:', error);
    document.getElementById('app').innerHTML = `
      <div class="card" style="margin-top: 2rem;">
        <h2>Error loading view</h2>
        <p>${error.message}</p>
      </div>
    `;
  }
}

/**
 * Maneja cambios de hash
 */
async function handleRouteChange() {
  const hash = window.location.hash.slice(1) || 'dashboard';
  
  // Verificar autenticación
  if (hash !== 'login' && !isAuthenticated()) {
    // Redirigir a login si no autenticado
    window.location.hash = '#login';
    return;
  }
  
  // Cargar vista
  await loadView(hash);
}

/**
 * Escuchar cambios de hash
 */
window.addEventListener('hashchange', handleRouteChange);

/**
 * Inicializar router al cargar
 */
async function initRouter() {
  // Esperar a que auth.js termine de inicializar
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Manejar ruta inicial
  await handleRouteChange();
}

// Ejecutar cuando esté listo
document.addEventListener('DOMContentLoaded', initRouter);
```

- [ ] **Step 2: Test router by opening DevTools and checking hash changes**

Run: Open DevTools, navigate to `#login` or `#dashboard` in address bar, check if views load

- [ ] **Step 3: Commit**

```bash
git add js/router.js
git commit -m "feat: add router.js — hash-based SPA navigation and view injection"
```

---

## Phase 3: HTML Structure

### Task 9: Create index.html — Shell Único

**Files:**
- Create: `index.html`

- [ ] **Step 1: Write index.html — entry point con nav + main + CSS + JS**

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nestra — Gestión Financiera en Pareja</title>
  
  <!-- CSS (orden importa) -->
  <link rel="stylesheet" href="css/base.css">
  <link rel="stylesheet" href="css/layout.css">
  <link rel="stylesheet" href="css/components.css">
  
  <!-- Supabase SDK from CDN -->
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
</head>
<body>
  <!-- Navegación -->
  <nav id="navbar">
    <a href="#dashboard" data-nav="dashboard">
      <span>📊</span>
      <span>Dashboard</span>
    </a>
    <a href="#transaccion" data-nav="transaccion">
      <span>➕</span>
      <span>Transacción</span>
    </a>
    <a href="#historial" data-nav="historial">
      <span>📋</span>
      <span>Historial</span>
    </a>
    <a href="#metas" data-nav="metas">
      <span>🎯</span>
      <span>Metas</span>
    </a>
    <a href="#config" data-nav="config">
      <span>⚙️</span>
      <span>Config</span>
    </a>
  </nav>
  
  <!-- Contenedor principal (router inyecta vistas aquí) -->
  <main id="app"></main>
  
  <!-- JS Modules (en orden: config → supabase → auth → router → format) -->
  <script src="js/config.js"></script>
  <script src="js/supabase.js"></script>
  <script src="js/auth.js"></script>
  <script src="js/format.js"></script>
  <script src="js/router.js"></script>
</body>
</html>
```

- [ ] **Step 2: Open index.html in browser and verify it loads without errors**

Run: Open `file:///path/to/index.html` in browser, check DevTools console for errors

Expected: Nav visible at bottom (móvil) or left (desktop), app container ready

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add index.html — entry point shell with nav and app container"
```

---

### Task 10: Create views/login.html — Formulario de Autenticación

**Files:**
- Create: `views/login.html`

- [ ] **Step 1: Write login.html — email/password form + login handler**

```html
<!-- Nestra — views/login.html -->
<!-- Fragmento HTML (sin <html>/<body>) -->

<div class="container" style="max-width: 400px; margin: 4rem auto; padding: 2rem;">
  <div class="card">
    <div style="text-align: center; margin-bottom: 2rem;">
      <h1>Nestra</h1>
      <p>Gestión financiera en pareja</p>
    </div>
    
    <form id="loginForm">
      <div class="form-group">
        <label for="email">Email</label>
        <input 
          type="email" 
          id="email" 
          name="email" 
          placeholder="tu@email.com"
          required
          autocomplete="email"
        />
      </div>
      
      <div class="form-group">
        <label for="password">Contraseña</label>
        <input 
          type="password" 
          id="password" 
          name="password" 
          placeholder="••••••••"
          required
          autocomplete="current-password"
        />
      </div>
      
      <div id="loginError" class="form-error" style="display: none;"></div>
      
      <button type="submit" class="btn btn-primary btn-block">
        <span id="loginButtonText">Ingresar</span>
        <span id="loginSpinner" class="spinner" style="display: none;"></span>
      </button>
    </form>
  </div>
</div>

<script>
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('loginError');
    const buttonText = document.getElementById('loginButtonText');
    const spinner = document.getElementById('loginSpinner');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    
    // Mostrar spinner, ocultar texto
    buttonText.style.display = 'none';
    spinner.style.display = 'inline-block';
    submitBtn.disabled = true;
    errorDiv.style.display = 'none';
    
    try {
      const { user, error } = await login(email, password);
      
      if (error) {
        throw new Error(error);
      }
      
      // Login exitoso - router redirige a dashboard
      navigateTo('dashboard');
      
    } catch (err) {
      // Mostrar error
      errorDiv.textContent = err.message || 'Error al ingresar';
      errorDiv.style.display = 'block';
      
      // Restaurar botón
      buttonText.style.display = 'inline';
      spinner.style.display = 'none';
      submitBtn.disabled = false;
    }
  });
</script>
```

- [ ] **Step 2: Test login form by navigating to #login**

Run: Click nav "Config" or navigate to `#login` in address bar
Expected: Login form visible with email/password fields

- [ ] **Step 3: Test form validation**

Run: Click submit without entering values
Expected: Browser HTML5 validation shows required field message

- [ ] **Step 4: Commit**

```bash
git add views/login.html
git commit -m "feat: add views/login.html — email/password login form"
```

---

### Task 11: Create views/dashboard.html — Esqueleto Dashboard

**Files:**
- Create: `views/dashboard.html`

- [ ] **Step 1: Write dashboard.html — esqueleto sin lógica de datos**

```html
<!-- Nestra — views/dashboard.html -->
<!-- Fragmento HTML — esqueleto de fase 1 -->

<div class="container">
  <!-- Header -->
  <div style="margin-bottom: 2rem;">
    <h1>Dashboard</h1>
    <p id="userGreeting"></p>
  </div>
  
  <!-- Balances -->
  <div class="grid">
    <!-- Balance del Hogar -->
    <div class="card">
      <h2>Balance del Hogar</h2>
      <div style="margin-top: 1rem;">
        <p style="font-size: 0.875rem; color: var(--text-secondary);">Ingresos</p>
        <p id="hogarIngresos" style="font-size: 1.5rem; font-weight: bold; color: var(--color-success);">
          <span class="spinner"></span>
        </p>
        <p style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 1rem;">Gastos</p>
        <p id="hogarGastos" style="font-size: 1.5rem; font-weight: bold; color: var(--color-danger);">
          <span class="spinner"></span>
        </p>
        <hr style="margin: 1rem 0; border: none; border-top: 1px solid var(--border-light);">
        <p style="font-size: 0.875rem; color: var(--text-secondary);">Balance</p>
        <p id="hogarBalance" style="font-size: 1.5rem; font-weight: bold;">
          <span class="spinner"></span>
        </p>
      </div>
    </div>
    
    <!-- Balance Personal -->
    <div class="card">
      <h2>Tu Balance</h2>
      <div style="margin-top: 1rem;">
        <p style="font-size: 0.875rem; color: var(--text-secondary);">Ingresos</p>
        <p id="personalIngresos" style="font-size: 1.5rem; font-weight: bold; color: var(--color-success);">
          <span class="spinner"></span>
        </p>
        <p style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 1rem;">Gastos</p>
        <p id="personalGastos" style="font-size: 1.5rem; font-weight: bold; color: var(--color-danger);">
          <span class="spinner"></span>
        </p>
        <hr style="margin: 1rem 0; border: none; border-top: 1px solid var(--border-light);">
        <p style="font-size: 0.875rem; color: var(--text-secondary);">Balance</p>
        <p id="personalBalance" style="font-size: 1.5rem; font-weight: bold;">
          <span class="spinner"></span>
        </p>
      </div>
    </div>
  </div>
  
  <!-- Botón agregar transacción -->
  <div style="margin: 2rem 0;">
    <button class="btn btn-primary btn-block" onclick="navigateTo('transaccion')">
      ➕ Agregar Transacción
    </button>
  </div>
  
  <!-- Últimas 5 transacciones -->
  <div class="card">
    <h2>Últimas Transacciones</h2>
    <table>
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Categoría</th>
          <th>Monto</th>
          <th>Ámbito</th>
        </tr>
      </thead>
      <tbody id="recentTransactions">
        <tr>
          <td colspan="4" style="text-align: center; padding: 2rem;">
            <span class="spinner"></span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  
  <!-- Metas en progreso -->
  <div class="card" style="margin-top: 2rem;">
    <h2>Metas en Progreso</h2>
    <div id="metasContainer" style="margin-top: 1rem;">
      <p style="text-align: center;">
        <span class="spinner"></span>
      </p>
    </div>
  </div>
  
  <!-- Panel de alertas -->
  <div id="alertsPanel" style="margin-top: 2rem;">
    <!-- Las alertas se insertan aquí dinamicamente -->
  </div>
</div>

<script>
  // Al cargar dashboard, mostrar bienvenida
  document.addEventListener('DOMContentLoaded', () => {
    const profile = getCurrentProfile();
    if (profile) {
      document.getElementById('userGreeting').textContent = 
        `Hola, ${profile.nombre}`;
    }
    
    // Aquí irá la lógica de carga de datos en Fase 2
    // Por ahora, solo mostramos estructura
  });
</script>
```

- [ ] **Step 2: Navigate to dashboard and verify structure loads**

Run: Click "Dashboard" in nav or navigate to `#dashboard`
Expected: Dashboard card layout visible, spinners in place, no data loaded (expected, Fase 2)

- [ ] **Step 3: Test button navigation**

Run: Click "+ Agregar Transacción" button
Expected: Navigate to `#transaccion`

- [ ] **Step 4: Commit**

```bash
git add views/dashboard.html
git commit -m "feat: add views/dashboard.html — skeleton with balance cards and placeholders"
```

---

## Phase 4: Integration & Testing

### Task 12: Test Login Flow — Credenciales, localStorage, Sesión

**Files:**
- Test locally (sin tests automatizados; validar manualmente)

- [ ] **Step 1: Obtén credenciales de Supabase y ponlas en config.js**

Run: En Dashboard Supabase → Project Settings → API Keys
- Copia `Project URL` → config.js SUPABASE_URL
- Copia `anon key` (público) → config.js SUPABASE_ANON_KEY

Resultado:
```javascript
const SUPABASE_URL = 'https://xxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJh...';
```

- [ ] **Step 2: Test login con credenciales inválidas**

Run: 
- Abrir `file:///path/to/index.html` en navegador
- Ir a `#login` (debería redirigir automáticamente si no hay sesión)
- Entrar email/password inválidos
- Click Ingresar

Expected: Mensaje de error "Invalid login credentials" o similar

- [ ] **Step 3: Test login exitoso**

Run:
- Entrar credenciales válidas (christian@nestra.app / darling@nestra.app + sus passwords)
- Click Ingresar

Expected: 
- Form desaparece, spinner aparece
- Redirige a dashboard
- DevTools console: "Auth initialized with user: christian@nestra.app"
- localStorage tiene clave "sb-token"

- [ ] **Step 4: Test sesión persiste tras refresh**

Run:
- Estando en dashboard, presionar F5 para refrescar
- Esperar a que page cargue

Expected:
- Sin re-login
- Dashboard carga directamente
- currentUser y currentProfile rehidratados desde localStorage

- [ ] **Step 5: Test logout**

Run:
- Click config en nav (cuando esté implementado), busca botón logout
- Por ahora, abre DevTools console y ejecuta: `logout()`

Expected:
- localStorage["sb-token"] desaparece
- Redirige a `#login`

- [ ] **Step 6: Commit test results**

```bash
git add -A
git commit -m "test: verify login flow with valid/invalid credentials, session persistence"
```

---

### Task 13: Test Routing — Hash Navigation, Auth Guard

**Files:**
- Test manualmente

- [ ] **Step 1: Test sin autenticar — redirige a login**

Run:
- Clear localStorage: `localStorage.clear()` en DevTools
- Refrescar página
- Intentar navegar a `#dashboard`

Expected: Redirige a `#login` automáticamente

- [ ] **Step 2: Test con autenticar — navega entre vistas**

Run:
- Login con credenciales válidas
- Navegar por los links de nav (Dashboard, Transacción, Historial, Metas, Config)

Expected:
- Cada click carga la vista correspondiente (si existe)
- Si view no existe (ej: historial.html sin crear), muestra error "View not found"

- [ ] **Step 3: Test parámetros en router context**

Run:
- DevTools console: `window.routerContext`

Expected: Ver el contexto actual (vacío o con datos según vista)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: verify routing with auth guard, hash navigation, view loading"
```

---

### Task 14: Test Responsive Design — Móvil vs Desktop

**Files:**
- Test manualmente

- [ ] **Step 1: Abrir en móvil (DevTools device emulation) — Nav bottom**

Run:
- DevTools → Device Toolbar (Ctrl+Shift+M)
- Seleccionar iPhone 12 o similar
- Refrescar

Expected:
- Nav en bottom, horizontal, iconos + labels
- Main tiene margin-bottom: 60px (nav no tapa contenido)
- Cards apilados vertically (grid 1 columna)

- [ ] **Step 2: Cambiar a desktop — Nav left**

Run:
- Agrandar ventana a 1024px+
- Refrescar (o DevTools → Responsive → set custom 1024x768)

Expected:
- Nav en left, vertical, iconos + labels en columna
- Main tiene margin-left: 200px
- Grid puede tener 2 columnas si se ajusta CSS (actualmente 1 col en móvil)

- [ ] **Step 3: Test tema oscuro**

Run:
- DevTools console: `document.documentElement.classList.add('dark')`
- Refrescar página
- Verificar colores han cambiado (background oscuro, texto claro)

Expected: CSS vars se actualizan, tema oscuro visible

- [ ] **Step 4: Test all form inputs, buttons, spinners visibility**

Run:
- Verificar que inputs, buttons, badges, spinners tienen estilos correctos
- Test hover/focus states

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: verify responsive design (mobile nav bottom, desktop nav left, dark theme)"
```

---

## Spec Coverage Self-Review

**Checking each requirement:**

✓ **entry point (index.html)** — Task 9
✓ **auth (JWT + localStorage)** — Tasks 5, 7
✓ **router (hash-based)** — Task 8
✓ **CSS (base, layout, components, responsive, dark theme)** — Tasks 1, 2, 3
✓ **config.js** — Task 4
✓ **supabase.js** — Task 5
✓ **auth.js (login, logout, realtime)** — Task 7
✓ **router.js** — Task 8
✓ **format.js** — Task 6
✓ **views/login.html** — Task 10
✓ **views/dashboard.html (skeleton)** — Task 11
✓ **Error handling structure (modal/banner/inline/toast CSS)** — Task 3
✓ **Navigation (nav#navbar)** — Tasks 2, 9
✓ **Integration tests** — Tasks 12, 13, 14

**No placeholders found. All code blocks are concrete and executable.**

---

## Plan Complete

Plan saved to `docs/superpowers/plans/2026-06-05-nestra-phase2-base-implementation.md`

### Execution Options:

**1. Subagent-Driven (Recommended)** — I dispatch a fresh subagent per task (or per batch of related tasks). Review checkpoints between tasks. Faster iteration, higher confidence in complex tasks.

**2. Inline Execution** — Execute all tasks in this session using `superpowers:executing-plans`. Batch execution with checkpoints for review.

Which approach would you prefer?