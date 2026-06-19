# Ahorro — Form Transacción (Fase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir "Ahorro" como tercer tipo de transacción en `views/transaccion.html`, usando categorías de gasto.

**Architecture:** Un solo archivo modificado (`views/transaccion.html`). Cambios en HTML (botón), CSS (color + layout 3 botones) y JS (lógica _setTipo, cargarCategorias, editTx preload, nueva cat). No se toca `js/db.js` — `getCategorias('gasto')` ya funciona.

**Tech Stack:** Vanilla JS IIFE, CSS custom properties, Supabase (solo lectura de categorías). Sin framework de tests — verificación manual en el preview.

---

## Contexto de codebase

- `views/transaccion.html` es una vista SPA cargada en un `<div>` por el router hash.
- El IIFE en `<script>` no se puede dividir — todos los cambios JS van en el mismo bloque.
- `getCategorias(tipo)` en `js/db.js` acepta `'gasto' | 'ingreso'`. Para ahorro, pasar `'gasto'`.
- `_reDistribuirAhorro` en `js/db.js` busca una **categoría de nombre** "Ahorro" (mecanismo viejo). No interfiere con el nuevo `tipo='ahorro'`.
- La constraint DB ya fue actualizada (Fase 1): `tipo = ANY(ARRAY['gasto','ingreso','ahorro'])`.
- CSS del toggle actual: `.tx-toggle-btn--gasto.tx-active { background: var(--color-danger); }` y `--ingreso` usa `--color-success`. Ahorro usará `#3b82f6` (azul).
- `categorias.tipo` solo acepta `'gasto' | 'ingreso'`. Al crear nueva categoría desde ahorro → usar `tipo: 'gasto'`.

## Archivos

- Modificar: `views/transaccion.html`
  - HTML: líneas ~38–48 (tipo toggle group)
  - CSS: líneas ~266–271 (`.tx-toggle-btn--gasto/ingreso.tx-active`) + `@media` toggle widths
  - JS: líneas ~455–537 (declaraciones, `_setTipo`, event listeners), ~562–586 (`cargarCategorias`), ~633 (nueva cat), ~795–806 (editTx preload), ~6 (subtitle `<p>`)

---

### Task 1: HTML — Añadir botón Ahorro al toggle de tipo

**Files:**
- Modify: `views/transaccion.html` (bloque `<!-- Tipo -->`, ~líneas 37–48)

- [ ] **Step 1: Localizar el bloque del toggle de tipo**

En `views/transaccion.html`, buscar:
```html
<div class="tx-toggle" role="group" aria-label="Tipo de transacción">
```
El bloque actual contiene dos botones: `btnTipoGasto` y `btnTipoIngreso`.

- [ ] **Step 2: Añadir el tercer botón Ahorro**

Reemplazar el contenido del `<div class="tx-toggle" role="group" aria-label="Tipo de transacción">` con:
```html
<div class="tx-toggle" role="group" aria-label="Tipo de transacción">
  <button type="button" class="tx-toggle-btn tx-toggle-btn--gasto tx-active"
          id="btnTipoGasto" aria-pressed="true">
    <span class="tx-toggle-icon" aria-hidden="true">↑</span> Gasto
  </button>
  <button type="button" class="tx-toggle-btn tx-toggle-btn--ingreso"
          id="btnTipoIngreso" aria-pressed="false">
    <span class="tx-toggle-icon" aria-hidden="true">↓</span> Ingreso
  </button>
  <button type="button" class="tx-toggle-btn tx-toggle-btn--ahorro"
          id="btnTipoAhorro" aria-pressed="false">
    <span class="tx-toggle-icon" aria-hidden="true">🐷</span> Ahorro
  </button>
</div>
```

- [ ] **Step 3: Actualizar el subtítulo del header**

Buscar:
```html
<p>Registra un ingreso o gasto</p>
```
Reemplazar con:
```html
<p>Registra un ingreso, gasto o ahorro</p>
```

- [ ] **Step 4: Verificar HTML en el preview**

Abrir `http://localhost:5050/#transaccion` (o abrir desde el FAB). Confirmar que aparecen tres botones: Gasto (activo/rojo), Ingreso, Ahorro.

- [ ] **Step 5: Commit**

```bash
git add views/transaccion.html
git commit -m "feat(transaccion): add Ahorro button to tipo toggle (HTML only)"
```

---

### Task 2: CSS — Estilo del botón Ahorro activo

**Files:**
- Modify: `views/transaccion.html` (bloque `<style>`, ~líneas 266–278)

- [ ] **Step 1: Añadir color activo para ahorro**

En el bloque `<style>`, localizar:
```css
.tx-toggle-btn--ingreso.tx-active {
  background: var(--color-success);
}
```
Añadir inmediatamente después:
```css
.tx-toggle-btn--ahorro.tx-active {
  background: #3b82f6;
}
```

- [ ] **Step 2: Verificar estilo en el preview**

Hacer click en el botón "Ahorro". Debe quedar con fondo azul (`#3b82f6`) y texto blanco. Los botones Gasto e Ingreso deben perder el estado activo al hacer click en Ahorro.

_(El comportamiento JS aún no está conectado — el botón no cambiará de estado realmente hasta Task 3. En este paso solo verificar que el CSS compila sin errores y que la clase `.tx-toggle-btn--ahorro.tx-active` tiene el color correcto si se agrega manualmente en DevTools.)_

- [ ] **Step 3: Commit**

```bash
git add views/transaccion.html
git commit -m "feat(transaccion): style ahorro toggle button (blue active state)"
```

---

### Task 3: JS — Lógica completa del tipo Ahorro

**Files:**
- Modify: `views/transaccion.html` (bloque `<script>`)

**Contexto:** El IIFE inicia en ~línea 446. Todos los cambios JS van dentro del mismo IIFE.

- [ ] **Step 1: Declarar `btnTipoAhorro`**

Localizar el bloque de declaraciones de variables (después de `const form = ...`):
```javascript
const btnTipoGasto    = document.getElementById('btnTipoGasto');
const btnTipoIngreso  = document.getElementById('btnTipoIngreso');
```
Añadir inmediatamente después:
```javascript
const btnTipoAhorro   = document.getElementById('btnTipoAhorro');
```

- [ ] **Step 2: Actualizar `_setTipo` para manejar ahorro**

Localizar la función `_setTipo`:
```javascript
function _setTipo(val) {
  tipoEl.value = val;
  btnTipoGasto.classList.toggle('tx-active', val === 'gasto');
  btnTipoGasto.setAttribute('aria-pressed', String(val === 'gasto'));
  btnTipoIngreso.classList.toggle('tx-active', val === 'ingreso');
  btnTipoIngreso.setAttribute('aria-pressed', String(val === 'ingreso'));
  cargarCategorias();
  _mostrarAporteHogar();
}
```
Reemplazar con:
```javascript
function _setTipo(val) {
  tipoEl.value = val;
  btnTipoGasto.classList.toggle('tx-active', val === 'gasto');
  btnTipoGasto.setAttribute('aria-pressed', String(val === 'gasto'));
  btnTipoIngreso.classList.toggle('tx-active', val === 'ingreso');
  btnTipoIngreso.setAttribute('aria-pressed', String(val === 'ingreso'));
  btnTipoAhorro.classList.toggle('tx-active', val === 'ahorro');
  btnTipoAhorro.setAttribute('aria-pressed', String(val === 'ahorro'));
  cargarCategorias();
  _mostrarAporteHogar();
}
```

- [ ] **Step 3: Añadir event listener para el botón ahorro**

Localizar:
```javascript
btnTipoIngreso.addEventListener('click',  () => _setTipo('ingreso'));
```
Añadir inmediatamente después:
```javascript
btnTipoAhorro.addEventListener('click',   () => _setTipo('ahorro'));
```

- [ ] **Step 4: Actualizar `cargarCategorias` para usar categorías de gasto cuando tipo=ahorro**

Localizar en `cargarCategorias`:
```javascript
const cats = await getCategorias(tipo);
```
Reemplazar con:
```javascript
const catTipo = tipo === 'ahorro' ? 'gasto' : tipo;
const cats = await getCategorias(catTipo);
```

**Nota:** La variable `tipo` se obtiene de `tipoEl.value` en la línea anterior (`const tipo = tipoEl.value;`). Verificar que esa variable ya existe en la función. Si la función usa `tipoEl.value` directamente en el `getCategorias` call sin asignarlo antes, la change es:
```javascript
// Antes (si no existe variable tipo):
const cats = await getCategorias(tipoEl.value);
// Después:
const catTipo = tipoEl.value === 'ahorro' ? 'gasto' : tipoEl.value;
const cats = await getCategorias(catTipo);
```

- [ ] **Step 5: Corregir creación de nueva categoría al vuelo**

Localizar en el handler de `nuevaCatGuardar`:
```javascript
const cat = await insertCategoria({ nombre, tipo: tipoEl.value });
```
Reemplazar con:
```javascript
const cat = await insertCategoria({ nombre, tipo: tipoEl.value === 'ahorro' ? 'gasto' : tipoEl.value });
```
_Razón: `categorias.tipo` solo acepta 'gasto' | 'ingreso'. Ahorro usa categorías de gasto._

- [ ] **Step 6: Actualizar preload de editTx para modo edición**

Localizar el bloque de inicialización de editTx (~línea 796–806):
```javascript
tipoEl.value = editTx.tipo;
btnTipoGasto.classList.toggle('tx-active', editTx.tipo === 'gasto');
btnTipoGasto.setAttribute('aria-pressed', String(editTx.tipo === 'gasto'));
btnTipoIngreso.classList.toggle('tx-active', editTx.tipo === 'ingreso');
btnTipoIngreso.setAttribute('aria-pressed', String(editTx.tipo === 'ingreso'));
```
Reemplazar con:
```javascript
tipoEl.value = editTx.tipo;
btnTipoGasto.classList.toggle('tx-active', editTx.tipo === 'gasto');
btnTipoGasto.setAttribute('aria-pressed', String(editTx.tipo === 'gasto'));
btnTipoIngreso.classList.toggle('tx-active', editTx.tipo === 'ingreso');
btnTipoIngreso.setAttribute('aria-pressed', String(editTx.tipo === 'ingreso'));
btnTipoAhorro.classList.toggle('tx-active', editTx.tipo === 'ahorro');
btnTipoAhorro.setAttribute('aria-pressed', String(editTx.tipo === 'ahorro'));
```

- [ ] **Step 7: Verificar en el preview — flujo completo**

1. Abrir la vista de transacción (click en FAB +).
2. Click en "Ahorro" → botón queda azul, se cargan categorías de gasto (ej. "Alimentación", "Transporte").
3. Seleccionar una categoría, ingresar monto S/ 100, click "Guardar".
4. Verificar que la transacción se guarda sin error (pantalla de éxito ✓).
5. Ir a historial → debe aparecer la transacción con tipo "ahorro" (badge distinto llegará en Fase 5).
6. Click en editar esa transacción → debe precargar con botón "Ahorro" activo (azul).
7. Verificar que "Aporte al hogar" NO aparece cuando tipo=ahorro (solo aparece para hogar+gasto).

- [ ] **Step 8: Commit**

```bash
git add views/transaccion.html
git commit -m "feat(transaccion): wire Ahorro tipo — categories, edit preload, nueva cat"
```

---

## Self-Review

**Spec coverage:**
- ✅ Ahorro como tercer tipo (Task 1)
- ✅ Categorías de gasto para ahorro (Task 3, Step 4)
- ✅ Color visual distinto (Task 2)
- ✅ Modo edición compatible (Task 3, Step 6)
- ✅ Nueva categoría al vuelo crea tipo=gasto (Task 3, Step 5)
- ✅ Aporte al hogar no aparece para ahorro (ya excluido: `tipoEl.value === 'gasto'` en `_mostrarAporteHogar`)

**Gaps:**
- Badge visual en historial para `tipo=ahorro` → Fase 5 (fuera de scope aquí)
- Balance neto con ahorro como gasto → Fase 4 (fuera de scope aquí)
