# Fase 2 — Safe-to-spend + Insight de préstamos (partes faltantes)

Fecha: 2026-06-24 · Branch: `v2`

## Contexto

La Fase 2 (Insights Engine) ya se implementó parcialmente (`js/insights.js`): detectores
`detectCrecimiento`, `detectDiaAnomalo`, `detectProyeccionMeta`, `detectRitmoMensual`,
`detectBuenMes`, más `priorizar`/`generarInsights`/`cargarInsights`. Al guiarse con un
documento desactualizado se omitieron dos entregables de la guía completa:

1. **Safe-to-spend diario** — el número hero más visible de la app ("¿cuánto puedo gastar hoy?").
2. **Insight de préstamos** — préstamos dados sin cobro tras N días.

Este spec cubre solo esas dos piezas. No se duplica ninguna función existente.

## Decisiones de diseño (confirmadas)

- **Ámbito del safe-to-spend:** solo **personal** (dinero que el usuario controla día a día).
- **Gastos fijos:** se **infieren del historial** (no hay flag de esquema; no se agrega).
- **Aporte a metas:** se **deriva del plan** `(objetivo − actual) / meses restantes`.
- **Préstamos:** solo **dados** (campo `deudor`). La simetría (deudas que el usuario debe)
  se **difiere**: el esquema `prestamos` no la modela y requiere migración + UI de captura.

## Parte A — Safe-to-spend

### Módulo

Archivo nuevo **`js/safe-to-spend.js`**, mismo patrón que `insights.js`:
- Pura y determinista: `calcularSafeToSpend(transacciones, metas, { hoy })`. Sin `Date.now()`
  interno, sin red, sin DOM. `hoy` siempre inyectado.
- Única parte impura: `cargarSafeToSpend()` — lee `getTransacciones`/`getMetas` (globales
  window), recorta a 90 días con `filtrarVentana` (reutiliza la de insights vía window) y
  delega en la pura. try/catch → `null`.
- Dual-export: `window.*` en navegador + `export {}` para tests. Cargar en `index.html` con
  `<script type="module">` después de `insights.js`.

`calcularSafeToSpend` solo usa **transacciones de ámbito `personal`**. Periodo = mes
calendario de `hoy`.

### Fórmula

```
S2S_hoy = (ingresoEstimado − gastoAcumulado − fijosComprometidos − aporteMetasRestante) / díasRestantes
```

| Término | Definición |
|---|---|
| `díasDelMes` | días del mes calendario de `hoy` |
| `díasRestantes` | `díasDelMes − hoy.getDate() + 1` (incluye hoy; siempre ≥ 1) |
| `ingresoEstimado` | `max(ingresoPersonalMesActual, baselineIngreso)` |
| `baselineIngreso` | promedio del ingreso personal de los últimos hasta 3 meses **cerrados** (meses con `ym < ymActual`). Si no hay meses cerrados → 0 |
| `gastoAcumulado` | suma de **todos** los gastos personales del mes actual (`tipo='gasto'`, ámbito personal). Incluye fijos ya pagados y variable ya gastado |
| `fijosComprometidos` | Σ sobre categorías fijas de `max(0, estimadoMensual − gastadoEnCatEsteMes)`. Solo el remanente fijo aún no pagado. **No** prorrateado (conservador: el alquiler sale completo) |
| `aporteMetasRestante` | Σ sobre metas personales en curso (no fondo emergencia) de `planMensual × (díasRestantes / díasDelMes)`, con `planMensual = max(0, (objetivo − actual)) / mesesRestantesHastaLimite` |

### Inferencia de "categoría fija"

Sin cambio de esquema. Sobre los gastos personales de los **3 meses calendario cerrados**
previos al mes actual (`ym < ymActual`, descendente, máx 3):

1. Agrupar por `categoria_id`; por cada mes y categoría, el total gastado.
2. Una categoría es **fija** si tiene gasto en **≥ 2** de esos meses cerrados.
3. `estimadoMensual(cat)` = **mediana** de los totales mensuales de esa categoría en los
   meses (de los 3 cerrados) en que apareció.
4. `gastadoEsteMes(cat)` = gasto personal del mes actual en esa categoría.
5. `comprometidoRestante(cat) = max(0, estimadoMensual − gastadoEsteMes)`.
6. `fijosComprometidos = Σ comprometidoRestante`.

Usuario nuevo (< 1 mes cerrado) → no se infiere ninguna fija → `fijosComprometidos = 0`.
El número sigue siendo útil (ingreso − gastado − metas).

### Aporte planificado a metas (puro, sin `getAporteMetaMes`)

Por cada meta `personal`, `estado='en_curso'`, `!es_fondo_emergencia`, con `monto_objetivo > 0`,
`fecha_limite` válida y futura:
- `restante = max(0, objetivo − actual)`.
- `mesesRestantes = max(1, ceil(díasHastaLimite / 30))`.
- `planMensual = restante / mesesRestantes`.
- aporte de la meta este mes (lo aún por reservar) = `planMensual × (díasRestantes / díasDelMes)`.

`monto_actual` ya refleja aportes hechos, así que `objetivo − actual` es el verdadero
faltante; no se necesita historial de aportes mensuales → función pura sobre `(metas, hoy)`.

### Guardas de precisión (un número malo mata la confianza)

- Si `ingresoEstimado ≤ 0` → **no mostrar hero** (`calcularSafeToSpend` → `null`).
- Si numerador `< 0` → devolver `{ estado: 'excedido', exceso: |numerador|, diario: 0 }`
  para render tipo "Te pasaste por S/X este mes", nunca un número negativo crudo.
- Numerador `≥ 0` → `{ estado: 'ok', diario: numerador/díasRestantes, restanteMes: numerador }`.
- Todos los términos guardados a `≥ 0` donde aplica; nunca dividir entre ~0 (`díasRestantes ≥ 1`).
- Montos redondeados a entero S/ con el mismo `fmtS` que insights.

### Contrato de retorno

```js
// null  → no mostrar
// { estado:'ok',       diario:Number, restanteMes:Number, díasRestantes:Number }
// { estado:'excedido', exceso:Number,  díasRestantes:Number }
```

## Parte B — Insight de préstamos (en `insights.js`)

Detector nuevo `detectPrestamosSinCobro(prestamos, { hoy, diasUmbral = 30 })`:

- Entrada: filas de `getPrestamos('pendiente')` con `transacciones` embebido
  (`{ fecha, monto, ambito, nota }`) y `deudor`.
- Filtrar `estado === 'pendiente'` y con `transacciones.fecha` válida.
- Agrupar por `deudor` (texto): sumar `monto`, tomar la fecha **más antigua** → días
  transcurridos máximos `floor((hoy − fecha)/86400000)`.
- Por cada deudor con `días > diasUmbral` emitir:
  - `tipo:'warn'`, `icono:'cash'`,
  - `titulo: 'Te deben S/X'` (X = suma del deudor),
  - `subtexto: 'N días sin cobrar a [persona]'`,
  - `accion: { label:'Ver préstamos', href:'#prestamos' }`,
  - `meta: { deudor, dias, monto, magnitud: min(1, dias/90) }`,
  - `id: 'prestamo:' + deudor`.
- Ordenar por `monto × días` desc; el `cap` global de `priorizar` limita el total.
- Sin datos / nadie supera el umbral → `[]`.

### Threading

- `generarInsights(datos)` acepta `datos.prestamos` (default `[]`) y llama
  `detectPrestamosSinCobro(prestamos, opts)` dentro del mismo patrón `corre()` con try/catch.
- `cargarInsights()` añade `getPrestamos('pendiente')` al `Promise.all` y lo pasa a
  `generarInsights`. Los préstamos **no** se recortan por `filtrarVentana` (un préstamo viejo
  sin cobrar es precisamente lo que se quiere detectar).

## Parte C — Render en dashboard

`views/dashboard.html`:

- Nueva sección **hero** entre el saludo (`.dash-hero`) y `.dash-balances`:
  ```html
  <section id="dashSafeToSpend" class="dash-s2s" aria-live="polite"></section>
  ```
- Estilos `.dash-s2s` propios (no `.insight-card`): número grande (`--font-size-2xl`+,
  `--font-display`), label "Puedes gastar hoy", subtexto con periodo y restante del mes.
  Estado `excedido` usa color `--color-danger` y copy "Te pasaste por S/X este mes".
  Si el loader devuelve `null` → sección vacía (no se muestra nada).
- `cargarSafeToSpend()` se añade al `Promise.allSettled` de `cargar()`; nuevo
  `renderSafeToSpend(res)` (oculta si `null`/rejected).
- Préstamos no requiere render nuevo: entra por `renderInsights` (carrusel existente).

`index.html`: añadir `<script type="module" src="js/safe-to-spend.js">` tras `insights.js`.

`sw.js`: añadir `js/safe-to-spend.js` a la precache list + bump de versión del shell.

## Pruebas (TDD)

- `test/safe-to-spend-*.test.mjs`: díasRestantes; baseline de ingreso (incl. bug día-1);
  inferencia de fija (≥2 meses, mediana); comprometido = remanente no pagado; aporte metas
  prorrateado; estado `ok`/`excedido`/`null`; sin historial.
- `test/insights-prestamos.test.mjs`: agrupación por deudor; umbral; fecha más antigua;
  multi-deudor ordenado; vacío bajo umbral.
- Correr: `node --test "test/*.test.mjs"` (glob entre comillas — Windows/Node).

## No-objetivos

- No se modifica el esquema (`prestamos`, `categorias`, `transacciones`, `metas`).
- No se tocan los detectores existentes ni `alerts.js` (presupuesto sigue ahí).
- Simetría de deudas propias: deuda técnica documentada, fase futura.

## Deuda técnica registrada

Para insight simétrico de **deudas que el usuario debe pagar** se necesita: dirección
(`dada`/`recibida`) en `prestamos` o tabla nueva + UI de captura. Fuera de alcance de Fase 2.
