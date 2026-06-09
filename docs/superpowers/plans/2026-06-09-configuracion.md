# Plan: Vista de Configuración

**Date:** 2026-06-09
**Branch:** feat/configuracion
**Spec:** docs/superpowers/specs/2026-06-09-configuracion-design.md
**Tasks:** 3

---

## Task 1 — Añadir funciones a `js/db.js`

**File:** `js/db.js`
**Model:** haiku

Añadir al final del fichero, antes del último bloque si lo hay, dos nuevas funciones:

### `reasignarCategoria(fromId, toId)`

```js
// reasignarCategoria(fromId, toId) — Cambia la categoría de todas las transacciones
// que usan fromId por toId. Usado antes de eliminar una categoría con historial.
// Returns: { count: N } donde N = filas actualizadas. Lanza Error en fallo.
async function reasignarCategoria(fromId, toId) {
  try {
    const { data, error } = await supabase
      .from('transacciones')
      .update({ categoria_id: toId })
      .eq('categoria_id', fromId)
      .select('id');
    if (error) throw error;
    return { count: (data || []).length };
  } catch (err) {
    console.error('Error en reasignarCategoria():', err.message || err);
    throw err;
  }
}
```

### `resetearDatosUsuario()`

```js
// resetearDatosUsuario() — Elimina todas las transacciones del usuario activo
// (personal y como participante del hogar visible vía RLS).
// Cascades en Supabase borran prestamos y aportes_meta asociados.
// IRREVERSIBLE. Returns: undefined. Lanza Error en fallo.
async function resetearDatosUsuario() {
  try {
    const userId = _requireUserId();
    const { error } = await supabase
      .from('transacciones')
      .delete()
      .eq('user_id', userId);
    if (error) throw error;
  } catch (err) {
    console.error('Error en resetearDatosUsuario():', err.message || err);
    throw err;
  }
}
```

Commit: `feat: db — reasignarCategoria, resetearDatosUsuario`

---

## Task 2 — Añadir `exportJSON` a `js/export.js`

**File:** `js/export.js`
**Model:** haiku

Añadir dentro del IIFE de `exportador`, antes del `return`:

```js
  // exportJSON(datos) — genera y descarga un archivo .json con el respaldo.
  // datos: objeto con claves { transacciones, categorias, metas, perfiles, ... }
  // Returns: { ok: true } | { ok: false, reason: 'sin-datos'|'descarga-fallo' }
  function exportJSON(datos) {
    if (!datos || (typeof datos === 'object' && Object.keys(datos).length === 0)) {
      return { ok: false, reason: 'sin-datos' };
    }
    try {
      var json    = JSON.stringify(datos, null, 2);
      var blob    = new Blob([json], { type: 'application/json' });
      var url     = URL.createObjectURL(blob);
      var link    = document.createElement('a');
      var hoy     = new Date();
      var pad     = function (n) { return n < 10 ? '0' + n : String(n); };
      var nombre  = 'nestra-respaldo-' +
                    hoy.getFullYear() + '-' + pad(hoy.getMonth() + 1) + '-' + pad(hoy.getDate()) +
                    '.json';
      link.href     = url;
      link.download = nombre;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'descarga-fallo' };
    }
  }
```

Actualizar el return para incluir `exportJSON`:
```js
  return { exportXLSX: exportXLSX, exportPDF: exportPDF, exportJSON: exportJSON };
```

Commit: `feat: exportador.exportJSON — descarga respaldo JSON`

---

## Task 3 — Crear `views/configuracion.html`

**File:** `views/configuracion.html` (nuevo — view fragment, sin html/head/body)
**Model:** sonnet

### Globals disponibles
```js
// Data
getProfiles()                            // → [{ user_id, nombre, aporte_mensual_esperado }]
updateProfile({ nombre?, aporte_mensual_esperado? })  // → fila | lanza
getCategorias(tipo?)                     // → [{ id, nombre, tipo, limite_mensual }]
insertCategoria({ nombre, tipo, limite_mensual? })    // → fila | lanza
updateCategoria(id, datos)              // → fila | lanza
deleteCategoria(id)                     // → void | lanza (FK restrict si tiene txs)
archivarCategoria(id)                   // → fila | lanza
reasignarCategoria(fromId, toId)        // → { count } | lanza
resetearDatosUsuario()                  // → void | lanza
getTransacciones({ categoria_id })      // → array (para contar historial)
getMetas()                              // → array (para export)
logout()                                // → void
// Export
exportador.exportJSON(datos)            // → { ok, reason? }
// Format
formatMonto(n)                          // → "S/ 1,234.56"
// Auth
window.currentUser                      // → { id, email }
```

### Estructura HTML raíz

```html
<div class="cfg">
  <!-- Header -->
  <header class="cfg-header">
    <h1 class="cfg-titulo">Configuración</h1>
  </header>

  <!-- Loading -->
  <div id="cfgLoading" class="cfg-loading" role="status" aria-label="Cargando">
    <div class="cfg-spinner"></div>
  </div>

  <!-- S1: Perfiles -->
  <section class="cfg-card" id="cfgPerfilesSection" style="display:none">
    <h2 class="cfg-section-label">Perfiles</h2>
    <div id="cfgPerfilesCont"></div>
  </section>

  <!-- S2: Categorías -->
  <section class="cfg-card" id="cfgCatSection" style="display:none">
    <div class="cfg-section-header-row">
      <h2 class="cfg-section-label">Categorías</h2>
      <button type="button" class="cfg-btn-add" id="cfgCatAddBtn" aria-expanded="false">
        <span aria-hidden="true">+</span> Nueva
      </button>
    </div>

    <!-- Form nueva categoría (colapsado por defecto) -->
    <div id="cfgCatForm" class="cfg-cat-form" style="display:none">
      <input id="cfgCatNombre" type="text" class="cfg-input" placeholder="Nombre de categoría" maxlength="50">
      <select id="cfgCatTipo" class="cfg-select">
        <option value="gasto">Gasto</option>
        <option value="ingreso">Ingreso</option>
      </select>
      <input id="cfgCatLimite" type="number" class="cfg-input" placeholder="Límite mensual (opcional)" min="0" step="0.01">
      <div class="cfg-cat-form-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="cfgCatFormCancelar">Cancelar</button>
        <button type="button" class="btn btn-primary btn-sm" id="cfgCatFormGuardar">Guardar</button>
      </div>
    </div>

    <!-- Lista agrupada -->
    <div id="cfgCatGastos" class="cfg-cat-grupo">
      <p class="cfg-cat-tipo-label">Gastos</p>
      <ul class="cfg-cat-lista" id="cfgCatListaGastos" role="list"></ul>
    </div>
    <div id="cfgCatIngresos" class="cfg-cat-grupo">
      <p class="cfg-cat-tipo-label">Ingresos</p>
      <ul class="cfg-cat-lista" id="cfgCatListaIngresos" role="list"></ul>
    </div>
  </section>

  <!-- S3: Preferencias -->
  <section class="cfg-card" id="cfgPrefSection" style="display:none">
    <h2 class="cfg-section-label">Preferencias</h2>
    <div class="cfg-pref-lista">

      <div class="cfg-pref-row">
        <div class="cfg-pref-info">
          <span class="cfg-pref-nombre">Modo oscuro</span>
        </div>
        <button type="button" class="cfg-toggle" id="cfgDarkToggle" role="switch" aria-checked="false" aria-label="Activar modo oscuro">
          <span class="cfg-toggle-thumb"></span>
        </button>
      </div>

      <div class="cfg-pref-row cfg-pref-row--readonly">
        <div class="cfg-pref-info">
          <span class="cfg-pref-nombre">Moneda</span>
          <span class="cfg-pref-valor">Soles (S/)</span>
        </div>
      </div>

      <div class="cfg-pref-row cfg-pref-row--readonly">
        <div class="cfg-pref-info">
          <span class="cfg-pref-nombre">Idioma</span>
          <span class="cfg-pref-valor">Español</span>
        </div>
      </div>

    </div>
  </section>

  <!-- S4: Datos -->
  <section class="cfg-card cfg-card--datos" id="cfgDatosSection" style="display:none">
    <h2 class="cfg-section-label">Datos</h2>

    <div class="cfg-datos-acciones">
      <button type="button" class="btn btn-secondary" id="cfgBtnExportJson">Exportar respaldo JSON</button>
      <button type="button" class="btn btn-secondary" id="cfgBtnImportJson">Importar desde respaldo</button>
      <input type="file" id="cfgImportInput" accept=".json" style="display:none">
    </div>

    <div class="cfg-datos-separador"></div>

    <div class="cfg-datos-acciones">
      <button type="button" class="btn btn-secondary" id="cfgBtnLogout">Cerrar sesión</button>
    </div>

    <div class="cfg-zona-peligro">
      <p class="cfg-peligro-label">Zona de peligro</p>
      <button type="button" class="btn btn-danger" id="cfgBtnReset">Resetear todos los datos</button>
    </div>
  </section>

  <!-- Modal: eliminar categoría -->
  <div class="cfg-modal-overlay" id="cfgDeleteModal" role="dialog" aria-modal="true" aria-labelledby="cfgDeleteTitle" hidden>
    <div class="cfg-modal">
      <h2 class="cfg-modal-title" id="cfgDeleteTitle">Eliminar categoría</h2>
      <p id="cfgDeleteInfo" class="cfg-modal-body"></p>
      <div id="cfgDeleteReasignRow" class="cfg-delete-reasign" style="display:none">
        <label class="cfg-label" for="cfgDeleteTarget">Reasignar transacciones a:</label>
        <select id="cfgDeleteTarget" class="cfg-select"></select>
      </div>
      <div class="cfg-modal-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="cfgDeleteCancelar">Cancelar</button>
        <button type="button" class="btn btn-secondary btn-sm" id="cfgDeleteArchivar">Archivar</button>
        <button type="button" class="btn btn-danger btn-sm" id="cfgDeleteConfirm">Eliminar</button>
      </div>
    </div>
  </div>

  <!-- Modal: reset datos -->
  <div class="cfg-modal-overlay" id="cfgResetModal" role="dialog" aria-modal="true" aria-labelledby="cfgResetTitle" hidden>
    <div class="cfg-modal">
      <h2 class="cfg-modal-title cfg-modal-title--danger" id="cfgResetTitle">Resetear todos los datos</h2>
      <p class="cfg-modal-body">Esta acción eliminará todas tus transacciones. <strong>Es irreversible.</strong></p>
      <p class="cfg-modal-body">Escribe <code>CONFIRMAR</code> para continuar:</p>
      <input type="text" id="cfgResetInput" class="cfg-input" placeholder="CONFIRMAR" autocomplete="off">
      <div class="cfg-modal-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="cfgResetCancelar">Cancelar</button>
        <button type="button" class="btn btn-danger btn-sm" id="cfgResetConfirm" disabled>Resetear</button>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div class="cfg-toast" id="cfgToast" role="status" aria-live="polite" style="display:none">
    <span id="cfgToastMsg"></span>
  </div>

  <style>/* CSS aquí */</style>
  <script>/* IIFE aquí */</script>
</div>
```

### CSS (scoped a `.cfg`)

```css
.cfg {
  padding: var(--space-lg) var(--space-md);
  max-width: 680px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
}

/* Header */
.cfg-titulo {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  margin: 0 0 var(--space-lg);
}

/* Cards de sección */
.cfg-card {
  background: var(--bg-light-secondary);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
}

/* Section labels — uppercase small */
.cfg-section-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  margin: 0 0 var(--space-md);
}

.cfg-section-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-md);
}
.cfg-section-header-row .cfg-section-label { margin: 0; }

/* Loading */
.cfg-loading {
  display: flex;
  justify-content: center;
  padding: var(--space-xl) 0;
}
.cfg-spinner {
  width: 32px; height: 32px;
  border: 3px solid var(--border-light);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: cfg-spin 0.8s linear infinite;
}
@keyframes cfg-spin { to { transform: rotate(360deg); } }

/* Perfiles */
.cfg-perfil {
  padding: var(--space-md) 0;
  border-bottom: 1px solid var(--border-light);
}
.cfg-perfil:last-child { border-bottom: none; padding-bottom: 0; }
.cfg-perfil-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-sm);
}
.cfg-perfil-nombre { font-weight: var(--font-weight-semibold); }
.cfg-perfil-badge {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  background: var(--bg-light);
  border: 1px solid var(--border-light);
  border-radius: 9999px;
  padding: 2px 8px;
}
.cfg-perfil-campos { display: flex; flex-direction: column; gap: var(--space-sm); }
.cfg-input-group { display: flex; flex-direction: column; gap: 4px; }
.cfg-label { font-size: var(--font-size-sm); color: var(--text-secondary); }
.cfg-input {
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--bg-light);
  color: inherit;
  font-size: var(--font-size-base);
  width: 100%;
  box-sizing: border-box;
}
.cfg-input:focus { outline: none; border-color: var(--color-primary); }
.cfg-perfil-readonly { color: var(--text-secondary); font-size: var(--font-size-sm); }
.cfg-perfil-acciones { display: flex; justify-content: flex-end; margin-top: var(--space-sm); }

/* Categorías */
.cfg-btn-add {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px var(--space-sm);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-md);
  background: none;
  color: var(--color-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background 0.15s;
}
.cfg-btn-add:hover { background: color-mix(in srgb, var(--color-primary) 10%, transparent); }

.cfg-cat-form {
  background: var(--bg-light);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  margin-bottom: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.cfg-select {
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--bg-light);
  color: inherit;
  font-size: var(--font-size-base);
  width: 100%;
  box-sizing: border-box;
}
.cfg-cat-form-actions { display: flex; justify-content: flex-end; gap: var(--space-sm); }

.cfg-cat-grupo { margin-bottom: var(--space-md); }
.cfg-cat-tipo-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-secondary);
  margin: 0 0 var(--space-sm);
}
.cfg-cat-lista { list-style: none; padding: 0; margin: 0; }
.cfg-cat-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) 0;
  border-bottom: 1px solid var(--border-light);
}
.cfg-cat-item:last-child { border-bottom: none; }
.cfg-cat-nombre-wrap { flex: 1; min-width: 0; }
.cfg-cat-nombre-text {
  font-weight: var(--font-weight-medium);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cfg-cat-nombre-input {
  width: 100%;
  padding: 2px var(--space-sm);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--bg-light);
  color: inherit;
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  box-sizing: border-box;
}
.cfg-cat-limite-wrap { text-align: right; white-space: nowrap; }
.cfg-cat-limite-text {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  transition: background 0.1s;
}
.cfg-cat-limite-text:hover { background: var(--bg-light); }
.cfg-cat-limite-input {
  width: 90px;
  padding: 2px 4px;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--bg-light);
  color: inherit;
  font-size: var(--font-size-sm);
  text-align: right;
}
.cfg-cat-acciones { display: flex; gap: 2px; flex-shrink: 0; }
.cfg-icon-btn {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border: none; background: none; cursor: pointer;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: background 0.15s, color 0.15s;
  font-size: 0.85rem;
}
.cfg-icon-btn:hover { background: var(--bg-light); color: inherit; }
.cfg-icon-btn--danger:hover { color: var(--color-danger); background: color-mix(in srgb, var(--color-danger) 10%, transparent); }

/* Preferencias */
.cfg-pref-lista { display: flex; flex-direction: column; }
.cfg-pref-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md) 0;
  border-bottom: 1px solid var(--border-light);
}
.cfg-pref-row:last-child { border-bottom: none; }
.cfg-pref-row--readonly { opacity: 0.7; }
.cfg-pref-nombre { font-weight: var(--font-weight-medium); }
.cfg-pref-valor { font-size: var(--font-size-sm); color: var(--text-secondary); }

/* Toggle switch */
.cfg-toggle {
  position: relative;
  width: 44px; height: 24px;
  border-radius: 12px;
  border: none;
  background: var(--border-light);
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
}
.cfg-toggle[aria-checked="true"] { background: var(--color-primary); }
.cfg-toggle-thumb {
  position: absolute;
  top: 3px; left: 3px;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: white;
  transition: transform 0.2s;
}
.cfg-toggle[aria-checked="true"] .cfg-toggle-thumb { transform: translateX(20px); }

/* Datos */
.cfg-card--datos { border-color: transparent; }
.cfg-datos-acciones { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-bottom: var(--space-md); }
.cfg-datos-separador { border-top: 1px solid var(--border-light); margin: var(--space-md) 0; }
.cfg-zona-peligro {
  margin-top: var(--space-lg);
  padding: var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid color-mix(in srgb, var(--color-danger) 30%, transparent);
  background: color-mix(in srgb, var(--color-danger) 5%, var(--bg-light-secondary));
}
.cfg-peligro-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-danger);
  margin: 0 0 var(--space-sm);
}

/* Modal */
.cfg-modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  padding: var(--space-md);
  z-index: 200;
}
.cfg-modal-overlay[hidden] { display: none; }
.cfg-modal {
  background: var(--bg-light);
  border-radius: var(--radius-lg);
  padding: var(--space-xl);
  max-width: 420px; width: 100%;
  display: flex; flex-direction: column; gap: var(--space-md);
}
.cfg-modal-title { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); margin: 0; }
.cfg-modal-title--danger { color: var(--color-danger); }
.cfg-modal-body { margin: 0; color: var(--text-secondary); line-height: 1.5; }
.cfg-modal-actions { display: flex; gap: var(--space-sm); justify-content: flex-end; flex-wrap: wrap; }
.cfg-delete-reasign { display: flex; flex-direction: column; gap: var(--space-xs); }

/* Toast */
.cfg-toast {
  position: fixed;
  bottom: calc(var(--space-md) + 68px);
  left: 50%; transform: translateX(-50%);
  background: var(--bg-light-secondary);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
  font-size: var(--font-size-sm);
  box-shadow: var(--shadow-md);
  z-index: 300;
  max-width: 90vw;
}
@media (min-width: 768px) { .cfg-toast { bottom: var(--space-lg); } }
```

### JS IIFE (todas las funciones)

```js
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  var _cats = [];          // cache categorías
  var _delCatId = null;    // id de categoría en proceso de eliminar
  var _toastTimer = null;

  /* ── Toast ────────────────────────────────────────────── */
  function mostrarToast(msg, ms) {
    clearTimeout(_toastTimer);
    $('cfgToastMsg').textContent = msg;
    $('cfgToast').style.display = 'flex';
    _toastTimer = setTimeout(function () { $('cfgToast').style.display = 'none'; }, ms || 4000);
  }

  /* ── Render Perfiles ──────────────────────────────────── */
  function renderPerfiles(perfiles) {
    var cont = $('cfgPerfilesCont');
    var uid = window.currentUser ? window.currentUser.id : null;

    cont.innerHTML = perfiles.map(function (p) {
      var esActivo = p.user_id === uid;
      if (esActivo) {
        return '<div class="cfg-perfil" data-uid="' + escHtml(p.user_id) + '">' +
          '<div class="cfg-perfil-header">' +
            '<span class="cfg-perfil-nombre">' + escHtml(p.nombre || 'Tú') + '</span>' +
            '<span class="cfg-perfil-badge">Tu perfil</span>' +
          '</div>' +
          '<div class="cfg-perfil-campos">' +
            '<div class="cfg-input-group">' +
              '<label class="cfg-label" for="cfgPNombre">Nombre</label>' +
              '<input id="cfgPNombre" class="cfg-input" type="text" value="' + escHtml(p.nombre || '') + '" maxlength="50">' +
            '</div>' +
            '<div class="cfg-input-group">' +
              '<label class="cfg-label" for="cfgPAporte">Aporte mensual esperado (S/)</label>' +
              '<input id="cfgPAporte" class="cfg-input" type="number" value="' + escHtml(String(p.aporte_mensual_esperado || '')) + '" min="0" step="0.01">' +
            '</div>' +
          '</div>' +
          '<div class="cfg-perfil-acciones">' +
            '<button type="button" class="btn btn-primary btn-sm" id="cfgPGuardar" style="display:none">Guardar</button>' +
          '</div>' +
        '</div>';
      } else {
        return '<div class="cfg-perfil">' +
          '<div class="cfg-perfil-header">' +
            '<span class="cfg-perfil-nombre">' + escHtml(p.nombre || '—') + '</span>' +
            '<span class="cfg-perfil-badge">otro miembro</span>' +
          '</div>' +
          '<p class="cfg-perfil-readonly">Aporte esperado: ' + escHtml(formatMonto(p.aporte_mensual_esperado || 0)) + '</p>' +
        '</div>';
      }
    }).join('');

    // Eventos del perfil activo
    var nInput = $('cfgPNombre');
    var aInput = $('cfgPAporte');
    var btnG   = $('cfgPGuardar');
    if (!nInput) return;

    var _origN = nInput.value;
    var _origA = aInput.value;

    function checkDirty() {
      var dirty = nInput.value !== _origN || aInput.value !== _origA;
      btnG.style.display = dirty ? 'inline-flex' : 'none';
    }

    nInput.addEventListener('input', checkDirty);
    aInput.addEventListener('input', checkDirty);

    btnG.addEventListener('click', async function () {
      btnG.disabled = true;
      try {
        await updateProfile({
          nombre: nInput.value.trim(),
          aporte_mensual_esperado: parseFloat(aInput.value) || 0,
        });
        _origN = nInput.value;
        _origA = aInput.value;
        btnG.style.display = 'none';
        mostrarToast('Perfil guardado', 3000);
      } catch (err) {
        mostrarToast('No se pudo guardar el perfil', 4000);
      } finally {
        btnG.disabled = false;
      }
    });

    $('cfgPerfilesSection').style.display = 'block';
  }

  /* ── Render Categorías ────────────────────────────────── */
  function renderCatItem(cat) {
    var lim = cat.limite_mensual != null ? formatMonto(cat.limite_mensual) : '—';
    return '<li class="cfg-cat-item" data-id="' + escHtml(cat.id) + '" data-tipo="' + escHtml(cat.tipo) + '">' +
      '<div class="cfg-cat-nombre-wrap">' +
        '<span class="cfg-cat-nombre-text">' + escHtml(cat.nombre) + '</span>' +
      '</div>' +
      '<div class="cfg-cat-limite-wrap">' +
        '<span class="cfg-cat-limite-text" title="Editar límite">' + escHtml(lim) + '</span>' +
      '</div>' +
      '<div class="cfg-cat-acciones">' +
        '<button type="button" class="cfg-icon-btn" data-act="editar-nombre" title="Editar nombre">✏️</button>' +
        '<button type="button" class="cfg-icon-btn" data-act="archivar" title="Archivar">📦</button>' +
        '<button type="button" class="cfg-icon-btn cfg-icon-btn--danger" data-act="eliminar" title="Eliminar">🗑️</button>' +
      '</div>' +
    '</li>';
  }

  function renderCategorias(cats) {
    _cats = cats || [];
    var gastos   = _cats.filter(function (c) { return c.tipo === 'gasto'; });
    var ingresos = _cats.filter(function (c) { return c.tipo === 'ingreso'; });

    $('cfgCatListaGastos').innerHTML  = gastos.map(renderCatItem).join('') || '<li style="color:var(--text-secondary);font-size:var(--font-size-sm);padding:var(--space-sm) 0">Sin categorías de gasto</li>';
    $('cfgCatListaIngresos').innerHTML = ingresos.map(renderCatItem).join('') || '<li style="color:var(--text-secondary);font-size:var(--font-size-sm);padding:var(--space-sm) 0">Sin categorías de ingreso</li>';

    $('cfgCatSection').style.display = 'block';
  }

  /* ── Edición inline límite ────────────────────────────── */
  function activarEditLimite(li) {
    var span = li.querySelector('.cfg-cat-limite-text');
    var id   = li.dataset.id;
    var input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.step = '0.01';
    input.className = 'cfg-cat-limite-input';
    var cat = _cats.find(function (c) { return c.id === id; });
    input.value = cat && cat.limite_mensual != null ? cat.limite_mensual : '';
    span.replaceWith(input);
    input.focus();

    async function guardarLimite() {
      var val = input.value.trim() === '' ? null : parseFloat(input.value);
      try {
        await updateCategoria(id, { limite_mensual: val });
        if (cat) cat.limite_mensual = val;
        var nuevoSpan = document.createElement('span');
        nuevoSpan.className = 'cfg-cat-limite-text';
        nuevoSpan.title = 'Editar límite';
        nuevoSpan.textContent = val != null ? formatMonto(val) : '—';
        input.replaceWith(nuevoSpan);
        nuevoSpan.addEventListener('click', function () { activarEditLimite(li); });
        mostrarToast('Límite actualizado', 3000);
      } catch (err) {
        var revertSpan = document.createElement('span');
        revertSpan.className = 'cfg-cat-limite-text';
        revertSpan.title = 'Editar límite';
        revertSpan.textContent = cat && cat.limite_mensual != null ? formatMonto(cat.limite_mensual) : '—';
        input.replaceWith(revertSpan);
        revertSpan.addEventListener('click', function () { activarEditLimite(li); });
        mostrarToast('No se pudo actualizar el límite', 4000);
      }
    }

    input.addEventListener('blur', guardarLimite);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') {
        var rSpan = document.createElement('span');
        rSpan.className = 'cfg-cat-limite-text';
        rSpan.title = 'Editar límite';
        rSpan.textContent = cat && cat.limite_mensual != null ? formatMonto(cat.limite_mensual) : '—';
        input.replaceWith(rSpan);
        rSpan.addEventListener('click', function () { activarEditLimite(li); });
      }
    });
  }

  /* ── Edición inline nombre ────────────────────────────── */
  function activarEditNombre(li) {
    var span = li.querySelector('.cfg-cat-nombre-text');
    var id   = li.dataset.id;
    var cat  = _cats.find(function (c) { return c.id === id; });
    var input = document.createElement('input');
    input.type = 'text'; input.maxLength = 50;
    input.className = 'cfg-cat-nombre-input';
    input.value = cat ? cat.nombre : '';
    span.replaceWith(input);
    input.focus();

    async function guardarNombre() {
      var val = input.value.trim();
      if (!val) { val = cat ? cat.nombre : ''; }
      try {
        await updateCategoria(id, { nombre: val });
        if (cat) cat.nombre = val;
        var nuevoSpan = document.createElement('span');
        nuevoSpan.className = 'cfg-cat-nombre-text';
        nuevoSpan.textContent = val;
        input.replaceWith(nuevoSpan);
        mostrarToast('Categoría renombrada', 3000);
      } catch (err) {
        var rSpan = document.createElement('span');
        rSpan.className = 'cfg-cat-nombre-text';
        rSpan.textContent = cat ? cat.nombre : '';
        input.replaceWith(rSpan);
        mostrarToast('No se pudo renombrar', 4000);
      }
    }

    input.addEventListener('blur', guardarNombre);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    });
  }

  /* ── Delegación eventos lista categorías ─────────────── */
  function delegarCats(listaId) {
    var ul = $(listaId);
    if (!ul) return;

    // Límite inline (click en span)
    ul.addEventListener('click', function (e) {
      var span = e.target.closest('.cfg-cat-limite-text');
      if (span) { activarEditLimite(span.closest('.cfg-cat-item')); return; }
    });

    // Botones de acción
    ul.addEventListener('click', async function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var li  = btn.closest('.cfg-cat-item');
      var id  = li.dataset.id;
      var act = btn.dataset.act;

      if (act === 'editar-nombre') { activarEditNombre(li); return; }

      if (act === 'archivar') {
        btn.disabled = true;
        try {
          await archivarCategoria(id);
          li.remove();
          _cats = _cats.filter(function (c) { return c.id !== id; });
          mostrarToast('Categoría archivada', 3000);
        } catch (err) {
          btn.disabled = false;
          mostrarToast('No se pudo archivar', 4000);
        }
        return;
      }

      if (act === 'eliminar') {
        _delCatId = id;
        var txs = await getTransacciones({ categoria_id: id });
        var count = (txs || []).length;
        var cat   = _cats.find(function (c) { return c.id === id; });
        var tipo  = cat ? cat.tipo : null;

        $('cfgDeleteInfo').textContent = count > 0
          ? 'Esta categoría tiene ' + count + ' transacción' + (count !== 1 ? 'es' : '') + '.'
          : 'Esta categoría no tiene transacciones.';

        // Poblar dropdown con otras categorías del mismo tipo
        var otrosCats = _cats.filter(function (c) { return c.id !== id && c.tipo === tipo; });
        var reasignRow = $('cfgDeleteReasignRow');
        var sel = $('cfgDeleteTarget');
        if (otrosCats.length > 0) {
          sel.innerHTML = otrosCats.map(function (c) {
            return '<option value="' + escHtml(c.id) + '">' + escHtml(c.nombre) + '</option>';
          }).join('');
          reasignRow.style.display = 'flex';
          $('cfgDeleteConfirm').textContent = 'Reasignar y eliminar';
        } else {
          reasignRow.style.display = 'none';
          $('cfgDeleteConfirm').textContent = count > 0 ? 'No se puede eliminar (sin destino)' : 'Eliminar';
          $('cfgDeleteConfirm').disabled = count > 0;
        }

        $('cfgDeleteModal').removeAttribute('hidden');
        setTimeout(function () { $('cfgDeleteCancelar').focus(); }, 50);
        return;
      }
    });
  }

  /* ── Modal eliminar categoría ─────────────────────────── */
  function cerrarDeleteModal() {
    $('cfgDeleteModal').setAttribute('hidden', '');
    $('cfgDeleteConfirm').disabled = false;
    $('cfgDeleteArchivar').disabled = false;
    _delCatId = null;
  }

  $('cfgDeleteCancelar').addEventListener('click', cerrarDeleteModal);
  $('cfgDeleteModal').addEventListener('click', function (e) {
    if (e.target === e.currentTarget) cerrarDeleteModal();
  });

  $('cfgDeleteArchivar').addEventListener('click', async function () {
    if (!_delCatId) return;
    var btn = $('cfgDeleteArchivar');
    btn.disabled = true;
    try {
      await archivarCategoria(_delCatId);
      var id = _delCatId;
      cerrarDeleteModal();
      // Remove from both lists
      var li = document.querySelector('.cfg-cat-item[data-id="' + id + '"]');
      if (li) li.remove();
      _cats = _cats.filter(function (c) { return c.id !== id; });
      mostrarToast('Categoría archivada', 3000);
    } catch (err) {
      btn.disabled = false;
      mostrarToast('No se pudo archivar', 4000);
    }
  });

  $('cfgDeleteConfirm').addEventListener('click', async function () {
    if (!_delCatId) return;
    var btn = $('cfgDeleteConfirm');
    btn.disabled = true;
    var id = _delCatId;
    try {
      var reasignRow = $('cfgDeleteReasignRow');
      if (reasignRow.style.display !== 'none') {
        var targetId = $('cfgDeleteTarget').value;
        await reasignarCategoria(id, targetId);
      }
      await deleteCategoria(id);
      cerrarDeleteModal();
      var li = document.querySelector('.cfg-cat-item[data-id="' + id + '"]');
      if (li) li.remove();
      _cats = _cats.filter(function (c) { return c.id !== id; });
      mostrarToast('Categoría eliminada', 3000);
    } catch (err) {
      btn.disabled = false;
      mostrarToast('No se pudo eliminar la categoría', 4000);
    }
  });

  /* ── Nueva categoría ──────────────────────────────────── */
  $('cfgCatAddBtn').addEventListener('click', function () {
    var open = $('cfgCatForm').style.display !== 'none';
    $('cfgCatForm').style.display = open ? 'none' : 'flex';
    $('cfgCatAddBtn').setAttribute('aria-expanded', open ? 'false' : 'true');
    if (!open) $('cfgCatNombre').focus();
  });

  $('cfgCatFormCancelar').addEventListener('click', function () {
    $('cfgCatForm').style.display = 'none';
    $('cfgCatAddBtn').setAttribute('aria-expanded', 'false');
    $('cfgCatNombre').value = '';
    $('cfgCatLimite').value = '';
  });

  $('cfgCatFormGuardar').addEventListener('click', async function () {
    var nombre = $('cfgCatNombre').value.trim();
    if (!nombre) { $('cfgCatNombre').focus(); return; }
    var tipo = $('cfgCatTipo').value;
    var lim  = $('cfgCatLimite').value.trim();
    var datos = { nombre: nombre, tipo: tipo };
    if (lim) datos.limite_mensual = parseFloat(lim);

    var btn = $('cfgCatFormGuardar');
    btn.disabled = true;
    try {
      var nueva = await insertCategoria(datos);
      _cats.push(nueva);
      var listaId = tipo === 'gasto' ? 'cfgCatListaGastos' : 'cfgCatListaIngresos';
      var ul = $(listaId);
      // Remove empty state li if present
      var empty = ul.querySelector('li:not(.cfg-cat-item)');
      if (empty) empty.remove();
      ul.insertAdjacentHTML('beforeend', renderCatItem(nueva));
      // Re-attach events to new item
      $('cfgCatNombre').value = '';
      $('cfgCatLimite').value = '';
      $('cfgCatForm').style.display = 'none';
      $('cfgCatAddBtn').setAttribute('aria-expanded', 'false');
      mostrarToast('Categoría creada', 3000);
    } catch (err) {
      mostrarToast('No se pudo crear la categoría', 4000);
    } finally {
      btn.disabled = false;
    }
  });

  /* ── Preferencias: Dark mode ──────────────────────────── */
  function leerTema() {
    var stored = null;
    try { stored = localStorage.getItem('nestra-theme'); } catch (e) {}
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function aplicarTema(tema) {
    document.documentElement.classList.remove('dark', 'light');
    document.documentElement.classList.add(tema);
    try { localStorage.setItem('nestra-theme', tema); } catch (e) {}
    var toggle = $('cfgDarkToggle');
    toggle.setAttribute('aria-checked', tema === 'dark' ? 'true' : 'false');
    toggle.setAttribute('aria-label', tema === 'dark' ? 'Desactivar modo oscuro' : 'Activar modo oscuro');
  }

  $('cfgDarkToggle').addEventListener('click', function () {
    var actual = leerTema();
    aplicarTema(actual === 'dark' ? 'light' : 'dark');
  });

  function initPreferencias() {
    aplicarTema(leerTema());
    $('cfgPrefSection').style.display = 'block';
  }

  /* ── Sección Datos: Export JSON ───────────────────────── */
  $('cfgBtnExportJson').addEventListener('click', async function () {
    var btn = $('cfgBtnExportJson');
    btn.disabled = true;
    mostrarToast('Preparando respaldo…', 3000);
    try {
      var res = await Promise.all([
        getTransacciones({}),
        getCategorias(),
        getMetas(),
        getProfiles(),
      ]);
      var datos = {
        version: 1,
        fecha: new Date().toISOString(),
        transacciones: res[0],
        categorias:    res[1],
        metas:         res[2],
        perfiles:      res[3],
      };
      var resultado = exportador.exportJSON(datos);
      if (resultado.ok) {
        mostrarToast('Respaldo descargado', 4000);
      } else {
        mostrarToast('Error al exportar: ' + (resultado.reason || 'desconocido'), 5000);
      }
    } catch (err) {
      mostrarToast('No se pudo exportar el respaldo', 5000);
    } finally {
      btn.disabled = false;
    }
  });

  /* ── Import JSON ──────────────────────────────────────── */
  $('cfgBtnImportJson').addEventListener('click', function () {
    $('cfgImportInput').value = '';
    $('cfgImportInput').click();
  });

  $('cfgImportInput').addEventListener('change', async function () {
    var file = this.files[0];
    if (!file) return;
    var btn = $('cfgBtnImportJson');
    btn.disabled = true;
    mostrarToast('Leyendo archivo…', 3000);
    try {
      var texto = await file.text();
      var datos = JSON.parse(texto);
      var txs = datos.transacciones;
      if (!Array.isArray(txs)) throw new Error('sin-transacciones');
      if (!txs.length) { mostrarToast('El archivo no tiene transacciones', 4000); return; }
      var ok = 0; var fail = 0;
      for (var i = 0; i < txs.length; i++) {
        try {
          await insertTransaccion({
            tipo: txs[i].tipo,
            ambito: txs[i].ambito,
            categoria_id: txs[i].categoria_id,
            monto: txs[i].monto,
            fecha: txs[i].fecha,
            nota: txs[i].nota,
          });
          ok++;
        } catch (e) { fail++; }
      }
      mostrarToast('Importadas ' + ok + ' transacciones' + (fail ? ' (' + fail + ' errores)' : ''), 5000);
    } catch (err) {
      if (err.message === 'sin-transacciones') {
        mostrarToast('Archivo inválido: sin campo transacciones', 5000);
      } else {
        mostrarToast('Archivo inválido o error al leer', 5000);
      }
    } finally {
      btn.disabled = false;
    }
  });

  /* ── Logout ───────────────────────────────────────────── */
  $('cfgBtnLogout').addEventListener('click', function () {
    logout();
  });

  /* ── Reset modal ──────────────────────────────────────── */
  $('cfgResetInput').addEventListener('input', function () {
    $('cfgResetConfirm').disabled = this.value !== 'CONFIRMAR';
  });

  $('cfgBtnReset').addEventListener('click', function () {
    $('cfgResetInput').value = '';
    $('cfgResetConfirm').disabled = true;
    $('cfgResetModal').removeAttribute('hidden');
    setTimeout(function () { $('cfgResetInput').focus(); }, 50);
  });

  $('cfgResetCancelar').addEventListener('click', function () {
    $('cfgResetModal').setAttribute('hidden', '');
  });

  $('cfgResetModal').addEventListener('click', function (e) {
    if (e.target === e.currentTarget) $('cfgResetModal').setAttribute('hidden', '');
  });

  $('cfgResetConfirm').addEventListener('click', async function () {
    var btn = $('cfgResetConfirm');
    btn.disabled = true;
    $('cfgResetCancelar').disabled = true;
    try {
      await resetearDatosUsuario();
      mostrarToast('Datos eliminados. Cerrando sesión…', 3000);
      setTimeout(function () { logout(); }, 3000);
    } catch (err) {
      btn.disabled = false;
      $('cfgResetCancelar').disabled = false;
      mostrarToast('No se pudo resetear los datos', 5000);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!$('cfgDeleteModal').hasAttribute('hidden')) cerrarDeleteModal();
      if (!$('cfgResetModal').hasAttribute('hidden')) $('cfgResetModal').setAttribute('hidden', '');
    }
  });

  /* ── Init ─────────────────────────────────────────────── */
  async function cargar() {
    $('cfgLoading').style.display = 'flex';
    try {
      var res = await Promise.all([getProfiles(), getCategorias()]);
      renderPerfiles(res[0]);
      renderCategorias(res[1]);
      delegarCats('cfgCatListaGastos');
      delegarCats('cfgCatListaIngresos');
      initPreferencias();
      $('cfgDatosSection').style.display = 'block';
    } catch (err) {
      console.error('cfg cargar:', err);
      mostrarToast('No se pudieron cargar los datos', 5000);
    } finally {
      $('cfgLoading').style.display = 'none';
    }
  }

  cargar();

})();
```

Commit: `feat: views/configuracion.html — perfiles, categorías, preferencias, datos`
