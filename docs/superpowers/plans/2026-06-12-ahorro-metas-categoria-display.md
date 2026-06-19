# Ahorro — Metas Categoría Display (Fase 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display categoria_id (icono + nombre) in metas card for context about what the savings are for.

**Architecture:** Read categoria_id from meta object (already saved in DB from Fase 3), fetch category name/icono via helper, render below meta nombre in card. Display-only, no interaction. Single line under título.

**Tech Stack:** Vanilla JS, Supabase query (via getCategorias), iconoCategoria() helper.

---

## Contexto de codebase

- `metas.meta-card`: displays nombre, progress bar, estado, acciones.
- `metas.meta-nombre`: title of meta.
- `categorias`: each has `id, nombre, icono`.
- Meta object from `getMetas()` now includes `categoria_id` (desde Fase 3).
- `iconoCategoria(nombre)` helper in `js/iconos.js` renders SVG icon.
- `getCategorias(tipo)` in `js/db.js` fetches categories.

## Archivos

- Modificar: `views/metas.html` (render logic + CSS)
- Modificar: `css/components.css` (styling for categoria line)

---

### Task 1: HTML — Render categoría info in meta card

**Files:**
- Modify: `views/metas.html`

- [ ] **Step 1: Localizar renderMeta o renderMetas**

En `views/metas.html`, buscar la función que renderiza una meta card (probablemente `renderMeta(m)` o inline en `renderMetas()`). Buscar el bloque que contiene `.meta-nombre`.

- [ ] **Step 2: Añadir línea de categoría debajo del nombre**

Después del `.meta-nombre` div, añadir:
```html
<div class="meta-categoria">
  <span id="meta-cat-${esc(m.id)}" class="meta-cat-content">
    <!-- icono + nombre se renderizará vía JS -->
  </span>
</div>
```

En el HTML, usar un span con un ID único para poder actualizar vía JS.

- [ ] **Step 3: Lógica JS para renderizar categoría**

Después de renderizar la card HTML, añadir lógica para cargar + renderizar categoría:
```javascript
if (m.categoria_id) {
  try {
    var cats = await getCategorias('gasto');
    var cat = cats.find(c => c.id === m.categoria_id);
    if (cat) {
      var catEl = document.getElementById('meta-cat-' + m.id);
      if (catEl) {
        var icono = (typeof iconoCategoria === 'function') ? iconoCategoria(cat.icono, {clase: 'meta-cat-icono'}) : '';
        catEl.innerHTML = icono + ' <span class="meta-cat-nombre">' + esc(cat.nombre) + '</span>';
      }
    }
  } catch (err) {
    console.error('Error cargando categoría para meta:', err);
  }
}
```

Esto debería ejecutarse durante `renderMetas()` o en un loop `forEach(metas)`.

- [ ] **Step 4: Verificar en preview**

Abrir metas. Cada meta debe mostrar su categoría debajo del nombre (ej. "🐷 Ahorro" o "🍔 Alimentación").

- [ ] **Step 5: Commit**

```bash
git add views/metas.html
git commit -m "feat(metas): display categoria icono + nombre in card"
```

---

### Task 2: CSS — Style categoría line in meta card

**Files:**
- Modify: `css/components.css`

- [ ] **Step 1: Añadir .meta-categoria styling**

En `components.css`, localizar sección `.meta-` styling. Añadir:
```css
.meta-categoria {
  margin-top: var(--space-xs);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}
```

- [ ] **Step 2: Añadir .meta-cat-icono + .meta-cat-nombre**

```css
.meta-cat-icono {
  width: 14px;
  height: 14px;
  vertical-align: -2px;
  margin-right: var(--space-xs);
}
.meta-cat-nombre {
  font-weight: var(--font-weight-medium);
}
```

- [ ] **Step 3: Verificar estilos en preview**

La línea debe ser pequeña, gris, con icono y nombre legibles.

- [ ] **Step 4: Commit**

```bash
git add css/components.css
git commit -m "feat(css): style meta categoria display"
```

---

## Self-Review

**Spec coverage:**
- ✅ Display categoría_id (icono + nombre) — Task 1
- ✅ Display-only, no interaction — Task 1 (read-only HTML)
- ✅ CSS styling — Task 2

**Gaps:** Ninguno.

**Placeholders:** Ninguno.

**Consistency:** `getCategorias('gasto')` ya usada en otros sitios, `iconoCategoria()` helper ya existente.
