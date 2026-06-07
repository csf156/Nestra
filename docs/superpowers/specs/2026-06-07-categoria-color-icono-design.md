# Categoría: color + ícono

**Fecha:** 2026-06-07
**App:** Nestra (finanzas, vanilla JS + Supabase, vistas en `views/`, datos en `js/db.js`)

## Objetivo

Permitir que cada categoría tenga un **color** (hex) y un **ícono** (SVG de
biblioteca predefinida), gestionables por el usuario, y mostrarlos en los
consumidores ya existentes.

## Contexto descubierto

- **No existe un gestor de categorías.** `views/configuracion.html` es un stub
  ("Más opciones disponibles próximamente"). La única UI de categorías es el
  *crear-al-vuelo* (nombre + tipo) en `views/transaccion.html:586`.
- `updateCategoria` / `archivarCategoria` / `deleteCategoria` están definidas en
  `js/db.js` pero **ningún view las invoca**. Esta feature las activa.
- `categorias` **no tiene `user_id`** → es un set global compartido (app de un
  solo hogar). "Categorías existentes" = un único set, ~10-15 filas.
- Columna `color text` ya existe. `icono` no existe → requiere migración.
- `getCategorias()` hace `select('*')` → `icono` llega gratis, sin cambios.
- `insertCategoria` / `updateCategoria` pasan `datos` crudo al `.insert/.update`
  → aceptan `color` e `icono` sin cambios de firma.
- Consumidores: donut legend `graficos.html:269`, filas historial
  `historial.html:652`, select de tx `transaccion.html:536`.

## Decisiones

| Tema | Decisión |
|---|---|
| Alcance | **Gestor completo** de categorías en `configuracion.html` (ver/crear/editar/archivar). |
| Íconos | **SVG**, no emojis. Subset curado de **Lucide** (MIT), ~24 glifos, paths inline. |
| Entrega SVG | Módulo `js/icons.js` con helper `iconSvg(key, opts)` → string `<svg>`. Sin sprite externo, sin build. |
| Color del ícono | Hereda color de categoría en la leyenda del donut; color de texto neutro en listas densas (historial, select). |
| Migración | Solo añade columna `icono` (nullable). `color` sigue NULL. **Sin backfill.** Render cae a fallback. |
| Select de transacción | **Texto-only** (sin ícono). `<option>` nativo no renderiza SVG. Selector custom / chips: fuera de alcance. |
| Borrado | v1 incluye crear/editar/archivar. Hard-delete diferido (FK `on delete restrict` lo hace frágil). |

## Arquitectura

### 1. Migración — `supabase/migrations/20260607_categoria_icono.sql`

```sql
alter table public.categorias add column icono text;
```

Nullable, sin backfill. Documentar también en `supabase/schema.sql` (añadir
`icono text` a la tabla `categorias`).

### 2. Módulo de íconos — `js/icons.js` (nuevo)

Propósito único: catálogo de íconos + helper de render. No depende de nada.

```js
// Catálogo: cada ícono = { key, label, body }
// body = contenido SVG interno (paths) de Lucide, stroke, currentColor.
const CATEGORIA_ICONOS = [
  { key: 'wallet',     label: 'Cartera',    body: '<path .../>' },
  { key: 'shopping-cart', label: 'Compras', body: '...' },
  // ... ~24 total: home, car, utensils, heart, book, gift, plane,
  //     zap, smartphone, shirt, coffee, dumbbell, paw-print, baby,
  //     piggy-bank, briefcase, trending-up, hand-coins, music,
  //     gamepad, fuel, tag (default)
];

// iconSvg(key, { size = 20, cls = '' }) -> string '<svg ...>...</svg>'
// key desconocido / null -> 'tag'.
function iconSvg(key, opts) { /* ... */ }

// Opcional: getIconoMeta(key) -> { key, label } para el selector.
```

- SVG attrs: `width/height = size`, `viewBox="0 0 24 24"`, `fill="none"`,
  `stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap/linejoin="round"`,
  `class="cat-icon <cls>"`. `currentColor` permite que el consumidor controle el
  color vía CSS `color`.
- Se carga con `<script src=".../js/icons.js">` en cada view que lo use, igual
  patrón que `js/db.js`.

**Interfaz pública:** `CATEGORIA_ICONOS` (array), `iconSvg(key, opts)`.
**Depende de:** nada.

### 3. Gestor de categorías — `views/configuracion.html`

Reemplaza la card stub "Preferencias" por una card **Categorías**.

**Lista**
- Carga `getCategorias()` (solo activas en v1).
- Cada fila: `iconSvg(c.icono)` + dot de color (`c.color` o paleta-índice) +
  nombre + chip tipo + límite (si hay) + botones Editar / Archivar.
- Estado vacío y estado error.

**Formulario crear/editar** (panel inline o `<dialog>`)
- Campos: **nombre** (text, requerido), **tipo** (gasto/ingreso),
  **límite mensual** (number, opcional), **color**, **ícono**.
- Color: `<input type="color">` + botón "Sin color" que lo pone a NULL.
- Ícono: grid visual de botones `iconSvg(key)` de `CATEGORIA_ICONOS`,
  selección única; botón "Sin ícono" → NULL. Indicar selección activa.
- Guardar:
  - Nuevo → `insertCategoria({ nombre, tipo, limite_mensual, color, icono })`.
  - Editar → `updateCategoria(id, { ...mismos campos })`.
  - `color`/`icono`/`limite_mensual` = `null` cuando no se eligen.
- Tras guardar: recargar lista. Manejo de error con mensaje inline.

**Archivar**
- Botón por fila → `archivarCategoria(id)` con confirmación. Recarga lista.

**Interfaz/dependencias:** usa `getCategorias`, `insertCategoria`,
`updateCategoria`, `archivarCategoria` (db.js, ya existen) + `iconSvg`
(icons.js). Sin cambios en db.js.

### 4. Consumidores (mostrar ícono)

| Archivo | Punto | Cambio |
|---|---|---|
| `graficos.html` `render2` | map `categoriasGasto` (:233) + leyenda (:269) | añadir `icono` al map por nombre; prepend `iconSvg(icono)` en cada `<li>`, con `color` = color de categoría. |
| `historial.html` | render filas (:652) | prepend `iconSvg(icono)` color neutro antes del nombre. Necesita que la query de transacciones traiga `categorias.icono` (verificar el `select` del join). |
| `transaccion.html` | select (:536) | **sin cambio** (texto-only). |

- `graficos.html` `render2` ya lee `color` y cae a `paleta[i % n]` cuando es
  NULL → reutilizar el mismo patrón para combinar color del ícono.
- Cargar `js/icons.js` en `graficos.html` e `historial.html`.
- CSS: clase `.cat-icon` (tamaño, alineación vertical con el texto). En la
  leyenda del donut el `<li>` fija `color` = color de categoría; en historial el
  contenedor deja el `color` heredado neutro.

### 5. Migración de datos existentes

Ninguna. `color` NULL → paleta-por-índice (ya implementado en `render2`).
`icono` NULL → `iconSvg` devuelve `tag`. Usuario reestiliza en el gestor.

## Flujo de datos

```
Usuario (gestor configuracion.html)
  -> insert/updateCategoria({color, icono})  -> Supabase categorias
Supabase -> getCategorias select('*')  -> {..., color, icono}
  -> render2 (donut + leyenda) : color de categoría en dot e ícono
  -> historial filas : ícono neutro + nombre
  -> transaccion select : solo texto
```

## Manejo de errores

- Migración: idempotencia no crítica (una sola aplicación). Si `icono` ya
  existe, falla limpio; aplicar una vez.
- Gestor: cada operación db en try/catch con mensaje inline; botones se
  rehabilitan en fallo (patrón existente en transaccion.html).
- Render: `iconSvg(null|desconocido)` nunca rompe → siempre `tag`. `color` NULL
  → fallback de paleta. Ningún consumidor asume columnas no-NULL.

## Testing (manual — no hay framework en el repo)

1. Aplicar migración; confirmar columna `icono`.
2. Gestor: crear categoría con color+ícono → persisten; editar otra → cambian;
   archivar → desaparece de la lista.
3. Donut (`graficos.html`): leyenda muestra íconos con color de categoría;
   categorías sin color usan paleta.
4. Historial: filas muestran ícono neutro; categorías sin ícono → `tag`.
5. Transacción: select sigue funcionando (texto-only), crear-al-vuelo intacto.
6. Categorías preexistentes (color/icono NULL) renderizan con fallbacks.

## Fuera de alcance (v1)

- Selector custom / chips con ícono en `transaccion.html`.
- Hard-delete de categorías desde el gestor.
- Mostrar/gestionar categorías archivadas en el gestor.
- Íconos custom subidos por el usuario.
