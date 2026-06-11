# Rediseño de categorías — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar la gestión de categorías en Nestra v1 con estrella favorita + engranaje (modal centrado de acciones), categorías archivadas ordenadas al fondo de su grupo, y un selector de íconos Tabler (sprite local) con búsqueda; los íconos se muestran en configuración, historial y dashboard.

**Architecture:** Sprite SVG Tabler local en `assets/` + índice de tags slim. Helper global `js/iconos.js` para renderizar y buscar íconos. La vista `views/configuracion.html` gana modales centrados (acciones, edición unificada, icon picker) reemplazando la edición inline. `js/db.js` suma soporte de archivadas e ícono.

**Tech Stack:** Vanilla JS (IIFE, `var`), Supabase, sprite SVG `<use>`, sin frameworks. Verificación vía preview del navegador (el repo no tiene suite de tests; este es el patrón establecido).

**Spec:** `docs/superpowers/specs/2026-06-11-categorias-rediseno-design.md`

**Convenciones del repo (respetar en todo):** IIFE por vista, `var`, `escHtml()`/`esc()` en todo contenido de usuario antes de `innerHTML`, CSS custom properties (`--color-primary`, `--bg-light`, `--border-light`, `--radius-*`, `--space-*`), modales con patrón `[hidden]` + z-index 200. Trabajo en `master` (v1). Deploy: `git push origin master && git push origin master:main`.

**Fuentes Tabler verificadas:**
- Sprite: `https://unpkg.com/@tabler/icons-sprite@3.44.0/dist/tabler-sprite.svg` (~2.1 MB, símbolos con id `tabler-NAME`, ej. `tabler-car`).
- Índice: `https://unpkg.com/@tabler/icons@3.44.0/icons.json` (~1.94 MB; objeto `{ "nombre": { name, category, tags:[...] } }`).

---

## Task 1: Assets Tabler + migración de columna `icono`

**Files:**
- Create: `assets/tabler-sprite.svg`
- Create: `assets/tabler-tags.json`
- Create: `supabase/migrations/20260611_categoria_icono.sql`

- [ ] **Step 1: Descargar el sprite a assets/**

Run:
```bash
curl -sL "https://unpkg.com/@tabler/icons-sprite@3.44.0/dist/tabler-sprite.svg" -o assets/tabler-sprite.svg
```
Verificar tamaño (~2.1MB) y que empieza con `<svg ... id="tabler-icons">`:
```bash
wc -c assets/tabler-sprite.svg && head -c 80 assets/tabler-sprite.svg
```
Expected: ~2157285 bytes; comienza con `<svg xmlns="http://www.w3.org/2000/svg" id="tabler-icons">`.

- [ ] **Step 2: Construir el índice slim de tags**

Descargar `icons.json` y transformarlo a `{ "nombre": ["tag1","tag2",...] }` (solo nombre→tags, para aligerar). Run:
```bash
curl -sL "https://unpkg.com/@tabler/icons@3.44.0/icons.json" -o /tmp/tabler-icons-full.json
node -e "const d=require('/tmp/tabler-icons-full.json');const out={};for(const k in d){out[k]=(d[k].tags||[]).map(String);}require('fs').writeFileSync('assets/tabler-tags.json',JSON.stringify(out));console.log('iconos:',Object.keys(out).length);"
```
Expected: imprime `iconos: <N>` con N varios miles. Si `node` no está disponible, usar el helper inline con `python`:
```bash
python -c "import json,sys; d=json.load(open('/tmp/tabler-icons-full.json')); out={k:[str(t) for t in (v.get('tags') or [])] for k,v in d.items()}; json.dump(out, open('assets/tabler-tags.json','w')); print('iconos:', len(out))"
```

- [ ] **Step 3: Verificar el índice**

Run:
```bash
node -e "const t=require('./assets/tabler-tags.json'); console.log('car tags:', t['car']); console.log('home tags:', t['home']);"
```
Expected: imprime arrays de tags para `car` y `home` (ej. `car tags: [ 'vehicle', 'transport', ... ]`).

- [ ] **Step 4: Crear la migración**

Create `supabase/migrations/20260611_categoria_icono.sql`:
```sql
-- Añade columna `icono` a categorias: nombre del ícono Tabler (ej. "car").
-- Nullable; null → ícono por defecto en la UI. Aditivo, no rompe v1.
alter table public.categorias add column if not exists icono text;
```

- [ ] **Step 5: Aplicar la migración (Supabase MCP)**

Aplicar vía la herramienta MCP `apply_migration` con nombre `categoria_icono` y el SQL del Step 4. NO ejecutar otros cambios de schema.
Verificar con `execute_sql`:
```sql
select column_name from information_schema.columns where table_name='categorias' and column_name='icono';
```
Expected: devuelve una fila con `icono`.

- [ ] **Step 6: Commit**

```bash
git add assets/tabler-sprite.svg assets/tabler-tags.json supabase/migrations/20260611_categoria_icono.sql
git commit -m "feat(categorias): add Tabler icon sprite assets + icono column migration"
```

---

## Task 2: `js/iconos.js` — helper de íconos + búsqueda

**Files:**
- Create: `js/iconos.js`
- Modify: `index.html` (añadir `<script src="js/iconos.js">` tras `js/format.js`)

- [ ] **Step 1: Crear js/iconos.js**

Create `js/iconos.js`:
```javascript
// ═══════════════════════════════════════════════════════════════════
// ICONOS — helper global para íconos de categoría (sprite Tabler local)
// ═══════════════════════════════════════════════════════════════════
// Expone: iconoCategoria(nombre, opts), buscarIconos(query), iconosListos()
(function () {
  'use strict';

  var SPRITE_URL = 'assets/tabler-sprite.svg';
  var TAGS_URL   = 'assets/tabler-tags.json';
  var ICONO_DEFAULT = 'tag'; // ícono Tabler usado cuando la categoría no tiene uno

  var _tags = null;       // { nombre: [tags] }
  var _nombres = [];      // [nombre, ...]
  var _listoPromise = null;

  // Inyecta el sprite oculto una vez para que <use href="#tabler-x"> resuelva
  // incluso si el navegador no soporta <use href="archivo.svg#id"> externo.
  function inyectarSprite() {
    if (document.getElementById('tabler-sprite-host')) return Promise.resolve();
    return fetch(SPRITE_URL)
      .then(function (r) { return r.text(); })
      .then(function (svg) {
        var div = document.createElement('div');
        div.id = 'tabler-sprite-host';
        div.setAttribute('aria-hidden', 'true');
        div.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
        div.innerHTML = svg;
        document.body.appendChild(div);
      });
  }

  function cargarTags() {
    return fetch(TAGS_URL)
      .then(function (r) { return r.json(); })
      .then(function (data) { _tags = data; _nombres = Object.keys(data); });
  }

  function asegurarCargado() {
    if (!_listoPromise) {
      _listoPromise = Promise.all([inyectarSprite(), cargarTags()])
        .catch(function (e) { console.error('iconos: carga falló', e); });
    }
    return _listoPromise;
  }

  // iconoCategoria(nombre) → string HTML de un <svg><use></svg>.
  // nombre: nombre Tabler sin prefijo (ej. "car"). null/'' → ICONO_DEFAULT.
  function iconoCategoria(nombre, opts) {
    opts = opts || {};
    var icono = (nombre && String(nombre).trim()) ? String(nombre).trim() : ICONO_DEFAULT;
    var cls = 'cat-icono' + (opts.clase ? ' ' + opts.clase : '');
    return '<svg class="' + cls + '" aria-hidden="true"><use href="' +
      SPRITE_URL + '#tabler-' + icono + '"></use></svg>';
  }

  // buscarIconos(query) → [nombre, ...] (máx 120). Query vacía → primeros 120.
  function buscarIconos(query) {
    if (!_tags) return [];
    var q = String(query || '').trim().toLowerCase();
    if (!q) return _nombres.slice(0, 120);
    var res = [];
    for (var i = 0; i < _nombres.length && res.length < 120; i++) {
      var n = _nombres[i];
      if (n.indexOf(q) !== -1) { res.push(n); continue; }
      var tags = _tags[n];
      if (tags) {
        for (var j = 0; j < tags.length; j++) {
          if (tags[j].toLowerCase().indexOf(q) !== -1) { res.push(n); break; }
        }
      }
    }
    return res;
  }

  function iconosListos() { return asegurarCargado(); }

  // Precargar al cargar el script (no bloquea).
  asegurarCargado();

  window.iconoCategoria = iconoCategoria;
  window.buscarIconos   = buscarIconos;
  window.iconosListos   = iconosListos;
})();
```

- [ ] **Step 2: Cargar el script en index.html**

En `index.html`, tras la línea `<script src="js/format.js"></script>` (línea ~113), añadir:
```html
    <script src="js/iconos.js"></script>
```

- [ ] **Step 3: Añadir CSS base del ícono**

En `css/components.css`, al final, añadir:
```css
/* Ícono de categoría (sprite Tabler) */
.cat-icono {
  width: 1.1em;
  height: 1.1em;
  stroke: currentColor;
  fill: none;
  vertical-align: -0.15em;
  flex-shrink: 0;
}
```

- [ ] **Step 4: Verificar en preview**

Iniciar preview (`preview_start` con `Nestra`), navegar a `#dashboard`, y en consola del preview evaluar:
```js
(async () => { await window.iconosListos(); return { car: window.buscarIconos('car').slice(0,5), html: window.iconoCategoria('car') }; })()
```
Expected: `car` devuelve nombres que incluyen `car`; `html` contiene `<use href="assets/tabler-sprite.svg#tabler-car">`.

- [ ] **Step 5: Commit**

```bash
git add js/iconos.js index.html css/components.css
git commit -m "feat(iconos): add global Tabler icon helper (iconoCategoria, buscarIconos)"
```

---

## Task 3: `js/db.js` — soporte archivadas, desarchivar, ícono en transacciones

**Files:**
- Modify: `js/db.js` (getCategorias, getCategoriasConFavorito, desarchivarCategoria nueva, getTransacciones select)

- [ ] **Step 1: getCategorias acepta incluirArchivadas**

En `js/db.js`, reemplazar la función `getCategorias` (línea ~370) por:
```javascript
async function getCategorias(tipo = null, incluirArchivadas = false) {
  try {
    let query = supabase
      .from('categorias')
      .select('*')
      .order('nombre', { ascending: true });
    if (!incluirArchivadas) query = query.eq('estado', 'activa');
    if (tipo) query = query.eq('tipo', tipo);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error en getCategorias():', err.message || err);
    return [];
  }
}
```

- [ ] **Step 2: getCategoriasConFavorito propaga el parámetro**

Reemplazar `getCategoriasConFavorito` (línea ~391) por:
```javascript
async function getCategoriasConFavorito(tipo = null, incluirArchivadas = false) {
  try {
    const cats = await getCategorias(tipo, incluirArchivadas);
    const { data: favs, error } = await supabase
      .from('categorias_favoritas')
      .select('categoria_id'); // RLS lo acota al usuario activo
    if (error) throw error;
    const favSet = new Set((favs || []).map((f) => f.categoria_id));
    return cats.map((c) => ({ ...c, favorita: favSet.has(c.id) }));
  } catch (err) {
    console.error('Error en getCategoriasConFavorito():', err.message || err);
    return [];
  }
}
```

- [ ] **Step 3: Añadir desarchivarCategoria**

Tras la función `archivarCategoria` (busca `estado: 'archivada'`, línea ~513), añadir:
```javascript
// desarchivarCategoria(id) — reactiva una categoría archivada (estado='activa').
// Returns: fila actualizada. Lanza Error en fallo.
async function desarchivarCategoria(id) {
  try {
    const { data, error } = await supabase
      .from('categorias')
      .update({ estado: 'activa' })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en desarchivarCategoria():', err.message || err);
    throw err;
  }
}
```

- [ ] **Step 4: getTransacciones incluye icono en el embed**

En `getTransacciones` (línea ~68) y en la función de recientes (línea ~93), cambiar el select embebido de:
```javascript
.select('*, categorias(nombre, tipo, color)')
```
a:
```javascript
.select('*, categorias(nombre, tipo, color, icono)')
```
(aplicar en AMBAS ocurrencias).

- [ ] **Step 5: Verificar en preview**

En consola del preview (autenticado):
```js
(async () => { const c = await getCategoriasConFavorito(null, true); return c.map(x => ({n:x.nombre, estado:x.estado, fav:x.favorita, icono:x.icono})); })()
```
Expected: array que incluye categorías con `estado:'archivada'` además de activas; cada una con `fav` bool e `icono` (null o string).

- [ ] **Step 6: Commit**

```bash
git add js/db.js
git commit -m "feat(db): categorias support archived + desarchivar + icono in tx embed"
```

---

## Task 4: configuracion.html — item con ícono + estrella + engranaje, archivadas al fondo

**Files:**
- Modify: `views/configuracion.html` (renderCatItem, renderCategorias, carga, CSS, delegación estrella/engranaje)

- [ ] **Step 1: Cargar categorías con archivadas + favoritas**

En `views/configuracion.html`, función `cargar()` (línea ~945), cambiar:
```javascript
var res = await Promise.all([getProfiles(), getCategorias()]);
```
por:
```javascript
var res = await Promise.all([getProfiles(), getCategoriasConFavorito(null, true)]);
```

- [ ] **Step 2: Reescribir renderCatItem (ícono + nombre + límite + estrella + engranaje)**

Reemplazar `renderCatItem` (línea ~519) por:
```javascript
function renderCatItem(cat) {
  var lim = cat.limite_mensual != null ? formatMonto(cat.limite_mensual) : '—';
  var esArch = cat.estado === 'archivada';
  var icono = (typeof iconoCategoria === 'function') ? iconoCategoria(cat.icono) : '';
  var starCls = cat.favorita ? 'cfg-cat-star cfg-cat-star--on' : 'cfg-cat-star';
  var starLabel = cat.favorita ? 'Quitar de favoritas' : 'Marcar como favorita';
  var badge = esArch ? '<span class="cfg-cat-badge-arch">archivada</span>' : '';
  return '<li class="cfg-cat-item' + (esArch ? ' cfg-cat-item--archivada' : '') +
      '" data-id="' + escHtml(cat.id) + '" data-tipo="' + escHtml(cat.tipo) + '">' +
    '<span class="cfg-cat-icono-wrap">' + icono + '</span>' +
    '<div class="cfg-cat-nombre-wrap">' +
      '<span class="cfg-cat-nombre-text">' + escHtml(cat.nombre) + '</span>' + badge +
    '</div>' +
    '<div class="cfg-cat-limite-wrap">' +
      '<span class="cfg-cat-limite-static">' + escHtml(lim) + '</span>' +
    '</div>' +
    '<div class="cfg-cat-acciones">' +
      '<button type="button" class="' + starCls + '" data-act="favorita" ' +
        'aria-pressed="' + (cat.favorita ? 'true' : 'false') + '" ' +
        'title="' + starLabel + '" aria-label="' + starLabel + ' ' + escHtml(cat.nombre) + '">★</button>' +
      '<button type="button" class="cfg-cat-gear" data-act="opciones" ' +
        'title="Opciones" aria-label="Opciones de ' + escHtml(cat.nombre) + '">⚙️</button>' +
    '</div>' +
  '</li>';
}
```

- [ ] **Step 3: Reescribir renderCategorias (orden: activas, luego archivadas)**

Reemplazar `renderCategorias` (línea ~536) por:
```javascript
function renderCategorias(cats) {
  _cats = cats || [];
  function porGrupo(tipo) {
    var grupo = _cats.filter(function (c) { return c.tipo === tipo; });
    var activas = grupo.filter(function (c) { return c.estado !== 'archivada'; });
    var arch    = grupo.filter(function (c) { return c.estado === 'archivada'; });
    // getCategorias ya ordena por nombre; activas primero, luego archivadas.
    return activas.concat(arch);
  }
  var gastos   = porGrupo('gasto');
  var ingresos = porGrupo('ingreso');
  var vacia = '<li style="color:var(--text-secondary);font-size:var(--font-size-sm);padding:var(--space-sm) 0">';
  $('cfgCatListaGastos').innerHTML   = gastos.length   ? gastos.map(renderCatItem).join('')   : vacia + 'Sin categorías de gasto</li>';
  $('cfgCatListaIngresos').innerHTML = ingresos.length ? ingresos.map(renderCatItem).join('') : vacia + 'Sin categorías de ingreso</li>';
  $('cfgCatSection').style.display = 'block';
}
```

- [ ] **Step 4: Reescribir la delegación de la lista (estrella + engranaje)**

Reemplazar la función `delegarCats` (línea ~647) entera por:
```javascript
function delegarCats(ulId) {
  var ul = $(ulId);
  if (!ul) return;
  ul.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var li  = btn.closest('.cfg-cat-item');
    var id  = li.dataset.id;
    var act = btn.dataset.act;
    if (act === 'favorita') { toggleFavoritaUI(li, btn, id); return; }
    if (act === 'opciones') { abrirAcciones(id); return; }
  });
}
```

- [ ] **Step 5: Añadir toggleFavoritaUI (optimista)**

Antes de `delegarCats`, añadir:
```javascript
async function toggleFavoritaUI(li, btn, id) {
  var cat = _cats.find(function (c) { return c.id === id; });
  if (!cat) return;
  var nuevo = !cat.favorita;
  // Flip optimista
  cat.favorita = nuevo;
  btn.classList.toggle('cfg-cat-star--on', nuevo);
  btn.setAttribute('aria-pressed', nuevo ? 'true' : 'false');
  try {
    await toggleFavorita(id, nuevo);
  } catch (err) {
    // Revertir
    cat.favorita = !nuevo;
    btn.classList.toggle('cfg-cat-star--on', !nuevo);
    btn.setAttribute('aria-pressed', !nuevo ? 'true' : 'false');
    mostrarToast('No se pudo actualizar el favorito', 4000);
  }
}
```

- [ ] **Step 6: Eliminar la edición inline de nombre y límite**

Borrar de `configuracion.html` las funciones `activarEditLimite` (línea ~547) y `activarEditNombre` (línea ~594) completas. (El modal de edición de la Task 6 las reemplaza.) La delegación de la Task 4 Step 4 ya no las referencia.

- [ ] **Step 7: Añadir CSS del item**

En el `<style>` de `configuracion.html`, tras `.cfg-icon-btn--danger:hover {...}` (línea ~321), añadir:
```css
.cfg-cat-icono-wrap {
  width: 32px; height: 32px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--bg-light);
  color: var(--text-secondary);
}
.cfg-cat-icono-wrap .cat-icono { width: 18px; height: 18px; }
.cfg-cat-limite-static { font-size: var(--font-size-sm); color: var(--text-secondary); white-space: nowrap; }
.cfg-cat-item--archivada { opacity: 0.5; }
.cfg-cat-badge-arch {
  display: inline-block; margin-left: var(--space-sm);
  font-size: var(--font-size-xs); color: var(--text-secondary);
  background: var(--bg-light); border: 1px solid var(--border-light);
  border-radius: var(--radius-sm); padding: 0 6px;
}
.cfg-cat-star, .cfg-cat-gear {
  width: 32px; height: 32px; border: none; background: none; cursor: pointer;
  border-radius: var(--radius-sm); font-size: 1rem; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-secondary); transition: background 0.15s, color 0.15s;
}
.cfg-cat-star:hover, .cfg-cat-gear:hover { background: var(--bg-light); }
.cfg-cat-star--on { color: #f5b301; }
.cfg-cat-star:focus-visible, .cfg-cat-gear:focus-visible {
  outline: 2px solid var(--color-primary); outline-offset: 1px;
}
```

- [ ] **Step 8: Verificar en preview**

Navegar a `#configuracion`. Verificar: cada categoría muestra ícono (default `tag` si no tiene), estrella y engranaje; las favoritas con estrella dorada; las archivadas atenuadas + badge al fondo de su grupo. Click en estrella togglea (recargar y confirmar persistencia). Tomar screenshot.

- [ ] **Step 9: Commit**

```bash
git add views/configuracion.html
git commit -m "feat(config): category item with icon, favorite star, gear; archived sorted last"
```

---

## Task 5: configuracion.html — modal centrado de acciones

**Files:**
- Modify: `views/configuracion.html` (markup del modal, abrirAcciones, handlers, CSS)

- [ ] **Step 1: Añadir el markup del modal de acciones**

En `configuracion.html`, tras el modal de eliminar (línea ~109, cierre del `cfgDeleteModal`), añadir:
```html
  <!-- Modal: acciones de categoría (centrado) -->
  <div class="cfg-modal-overlay" id="cfgAccModal"
       role="dialog" aria-modal="true" aria-labelledby="cfgAccTitle" hidden>
    <div class="cfg-modal cfg-acc-modal">
      <div class="cfg-acc-head">
        <span class="cfg-acc-icono" id="cfgAccIcono"></span>
        <span class="cfg-acc-nombre" id="cfgAccTitle"></span>
      </div>
      <button type="button" class="cfg-acc-btn" id="cfgAccEditar">
        <span aria-hidden="true">✏️</span> Editar categoría
      </button>
      <button type="button" class="cfg-acc-btn" id="cfgAccArchivar">
        <span aria-hidden="true">📦</span> <span id="cfgAccArchivarTxt">Archivar categoría</span>
      </button>
      <button type="button" class="cfg-acc-btn cfg-acc-btn--danger" id="cfgAccEliminar">
        <span aria-hidden="true">🗑️</span> Eliminar categoría
      </button>
      <button type="button" class="cfg-acc-btn cfg-acc-btn--cancel" id="cfgAccCancelar">Cancelar</button>
    </div>
  </div>
```

- [ ] **Step 2: Añadir abrirAcciones + estado**

En el `<script>`, junto a las otras variables de estado (`var _delCatId = null;`, línea ~431), añadir:
```javascript
    var _accCatId = null;
```
Y añadir la función (cerca de `delegarCats`):
```javascript
function abrirAcciones(id) {
  var cat = _cats.find(function (c) { return c.id === id; });
  if (!cat) return;
  _accCatId = id;
  var esArch = cat.estado === 'archivada';
  $('cfgAccIcono').innerHTML = (typeof iconoCategoria === 'function') ? iconoCategoria(cat.icono) : '';
  $('cfgAccTitle').textContent = cat.nombre;
  $('cfgAccArchivarTxt').textContent = esArch ? 'Desarchivar categoría' : 'Archivar categoría';
  $('cfgAccModal').removeAttribute('hidden');
  setTimeout(function () { $('cfgAccEditar').focus(); }, 50);
}
function cerrarAcciones() {
  $('cfgAccModal').setAttribute('hidden', '');
  _accCatId = null;
}
```

- [ ] **Step 3: Handlers del modal de acciones**

Tras `cerrarAcciones`, añadir:
```javascript
$('cfgAccCancelar').addEventListener('click', cerrarAcciones);
$('cfgAccModal').addEventListener('click', function (e) {
  if (e.target === e.currentTarget) cerrarAcciones();
});

$('cfgAccEditar').addEventListener('click', function () {
  var id = _accCatId;
  cerrarAcciones();
  abrirEdicion(id); // definido en Task 6
});

$('cfgAccArchivar').addEventListener('click', async function () {
  if (!_accCatId) return;
  var id = _accCatId;
  var cat = _cats.find(function (c) { return c.id === id; });
  var esArch = cat && cat.estado === 'archivada';
  var btn = $('cfgAccArchivar');
  btn.disabled = true;
  try {
    if (esArch) { await desarchivarCategoria(id); cat.estado = 'activa'; }
    else        { await archivarCategoria(id);    if (cat) cat.estado = 'archivada'; }
    cerrarAcciones();
    renderCategorias(_cats); // reordena
    mostrarToast(esArch ? 'Categoría desarchivada' : 'Categoría archivada', 3000);
  } catch (err) {
    mostrarToast(esArch ? 'No se pudo desarchivar' : 'No se pudo archivar', 4000);
  } finally {
    btn.disabled = false;
  }
});

$('cfgAccEliminar').addEventListener('click', function () {
  var id = _accCatId;
  cerrarAcciones();
  pedirEliminacion(id); // ver Step 4
});
```

- [ ] **Step 4: Extraer pedirEliminacion desde la lógica existente**

La lógica del modal de eliminación vivía dentro del antiguo `delegarCats` (caso `act === 'eliminar'`). Crear una función reutilizable `pedirEliminacion(id)` con ese cuerpo. Añadir:
```javascript
async function pedirEliminacion(id) {
  var btnDummy = null;
  try {
    _delCatId = id;
    var cat = _cats.find(function (c) { return c.id === id; });
    var tipo = cat ? cat.tipo : null;
    var txs  = await getTransacciones({ categoria_id: id });
    var count = (txs || []).length;

    $('cfgDeleteInfo').textContent = count > 0
      ? 'Esta categoría tiene ' + count + ' transacción' + (count !== 1 ? 'es' : '') + '.'
      : 'Esta categoría no tiene transacciones.';

    var otros = _cats.filter(function (c) { return c.id !== id && c.tipo === tipo && c.estado !== 'archivada'; });
    var rRow  = $('cfgDeleteReasignRow');
    var sel   = $('cfgDeleteTarget');
    var conf  = $('cfgDeleteConfirm');

    if (otros.length > 0) {
      sel.innerHTML = otros.map(function (c) {
        return '<option value="' + escHtml(c.id) + '">' + escHtml(c.nombre) + '</option>';
      }).join('');
      rRow.style.display = 'flex';
      conf.textContent = 'Reasignar y eliminar';
      conf.disabled = false;
    } else {
      rRow.style.display = 'none';
      conf.textContent = count > 0 ? 'No se puede eliminar (sin destino)' : 'Eliminar';
      conf.disabled = count > 0;
    }
    $('cfgDeleteModal').removeAttribute('hidden');
    setTimeout(function () { $('cfgDeleteCancelar').focus(); }, 50);
  } catch (err) {
    mostrarToast('No se pudo verificar la categoría', 4000);
  }
}
```

- [ ] **Step 5: Escape global cierra el modal de acciones**

En el handler de Escape global (línea ~938), añadir al inicio del cuerpo:
```javascript
if (!$('cfgAccModal').hasAttribute('hidden')) { cerrarAcciones(); return; }
```

- [ ] **Step 6: CSS del modal de acciones**

En el `<style>`, tras las reglas `.cfg-modal-*`, añadir:
```css
.cfg-acc-modal { padding: 0; max-width: 320px; gap: 0; }
.cfg-acc-head {
  display: flex; flex-direction: column; align-items: center; gap: var(--space-sm);
  padding: var(--space-lg) var(--space-md) var(--space-md);
  border-bottom: 1px solid var(--border-light);
}
.cfg-acc-icono {
  width: 44px; height: 44px; border-radius: var(--radius-md);
  background: var(--bg-light-secondary);
  display: flex; align-items: center; justify-content: center;
}
.cfg-acc-icono .cat-icono { width: 22px; height: 22px; }
.cfg-acc-nombre { font-weight: var(--font-weight-semibold); font-size: var(--font-size-base); }
.cfg-acc-btn {
  display: flex; align-items: center; gap: var(--space-sm);
  width: 100%; padding: var(--space-md) var(--space-lg);
  border: none; border-bottom: 1px solid var(--border-light);
  background: transparent; color: var(--text-dark);
  font-size: var(--font-size-base); text-align: left; cursor: pointer;
}
.cfg-acc-btn:hover { background: var(--bg-light-secondary); }
.cfg-acc-btn--danger { color: var(--color-danger); }
.cfg-acc-btn--cancel { justify-content: center; color: var(--text-secondary); border-bottom: none; font-weight: var(--font-weight-medium); }
```

- [ ] **Step 7: Verificar en preview**

Navegar a `#configuracion`. Click en engranaje de una categoría → modal centrado con ícono, nombre y 4 botones. Probar Archivar → va al fondo atenuada; reabrir su engranaje → dice "Desarchivar". Probar Cancelar / tap afuera / Escape. Screenshot.

- [ ] **Step 8: Commit**

```bash
git add views/configuracion.html
git commit -m "feat(config): centered action modal (edit/archive/delete) per category"
```

---

## Task 6: configuracion.html — modal de edición unificado + icon picker

**Files:**
- Modify: `views/configuracion.html` (markup de 2 modales, abrirEdicion, icon picker, CSS)

- [ ] **Step 1: Markup del modal de edición + icon picker**

Tras el markup del `cfgAccModal` (Task 5 Step 1), añadir:
```html
  <!-- Modal: editar categoría (unificado) -->
  <div class="cfg-modal-overlay" id="cfgEditModal"
       role="dialog" aria-modal="true" aria-labelledby="cfgEditTitle" hidden>
    <div class="cfg-modal">
      <h2 class="cfg-modal-title" id="cfgEditTitle">Editar categoría</h2>
      <div class="cfg-input-group">
        <label class="cfg-label" for="cfgEditNombre">Nombre</label>
        <input id="cfgEditNombre" class="cfg-input" type="text" maxlength="50">
      </div>
      <div class="cfg-input-group">
        <label class="cfg-label" for="cfgEditLimite">Límite mensual (S/, opcional)</label>
        <input id="cfgEditLimite" class="cfg-input" type="number" min="0" step="0.01">
      </div>
      <div class="cfg-input-group">
        <label class="cfg-label">Ícono</label>
        <button type="button" class="cfg-edit-icono-btn" id="cfgEditIconoBtn">
          <span class="cfg-edit-icono-preview" id="cfgEditIconoPreview"></span>
          <span>Cambiar ícono</span>
        </button>
      </div>
      <div class="cfg-modal-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="cfgEditCancelar">Cancelar</button>
        <button type="button" class="btn btn-primary btn-sm" id="cfgEditGuardar">Guardar</button>
      </div>
    </div>
  </div>

  <!-- Modal: icon picker -->
  <div class="cfg-modal-overlay" id="cfgPickerModal"
       role="dialog" aria-modal="true" aria-labelledby="cfgPickerTitle" hidden>
    <div class="cfg-modal cfg-picker-modal">
      <h2 class="cfg-modal-title" id="cfgPickerTitle">Elegir ícono</h2>
      <input id="cfgPickerSearch" class="cfg-input" type="text"
             placeholder="Buscar ícono… (ej. car, home, food)" autocomplete="off">
      <div class="cfg-picker-grid" id="cfgPickerGrid" role="listbox" aria-label="Íconos"></div>
      <div class="cfg-modal-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="cfgPickerCancelar">Cancelar</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Estado + abrirEdicion/cerrar**

Junto a las variables de estado, añadir:
```javascript
    var _editCatId = null;
    var _editIconoSel = null;
```
Añadir funciones:
```javascript
function abrirEdicion(id) {
  var cat = _cats.find(function (c) { return c.id === id; });
  if (!cat) return;
  _editCatId = id;
  _editIconoSel = cat.icono || null;
  $('cfgEditNombre').value = cat.nombre || '';
  $('cfgEditLimite').value = cat.limite_mensual != null ? cat.limite_mensual : '';
  $('cfgEditIconoPreview').innerHTML = (typeof iconoCategoria === 'function') ? iconoCategoria(_editIconoSel) : '';
  $('cfgEditModal').removeAttribute('hidden');
  setTimeout(function () { $('cfgEditNombre').focus(); }, 50);
}
function cerrarEdicion() {
  $('cfgEditModal').setAttribute('hidden', '');
  _editCatId = null; _editIconoSel = null;
}
```

- [ ] **Step 3: Guardar edición**

```javascript
$('cfgEditCancelar').addEventListener('click', cerrarEdicion);
$('cfgEditModal').addEventListener('click', function (e) {
  if (e.target === e.currentTarget) cerrarEdicion();
});

$('cfgEditGuardar').addEventListener('click', async function () {
  if (!_editCatId) return;
  var nombre = $('cfgEditNombre').value.trim();
  if (!nombre) { mostrarToast('El nombre no puede estar vacío', 3000); $('cfgEditNombre').focus(); return; }
  var limStr = $('cfgEditLimite').value.trim();
  var datos = {
    nombre: nombre,
    limite_mensual: limStr === '' ? null : parseFloat(limStr),
    icono: _editIconoSel,
  };
  var btn = $('cfgEditGuardar');
  btn.disabled = true;
  try {
    await updateCategoria(_editCatId, datos);
    var cat = _cats.find(function (c) { return c.id === _editCatId; });
    if (cat) { cat.nombre = datos.nombre; cat.limite_mensual = datos.limite_mensual; cat.icono = datos.icono; }
    cerrarEdicion();
    renderCategorias(_cats);
    mostrarToast('Categoría actualizada', 3000);
  } catch (err) {
    mostrarToast('No se pudo guardar la categoría', 4000);
  } finally {
    btn.disabled = false;
  }
});
```

- [ ] **Step 4: Icon picker — abrir, buscar, seleccionar**

```javascript
var _pickerTimer = null;

function renderPickerGrid(nombres) {
  var grid = $('cfgPickerGrid');
  if (!nombres.length) { grid.innerHTML = '<p style="color:var(--text-secondary);font-size:var(--font-size-sm);padding:var(--space-md)">Sin resultados</p>'; return; }
  grid.innerHTML = nombres.map(function (n) {
    var sel = (n === _editIconoSel) ? ' cfg-picker-item--sel' : '';
    return '<button type="button" class="cfg-picker-item' + sel + '" data-icono="' + escHtml(n) + '" ' +
      'title="' + escHtml(n) + '" aria-label="' + escHtml(n) + '">' +
      (typeof iconoCategoria === 'function' ? iconoCategoria(n) : '') + '</button>';
  }).join('');
}

async function abrirPicker() {
  $('cfgPickerModal').removeAttribute('hidden');
  $('cfgPickerSearch').value = '';
  $('cfgPickerGrid').innerHTML = '<p style="color:var(--text-secondary);font-size:var(--font-size-sm);padding:var(--space-md)">Cargando íconos…</p>';
  if (typeof iconosListos === 'function') await iconosListos();
  renderPickerGrid(typeof buscarIconos === 'function' ? buscarIconos('') : []);
  setTimeout(function () { $('cfgPickerSearch').focus(); }, 50);
}
function cerrarPicker() { $('cfgPickerModal').setAttribute('hidden', ''); }

$('cfgEditIconoBtn').addEventListener('click', abrirPicker);
$('cfgPickerCancelar').addEventListener('click', cerrarPicker);
$('cfgPickerModal').addEventListener('click', function (e) {
  if (e.target === e.currentTarget) cerrarPicker();
});
$('cfgPickerSearch').addEventListener('input', function () {
  var q = this.value;
  clearTimeout(_pickerTimer);
  _pickerTimer = setTimeout(function () {
    renderPickerGrid(typeof buscarIconos === 'function' ? buscarIconos(q) : []);
  }, 150);
});
$('cfgPickerGrid').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-icono]');
  if (!btn) return;
  _editIconoSel = btn.dataset.icono;
  $('cfgEditIconoPreview').innerHTML = (typeof iconoCategoria === 'function') ? iconoCategoria(_editIconoSel) : '';
  cerrarPicker();
});
```

- [ ] **Step 5: Escape cierra picker y edición**

En el handler de Escape global, añadir (antes del check de acciones):
```javascript
if (!$('cfgPickerModal').hasAttribute('hidden')) { cerrarPicker(); return; }
if (!$('cfgEditModal').hasAttribute('hidden'))   { cerrarEdicion(); return; }
```

- [ ] **Step 6: CSS del modal de edición + picker**

```css
.cfg-edit-icono-btn {
  display: inline-flex; align-items: center; gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-light); border-radius: var(--radius-md);
  background: var(--bg-light); color: inherit; cursor: pointer;
  font-size: var(--font-size-base);
}
.cfg-edit-icono-btn:hover { border-color: var(--color-primary); }
.cfg-edit-icono-preview {
  width: 28px; height: 28px; border-radius: var(--radius-sm);
  background: var(--bg-light-secondary);
  display: flex; align-items: center; justify-content: center;
}
.cfg-edit-icono-preview .cat-icono { width: 18px; height: 18px; }
.cfg-picker-modal { max-width: 380px; }
.cfg-picker-grid {
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px;
  max-height: 280px; overflow-y: auto; padding: 2px;
}
.cfg-picker-item {
  aspect-ratio: 1; border: 1px solid var(--border-light); border-radius: var(--radius-md);
  background: var(--bg-light); cursor: pointer; color: var(--text-dark);
  display: flex; align-items: center; justify-content: center;
}
.cfg-picker-item:hover { border-color: var(--color-primary); }
.cfg-picker-item .cat-icono { width: 20px; height: 20px; }
.cfg-picker-item--sel { border: 2px solid var(--color-primary); background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
```

- [ ] **Step 7: Verificar en preview**

Navegar a `#configuracion` → engranaje → Editar. Modal con nombre/límite/ícono. Click "Cambiar ícono" → picker; buscar "car" filtra; click selecciona y vuelve. Guardar → el ícono aparece en la lista. Recargar y confirmar persistencia. Screenshot móvil + desktop.

- [ ] **Step 8: Commit**

```bash
git add views/configuracion.html
git commit -m "feat(config): unified edit modal + Tabler icon picker with search"
```

---

## Task 7: Íconos en historial, dashboard y transacción

**Files:**
- Modify: `views/historial.html` (cardTx, rowTx)
- Modify: `views/dashboard.html` (renderTransacciones)
- Modify: `views/transaccion.html` (ícono junto al select)

- [ ] **Step 1: Historial — ícono en tarjeta (móvil)**

En `views/historial.html`, en `cardTx` (línea ~668), antes de `'<div class="hist-tx-main">'`, anteponer el ícono al bloque del nombre. Cambiar la construcción del `hist-tx-main` para incluir el ícono delante del nombre:
```javascript
var iconoHtml = (typeof iconoCategoria === 'function') ? iconoCategoria(t.categorias ? t.categorias.icono : null, { clase: 'hist-cat-icono' }) : '';
```
Y en el HTML de la fila, cambiar:
```javascript
'<span class="hist-tx-cat">' + esc(d.cat) + '</span>' +
```
por:
```javascript
'<span class="hist-tx-cat">' + iconoHtml + ' ' + esc(d.cat) + '</span>' +
```

- [ ] **Step 2: Historial — ícono en tabla (desktop)**

En `rowTx` (línea ~693), cambiar:
```javascript
'<td>' + esc(d.cat) + aporteMark + directoMark + '</td>' +
```
por:
```javascript
'<td>' + ((typeof iconoCategoria === 'function') ? iconoCategoria(t.categorias ? t.categorias.icono : null) + ' ' : '') + esc(d.cat) + aporteMark + directoMark + '</td>' +
```

- [ ] **Step 3: Dashboard — ícono en transacciones recientes**

En `views/dashboard.html`, `renderTransacciones` (línea ~442), cambiar:
```javascript
<span class="dash-tx-cat">${esc(cat)}</span>
```
por:
```javascript
<span class="dash-tx-cat">${(typeof iconoCategoria === 'function') ? iconoCategoria(t.categorias ? t.categorias.icono : null) + ' ' : ''}${esc(cat)}</span>
```

- [ ] **Step 4: Transacción — ícono junto al select**

En `views/transaccion.html`, los `<option>` nativos no admiten SVG. Mostrar el ícono de la categoría seleccionada junto al select. En el markup tras el `<select id="categoria">` (línea ~65), añadir un contenedor:
```html
        <span id="categoriaIcono" class="tx-cat-icono" aria-hidden="true"></span>
```
En el JS, en el handler `categoriaEl.addEventListener('change', ...)` (línea ~585), tras resolver la categoría, actualizar el ícono. Añadir al final del handler de change:
```javascript
      (function () {
        var icoEl = document.getElementById('categoriaIcono');
        if (!icoEl) return;
        var opt = categoriaEl.selectedOptions[0];
        var icono = opt ? opt.getAttribute('data-icono') : null;
        icoEl.innerHTML = (categoriaEl.value && typeof iconoCategoria === 'function') ? iconoCategoria(icono) : '';
      })();
```
Y al construir las opciones (línea ~573), incluir `data-icono`:
```javascript
cats.map((c) => `<option value="${c.id}" data-icono="${esc(c.icono || '')}">${esc(c.nombre)}</option>`).join('') +
```

- [ ] **Step 5: CSS mínimos**

En `historial.html` `<style>`, añadir:
```css
.hist-cat-icono { width: 14px; height: 14px; vertical-align: -2px; }
```
En `transaccion.html` `<style>`, añadir:
```css
.tx-cat-icono { display: inline-flex; align-items: center; margin-left: var(--space-xs); }
.tx-cat-icono .cat-icono { width: 18px; height: 18px; color: var(--text-secondary); }
```

- [ ] **Step 6: Verificar en preview**

Asignar un ícono a una categoría (vía config). Luego: en historial la transacción de esa categoría muestra el ícono (móvil y desktop); en dashboard las recientes lo muestran; en transacción, al elegir esa categoría aparece el ícono junto al select. Categorías sin ícono → default `tag`. Screenshot.

- [ ] **Step 7: Commit + deploy**

```bash
git add views/historial.html views/dashboard.html views/transaccion.html
git commit -m "feat(iconos): show category icons in historial, dashboard, transaccion"
git push origin master && git push origin master:main
```

---

## Self-Review

**Spec coverage:**
- Migración `icono` → Task 1. ✓
- `getCategorias` archivadas + `desarchivarCategoria` + select icono → Task 3. ✓
- Sprite + tags + `js/iconos.js` (iconoCategoria, buscarIconos) → Tasks 1-2. ✓
- Item con ícono/estrella/engranaje + archivadas al fondo + estrella optimista → Task 4. ✓
- Modal centrado de acciones (editar/archivar↔desarchivar/eliminar) → Task 5. ✓
- Modal de edición unificado (reemplaza inline) + icon picker con búsqueda → Task 6. ✓
- Íconos en historial/dashboard/transacción → Task 7. ✓
- Eliminación de edición inline → Task 4 Step 6. ✓

**Consistencia de nombres:** `iconoCategoria`, `buscarIconos`, `iconosListos` (js/iconos.js) usados consistentemente. `_accCatId`, `_editCatId`, `_editIconoSel`, `_delCatId` distintos. `abrirAcciones`/`abrirEdicion`/`abrirPicker` + sus `cerrar*`. `pedirEliminacion` extraído y referenciado en Task 5. ✓

**Notas:**
- Limitación conocida: el `<select>` nativo de transacción no renderiza SVG en `<option>`; se muestra el ícono adyacente reflejando la selección (Task 7 Step 4).
- Sin tests automatizados en el repo → verificación por preview (patrón establecido).
- `pedirEliminacion` (Task 5 Step 4) reusa los handlers existentes de `cfgDeleteModal` (confirmar/archivar/cancelar) que permanecen sin cambios.
