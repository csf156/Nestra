# Design: Vista de Resumen Mensual (`views/resumen.html`)

**Date:** 2026-06-09
**Status:** Draft
**Scope:** `views/resumen.html` (nuevo). Ajuste menor en `js/export.js` (añadir `exportPDF`). Sin migración SQL.

---

## Context: capa de datos disponible

| Función | Retorna |
|---|---|
| `getResumenMensual(mes, anio)` | `{ hogar, personal, porCategoria }` |
| `getBalanceHogar(mes, anio)` | `{ ingresos, gastos, balance }` |
| `getBalancePersonal(mes, anio)` | `{ ingresos, gastos, aporte_realizado, balance }` |
| `getCategorias('gasto')` | `[{ id, nombre, tipo, limite_mensual, color }]` |
| `getMetas()` | `[{ id, nombre, estado, fecha_limite, monto_objetivo, monto_actual, ambito, ... }]` |
| `getTransacciones({ fecha_desde, fecha_hasta })` | array de transacciones (para exportar) |
| `exportador.exportXLSX(transacciones)` | descarga .xlsx |

### Gaps detectados

**Gap 1 — `limite_mensual` ausente en `porCategoria`:**
`getResumenMensual.porCategoria` retorna `{ categoria_id, nombre, total }` sin `limite_mensual`.
→ **Fix cliente:** también llamar `getCategorias('gasto')` y hacer join por `id === categoria_id`.

**Gap 2 — `fecha_completada` inexistente en `metas`:**
La tabla `metas` / vista `metas_con_progreso` no almacena fecha de completado.
→ **Proxy:** "Metas completadas ese mes" = `estado === 'completada'` y `fecha_limite` en el mes seleccionado.
→ "Metas vencidas" = `fecha_limite` ≤ fin del mes seleccionado y `estado !== 'completada'`.
Excepción: si el mes seleccionado es futuro, no hay vencidas.

**Gap 3 — `exportPDF` inexistente en `export.js`:**
`exportador` solo expone `exportXLSX`. Añadir `exportPDF()` basado en `window.print()` con
`@media print` CSS en el view.
→ **Plan Task 1:** añadir `exportPDF` a `js/export.js`.

---

## Mejoras UX aplicadas

### Selector de mes — arrows en lugar de dropdowns
- Control `◀  Junio 2026  ▶` en lugar de `<select>` mes + `<select>` año.
- Más ergonómico en móvil (target táctil grande, un gesto lineal).
- `▶` deshabilitado visualmente cuando el mes seleccionado = mes actual.
- Label del mes en texto (`Junio 2026`) — no valor numérico.

### KPI cards coloreadas + delta badge
- Tres cards (Ingresos / Gastos / Balance) en grilla `3-col` tablet+, `1-col scrollable` móvil.
- Balance: texto verde si positivo, rojo/ámbar si negativo.
- Delta badge bajo cada valor: `↑ +12 %` (verde) / `↓ -8 %` (rojo) / `= 0 %` (neutro).
- Si mes previo = 0, delta = "—" (sin variación calculable).

### Sección categorías — lista con barra de progreso (no tabla en móvil)
- Móvil: tarjeta por categoría con `<progress>`-style bar de `% del límite`.
- Tablet+: tabla con columnas Categoría / Gasto / Límite / % / vs. anterior.
- Semáforo con texto: `< 70 %` → verde "Bien", `70–99 %` → ámbar "Cerca", `≥ 100 %` → rojo "Excedido".
- Texto + color (no solo color) — accesibilidad WCAG.
- Sin límite definido: grupo separado al fondo "Sin límite", sin barra.
- Orden: excedidas primero → cerca → bien → sin límite; dentro de cada grupo por gasto desc.

### Metas — dos grupos con badge de conteo
- Dos sub-secciones colapsables: **Completadas (N)** / **Vencidas (N)**.
- Si ambas N=0 → estado vacío "Sin metas con vencimiento este mes".
- Completadas muestran: nombre, monto objetivo, % progreso.
- Vencidas muestran: nombre, fecha límite formateada, % progreso (para ver qué tan cerca estaba).

### Exportación — lazy load + toast de feedback
- Transacciones del mes se cargan **solo al pulsar** el botón (no en el `cargar()` inicial).
- Toast: "Exportando..." → éxito "Descargado" / error "Sin datos para exportar".
- PDF: `exportador.exportPDF()` → `window.print()` con print-CSS limpio (sin nav, sin botones).
- Botones lado a lado; PDF secundario (btn-secondary), XLSX primario (btn-primary).

---

## Estructura del markup

```
.resumen
├── .resumen-header              h1 "Resumen mensual"
├── .resumen-nav-mes             ◀ btn  |  span "Junio 2026"  |  ▶ btn
├── #resLoading                  spinner inicial
│
├── section #resHogarSection     Sección 1 — Resumen del hogar
│   ├── h2 "Hogar"
│   └── .res-kpi-grid            3 cards: Ingresos / Gastos / Balance
│
├── section #resPersonalSection  Sección 2 — Tu resumen personal
│   ├── h2 "Tu resumen"
│   └── .res-kpi-grid            4 cards: Ingresos / Gastos / Aporte / Balance
│
├── section #resCatSection       Sección 3 — Por categorías
│   ├── h2 "Por categorías"
│   ├── .res-cat-lista           tarjetas móvil (visible < 768px)
│   ├── .res-cat-tabla-wrap      tabla desktop (visible ≥ 768px)
│   └── p #resCatVacio
│
├── section #resMetasSection     Sección 4 — Metas del mes
│   ├── h2 "Metas"
│   ├── .res-metas-grupo
│   │   ├── button .res-grupo-toggle  "Completadas (N)"  aria-expanded
│   │   └── .res-grupo-panel          lista de metas
│   ├── .res-metas-grupo
│   │   ├── button .res-grupo-toggle  "Vencidas (N)"     aria-expanded
│   │   └── .res-grupo-panel
│   └── p #resMetasVacio
│
└── .resumen-export              Botones export (PDF secundario | XLSX primario)
```

---

## Lógica JS (IIFE)

### Estado interno
```js
var _mes  = new Date().getMonth() + 1;   // 1–12
var _anio = new Date().getFullYear();
var _txExport = null;   // lazy; null hasta primer click export
```

### cargar(mes, anio)
```
1. Mostrar spinner, ocultar secciones
2. Calcular mesPrev / anioPrev (mes anterior, wrapping diciembre→noviembre)
3. Promise.all([
     getResumenMensual(mes, anio),
     getResumenMensual(mesPrev, anioPrev),
     getCategorias('gasto'),
     getMetas(),
   ])
4. Enriquecer porCategoria con limite_mensual desde getCategorias
5. renderHogar(actual.hogar, prev.hogar)
6. renderPersonal(actual.personal, prev.personal)
7. renderCategorias(catEnriquecidas)
8. renderMetas(metas, mes, anio)
9. Ocultar spinner, mostrar secciones
_txExport = null   // invalidar cache export al cambiar mes
```

### renderHogar(actual, prev)
```
KPI: { label, valor, prevValor, signo }[]
signo: 'positivo' para Ingresos/Balance positivo, 'negativo' para Gastos/Balance negativo
delta(actual, prev) = prev === 0 ? null : ((actual - prev) / prev) * 100
```

### renderCategorias(lista)
```
Cada item: { categoria_id, nombre, total, limite_mensual, totalPrev }
nivel(pct) → 'bien' | 'cerca' | 'excedido' | 'sin-limite'
Ordenar: excedido → cerca → bien → sin-limite; dentro: total desc
Mobile card: nombre + monto + barra + badge texto
Desktop row: nombre | monto | límite | barra + % | delta vs anterior
```

### renderMetas(lista, mes, anio)
```
finMes = último día de mes/anio
completadas = lista.filter(m => m.estado === 'completada' &&
              m.fecha_limite >= primerDia && m.fecha_limite <= finMes)
vencidas    = lista.filter(m => m.estado !== 'completada' &&
              m.fecha_limite && m.fecha_limite <= finMes)
```

### Navegación de mes
```
◀ click → _mes--; si _mes < 1: _mes=12, _anio--
▶ click → si NO en mes actual: _mes++; si _mes > 12: _mes=1, _anio++
Deshabilitar ▶ cuando _mes === hoy.mes && _anio === hoy.anio
Actualizar label "Mes Año" en español
cargar(_mes, _anio)
```

### Export lazy
```
async handleExportXLSX():
  if (!_txExport) _txExport = await getTransacciones({ fecha_desde, fecha_hasta })
  resultado = exportador.exportXLSX(_txExport)
  toast según resultado.ok

handleExportPDF():
  exportador.exportPDF()   // window.print()
```

---

## Task 1 — Añadir `exportPDF` a `js/export.js`

```js
// exportPDF() — abre diálogo de impresión del navegador.
// El view resumen.html incluye @media print CSS para layout limpio.
// Returns: undefined (el navegador maneja el flujo).
function exportPDF() {
  window.print();
}

// Exponer en el objeto público:
return { exportXLSX: exportXLSX, exportPDF: exportPDF };
```

---

## Task 2 — `views/resumen.html`

Ver estructura arriba. CSS scoped `.resumen`. IIFE `var`. Mobile-first.

### CSS @media print (en el `<style>` del view)
```css
@media print {
  nav, .resumen-nav-mes, .resumen-export,
  #resLoading, .prest-toast { display: none !important; }
  .resumen { padding: 0; max-width: 100%; }
  .res-kpi-card, .res-cat-card { break-inside: avoid; }
  .res-cat-lista { display: block; }
  .res-cat-tabla-wrap { display: block; }
}
```

---

## Tokens y helpers disponibles

- `formatMonto(n)` → `"S/ 1,234.56"`
- `formatFecha(iso)` → `"DD/MM/YYYY"`
- CSS: `--color-primary`, `--text-secondary`, `--bg-light-secondary`, `--border-light`, `--radius-*`, `--space-*`, `--shadow-*`
- `color-mix(in srgb, #22c55e 15%, transparent)` para verde; ámbar `#f59e0b`; rojo `var(--color-danger, #ef4444)`

---

## Manejo de errores

| Escenario | Comportamiento |
|---|---|
| `getResumenMensual` falla | Secciones muestran zeros; toast error |
| `getCategorias` falla | Tabla sin barras de progreso; límites = `null` |
| `getMetas` falla | Sección 4 con estado vacío |
| Export sin datos | Toast "Sin transacciones en [Mes Año]" |
| Mes seleccionado sin transacciones | KPIs en S/ 0.00; vacíos en tabla y metas |

---

## Out of scope

- Drill-down a transacciones al tocar una categoría (tarea futura).
- Gráficos / visualizaciones avanzadas (vive en `views/graficos.html`).
- Añadir Resumen al sidebar (decisión de navegación aparte).
- Edición de límites desde esta vista.

---

## Verificación

- [ ] Selector ◀▶ cambia mes, recarga datos; ▶ bloqueado en mes actual.
- [ ] Sección 1 y 2 muestran valores correctos con delta vs. mes anterior.
- [ ] Categorías excedidas aparecen primero; semáforo muestra texto + color.
- [ ] Categorías sin límite agrupadas al fondo sin barra.
- [ ] Metas completadas y vencidas del mes filtradas correctamente.
- [ ] Export XLSX descarga archivo con transacciones del mes seleccionado.
- [ ] Export PDF abre diálogo de impresión sin nav ni botones.
- [ ] Sin transacciones: zeros en KPIs, vacío en categorías, vacío en metas.
- [ ] Móvil: sin overflow horizontal; cards legibles.
