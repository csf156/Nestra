# Design: Vista de Gráficos Financieros (8 gráficos)

**Date:** 2026-06-07
**Status:** Approved
**Scope:** Nueva vista `views/graficos.html` con 8 gráficos financieros + helper en db.js + carga de Chart.js

---

## Context

Nestra tiene la ruta `graficos` ya registrada en `js/router.js` (línea 114), pero falta `views/graficos.html`. El router inyecta la vista vía `fetch` + `innerHTML` y re-ejecuta scripts inline (`executeScripts`). Las vistas nunca consultan Supabase directo: toda lectura pasa por `js/db.js`. Chart.js y otras CDN se cargan una vez en `index.html`.

---

## Goal

Construir la Vista 4 — Análisis: 8 gráficos financieros que reaccionan a un selector mes/año único. Móvil-first, español, modo oscuro/claro. Cada gráfico en su propia tarjeta con título + descripción breve, y con estados de carga/vacío/error aislados.

---

## Decisiones de diseño (UX/UI)

1. **Chart.js cargado en `index.html` `<head>`** (cacheado, global), igual que Supabase y SheetJS. No re-fetch por navegación. El mapa de calor (gráfico 5) NO usa Chart.js — grilla CSS pura.
2. **Selector = navegador mensual** (`◀ junio 2026 ▶`), mismo patrón que `historial.html`. Consistencia y cero curva de aprendizaje.
3. **Donut (gráfico 2): color-por-categoría + semáforo en leyenda.** Los segmentos usan `categorias.color`; el estado de límite (verde <80%, ámbar 80–100%, rojo >100%) aparece como punto + texto en la leyenda junto al monto y %. Razón: una forma codifica una variable; colorear segmentos por límite genera colisión (3 categorías en rojo = indistinguibles) y rompe la convención de dashboards financieros.
4. **Estados por tarjeta:** cada gráfico tiene 3 estados — `cargando` (skeleton), `ok` (gráfico), `vacío` ("Sin movimientos este mes"), `error` ("No se pudo cargar"). Un gráfico que falle no tumba los otros 7.
5. **Umbral del mapa de calor: relativo al mes.** sin gasto = gris; ≤ media diaria = verde; > media = ámbar; > 2× media = rojo. Leyenda con la escala. Evita que un mes barato se vea todo rojo.
6. **Forecast (gráfico 8): semántica de color.** Línea sólida = progreso real (color de meta). Línea punteada = proyección: **verde** si proyecta alcanzar `monto_objetivo` antes de `fecha_limite`, **roja** si no.
7. **Accesibilidad:** cada `<canvas>` con `aria-label` descriptivo (los charts son invisibles a lectores de pantalla).

---

## Architecture

### `views/graficos.html` (archivo único, secciones aisladas)

```
graficos.html
├── <style>            tarjetas, grid responsive, heatmap CSS, dark/light vía custom props
├── markup             navegador mes/año + 8 tarjetas (cada una: título, descripción,
│                      contenedor de estado, <canvas> o grilla)
└── <script> IIFE (graficosView)
    ├── estado = { mes, anio }
    ├── charts = {}            registro de instancias Chart.js (para destroy)
    ├── capa datos:  cargarDatos()  → Promise.all de las consultas db.js
    ├── 8× render<N>(datos)    cada uno dibuja UN gráfico, recibe datos en memoria
    ├── setEstadoTarjeta(id, estado)   cargando|ok|vacio|error por tarjeta
    └── recargarTodo()         orquestador: skeleton → fetch → destroy → render×8
```

**Principio de aislamiento:** las 8 funciones `render<N>()` son independientes — reciben datos ya en memoria, no consultan Supabase, no se llaman entre sí. Cada una se entiende y depura sola.

### `js/db.js` — nuevo helper

```js
// getAportesPorMiembro(mes, anio) — aporte real al hogar por cada miembro en el mes,
// junto al esperado de su perfil. Para el gráfico "aporte real vs. esperado".
// Real = SUMA de transacciones con aporte_id != null, agrupado por user_id.
// Returns: [{ user_id, nombre, esperado, real }] (un elemento por perfil) o [].
// RLS: los perfiles del hogar y las transacciones de aporte son visibles entre miembros.
async function getAportesPorMiembro(mes, anio) { ... }
```

### `index.html`

- `<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>` en `<head>` (tras Supabase, antes de los scripts de app).
- Nav-link nuevo: `<a href="#graficos" class="nav-link">📊 Gráficos</a>` en la navbar (entre Historial y Metas).

---

## Mapeo gráfico → datos → fuente db.js

| # | Gráfico | Tipo | Datos | Fuente |
|---|---------|------|-------|--------|
| 1 | Evolución temporal | línea (2 series) | gastos+ingresos hogar del mes por día | `getTransacciones({ambito:'hogar', fecha_desde, fecha_hasta})` |
| 2 | Distribución categoría | donut | gasto por categoría (hogar) + `limite_mensual` + `color` | `getResumenMensual().porCategoria` + `getCategorias('gasto')` |
| 3 | Aporte real vs esperado | barras | esperado + real por miembro | `getAportesPorMiembro(mes,anio)` (nuevo) |
| 4 | Ahorro acumulado | línea | balance neto hogar, 6 meses | `getBalanceHogar(mes,anio)` ×6 |
| 5 | Mapa de calor | grilla CSS | gasto total por día del mes | `getTransacciones({ambito:'hogar', tipo:'gasto', fecha_desde, fecha_hasta})` |
| 6 | Flujo de caja | cascada (barras apiladas) | ingresos − cada categoría gasto → balance | `getResumenMensual(mes,anio)` |
| 7 | Comparativa mes a mes | barras agrupadas | top-5 categorías, actual vs anterior | `getResumenMensual(mes,anio)` + `getResumenMensual(mesAnt,anioAnt)` |
| 8 | Proyección metas | línea + forecast | progreso real + proyección por meta | `getMetas()` + `getAportesDeMeta(id)` por meta |

### Consultas compartidas (5 base, no 8)

- `getResumenMensual(mes,anio)` → gráficos **2, 6, 7**
- `getResumenMensual(mesAnterior)` → gráfico **7**
- `getTransacciones(hogar, mes)` → gráficos **1 y 5** (un fetch, dos transformaciones)
- `getBalanceHogar` ×6 → gráfico **4**
- `getCategorias('gasto')` → gráfico **2** (límites)
- `getAportesPorMiembro` → gráfico **3**
- `getMetas` + `getAportesDeMeta`×N → gráfico **8**

`cargarDatos()` lanza todas con `Promise.all` (no secuencial).

---

## Data Flow

```
selector ◀ ▶  →  estado.{mes,anio}  →  recargarTodo()
                                          │
                  1. setEstadoTarjeta(*, 'cargando')   // skeletons
                  2. datos = await cargarDatos()        // Promise.all
                  3. Object.values(charts).forEach(c => c.destroy())  // evita leaks
                  4. render1(datos)…render8(datos)      // cada uno try/catch
```

Gráficos 4/7/8 calculan sus propios rangos de meses dentro de `cargarDatos()`.

---

## Error Handling

| Nivel | Comportamiento |
|---|---|
| Consulta db.js falla | db.js ya devuelve `[]`/ceros (no lanza) → tarjeta muestra estado `vacio` |
| `render<N>()` lanza | try/catch en el orquestador → esa tarjeta a estado `error`, las demás siguen |
| Mes sin movimientos | dataset vacío → estado `vacio` "Sin movimientos este mes" |
| Chart.js no cargó (CDN) | guard `typeof Chart === 'undefined'` → todas las tarjetas de canvas a `error`; el mapa de calor (CSS) sigue funcionando |

---

## Tema oscuro/claro

Chart.js no hereda CSS. Cada `render<N>()` lee los colores desde las custom properties al dibujar:

```js
var css = getComputedStyle(document.documentElement);
var colorTexto = css.getPropertyValue('--text-primary').trim();
var colorBorde = css.getPropertyValue('--border').trim();
```

Como `recargarTodo()` redibuja todo, un cambio de tema se refleja al volver a renderizar. (El cambio de tema en vivo sin recargar queda fuera de alcance — YAGNI.)

---

## Responsive

- Móvil (<720px): una columna, tarjetas a ancho completo, canvas con altura fija (~240px).
- Desktop (≥720px): grilla de 2 columnas.
- Mapa de calor: grilla de 7 columnas (días de semana) en ambos.

---

## Out of Scope

- Cambio de tema en vivo sin recargar gráficos.
- Exportar gráficos a imagen/PDF.
- Interactividad avanzada (drill-down, zoom).
- Gráficos de ámbito personal (todos son de hogar salvo el 3, que es por miembro).
- Caché de datos entre navegaciones (cada entrada a la vista refetcha).

---

## Verificación (navegador, sin framework de tests)

- [ ] Los 8 gráficos renderizan sin errores en consola
- [ ] El navegador mes/año actualiza los 8 a la vez
- [ ] El mapa de calor muestra calendario (grilla CSS, no imagen)
- [ ] Las líneas punteadas del gráfico 8 son visibles y con color según proyección
- [ ] Un mes sin datos muestra estados "vacío", no canvas en blanco ni errores
- [ ] Modo oscuro y claro legibles en los 8
