# Préstamos — Crear Préstamo (Session D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a loan creation form to `views/prestamos.html` that lets users register both "Presté" (I lent) and "Me prestaron" (I borrowed) loans directly from the prestamos view.

**Architecture:** Two new pieces: (1) a DB migration that adds the 'Préstamo recibido' ingreso category and a tiny db.js tweak to expose `tipo` from the embedded transaction, and (2) a full new-loan modal inside prestamos.html that includes a direction toggle, form fields, and a view-local FAB that hides the global FAB. The existing confirm-devolver modal pattern is reused for structure. Direction is inferred from the linked transaction's `tipo` field (gasto=Presté, ingreso=Me prestaron) — no new columns needed.

**Tech Stack:** Vanilla JS IIFE, `var`, Supabase JS v2, CSS custom properties, `color-mix()`, dark/light mode via `html.dark` / `html.light`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `supabase/migrations/20260611_prestamo_recibido_categoria.sql` | Create | Insert 'Préstamo recibido' ingreso category |
| `js/db.js` | Modify (line 782) | Add `tipo` to `getPrestamos` transacciones select |
| `views/prestamos.html` | Modify | FAB + modal HTML/CSS/JS for loan creation + render direction badge |

---

## Task 1: Migration + db.js

**Files:**
- Create: `supabase/migrations/20260611_prestamo_recibido_categoria.sql`
- Modify: `js/db.js` line 782

### Why
`getPrestamos` currently selects `transacciones(fecha, monto, ambito, nota, user_id)` — missing `tipo`. Adding `tipo` lets the view distinguish "Presté" (gasto) from "Me prestaron" (ingreso) without a new table column. The migration adds the ingreso category needed for "Me prestaron" transactions.

- [ ] **Step 1: Create migration file**

Create `supabase/migrations/20260611_prestamo_recibido_categoria.sql`:

```sql
-- Migration: add 'Préstamo recibido' ingreso category for "me prestaron" loans
-- Idempotent: does nothing if category already exists.

insert into public.categorias (nombre, tipo)
values ('Préstamo recibido', 'ingreso')
on conflict do nothing;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use the `mcp__supabase__apply_migration` tool:
- migration_name: `20260611_prestamo_recibido_categoria`
- query: the SQL above

Verify no error returned.

- [ ] **Step 3: Update getPrestamos in js/db.js**

Find line ~782 in `js/db.js`:
```javascript
    let query = supabase
      .from('prestamos')
      .select('*, transacciones(fecha, monto, ambito, nota, user_id)');
```

Change to:
```javascript
    let query = supabase
      .from('prestamos')
      .select('*, transacciones(fecha, monto, ambito, nota, user_id, tipo)');
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260611_prestamo_recibido_categoria.sql js/db.js
git commit -m "feat(prestamos): add 'Préstamo recibido' category + expose tipo in getPrestamos"
```

---

## Task 2: prestamos.html — Complete nuevo préstamo feature

This is the main task. All changes land in `views/prestamos.html`. The file already has one modal (`prestConfirmModal`). We add a second modal (`prestNuevoModal`) plus a view-specific FAB that hides the global FAB.

**Files:**
- Modify: `views/prestamos.html`

### Full spec

#### A. View-local FAB (HTML — add before `<!-- ── Toast ──`)

Place the FAB HTML just before the `<!-- ── Toast ─────────────────────────────────────────────── -->` comment:

```html
  <!-- ── FAB: nuevo préstamo ─────────────────────────────────── -->
  <button type="button" class="prest-fab" id="prestFab"
          aria-label="Nuevo préstamo">
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
         stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
         stroke-linejoin="round" fill="none">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
    <span class="prest-fab-label">Nuevo préstamo</span>
  </button>
```

#### B. New loan modal (HTML — add just before `<!-- ── Toast ─────────────────────────────────────────────── -->`, after the FAB)

```html
  <!-- ── Modal: nuevo préstamo ───────────────────────────────── -->
  <div class="prest-modal-overlay prest-nuevo-overlay" id="prestNuevoModal"
       role="dialog" aria-modal="true" aria-labelledby="prestNuevoTitle" hidden>
    <div class="prest-modal prest-nuevo-modal">

      <!-- Header row: title + close -->
      <div class="prest-nuevo-header">
        <h2 class="prest-modal-title" id="prestNuevoTitle">Nuevo préstamo</h2>
        <button type="button" class="prest-nuevo-close" id="prestNuevoClose"
                aria-label="Cerrar">
          <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" fill="none" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Direction toggle -->
      <div class="prest-dir-toggle" role="group" aria-label="Dirección del préstamo">
        <button type="button" class="prest-dir-btn prest-dir-btn--active"
                id="prestDirPreste" data-dir="preste">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
               fill="none" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7"/>
          </svg>
          Presté
        </button>
        <button type="button" class="prest-dir-btn"
                id="prestDirRecibido" data-dir="recibido">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
               fill="none" aria-hidden="true">
            <path d="M12 5v14M19 12l-7 7-7-7"/>
          </svg>
          Me prestaron
        </button>
      </div>

      <!-- Form -->
      <form id="prestNuevoForm" class="prest-nuevo-form" novalidate>

        <!-- Persona -->
        <div class="prest-field">
          <label class="prest-label" for="prestPersona" id="prestPersonaLabel">
            Persona
          </label>
          <input class="prest-input" id="prestPersona" type="text"
                 placeholder="Nombre de la persona" autocomplete="off"
                 maxlength="100" required>
          <p class="prest-field-error" id="prestPersonaErr" role="alert"></p>
        </div>

        <!-- Monto -->
        <div class="prest-field">
          <label class="prest-label" for="prestMonto">Monto</label>
          <div class="prest-input-prefix-wrap">
            <span class="prest-input-prefix">S/</span>
            <input class="prest-input prest-input--prefixed" id="prestMonto"
                   type="number" inputmode="decimal" min="0.01" step="0.01"
                   placeholder="0.00" required>
          </div>
          <p class="prest-field-error" id="prestMontoErr" role="alert"></p>
        </div>

        <!-- Fecha -->
        <div class="prest-field">
          <label class="prest-label" for="prestFecha">Fecha</label>
          <input class="prest-input" id="prestFecha" type="date" required>
        </div>

        <!-- Ámbito -->
        <div class="prest-field">
          <label class="prest-label">Ámbito</label>
          <div class="prest-ambito-toggle" role="group" aria-label="Ámbito">
            <button type="button" class="prest-ambito-btn prest-ambito-btn--active"
                    id="prestAmbitoPersonal" data-ambito="personal">Personal</button>
            <button type="button" class="prest-ambito-btn"
                    id="prestAmbitoHogar" data-ambito="hogar">Hogar</button>
          </div>
        </div>

        <!-- Nota (optional) -->
        <div class="prest-field">
          <label class="prest-label" for="prestNota">
            Nota <span class="prest-label-opt">(opcional)</span>
          </label>
          <textarea class="prest-input prest-input--textarea" id="prestNota"
                    rows="2" maxlength="300"
                    placeholder="Motivo o descripción…"></textarea>
        </div>

        <!-- Error global -->
        <p class="prest-form-error" id="prestFormError" role="alert" style="display:none;"></p>

        <!-- Actions -->
        <div class="prest-nuevo-actions">
          <button type="button" class="btn btn-secondary" id="prestNuevoCancelar">
            Cancelar
          </button>
          <button type="submit" class="btn btn-primary prest-nuevo-submit" id="prestNuevoSubmit">
            <span id="prestNuevoText">Guardar préstamo</span>
            <span id="prestNuevoSpinner" class="spinner" role="status"
                  aria-label="Guardando" style="display:none;"></span>
          </button>
        </div>
      </form>

    </div>
  </div>
```

#### C. CSS additions (add inside the existing `<style>` block, after the last `@media` block and before `</style>`)

```css
    /* ── Dirección badge en cards ────────────────────────────── */
    .prest-badge--preste {
      background: color-mix(in srgb, #f59e0b 12%, transparent);
      color: #b45309;
    }
    html.dark .prest-badge--preste {
      background: color-mix(in srgb, #f59e0b 18%, transparent);
      color: #fbbf24;
    }
    .prest-badge--recibido {
      background: color-mix(in srgb, #10b981 12%, transparent);
      color: #047857;
    }
    html.dark .prest-badge--recibido {
      background: color-mix(in srgb, #10b981 18%, transparent);
      color: #34d399;
    }

    /* ── View FAB ────────────────────────────────────────────── */
    .prest-fab {
      position: fixed;
      bottom: calc(60px + env(safe-area-inset-bottom) + 8px);
      right: var(--space-lg);
      z-index: 90;
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      background: var(--color-primary);
      color: #fff;
      border: none;
      border-radius: 9999px;
      padding: 0 var(--space-lg) 0 var(--space-md);
      height: 48px;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      cursor: pointer;
      box-shadow: 0 4px 16px color-mix(in srgb, var(--color-primary) 35%, transparent);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .prest-fab:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px color-mix(in srgb, var(--color-primary) 45%, transparent);
    }
    .prest-fab:active { transform: translateY(0); }
    .prest-fab-label { white-space: nowrap; }

    @media (min-width: 768px) {
      .prest-fab { bottom: var(--space-xl); }
    }

    /* ── Nuevo préstamo modal ────────────────────────────────── */
    .prest-nuevo-overlay {
      align-items: flex-end;      /* sheet from bottom on mobile */
    }
    @media (min-width: 600px) {
      .prest-nuevo-overlay { align-items: center; }
    }
    .prest-nuevo-modal {
      max-width: 480px;
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      padding: var(--space-lg) var(--space-lg) calc(var(--space-lg) + env(safe-area-inset-bottom));
      max-height: 92vh;
      overflow-y: auto;
    }
    @media (min-width: 600px) {
      .prest-nuevo-modal {
        border-radius: var(--radius-lg);
        padding: var(--space-xl);
        max-height: 85vh;
      }
    }

    /* Header row */
    .prest-nuevo-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--space-lg);
    }
    .prest-nuevo-header .prest-modal-title { margin: 0; }
    .prest-nuevo-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: none;
      background: var(--bg-light-secondary);
      cursor: pointer;
      color: var(--text-secondary);
      flex-shrink: 0;
      transition: background 0.15s;
    }
    .prest-nuevo-close:hover { background: var(--border-light); }

    /* Direction toggle */
    .prest-dir-toggle {
      display: flex;
      background: var(--bg-light-secondary);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-md);
      padding: 3px;
      gap: 3px;
      margin-bottom: var(--space-lg);
    }
    .prest-dir-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-xs);
      padding: var(--space-sm) var(--space-md);
      border: none;
      border-radius: calc(var(--radius-md) - 2px);
      background: transparent;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.18s, color 0.18s, box-shadow 0.18s;
    }
    .prest-dir-btn--active {
      background: var(--bg-light);
      color: var(--text-primary);
      box-shadow: 0 1px 4px rgba(0,0,0,0.1);
    }
    html.dark .prest-dir-btn--active {
      box-shadow: 0 1px 4px rgba(0,0,0,0.35);
    }

    /* Form fields */
    .prest-nuevo-form { display: flex; flex-direction: column; gap: var(--space-md); }
    .prest-field { display: flex; flex-direction: column; gap: var(--space-xs); }
    .prest-label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--text-primary);
    }
    .prest-label-opt { font-weight: var(--font-weight-normal); color: var(--text-secondary); }
    .prest-input {
      background: var(--bg-light-secondary);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-md);
      padding: var(--space-sm) var(--space-md);
      font-size: var(--font-size-base);
      color: var(--text-primary);
      width: 100%;
      box-sizing: border-box;
      transition: border-color 0.15s;
      font-family: inherit;
    }
    .prest-input:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 15%, transparent);
    }
    .prest-input--textarea { resize: vertical; min-height: 64px; }
    .prest-input-prefix-wrap { position: relative; display: flex; align-items: center; }
    .prest-input-prefix {
      position: absolute;
      left: var(--space-md);
      font-size: var(--font-size-base);
      color: var(--text-secondary);
      pointer-events: none;
      user-select: none;
    }
    .prest-input--prefixed { padding-left: 2.2rem; }
    .prest-field-error {
      font-size: var(--font-size-xs);
      color: #ef4444;
      margin: 0;
      min-height: 1em;
    }
    .prest-form-error {
      font-size: var(--font-size-sm);
      color: #ef4444;
      background: color-mix(in srgb, #ef4444 8%, transparent);
      border: 1px solid color-mix(in srgb, #ef4444 20%, transparent);
      border-radius: var(--radius-sm);
      padding: var(--space-sm) var(--space-md);
      margin: 0;
    }

    /* Ámbito toggle */
    .prest-ambito-toggle {
      display: flex;
      background: var(--bg-light-secondary);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-md);
      padding: 3px;
      gap: 3px;
      width: fit-content;
    }
    .prest-ambito-btn {
      padding: var(--space-xs) var(--space-md);
      border: none;
      border-radius: calc(var(--radius-md) - 2px);
      background: transparent;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.18s, color 0.18s, box-shadow 0.18s;
    }
    .prest-ambito-btn--active {
      background: var(--bg-light);
      color: var(--text-primary);
      box-shadow: 0 1px 4px rgba(0,0,0,0.1);
    }
    html.dark .prest-ambito-btn--active { box-shadow: 0 1px 4px rgba(0,0,0,0.35); }

    /* Actions row */
    .prest-nuevo-actions {
      display: flex;
      gap: var(--space-sm);
      justify-content: flex-end;
      padding-top: var(--space-sm);
    }
    .prest-nuevo-submit { min-width: 160px; }
```

#### D. JS additions (add inside the IIFE, after the `_toastTimer` var declaration and before the `/* ── Helpers ──` comment)

Add new state vars after `var _toastTimer = null;`:
```javascript
      var _dirActual  = 'preste';   // 'preste' | 'recibido'
      var _ambitoNuevo = 'personal'; // 'personal' | 'hogar'
      var _catCache   = null;        // { prestamo: id, recibido: id }
```

Add after the existing `mostrarToast` helper:

```javascript
      /* ── Lookup categorías (cached) ──────────────────────── */

      async function getCatIds() {
        if (_catCache) return _catCache;
        var gastoCats   = await getCategorias('gasto');
        var ingresoCats = await getCategorias('ingreso');
        var catPrestamo = gastoCats.find(function (c) { return c.nombre === 'Dinero que prestamos'; });
        var catRecibido = ingresoCats.find(function (c) { return c.nombre === 'Préstamo recibido'; });
        _catCache = {
          prestamo: catPrestamo ? catPrestamo.id : null,
          recibido: catRecibido ? catRecibido.id : null,
        };
        return _catCache;
      }

      /* ── Modal nuevo préstamo ────────────────────────────── */

      function abrirNuevo() {
        // Reset form
        document.getElementById('prestNuevoForm').reset();
        document.getElementById('prestPersonaErr').textContent = '';
        document.getElementById('prestMontoErr').textContent = '';
        document.getElementById('prestFormError').style.display = 'none';
        document.getElementById('prestNuevoSubmit').disabled = false;
        document.getElementById('prestNuevoCancelar').disabled = false;
        document.getElementById('prestNuevoText').style.display = 'inline';
        document.getElementById('prestNuevoSpinner').style.display = 'none';

        // Default date = today
        var hoy = new Date();
        var mm = hoy.getMonth() + 1;
        var dd = hoy.getDate();
        document.getElementById('prestFecha').value =
          hoy.getFullYear() + '-' + (mm < 10 ? '0' + mm : mm) + '-' + (dd < 10 ? '0' + dd : dd);

        // Reset toggles
        _dirActual   = 'preste';
        _ambitoNuevo = 'personal';
        document.getElementById('prestDirPreste').classList.add('prest-dir-btn--active');
        document.getElementById('prestDirRecibido').classList.remove('prest-dir-btn--active');
        document.getElementById('prestAmbitoPersonal').classList.add('prest-ambito-btn--active');
        document.getElementById('prestAmbitoHogar').classList.remove('prest-ambito-btn--active');
        _actualizarLabelPersona();

        document.getElementById('prestNuevoModal').removeAttribute('hidden');
        setTimeout(function () { document.getElementById('prestPersona').focus(); }, 80);
      }

      function cerrarNuevo() {
        document.getElementById('prestNuevoModal').setAttribute('hidden', '');
      }

      function _actualizarLabelPersona() {
        var label = document.getElementById('prestPersonaLabel');
        label.textContent = _dirActual === 'preste' ? 'Persona (a quien presté)' : 'Persona (quien me prestó)';
        document.getElementById('prestPersona').placeholder =
          _dirActual === 'preste' ? 'Nombre del deudor' : 'Nombre del prestamista';
      }

      // Direction toggle
      document.getElementById('prestDirPreste').addEventListener('click', function () {
        if (_dirActual === 'preste') return;
        _dirActual = 'preste';
        document.getElementById('prestDirPreste').classList.add('prest-dir-btn--active');
        document.getElementById('prestDirRecibido').classList.remove('prest-dir-btn--active');
        _actualizarLabelPersona();
      });
      document.getElementById('prestDirRecibido').addEventListener('click', function () {
        if (_dirActual === 'recibido') return;
        _dirActual = 'recibido';
        document.getElementById('prestDirRecibido').classList.add('prest-dir-btn--active');
        document.getElementById('prestDirPreste').classList.remove('prest-dir-btn--active');
        _actualizarLabelPersona();
      });

      // Ámbito toggle
      document.getElementById('prestAmbitoPersonal').addEventListener('click', function () {
        _ambitoNuevo = 'personal';
        document.getElementById('prestAmbitoPersonal').classList.add('prest-ambito-btn--active');
        document.getElementById('prestAmbitoHogar').classList.remove('prest-ambito-btn--active');
      });
      document.getElementById('prestAmbitoHogar').addEventListener('click', function () {
        _ambitoNuevo = 'hogar';
        document.getElementById('prestAmbitoHogar').classList.add('prest-ambito-btn--active');
        document.getElementById('prestAmbitoPersonal').classList.remove('prest-ambito-btn--active');
      });

      // FAB click
      document.getElementById('prestFab').addEventListener('click', abrirNuevo);

      // Close button
      document.getElementById('prestNuevoClose').addEventListener('click', cerrarNuevo);
      document.getElementById('prestNuevoCancelar').addEventListener('click', cerrarNuevo);

      // Overlay click to close
      document.getElementById('prestNuevoModal').addEventListener('click', function (e) {
        if (e.target === e.currentTarget) cerrarNuevo();
      });

      // Escape key (shared handler already listens for prestConfirmModal; extend it)
      // NOTE: the existing keydown handler is for prestConfirmModal — we add a second listener
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !document.getElementById('prestNuevoModal').hasAttribute('hidden')) {
          cerrarNuevo();
        }
      });

      /* ── Submit nuevo préstamo ───────────────────────────── */

      document.getElementById('prestNuevoForm').addEventListener('submit', async function (e) {
        e.preventDefault();

        // Validate
        var persona = document.getElementById('prestPersona').value.trim();
        var monto   = parseFloat(document.getElementById('prestMonto').value);
        var fecha   = document.getElementById('prestFecha').value;
        var nota    = document.getElementById('prestNota').value.trim();

        var valido = true;
        document.getElementById('prestPersonaErr').textContent = '';
        document.getElementById('prestMontoErr').textContent = '';
        document.getElementById('prestFormError').style.display = 'none';

        if (!persona) {
          document.getElementById('prestPersonaErr').textContent = 'Ingresa el nombre de la persona.';
          valido = false;
        }
        if (!monto || monto <= 0 || isNaN(monto)) {
          document.getElementById('prestMontoErr').textContent = 'Ingresa un monto válido mayor a 0.';
          valido = false;
        }
        if (!valido) return;

        // Disable UI
        var submitBtn  = document.getElementById('prestNuevoSubmit');
        var cancelBtn  = document.getElementById('prestNuevoCancelar');
        submitBtn.disabled  = true;
        cancelBtn.disabled  = true;
        document.getElementById('prestNuevoText').style.display    = 'none';
        document.getElementById('prestNuevoSpinner').style.display = 'inline-block';

        try {
          var cats = await getCatIds();
          var catId = _dirActual === 'preste' ? cats.prestamo : cats.recibido;
          if (!catId) throw new Error('No se encontró la categoría de préstamo. Contacta soporte.');

          var tx = await insertTransaccion({
            tipo:        _dirActual === 'preste' ? 'gasto' : 'ingreso',
            ambito:      _ambitoNuevo,
            categoria_id: catId,
            monto:       monto,
            fecha:       fecha || undefined,
            nota:        nota || null,
          });

          await insertPrestamo(tx.id, persona, 'pendiente');

          cerrarNuevo();
          var dirLabel = _dirActual === 'preste' ? 'Préstamo registrado.' : 'Préstamo recibido registrado.';
          mostrarToast(dirLabel, 4000);
          await cargar();

        } catch (err) {
          submitBtn.disabled  = false;
          cancelBtn.disabled  = false;
          document.getElementById('prestNuevoText').style.display    = 'inline';
          document.getElementById('prestNuevoSpinner').style.display = 'none';
          var errMsg = document.getElementById('prestFormError');
          errMsg.textContent = 'No se pudo guardar el préstamo. ' + (err.message || 'Reintenta.');
          errMsg.style.display = 'block';
        }
      });
```

#### E. Update `renderPendientes` to show direction badge

Find in the existing `renderPendientes` function the HTML generation for each card. The current badge line is:
```javascript
              '<span class="prest-badge prest-badge--ambito">' + ambitoLabel + '</span>' +
```

Replace the entire `ul.innerHTML = ordenados.map(...)` block with this updated version that adds a direction badge and updates the "Prestó" meta text:

The key changes inside the map function:
1. Add `var esPrestado = !tx.tipo || tx.tipo === 'gasto';` after `var quien = ...`
2. Add direction badge before or after ámbito badge
3. Change `'Prestó: ' + escHtml(quien)` to `esPrestado ? ('Prestó: ' + escHtml(quien)) : ('Recibido de: ' + escHtml(p.deudor))`

Full updated `renderPendientes` function (replace entire function):

```javascript
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

        var ordenados = lista.slice().sort(function (a, b) {
          return diasDesde(b.transacciones.fecha) - diasDesde(a.transacciones.fecha);
        });

        ul.innerHTML = ordenados.map(function (p) {
          var tx = p.transacciones;
          var dias = diasDesde(tx.fecha);
          var alerta = dias > 30;
          var ambitoLabel = tx.ambito === 'hogar' ? 'Hogar' : 'Personal';
          var quien = nombrePor(tx.user_id, perfiles);
          var esPrestado = !tx.tipo || tx.tipo === 'gasto';

          return '<li class="prest-card' + (alerta ? ' prest-card--alerta' : '') + '">' +
            '<div class="prest-card-header">' +
              '<span class="prest-card-deudor">' + escHtml(p.deudor) + '</span>' +
              '<span class="prest-card-monto">' + escHtml(formatMonto(tx.monto)) + '</span>' +
            '</div>' +
            '<div class="prest-card-meta">' +
              '<span class="prest-badge ' + (esPrestado ? 'prest-badge--preste' : 'prest-badge--recibido') + '">' +
                (esPrestado ? '↑ Presté' : '↓ Me prestaron') +
              '</span>' +
              '<span class="prest-badge prest-badge--ambito">' + ambitoLabel + '</span>' +
              '<span class="prest-card-fecha">' + escHtml(formatFecha(tx.fecha)) + '</span>' +
              (esPrestado
                ? '<span class="prest-card-quien">Por: ' + escHtml(quien) + '</span>'
                : '') +
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
                (esPrestado ? 'Marcar como devuelto' : 'Marcar como pagado') +
              '</button>' +
            '</div>' +
          '</li>';
        }).join('');
      }
```

#### F. Update empty-state hint text

Find and replace the `prest-vacio-hint` text from "Registra préstamos desde la sección Transacción." to "Toca el botón Nuevo préstamo para registrar uno." — since users can now create loans directly from this view.

In the HTML section, the current text is:
```html
      <span class="prest-vacio-hint">Registra préstamos desde la sección Transacción.</span>
```

Replace with:
```html
      <span class="prest-vacio-hint">Toca el botón + Nuevo préstamo para registrar uno.</span>
```

#### G. Hide global FAB on init

Inside the IIFE, just before `cargar();` at the bottom:

```javascript
      /* ── Ocultar FAB global (usamos el FAB de esta vista) ─── */
      if (typeof hideFab === 'function') hideFab();
```

- [ ] **Step 1: Read `views/prestamos.html` current state**

Read the file to locate exact insertion points for each section (A–G).

- [ ] **Step 2: Insert FAB HTML (section A)**

Add the FAB button HTML just before the `<!-- ── Toast ──` comment (around line 65 of the current file). Use exact HTML from section A above.

- [ ] **Step 3: Insert nuevo préstamo modal HTML (section B)**

Add the modal HTML just after the FAB, before the `<!-- ── Toast ──` comment. Use exact HTML from section B above.

- [ ] **Step 4: Add CSS (section C)**

Inside `<style>`, after the last `@media (min-width: 768px)` block and before `</style>`, insert all CSS from section C.

- [ ] **Step 5: Update empty-state hint text (section F)**

Replace the `prest-vacio-hint` text using exact strings from section F.

- [ ] **Step 6: Replace `renderPendientes` function (section E)**

Find the entire `function renderPendientes(lista, perfiles) {` block and replace with the updated version from section E. This is a ~35-line replacement.

- [ ] **Step 7: Add new JS state vars (section D, vars only)**

After `var _toastTimer = null;`, add:
```javascript
      var _dirActual  = 'preste';
      var _ambitoNuevo = 'personal';
      var _catCache   = null;
```

- [ ] **Step 8: Add getCatIds helper + all modal JS (section D)**

After the `mostrarToast` function, insert all JS from section D (getCatIds, abrirNuevo, cerrarNuevo, direction toggle handlers, ámbito toggle handlers, FAB click, close handlers, Escape listener, submit handler).

- [ ] **Step 9: Add hideFab call before cargar() (section G)**

Just before `cargar();` at the bottom of the IIFE, add:
```javascript
      if (typeof hideFab === 'function') hideFab();
```

- [ ] **Step 10: Verify file is valid HTML**

Read the final file and confirm:
- FAB HTML is present before Toast comment
- Modal `#prestNuevoModal` is present
- CSS for `.prest-fab`, `.prest-dir-toggle`, `.prest-nuevo-modal` etc. exists
- No duplicate IDs
- Script IIFE closes properly (one `})();` + `</script>`)
- `hideFab()` call is just before `cargar()`

- [ ] **Step 11: Commit**

```bash
git add views/prestamos.html
git commit -m "feat(prestamos): add new loan creation modal with Presté/Me-prestaron toggle"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|-------------|------|
| "a favor" (Presté) option | Task 2 — direction toggle + gasto tx |
| "en contra" (Me prestaron) option | Task 1 (category) + Task 2 (direction toggle + ingreso tx) |
| Works on mobile | Task 2 — sheet-style modal (align-items:flex-end on mobile), safe-area-inset padding |
| Works on desktop | Task 2 — centered card on ≥600px, FAB repositioned |
| FAB/action button visible | Task 2 section A — view-local FAB |
| UX/UI pro max | Task 2 — direction toggle pill, segmented ámbito, refined form, direction badge in cards |

### Placeholder scan
None found. All code blocks are complete.

### Type consistency
- `insertTransaccion({tipo, ambito, categoria_id, monto, fecha, nota})` — matches db.js signature
- `insertPrestamo(tx.id, persona, 'pendiente')` — matches db.js signature `insertPrestamo(transaccion_id, deudor, estado)`
- `getCategorias(tipo)` — matches db.js `async function getCategorias(tipo = null)`
- `tx.tipo` — added to select in Task 1 (was missing, needed for direction detection)

### Edge cases
- `tx.tipo` may be null on old records (getPrestamos was never selecting it) → guard with `!tx.tipo || tx.tipo === 'gasto'` (defaults to "Presté" for old data — safe)
- `_catCache = null` — reset happens at module load (new IIFE per view load), so stale categories never persist across nav

---

## Notes for implementer

**Existing patterns to follow:**
- IIFE `(function () { 'use strict'; ... })()` — all new code goes INSIDE existing IIFE
- `var` only — no `let/const`
- `$('id')` shorthand (already defined: `function $(id) { return document.getElementById(id); }`)
- `escHtml(str)` for all user-generated content in innerHTML
- `formatMonto()` and `formatFecha()` from js/format.js — available globally
- `getCategorias()`, `insertTransaccion()`, `insertPrestamo()` from js/db.js — available globally
- `hideFab()` defined in index.html — available globally

**Modal z-index:** `.prest-modal-overlay` already has `z-index: 200` — the new `.prest-nuevo-overlay` inherits it since it reuses the same class.

**Do NOT modify:**
- The confirm-devolution modal (`#prestConfirmModal`) logic
- The `cargar()` function structure
- The `marcarDevuelto` function in db.js (out of scope)
