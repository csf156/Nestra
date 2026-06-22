# Fase 2 — Insights Engine (diseño)

Fecha: 2026-06-21 · Branch: `v2` · Estado: aprobado

## Objetivo

Motor que corre **en el cliente** (sin backend adicional), lee el historial de
los últimos **90 días** desde IndexedDB y genera **insights accionables**
analíticos: el diferenciador del producto. Se renderizan como **cards
horizontales scrolleables** en el dashboard.

Principio rector: **precisión primero**. Un insight equivocado destruye la
confianza más que la ausencia de uno. Ante la duda, no se genera el insight.

## Decisiones de alcance

- **Relación con `alerts.js`:** el Insights Engine es un motor **nuevo y
  separado**, solo analítico. NO toca el presupuesto/límite de categoría: esa
  alerta se queda **exclusivamente** en `alerts.js`. Cero duplicación.
- **Ámbito:** se analizan **ambos** ámbitos (`personal` y `hogar`); cada card
  indica su ámbito en el texto.
- **Stretch diferidos (fuera de v1):** "categoría nueva/reactivada" y
  "transacción atípica (outlier)".
- **Sin dismissal/persistencia:** las cards se recalculan en cada carga del
  dashboard. (No se guarda estado de "descartada".)
- **Sin ML:** proyecciones lineales simples.
- **Sin emojis:** los íconos usan el sistema del proyecto (sprite Tabler vía
  `iconoCategoria()`); el campo `icono` de cada insight es un **nombre Tabler**
  (string), no un emoji.

## Catálogo de insights (v1)

`hoy` se inyecta en cada detector (determinismo; sin `Date.now()` interno).
"Periodo actual" = últimos 30 días desde `hoy`; "baseline" = los 60 días
previos (días 31–90). Montos en soles (S/).

| # | Insight | tipo | ícono (Tabler) | Dispara cuando | Guards de precisión |
|---|---------|------|----------------|----------------|---------------------|
| 1 | Crecimiento de categoría | `warn` | `trending-up` | gasto de cat×ámbito en periodo actual ≥ **+25%** vs promedio mensual del baseline | baseline ≥ S/50 **y** ≥3 tx; ≥2 tx en actual; máx **top 2** |
| 2 | Caída de categoría | `good` | `trending-down` | misma métrica pero ≤ **−25%** | mismos guards que #1 |
| 3 | Día de semana anómalo | `info` | `calendar-stats` | gasto promedio de un weekday ≥ **1.8×** el promedio diario global (90d) | ≥6 ocurrencias del weekday con gasto; total 90d ≥ umbral mínimo (S/100) |
| 4 | Proyección de meta — en camino | `good` | `target-arrow` | ritmo de aporte proyecta alcanzar objetivo **≤ fecha_limite** | fecha_inicio pasada; monto_actual>0; ritmo>0; **no** fondo emergencia; tiene fecha_limite y monto_objetivo |
| 5 | Proyección de meta — atrasada | `warn` | `target-arrow` | ritmo proyecta pasar fecha_limite (o no alcanzar) | mismos que #4 (el color del `tipo` distingue) |
| 6 | Ritmo de gasto mensual | `warn`/`good` | `chart-line` | gasto proyectado a fin de mes (pace) se desvía **±15%** vs total del mes anterior (`warn` si sube, `good` si baja) | ≥5 días transcurridos del mes en curso; mes anterior con datos |
| 7 | Buen mes (mes cerrado) | `good` | `circle-check` | gasto del **mes calendario más reciente ya cerrado** < promedio de los meses cerrados previos **−15%** | ≥2 meses cerrados con datos (excluye el mes en curso) |

Nota: #7 mira el último mes **cerrado** (no el en curso) para no solaparse con #6
(que proyecta el mes en curso) y para comparar totales completos vs completos.

Reglas transversales de precisión:
- Nunca dividir por un baseline ~0 (los guards de monto mínimo lo impiden).
- Clamp de porcentajes mostrados (evitar "+9000%").
- Cualquier detector con datos insuficientes devuelve `[]` (no genera nada).

## Forma del insight

```js
{
  id,        // clave estable: `${tipo}:${sujeto}` (dedup + key de render)
  tipo,      // 'alert' | 'warn' | 'good' | 'info'
  icono,     // nombre Tabler (string), ej. 'trending-up'
  titulo,    // texto principal: "Delivery (personal) subió 42%"
  subtexto,  // cifras/contexto: "S/420 este mes vs S/295 tu promedio"
  accion,    // { label, href } | null   ej. { label:'Ver historial', href:'#historial' }
  score,     // number, para ordenar
  meta       // { ambito, categoria_id?, meta_id?, pct?, ... } debug/acción
}
```

- `icono` se renderiza con `iconoCategoria(insight.icono)` →
  `<svg><use href="assets/tabler-sprite.svg#tabler-NAME"></svg>`.
- El color/severidad sale de `tipo` vía clase CSS (igual que `alert-item--nivel`).
- `accion.href` enlaza a rutas existentes (`#historial`, `#metas`). Deep-link con
  filtros = best-effort; default a la ruta simple.

## Priorización

```
pesoTipo = { alert: 3, warn: 2, good: 1.5, info: 1 }
magnitud = normalizado 0..1 del delta principal del insight (% o S/)
score    = pesoTipo * (1 + magnitud)
```

Orden descendente por `score`; **cap a 6 cards**. A igual magnitud: warn antes
que good antes que info (lo cautelar/accionable primero).

## Arquitectura

`js/insights.js` — módulo ESM con patrón **dual-export** (como `sync-lww.js`):
`if (typeof window !== 'undefined') window.x = x;` + `export { x }`. Cargado en
`index.html` con `<script type="module" src="js/insights.js">`. Los tests lo
importan como ESM en Node.

Capas:
- **Detectores puros** (testeados con datos sintéticos):
  `detectCrecimiento`, `detectDiaAnomalo`, `detectProyeccionMeta`,
  `detectRitmoMensual`, `detectBuenMes`. Firma:
  `(datos, { hoy, ...umbrales })` → array de insights (o `[]`).
- **Helpers puros**: ventanas de fecha relativas a `hoy`; agrupar gasto por
  cat×ámbito; agrupar por weekday; sumas/promedios.
- **`priorizar(insights)`** puro: score + orden + cap.
- **`generarInsights({ transacciones, categorias, metas, hoy })`** puro:
  orquesta todos los detectores, prioriza, capa. No toca red ni DOM.
- **`cargarInsights()`** async, **única parte impura**: lee
  `getTransacciones() / getCategorias() / getMetas()`, recorta a 90 días,
  llama `generarInsights` con `hoy = new Date()`, devuelve el array.
  `try/catch` → `[]` (nunca tumba el dashboard).

Datos de entrada (ya disponibles, ver `js/db.js`):
- `transacciones`: `{ tipo:'gasto'|'ingreso'|'ahorro', ambito:'personal'|'hogar',
  categoria_id, monto, fecha:'YYYY-MM-DD', categorias:{ nombre, color, icono } }`.
  Los detectores analíticos usan principalmente `tipo === 'gasto'`.
- `categorias`: `{ id, nombre, tipo, color, icono, limite_mensual, estado }`.
- `metas` (vista `metas_con_progreso`): `{ id, nombre, ambito, monto_objetivo,
  monto_actual, fecha_limite, fecha_inicio, estado, es_fondo_emergencia }`.

El espejo IndexedDB ya guarda el set **completo** de transacciones (db.js hace
fetch sin filtro server-side), así que las 90 días de historia están
disponibles incluso offline.

## Render (dashboard) — mobile-first

- Nueva sección `#dashInsights` en `views/dashboard.html`, entre los balances y
  el panel de alertas. Se suma al `Promise.allSettled` de `cargar()`.
- `renderInsights(insights)` en el `<script>` de la vista (igual que
  `renderAlertas`). Si `insights` está vacío, la sección queda vacía (sin ruido).
- **Carrusel mobile-first:**
  - Contenedor: `display:flex; overflow-x:auto; scroll-snap-type:x mandatory;
    -webkit-overflow-scrolling:touch; gap`. Sangra a los bordes de pantalla en
    móvil (margin negativo + padding-inline) para swipe edge-to-edge.
  - Card: `flex:0 0 auto; width:min(85%, 300px)` en móvil → la siguiente card
    "asoma" como affordance de scroll; `scroll-snap-align:start`. En ≥600px se
    ven varias a la vez, mismo contenedor de scroll.
  - La acción (si existe) es un target táctil ≥44px.
  - Respeta `prefers-reduced-motion` (sin scroll animado forzado).
  - Ícono vía clase `cat-icono` (mismo tamaño que el resto de la app).
  - Color de la card / borde por `tipo` (clases `insight-card--warn`, etc.),
    reusando los tokens CSS existentes (`--color-warning`, `--color-success`,
    `--color-danger`, `--color-primary`).
- Escape de todo texto dinámico con el helper `esc()` ya presente en la vista.

## Estrategia de tests (TDD)

Un archivo `.test.mjs` por detector en `test/`, con fixtures sintéticas y `hoy`
fijo. Cobertura mínima por regla:
- **Dispara** correctamente sobre el caso central.
- **No dispara** bajo umbral o con datos insuficientes (guards).
- **Bordes**: arrays vacíos, una sola tx, baseline ~0 (sin div-by-zero),
  exactamente en el umbral.
- **Determinismo**: mismo `hoy` + mismos datos → mismo resultado.

Más:
- `test/insights-priorizar.test.mjs`: score, orden, cap a 6.
- `test/insights-generar.test.mjs`: integración pura del orquestador
  (varios detectores juntos, dedup, orden final).

Los tests corren con `node --test` (mismo harness que `test/sync-lww.test.mjs`:
`node:test` + `node:assert`, import ESM). `cargarInsights()` (impura) no se
unit-testea; su lógica de recorte a 90 días se cubre vía un helper puro testeado.

## Fuera de scope (YAGNI)

- Presupuesto/límite de categoría (queda en `alerts.js`).
- Dismissal/persistencia de cards.
- Forecasting/ML.
- Stretch diferidos: categoría nueva/reactivada, transacción atípica.
