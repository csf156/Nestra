# Design: Secciones Personal / Hogar en Gráficos

**Date:** 2026-06-07
**Status:** Approved
**Scope:** Añadir un toggle Hogar | Personal a `views/graficos.html` que cambia el ámbito de los datos y la selección de gráficos visibles.

---

## Context

`views/graficos.html` ya tiene 8 gráficos, todos hogar-céntricos, alimentados por `cargarDatos()` (sin parámetro de ámbito). El usuario quiere dos secciones: **Hogar** (los 8 actuales) y **Personal** (subconjunto que tiene sentido individual). No se añaden gráficos nuevos.

---

## Goal

Un toggle de ámbito en la vista. **Hogar** muestra los 8 gráficos con datos del hogar (comportamiento actual). **Personal** muestra 6 gráficos con datos personales del usuario activo. Cambiar de pestaña recarga datos y ajusta qué tarjetas se ven.

---

## Curación de gráficos

| # | Gráfico | Hogar | Personal | Razón si se omite en Personal |
|---|---------|:---:|:---:|---|
| 1 | Evolución temporal | ✅ | ✅ | |
| 2 | Donut categorías | ✅ | ✅ | |
| 3 | Aporte real vs esperado | ✅ | ❌ | Compara miembros entre sí — inherente a hogar |
| 4 | Ahorro acumulado | ✅ | ✅ | |
| 5 | Mapa de calor | ✅ | ✅ | |
| 6 | Flujo de caja | ✅ | ❌ | Ingresos-del-hogar menos categorías — poco útil a nivel individual |
| 7 | Comparativa mes a mes | ✅ | ✅ | |
| 8 | Proyección metas | ✅ (metas hogar) | ✅ (metas personales) | |

Hogar: 8. Personal: 6 (oculta tarjetas 3 y 6).

---

## UI

- **Toggle segmentado** (control pill de 2 segmentos) **Hogar | Personal** bajo el header. Default **Hogar**. Patrón segmentado (no chips de filtro): comunica selección binaria mutuamente excluyente, no multi-filtro.
- `role="group"` en el contenedor; cada segmento es un `<button>` con `aria-pressed`. El segmento activo resaltado (fondo `--color-primary`, texto claro).
- Cambiar de pestaña: actualiza `estado.ambito`, oculta/muestra las tarjetas 3 y 6, dispara `recargarTodo()`.
- Las tarjetas 3 y 6 se ocultan con una clase CSS en el contenedor (`.graf--personal`), no se destruyen del DOM.

## Mobile-first & mejoras de interfaz

La vista ya es mobile-first (grid 1-columna por defecto, 2-columnas en `@media (min-width:720px)`). Se refuerza y se añaden mejoras de interfaz:

1. **Barra de controles sticky.** Header + toggle + navegador de mes viven en un contenedor `position: sticky; top: 0` con fondo del tema y leve sombra al hacer scroll. La página es larga (hasta 8 gráficos); en móvil esto mantiene mes y ámbito siempre alcanzables sin volver arriba. `z-index` sobre las tarjetas.
2. **Header apilado en móvil.** `<720px`: título, toggle y navegador de mes se apilan verticales a ancho completo (no `justify-between` que aprieta). El toggle ocupa el ancho completo (cada segmento 50%). Tap targets ≥44px.
3. **Transición de re-render.** Al recargar (toggle o mes), las tarjetas hacen un fade corto (opacity 0.5→1, ~150ms) para suavizar el swap de datos. Envuelto en `@media (prefers-reduced-motion: reduce)` → sin animación.
4. **Leyenda del donut sin overflow.** En móvil la leyenda va debajo del canvas (ya es `flex-direction: column`); textos largos con `overflow-wrap`.
5. **Navegador de mes táctil.** Botones ‹ › ya 36px → subir a 44px en móvil para cumplir el mínimo táctil.

Todas las mejoras son CSS + un toggle de clase; sin impacto en la capa de datos.

---

## Arquitectura

Cambios contenidos en `views/graficos.html`. Cero funciones nuevas en db.js (todo derivable de funciones existentes).

### Estado

```js
var estado = { mes: hoy.mes, anio: hoy.anio, ambito: 'hogar' };
```

### Capa de datos: `cargarDatos(ambito)`

Se ramifica por ámbito y devuelve **el mismo shape** `datos` que hoy, para que las 8 `render*()` no cambien.

**ambito === 'hogar'** (actual, sin cambios):
- `getTransacciones({ ambito:'hogar', fecha_desde, fecha_hasta })`
- `getResumenMensual(m,a)` y `getResumenMensual(mesAnterior)`
- `getCategorias('gasto')`
- `getAportesPorMiembro(m,a)`
- `getBalanceHogar ×6`
- `getMetas()` → filtrar `ambito === 'hogar'`

**ambito === 'personal'** (nuevo):
- `getTransacciones({ ambito:'personal', fecha_desde, fecha_hasta })` → RLS devuelve solo las del usuario activo. De aquí se derivan client-side:
  - `txMes` (para gráficos 1 y 5),
  - `porCategoria` del mes (suma por `categorias.nombre`, orden desc) → reemplaza `resumen.porCategoria`,
  - `porCategoria` del mes anterior: segunda llamada `getTransacciones({ambito:'personal'})` con el rango del mes previo → para el gráfico 7.
- `getCategorias('gasto')` (límites, compartidos).
- `getBalancePersonal ×6` → balance neto personal para el gráfico 4.
- `getMetas()` → filtrar `ambito === 'personal'`.
- Campos no usados en personal (`aportesMiembro`) van como `[]`.

> Nota: en personal, el "resumen" se sintetiza client-side con la forma mínima que consumen los renders: `{ hogar: {ingresos,gastos,balance}, porCategoria: [...] }`. El gráfico 6 (flujo de caja) no se renderiza en personal, así que su dependencia de `hogar.ingresos` no aplica.

### Render

- Las 8 `render*()` **no cambian** — son agnósticas, consumen `datos.*`.
- Renombrar `txHogarMes` → `txMes` en `datos` y en render1/render5 (cosmético; el nombre ya no es solo-hogar).
- `recargarTodo()` solo invoca los renders de las tarjetas visibles según ámbito (3 y 6 se saltan en personal, o se invocan y quedan ocultas — ver Error Handling).

### Toggle

```
chip click → estado.ambito = nuevo
           → aplicar clase de ámbito (oculta cards 3/6 si personal)
           → recargarTodo()
```

`recargarTodo()` ya tiene token-guard contra recargas concurrentes (cubre clicks rápidos de toggle + navegador de mes).

---

## Data Flow

```
toggle Hogar|Personal  ─┐
navegador ◀ ▶ mes      ─┤→ estado.{ambito,mes,anio} → recargarTodo()
                                                        │
            1. cards visibles según ámbito (3,6 ocultas en personal)
            2. setEstado(visibles, 'cargando')
            3. datos = await cargarDatos(estado.ambito)
            4. destroy charts previos
            5. render de las tarjetas visibles (try/catch por tarjeta)
```

---

## Error Handling

| Escenario | Comportamiento |
|---|---|
| Personal sin metas personales | gráfico 8 → estado `vacio` (ya manejado) |
| Personal sin movimientos | cada render → `vacio` |
| Cards 3/6 en personal | ocultas vía CSS; sus renders se saltan (no se invocan) para no crear charts invisibles |
| Recargas concurrentes (toggle + mes rápido) | token-guard existente descarta resultados obsoletos |

---

## Out of Scope

- Comparar los dos miembros entre sí dentro de Personal (eso es Hogar).
- Persistir la pestaña elegida entre navegaciones (cada entrada arranca en Hogar).
- Gráficos nuevos (descartados por el usuario).
- Helper `getResumenPersonal` en db.js (se deriva client-side; se anota como alternativa más limpia para el futuro).

---

## Verificación (navegador, sin framework de tests)

- [ ] Toggle Hogar|Personal visible, default Hogar
- [ ] En Hogar: 8 tarjetas, comportamiento idéntico al actual
- [ ] En Personal: 6 tarjetas (3 y 6 ocultas), datos personales del usuario activo
- [ ] Cambiar pestaña recarga sin errores en consola
- [ ] El navegador de mes sigue funcionando en ambas pestañas
- [ ] Gráfico 8 en personal muestra solo metas personales; en hogar solo metas hogar
- [ ] Modo oscuro/claro legible en ambas pestañas
