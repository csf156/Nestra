# Rediseño de gestión de categorías — Diseño

> Spec para tres mejoras en la gestión de categorías de Nestra (`views/configuracion.html` + vistas donde aparecen categorías).

**Fecha:** 2026-06-11
**Alcance:** v1 (app actual en producción). La migración corre en la base de datos actual — no hay entorno v2 todavía.

## Objetivos

1. **Acciones por categoría** — reemplazar los 3 botones inline (editar/archivar/eliminar) por: una **estrella** (favorita, toggle rápido) + un **engranaje** que abre un **modal centrado** con las acciones Editar / Archivar (o Desarchivar) / Eliminar.
2. **Archivadas al fondo** — las categorías archivadas se muestran al final de su grupo (Gastos / Ingresos), atenuadas y con badge "archivada", en vez de desaparecer.
3. **Ícono por categoría** — selector de íconos (biblioteca Tabler, sprite SVG local) con búsqueda por palabra. El ícono elegido se muestra en configuración y en todas las vistas donde aparecen categorías.

## Decisiones tomadas

- **Biblioteca de íconos:** Tabler como **sprite SVG local** en `assets/` (sin CDN, funciona offline, variedad completa).
- **Búsqueda:** por nombre + tags en inglés. **Sin** mapeo español.
- **Edición:** modal/form **unificado** (nombre + límite + ícono juntos). Reemplaza la edición inline actual.
- **Íconos:** se muestran en configuración, registro de transacción, historial y dashboard.
- **Archivadas:** ordenadas al fondo **dentro de su mismo grupo** (gasto/ingreso), atenuadas + badge. El engranaje alterna archivar↔desarchivar.
- **Menú de acciones:** **modal centrado** (overlay + tarjeta centrada), no dropdown anclado.

## Arquitectura

### Capa de datos

**Migración** (`supabase/migrations/AAAAMMDD_categoria_icono.sql`):
```sql
alter table public.categorias add column if not exists icono text;
```
- `icono` guarda el nombre del ícono Tabler (ej. `"car"`, `"home"`). Nullable. `null` → ícono por defecto en la UI.

**`js/db.js`:**
- `getCategorias(tipo = null, incluirArchivadas = false)` — nuevo parámetro. Si `incluirArchivadas` es `true`, **no** aplica el filtro `.eq('estado','activa')`. Comportamiento por defecto sin cambios (solo activas) para no afectar a las vistas que ya la usan.
- `getCategoriasConFavorito(tipo = null, incluirArchivadas = false)` — propaga el nuevo parámetro a `getCategorias`. Configuración la llama con `incluirArchivadas = true`.
- `desarchivarCategoria(id)` — nueva función, espejo de `archivarCategoria`: `update({ estado: 'activa' })`.
- `updateCategoria(id, datos)` — ya acepta campos arbitrarios; soporta `{ icono }` sin cambios.

### Biblioteca de íconos

**Assets:**
- `assets/tabler-sprite.svg` — sprite con los íconos outline de Tabler como `<symbol id="tabler-NAME">`. Se obtiene del paquete `@tabler/icons` (dist `tabler-sprite.svg`).
- `assets/tabler-tags.json` — índice para búsqueda: `{ "car": ["vehicle","auto","transport"], ... }`. Se obtiene de los metadatos de Tabler (`tags.json`). Si no hay tags para un ícono, se busca solo por su nombre.

**`js/iconos.js`** (nuevo, cargado globalmente en `index.html` junto a los otros `js/`):
- Carga el sprite una vez (fetch + inyección oculta en el DOM, o `<use href="assets/tabler-sprite.svg#...">` directo).
- Carga `tabler-tags.json` una vez, cachea en memoria.
- `iconoCategoria(nombre, opts)` → string HTML `<svg class="cat-icono" aria-hidden="true"><use href="assets/tabler-sprite.svg#tabler-NAME"></use></svg>`. Si `nombre` es null/vacío → usa ícono por defecto (`tabler-tag` o similar).
- `buscarIconos(query)` → array de nombres de íconos cuyo nombre o tags contienen `query` (case-insensitive). Query vacía → set inicial sugerido (ej. primeros N comunes).

### Componentes (en `views/configuracion.html`)

**1. Item de categoría (rediseño de `renderCatItem`)**

Layout horizontal: `[ícono 32px] [nombre flex] [límite] [⭐ estrella] [⚙️ engranaje]`
- Ícono: `iconoCategoria(cat.icono)` en chip 32×32.
- Estrella: `cfg-cat-star`, `aria-pressed`. Llena (favorita) o vacía. Click → toggle optimista (ver abajo).
- Engranaje: `cfg-cat-gear`. Click → abre el modal de acciones para esa categoría.
- Si `cat.estado === 'archivada'`: el `<li>` lleva clase `cfg-cat-item--archivada` (opacity reducida) + badge `<span class="cfg-cat-badge-arch">archivada</span>` tras el nombre.

**2. Orden de la lista (`renderCategorias`)**

Por cada grupo (gastos / ingresos):
- Particionar en activas y archivadas.
- Activas primero (orden alfabético por nombre), luego archivadas (alfabético).
- Render concatenado en el `<ul>` correspondiente.

**3. Estrella favorita (toggle optimista)**

Al click:
- Flip visual inmediato del estado (llena ↔ vacía) + actualizar `aria-pressed` y el objeto en `_cats`.
- Llamar `toggleFavorita(catId, nuevoEstado)`.
- Si la promesa falla: revertir el flip visual y mostrar toast "No se pudo actualizar el favorito".

**4. Modal de acciones (centrado, nuevo)**

Markup: overlay `cfg-acc-overlay` (patrón `[hidden]` como los otros modales de la vista) + tarjeta `cfg-acc-modal` centrada con:
- Cabecera: ícono de la categoría + nombre.
- Botones (uno por fila):
  - **Editar categoría** → cierra este modal, abre el modal de edición.
  - **Archivar categoría** / **Desarchivar categoría** (según `estado`) → llama `archivarCategoria`/`desarchivarCategoria`, actualiza `_cats` y re-renderiza la lista (para reordenar), toast, cierra.
  - **Eliminar categoría** → cierra este modal, abre el modal de eliminación existente (`cfgDeleteModal`) con su lógica de reasignación.
  - **Cancelar** → cierra.
- Cierra con Cancelar / tap en overlay / Escape.
- Estado: variable `_accCatId` con la categoría activa del modal.

**5. Modal de edición unificado (nuevo, reemplaza edición inline)**

Markup: overlay `cfg-edit-overlay` + tarjeta `cfg-edit-modal` con:
- Campo **Nombre** (`cfg-edit-nombre`, text, maxlength 50).
- Campo **Límite mensual** (`cfg-edit-limite`, number, min 0, step 0.01, opcional).
- Botón **Ícono** (`cfg-edit-icono-btn`): muestra el ícono actual (o el default) + texto "Cambiar ícono". Click → abre el icon picker.
- Acciones: Cancelar / Guardar.
- Guardar → `updateCategoria(id, { nombre, limite_mensual, icono })`, actualiza `_cats`, re-renderiza la lista, toast "Categoría actualizada", cierra.
- Validación: nombre no vacío (si vacío, toast y no guarda).
- Estado: `_editCatId`, `_editIconoSel` (ícono seleccionado pendiente de guardar).
- **Se elimina** la edición inline de nombre y de límite (`activarEditNombre`, `activarEditLimite` y sus handlers). El click en nombre/límite ya no edita inline.

**6. Icon Picker (nuevo)**

Markup: overlay `cfg-picker-overlay` + tarjeta `cfg-picker-modal` con:
- Barra de búsqueda (`cfg-picker-search`, text, placeholder "Buscar ícono…").
- Grid scrolleable (`cfg-picker-grid`) de botones-ícono (6 columnas en móvil).
- Cada botón: `iconoCategoria(nombre)` + `data-icono="nombre"`.
- Tipeo (debounce ~150ms) → `buscarIconos(query)` → re-render del grid.
- Click en un ícono → setea `_editIconoSel`, actualiza el botón de ícono del modal de edición, cierra el picker (vuelve al form de edición).
- Cierra con Escape / tap en overlay (sin seleccionar).
- El ícono actualmente seleccionado se marca visualmente en el grid.

### Íconos en otras vistas

Usar el helper `iconoCategoria(cat.icono)` donde se renderiza el nombre de una categoría:
- **`views/transaccion.html`** — en el selector/lista de categorías al registrar.
- **`views/historial.html`** — en `_datosTx`/`cardTx`/`rowTx`, junto al nombre de categoría (`d.cat`). El dato del ícono viene de `t.categorias.icono` → ampliar el `select` embebido en `getTransacciones` para incluir `icono` (`categorias(nombre, tipo, color, icono)`).
- **`views/dashboard.html`** — en el desglose por categoría, si existe.

En todas, ícono por defecto cuando `icono` es null.

### CSS

Nuevas clases en el `<style>` de `configuracion.html`, siguiendo las variables existentes (`--color-primary`, `--bg-light`, `--border-light`, `--radius-*`, `--space-*`):
- `.cfg-cat-icono` (chip 32×32), `.cfg-cat-star`, `.cfg-cat-star--on`, `.cfg-cat-gear`.
- `.cfg-cat-item--archivada` (opacity ~0.5), `.cfg-cat-badge-arch`.
- `.cfg-acc-overlay/.cfg-acc-modal` (modal de acciones centrado — reusar patrón `.cfg-modal-overlay`).
- `.cfg-edit-overlay/.cfg-edit-modal`.
- `.cfg-picker-overlay/.cfg-picker-modal/.cfg-picker-search/.cfg-picker-grid`.
- `.cat-icono` (helper global, en `css/components.css` o inline) — tamaño del SVG `<use>`, `currentColor`.

Todos los modales nuevos usan el patrón `[hidden]` ya presente (`.cfg-modal-overlay[hidden]{display:none}`) y z-index 200+.

## Flujo de datos

```
cargar() → getCategoriasConFavorito(null, true)   // incluye archivadas + flag favorita
        → renderCategorias()                       // ordena activas, luego archivadas, por grupo

⭐ click → toggle optimista → toggleFavorita()      // revierte si falla
⚙️ click → modal acciones (_accCatId)
   ├─ Editar     → modal edición (_editCatId) → [Ícono → icon picker → _editIconoSel]
   │              → Guardar → updateCategoria({nombre,limite_mensual,icono}) → re-render
   ├─ Archivar   → archivarCategoria()  → re-render (reordena)
   ├─ Desarchivar→ desarchivarCategoria()→ re-render (reordena)
   └─ Eliminar   → modal eliminación existente (reasignar + deleteCategoria)
```

## Manejo de errores

- Toda llamada a `db.js` va en `try/catch` con toast en fallo (patrón ya usado en la vista).
- Toggle de favorita: optimista con reversión visual en error.
- Carga del sprite/tags: si falla, `iconoCategoria` cae al ícono por defecto y la app sigue funcionando (degradación elegante). El icon picker muestra "No se pudieron cargar los íconos" si el índice no carga.

## Testing / verificación

Verificación manual en preview (no hay suite automatizada en el repo):
- Crear categoría → asignar ícono vía picker → aparece en lista + en registro de transacción.
- Buscar "car" en el picker → muestra íconos de transporte.
- Marcar/desmarcar favorita → persiste tras recargar.
- Archivar → va al fondo del grupo, atenuada, engranaje muestra "Desarchivar".
- Desarchivar → vuelve a su posición alfabética entre las activas.
- Editar nombre+límite+ícono en un solo modal → se guarda todo junto.
- Eliminar con transacciones → modal de reasignación funciona como antes.
- Probar en móvil (390px) y desktop.

## Archivos

- **Crear:** `supabase/migrations/AAAAMMDD_categoria_icono.sql`, `js/iconos.js`, `assets/tabler-sprite.svg`, `assets/tabler-tags.json`
- **Modificar:** `js/db.js` (getCategorias, getCategoriasConFavorito, desarchivarCategoria, select de getTransacciones), `index.html` (cargar `js/iconos.js`), `views/configuracion.html` (grande), `views/transaccion.html`, `views/historial.html`, `views/dashboard.html`
- **Eliminar (dentro de configuracion.html):** lógica de edición inline de nombre y límite.

## Fuera de alcance (YAGNI)

- Mapeo de búsqueda español→inglés.
- Color por categoría (la columna `color` existe pero no se toca aquí).
- Íconos en gráficos/oráculo (solo transacción, historial, dashboard).
