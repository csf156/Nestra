# Rediseño Visual "Editorial Luxury Dark" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Driver skill: **frontend-design**. Contrast verification: **accessibility** skill (WCAG 2.2 AA).

**Goal:** Re-skin TODAS las vistas de Nestra v2 a un sistema visual "editorial luxury dark" (Playfair Display para números signature, Outfit para UI, acento champagne #c9a84c, fondo near-black #08080f, dark por defecto) sin romper funcionalidad.

**Architecture:** Token-first. La identidad vive en `css/base.css` (custom properties). Se **conservan los nombres** de tokens existentes (`--color-primary`, `--bg-light`, `--text-dark`, etc.) y se **cambian sus valores** → recolorea toda la app de una vez sin churn de nombres. Se invierte el default a **dark** (`:root` = paleta dark; `html.light` = paleta light coherente). Fuentes **self-hosted** (`assets/fonts/`, `@font-face`) y vendorizadas en el Service Worker para offline. Cada vista tiene su propio bloque `<style>` inline que se audita para reemplazar hex hardcodeados por tokens y aplicar Playfair a los números.

**Tech Stack:** Vanilla JS (IIFE, `var`, `escHtml`), CSS custom properties, hash-routing SPA, PWA (Workbox SW vendorizado), sin build. Verificación visual con preview MCP tools + skill accessibility.

**Capa visual únicamente** — no se toca lógica de datos, parsers, RLS ni sync. Si un cambio "visual" requiere tocar JS, limitarse a: clases CSS en markup generado, paleta de Chart.js, y el boot de tema.

---

## Decisiones aprobadas (locked)

1. **Tema por defecto: DARK.** Near-black #08080f es la identidad primaria. Light mode es la alterna coherente, opt-in vía toggle existente / OS pref.
2. **Fuentes: self-hosted + vendorizadas en SW.** `.woff2` en `assets/fonts/`, `@font-face` local, precache en `sw.js`. NO Google Fonts CDN (rompería offline).
3. **Sistema de diseño (del mockup validado):**
   - Tipografía: **Playfair Display** (números grandes signature), **Outfit** (toda la UI). Dos pesos máximo por familia.
   - Acento único: **champagne gold #c9a84c** (links, nav activo, avatar). En light mode el acento de texto se oscurece a `#8a6d22` para pasar AA.
   - Insight cards: `border-left` **2px** de color semántico + fondo **tintado sutil (4% alpha)**, NO fondo lleno.
   - Barras de progreso finas (**2px**). Íconos de categoría en **chips redondeados 24×24** con fondo tintado del color.
   - Fondo base **near-black #08080f**.

---

## Inventario de vistas (orden de trabajo)

**Chrome (con nav):** dashboard · historial · graficos · metas · prestamos · configuracion · resumen · transaccion · decisiones
**Públicas (no-chrome):** login · reset-password

Cada vista mantiene su `<style>` inline; el sistema se aplica por vista tras la base global.

---

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `assets/fonts/*.woff2` | Outfit (400, 600) + Playfair Display (400, 600) self-hosted | Crear |
| `css/base.css` | Tokens (colores dark-default + light), `@font-face`, tipografía, utilidades signature | Modificar |
| `index.html` | Boot anti-FOUC de tema (default dark), `<meta theme-color>`, preload de fuentes | Modificar |
| `sw.js` | Precache de fuentes; bump `SHELL_VERSION` | Modificar |
| `css/layout.css` | Nav/sidebar/cards — ya tokenizado; verificar acento champagne | Verificar / ajustes menores |
| `css/components.css` | Primitivas compartidas: progress 2px, chip 24×24, insight tint, badges, botones | Modificar |
| `views/dashboard.html` | `<style>` inline: hero/balances Playfair, insight 2px+tint, presup chips | Modificar |
| `views/historial.html` | `<style>` inline: tabla, montos Playfair, badges | Modificar |
| `views/graficos.html` | `<style>` inline + **paleta Chart.js en JS** | Modificar |
| `views/metas.html` | `<style>` inline: barras 2px, montos Playfair | Modificar |
| `views/prestamos.html` | `<style>` inline: montos Playfair, badges estado | Modificar |
| `views/configuracion.html` | `<style>` inline + verificar toggle de tema + danger zone | Modificar |
| `views/transaccion.html` | `<style>` inline form (también modal) | Modificar |
| `views/resumen.html` | `<style>` inline: cifras Playfair | Modificar |
| `views/decisiones.html` | `<style>` inline: oráculo/score | Modificar |
| `views/login.html` · `views/reset-password.html` | `<style>` inline: pantalla editorial no-chrome | Modificar |

---

## Mapa canónico hex → token (referencia para TODAS las vistas)

Al auditar cada vista, reemplazar valores hardcodeados por el token equivalente. Nunca introducir hex nuevos en markup/inline salvo en `base.css`.

| Valor hardcodeado encontrado | Token a usar | Notas |
|---|---|---|
| `#fff`, `#ffffff` (fondo card/superficie) | `var(--bg-light-secondary)` | superficie elevada |
| fondo de página claro | `var(--bg-light)` | base near-black en dark |
| `#1f2937`, `#111827` (textos/fondos dark legacy) | `var(--text-dark)` / `var(--bg-*)` | según rol |
| `#6b7280`, `#9ca3af` (texto sutil) | `var(--text-secondary)` | |
| `#e5e7eb`, `#374151` (bordes) | `var(--border-light)` | |
| `#059669`, `#10b981`, `#34d399` (verde/acción) | `var(--color-primary)` (acción) o `var(--color-success)` (valor +) | distinguir acción vs valor positivo |
| `#ef4444`, `#f87171` (rojo) | `var(--color-danger)` | |
| `#f59e0b`, `#fbbf24` (ámbar) | `var(--color-warning)` | |
| `#3b82f6` (azul "ahorro", p.ej. dashboard L204) | `var(--color-info)` (nuevo token) | ver Task 0 |
| acento/links | `var(--color-primary)` (= champagne) | |

Comando de auditoría por vista (ejecutar antes de editar cada `views/X.html`):
```bash
grep -nE '#[0-9a-fA-F]{3,6}|rgba?\(' views/X.html
```

---

## Verificación: cómo se prueba una capa visual

No hay tests unitarios de CSS. Cada tarea verifica con:
1. **Preview MCP** (`preview_start` una vez, luego `preview_eval window.location.reload()` o navegar al hash de la vista), `preview_screenshot` dark + `preview_resize` a 390px (mobile-first) y a 1024px (desktop).
2. **Toggle de tema**: alternar a light (config) y screenshot — coherencia sin glitches.
3. **Contraste WCAG AA** con la skill **accessibility**: texto normal ≥ 4.5:1, texto grande/UI ≥ 3:1, foco visible. Champagne sobre near-black y sobre superficie; texto secundario; estados semánticos.
4. **Smoke funcional**: `preview_console_logs` sin errores; la vista renderiza datos reales (cuenta de prueba en memoria [[nestra-v2-test-account]]); interacción clave (abrir modal tx, navegar) sigue viva.

**Cuenta de prueba y arranque del preview:** ver memoria [[nestra-v2-test-account]] para login y gotchas.

---

## Task 0: Fundación — fuentes, tokens dark-default, boot de tema

**Files:**
- Create: `assets/fonts/Outfit-Regular.woff2`, `assets/fonts/Outfit-SemiBold.woff2`, `assets/fonts/PlayfairDisplay-Regular.woff2`, `assets/fonts/PlayfairDisplay-SemiBold.woff2`
- Modify: `css/base.css` (tokens + `@font-face` + utilidades), `index.html` (boot + meta + preload), `sw.js` (precache + version)

- [ ] **Step 1: Descargar las fuentes self-hosted**

Descargar los `.woff2` (subset latin) de Google Fonts / fontsource a `assets/fonts/`. Outfit pesos 400 y 600; Playfair Display 400 y 600.

```bash
mkdir -p assets/fonts
# Vía fontsource CDN (descarga única, luego self-hosted):
curl -L -o assets/fonts/Outfit-Regular.woff2        "https://cdn.jsdelivr.net/fontsource/fonts/outfit@latest/latin-400-normal.woff2"
curl -L -o assets/fonts/Outfit-SemiBold.woff2       "https://cdn.jsdelivr.net/fontsource/fonts/outfit@latest/latin-600-normal.woff2"
curl -L -o assets/fonts/PlayfairDisplay-Regular.woff2  "https://cdn.jsdelivr.net/fontsource/fonts/playfair-display@latest/latin-400-normal.woff2"
curl -L -o assets/fonts/PlayfairDisplay-SemiBold.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/playfair-display@latest/latin-600-normal.woff2"
ls -la assets/fonts/
```
Expected: 4 archivos `.woff2`, cada uno > 5 KB (no HTML de error). Si curl falla, descargar manualmente de fontsource.org y colocar con esos nombres exactos.

- [ ] **Step 2: Añadir `@font-face` y tokens de fuente al inicio de `css/base.css`**

Insertar al principio del archivo (antes de `:root`):

```css
/* ── Fuentes self-hosted (PWA offline) ─────────────────────────── */
@font-face {
  font-family: 'Outfit';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('../assets/fonts/Outfit-Regular.woff2') format('woff2');
}
@font-face {
  font-family: 'Outfit';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('../assets/fonts/Outfit-SemiBold.woff2') format('woff2');
}
@font-face {
  font-family: 'Playfair Display';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('../assets/fonts/PlayfairDisplay-Regular.woff2') format('woff2');
}
@font-face {
  font-family: 'Playfair Display';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('../assets/fonts/PlayfairDisplay-SemiBold.woff2') format('woff2');
}
```

- [ ] **Step 3: Reescribir el bloque `:root` de `css/base.css` — paleta DARK por defecto + tokens nuevos**

Reemplazar el `:root { ... }` actual (líneas ~5-50) por la paleta dark editorial. **Conservar los nombres existentes**, cambiar valores. Añadir tokens nuevos: `--font-display`, `--color-info`, `--accent-hover`, pesos reducidos a 2 (400/600).

```css
:root {
  /* ── Paleta DARK (default) — editorial luxury ────────────────── */
  --bg-light: #08080f;            /* base near-black (página/body)    */
  --bg-light-secondary: #101019;  /* superficie elevada (cards)       */
  --text-dark: #f4f1ea;           /* off-white cálido (texto ppal)    */
  --text-secondary: #a8a29a;      /* gris cálido (texto sutil)        */
  --border-light: rgba(255,255,255,0.08);

  --color-primary: #c9a84c;       /* champagne gold — links/nav/avatar*/
  --accent-hover: #d9bb63;
  --color-secondary: #a8a29a;
  --color-success: #5ec98a;       /* verde valor + (AA en near-black) */
  --color-danger:  #f08a8a;       /* rojo (AA en near-black)          */
  --color-warning: #e8b94a;       /* ámbar                            */
  --color-info:    #6ea8e8;       /* azul (ahorro)                    */

  /* Tipografía */
  --font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-display: 'Playfair Display', Georgia, 'Times New Roman', serif;
  --font-size-xs: 0.75rem;  --font-size-sm: 0.875rem; --font-size-base: 1rem;
  --font-size-lg: 1.125rem; --font-size-xl: 1.25rem;  --font-size-2xl: 1.5rem;
  --font-weight-normal: 400;
  --font-weight-medium: 400;     /* colapsado a 2 pesos: medium=normal */
  --font-weight-semibold: 600;
  --font-weight-bold: 600;       /* colapsado a 2 pesos: bold=semibold */

  /* Espaciado */
  --space-xs: 0.25rem; --space-sm: 0.5rem; --space-md: 1rem; --space-lg: 1.5rem; --space-xl: 2rem;

  /* Sombras — dark: más sutiles, profundidad por elevación */
  --shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.4);
  --shadow-md: 0 4px 12px -2px rgba(0,0,0,0.5);
  --shadow-lg: 0 16px 32px -8px rgba(0,0,0,0.6);

  /* Radio */
  --radius-sm: 0.375rem; --radius-md: 0.5rem; --radius-lg: 0.75rem;
}
```

- [ ] **Step 4: Reescribir los bloques de tema en `css/base.css` — light como alterna coherente**

Eliminar el bloque `html.dark { ... }` actual (ahora redundante: dark es el default). Reemplazar el `@media (prefers-color-scheme: dark)` y añadir light. La regla: **dark es `:root`**; **light se activa con `html.light` o con `prefers-color-scheme: light` cuando el usuario no forzó dark**.

```css
/* ── Tema LIGHT — alterna coherente (paper cálido) ─────────────── */
html.light {
  --bg-light: #faf8f3;            /* paper cálido (página)            */
  --bg-light-secondary: #ffffff;  /* superficie (cards)               */
  --text-dark: #1a1813;
  --text-secondary: #6b655c;
  --border-light: rgba(0,0,0,0.10);

  --color-primary: #8a6d22;       /* champagne oscuro → AA en blanco  */
  --accent-hover: #a8842f;
  --color-secondary: #6b655c;
  --color-success: #1f7a4d;
  --color-danger:  #b3261e;
  --color-warning: #8a6315;
  --color-info:    #2563c9;

  --shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.05);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.10);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.10);
}

/* Respeta OS solo si el usuario NO forzó un tema (sin html.dark/.light) */
@media (prefers-color-scheme: light) {
  html:not(.dark):not(.light) {
    --bg-light: #faf8f3; --bg-light-secondary: #ffffff;
    --text-dark: #1a1813; --text-secondary: #6b655c;
    --border-light: rgba(0,0,0,0.10);
    --color-primary: #8a6d22; --accent-hover: #a8842f; --color-secondary: #6b655c;
    --color-success: #1f7a4d; --color-danger: #b3261e; --color-warning: #8a6315; --color-info: #2563c9;
    --shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.05);
    --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.10);
    --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.10);
  }
}
```

Nota: las reglas `badge-warning`/`badge-danger` con hex hardcodeados (base.css ~241-273) se realinean en Task 1 (badges). Sus overrides `html.dark` actuales deben pasar a `:root` (default) e invertirse: el override claro va bajo `html.light`.

- [ ] **Step 5: Aplicar Playfair a títulos h1/h2 y añadir utilidad de número signature en `css/base.css`**

En la sección Tipografía, cambiar `h1,h2,h3...` para que h1/h2 usen display, y añadir la clase utilitaria:

```css
h1, h2, h3, h4, h5, h6 { font-weight: var(--font-weight-semibold); line-height: 1.25; }
h1, h2 { font-family: var(--font-display); font-weight: 400; letter-spacing: -0.01em; }

/* Número signature — Playfair, tabular, para cifras hero/balances */
.signature-num {
  font-family: var(--font-display);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  line-height: 1;
}
```

- [ ] **Step 6: Boot anti-FOUC de tema (default dark) en `index.html`**

En `<head>`, **inmediatamente después de `<meta charset>`** (antes de los `<link rel=stylesheet>` para evitar flash), insertar el boot script + preload de fuentes. Cambiar `<meta name="theme-color">` a near-black.

```html
<script>
  // Boot de tema anti-FOUC. Default DARK si no hay preferencia guardada.
  (function () {
    var t = null;
    try { t = localStorage.getItem('nestra-theme'); } catch (e) {}
    if (t !== 'dark' && t !== 'light') t = 'dark';   // default editorial dark
    document.documentElement.classList.add(t);
  })();
</script>
<link rel="preload" href="assets/fonts/Outfit-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="assets/fonts/PlayfairDisplay-Regular.woff2" as="font" type="font/woff2" crossorigin>
```

Cambiar:
```html
<meta name="theme-color" content="#ffffff">
```
por (theme-color sensible al esquema):
```html
<meta name="theme-color" content="#08080f" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#08080f">
<meta name="theme-color" content="#faf8f3" media="(prefers-color-scheme: light)">
```

- [ ] **Step 7: Precache de fuentes en `sw.js` + bump de versión**

En `precaching.precacheAndRoute([...])` añadir las 4 fuentes; subir `SHELL_VERSION` a `'v2'` (fuerza refresco del precache, incluido el nuevo `base.css`).

```js
const SHELL_VERSION = 'v2';
```
Añadir al array (junto a los otros assets):
```js
  { url: 'assets/fonts/Outfit-Regular.woff2', revision: SHELL_VERSION },
  { url: 'assets/fonts/Outfit-SemiBold.woff2', revision: SHELL_VERSION },
  { url: 'assets/fonts/PlayfairDisplay-Regular.woff2', revision: SHELL_VERSION },
  { url: 'assets/fonts/PlayfairDisplay-SemiBold.woff2', revision: SHELL_VERSION },
```

- [ ] **Step 8: Verificar — arranque, fuentes, dark default, sin FOUC**

Arrancar preview (ver [[nestra-v2-test-account]]), login, ir a `#dashboard`.
- `preview_console_logs`: sin errores 404 de fuentes ni de CSS.
- `preview_eval`: `getComputedStyle(document.body).fontFamily` → contiene `Outfit`.
- `preview_eval`: `getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim()` → `#c9a84c`.
- `preview_eval`: `document.documentElement.className` → contiene `dark` (en arranque limpio sin localStorage).
- `preview_screenshot` (390px): fondo near-black, texto off-white, acento champagne en nav activo.
Expected: app carga en dark, fuentes aplicadas, sin flash blanco.

- [ ] **Step 9: Commit**

```bash
git add assets/fonts css/base.css index.html sw.js
git commit -m "feat(rediseno): fundación editorial dark — fuentes self-hosted, tokens dark-default, boot de tema"
```

---

## Task 1: Primitivas compartidas — `css/components.css` + `css/layout.css`

Realinear las primitivas globales al sistema: progress 2px, chip de categoría 24×24 tintado, insight tint 2px, badges, botones, foco champagne. Estas clases se usan en muchas vistas → corregir aquí evita repetir por vista.

**Files:**
- Modify: `css/components.css` (progress, chip, badges, botones, foco, tablas)
- Modify: `css/layout.css` (verificar acento en nav/cards — ya tokenizado)

- [ ] **Step 1: Barra de progreso fina (2px default) en `components.css`**

La barra base mide actualmente más; el sistema pide 2px. Cambiar `.progress` a 2px por defecto y mantener variantes:

```css
.progress {
  width: 100%;
  height: 2px;                 /* fina por defecto (sistema editorial) */
  background-color: var(--border-light);
  border-radius: 9999px;
  overflow: hidden;
}
.progress-md { height: 6px; }
.progress-lg { height: 10px; }
```
Verificar que `.progress-bar` use `border-radius: 9999px` y `transition: width 0.3s ease`.

- [ ] **Step 2: Chip de categoría 24×24 tintado — primitiva en `components.css`**

Añadir/realinear la clase del chip de ícono de categoría (usada en presupuestos, insights, metas, historial). El color tintado se pasa por `--chip-color` inline.

```css
/* Chip de ícono de categoría — 24×24, fondo tintado del color de la cat */
.cat-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 9999px;
  background: color-mix(in srgb, var(--chip-color, var(--color-primary)) 14%, transparent);
  color: var(--chip-color, var(--color-primary));
}
.cat-chip .cat-icono,
.cat-chip svg { width: 14px; height: 14px; }
```
(`.cat-icono` ya existe en components.css ~1321; conservarla para usos sueltos.)

- [ ] **Step 3: Foco visible champagne + selección de texto, en `components.css`**

Asegurar foco WCAG 2.4.7 con el acento. Añadir cerca de la sección de botones/inputs:

```css
:where(a, button, input, select, textarea, [tabindex]):focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
::selection { background: color-mix(in srgb, var(--color-primary) 30%, transparent); }
```

- [ ] **Step 4: Botón primario — acento champagne con texto legible**

El botón primario hoy es esmeralda con texto blanco. Champagne es claro → el texto debe ser oscuro para AA. Ajustar `.btn-primary`:

```css
.btn-primary {
  background-color: var(--color-primary);
  color: #08080f;                 /* texto oscuro sobre champagne (AA) */
  font-weight: var(--font-weight-semibold);
}
.btn-primary:hover:not(:disabled) { background-color: var(--accent-hover); }
```
En light mode `--color-primary` es `#8a6d22` (oscuro) → texto oscuro fallaría. Añadir override:
```css
html.light .btn-primary { color: #ffffff; }
@media (prefers-color-scheme: light) { html:not(.dark) .btn-primary { color: #ffffff; } }
```

- [ ] **Step 5: Badges — realinear a tokens (mover hex de base.css aquí o tokenizar)**

Reemplazar los hex hardcodeados de `badge-warning`/`badge-danger` (y los de `components.css` ~664-705) por mezclas de token, válidas en ambos temas:

```css
.badge-success { background: color-mix(in srgb, var(--color-success) 16%, transparent); color: var(--color-success); }
.badge-warning { background: color-mix(in srgb, var(--color-warning) 16%, transparent); color: var(--color-warning); }
.badge-danger  { background: color-mix(in srgb, var(--color-danger)  16%, transparent); color: var(--color-danger);  }
.badge-neutral { background: color-mix(in srgb, var(--text-secondary) 14%, transparent); color: var(--text-secondary); }
```
Eliminar de `base.css` los `.badge-warning/.badge-danger` con hex y sus overrides `html.dark`/media (quedan obsoletos). Verificar contraste del texto-sobre-tinte en Task 10.

- [ ] **Step 6: Verificar layout.css usa el acento (nav activo, hover, user-avatar)**

`layout.css` ya usa `var(--color-primary)` para nav activo/hover y `color-mix`. Verificar visualmente que el pill/indicador activo y el `.user-avatar` (en components.css ~1202) se vean champagne. Si `.user-avatar` tiene fondo hardcodeado, cambiarlo a `var(--color-primary)` con texto `#08080f`.

- [ ] **Step 7: Verificar — primitivas en preview**

Navegar a `#dashboard` (usa progress, chips, insights) y `#configuracion`.
- `preview_screenshot` dark 390px: barras finas 2px, nav activo champagne, botón primario champagne con texto oscuro legible.
- Toggle a light, screenshot: botón primario texto blanco, acento dorado oscuro legible.
- `preview_console_logs`: limpio.

- [ ] **Step 8: Commit**

```bash
git add css/components.css css/layout.css css/base.css
git commit -m "feat(rediseno): primitivas editoriales — progress 2px, chip 24x24 tintado, foco champagne, badges tokenizados"
```

---

## Task 2: Dashboard — `views/dashboard.html`

La vista más alineada ya (insight cards y presupuestos vienen de Fase 2/3). Refinar al sistema final: insight `border-left` 4px→**2px** + tinte 4%, hero/balances con Playfair, presup usando `.cat-chip`.

**Files:** Modify `views/dashboard.html` (bloque `<style>` ~85-430 y markup de render)

- [ ] **Step 1: Auditar hex hardcodeados**

```bash
grep -nE '#[0-9a-fA-F]{3,6}|rgba?\(' views/dashboard.html
```
Reemplazar según el mapa canónico. Conocido: `#3b82f6` (L204 `.dash-line-value--ahorro`) → `var(--color-info)`.

- [ ] **Step 2: Insight card → border-left 2px + fondo tintado 4%**

En `.insight-card` (~232-243) cambiar `border-left: 4px` → `2px` y el fondo de `var(--bg-light-secondary)` → tinte del color semántico. El color semántico ya lo fija el modificador (`--warn/--good/--alert/--info`); refactorizar para usar una var local:

```css
.insight-card {
  flex: 0 0 auto;
  width: min(85%, 300px);
  scroll-snap-align: start;
  display: flex; flex-direction: column; gap: var(--space-xs);
  padding: var(--space-md);
  border-radius: var(--radius-md);
  border-left: 2px solid var(--insight-color, var(--border-light));
  background: color-mix(in srgb, var(--insight-color, var(--color-primary)) 4%, var(--bg-light-secondary));
  box-shadow: none;
}
.insight-card--warn  { --insight-color: var(--color-warning); }
.insight-card--good  { --insight-color: var(--color-success); }
.insight-card--alert { --insight-color: var(--color-danger);  }
.insight-card--info  { --insight-color: var(--color-primary); }
```
(Borra los `border-left-color` sueltos de cada modificador; ahora derivan de `--insight-color`.)

- [ ] **Step 3: Números signature con Playfair — saludo, balance neto, valores hero**

Aplicar `.signature-num` (o `font-family: var(--font-display)`) a las cifras grandes. En el `<style>`:
- `.dash-neto-value` → añadir `font-family: var(--font-display); font-weight: 400;` y subir tamaño a `font-size: 2rem;` (cifra protagonista).
- Las filas `.dash-line-value` (cifras pequeñas en lista) **mantienen Outfit tabular** — Playfair solo para números grandes/hero, no para todo (regla del sistema).

Si el saludo `.dash-saludo` es un nombre (texto, no número), puede usar `var(--font-display)` como título editorial — opcional, mantener `--text-dark`.

- [ ] **Step 4: Presupuestos — usar `.cat-chip` 24×24 tintado**

En `renderPresupuestos` (~629) el ícono de categoría debe ir en `.cat-chip` con `--chip-color` = color de la categoría:
```js
// dentro del template del presupuesto:
`<span class="cat-chip" style="--chip-color:${esc(cat.color || 'var(--color-primary)')}">${icon}</span>`
```
Verificar que la barra de progreso del presupuesto use `.progress` (2px) con `--progress-color` semántico (bien/cerca/excedido) — ya existe la lógica `estadoPresupuesto`.

- [ ] **Step 5: Verificar dashboard**

`#dashboard` con datos de la cuenta de prueba.
- `preview_screenshot` dark 390px + 1024px: insights con barra-izq fina + tinte sutil (no fondo lleno), neto en Playfair grande, chips de presupuesto redondos tintados, barras 2px.
- Toggle light + screenshot: coherente.
- `preview_console_logs` limpio; abrir modal "+ Gasto" (FAB) y confirmar que sigue funcionando.

- [ ] **Step 6: Commit**

```bash
git add views/dashboard.html
git commit -m "feat(rediseno): dashboard editorial — insights 2px+tinte 4%, neto Playfair, chips presup 24x24"
```

---

## Task 3: Historial — `views/historial.html`

**Files:** Modify `views/historial.html` (`<style>` inline + render de filas)

- [ ] **Step 1: Auditar**
```bash
grep -nE '#[0-9a-fA-F]{3,6}|rgba?\(' views/historial.html
```
Reemplazar por tokens (mapa canónico). Montos +/− → `--color-success`/`--color-danger`; ahorro → `--color-info`.

- [ ] **Step 2: Montos en Playfair (cifras protagonistas de cada fila/total)**

El total del periodo / cabecera de saldo → `.signature-num` con `font-size` grande. Los montos por fila (`.hist-tx-monto`, components.css ~775) **siguen en Outfit tabular** (densidad de tabla). Aplicar Playfair solo al total/resumen superior si existe.

- [ ] **Step 3: Tabla / lista — bordes y zebra con tokens**

La tabla `.table-historial` (components.css) ya usa tokens; en el `<style>` inline de la vista reemplazar cualquier hex de fondo/borde por `var(--bg-light-secondary)`/`var(--border-light)`. Chips de categoría por fila → `.cat-chip` 24×24 tintado si los hay.

- [ ] **Step 4: Badges de tipo (hogar/personal/aporte/ahorro)**

`.hist-badge--*` (components.css ~744-789) deben derivar de tokens (Task 1 los tokenizó si comparten clase; si la vista define sus propios colores inline, alinearlos a `color-mix(... 16% ...)`).

- [ ] **Step 5: Verificar**
`#historial`: screenshot dark+light, 390px+1024px. Filas legibles, montos +/− distinguibles por color **y** glifo/signo (no solo color — WCAG 1.4.1; verificar que el signo está presente). `preview_console_logs` limpio. Scroll/filtros funcionan.

- [ ] **Step 6: Commit**
```bash
git add views/historial.html
git commit -m "feat(rediseno): historial editorial — tokens, total Playfair, chips y badges alineados"
```

---

## Task 4: Gráficos — `views/graficos.html` (incluye paleta Chart.js en JS)

Los gráficos se pintan con Chart.js → los colores se definen en **JS**, no solo CSS. Hay que actualizar la paleta de datasets para que use champagne + semánticos y que los ejes/labels lean los tokens.

**Files:** Modify `views/graficos.html` (`<style>` inline + config de Chart.js en el script de la vista)

- [ ] **Step 1: Auditar CSS + localizar la config de Chart.js**
```bash
grep -nE '#[0-9a-fA-F]{3,6}|rgba?\(|backgroundColor|borderColor|Chart\(' views/graficos.html
```

- [ ] **Step 2: Helper para leer tokens desde JS**

Añadir al script de la vista (antes de crear los charts):
```js
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
var PALETA = [
  cssVar('--color-primary'),   // champagne
  cssVar('--color-info'),
  cssVar('--color-success'),
  cssVar('--color-warning'),
  cssVar('--color-danger'),
  cssVar('--text-secondary')
];
```

- [ ] **Step 3: Aplicar la paleta + estilo de ejes a los datasets**

En cada `new Chart(...)`: `backgroundColor`/`borderColor` desde `PALETA`. Ejes/grid/labels:
```js
options: {
  plugins: { legend: { labels: { color: cssVar('--text-secondary'), font: { family: 'Outfit' } } } },
  scales: {
    x: { ticks: { color: cssVar('--text-secondary') }, grid: { color: cssVar('--border-light') } },
    y: { ticks: { color: cssVar('--text-secondary') }, grid: { color: cssVar('--border-light') } }
  }
}
```

- [ ] **Step 4: Re-render de charts al cambiar de tema (opcional pero recomendado)**

Chart.js no reacciona a CSS vars en vivo. Si el toggle de tema vive en otra vista (config), basta con que al navegar a `#graficos` se lean los tokens actuales — ya cubierto por `cssVar()` en el render. No requiere listener. Documentar: cambiar tema y volver a graficos re-pinta con la paleta correcta.

- [ ] **Step 5: Verificar**
`#graficos`: screenshot dark+light. Barras/líneas en champagne+semánticos, ejes y leyenda legibles sobre near-black (contraste de ticks ≥3:1). `preview_console_logs` sin errores de Chart.js.

- [ ] **Step 6: Commit**
```bash
git add views/graficos.html
git commit -m "feat(rediseno): graficos editorial — paleta Chart.js desde tokens, ejes/leyenda tematizados"
```

---

## Task 5: Metas — `views/metas.html`

**Files:** Modify `views/metas.html` (`<style>` inline + render)

- [ ] **Step 1: Auditar**
```bash
grep -nE '#[0-9a-fA-F]{3,6}|rgba?\(' views/metas.html
```
- [ ] **Step 2: Barras de progreso de meta → finas (2px) con `.progress`**
Reemplazar cualquier barra propia por la primitiva `.progress`/`.progress-bar` (Task 1). Color de progreso = `var(--color-primary)` (champagne) o semántico según cercanía a la meta.
- [ ] **Step 3: Cifras de meta (objetivo / acumulado) en Playfair**
Monto objetivo y acumulado actual → `.signature-num`. El % puede ir en Outfit.
- [ ] **Step 4: Chips de categoría de meta → `.cat-chip` 24×24 tintado.**
- [ ] **Step 5: Verificar** `#metas`: screenshot dark+light 390/1024. Crear/editar meta sigue funcionando; barras 2px; cifras Playfair. Console limpio.
- [ ] **Step 6: Commit**
```bash
git add views/metas.html
git commit -m "feat(rediseno): metas editorial — barras 2px, cifras Playfair, chips tintados"
```

---

## Task 6: Préstamos — `views/prestamos.html`

**Files:** Modify `views/prestamos.html` (`<style>` inline + render)

- [ ] **Step 1: Auditar**
```bash
grep -nE '#[0-9a-fA-F]{3,6}|rgba?\(' views/prestamos.html
```
- [ ] **Step 2: Montos de préstamo (te deben / debes) en Playfair signature**, color por dirección (`--color-success` cobrar / `--color-danger` pagar) + etiqueta textual (no solo color).
- [ ] **Step 3: Badges de estado (pendiente/pagado/vencido)** → tokens `color-mix` (warning/success/danger), patrón Task 1.
- [ ] **Step 4: Avatares/iniciales de persona** → fondo `color-mix(--color-primary 14%)`, texto `--color-primary` (consistencia con `.cat-chip`).
- [ ] **Step 5: Verificar** `#prestamos`: screenshot dark+light. Crear préstamo / registrar cobro funciona. Console limpio.
- [ ] **Step 6: Commit**
```bash
git add views/prestamos.html
git commit -m "feat(rediseno): prestamos editorial — montos Playfair, badges de estado tokenizados"
```

---

## Task 7: Configuración — `views/configuracion.html` (+ verificar toggle de tema)

Vista grande (56KB). Incluye el toggle de tema → verificar que sigue alternando correctamente con el nuevo default dark.

**Files:** Modify `views/configuracion.html` (`<style>` inline ~200-540 + verificar JS de tema ~1155-1173)

- [ ] **Step 1: Auditar**
```bash
grep -nE '#[0-9a-fA-F]{3,6}|rgba?\(' views/configuracion.html
```
Muchos `var(--bg-light)`/`var(--border-light)` ya presentes; reemplazar los hex sueltos.

- [ ] **Step 2: Verificar/ajustar `leerTema()` y `aplicarTema()` con el nuevo default**

`leerTema()` (L1155) hoy devuelve OS-pref si no hay storage. Con dark-default, alinear: si no hay valor guardado, devolver `'dark'` (coincide con el boot de index.html):
```js
function leerTema() {
  var stored = null;
  try { stored = localStorage.getItem('nestra-theme'); } catch (e) {}
  if (stored === 'dark' || stored === 'light') return stored;
  return 'dark';   // default editorial (coincide con boot anti-FOUC)
}
```
`aplicarTema()` ya hace `remove('dark','light')` + `add(tema)` + persiste → correcto. El toggle (`aria-checked`) reflejará dark al inicio.

- [ ] **Step 3: Danger zone** → fondo `color-mix(in srgb, var(--color-danger) 8%, var(--bg-light-secondary))`, borde `color-mix(--color-danger 30%)`. Texto del botón eliminar legible (AA).

- [ ] **Step 4: Toggle pill** (`.cfg-toggle`) → estado activo en `var(--color-primary)` (champagne).

- [ ] **Step 5: Filas de categoría / iconos** → `.cat-chip` y tokens.

- [ ] **Step 6: Verificar** `#configuracion`:
- Screenshot dark. Toggle a light → **toda la app** cambia, screenshot. Toggle de vuelta a dark.
- Recargar: persiste el tema elegido. Borrar `localStorage` y recargar → arranca dark.
- Editar límite de categoría inline / crear categoría siguen funcionando. Console limpio.

- [ ] **Step 7: Commit**
```bash
git add views/configuracion.html
git commit -m "feat(rediseno): configuracion editorial — tokens, toggle tema default-dark, danger zone tintada"
```

---

## Task 8: Vistas secundarias — transaccion, resumen, decisiones

**Files:** Modify `views/transaccion.html`, `views/resumen.html`, `views/decisiones.html`

- [ ] **Step 1: transaccion.html** (form, también usado como modal)
```bash
grep -nE '#[0-9a-fA-F]{3,6}|rgba?\(' views/transaccion.html
```
Reemplazar hex por tokens. Inputs/selects ya usan `.input` (components.css). Chips de plantilla/categoría → `.cat-chip`. Verificar como **vista completa** (`#transaccion`) y como **modal** (FAB "+ Gasto" desde dashboard) — ambos screenshot dark+light. El form guarda correctamente.

- [ ] **Step 2: resumen.html** (cifras mensuales)
```bash
grep -nE '#[0-9a-fA-F]{3,6}|rgba?\(' views/resumen.html
```
Cifras protagonistas (total mes, balance) → `.signature-num` Playfair. Resto tokens. Screenshot dark+light.

- [ ] **Step 3: decisiones.html** (oráculo / score)
```bash
grep -nE '#[0-9a-fA-F]{3,6}|rgba?\(' views/decisiones.html
```
El score/veredicto grande → Playfair signature; color del veredicto por semántica (`success`/`warning`/`danger`) + texto. Screenshot dark+light.

- [ ] **Step 4: Verificar** las 3 vistas: console limpio, interacción clave viva (guardar tx, calcular decisión).

- [ ] **Step 5: Commit**
```bash
git add views/transaccion.html views/resumen.html views/decisiones.html
git commit -m "feat(rediseno): transaccion/resumen/decisiones editorial — tokens, cifras Playfair"
```

---

## Task 9: Vistas públicas — login, reset-password (no-chrome)

Primer contacto visual. Pantalla editorial centrada, sin nav.

**Files:** Modify `views/login.html`, `views/reset-password.html`

- [ ] **Step 1: Auditar ambas**
```bash
grep -nE '#[0-9a-fA-F]{3,6}|rgba?\(' views/login.html views/reset-password.html
```
- [ ] **Step 2: login.html** — fondo near-black con el logo dark (`brand-logo--dark`), título de marca en Playfair, botón primario champagne (texto oscuro), inputs `.input`. Verificar que el logo correcto se muestra en dark.
- [ ] **Step 3: reset-password.html** — mismo tratamiento, coherente con login.
- [ ] **Step 4: Verificar** `#login` y `#reset-password`: screenshot dark+light 390px. Logo visible, contraste AA del título/botón, foco champagne en inputs. Console limpio. (No probar auth real — solo capa visual.)
- [ ] **Step 5: Commit**
```bash
git add views/login.html views/reset-password.html
git commit -m "feat(rediseno): login/reset editorial — pantalla near-black, marca Playfair, acento champagne"
```

---

## Task 10: Barrido de contraste WCAG AA (skill accessibility)

**Files:** Posibles micro-ajustes en `css/base.css` (valores de token) y vistas puntuales.

- [ ] **Step 1: Invocar la skill accessibility** y auditar contraste en CADA vista, en dark y light:
  - Texto normal sobre fondo: ≥ 4.5:1.
  - Texto grande (Playfair hero ≥ 24px / 18.66px bold) y componentes UI/bordes: ≥ 3:1.
  - Estados semánticos: `--color-success/danger/warning/info/primary` como **texto** sobre `--bg-light` y `--bg-light-secondary`, y como **texto sobre su propio tinte** (badges, insights al 4-16%).
  - Foco visible (champagne 2px) perceptible en ambos temas.
  - Señal no-solo-color (WCAG 1.4.1): montos +/− y veredictos llevan signo/glifo/etiqueta además del color — verificar.

- [ ] **Step 2: Medir los pares críticos** (usar herramienta de contraste de la skill):
  - Champagne `#c9a84c` sobre `#08080f` (links/nav en dark).
  - Champagne dark `#8a6d22` sobre `#faf8f3` y `#ffffff` (links en light) → debe pasar 4.5:1; si no, oscurecer el token.
  - `--text-secondary` dark `#a8a29a` sobre `#08080f` y sobre `#101019`.
  - Texto oscuro `#08080f` sobre botón primario champagne.
  - `--color-danger`/`success`/`warning` como texto sobre superficie en ambos temas.

- [ ] **Step 3: Corregir fallos ajustando SOLO los valores de token en base.css** (no romper la estética: ajustar luminancia mínima necesaria). Re-medir hasta que todos los pares pasen.

- [ ] **Step 4: Verificar** — registrar (en el commit o un comentario) los ratios de los pares críticos como evidencia. Re-screenshot de cualquier vista ajustada.

- [ ] **Step 5: Commit**
```bash
git add css/base.css views/
git commit -m "fix(rediseno): contraste WCAG AA en dark y light — ajustes de tokens y señales no-solo-color"
```

---

## Task 11: Smoke funcional final + cierre

- [ ] **Step 1: Recorrido completo en preview** (dark): login → dashboard → historial → graficos → metas → prestamos → resumen → decisiones → configuracion. En cada una: `preview_console_logs` sin errores; datos reales renderizan.
- [ ] **Step 2: Recorrido en light** (toggle en config): mismas vistas, sin glitches de tema, sin texto invisible.
- [ ] **Step 3: Interacciones clave**: abrir modal "+ Gasto" y guardar; alternar tema y recargar (persiste); colapsar sidebar en desktop; offline banner (si fácil de simular) no roto.
- [ ] **Step 4: Verificar PWA**: el SW sirve `base.css` v2 y las fuentes desde cache (DevTools → Application → Cache `nestra-precache` contiene las 4 woff2). `preview_eval`: `navigator.serviceWorker.controller` no nulo.
- [ ] **Step 5: Confirmar `SHELL_VERSION = 'v2'`** ya está (Task 0). Si se tocó el app shell después, no requiere nuevo bump salvo cambios en archivos precacheados no versionados por hash.
- [ ] **Step 6: Commit final (si quedaron ajustes)**
```bash
git add -A
git commit -m "chore(rediseno): smoke funcional final del rediseño editorial dark"
```

---

## Self-Review (checklist del autor del plan)

**1. Cobertura del spec (sistema de diseño aprobado):**
- ✅ Playfair (números grandes) + Outfit (UI), 2 pesos → Task 0 Step 5, aplicado por vista.
- ✅ Acento champagne #c9a84c (links/nav/avatar) → Task 0 token, Task 1 nav/avatar/botón.
- ✅ Insight cards border-left **2px** + tinte 4% (no fondo lleno) → Task 2 Step 2.
- ✅ Barras 2px → Task 1 Step 1, aplicado en metas/presupuestos.
- ✅ Chips categoría 24×24 tintados → Task 1 Step 2 (`.cat-chip`), aplicado por vista.
- ✅ Fondo near-black #08080f → Task 0 token `--bg-light`.
- ✅ Coherencia light mode → Task 0 Step 4 (paleta light) + verificación en cada tarea.
- ✅ TODAS las vistas (las 6 nombradas + secundarias + públicas) → Tasks 2-9.
- ✅ Contraste WCAG AA → Task 10 (skill accessibility).
- ✅ No romper funcionalidad → smoke en cada tarea + Task 11.

**2. Placeholders:** ninguno — cada paso de código muestra el CSS/JS real o el comando de auditoría + mapa de reemplazo concreto.

**3. Consistencia de tipos/nombres:** tokens conservan nombres existentes (valores cambian); clases nuevas consistentes (`.signature-num`, `.cat-chip`, `--insight-color`, `--chip-color`, `--color-info`, `--accent-hover`) usadas igual en todas las tareas; `SHELL_VERSION='v2'` único.

**Riesgo conocido:** colapsar `--font-weight-bold` a 600 (Step 3) aligera todos los textos "bold" de la app — intencional (regla "dos pesos máximo"), verificar que ningún título quede demasiado liviano en el barrido visual.
