# Préstamos View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `views/prestamos.html` — lista de préstamos pendientes con alerta >30 días, total desglosado hogar/personal, historial de devueltos colapsado, y flujo de devolución con modal de confirmación.

**Architecture:** 3 tareas en cadena. Task 1 crea la migración SQL (el usuario la aplica manualmente en Supabase). Task 2 actualiza `marcarDevuelto` en `db.js` para persistir `fecha_devolucion`. Task 3 crea `views/prestamos.html` como una única vista autónoma: HTML + CSS scopeado `.prest` + IIFE JS. Toda la lógica vive en el HTML (patrón del resto de vistas). Las funciones de db (`getPrestamos`, `marcarDevuelto`, `getProfiles`) y de formato (`formatMonto`, `formatFecha`) ya existen como globales.

**Tech Stack:** Vanilla JS (IIFE, `var`, sin módulos), CSS custom properties (tokens `--space-*` `--radius-*` `--color-primary` etc. definidos en `css/base.css`), Supabase JS SDK v2 (globales ya cargados por `index.html`).

---

## Dependencias entre tareas

```
Task 1 (migración SQL)
  └── Task 2 (db.js — persiste fecha_devolucion)
        └── Task 3 (vista prestamos.html)
```

Task 2 depende de la columna que Task 1 crea. Task 3 depende del `marcarDevuelto` actualizado de Task 2.

---

## Contexto de codebase (leer antes de implementar)

### Tablas relevantes

```sql
-- prestamos (solo estas columnas — el resto viene de transacciones)
id             uuid  PK
transaccion_id uuid  NOT NULL → transacciones(id) ON DELETE CASCADE
deudor         text  NOT NULL
estado         text  CHECK IN ('pendiente', 'devuelto')
-- fecha_devolucion date  ← Task 1 la agrega
```

```sql
-- transacciones (columnas que getPrestamos embebe)
id, fecha, monto, ambito ('personal'|'hogar'), nota, user_id
```

### Funciones globales en db.js

- `getPrestamos(estado?)` → `Promise<Array>` — cada item: `{ id, transaccion_id, deudor, estado, fecha_devolucion, transacciones: { fecha, monto, ambito, nota, user_id } }`
- `marcarDevuelto(prestamo_id, transaccion_id)` → `Promise<{ prestamo, ingreso }>` — actualmente NO setea `fecha_devolucion`; Task 2 lo arregla
- `getProfiles()` → `Promise<Array<{ user_id, nombre, ... }>>`

### Funciones globales en format.js

- `formatMonto(n)` → `"S/ 1,234.56"` (null/undefined → `"S/ 0.00"`)
- `formatFecha(iso)` → `"DD/MM/YYYY"` (null → `""`)

### Patrón de vistas existentes

- Contenedor raíz con prefijo CSS (`.hist`, `.metas`, `.prest`)
- IIFE con `'use strict'`, variables con `var`
- Helper `function $(id) { return document.getElementById(id); }`
- Modal con atributo `hidden` (no `display:none`)
- Toast con `display:none` / `display:flex`
- Delegación de eventos con `e.target.closest('[data-act="..."]')`
- Clase `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger` definidas en `css/components.css`
- Clase `.spinner` definida en `css/components.css`

---

## File Map

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `supabase/migrations/20260608_prestamos_fecha_devolucion.sql` | Crear | Agrega columna `fecha_devolucion date` a `prestamos` |
| `js/db.js` | Modificar (1 línea) | `marcarDevuelto` setea `fecha_devolucion = hoy` |
| `views/prestamos.html` | Crear | Vista completa: HTML + CSS + JS |

---

### Task 1: SQL Migration — `fecha_devolucion`

**Files:**
- Create: `supabase/migrations/20260608_prestamos_fecha_devolucion.sql`

> ⚠️ **El implementador NO aplica esta migración.** Solo crea el archivo. Al finalizar la tarea, avisar al usuario que debe ejecutar el SQL en el Editor SQL de Supabase antes de continuar con Task 2.

- [ ] **Step 1: Crear el archivo de migración**

Crear `supabase/migrations/20260608_prestamos_fecha_devolucion.sql` con este contenido exacto:

```sql
-- Migration: add fecha_devolucion to prestamos
-- Apply once in Supabase SQL Editor.

alter table public.prestamos
  add column if not exists fecha_devolucion date;
```

- [ ] **Step 2: Verificar que el archivo existe**

```bash
ls supabase/migrations/20260608_prestamos_fecha_devolucion.sql
```

Expected: el archivo existe, sin error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260608_prestamos_fecha_devolucion.sql
git commit -m "feat: migration — add fecha_devolucion to prestamos"
```

- [ ] **Step 4: Avisar al usuario**

Reportar: "Task 1 completa. **El usuario debe aplicar la migración en Supabase SQL Editor antes de continuar:**

```sql
alter table public.prestamos
  add column if not exists fecha_devolucion date;
```

Una vez aplicada, confirmar para continuar con Task 2."

---

### Task 2: Actualizar `marcarDevuelto` en `js/db.js`

**Files:**
- Modify: `js/db.js` (línea 816, dentro de `marcarDevuelto`)

Context: La función `marcarDevuelto` actualmente setea `{ estado: 'devuelto' }` en el update de la tabla `prestamos`. Task 1 ya agregó la columna `fecha_devolucion date`. Hay que incluirla en el update con el valor de la fecha de hoy en formato `'YYYY-MM-DD'`.

- [ ] **Step 1: Leer el contexto exacto de la línea a cambiar**

En `js/db.js` leer desde línea 813 hasta 821. Verificar que el bloque es:

```js
    // 2. Marcar el préstamo como devuelto (operación principal).
    const { data: prestamo, error: errPrestamo } = await supabase
      .from('prestamos')
      .update({ estado: 'devuelto' })
      .eq('id', prestamo_id)
      .select()
      .single();
    if (errPrestamo) throw errPrestamo;
```

- [ ] **Step 2: Reemplazar la línea del `.update()`**

Cambiar:
```js
      .update({ estado: 'devuelto' })
```

Por:
```js
      .update({ estado: 'devuelto', fecha_devolucion: new Date().toISOString().split('T')[0] })
```

El resultado completo del bloque debe quedar:

```js
    // 2. Marcar el préstamo como devuelto (operación principal).
    const { data: prestamo, error: errPrestamo } = await supabase
      .from('prestamos')
      .update({ estado: 'devuelto', fecha_devolucion: new Date().toISOString().split('T')[0] })
      .eq('id', prestamo_id)
      .select()
      .single();
    if (errPrestamo) throw errPrestamo;
```

- [ ] **Step 3: Verificar que no hay otros cambios en `marcarDevuelto`**

El resto de la función (lectura de transacción original, registro del ingreso, retorno) no cambia.

- [ ] **Step 4: Commit**

```bash
git add js/db.js
git commit -m "feat: marcarDevuelto — persist fecha_devolucion on return"
```

---

### Task 3: Crear `views/prestamos.html`

**Files:**
- Create: `views/prestamos.html`

Context: Vista SPA completa. Se inyecta en `<main id="app">` por el router cuando el hash es `#prestamos`. El router ya tiene `prestamos: { view: 'prestamos' }` en la tabla ROUTES. La vista recibe globales: `getPrestamos`, `marcarDevuelto`, `getProfiles`, `formatMonto`, `formatFecha`.

UX notes aplicadas:
- Total como card prominente ANTES de la lista (summary first, details below).
- Pendientes ordenados por días desc (más urgentes arriba).
- Confirmación modal antes de marcarDevuelto (previene taps accidentales).
- Spinner en botón durante la operación async.
- Count en toggle Sección 3: "Historial de devueltos (N)".
- Estado de carga (spinner) mientras carga la vista.

- [ ] **Step 1: Crear el archivo con la estructura HTML**

Crear `views/prestamos.html` con el siguiente contenido completo:

```html
<div class="prest">

  <!-- ── Header ──────────────────────────────────────────────── -->
  <header class="prest-header">
    <h1 class="prest-title">Préstamos</h1>
    <p class="prest-sub">Dinero prestado pendiente de devolución</p>
  </header>

  <!-- ── Loading ─────────────────────────────────────────────── -->
  <div id="prestLoading" class="prest-loading" role="status" aria-label="Cargando">
    <div class="prest-spinner-big"></div>
  </div>

  <!-- ── Sección: Total pendiente (card resumen, arriba de lista) -->
  <section id="prestTotalSection" style="display:none;">
    <div class="prest-total-card">
      <p class="prest-total-label">Total pendiente</p>
      <p class="prest-total-monto" id="prestTotalMonto">S/ 0.00</p>
      <div class="prest-total-desglose" id="prestTotalDesglose"></div>
    </div>
  </section>

  <!-- ── Sección 1: Préstamos pendientes ─────────────────────── -->
  <section id="prestPendientesSection" style="display:none;">
    <h2 class="prest-section-title">Pendientes</h2>
    <ul class="prest-lista" id="prestLista" role="list"></ul>
    <p class="prest-vacio" id="prestVacio" style="display:none;">
      No tienes préstamos pendientes.
      <span class="prest-vacio-hint">Registra préstamos desde la sección Transacción.</span>
    </p>
  </section>

  <!-- ── Sección 3: Historial de devueltos (colapsado) ────────── -->
  <section class="prest-devueltos-section">
    <button type="button" class="prest-dev-toggle" id="prestDevToggle"
            aria-expanded="false" aria-controls="prestDevPanel">
      <span id="prestDevLabel">Historial de devueltos</span>
      <span class="prest-dev-caret" aria-hidden="true">⌄</span>
    </button>
    <div class="prest-dev-panel" id="prestDevPanel" style="display:none;">
      <ul class="prest-lista prest-lista--devueltos" id="prestDevLista" role="list"></ul>
      <p class="prest-vacio" id="prestDevVacio" style="display:none;">
        Sin préstamos devueltos aún.
      </p>
    </div>
  </section>

  <!-- ── Modal: confirmar devolución ─────────────────────────── -->
  <div class="prest-modal-overlay" id="prestConfirmModal"
       role="dialog" aria-modal="true" aria-labelledby="prestConfirmTitle" hidden>
    <div class="prest-modal">
      <h2 class="prest-modal-title" id="prestConfirmTitle">Confirmar devolución</h2>
      <p class="prest-confirm-body" id="prestConfirmBody"></p>
      <div class="prest-modal-actions">
        <button type="button" class="btn btn-secondary" id="prestConfirmCancelar">Cancelar</button>
        <button type="button" class="btn btn-primary" id="prestConfirmOk">
          <span id="prestConfirmText">Marcar devuelto</span>
          <span id="prestConfirmSpinner" class="spinner" role="status"
                aria-label="Procesando" style="display:none;"></span>
        </button>
      </div>
    </div>
  </div>

  <!-- ── Toast ───────────────────────────────────────────────── -->
  <div class="prest-toast" id="prestToast"
       role="status" aria-live="polite" style="display:none;">
    <span id="prestToastMsg"></span>
  </div>

  <!-- ── Estilos ─────────────────────────────────────────────── -->
  <style>
    /* Layout */
    .prest {
      padding: var(--space-lg) var(--space-md);
      max-width: 700px;
      margin: 0 auto;
    }

    /* Header */
    .prest-header { margin-bottom: var(--space-xl); }
    .prest-title {
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-bold);
      margin: 0;
    }
    .prest-sub {
      color: var(--text-secondary);
      font-size: var(--font-size-sm);
      margin: var(--space-xs) 0 0;
    }

    /* Loading */
    .prest-loading {
      display: flex;
      justify-content: center;
      padding: var(--space-xl) 0;
    }
    .prest-spinner-big {
      width: 36px;
      height: 36px;
      border: 3px solid var(--border-light);
      border-top-color: var(--color-primary);
      border-radius: 50%;
      animation: prest-spin 0.8s linear infinite;
    }
    @keyframes prest-spin { to { transform: rotate(360deg); } }

    /* Total card */
    .prest-total-card {
      background: var(--bg-light-secondary);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-lg);
      padding: var(--space-lg);
      margin-bottom: var(--space-xl);
      text-align: center;
    }
    .prest-total-label {
      font-size: var(--font-size-sm);
      color: var(--text-secondary);
      margin: 0 0 var(--space-xs);
    }
    .prest-total-monto {
      font-size: 1.75rem;
      font-weight: var(--font-weight-bold);
      color: var(--color-primary);
      margin: 0 0 var(--space-sm);
    }
    .prest-total-desglose {
      display: flex;
      justify-content: center;
      gap: var(--space-md);
      font-size: var(--font-size-sm);
      color: var(--text-secondary);
      flex-wrap: wrap;
    }
    .prest-desglose-sep { opacity: 0.4; }

    /* Section title */
    .prest-section-title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      margin: 0 0 var(--space-md);
    }

    /* Cards list */
    .prest-lista {
      list-style: none;
      padding: 0;
      margin: 0 0 var(--space-xl);
      display: flex;
      flex-direction: column;
      gap: var(--space-md);
    }
    .prest-lista--devueltos { margin-top: var(--space-md); }

    /* Card */
    .prest-card {
      background: var(--bg-light-secondary);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-lg);
      padding: var(--space-lg);
    }
    .prest-card--alerta {
      border-color: #f59e0b;
      background: color-mix(in srgb, #f59e0b 5%, var(--bg-light-secondary));
    }
    .prest-card--devuelto { opacity: 0.7; }

    .prest-card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--space-sm);
      margin-bottom: var(--space-sm);
    }
    .prest-card-deudor {
      font-weight: var(--font-weight-semibold);
      font-size: var(--font-size-base);
    }
    .prest-card-monto {
      font-weight: var(--font-weight-bold);
      color: var(--color-primary);
      white-space: nowrap;
    }
    .prest-card-meta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-sm);
      align-items: center;
      font-size: var(--font-size-sm);
      color: var(--text-secondary);
      margin-bottom: var(--space-sm);
    }
    .prest-card-nota {
      font-size: var(--font-size-sm);
      color: var(--text-secondary);
      font-style: italic;
      margin: var(--space-xs) 0 var(--space-sm);
    }
    .prest-card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-sm);
      flex-wrap: wrap;
      margin-top: var(--space-sm);
    }
    .prest-card-dias { font-size: var(--font-size-sm); color: var(--text-secondary); }
    .prest-card-dias--alerta {
      color: #f59e0b;
      font-weight: var(--font-weight-medium);
    }

    /* Badge ámbito */
    .prest-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px var(--space-sm);
      border-radius: 9999px;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
    }
    .prest-badge--ambito {
      background: color-mix(in srgb, var(--color-primary) 10%, transparent);
      color: var(--color-primary);
    }

    /* Button devolver — full-width en móvil */
    .prest-btn-devolver { width: 100%; }

    /* Empty state */
    .prest-vacio {
      text-align: center;
      color: var(--text-secondary);
      padding: var(--space-xl) var(--space-md);
      margin: 0;
    }
    .prest-vacio-hint {
      display: block;
      font-size: var(--font-size-sm);
      margin-top: var(--space-xs);
      opacity: 0.7;
    }

    /* Devueltos toggle */
    .prest-devueltos-section { margin-bottom: var(--space-xl); }
    .prest-dev-toggle {
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: none;
      border: 1px solid var(--border-light);
      border-radius: var(--radius-md);
      padding: var(--space-md);
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-medium);
      cursor: pointer;
      color: inherit;
      transition: background 0.2s;
    }
    .prest-dev-toggle:hover { background: var(--bg-light-secondary); }
    .prest-dev-caret { font-size: 1.2rem; color: var(--text-secondary); }
    .prest-dev-panel { padding-top: var(--space-md); }

    /* Modal */
    .prest-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--space-md);
      z-index: 200;
    }
    .prest-modal-overlay[hidden] { display: none; }
    .prest-modal {
      background: var(--bg-light);
      border-radius: var(--radius-lg);
      padding: var(--space-xl);
      max-width: 420px;
      width: 100%;
    }
    .prest-modal-title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      margin: 0 0 var(--space-md);
    }
    .prest-confirm-body {
      color: var(--text-secondary);
      margin: 0 0 var(--space-lg);
      line-height: 1.5;
    }
    .prest-modal-actions {
      display: flex;
      gap: var(--space-sm);
      justify-content: flex-end;
      flex-wrap: wrap;
    }

    /* Toast — por encima de la nav inferior en móvil */
    .prest-toast {
      position: fixed;
      bottom: calc(var(--space-md) + 68px);
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-light-secondary);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-md);
      padding: var(--space-sm) var(--space-md);
      font-size: var(--font-size-sm);
      box-shadow: var(--shadow-md);
      z-index: 300;
      max-width: 90vw;
      white-space: nowrap;
    }

    /* Desktop adjustments */
    @media (min-width: 768px) {
      .prest-btn-devolver { width: auto; min-width: 180px; }
      .prest-total-monto { font-size: 2rem; }
      .prest-toast { bottom: var(--space-lg); }
    }
  </style>

  <!-- ── Script ──────────────────────────────────────────────── -->
  <script>
    (function () {
      'use strict';

      function $(id) { return document.getElementById(id); }

      var _devueltoId = null;
      var _devueltoTxId = null;
      var _toastTimer = null;

      /* ── Helpers ──────────────────────────────────────────── */

      function escHtml(str) {
        return String(str == null ? '' : str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      function diasDesde(fechaIso) {
        var p = String(fechaIso).split('T')[0].split('-');
        var fechaMs = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getTime();
        var hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        return Math.floor((hoy.getTime() - fechaMs) / 86400000);
      }

      function nombrePor(userId, perfiles) {
        var p = (perfiles || []).find(function (x) { return x.user_id === userId; });
        return p && p.nombre ? p.nombre : '—';
      }

      function mostrarToast(msg, ms) {
        var toast = $('prestToast');
        $('prestToastMsg').textContent = msg;
        clearTimeout(_toastTimer);
        toast.style.display = 'flex';
        _toastTimer = setTimeout(function () { toast.style.display = 'none'; }, ms || 4000);
      }

      /* ── Render pendientes ────────────────────────────────── */

      function renderPendientes(lista, perfiles) {
        var ul = $('prestLista');
        var seccion = $('prestPendientesSection');
        var vacio = $('prestVacio');

        seccion.style.display = 'block';

        if (!lista.length) {
          ul.innerHTML = '';
          vacio.style.display = 'block';
          return;
        }

        vacio.style.display = 'none';

        // Ordenar: más días primero (más urgentes arriba)
        var ordenados = lista.slice().sort(function (a, b) {
          return diasDesde(b.transacciones.fecha) - diasDesde(a.transacciones.fecha);
        });

        ul.innerHTML = ordenados.map(function (p) {
          var tx = p.transacciones;
          var dias = diasDesde(tx.fecha);
          var alerta = dias > 30;
          var ambitoLabel = tx.ambito === 'hogar' ? 'Hogar' : 'Personal';
          var quien = nombrePor(tx.user_id, perfiles);

          return '<li class="prest-card' + (alerta ? ' prest-card--alerta' : '') + '">' +
            '<div class="prest-card-header">' +
              '<span class="prest-card-deudor">' + escHtml(p.deudor) + '</span>' +
              '<span class="prest-card-monto">' + escHtml(formatMonto(tx.monto)) + '</span>' +
            '</div>' +
            '<div class="prest-card-meta">' +
              '<span class="prest-badge prest-badge--ambito">' + ambitoLabel + '</span>' +
              '<span class="prest-card-fecha">' + escHtml(formatFecha(tx.fecha)) + '</span>' +
              '<span class="prest-card-quien">Prestó: ' + escHtml(quien) + '</span>' +
            '</div>' +
            (tx.nota ? '<p class="prest-card-nota">' + escHtml(tx.nota) + '</p>' : '') +
            '<div class="prest-card-footer">' +
              (alerta
                ? '<span class="prest-card-dias prest-card-dias--alerta">⚠️ Vencido (' + dias + ' días)</span>'
                : '<span class="prest-card-dias">Hace ' + dias + ' día' + (dias === 1 ? '' : 's') + '</span>') +
              '<button type="button" class="btn btn-secondary btn-sm prest-btn-devolver"' +
                ' data-act="devolver"' +
                ' data-id="' + p.id + '"' +
                ' data-tx="' + p.transaccion_id + '"' +
                ' data-deudor="' + escHtml(p.deudor) + '"' +
                ' data-monto="' + escHtml(formatMonto(tx.monto)) + '">' +
                'Marcar como devuelto' +
              '</button>' +
            '</div>' +
          '</li>';
        }).join('');
      }

      /* ── Render total ─────────────────────────────────────── */

      function renderTotal(lista) {
        var totalHogar = 0;
        var totalPersonal = 0;

        lista.forEach(function (p) {
          var m = Number(p.transacciones.monto) || 0;
          if (p.transacciones.ambito === 'hogar') {
            totalHogar += m;
          } else {
            totalPersonal += m;
          }
        });

        $('prestTotalMonto').textContent = formatMonto(totalHogar + totalPersonal);
        $('prestTotalDesglose').innerHTML =
          '<span>Hogar: ' + escHtml(formatMonto(totalHogar)) + '</span>' +
          '<span class="prest-desglose-sep">·</span>' +
          '<span>Personal: ' + escHtml(formatMonto(totalPersonal)) + '</span>';
        $('prestTotalSection').style.display = 'block';
      }

      /* ── Render devueltos ─────────────────────────────────── */

      function renderDevueltos(lista) {
        var ul = $('prestDevLista');
        var vacio = $('prestDevVacio');
        var label = $('prestDevLabel');

        label.textContent = 'Historial de devueltos' + (lista.length ? ' (' + lista.length + ')' : '');

        if (!lista.length) {
          ul.innerHTML = '';
          vacio.style.display = 'block';
          return;
        }

        vacio.style.display = 'none';

        // Ordenar: fecha_devolucion desc, fallback fecha del préstamo desc
        var ordenados = lista.slice().sort(function (a, b) {
          var fa = a.fecha_devolucion || a.transacciones.fecha;
          var fb = b.fecha_devolucion || b.transacciones.fecha;
          return fb > fa ? 1 : fb < fa ? -1 : 0;
        });

        ul.innerHTML = ordenados.map(function (p) {
          var tx = p.transacciones;
          var fechaDev = p.fecha_devolucion ? escHtml(formatFecha(p.fecha_devolucion)) : '—';
          return '<li class="prest-card prest-card--devuelto">' +
            '<div class="prest-card-header">' +
              '<span class="prest-card-deudor">' + escHtml(p.deudor) + '</span>' +
              '<span class="prest-card-monto">' + escHtml(formatMonto(tx.monto)) + '</span>' +
            '</div>' +
            '<div class="prest-card-meta">' +
              '<span>Prestado: ' + escHtml(formatFecha(tx.fecha)) + '</span>' +
              '<span class="prest-desglose-sep">·</span>' +
              '<span>Devuelto: ' + fechaDev + '</span>' +
            '</div>' +
          '</li>';
        }).join('');
      }

      /* ── Cargar datos ─────────────────────────────────────── */

      async function cargar() {
        $('prestLoading').style.display = 'flex';
        $('prestTotalSection').style.display = 'none';
        $('prestPendientesSection').style.display = 'none';

        try {
          var res = await Promise.all([
            getPrestamos('pendiente'),
            getPrestamos('devuelto'),
            getProfiles(),
          ]);
          var pendientes = res[0];
          var devueltos  = res[1];
          var perfiles   = res[2];

          renderTotal(pendientes);
          renderPendientes(pendientes, perfiles);
          renderDevueltos(devueltos);
        } catch (err) {
          console.error('prestamos cargar:', err);
          mostrarToast('No se pudieron cargar los préstamos.', 5000);
        } finally {
          $('prestLoading').style.display = 'none';
        }
      }

      /* ── Delegación: botón "Marcar como devuelto" ─────────── */

      $('prestLista').addEventListener('click', function (e) {
        var btn = e.target.closest('[data-act="devolver"]');
        if (!btn) return;
        _devueltoId   = btn.dataset.id;
        _devueltoTxId = btn.dataset.tx;
        $('prestConfirmBody').textContent =
          '¿Confirmar que ' + btn.dataset.deudor + ' devolvió ' + btn.dataset.monto + '? ' +
          'Se registrará un ingreso de devolución automáticamente.';
        $('prestConfirmModal').removeAttribute('hidden');
        setTimeout(function () { $('prestConfirmCancelar').focus(); }, 50);
      });

      /* ── Modal: cerrar / cancelar ─────────────────────────── */

      function cerrarConfirm() {
        $('prestConfirmModal').setAttribute('hidden', '');
        $('prestConfirmOk').disabled = false;
        $('prestConfirmCancelar').disabled = false;
        $('prestConfirmText').style.display = 'inline';
        $('prestConfirmSpinner').style.display = 'none';
        _devueltoId   = null;
        _devueltoTxId = null;
      }

      $('prestConfirmCancelar').addEventListener('click', cerrarConfirm);

      $('prestConfirmModal').addEventListener('click', function (e) {
        if (e.target === e.currentTarget) cerrarConfirm();
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !$('prestConfirmModal').hasAttribute('hidden')) {
          cerrarConfirm();
        }
      });

      /* ── Modal: confirmar devolución ──────────────────────── */

      $('prestConfirmOk').addEventListener('click', async function () {
        if (!_devueltoId) return;
        var okBtn     = $('prestConfirmOk');
        var cancelBtn = $('prestConfirmCancelar');
        okBtn.disabled     = true;
        cancelBtn.disabled = true;
        $('prestConfirmText').style.display    = 'none';
        $('prestConfirmSpinner').style.display = 'inline-block';

        try {
          await marcarDevuelto(_devueltoId, _devueltoTxId);
          cerrarConfirm();
          mostrarToast('Préstamo marcado como devuelto.', 4000);
          await cargar();
        } catch (err) {
          okBtn.disabled     = false;
          cancelBtn.disabled = false;
          $('prestConfirmText').style.display    = 'inline';
          $('prestConfirmSpinner').style.display = 'none';
          mostrarToast('No se pudo marcar como devuelto. Reintenta.', 5000);
        }
      });

      /* ── Toggle sección historial ─────────────────────────── */

      $('prestDevToggle').addEventListener('click', function () {
        var panel    = $('prestDevPanel');
        var expanded = $('prestDevToggle').getAttribute('aria-expanded') === 'true';
        $('prestDevToggle').setAttribute('aria-expanded', expanded ? 'false' : 'true');
        panel.style.display = expanded ? 'none' : 'block';
        $('prestDevToggle').querySelector('.prest-dev-caret').textContent = expanded ? '⌄' : '⌃';
      });

      /* ── Init ─────────────────────────────────────────────── */
      cargar();

    })();
  </script>

</div>
```

- [ ] **Step 2: Verificar que el archivo existe**

```bash
ls views/prestamos.html
```

Expected: el archivo existe.

- [ ] **Step 3: Commit**

```bash
git add views/prestamos.html
git commit -m "feat: views/prestamos.html — pendientes, total, historial devueltos, modal confirm"
```

---

## Verificación en navegador (sin framework de tests)

Abrir la app en un servidor local y navegar a `#prestamos`. Verificar:

**Con préstamos pendientes:**
- [ ] Spinner visible mientras carga, desaparece al terminar.
- [ ] Card "Total pendiente" muestra el monto correcto en S/, desglosado Hogar + Personal.
- [ ] Cada tarjeta muestra: deudor, monto (S/), fecha (DD/MM/YYYY), badge ámbito, "Prestó: [nombre]", nota (si tiene), "Hace N días".
- [ ] Tarjeta con >30 días muestra ⚠️ "Vencido (N días)" con borde/fondo amarillo.
- [ ] Tarjetas ordenadas: más días transcurridos primero.
- [ ] Botón "Marcar como devuelto" abre modal de confirmación (no ejecuta directo).
- [ ] Modal describe deudor + monto; cancelar no hace nada; confirmar ejecuta el update, muestra toast y recarga la lista.
- [ ] El préstamo marcado desaparece de Pendientes y aparece en Devueltos tras la recarga.

**Sin préstamos pendientes:**
- [ ] Total en S/ 0.00; Hogar: S/ 0.00 · Personal: S/ 0.00.
- [ ] Estado vacío con texto "No tienes préstamos pendientes." y hint "Registra préstamos desde la sección Transacción."

**Sección 3 — Devueltos:**
- [ ] Toggle arranca colapsado; el label muestra "Historial de devueltos (N)".
- [ ] Expandir muestra tarjetas con: deudor, monto, fecha del préstamo, fecha de devolución (DD/MM/YYYY o "—" para datos previos).

**Responsive:**
- [ ] Móvil: botón "Marcar como devuelto" ocupa todo el ancho de la tarjeta; sin overflow horizontal.
- [ ] Desktop: botón tiene ancho mínimo; tarjetas legibles.
- [ ] Modo claro y oscuro sin regresiones visuales.
