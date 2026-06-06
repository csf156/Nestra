# Nestra — Diseño de Fase 2: Estructura Base (config, auth, router, CSS)

**Fecha:** 2026-06-05
**Fase:** 2 — Core (Shell de la app + autenticación + navegación)
**Entregables:** 6 archivos (JS modules + HTML shell + CSS + vistas login/dashboard esqueleto)

## Objetivo

Construir la estructura base de Nestra: entry point (`index.html`), autenticación con Supabase (JWT en localStorage, estado en memoria), SPA router (hash-based), y CSS mobile-first con tema claro/oscuro. Al terminar, la app carga, autentica, navega entre vistas y comunica errores.

## Decisiones de diseño aprobadas en brainstorming

1. **Router maneja redireccionamiento** — `index.html` es dumb shell; `router.js` consulta `isAuthenticated()` y inyecta vista. Sin sesión → login. Con sesión → vista solicitada.

2. **JWT en localStorage + estado en memoria (opción B)** — JWT persiste entre refreshes; `currentUser`/`currentProfile` viven en RAM, fuente única es Supabase. Al cargar, `auth.js` rehidrata desde localStorage + query DB.

3. **Eager loading dashboard (opción A)** — Al abrir dashboard, query todo junto (transacciones mes + metas + categorías) con spinners. Datos chicos, no vale lazy.

4. **Transacción con flag isModal (opción A+flag)** — Mismo `transaccion.html`, router pasa `{isModal: true/false}`. CSS la renderiza modal overlay o pantalla completa.

5. **Error handling: Modal + Banner + Inline + Toast** — Errores críticos (login fail, sesión expirada) en modal bloqueante. Errores de red en banner sticky. Validación en inline. Confirmaciones en toast.

6. **CSS custom properties, sin build (opción A)** — Vars nativas en `base.css` para colores/tipografía. Tema oscuro = clase `.dark` en `html` que sobrescribe vars. Escalable.

7. **Una nav, CSS media query (opción A)** — Nav única en HTML. En móvil: `position: fixed bottom`, horizontal. En desktop (768px+): `position: fixed left`, vertical. `main` gana `margin-left` en desktop.

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│                    index.html (shell)                   │
│  ┌──────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │   <nav>  │  │  <main id=>  │  │   CSS + JS      │  │
│  │ (bottom) │  │    #app      │  │   (en <head>)   │  │
│  └──────────┘  └──────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────┘
         ↓ (al cargar)
┌─────────────────────────────────────────────────────────┐
│  auth.js: valida JWT, rehidrata user, realtime listen  │
└─────────────────────────────────────────────────────────┘
         ↓ (au completar)
┌─────────────────────────────────────────────────────────┐
│  router.js: escucha hash, inyecta vista en #app        │
│  - sin sesión   → login.html                           │
│  - con sesión   → dashboard.html o vista solicitada    │
└─────────────────────────────────────────────────────────┘
```

## Módulos JS (orden de carga en index.html)

| Módulo | Responsabilidad | Exporta |
|---|---|---|
| `config.js` | Credenciales Supabase (SUPABASE_URL, SUPABASE_ANON_KEY) | Constantes `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| `supabase.js` | Inicializa cliente Supabase, funciones sesión | `supabase` (instancia), `getSession()`, `getUser()` |
| `auth.js` | Login/logout, JWT localStorage, rehidratación, realtime profiles | `getCurrentUser()`, `getCurrentProfile()`, `isAuthenticated()`, `login()`, `logout()` |
| `router.js` | Escucha hash, carga vistas, pasa contexto | `navigateTo()`, `loadView()` |
| `format.js` | Utilidades puras (formatMonto, formatFecha) | Funciones de formato |

### Detalles por módulo

**`config.js`**
```javascript
// ─── CREDENCIALES SUPABASE ────────────────────
// Reemplaza estos valores con los de tu proyecto Supabase.
// ESTE ES EL ÚNICO LUGAR donde viven las credenciales.
const SUPABASE_URL = '';
const SUPABASE_ANON_KEY = '';
// ────────────────────────────────────────────────
```

**`supabase.js`**
- Importa config.js
- Carga Supabase SDK desde CDN (`@supabase/supabase-js`)
- Inicializa: `const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)`
- Exporta `supabase` (instancia) + `getSession()` + `getUser()`

**`auth.js`**
- Al cargar: busca JWT en localStorage
- Si existe: valida con `supabase.auth.getSession()`
- Si válido: query `profiles` (obtener nombre + aporte_esperado) → rehidrata `window.currentUser` / `window.currentProfile`
- Realtime listener en `profiles` table (cambios de parejas se sincan en vivo)
- Expone: `getCurrentUser()`, `getCurrentProfile()`, `isAuthenticated()`, `login(email, password)`, `logout()`

**`router.js`**
- Escucha `hashchange` events
- Consulta `auth.isAuthenticated()`
  - false → carga `views/login.html`
  - true → carga vista correspondiente al hash (`#dashboard` → dashboard.html, etc)
- Método `loadView(name, context)` para pasar datos (ej: `{isModal: true}`)
- Inyecta en `#app`

**`format.js`**
- Vacío ahora, se llena en Fase 2+
- Contendrá: `formatMonto(num)` → "S/ 1,200.00", `formatFecha(date)` → "03/06/2026"

## Estructura HTML

**`index.html`**
```html
<!DOCTYPE html>
<html lang="es">
<head>
  <!-- Meta, title -->
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!-- CSS -->
  <link rel="stylesheet" href="css/base.css">
  <link rel="stylesheet" href="css/layout.css">
  <link rel="stylesheet" href="css/components.css">
  <!-- Supabase SDK (CDN) -->
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
</head>
<body>
  <nav id="navbar"><!-- items + router links --></nav>
  <main id="app"><!-- router inyecta vistas aquí --></main>
  
  <!-- JS modules (en orden: config → supabase → auth → router) -->
  <script src="js/config.js"></script>
  <script src="js/supabase.js"></script>
  <script src="js/auth.js"></script>
  <script src="js/router.js"></script>
  <script src="js/format.js"></script>
</body>
</html>
```

**`views/login.html`**
Fragmento (sin `<html>/<body>`). Formulario email/password, botón "Ingresar". Evento submit → `auth.login(email, password)` → redirige a dashboard.

**`views/dashboard.html`**
Esqueleto de Fase 1 (sin lógica de datos aún):
- Balances hogar + personal (divs vacíos, spinners mientras cargan en Fase 2)
- Últimas 5 transacciones (tabla vacía)
- Botón "+ Transacción" → `router.loadView('transaccion', {isModal: true})`
- Panel alertas (vacío)
- Progreso resumido metas (vacío)

## CSS

**`base.css`**
- CSS custom properties: --color-primary, --color-secondary, --bg-light, --text-dark, etc.
- Reset (margin, padding, box-sizing)
- Tipografía (font-family, sizes, weights)
- Tema oscuro: `html.dark { --bg-light: #1a1a1a; ... }`
- `prefers-color-scheme` media query para detectar preferencia OS

**`layout.css`**
- Nav: `position: fixed bottom; width: 100%; height: auto; flex: row` (móvil)
- Main: `margin-bottom: 60px` (para que nav no tape contenido)
- Breakpoint 768px: nav → `position: fixed left; width: auto; height: 100vh; flex: column`
- Main: `margin-bottom: 0; margin-left: nav-width`

**`components.css`**
- Botones, inputs, modales, spinners, toasts, banners
- Estilos reutilizables (Cards, badges, etc)

## Data Flow — Login

1. Usuario entra email/password en `views/login.html`
2. Submit → `auth.login(email, password)`
3. `auth.js` → `supabase.auth.signInWithPassword(email, password)`
4. JWT retorna → guardado en localStorage (`localStorage.setItem('sb-token', jwt)`)
5. `auth.js` → query `profiles` (obtener nombre + aporte) → rehidrata `window.currentUser` + `window.currentProfile`
6. Router redirige a `#dashboard`

## Data Flow — Dashboard al cargar

1. Router consulta `isAuthenticated()`
2. ✓ Retorna true
3. Router carga `views/dashboard.html` en `#app`
4. dashboard.js (cuando esté listo en Fase 2): query profiles + categorias + transacciones + metas
5. Mientras cargan: spinners visibles
6. Realtime listener en transacciones/metas: cualquier cambio de Christian/Darling se ve en vivo en el otro

## Error Handling

- **Modal bloqueante:** login fail, sesión expirada, RLS denied, error critical
  - Usuario debe hacer algo (reintentar, reloguear)
- **Banner sticky (top):** timeout red, reconexión, error de query no-bloqueante
  - Usuario puede seguir navegando; si persiste, retry button
- **Inline en formularios:** validación (monto <0, campo vacío, etc)
  - Texto rojo bajo campo, claro
- **Toast (esquina, auto-desaparece):** confirmaciones positivas (login OK, transacción guardada, etc)

## Archivos de salida

```
nestra/
├── index.html                    # Shell único
├── views/
│   ├── login.html                # Formulario (fragmento HTML)
│   └── dashboard.html            # Esqueleto dashboard (fragmento HTML)
├── js/
│   ├── config.js                 # Credenciales Supabase
│   ├── supabase.js               # Cliente Supabase + getSession/getUser
│   ├── auth.js                   # Login/logout/validación/realtime profiles
│   ├── router.js                 # Navegación SPA
│   └── format.js                 # Utilidades (vacío por ahora)
└── css/
    ├── base.css                  # Vars, reset, tipografía, temas
    ├── layout.css                # Nav + main responsive
    └── components.css            # Botones, modales, spinners, etc
```

## Criterios de completitud (Fase 2 = "listo")

- ✓ Login funcional: credenciales válidas → dashboard; inválidas → error modal
- ✓ Dashboard carga: balances, últimas transacciones, metas (sin datos reales, solo estructura)
- ✓ Nav navega: links a vistas existentes (login, dashboard, transacción)
- ✓ Tema oscuro: class `.dark` en html → colores oscuros
- ✓ Responsive: móvil (nav bottom) y desktop (nav left) se ven bien
- ✓ Sesión persiste: refresh → no logout si JWT válido
- ✓ Error handling: modal/banner/inline/toast según tipo de error
- ✓ Realtime conectado: listeners activos (aunque sin datos que cambien aún)

