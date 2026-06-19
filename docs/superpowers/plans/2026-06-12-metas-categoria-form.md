# Metas — Form & Categoria (Fase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Metas siempre son `tipo='ahorro'`. Form debe ocultar selector de tipo y añadir selector de categoría (gasto categories). DB ya tiene `metas.categoria_id` (Fase 1).

**Architecture:** Dos archivos modificados: `views/metas.html` (HTML/CSS/JS) y `js/db.js` (nueva función `insertMeta` con categoria_id). El form previa crea metas con `tipo='ahorro'` hardcodeado. El selector de categoría carga igual que en transaccion.

**Tech Stack:** Vanilla JS IIFE, Supabase, CSS custom properties. Sin framework de tests — verificación manual.

---

## Contexto de codebase

- `views/metas.html` actual: form tiene selector `#mTipo` con 3 opciones (ahorro, reduccion_gasto, aporte_hogar). Líneas 24–30.
- `views/metas.html` actual: `insertMeta(data)` en js/db.js se llama con `{ nombre, tipo, horizonte, ambito, monto_objetivo, fecha_inicio, fecha_limite, nota }`.
- `metas.categoria_id` existe (uuid FK nullable → categorias). No aparece en form aún.
- `categorias.tipo` = 'gasto' | 'ingreso'. Metas usan categorías de gasto.
- Form usa `.metas-flabel` y `.metas-input` para styling consistente.
- Modal se abre/cierra con atributo `hidden` en `.metas-modal-overlay`.

## Archivos

- Modificar: `views/metas.html` (HTML form + CSS + JS IIFE)
- Modificar: `js/db.js` (función `insertMeta` signature + query)

---

### Task 1: HTML — Remover tipo selector, añadir categoría selector

**Files:**
- Modify: `views/metas.html` (bloque `<!-- Nueva meta -->` form, ~líneas 20–63)

- [ ] **Step 1: Localizar y remover el label de tipo**

En `<form id="metaForm">`, buscar:
```html
        <label class="metas-flabel">Tipo
          <select class="metas-input" id="mTipo">
            <option value="ahorro">Ahorro</option>
            <option value="reduccion_gasto">Reducción de gasto</option>
            <option value="aporte_hogar">Aporte al hogar</option>
          </select>
        </label>
```
Eliminar completamente (5 líneas).

- [ ] **Step 2: Añadir selector de categoría**

Inmediatamente DESPUÉS del campo "Nombre" (después del cierre `</label>` de mNombre), añadir:
```html
        <label class="metas-flabel">Categoría para este ahorro
          <select class="metas-input" id="mCategoria" required>
            <option value="">Cargando categorías...</option>
          </select>
        </label>
```

- [ ] **Step 3: Verificar HTML en el preview**

Abrir `http://localhost:5050/#metas` (o desde el nav). Click en "Nueva meta". Form debe mostrar:
- Nombre ✓
- Categoría ✓ (dropdown, "Cargando...")
- Horizonte ✓
- Ámbito ✓
- Monto objetivo ✓
- etc.

NO debe aparecer "Tipo".

- [ ] **Step 4: Commit**

```bash
git add views/metas.html
git commit -m "feat(metas): remove tipo selector, add categoria field (HTML only)"
```

---

### Task 2: JS — Cargar categorías, hardcodear tipo=ahorro, cargarCategorias en modal abierto

**Files:**
- Modify: `views/metas.html` (bloque `<script>` en el IIFE)

Contexto: El IIFE inicia ~línea 360 (check en el archivo actual). Variables principales: `mNombre`, `mTipo`, `mHorizonte`, etc. (mTipo será removido).

- [ ] **Step 1: Reemplazar referencia a mTipo con hardcoded ahorro**

Localizar línea que declara:
```javascript
    const mTipo = document.getElementById('mTipo');
```
Eliminar esa línea completamente. En su lugar, no hay variable — usaremos `'ahorro'` inline donde se necesite.

- [ ] **Step 2: Declarar mCategoria**

Localizar el bloque de declaraciones de elementos (luego de `const mNombre = ...`) y añadir:
```javascript
    const mCategoria = document.getElementById('mCategoria');
```

- [ ] **Step 3: Cargar categorías cuando se abre el modal**

Buscar la función que abre el modal (probablemente `abrirModal()` o similar). Si existe lógica de `abrirModal`, añadir una llamada a cargar categorías. Si no, buscar la lógica que muestra/oculta `#metaModal` y añadir ahí:
```javascript
    async function cargarCategoriasMeta() {
      mCategoria.disabled = true;
      mCategoria.innerHTML = '<option value="">Cargando...</option>';
      try {
        const cats = await getCategorias('gasto');
        if (!cats.length) {
          mCategoria.innerHTML = '<option value="">Sin categorías</option>';
          return;
        }
        mCategoria.innerHTML = 
          '<option value="">Selecciona una categoría</option>' +
          cats.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('') +
          '<option value="__nueva__">+ Nueva categoría</option>';
      } catch (err) {
        console.error('Error cargando categorías:', err);
        mCategoria.innerHTML = '<option value="">Error al cargar</option>';
      } finally {
        mCategoria.disabled = false;
      }
    }
```

- [ ] **Step 4: Llamar cargarCategoriasMeta() al abrir modal**

Buscar dónde se muestra el modal (probablemente `metaModal.hidden = false` o `.removeAttribute('hidden')`). Inmediatamente después de mostrar el modal, llamar:
```javascript
    cargarCategoriasMeta();
```

- [ ] **Step 5: Manejar "Nueva categoría"**

En el evento `change` de `mCategoria`, si `value === '__nueva__'`, mostrar un input inline o modal para crear categoría (copiar patrón de transaccion.html si aplica). Para simplificar Fase 3, puede no implementarse ahora — lo mínimo es cargar y seleccionar.

**Por ahora, saltar esta parte — focus en cargar y seleccionar.**

- [ ] **Step 6: Actualizar submit handler para usar tipo='ahorro' + categoria_id**

Localizar el handler `form.addEventListener('submit', ...)` o similar. En la línea que construye datos para `insertMeta`, cambiar:
```javascript
    // Antes (si existía):
    // const meta = { nombre, tipo: mTipo.value, horizonte: ..., ... };
    
    // Después:
    const meta = { 
      nombre: mNombre.value,
      tipo: 'ahorro',  // hardcoded
      horizonte: mHorizonte.value,
      ambito: ...
      monto_objetivo: ...,
      fecha_inicio: ...,
      fecha_limite: ...,
      nota: ...,
      categoria_id: mCategoria.value || null,  // NEW
    };
```

- [ ] **Step 7: Resetear mCategoria en cancel/close**

Buscar lógica de cancel/close del modal. Añadir:
```javascript
    mCategoria.value = '';
```

- [ ] **Step 8: Verificar en preview**

1. Abrir metas, click "Nueva meta"
2. Form carga, categorías dropdown debe cargarse (ver "Alimentación", "Transporte", etc. — gasto categories)
3. Seleccionar una categoría, ingresar datos, click "Guardar"
4. Verificar que la meta se crea sin error
5. Ir a dashboard/historial → debe aparecer la meta
6. Si la meta aparece en dashboard → categoria_id se guardó ✓

- [ ] **Step 9: Commit**

```bash
git add views/metas.html
git commit -m "feat(metas): hardcode tipo=ahorro, wire categoria dropdown"
```

---

### Task 3: DB — Actualizar insertMeta para aceptar categoria_id

**Files:**
- Modify: `js/db.js` (función `insertMeta`)

- [ ] **Step 1: Leer insertMeta actual**

En `js/db.js`, buscar la función `insertMeta(datos)`. Probablemente se ve así:
```javascript
async function insertMeta(datos) {
  try {
    const { data, error } = await supabase
      .from('metas')
      .insert([{
        nombre: datos.nombre,
        tipo: datos.tipo,
        horizonte: datos.horizonte,
        ambito: datos.ambito,
        monto_objetivo: datos.monto_objetivo,
        fecha_inicio: datos.fecha_inicio,
        fecha_limite: datos.fecha_limite,
        nota: datos.nota,
        user_id: _requireUserId(),
      }]);
    if (error) throw error;
    return data[0];
  } catch (err) {
    console.error('Error en insertMeta():', err);
    throw err;
  }
}
```

- [ ] **Step 2: Añadir categoria_id a la insert**

Reemplazar la función con:
```javascript
async function insertMeta(datos) {
  try {
    const { data, error } = await supabase
      .from('metas')
      .insert([{
        nombre: datos.nombre,
        tipo: datos.tipo,
        horizonte: datos.horizonte,
        ambito: datos.ambito,
        monto_objetivo: datos.monto_objetivo,
        fecha_inicio: datos.fecha_inicio,
        fecha_limite: datos.fecha_limite,
        nota: datos.nota,
        categoria_id: datos.categoria_id || null,
        user_id: _requireUserId(),
      }]);
    if (error) throw error;
    return data[0];
  } catch (err) {
    console.error('Error en insertMeta():', err.message || err);
    throw err;
  }
}
```

**Cambios:**
- Añadida línea: `categoria_id: datos.categoria_id || null,`
- Mejorado el catch para loguear `err.message`

- [ ] **Step 3: Verificar función updateMeta (si existe)**

Si existe `updateMeta`, asegurar que también soporta `categoria_id`:
```javascript
async function updateMeta(id, datos) {
  try {
    const { data, error } = await supabase
      .from('metas')
      .update({
        ...(datos.nombre !== undefined && { nombre: datos.nombre }),
        ...(datos.categoria_id !== undefined && { categoria_id: datos.categoria_id }),
        // ... otros campos
      })
      .eq('id', id);
    if (error) throw error;
    return data[0];
  } catch (err) {
    console.error('Error en updateMeta():', err.message || err);
    throw err;
  }
}
```

Si `updateMeta` no existe o no toca `categoria_id`, es OK — esto es bonus.

- [ ] **Step 4: Commit**

```bash
git add js/db.js
git commit -m "feat(db): insertMeta + updateMeta accept categoria_id"
```

---

## Self-Review

**Spec coverage:**
- ✅ Tipo siempre ahorro (Task 2, hardcoded)
- ✅ Selector de categoría (Task 1 HTML, Task 2 JS load)
- ✅ categoria_id guardado en DB (Task 3)
- ✅ Cargas gasto categories (Task 2, getCategorias('gasto'))

**Gaps:**
- Nueva categoría al vuelo ("+ Nueva categoría") → can be deferred to Fase 3.5 or skipped (editar metas puede addirlo luego)
- Edit modal para metas existentes → fuera de scope (Fase 3 es solo crear)
- Mostrar categoría en el dashboard/card de metas → Fase 5+ (UI display)
