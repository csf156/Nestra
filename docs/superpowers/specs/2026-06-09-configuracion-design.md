# Design: Vista de Configuración (`views/configuracion.html`)

**Date:** 2026-06-09
**Scope:** `views/configuracion.html` (nuevo). Adiciones a `js/db.js` (2 funciones). Adición a `js/export.js` (1 función).

---

## Globals disponibles en runtime

| Global | Descripción |
|---|---|
| `getProfiles()` | `[{ user_id, nombre, aporte_mensual_esperado, ... }]` |
| `updateProfile(datos)` | `{ nombre?, aporte_mensual_esperado? }` → fila. Lanza en fallo |
| `getCategorias(tipo?)` | `[{ id, nombre, tipo, limite_mensual, color, estado }]` activas |
| `insertCategoria(datos)` | `{ nombre, tipo, limite_mensual? }` → fila |
| `updateCategoria(id, datos)` | → fila |
| `deleteCategoria(id)` | Lanza si tiene transacciones (FK restrict) |
| `archivarCategoria(id)` | → fila |
| `getTransacciones(filtros)` | `{ categoria_id }` para contar historial |
| `reasignarCategoria(fromId, toId)` | **NUEVO** — bulk update transacciones |
| `resetearDatosUsuario()` | **NUEVO** — borra transacciones + metas del usuario |
| `logout()` | Sign out + redirect |
| `exportador.exportXLSX(txs)` | existente |
| `exportador.exportJSON(datos)` | **NUEVO** — descarga JSON |
| `window.currentUser` | `{ id, email }` — usuario activo |
| `formatMonto(n)` | `"S/ 1,234.56"` |

---

## Gaps → nuevas funciones

### `reasignarCategoria(fromId, toId)` en db.js
```js
async function reasignarCategoria(fromId, toId) {
  // bulk update: UPDATE transacciones SET categoria_id=toId WHERE categoria_id=fromId
  // Returns: { count: N }. Lanza en fallo.
}
```

### `resetearDatosUsuario()` en db.js
```js
async function resetearDatosUsuario() {
  // DELETE transacciones WHERE user_id = auth.uid() (RLS lo limita)
  // DELETE aportes_meta vinculados (cascade si existe, sino manual)
  // DELETE prestamos vinculados (cascade)
  // DELETE metas WHERE user_id = auth.uid() (personal) — hogar solo si ambos confirman
  // Simplificado: solo borra transacciones personales. Hogar: ambos deben borrar por su cuenta.
  // Returns: undefined. Lanza en fallo.
}
```

### `exportJSON(datos)` en export.js
```js
function exportJSON(datos) {
  // JSON.stringify(datos, null, 2) → Blob → URL → descarga
  // nombre: 'nestra-respaldo-YYYY-MM-DD.json'
  // Returns: { ok: true } | { ok: false, reason: 'sin-datos'|'descarga-fallo' }
}
```

---

## Aesthetic direction (frontend-design skill)

**Refined utility / settings panel** — funcional y denso, pero con precisión quirúrgica en cada detalle. Inspiración: Linear settings, macOS System Preferences.

- **Secciones como cards**: cada sección en un contenedor con `border-radius-lg`, separados por espacio amplio.
- **Section headers**: label pequeño en uppercase tracking-wide, color secundario — no h2 genérico.
- **Filas de categoría**: list items con acciones (Editar / Archivar / Eliminar) como icon-buttons 28px, visibles siempre en móvil, hover en desktop.
- **Edición inline de límite**: click en el monto → `<input>` in-place, enter/blur guarda. Sin modal.
- **Dark mode toggle**: pill switch con icono ☀️/🌙 dentro. Estado guardado en `localStorage('nestra-theme')`.
- **Danger zone**: fondo `color-mix(in srgb, var(--color-danger) 5%, var(--bg-light))` con borde rojo sutil.
- **Nueva categoría**: formulario colapsable (oculto por defecto, se abre con botón "+").

---

## Sección 1 — Perfiles

- `getProfiles()` → identificar perfil activo (`p.user_id === window.currentUser.id`).
- **Perfil activo**: inputs de `nombre` y `aporte_mensual_esperado`. Botón "Guardar" (aparece al detectar cambio). Feedback toast.
- **Otro perfil**: nombre y aporte en modo lectura, badge "(otro miembro)".

## Sección 2 — Categorías

### Lista
- `getCategorias()` → agrupar por `tipo`: primero "Gastos", luego "Ingresos".
- Cada fila: nombre | límite mensual inline | botones (Editar, Archivar, Eliminar).
- **Edición inline de límite**: `<span>` clickeable → `<input type="number">` → enter/blur → `updateCategoria(id, { limite_mensual: valor })`.
- **Editar nombre**: botón abre `<input>` in-place para nombre. Guardar con enter/blur.
- **Archivar**: `archivarCategoria(id)` → remove de lista con animación.
- **Eliminar**: flujo en 2 pasos:
  1. Fetch `getTransacciones({ categoria_id: id })`.
  2. Si count > 0: modal reasignación con dropdown de categorías del mismo tipo.
  3. Si count = 0: confirm simple.
  4. On confirm: si reasignar → `reasignarCategoria(id, targetId)` → `deleteCategoria(id)`.
  5. Si archivar en modal → `archivarCategoria(id)`.

### Nueva categoría
- Botón "+" abre form inline colapsable: nombre (required), tipo (select: Gasto/Ingreso), límite mensual (optional).
- `insertCategoria({ nombre, tipo, limite_mensual })` → agregar a lista sin recargar.

## Sección 3 — Preferencias

- **Modo oscuro**: pill toggle. Lee `localStorage.getItem('nestra-theme')` al cargar.
  - `'dark'`: `html.classList.add('dark')`, remove `'light'`.
  - `'light'`: `html.classList.add('light')`, remove `'dark'`.
  - Guardar en `localStorage.setItem('nestra-theme', valor)`.
- Moneda e idioma: filas informativas no editables.

## Sección 4 — Datos

- **Exportar JSON**: `Promise.all([getTransacciones({}), getCategorias(), getMetas(), getProfiles()])` → `exportador.exportJSON(datos)`.
- **Importar JSON**: file input oculto → parse → mostrar resumen → insertar transacciones via `insertTransaccion` en loop. Errores por item se acumulan.
- **Cerrar sesión**: `logout()`.
- **Resetear todos los datos**: botón rojo → modal que requiere escribir `CONFIRMAR` → `resetearDatosUsuario()` → `logout()`.

---

## Flujo edición inline de categoría

```
span.cfg-cat-limite (click)
  → reemplazar con <input> focused
  → blur/enter: updateCategoria(id, { limite_mensual: val })
  → on success: span.textContent = formatMonto(val) | '—'
  → on error: revert + toast
```

## Modal reasignación / eliminación

```html
<div id="cfgDeleteModal" role="dialog" aria-modal="true" hidden>
  <h2>Eliminar categoría</h2>
  <p>Esta categoría tiene <strong id="cfgDeleteCount">N</strong> transacciones.</p>
  <!-- Opción A: reasignar -->
  <label>Reasignar a:
    <select id="cfgDeleteTarget">...</select>
  </label>
  <button id="cfgDeleteConfirm">Reasignar y eliminar</button>
  <!-- Opción B: archivar -->
  <button id="cfgDeleteArchivar">Archivar en su lugar</button>
  <button id="cfgDeleteCancelar">Cancelar</button>
</div>
```

---

## Manejo de errores

| Escenario | Comportamiento |
|---|---|
| `updateProfile` falla | Toast error; inputs revertidos |
| `deleteCategoria` FK error | Mostrar modal de reasignación |
| `reasignarCategoria` falla | Toast error; no eliminar |
| `resetearDatosUsuario` falla | Toast error; no hacer logout |
| `exportJSON` falla | Toast error |
| Import JSON inválido | Toast "Archivo inválido" |

---

## Out of scope

- Editar `color` de categoría.
- Gestionar metas desde configuración.
- Añadir miembros al hogar.
- Favoritas de categorías.
