# Gráficos Financieros (8) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir `views/graficos.html` con 8 gráficos financieros que reaccionan a un navegador mes/año único.

**Architecture:** Archivo único con secciones aisladas: estilos, markup de 8 tarjetas, e IIFE con capa de datos (`cargarDatos()` → `Promise.all` de funciones db.js), orquestador (`recargarTodo()`) y 8 funciones `render<N>()` independientes. Chart.js se carga una vez en `index.html`; el mapa de calor usa grilla CSS pura. Un helper nuevo `getAportesPorMiembro()` se añade a db.js.

**Tech Stack:** Vanilla JS (ES5-IIFE en la vista, ES6 en db.js), Supabase vía db.js, Chart.js (CDN), sin framework de tests — verificación en navegador con preview tools.

**Reference spec:** `docs/superpowers/specs/2026-06-07-graficos-financieros-design.md`

**Convenciones del proyecto (ya verificadas):**
- Helpers globales: `mesActual()` → `{mes, anio}` (mes 1-based); `nombreMes(mes,anio)` → `"Junio 2026"`; `formatMonto(n)` → `"S/ 1,234.56"`.
- db.js: `getTransacciones({ambito, tipo, fecha_desde, fecha_hasta})`; `getResumenMensual(mes,anio)` → `{hogar:{ingresos,gastos,balance}, personal, porCategoria:[{categoria_id,nombre,total}]}`; `getCategorias('gasto')` → `[{nombre, color, limite_mensual, ...}]`; `getBalanceHogar(mes,anio)` → `{ingresos,gastos,balance}`; `getProfiles()` → `[{user_id, nombre, aporte_mensual_esperado}]`; `getMetas()` → `metas_con_progreso [{nombre, ambito, monto_objetivo, monto_actual, fecha_limite, fecha_inicio}]`; `getAportesDeMeta(id)` → `[{monto, created_at, transacciones}]`.
- CSS tokens: `--text-dark`, `--text-secondary`, `--bg-light`, `--bg-light-secondary`, `--border-light`, `--color-primary` (#059669), `--color-success` (#10b981), `--color-warning` (#f59e0b), `--color-danger` (#ef4444), `--space-*`, `--radius-*`, `--font-size-*`, `--shadow-*`.
- Router: ruta `graficos` ya existe en `js/router.js`. El router re-ejecuta scripts inline de la vista (`executeScripts`).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `index.html` | Carga de scripts + nav | Chart.js CDN en `<head>`; nav-link "📊 Gráficos" |
| `js/db.js` | Capa de datos | Nuevo `getAportesPorMiembro(mes,anio)` |
| `views/graficos.html` | Vista 4 — los 8 gráficos | **Nuevo**: estilos, markup, IIFE (datos + orquestador + 8 render) |

---

### Task 1: Cargar Chart.js + nav-link + helper db.js

**Files:**
- Modify: `index.html` (`<head>` y navbar)
- Modify: `js/db.js` (nuevo helper tras `getProfiles`)

- [ ] **Step 1: Añadir Chart.js CDN en index.html**

En `index.html`, localizar el `<script>` del CDN de SheetJS (`xlsx@0.18.5`). Añadir Chart.js inmediatamente después:

```html
    <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

- [ ] **Step 2: Añadir nav-link en la navbar**

En `index.html`, localizar el nav-link de Historial (`<a href="#historial" class="nav-link">`). Añadir el de Gráficos inmediatamente después de su `</a>` de cierre, replicando la estructura del link de Historial (mismo markup, cambiando href, ícono y texto a `#graficos`, `📊`, `Gráficos`):

```html
                    <a href="#graficos" class="nav-link">
                        <span class="nav-icon" aria-hidden="true">📊</span>
                        <span class="nav-text">Gráficos</span>
                    </a>
```

> Nota: si el markup real del link de Historial difiere (clases/estructura de íconos), COPIAR esa estructura exacta y solo cambiar href/ícono/texto. No inventar clases.

- [ ] **Step 3: Añadir getAportesPorMiembro a db.js**

En `js/db.js`, tras la función `getProfiles()` (termina ~línea 461), insertar:

```js
// getAportesPorMiembro(mes, anio) — aporte real al hogar por cada miembro en el
// mes dado, junto al esperado de su perfil. Para el gráfico "aporte real vs. esperado".
// Real = SUMA de transacciones con aporte_id != null en el mes, agrupado por user_id.
// Returns: [{ user_id, nombre, esperado, real }] (un elemento por perfil) o [].
// RLS: perfiles del hogar y transacciones de aporte visibles entre miembros.
async function getAportesPorMiembro(mes, anio) {
  try {
    const { desde, hasta } = _rangoMes(mes, anio);
    const [profiles, txs] = await Promise.all([
      getProfiles(),
      supabase
        .from('transacciones')
        .select('user_id, monto, aporte_id')
        .not('aporte_id', 'is', null)
        .gte('fecha', desde)
        .lte('fecha', hasta),
    ]);
    if (txs.error) throw txs.error;

    const realPorUser = new Map();
    (txs.data || []).forEach((t) => {
      realPorUser.set(t.user_id, (realPorUser.get(t.user_id) || 0) + Number(t.monto));
    });

    return (profiles || []).map((p) => ({
      user_id: p.user_id,
      nombre: p.nombre,
      esperado: Number(p.aporte_mensual_esperado) || 0,
      real: realPorUser.get(p.user_id) || 0,
    }));
  } catch (err) {
    console.error('Error en getAportesPorMiembro():', err.message || err);
    return [];
  }
}
```

- [ ] **Step 4: Verificar carga sin errores**

Iniciar preview (`preview_start` con config `nestra`). Vía `preview_eval`: `typeof Chart` → debe ser `"function"`. Vía `preview_eval`: `typeof getAportesPorMiembro` → `"function"`. Revisar `preview_console_logs` (level error): cero errores.

- [ ] **Step 5: Commit**

```bash
git add index.html js/db.js
git commit -m "feat(graficos): load Chart.js, add nav-link and getAportesPorMiembro helper"
```

---

### Task 2: Fundación de la vista — scaffold, estados, orquestador, capa de datos

**Files:**
- Create: `views/graficos.html`

Crea la vista completa con: estilos, markup de 8 tarjetas (cada una con contenedor de estado + `<canvas>` o grilla), e IIFE con `estado`, `charts{}`, helpers, `cargarDatos()` (fetch de TODO), `recargarTodo()` y 8 stubs `render<N>()` que por ahora ponen la tarjeta en estado `vacio`. Los gráficos reales se implementan en las Tasks 3–10.

- [ ] **Step 1: Crear views/graficos.html con el scaffold completo**

```html
<div class="graf">
  <header class="graf-header">
    <div>
      <h1 class="graf-title">Gráficos</h1>
      <p class="graf-sub">Análisis financiero del hogar</p>
    </div>
    <div class="graf-month" role="group" aria-label="Periodo">
      <button type="button" class="graf-month-nav" id="grafMesPrev" aria-label="Mes anterior">‹</button>
      <span class="graf-month-label" id="grafMesLabel" aria-live="polite">—</span>
      <button type="button" class="graf-month-nav" id="grafMesNext" aria-label="Mes siguiente">›</button>
    </div>
  </header>

  <div class="graf-grid">
    <!-- 1 -->
    <section class="graf-card" id="card1">
      <h2 class="graf-card-title">Evolución temporal</h2>
      <p class="graf-card-desc">Gastos e ingresos del hogar, acumulados por día.</p>
      <div class="graf-state" data-card="1"></div>
      <div class="graf-canvas-wrap"><canvas id="chart1" aria-label="Gráfico de evolución temporal de gastos e ingresos"></canvas></div>
    </section>
    <!-- 2 -->
    <section class="graf-card" id="card2">
      <h2 class="graf-card-title">Distribución por categoría</h2>
      <p class="graf-card-desc">Gasto del hogar por categoría, con estado de límite.</p>
      <div class="graf-state" data-card="2"></div>
      <div class="graf-donut-wrap">
        <div class="graf-canvas-wrap"><canvas id="chart2" aria-label="Distribución de gasto por categoría"></canvas></div>
        <ul class="graf-legend" id="legend2"></ul>
      </div>
    </section>
    <!-- 3 -->
    <section class="graf-card" id="card3">
      <h2 class="graf-card-title">Aporte real vs. esperado</h2>
      <p class="graf-card-desc">Aporte al hogar de cada miembro este mes.</p>
      <div class="graf-state" data-card="3"></div>
      <div class="graf-canvas-wrap"><canvas id="chart3" aria-label="Aporte real frente a esperado por miembro"></canvas></div>
    </section>
    <!-- 4 -->
    <section class="graf-card" id="card4">
      <h2 class="graf-card-title">Ahorro acumulado</h2>
      <p class="graf-card-desc">Balance neto del hogar en los últimos 6 meses.</p>
      <div class="graf-state" data-card="4"></div>
      <div class="graf-canvas-wrap"><canvas id="chart4" aria-label="Tendencia de ahorro acumulado"></canvas></div>
    </section>
    <!-- 5 -->
    <section class="graf-card" id="card5">
      <h2 class="graf-card-title">Mapa de calor de gastos</h2>
      <p class="graf-card-desc">Intensidad de gasto por día del mes.</p>
      <div class="graf-state" data-card="5"></div>
      <div class="graf-heatmap" id="heatmap5"></div>
      <div class="graf-heatmap-legend" id="heatmapLegend5"></div>
    </section>
    <!-- 6 -->
    <section class="graf-card" id="card6">
      <h2 class="graf-card-title">Flujo de caja</h2>
      <p class="graf-card-desc">De ingresos a balance, restando cada categoría.</p>
      <div class="graf-state" data-card="6"></div>
      <div class="graf-canvas-wrap"><canvas id="chart6" aria-label="Flujo de caja mensual"></canvas></div>
    </section>
    <!-- 7 -->
    <section class="graf-card" id="card7">
      <h2 class="graf-card-title">Comparativa mes a mes</h2>
      <p class="graf-card-desc">Top 5 categorías: este mes vs. el anterior.</p>
      <div class="graf-state" data-card="7"></div>
      <div class="graf-canvas-wrap"><canvas id="chart7" aria-label="Comparativa de gasto por categoría entre meses"></canvas></div>
    </section>
    <!-- 8 -->
    <section class="graf-card graf-card--wide" id="card8">
      <h2 class="graf-card-title">Proyección de metas</h2>
      <p class="graf-card-desc">Progreso real y proyección hacia cada objetivo.</p>
      <div class="graf-state" data-card="8"></div>
      <div class="graf-canvas-wrap"><canvas id="chart8" aria-label="Proyección de metas"></canvas></div>
    </section>
  </div>
</div>

<style>
  .graf { max-width: 1100px; margin: 0 auto; padding: var(--space-lg) var(--space-md) var(--space-xl); }
  .graf-header { display: flex; justify-content: space-between; align-items: center; gap: var(--space-md); flex-wrap: wrap; margin-bottom: var(--space-lg); }
  .graf-title { font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); color: var(--text-dark); margin: 0; }
  .graf-sub { color: var(--text-secondary); font-size: var(--font-size-sm); margin: 2px 0 0; }
  .graf-month { display: flex; align-items: center; gap: var(--space-sm); }
  .graf-month-nav { width: 36px; height: 36px; border-radius: var(--radius-md); border: 1px solid var(--border-light); background: var(--bg-light); color: var(--text-dark); font-size: var(--font-size-xl); cursor: pointer; line-height: 1; }
  .graf-month-nav:hover { background: var(--bg-light-secondary); }
  .graf-month-label { min-width: 130px; text-align: center; font-weight: var(--font-weight-semibold); color: var(--text-dark); }

  .graf-grid { display: grid; grid-template-columns: 1fr; gap: var(--space-lg); }
  @media (min-width: 720px) { .graf-grid { grid-template-columns: 1fr 1fr; } .graf-card--wide { grid-column: 1 / -1; } }

  .graf-card { background: var(--bg-light); border: 1px solid var(--border-light); border-radius: var(--radius-lg); padding: var(--space-lg); box-shadow: var(--shadow-sm); position: relative; }
  .graf-card-title { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); color: var(--text-dark); margin: 0; }
  .graf-card-desc { font-size: var(--font-size-xs); color: var(--text-secondary); margin: 2px 0 var(--space-md); }
  .graf-canvas-wrap { position: relative; height: 240px; }
  .graf-card--wide .graf-canvas-wrap { height: 300px; }

  /* Estados */
  .graf-state { display: none; align-items: center; justify-content: center; min-height: 240px; color: var(--text-secondary); font-size: var(--font-size-sm); text-align: center; }
  .graf-card[data-estado="cargando"] .graf-state,
  .graf-card[data-estado="vacio"] .graf-state,
  .graf-card[data-estado="error"] .graf-state { display: flex; }
  .graf-card[data-estado="cargando"] .graf-canvas-wrap,
  .graf-card[data-estado="vacio"] .graf-canvas-wrap,
  .graf-card[data-estado="error"] .graf-canvas-wrap,
  .graf-card[data-estado="cargando"] .graf-donut-wrap,
  .graf-card[data-estado="vacio"] .graf-donut-wrap,
  .graf-card[data-estado="error"] .graf-donut-wrap,
  .graf-card[data-estado="cargando"] .graf-heatmap,
  .graf-card[data-estado="vacio"] .graf-heatmap,
  .graf-card[data-estado="error"] .graf-heatmap,
  .graf-card[data-estado="cargando"] .graf-heatmap-legend,
  .graf-card[data-estado="vacio"] .graf-heatmap-legend,
  .graf-card[data-estado="error"] .graf-heatmap-legend { display: none; }

  /* Donut + leyenda */
  .graf-donut-wrap { display: flex; flex-direction: column; gap: var(--space-md); }
  .graf-legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .graf-legend li { display: flex; align-items: center; gap: var(--space-sm); font-size: var(--font-size-xs); color: var(--text-dark); }
  .graf-legend .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .graf-legend .sem { margin-left: auto; font-size: 11px; }

  /* Heatmap */
  .graf-heatmap { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .graf-heatmap .hcell { aspect-ratio: 1 / 1; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; font-size: 11px; color: var(--text-dark); }
  .graf-heatmap .hcell.empty { background: transparent; }
  .graf-heatmap-legend { display: flex; gap: var(--space-md); margin-top: var(--space-md); font-size: var(--font-size-xs); color: var(--text-secondary); flex-wrap: wrap; }
  .graf-heatmap-legend span { display: inline-flex; align-items: center; gap: 4px; }
  .graf-heatmap-legend .sw { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
</style>

<script>
  (function () {
    'use strict';
    function $(id) { return document.getElementById(id); }

    // ── Estado + registro de instancias Chart.js ──────────────
    var hoy = mesActual();
    var estado = { mes: hoy.mes, anio: hoy.anio };
    var charts = {}; // id canvas → instancia Chart (para destroy)

    // ── Helpers ───────────────────────────────────────────────
    function cssVar(nombre) {
      return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
    }
    function setEstado(n, est) {
      var card = $('card' + n);
      if (!card) return;
      card.setAttribute('data-estado', est);
      var box = card.querySelector('.graf-state');
      if (box) {
        box.textContent = est === 'cargando' ? 'Cargando…'
          : est === 'vacio' ? 'Sin movimientos este mes'
          : est === 'error' ? 'No se pudo cargar'
          : '';
      }
    }
    function destruir(id) {
      if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    }
    function rangoMesLocal(mes, anio) {
      var desde = anio + '-' + String(mes).padStart(2, '0') + '-01';
      var ultimo = new Date(anio, mes, 0).getDate();
      var hasta = anio + '-' + String(mes).padStart(2, '0') + '-' + String(ultimo).padStart(2, '0');
      return { desde: desde, hasta: hasta, dias: ultimo };
    }
    function mesAnterior(mes, anio) {
      return mes === 1 ? { mes: 12, anio: anio - 1 } : { mes: mes - 1, anio: anio };
    }

    // ── Capa de datos: TODO en paralelo ───────────────────────
    async function cargarDatos() {
      var m = estado.mes, a = estado.anio;
      var r = rangoMesLocal(m, a);
      var ant = mesAnterior(m, a);

      // 6 meses para el gráfico 4 (incluye el actual, hacia atrás)
      var meses6 = [];
      var cur = { mes: m, anio: a };
      for (var i = 0; i < 6; i++) { meses6.unshift(cur); cur = mesAnterior(cur.mes, cur.anio); }

      var resultados = await Promise.all([
        getTransacciones({ ambito: 'hogar', fecha_desde: r.desde, fecha_hasta: r.hasta }), // 0 → g1, g5
        getResumenMensual(m, a),                  // 1 → g2, g6, g7
        getResumenMensual(ant.mes, ant.anio),     // 2 → g7
        getCategorias('gasto'),                   // 3 → g2
        getAportesPorMiembro(m, a),               // 4 → g3
        Promise.all(meses6.map(function (x) { return getBalanceHogar(x.mes, x.anio); })), // 5 → g4
        getMetas(),                               // 6 → g8
      ]);

      var metas = (resultados[6] || []).filter(function (x) { return Number(x.monto_actual) < Number(x.monto_objetivo); });
      var aportesPorMeta = await Promise.all(metas.map(function (mt) { return getAportesDeMeta(mt.id); }));

      return {
        txHogarMes: resultados[0] || [],
        resumen: resultados[1],
        resumenAnterior: resultados[2],
        categoriasGasto: resultados[3] || [],
        aportesMiembro: resultados[4] || [],
        balance6m: meses6.map(function (x, i) {
          return { label: nombreMes(x.mes, x.anio).split(' ')[0].slice(0, 3), balance: (resultados[5][i] || {}).balance || 0 };
        }),
        metas: metas.map(function (mt, i) { return { meta: mt, aportes: aportesPorMeta[i] || [] }; }),
        rango: r,
      };
    }

    // ── Stubs de render (reemplazados en Tasks 3–10) ──────────
    function render1() { setEstado(1, 'vacio'); }
    function render2() { setEstado(2, 'vacio'); }
    function render3() { setEstado(3, 'vacio'); }
    function render4() { setEstado(4, 'vacio'); }
    function render5() { setEstado(5, 'vacio'); }
    function render6() { setEstado(6, 'vacio'); }
    function render7() { setEstado(7, 'vacio'); }
    function render8() { setEstado(8, 'vacio'); }

    var RENDERS = [render1, render2, render3, render4, render5, render6, render7, render8];

    // ── Orquestador ───────────────────────────────────────────
    async function recargarTodo() {
      for (var n = 1; n <= 8; n++) setEstado(n, 'cargando');
      var datos;
      try {
        datos = await cargarDatos();
      } catch (err) {
        console.error('cargarDatos falló:', err);
        for (var k = 1; k <= 8; k++) setEstado(k, 'error');
        return;
      }
      for (var id in charts) destruir(id);
      RENDERS.forEach(function (fn, idx) {
        try { fn(datos); }
        catch (err) { console.error('render' + (idx + 1) + ' falló:', err); setEstado(idx + 1, 'error'); }
      });
    }

    // ── Navegador mes/año ─────────────────────────────────────
    function renderLabel() { $('grafMesLabel').textContent = nombreMes(estado.mes, estado.anio); }
    function cambiarMes(delta) {
      var nuevo = delta < 0 ? mesAnterior(estado.mes, estado.anio)
        : (estado.mes === 12 ? { mes: 1, anio: estado.anio + 1 } : { mes: estado.mes + 1, anio: estado.anio });
      estado.mes = nuevo.mes; estado.anio = nuevo.anio;
      renderLabel(); recargarTodo();
    }
    $('grafMesPrev').addEventListener('click', function () { cambiarMes(-1); });
    $('grafMesNext').addEventListener('click', function () { cambiarMes(1); });

    // ── Arranque ──────────────────────────────────────────────
    if (typeof Chart === 'undefined') {
      for (var n2 = 1; n2 <= 8; n2++) setEstado(n2, 'error');
      console.error('Chart.js no cargó');
      return;
    }
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    renderLabel();
    recargarTodo();
  })();
</script>
```

- [ ] **Step 2: Verificar scaffold en navegador**

Asegurar preview corriendo. Navegar a `#graficos` (requiere sesión; si no hay, validar al menos que la vista carga sin throw vía `preview_eval` que haga `fetch('views/graficos.html').then(r=>r.status)` → 200). Confirmar vía `preview_console_logs` (error) cero errores de parseo. Confirmar que las 8 tarjetas existen: `preview_eval` → `document.querySelectorAll('.graf-card').length` → `8`.

- [ ] **Step 3: Commit**

```bash
git add views/graficos.html
git commit -m "feat(graficos): scaffold view with month nav, states, data layer, orchestrator"
```

---

### Task 3: Gráfico 1 — Evolución temporal (línea)

**Files:**
- Modify: `views/graficos.html` (reemplazar `function render1()`)

- [ ] **Step 1: Reemplazar el stub render1**

Reemplazar `function render1() { setEstado(1, 'vacio'); }` por:

```js
    function render1(datos) {
      var txs = datos.txHogarMes;
      if (!txs.length) { setEstado(1, 'vacio'); return; }
      var dias = datos.rango.dias;
      var gastos = new Array(dias).fill(0), ingresos = new Array(dias).fill(0);
      txs.forEach(function (t) {
        var d = parseInt(String(t.fecha).split('T')[0].split('-')[2], 10) - 1;
        if (d < 0 || d >= dias) return;
        if (t.tipo === 'gasto') gastos[d] += Number(t.monto);
        else if (t.tipo === 'ingreso') ingresos[d] += Number(t.monto);
      });
      // acumulado
      for (var i = 1; i < dias; i++) { gastos[i] += gastos[i - 1]; ingresos[i] += ingresos[i - 1]; }
      var labels = []; for (var k = 1; k <= dias; k++) labels.push(k);

      setEstado(1, 'ok');
      charts.chart1 = new Chart($('chart1'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            { label: 'Gastos', data: gastos, borderColor: cssVar('--color-danger'), backgroundColor: 'transparent', tension: 0.25 },
            { label: 'Ingresos', data: ingresos, borderColor: cssVar('--color-success'), backgroundColor: 'transparent', tension: 0.25 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: cssVar('--text-dark') } } },
          scales: {
            x: { ticks: { color: cssVar('--text-secondary') }, grid: { color: cssVar('--border-light') } },
            y: { ticks: { color: cssVar('--text-secondary') }, grid: { color: cssVar('--border-light') } },
          },
        },
      });
    }
```

- [ ] **Step 2: Verificar en navegador**

Recargar `#graficos`. Vía `preview_eval`: `!!window` (placeholder de smoke). Confirmar `preview_console_logs` (error) sin errores. Confirmar `preview_eval` → `document.getElementById('card1').getAttribute('data-estado')` ∈ `{'ok','vacio'}`. Tomar `preview_screenshot` del card1.

- [ ] **Step 3: Commit**

```bash
git add views/graficos.html
git commit -m "feat(graficos): chart 1 — temporal evolution line"
```

---

### Task 4: Gráfico 2 — Distribución por categoría (donut + leyenda semáforo)

**Files:**
- Modify: `views/graficos.html` (reemplazar `function render2()`)

- [ ] **Step 1: Reemplazar el stub render2**

```js
    function render2(datos) {
      var cats = datos.resumen.porCategoria || [];
      if (!cats.length) { setEstado(2, 'vacio'); return; }
      // límite por categoria_id desde categoriasGasto (match por nombre, que es lo que trae porCategoria)
      var limitePorNombre = {};
      var colorPorNombre = {};
      datos.categoriasGasto.forEach(function (c) {
        limitePorNombre[c.nombre] = c.limite_mensual != null ? Number(c.limite_mensual) : null;
        colorPorNombre[c.nombre] = c.color || cssVar('--color-primary');
      });
      var paleta = ['#059669', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
      var labels = [], valores = [], colores = [];
      cats.forEach(function (c, i) {
        labels.push(c.nombre);
        valores.push(c.total);
        colores.push(colorPorNombre[c.nombre] || paleta[i % paleta.length]);
      });
      var total = valores.reduce(function (a, b) { return a + b; }, 0);

      setEstado(2, 'ok');
      charts.chart2 = new Chart($('chart2'), {
        type: 'doughnut',
        data: { labels: labels, datasets: [{ data: valores, backgroundColor: colores, borderWidth: 0 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
        },
      });

      // Leyenda personalizada: color categoría + monto + % límite + semáforo
      var leyenda = $('legend2');
      leyenda.innerHTML = '';
      cats.forEach(function (c, i) {
        var lim = limitePorNombre[c.nombre];
        var pctTotal = total ? Math.round((c.total / total) * 100) : 0;
        var sem = '', semTxt = '';
        if (lim != null && lim > 0) {
          var pctLim = (c.total / lim) * 100;
          if (pctLim > 100) { sem = '🔴'; semTxt = Math.round(pctLim) + '% límite'; }
          else if (pctLim >= 80) { sem = '🟡'; semTxt = Math.round(pctLim) + '% límite'; }
          else { sem = '🟢'; semTxt = Math.round(pctLim) + '% límite'; }
        }
        var li = document.createElement('li');
        li.innerHTML = '<span class="dot" style="background:' + colores[i] + '"></span>' +
          '<span>' + c.nombre + ' — ' + formatMonto(c.total) + ' (' + pctTotal + '%)</span>' +
          (sem ? '<span class="sem">' + sem + ' ' + semTxt + '</span>' : '');
        leyenda.appendChild(li);
      });
    }
```

- [ ] **Step 2: Verificar en navegador**

Recargar `#graficos`. `preview_eval` → `document.getElementById('card2').getAttribute('data-estado')`. Confirmar leyenda tiene ítems: `document.querySelectorAll('#legend2 li').length`. `preview_console_logs` (error) sin errores. `preview_screenshot` del card2.

- [ ] **Step 3: Commit**

```bash
git add views/graficos.html
git commit -m "feat(graficos): chart 2 — category donut with limit semaphore legend"
```

---

### Task 5: Gráfico 3 — Aporte real vs. esperado (barras)

**Files:**
- Modify: `views/graficos.html` (reemplazar `function render3()`)

- [ ] **Step 1: Reemplazar el stub render3**

```js
    function render3(datos) {
      var miembros = datos.aportesMiembro || [];
      if (!miembros.length) { setEstado(3, 'vacio'); return; }
      var labels = miembros.map(function (x) { return x.nombre; });
      var esperado = miembros.map(function (x) { return x.esperado; });
      var real = miembros.map(function (x) { return x.real; });

      setEstado(3, 'ok');
      charts.chart3 = new Chart($('chart3'), {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: 'Esperado', data: esperado, backgroundColor: cssVar('--color-secondary') || '#6b7280' },
            { label: 'Real', data: real, backgroundColor: cssVar('--color-primary') },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: cssVar('--text-dark') } } },
          scales: {
            x: { ticks: { color: cssVar('--text-secondary') }, grid: { display: false } },
            y: { ticks: { color: cssVar('--text-secondary') }, grid: { color: cssVar('--border-light') }, beginAtZero: true },
          },
        },
      });
    }
```

- [ ] **Step 2: Verificar en navegador**

Recargar. `preview_eval` → estado de card3. `preview_console_logs` (error) sin errores. `preview_screenshot` card3.

- [ ] **Step 3: Commit**

```bash
git add views/graficos.html
git commit -m "feat(graficos): chart 3 — real vs expected contribution bars"
```

---

### Task 6: Gráfico 4 — Ahorro acumulado (línea, 6 meses)

**Files:**
- Modify: `views/graficos.html` (reemplazar `function render4()`)

- [ ] **Step 1: Reemplazar el stub render4**

```js
    function render4(datos) {
      var serie = datos.balance6m || [];
      if (!serie.length) { setEstado(4, 'vacio'); return; }
      var labels = serie.map(function (x) { return x.label; });
      // acumulado del balance neto mes a mes
      var acum = []; var run = 0;
      serie.forEach(function (x) { run += Number(x.balance) || 0; acum.push(run); });

      setEstado(4, 'ok');
      charts.chart4 = new Chart($('chart4'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Ahorro acumulado', data: acum,
            borderColor: cssVar('--color-primary'),
            backgroundColor: 'rgba(5,150,105,0.12)', fill: true, tension: 0.3,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: cssVar('--text-dark') } } },
          scales: {
            x: { ticks: { color: cssVar('--text-secondary') }, grid: { color: cssVar('--border-light') } },
            y: { ticks: { color: cssVar('--text-secondary') }, grid: { color: cssVar('--border-light') } },
          },
        },
      });
    }
```

- [ ] **Step 2: Verificar en navegador**

Recargar. `preview_eval` → estado card4. `preview_console_logs` (error) sin errores. `preview_screenshot` card4.

- [ ] **Step 3: Commit**

```bash
git add views/graficos.html
git commit -m "feat(graficos): chart 4 — cumulative savings line (6 months)"
```

---

### Task 7: Gráfico 5 — Mapa de calor (grilla CSS)

**Files:**
- Modify: `views/graficos.html` (reemplazar `function render5()`)

- [ ] **Step 1: Reemplazar el stub render5**

```js
    function render5(datos) {
      var txs = datos.txHogarMes.filter(function (t) { return t.tipo === 'gasto'; });
      var dias = datos.rango.dias;
      var porDia = new Array(dias).fill(0);
      txs.forEach(function (t) {
        var d = parseInt(String(t.fecha).split('T')[0].split('-')[2], 10) - 1;
        if (d >= 0 && d < dias) porDia[d] += Number(t.monto);
      });
      var conGasto = porDia.filter(function (v) { return v > 0; });
      if (!conGasto.length) { setEstado(5, 'vacio'); return; }
      var media = conGasto.reduce(function (a, b) { return a + b; }, 0) / conGasto.length;

      function colorDia(v) {
        if (v <= 0) return 'transparent';
        if (v <= media) return 'rgba(16,185,129,0.85)';        // verde
        if (v <= media * 2) return 'rgba(245,158,11,0.85)';    // ámbar
        return 'rgba(239,68,68,0.85)';                          // rojo
      }

      // primer día de la semana del mes (0=domingo)
      var primerDow = new Date(estado.anio, estado.mes - 1, 1).getDay();
      var grid = $('heatmap5');
      grid.innerHTML = '';
      // cabeceras de día de semana
      ['D', 'L', 'M', 'M', 'J', 'V', 'S'].forEach(function (d) {
        var h = document.createElement('div'); h.className = 'hcell empty';
        h.style.color = cssVar('--text-secondary'); h.style.fontWeight = '600'; h.textContent = d;
        grid.appendChild(h);
      });
      // huecos antes del día 1
      for (var e = 0; e < primerDow; e++) { var sp = document.createElement('div'); sp.className = 'hcell empty'; grid.appendChild(sp); }
      // días
      for (var dia = 1; dia <= dias; dia++) {
        var cell = document.createElement('div');
        cell.className = 'hcell';
        var v = porDia[dia - 1];
        cell.style.background = v > 0 ? colorDia(v) : cssVar('--bg-light-secondary');
        cell.textContent = dia;
        cell.title = v > 0 ? formatMonto(v) : 'Sin gasto';
        grid.appendChild(cell);
      }

      // leyenda
      var leg = $('heatmapLegend5');
      leg.innerHTML =
        '<span><i class="sw" style="background:' + cssVar('--bg-light-secondary') + '"></i>Sin gasto</span>' +
        '<span><i class="sw" style="background:rgba(16,185,129,0.85)"></i>≤ promedio</span>' +
        '<span><i class="sw" style="background:rgba(245,158,11,0.85)"></i>&gt; promedio</span>' +
        '<span><i class="sw" style="background:rgba(239,68,68,0.85)"></i>&gt; 2× promedio</span>';

      setEstado(5, 'ok');
    }
```

- [ ] **Step 2: Verificar en navegador**

Recargar. `preview_eval` → `document.querySelectorAll('#heatmap5 .hcell').length` > 7 (cabeceras + días). Estado card5. `preview_console_logs` (error) sin errores. `preview_screenshot` card5.

- [ ] **Step 3: Commit**

```bash
git add views/graficos.html
git commit -m "feat(graficos): chart 5 — daily spending heatmap (CSS grid)"
```

---

### Task 8: Gráfico 6 — Flujo de caja (cascada)

**Files:**
- Modify: `views/graficos.html` (reemplazar `function render6()`)

- [ ] **Step 1: Reemplazar el stub render6**

Simula cascada con barras apiladas: una serie transparente (base) + una serie visible (delta). Ingresos = barra completa desde 0; cada categoría resta; balance final.

```js
    function render6(datos) {
      var resumen = datos.resumen;
      var ingresos = resumen.hogar.ingresos || 0;
      // categorías de gasto del hogar: usar porCategoria (incluye personales propios);
      // para flujo de caja del hogar usamos hogar.gastos repartido por porCategoria.
      var cats = (resumen.porCategoria || []).slice(0, 6); // top 6 por monto (ya viene ordenado desc)
      if (ingresos <= 0 && !cats.length) { setEstado(6, 'vacio'); return; }

      var labels = ['Ingresos'];
      var base = [0];          // parte transparente (offset)
      var visible = [ingresos]; // parte coloreada
      var colores = [cssVar('--color-success')];

      var corriente = ingresos;
      cats.forEach(function (c) {
        labels.push(c.nombre);
        var monto = Number(c.total);
        corriente -= monto;
        base.push(corriente);          // la barra "flota" en el nivel resultante
        visible.push(monto);
        colores.push(cssVar('--color-danger'));
      });

      labels.push('Balance');
      base.push(0);
      visible.push(corriente);
      colores.push(corriente >= 0 ? cssVar('--color-primary') : cssVar('--color-danger'));

      setEstado(6, 'ok');
      charts.chart6 = new Chart($('chart6'), {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: '_base', data: base, backgroundColor: 'transparent', stack: 'cf' },
            { label: 'Flujo', data: visible, backgroundColor: colores, stack: 'cf' },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { filter: function (item) { return item.dataset.label !== '_base'; } },
          },
          scales: {
            x: { ticks: { color: cssVar('--text-secondary') }, grid: { display: false }, stacked: true },
            y: { ticks: { color: cssVar('--text-secondary') }, grid: { color: cssVar('--border-light') }, stacked: true },
          },
        },
      });
    }
```

- [ ] **Step 2: Verificar en navegador**

Recargar. Estado card6. `preview_console_logs` (error) sin errores. `preview_screenshot` card6 — confirmar visualmente forma de cascada.

- [ ] **Step 3: Commit**

```bash
git add views/graficos.html
git commit -m "feat(graficos): chart 6 — cash flow waterfall (stacked bars)"
```

---

### Task 9: Gráfico 7 — Comparativa mes a mes (barras agrupadas)

**Files:**
- Modify: `views/graficos.html` (reemplazar `function render7()`)

- [ ] **Step 1: Reemplazar el stub render7**

```js
    function render7(datos) {
      var actual = datos.resumen.porCategoria || [];
      var anterior = datos.resumenAnterior.porCategoria || [];
      if (!actual.length && !anterior.length) { setEstado(7, 'vacio'); return; }
      // top-5 categorías por gasto del mes actual
      var top = actual.slice(0, 5).map(function (c) { return c.nombre; });
      var mapAnt = {};
      anterior.forEach(function (c) { mapAnt[c.nombre] = c.total; });
      var mapAct = {};
      actual.forEach(function (c) { mapAct[c.nombre] = c.total; });

      var dActual = top.map(function (n) { return mapAct[n] || 0; });
      var dAnterior = top.map(function (n) { return mapAnt[n] || 0; });

      setEstado(7, 'ok');
      charts.chart7 = new Chart($('chart7'), {
        type: 'bar',
        data: {
          labels: top,
          datasets: [
            { label: 'Mes anterior', data: dAnterior, backgroundColor: cssVar('--color-secondary') || '#6b7280' },
            { label: 'Mes actual', data: dActual, backgroundColor: cssVar('--color-primary') },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: cssVar('--text-dark') } } },
          scales: {
            x: { ticks: { color: cssVar('--text-secondary') }, grid: { display: false } },
            y: { ticks: { color: cssVar('--text-secondary') }, grid: { color: cssVar('--border-light') }, beginAtZero: true },
          },
        },
      });
    }
```

- [ ] **Step 2: Verificar en navegador**

Recargar. Estado card7. `preview_console_logs` (error) sin errores. `preview_screenshot` card7.

- [ ] **Step 3: Commit**

```bash
git add views/graficos.html
git commit -m "feat(graficos): chart 7 — month-over-month category comparison"
```

---

### Task 10: Gráfico 8 — Proyección de metas (línea + forecast)

**Files:**
- Modify: `views/graficos.html` (reemplazar `function render8()`)

- [ ] **Step 1: Reemplazar el stub render8**

Por cada meta activa: serie real (acumulado de aportes ordenados por fecha) + serie punteada proyectando ritmo hasta `fecha_limite`. Punteada verde si proyecta alcanzar el objetivo, roja si no.

```js
    function render8(datos) {
      var metas = datos.metas || [];
      if (!metas.length) { setEstado(8, 'vacio'); return; }

      var paleta = ['#059669', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
      var datasets = [];
      // eje X común: meses desde el inicio más antiguo hasta el límite más lejano (o +6 meses)
      var labelsSet = [];

      metas.forEach(function (item, idx) {
        var meta = item.meta;
        var aportes = (item.aportes || []).slice().sort(function (a, b) {
          return new Date(a.created_at) - new Date(b.created_at);
        });
        var objetivo = Number(meta.monto_objetivo);
        var color = paleta[idx % paleta.length];

        // acumulado real por mes (YYYY-MM)
        var acumPorMes = {};
        var run = 0;
        aportes.forEach(function (ap) {
          var ym = String(ap.created_at).slice(0, 7);
          run += Number(ap.monto);
          acumPorMes[ym] = run;
        });
        var actualAcum = Number(meta.monto_actual) || run;

        // ritmo mensual: promedio de aportes / nº de meses con aporte (mín 1)
        var mesesConAporte = Object.keys(acumPorMes).length || 1;
        var ritmo = actualAcum / mesesConAporte;

        // proyección: desde hoy, ¿cuántos meses para llegar?
        var restante = Math.max(objetivo - actualAcum, 0);
        var mesesParaMeta = ritmo > 0 ? Math.ceil(restante / ritmo) : Infinity;

        // ¿llega antes del límite?
        var llega = true;
        if (meta.fecha_limite) {
          var hoyD = new Date();
          var limD = new Date(meta.fecha_limite);
          var mesesHastaLimite = (limD.getFullYear() - hoyD.getFullYear()) * 12 + (limD.getMonth() - hoyD.getMonth());
          llega = mesesParaMeta <= Math.max(mesesHastaLimite, 0);
        } else {
          llega = ritmo > 0; // fondo sin fecha: "llega" si hay ritmo positivo
        }

        // construir labels reales + proyectados
        var ymHoy = new Date().toISOString().slice(0, 7);
        var realLabels = Object.keys(acumPorMes);
        if (!realLabels.length) realLabels = [ymHoy];
        realLabels.forEach(function (l) { if (labelsSet.indexOf(l) === -1) labelsSet.push(l); });

        // serie real
        var realData = realLabels.map(function (l) { return acumPorMes[l] != null ? acumPorMes[l] : null; });
        datasets.push({
          label: meta.nombre, data: realData, _labels: realLabels,
          borderColor: color, backgroundColor: 'transparent', tension: 0.2, spanGaps: true,
        });

        // serie proyectada (punteada): desde el último punto real hasta el objetivo
        var projLabels = [];
        var cursor = new Date(ymHoy + '-01');
        var pasos = isFinite(mesesParaMeta) ? mesesParaMeta : 6;
        for (var s = 0; s <= pasos; s++) {
          projLabels.push(cursor.toISOString().slice(0, 7));
          cursor.setMonth(cursor.getMonth() + 1);
        }
        projLabels.forEach(function (l) { if (labelsSet.indexOf(l) === -1) labelsSet.push(l); });
        var projData = projLabels.map(function (l, i) { return Math.min(actualAcum + ritmo * i, objetivo); });
        datasets.push({
          label: meta.nombre + ' (proyección)', data: projData, _labels: projLabels,
          borderColor: llega ? cssVar('--color-success') : cssVar('--color-danger'),
          backgroundColor: 'transparent', borderDash: [6, 4], pointRadius: 0, tension: 0.1,
        });
      });

      // ordenar labels cronológicamente y remapear cada dataset a esos labels
      labelsSet.sort();
      datasets.forEach(function (ds) {
        var byLabel = {};
        ds._labels.forEach(function (l, i) { byLabel[l] = ds.data[i]; });
        ds.data = labelsSet.map(function (l) { return byLabel[l] != null ? byLabel[l] : null; });
        delete ds._labels;
      });

      setEstado(8, 'ok');
      charts.chart8 = new Chart($('chart8'), {
        type: 'line',
        data: { labels: labelsSet, datasets: datasets },
        options: {
          responsive: true, maintainAspectRatio: false, spanGaps: true,
          plugins: { legend: { labels: { color: cssVar('--text-dark') } } },
          scales: {
            x: { ticks: { color: cssVar('--text-secondary') }, grid: { color: cssVar('--border-light') } },
            y: { ticks: { color: cssVar('--text-secondary') }, grid: { color: cssVar('--border-light') }, beginAtZero: true },
          },
        },
      });
    }
```

- [ ] **Step 2: Verificar en navegador**

Recargar. Estado card8. Confirmar punteadas visibles en `preview_screenshot` card8. `preview_console_logs` (error) sin errores.

- [ ] **Step 3: Commit**

```bash
git add views/graficos.html
git commit -m "feat(graficos): chart 8 — goal projection with forecast lines"
```

---

### Task 11: Verificación integral + tema oscuro

**Files:**
- Verify only (ajustes inline si hace falta)

- [ ] **Step 1: Verificación de los 8 a la vez**

Con sesión activa en `#graficos`, vía `preview_eval`:
```js
Array.from(document.querySelectorAll('.graf-card')).map(function(c){return c.getAttribute('data-estado');})
```
Esperado: ningún `'error'` con datos presentes. `'ok'` o `'vacio'` según el mes.

- [ ] **Step 2: Navegador mes/año actualiza todo**

`preview_click` en `#grafMesPrev`. Confirmar que `#grafMesLabel` cambió y que las tarjetas re-renderizan (sin errores en `preview_console_logs`).

- [ ] **Step 3: Tema oscuro**

`preview_eval` para forzar tema oscuro si el proyecto lo soporta vía clase/atributo (revisar cómo `base.css` alterna: `prefers-color-scheme` o clase). Si es por media query, usar `preview_resize`/emulación no aplica — basta confirmar en claro y documentar que el redibujo lee custom props. Tomar `preview_screenshot` general.

- [ ] **Step 4: Commit final (si hubo ajustes)**

```bash
git add -A
git commit -m "fix(graficos): integration adjustments after full verification"
```

---

## Self-Review

**Spec coverage:**
- Chart.js en index.html + heatmap CSS → Task 1, 2, 7 ✅
- Selector = navegador mensual → Task 2 (markup + `cambiarMes`) ✅
- 8 gráficos → Tasks 3–10 ✅
- Donut color-categoría + semáforo leyenda → Task 4 ✅
- Estados cargando/vacío/error por tarjeta → Task 2 (`setEstado` + CSS) ✅
- Umbral heatmap relativo (media, 2×media) → Task 7 ✅
- Forecast color verde/rojo → Task 10 ✅
- `getAportesPorMiembro` helper → Task 1 ✅
- Promise.all + destroy → Task 2 (`cargarDatos`, `recargarTodo`) ✅
- Tema vía custom props → cada render usa `cssVar()` ✅
- aria-label en canvas → Task 2 markup ✅
- Responsive 1/2 columnas → Task 2 CSS ✅

**Placeholder scan:** Sin TBD/TODO. Stubs de render en Task 2 son intencionales y se reemplazan en Tasks 3–10 (cada uno con código completo).

**Type consistency:** `datos.{txHogarMes, resumen, resumenAnterior, categoriasGasto, aportesMiembro, balance6m, metas, rango}` definido en `cargarDatos` (Task 2) y consumido idénticamente en Tasks 3–10. `charts.chartN` / `setEstado(n, …)` / `cssVar()` consistentes en todas las tareas. `render<N>(datos)` firma uniforme.

**Notas de riesgo:**
- Gráfico 6 (cascada) reparte `hogar.gastos` vía `porCategoria`, que incluye gastos personales propios — aproximación aceptable; si se requiere estrictamente hogar, filtrar requeriría un cambio en `getResumenMensual` (fuera de alcance, anotado).
- Gráfico 3 depende de RLS que exponga transacciones de aporte entre miembros; si RLS las oculta, `real` saldrá 0 para el otro miembro — verificar en Task 5 Step 2 con datos reales.
- Líneas de número absolutas pueden desplazarse; cada Task localiza por nombre de función (`function renderN`) no por línea.
