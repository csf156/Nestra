# Insights Engine (Fase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a client-side analytical insights engine that reads the last 90 days of transactions/goals from IndexedDB and renders prioritized, actionable insight cards in a mobile-first horizontal carousel on the dashboard.

**Architecture:** Pure, deterministic detector functions (input = plain arrays + an injected `hoy` Date; output = insight objects or `[]`) live in `js/insights.js` using the dual-export pattern (`window.x` + `export {x}`) like `js/sync-lww.js`. A single impure `cargarInsights()` wrapper reads via `js/db.js`, slices to 90 days, and calls the pure orchestrator `generarInsights()`. The dashboard view renders the cards. Budget/limit alerts stay in `js/alerts.js` (no overlap).

**Tech Stack:** Vanilla JS (no build step), ESM modules loaded via `<script type="module">`, Node's built-in test runner (`node:test` + `node:assert`) for unit tests, Tabler SVG sprite for icons via `iconoCategoria()`.

---

## File Structure

- **Create** `js/insights.js` — all pure detectors, helpers, `priorizar`, `generarInsights` (pure orchestrator), and `cargarInsights` (impure wrapper). Dual-exported.
- **Create** `test/insights-helpers.test.mjs` — date helpers + `filtrarVentana` + `fmtS`.
- **Create** `test/insights-crecimiento.test.mjs` — `detectCrecimiento`.
- **Create** `test/insights-dia-anomalo.test.mjs` — `detectDiaAnomalo`.
- **Create** `test/insights-proyeccion-meta.test.mjs` — `detectProyeccionMeta`.
- **Create** `test/insights-ritmo-mensual.test.mjs` — `detectRitmoMensual`.
- **Create** `test/insights-buen-mes.test.mjs` — `detectBuenMes`.
- **Create** `test/insights-priorizar.test.mjs` — `priorizar` + `generarInsights`.
- **Modify** `index.html` — add `<script type="module" src="js/insights.js"></script>` after `js/alerts.js`.
- **Modify** `views/dashboard.html` — add `#dashInsights` section, `renderInsights()`, carousel CSS, wire into the existing `Promise.allSettled`.

All detectors take `hoy` as a JS `Date` (constructed in tests with `new Date(2026, 5, 21)` — month is 0-based, local time, no timezone surprises). Transaction `fecha` is a `'YYYY-MM-DD'` string and is compared lexicographically against ISO boundary strings.

---

### Task 1: Module scaffold, date helpers, `fmtS`, `filtrarVentana`

**Files:**
- Create: `js/insights.js`
- Test: `test/insights-helpers.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/insights-helpers.test.mjs`:

```js
import assert from 'node:assert';
import { test } from 'node:test';
import { diaISO, restarDias, parseFechaISO, fmtS, filtrarVentana } from '../js/insights.js';

test('diaISO formatea Date local a YYYY-MM-DD', () => {
  assert.strictEqual(diaISO(new Date(2026, 5, 21)), '2026-06-21');
  assert.strictEqual(diaISO(new Date(2026, 0, 5)), '2026-01-05');
});

test('restarDias retrocede n días cruzando meses', () => {
  assert.strictEqual(diaISO(restarDias(new Date(2026, 5, 21), 30)), '2026-05-22');
  assert.strictEqual(diaISO(restarDias(new Date(2026, 0, 1), 1)), '2025-12-31');
});

test('parseFechaISO produce medianoche local', () => {
  const d = parseFechaISO('2026-06-21');
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 5);
  assert.strictEqual(d.getDate(), 21);
});

test('fmtS agrupa miles sin decimales', () => {
  assert.strictEqual(fmtS(420), 'S/420');
  assert.strictEqual(fmtS(1250.7), 'S/1,251');
  assert.strictEqual(fmtS(0), 'S/0');
});

test('filtrarVentana mantiene solo fechas dentro de [hoy-dias, hoy]', () => {
  const hoy = new Date(2026, 5, 21);
  const txs = [
    { fecha: '2026-06-21' }, // hoy
    { fecha: '2026-03-23' }, // dentro de 90d
    { fecha: '2026-03-20' }, // fuera (>90d)
    { fecha: '2026-06-22' }, // futuro, fuera
    { fecha: null },          // sin fecha, fuera
  ];
  const out = filtrarVentana(txs, hoy, 90).map((t) => t.fecha);
  assert.deepStrictEqual(out, ['2026-06-21', '2026-03-23']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/insights-helpers.test.mjs`
Expected: FAIL — `Cannot find module '../js/insights.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `js/insights.js`:

```js
// ─────────────────────────────────────────────────────────────────
// Nestra — insights.js
// Motor de insights analíticos (Fase 2). Corre en el cliente, lee 90
// días de historial y genera insight cards priorizadas para el dashboard.
//
// Detectores PUROS y deterministas: reciben arrays planos + `hoy` (Date)
// inyectado y devuelven insights (o []). Sin Date.now() interno, sin red,
// sin DOM → testeables con datos sintéticos. Única parte impura:
// cargarInsights(), que lee de db.js.
//
// Patrón dual-export (como sync-lww.js): window.* en navegador + export ESM
// para los tests. Cargar en index.html con <script type="module">.
//
// NO cubre presupuesto/límite de categoría: eso vive en alerts.js.
// ─────────────────────────────────────────────────────────────────
'use strict';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// Plural correcto: lunes-viernes invariantes; domingo/sábado pluralizan.
const DIAS_PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];

// diaISO(d) — Date → 'YYYY-MM-DD' en hora local.
function diaISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// restarDias(d, n) — nueva Date n días antes de d (medianoche local).
function restarDias(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n);
}

// parseFechaISO(iso) — 'YYYY-MM-DD' → Date medianoche local.
function parseFechaISO(iso) {
  const [y, m, dd] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, dd);
}

// fmtS(n) — número → 'S/1,234' (redondeado, separador de miles, determinista).
function fmtS(n) {
  const r = Math.round(Number(n) || 0);
  return 'S/' + String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// filtrarVentana(txs, hoy, dias) — transacciones con fecha en [hoy-dias, hoy].
function filtrarVentana(transacciones, hoy, dias) {
  const desde = diaISO(restarDias(hoy, dias));
  const hoyISO = diaISO(hoy);
  return (transacciones || []).filter(
    (t) => t.fecha && t.fecha >= desde && t.fecha <= hoyISO
  );
}

if (typeof window !== 'undefined') {
  // (se completará con generarInsights / cargarInsights en tareas posteriores)
}

export { diaISO, restarDias, parseFechaISO, fmtS, filtrarVentana };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/insights-helpers.test.mjs`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/insights.js test/insights-helpers.test.mjs
git commit -m "feat(insights): module scaffold + date/format helpers"
```

---

### Task 2: `detectCrecimiento` (growth + decline per category×ámbito)

**Files:**
- Modify: `js/insights.js`
- Test: `test/insights-crecimiento.test.mjs`

Logic: window = last 90 days. "Actual" = last 30 days; "baseline" = days 31–90 (60 days ≈ 2 months, so monthly baseline = `baseSum / 2`). Group `gasto` by `categoria_id|ambito`. Guards: monthly baseline ≥ S/50, ≥3 baseline tx, ≥2 actual tx. `pct = round((actualSum - baseMensual) / baseMensual * 100)`. `pct ≥ +25` → `warn`/`trending-up`; `pct ≤ −25` → `good`/`trending-down`. Sort by `|pct|` desc, take top 2.

- [ ] **Step 1: Write the failing test**

Create `test/insights-crecimiento.test.mjs`:

```js
import assert from 'node:assert';
import { test } from 'node:test';
import { detectCrecimiento } from '../js/insights.js';

const HOY = new Date(2026, 5, 21); // 2026-06-21

// Helper: tx de gasto. dias = días antes de HOY.
function gasto(catId, ambito, monto, fechaISO, nombre = 'Delivery') {
  return { tipo: 'gasto', ambito, categoria_id: catId, monto, fecha: fechaISO,
    categorias: { nombre, icono: 'pizza' } };
}

test('detecta crecimiento ≥ +25% como warn/trending-up', () => {
  const txs = [];
  // Baseline (días 31-90): 6 tx de 50 = 300 → mensual 150.
  for (const f of ['2026-04-01', '2026-04-15', '2026-05-01', '2026-05-10', '2026-05-15', '2026-05-20']) {
    txs.push(gasto('c1', 'personal', 50, f));
  }
  // Actual (últimos 30d): 4 tx de 60 = 240 vs 150 → +60%.
  for (const f of ['2026-05-25', '2026-06-05', '2026-06-12', '2026-06-18']) {
    txs.push(gasto('c1', 'personal', 60, f));
  }
  const out = detectCrecimiento(txs, { hoy: HOY });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'warn');
  assert.strictEqual(out[0].icono, 'trending-up');
  assert.match(out[0].titulo, /Delivery \(personal\) subió 60%/);
  assert.strictEqual(out[0].meta.categoria_id, 'c1');
});

test('detecta caída ≤ -25% como good/trending-down', () => {
  const txs = [];
  // Baseline: 6 tx de 100 = 600 → mensual 300.
  for (const f of ['2026-04-02', '2026-04-12', '2026-04-22', '2026-05-02', '2026-05-12', '2026-05-20']) {
    txs.push(gasto('c2', 'hogar', 100, f, 'Servicios'));
  }
  // Actual: 2 tx de 60 = 120 vs 300 → -60%.
  txs.push(gasto('c2', 'hogar', 60, '2026-06-05', 'Servicios'));
  txs.push(gasto('c2', 'hogar', 60, '2026-06-15', 'Servicios'));
  const out = detectCrecimiento(txs, { hoy: HOY });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'good');
  assert.strictEqual(out[0].icono, 'trending-down');
  assert.match(out[0].titulo, /Servicios \(hogar\) bajó 60%/);
});

test('NO dispara si baseline mensual < S/50 (evita div por ~0)', () => {
  const txs = [
    gasto('c3', 'personal', 10, '2026-04-10'),
    gasto('c3', 'personal', 10, '2026-04-20'),
    gasto('c3', 'personal', 10, '2026-05-05'),
    gasto('c3', 'personal', 90, '2026-06-10'),
    gasto('c3', 'personal', 90, '2026-06-15'),
  ];
  assert.deepStrictEqual(detectCrecimiento(txs, { hoy: HOY }), []);
});

test('NO dispara con menos de 3 tx en baseline o 2 en actual', () => {
  const txs = [
    gasto('c4', 'personal', 100, '2026-04-10'),
    gasto('c4', 'personal', 100, '2026-05-10'),
    gasto('c4', 'personal', 300, '2026-06-10'),
  ];
  assert.deepStrictEqual(detectCrecimiento(txs, { hoy: HOY }), []);
});

test('array vacío → []', () => {
  assert.deepStrictEqual(detectCrecimiento([], { hoy: HOY }), []);
});

test('cap a 2 insights, ordenados por |pct| desc', () => {
  const txs = [];
  // c1: +60% (4 actual 60, 6 base 50 → mensual 150).
  for (const f of ['2026-04-01', '2026-04-15', '2026-05-01', '2026-05-10', '2026-05-15', '2026-05-20']) txs.push(gasto('c1', 'personal', 50, f, 'A'));
  for (const f of ['2026-05-25', '2026-06-05', '2026-06-12', '2026-06-18']) txs.push(gasto('c1', 'personal', 60, f, 'A'));
  // c2: +100% (base mensual 100, actual 200).
  for (const f of ['2026-04-03', '2026-04-13', '2026-05-03', '2026-05-13', '2026-05-18', '2026-05-21']) txs.push(gasto('c2', 'hogar', 100 / 3, f, 'B'));
  for (const f of ['2026-06-02', '2026-06-08', '2026-06-14']) txs.push(gasto('c2', 'hogar', 200 / 3, f, 'B'));
  // c3: +30% (base mensual 100, actual 130).
  for (const f of ['2026-04-04', '2026-04-14', '2026-05-04', '2026-05-14', '2026-05-19', '2026-05-22']) txs.push(gasto('c3', 'personal', 100 / 3, f, 'C'));
  for (const f of ['2026-06-03', '2026-06-09', '2026-06-16']) txs.push(gasto('c3', 'personal', 130 / 3, f, 'C'));
  const out = detectCrecimiento(txs, { hoy: HOY });
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].meta.categoria_id, 'c2'); // +100% primero
  assert.strictEqual(out[1].meta.categoria_id, 'c1'); // +60% segundo
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/insights-crecimiento.test.mjs`
Expected: FAIL — `detectCrecimiento is not a function` / import error.

- [ ] **Step 3: Write minimal implementation**

In `js/insights.js`, add before the dual-export block:

```js
// detectCrecimiento(transacciones, { hoy, umbralPct?, baselineMin? })
// Compara gasto por categoría×ámbito: últimos 30d vs promedio mensual de los
// 60d previos. Devuelve hasta 2 insights (crecimiento warn / caída good).
function detectCrecimiento(transacciones, opts) {
  const hoy = opts.hoy;
  const UMBRAL = opts.umbralPct != null ? opts.umbralPct : 25;
  const BASE_MIN = opts.baselineMin != null ? opts.baselineMin : 50;
  const actualDesde = diaISO(restarDias(hoy, 30));
  const baseDesde = diaISO(restarDias(hoy, 90));
  const hoyISO = diaISO(hoy);

  const grupos = new Map();
  for (const t of transacciones) {
    if (t.tipo !== 'gasto' || !t.fecha) continue;
    if (t.fecha < baseDesde || t.fecha > hoyISO) continue;
    const key = t.categoria_id + '|' + t.ambito;
    let g = grupos.get(key);
    if (!g) {
      g = {
        categoria_id: t.categoria_id, ambito: t.ambito,
        nombre: (t.categorias && t.categorias.nombre) || 'Sin categoría',
        actualSum: 0, actualCount: 0, baseSum: 0, baseCount: 0,
      };
      grupos.set(key, g);
    }
    if (t.fecha >= actualDesde) { g.actualSum += Number(t.monto); g.actualCount++; }
    else { g.baseSum += Number(t.monto); g.baseCount++; }
  }

  const out = [];
  for (const g of grupos.values()) {
    const baseMensual = g.baseSum / 2; // 60 días ≈ 2 meses
    if (baseMensual < BASE_MIN || g.baseCount < 3 || g.actualCount < 2) continue;
    const pct = Math.round((g.actualSum - baseMensual) / baseMensual * 100);
    const ambLabel = g.ambito === 'hogar' ? 'hogar' : 'personal';
    const subtexto = `${fmtS(g.actualSum)} este mes vs ${fmtS(baseMensual)} tu promedio`;
    if (pct >= UMBRAL) {
      out.push({
        id: `crecimiento:${g.categoria_id}:${g.ambito}`, tipo: 'warn', icono: 'trending-up',
        titulo: `${g.nombre} (${ambLabel}) subió ${pct}%`, subtexto,
        accion: { label: 'Ver historial', href: '#historial' },
        meta: { ambito: g.ambito, categoria_id: g.categoria_id, pct, magnitud: Math.min(1, pct / 100) },
      });
    } else if (pct <= -UMBRAL) {
      const abs = Math.abs(pct);
      out.push({
        id: `caida:${g.categoria_id}:${g.ambito}`, tipo: 'good', icono: 'trending-down',
        titulo: `${g.nombre} (${ambLabel}) bajó ${abs}%`, subtexto,
        accion: { label: 'Ver historial', href: '#historial' },
        meta: { ambito: g.ambito, categoria_id: g.categoria_id, pct, magnitud: Math.min(1, abs / 100) },
      });
    }
  }
  out.sort((a, b) => Math.abs(b.meta.pct) - Math.abs(a.meta.pct));
  return out.slice(0, 2);
}
```

Add `detectCrecimiento` to the `export { ... }` list.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/insights-crecimiento.test.mjs`
Expected: PASS — 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/insights.js test/insights-crecimiento.test.mjs
git commit -m "feat(insights): category growth/decline detector"
```

---

### Task 3: `detectDiaAnomalo` (weekday spend anomaly)

**Files:**
- Modify: `js/insights.js`
- Test: `test/insights-dia-anomalo.test.mjs`

Logic: over the 90-day window of `gasto` (both ámbitos combined — this is a timing pattern, not a category one). For each weekday, `promWd = sumWeekday / (#distinct fechas con gasto ese weekday)`. Global per-day avg = `totalGasto / (#distinct fechas con gasto)`. Anomaly if `promWd ≥ 1.8 × globalPromedioDia` and that weekday has ≥6 distinct spending dates. Pick the highest-ratio weekday; emit one `info`/`calendar-stats` insight. Guard: total ≥ S/100.

- [ ] **Step 1: Write the failing test**

Create `test/insights-dia-anomalo.test.mjs`:

```js
import assert from 'node:assert';
import { test } from 'node:test';
import { detectDiaAnomalo } from '../js/insights.js';

const HOY = new Date(2026, 5, 21); // domingo 2026-06-21

function gasto(monto, fechaISO, ambito = 'personal') {
  return { tipo: 'gasto', ambito, monto, fecha: fechaISO, categorias: { nombre: 'X' } };
}

test('detecta el weekday con gasto promedio ≥ 1.8x del global', () => {
  const txs = [];
  // 8 viernes con gasto alto (200 c/u). Viernes en abril-junio 2026.
  const viernes = ['2026-04-03', '2026-04-10', '2026-04-17', '2026-04-24',
    '2026-05-01', '2026-05-08', '2026-05-15', '2026-05-22'];
  for (const f of viernes) txs.push(gasto(200, f));
  // 8 lunes con gasto bajo (20 c/u).
  const lunes = ['2026-04-06', '2026-04-13', '2026-04-20', '2026-04-27',
    '2026-05-04', '2026-05-11', '2026-05-18', '2026-05-25'];
  for (const f of lunes) txs.push(gasto(20, f));
  const out = detectDiaAnomalo(txs, { hoy: HOY });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'info');
  assert.strictEqual(out[0].icono, 'calendar-stats');
  assert.match(out[0].titulo, /viernes/);
  assert.strictEqual(out[0].meta.wd, 5); // viernes
});

test('NO dispara si el weekday tiene < 6 ocurrencias', () => {
  const txs = [];
  // Solo 4 viernes altos.
  for (const f of ['2026-05-01', '2026-05-08', '2026-05-15', '2026-05-22']) txs.push(gasto(200, f));
  for (const f of ['2026-05-04', '2026-05-11', '2026-05-18', '2026-05-25', '2026-06-01', '2026-06-08']) txs.push(gasto(50, f));
  assert.deepStrictEqual(detectDiaAnomalo(txs, { hoy: HOY }), []);
});

test('NO dispara si no hay un weekday 1.8x sobre el resto (gasto uniforme)', () => {
  const txs = [];
  const fechas = ['2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10',
    '2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17',
    '2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08',
    '2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15'];
  for (const f of fechas) txs.push(gasto(50, f));
  assert.deepStrictEqual(detectDiaAnomalo(txs, { hoy: HOY }), []);
});

test('NO dispara si el total < S/100', () => {
  const txs = [gasto(5, '2026-05-01'), gasto(5, '2026-05-08')];
  assert.deepStrictEqual(detectDiaAnomalo(txs, { hoy: HOY }), []);
});

test('array vacío → []', () => {
  assert.deepStrictEqual(detectDiaAnomalo([], { hoy: HOY }), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/insights-dia-anomalo.test.mjs`
Expected: FAIL — `detectDiaAnomalo is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `js/insights.js`, add before the dual-export block:

```js
// detectDiaAnomalo(transacciones, { hoy, factor?, minOcc?, minTotal? })
// Detecta el día de la semana con gasto promedio ≥ factor× el promedio diario
// global (ventana 90d, gasto de ambos ámbitos). Devuelve 1 insight info o [].
function detectDiaAnomalo(transacciones, opts) {
  const hoy = opts.hoy;
  const FACTOR = opts.factor != null ? opts.factor : 1.8;
  const MIN_OCC = opts.minOcc != null ? opts.minOcc : 6;
  const MIN_TOTAL = opts.minTotal != null ? opts.minTotal : 100;
  const desde = diaISO(restarDias(hoy, 90));
  const hoyISO = diaISO(hoy);

  const sumPorDia = [0, 0, 0, 0, 0, 0, 0];
  const fechasPorWd = [new Set(), new Set(), new Set(), new Set(), new Set(), new Set(), new Set()];
  const fechasTotal = new Set();
  let total = 0;
  for (const t of transacciones) {
    if (t.tipo !== 'gasto' || !t.fecha) continue;
    if (t.fecha < desde || t.fecha > hoyISO) continue;
    const wd = parseFechaISO(t.fecha).getDay();
    const m = Number(t.monto);
    sumPorDia[wd] += m; total += m;
    fechasPorWd[wd].add(t.fecha); fechasTotal.add(t.fecha);
  }
  if (total < MIN_TOTAL || fechasTotal.size === 0) return [];
  const promedioGlobalDia = total / fechasTotal.size;
  if (promedioGlobalDia <= 0) return [];

  let mejor = null;
  for (let wd = 0; wd < 7; wd++) {
    const occ = fechasPorWd[wd].size;
    if (occ < MIN_OCC) continue;
    const promWd = sumPorDia[wd] / occ;
    const ratio = promWd / promedioGlobalDia;
    if (ratio >= FACTOR && (!mejor || ratio > mejor.ratio)) {
      mejor = { wd, ratio, promWd, occ };
    }
  }
  if (!mejor) return [];

  const otrosDias = fechasTotal.size - mejor.occ;
  const promOtros = otrosDias > 0 ? (total - sumPorDia[mejor.wd]) / otrosDias : 0;
  const veces = Math.round(mejor.ratio * 10) / 10;
  const dia = DIAS_PLURAL[mejor.wd];
  return [{
    id: `dia-anomalo:${mejor.wd}`, tipo: 'info', icono: 'calendar-stats',
    titulo: `Gastas ${veces}x más los ${dia}`,
    subtexto: `${fmtS(mejor.promWd)} en promedio los ${dia} vs ${fmtS(promOtros)} los demás días`,
    accion: null,
    meta: { wd: mejor.wd, ratio: mejor.ratio, magnitud: Math.min(1, (mejor.ratio - 1) / 2) },
  }];
}
```

Add `detectDiaAnomalo` to the `export { ... }` list.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/insights-dia-anomalo.test.mjs`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/insights.js test/insights-dia-anomalo.test.mjs
git commit -m "feat(insights): weekday spend anomaly detector"
```

---

### Task 4: `detectProyeccionMeta` (goal ETA projection)

**Files:**
- Modify: `js/insights.js`
- Test: `test/insights-proyeccion-meta.test.mjs`

Logic: for each `en_curso`, non-`es_fondo_emergencia` meta with `monto_objetivo`, `fecha_limite`, `fecha_inicio`, and `monto_actual > 0`: `ritmoDiario = monto_actual / diasTranscurridos`; `diasFalt = ceil((objetivo - actual) / ritmoDiario)`; `proy = hoy + diasFalt`. If `proy ≤ fecha_limite` → `good`/`target-arrow` ("alcanzas … en {mes}"); else `warn`/`target-arrow` ("va atrasada ~{atraso}"). Skip if already reached (`restante ≤ 0`).

- [ ] **Step 1: Write the failing test**

Create `test/insights-proyeccion-meta.test.mjs`:

```js
import assert from 'node:assert';
import { test } from 'node:test';
import { detectProyeccionMeta } from '../js/insights.js';

const HOY = new Date(2026, 5, 21); // 2026-06-21

test('meta en camino → good, proyecta el mes de llegada', () => {
  // Inició hace 100 días, lleva 1000 → ritmo 10/día. Faltan 500 → 50 días → ~10 ago.
  const metas = [{
    id: 'm1', nombre: 'Vacaciones', ambito: 'personal', estado: 'en_curso',
    es_fondo_emergencia: false, monto_objetivo: 1500, monto_actual: 1000,
    fecha_inicio: '2026-03-13', fecha_limite: '2026-12-31',
  }];
  const out = detectProyeccionMeta(metas, { hoy: HOY });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'good');
  assert.strictEqual(out[0].icono, 'target-arrow');
  assert.match(out[0].titulo, /alcanzas Vacaciones en agosto/);
  assert.strictEqual(out[0].meta.meta_id, 'm1');
});

test('meta atrasada → warn', () => {
  // Inició hace 100 días, lleva 200 → ritmo 2/día. Faltan 800 → 400 días → pasa el límite.
  const metas = [{
    id: 'm2', nombre: 'Auto', ambito: 'personal', estado: 'en_curso',
    es_fondo_emergencia: false, monto_objetivo: 1000, monto_actual: 200,
    fecha_inicio: '2026-03-13', fecha_limite: '2026-08-31',
  }];
  const out = detectProyeccionMeta(metas, { hoy: HOY });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'warn');
  assert.match(out[0].titulo, /Auto va atrasada/);
});

test('ignora fondo de emergencia', () => {
  const metas = [{
    id: 'f1', nombre: 'Fondo', ambito: 'personal', estado: 'en_curso',
    es_fondo_emergencia: true, monto_objetivo: 1000, monto_actual: 500,
    fecha_inicio: '2026-03-13', fecha_limite: '2026-12-31',
  }];
  assert.deepStrictEqual(detectProyeccionMeta(metas, { hoy: HOY }), []);
});

test('ignora metas sin aporte (monto_actual 0) o sin fechas', () => {
  const metas = [
    { id: 'a', nombre: 'A', estado: 'en_curso', es_fondo_emergencia: false, monto_objetivo: 1000, monto_actual: 0, fecha_inicio: '2026-03-13', fecha_limite: '2026-12-31' },
    { id: 'b', nombre: 'B', estado: 'en_curso', es_fondo_emergencia: false, monto_objetivo: 1000, monto_actual: 500, fecha_inicio: null, fecha_limite: '2026-12-31' },
  ];
  assert.deepStrictEqual(detectProyeccionMeta(metas, { hoy: HOY }), []);
});

test('ignora meta ya alcanzada (restante ≤ 0)', () => {
  const metas = [{
    id: 'c', nombre: 'C', estado: 'en_curso', es_fondo_emergencia: false,
    monto_objetivo: 1000, monto_actual: 1200, fecha_inicio: '2026-03-13', fecha_limite: '2026-12-31',
  }];
  assert.deepStrictEqual(detectProyeccionMeta(metas, { hoy: HOY }), []);
});

test('array vacío → []', () => {
  assert.deepStrictEqual(detectProyeccionMeta([], { hoy: HOY }), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/insights-proyeccion-meta.test.mjs`
Expected: FAIL — `detectProyeccionMeta is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `js/insights.js`, add before the dual-export block:

```js
// detectProyeccionMeta(metas, { hoy }) — proyecta, al ritmo actual de aporte,
// si cada meta en curso llegará a su objetivo antes de su fecha límite.
// good = llega a tiempo; warn = se atrasa. Ignora fondos de emergencia.
function detectProyeccionMeta(metas, opts) {
  const hoy = opts.hoy;
  const out = [];
  for (const m of metas) {
    if (m.es_fondo_emergencia) continue;
    if (m.estado !== 'en_curso') continue;
    const objetivo = Number(m.monto_objetivo);
    const actual = Number(m.monto_actual);
    if (!objetivo || objetivo <= 0) continue;
    if (!m.fecha_limite || !m.fecha_inicio) continue;
    if (!(actual > 0)) continue;

    const inicio = parseFechaISO(m.fecha_inicio);
    const limite = parseFechaISO(m.fecha_limite);
    const diasTranscurridos = Math.floor((hoy - inicio) / 86400000);
    if (diasTranscurridos <= 0) continue;
    const restante = objetivo - actual;
    if (restante <= 0) continue;
    const ritmoDiario = actual / diasTranscurridos;
    if (!(ritmoDiario > 0)) continue;

    const diasFalt = Math.ceil(restante / ritmoDiario);
    const proy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + diasFalt);

    if (proy <= limite) {
      const holguraDias = Math.floor((limite - proy) / 86400000);
      out.push({
        id: `meta-ok:${m.id}`, tipo: 'good', icono: 'target-arrow',
        titulo: `A este ritmo alcanzas ${m.nombre} en ${MESES[proy.getMonth()]}`,
        subtexto: `Proyección ${diaISO(proy)} · meta ${m.fecha_limite}`,
        accion: { label: 'Ver meta', href: '#metas' },
        meta: { ambito: m.ambito, meta_id: m.id, magnitud: Math.min(1, holguraDias / 90) },
      });
    } else {
      const atrasoDias = Math.floor((proy - limite) / 86400000);
      const meses = Math.round(atrasoDias / 30);
      const atrasoTxt = atrasoDias >= 30
        ? `${meses} mes${meses === 1 ? '' : 'es'}`
        : `${atrasoDias} día${atrasoDias === 1 ? '' : 's'}`;
      out.push({
        id: `meta-tarde:${m.id}`, tipo: 'warn', icono: 'target-arrow',
        titulo: `${m.nombre} va atrasada ~${atrasoTxt}`,
        subtexto: `A este ritmo llegas el ${diaISO(proy)} · meta ${m.fecha_limite}`,
        accion: { label: 'Ver meta', href: '#metas' },
        meta: { ambito: m.ambito, meta_id: m.id, magnitud: Math.min(1, atrasoDias / 90) },
      });
    }
  }
  return out;
}
```

Add `detectProyeccionMeta` to the `export { ... }` list.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/insights-proyeccion-meta.test.mjs`
Expected: PASS — 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/insights.js test/insights-proyeccion-meta.test.mjs
git commit -m "feat(insights): goal ETA projection detector"
```

---

### Task 5: `detectRitmoMensual` (current-month spend pace vs last month)

**Files:**
- Modify: `js/insights.js`
- Test: `test/insights-ritmo-mensual.test.mjs`

Logic: `gastoMes` = sum of `gasto` from the 1st of the current month to `hoy` (both ámbitos). `proyeccion = gastoMes / diaDelMes * diasDelMes`. `gastoPrev` = total `gasto` of the previous calendar month. `pct = round((proyeccion - gastoPrev) / gastoPrev * 100)`. `pct ≥ +15` → `warn`/`chart-line`; `pct ≤ −15` → `good`. Guards: ≥5 days elapsed this month; `gastoPrev > 0`.

- [ ] **Step 1: Write the failing test**

Create `test/insights-ritmo-mensual.test.mjs`:

```js
import assert from 'node:assert';
import { test } from 'node:test';
import { detectRitmoMensual } from '../js/insights.js';

const HOY = new Date(2026, 5, 21); // 2026-06-21 (junio, 30 días)

function gasto(monto, fechaISO) {
  return { tipo: 'gasto', ambito: 'personal', monto, fecha: fechaISO, categorias: { nombre: 'X' } };
}

test('proyección por encima → warn', () => {
  // Mes pasado (mayo): total 600.
  const txs = [gasto(600, '2026-05-15')];
  // Junio: 700 en 21 días → proyección 700/21*30 = 1000 → +66%.
  txs.push(gasto(700, '2026-06-10'));
  const out = detectRitmoMensual(txs, { hoy: HOY });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'warn');
  assert.strictEqual(out[0].icono, 'chart-line');
  assert.match(out[0].titulo, /más que el mes pasado/);
});

test('proyección por debajo → good', () => {
  const txs = [gasto(1000, '2026-05-15')]; // mayo 1000
  txs.push(gasto(350, '2026-06-10'));       // junio 350/21*30 = 500 → -50%
  const out = detectRitmoMensual(txs, { hoy: HOY });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'good');
  assert.match(out[0].titulo, /menos que el mes pasado/);
});

test('NO dispara si el mes anterior no tiene datos', () => {
  const txs = [gasto(700, '2026-06-10')];
  assert.deepStrictEqual(detectRitmoMensual(txs, { hoy: HOY }), []);
});

test('NO dispara antes del día 5 del mes', () => {
  const hoyTemprano = new Date(2026, 5, 3);
  const txs = [gasto(600, '2026-05-15'), gasto(100, '2026-06-02')];
  assert.deepStrictEqual(detectRitmoMensual(txs, { hoy: hoyTemprano }), []);
});

test('dentro de ±15% → nada', () => {
  const txs = [gasto(700, '2026-05-15')]; // mayo 700
  txs.push(gasto(490, '2026-06-10'));      // junio 490/21*30 = 700 → 0%
  assert.deepStrictEqual(detectRitmoMensual(txs, { hoy: HOY }), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/insights-ritmo-mensual.test.mjs`
Expected: FAIL — `detectRitmoMensual is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `js/insights.js`, add before the dual-export block:

```js
// detectRitmoMensual(transacciones, { hoy, umbralPct?, minDias? })
// Proyecta el gasto total del mes en curso a fin de mes y lo compara con el
// total del mes anterior. warn si sube ≥15%, good si baja ≥15%.
function detectRitmoMensual(transacciones, opts) {
  const hoy = opts.hoy;
  const UMBRAL = opts.umbralPct != null ? opts.umbralPct : 15;
  const MIN_DIAS = opts.minDias != null ? opts.minDias : 5;
  const y = hoy.getFullYear(), mo = hoy.getMonth();
  const diaDelMes = hoy.getDate();
  if (diaDelMes < MIN_DIAS) return [];
  const diasDelMes = new Date(y, mo + 1, 0).getDate();
  const inicioMesISO = diaISO(new Date(y, mo, 1));
  const hoyISO = diaISO(hoy);

  const prevY = mo === 0 ? y - 1 : y;
  const prevMo = mo === 0 ? 11 : mo - 1;
  const inicioPrevISO = diaISO(new Date(prevY, prevMo, 1));
  const finPrevISO = diaISO(new Date(prevY, prevMo, new Date(prevY, prevMo + 1, 0).getDate()));

  let gastoMes = 0, gastoPrev = 0;
  for (const t of transacciones) {
    if (t.tipo !== 'gasto' || !t.fecha) continue;
    if (t.fecha >= inicioMesISO && t.fecha <= hoyISO) gastoMes += Number(t.monto);
    else if (t.fecha >= inicioPrevISO && t.fecha <= finPrevISO) gastoPrev += Number(t.monto);
  }
  if (gastoPrev <= 0) return [];

  const proyeccion = gastoMes / diaDelMes * diasDelMes;
  const pct = Math.round((proyeccion - gastoPrev) / gastoPrev * 100);
  const subtexto = `Proyección ${fmtS(proyeccion)} este mes vs ${fmtS(gastoPrev)} el mes pasado`;
  if (pct >= UMBRAL) {
    return [{
      id: 'ritmo-mes', tipo: 'warn', icono: 'chart-line',
      titulo: `Vas camino a gastar ${pct}% más que el mes pasado`, subtexto,
      accion: null, meta: { pct, magnitud: Math.min(1, pct / 100) },
    }];
  } else if (pct <= -UMBRAL) {
    const abs = Math.abs(pct);
    return [{
      id: 'ritmo-mes', tipo: 'good', icono: 'chart-line',
      titulo: `Vas camino a gastar ${abs}% menos que el mes pasado`, subtexto,
      accion: null, meta: { pct, magnitud: Math.min(1, abs / 100) },
    }];
  }
  return [];
}
```

Add `detectRitmoMensual` to the `export { ... }` list.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/insights-ritmo-mensual.test.mjs`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/insights.js test/insights-ritmo-mensual.test.mjs
git commit -m "feat(insights): monthly spend pace detector"
```

---

### Task 6: `detectBuenMes` (most recent closed month below average)

**Files:**
- Modify: `js/insights.js`
- Test: `test/insights-buen-mes.test.mjs`

Logic: sum `gasto` per calendar month (`'YYYY-MM'`). Drop the current month (`ym ≥ ymActual`). Of the closed months (desc), take the most recent; baseline = average of the rest. Need ≥2 closed months. If `(gastoUlt - promPrevios) / promPrevios ≤ −15%` → `good`/`circle-check`.

- [ ] **Step 1: Write the failing test**

Create `test/insights-buen-mes.test.mjs`:

```js
import assert from 'node:assert';
import { test } from 'node:test';
import { detectBuenMes } from '../js/insights.js';

const HOY = new Date(2026, 5, 21); // junio: mes en curso, se excluye

function gasto(monto, fechaISO) {
  return { tipo: 'gasto', ambito: 'personal', monto, fecha: fechaISO, categorias: { nombre: 'X' } };
}

test('último mes cerrado por debajo del promedio → good', () => {
  const txs = [
    gasto(1000, '2026-03-10'), // marzo 1000
    gasto(1000, '2026-04-10'), // abril 1000
    gasto(700, '2026-05-10'),  // mayo 700 (último cerrado) vs prom 1000 → -30%
    gasto(50, '2026-06-05'),   // junio (en curso) ignorado
  ];
  const out = detectBuenMes(txs, { hoy: HOY });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'good');
  assert.strictEqual(out[0].icono, 'circle-check');
  assert.match(out[0].titulo, /En mayo gastaste 30% menos/);
});

test('NO dispara si el último mes cerrado NO bajó ≥15%', () => {
  const txs = [
    gasto(1000, '2026-03-10'),
    gasto(1000, '2026-04-10'),
    gasto(950, '2026-05-10'), // -5%
  ];
  assert.deepStrictEqual(detectBuenMes(txs, { hoy: HOY }), []);
});

test('NO dispara con menos de 2 meses cerrados', () => {
  const txs = [gasto(700, '2026-05-10'), gasto(50, '2026-06-05')];
  assert.deepStrictEqual(detectBuenMes(txs, { hoy: HOY }), []);
});

test('array vacío → []', () => {
  assert.deepStrictEqual(detectBuenMes([], { hoy: HOY }), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/insights-buen-mes.test.mjs`
Expected: FAIL — `detectBuenMes is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `js/insights.js`, add before the dual-export block:

```js
// detectBuenMes(transacciones, { hoy, umbralPct? }) — compara el gasto del
// último mes calendario CERRADO con el promedio de los meses cerrados previos.
// good si gastó ≥15% menos. Excluye el mes en curso (comparación completa).
function detectBuenMes(transacciones, opts) {
  const hoy = opts.hoy;
  const UMBRAL = opts.umbralPct != null ? opts.umbralPct : 15;
  const porMes = new Map();
  for (const t of transacciones) {
    if (t.tipo !== 'gasto' || !t.fecha) continue;
    const ym = t.fecha.slice(0, 7);
    porMes.set(ym, (porMes.get(ym) || 0) + Number(t.monto));
  }
  const ymActual = diaISO(hoy).slice(0, 7);
  const cerrados = [...porMes.entries()]
    .filter(([ym]) => ym < ymActual)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)); // desc por mes
  if (cerrados.length < 2) return [];

  const [ymUlt, gastoUlt] = cerrados[0];
  const previos = cerrados.slice(1);
  const promPrevios = previos.reduce((s, [, v]) => s + v, 0) / previos.length;
  if (promPrevios <= 0) return [];
  const pct = Math.round((gastoUlt - promPrevios) / promPrevios * 100);
  if (pct > -UMBRAL) return [];

  const abs = Math.abs(pct);
  const mm = Number(ymUlt.split('-')[1]);
  return [{
    id: 'buen-mes', tipo: 'good', icono: 'circle-check',
    titulo: `En ${MESES[mm - 1]} gastaste ${abs}% menos que tu promedio`,
    subtexto: `${fmtS(gastoUlt)} vs ${fmtS(promPrevios)} de promedio mensual`,
    accion: null, meta: { pct, magnitud: Math.min(1, abs / 100) },
  }];
}
```

Add `detectBuenMes` to the `export { ... }` list.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/insights-buen-mes.test.mjs`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/insights.js test/insights-buen-mes.test.mjs
git commit -m "feat(insights): closed-month savings detector"
```

---

### Task 7: `priorizar` + `generarInsights` (scoring, ordering, orchestration)

**Files:**
- Modify: `js/insights.js`
- Test: `test/insights-priorizar.test.mjs`

Logic: `score = pesoTipo[tipo] * (1 + magnitud)` with `pesoTipo = {alert:3, warn:2, good:1.5, info:1}` and `magnitud` from `meta.magnitud` (default 0). Sort desc, cap to 6. `generarInsights({transacciones, categorias, metas, hoy})` runs all detectors (each guarded by try/catch so one failure can't sink the rest), concatenates, and returns `priorizar(...)`. `categorias` is accepted for signature stability but unused (category names ride on `tx.categorias`).

- [ ] **Step 1: Write the failing test**

Create `test/insights-priorizar.test.mjs`:

```js
import assert from 'node:assert';
import { test } from 'node:test';
import { priorizar, generarInsights } from '../js/insights.js';

test('ordena por score desc (pesoTipo * (1+magnitud))', () => {
  const insights = [
    { id: 'i', tipo: 'info', meta: { magnitud: 0.9 } }, // 1 * 1.9 = 1.9
    { id: 'w', tipo: 'warn', meta: { magnitud: 0.1 } }, // 2 * 1.1 = 2.2
    { id: 'g', tipo: 'good', meta: { magnitud: 0 } },   // 1.5 * 1 = 1.5
  ];
  const out = priorizar(insights, {});
  assert.deepStrictEqual(out.map((x) => x.id), ['w', 'i', 'g']);
});

test('capa a 6 cards', () => {
  const insights = Array.from({ length: 10 }, (_, n) => ({ id: 'x' + n, tipo: 'info', meta: { magnitud: 0 } }));
  assert.strictEqual(priorizar(insights, {}).length, 6);
});

test('magnitud ausente cuenta como 0', () => {
  const out = priorizar([{ id: 'a', tipo: 'warn', meta: {} }], {});
  assert.strictEqual(out[0].score, 2);
});

test('generarInsights combina detectores y nunca lanza con datos vacíos', () => {
  const out = generarInsights({ transacciones: [], categorias: [], metas: [], hoy: new Date(2026, 5, 21) });
  assert.ok(Array.isArray(out));
  assert.strictEqual(out.length, 0);
});

test('generarInsights produce insights reales con datos sintéticos', () => {
  const HOY = new Date(2026, 5, 21);
  const txs = [];
  for (const f of ['2026-04-01', '2026-04-15', '2026-05-01', '2026-05-10', '2026-05-15', '2026-05-20']) {
    txs.push({ tipo: 'gasto', ambito: 'personal', categoria_id: 'c1', monto: 50, fecha: f, categorias: { nombre: 'Delivery' } });
  }
  for (const f of ['2026-05-25', '2026-06-05', '2026-06-12', '2026-06-18']) {
    txs.push({ tipo: 'gasto', ambito: 'personal', categoria_id: 'c1', monto: 60, fecha: f, categorias: { nombre: 'Delivery' } });
  }
  const out = generarInsights({ transacciones: txs, categorias: [], metas: [], hoy: HOY });
  assert.ok(out.length >= 1);
  assert.ok(out.some((i) => i.id.startsWith('crecimiento:')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/insights-priorizar.test.mjs`
Expected: FAIL — `priorizar is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `js/insights.js`, add before the dual-export block:

```js
const PESO_TIPO = { alert: 3, warn: 2, good: 1.5, info: 1 };

// priorizar(insights, { cap? }) — calcula score, ordena desc y capa (default 6).
function priorizar(insights, opts) {
  const cap = (opts && opts.cap != null) ? opts.cap : 6;
  const conScore = insights.map((i) => {
    const peso = PESO_TIPO[i.tipo] != null ? PESO_TIPO[i.tipo] : 1;
    const mag = (i.meta && typeof i.meta.magnitud === 'number') ? i.meta.magnitud : 0;
    return Object.assign({}, i, { score: peso * (1 + mag) });
  });
  conScore.sort((a, b) => b.score - a.score);
  return conScore.slice(0, cap);
}

// generarInsights({ transacciones, categorias, metas, hoy }) — orquesta todos
// los detectores (cada uno aislado en try/catch), prioriza y capa. Puro.
function generarInsights(datos) {
  const transacciones = datos.transacciones || [];
  const metas = datos.metas || [];
  const opts = { hoy: datos.hoy || new Date() };
  let all = [];
  const corre = (fn, arg) => { try { all = all.concat(fn(arg, opts)); } catch (e) { console.error('insight detector falló:', e && e.message); } };
  corre(detectCrecimiento, transacciones);
  corre(detectDiaAnomalo, transacciones);
  corre(detectProyeccionMeta, metas);
  corre(detectRitmoMensual, transacciones);
  corre(detectBuenMes, transacciones);
  return priorizar(all, {});
}
```

Add `priorizar` and `generarInsights` to the `export { ... }` list.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/insights-priorizar.test.mjs`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `node --test test/`
Expected: PASS — all insight tests + the existing `sync-lww.test.mjs` pass.

- [ ] **Step 6: Commit**

```bash
git add js/insights.js test/insights-priorizar.test.mjs
git commit -m "feat(insights): scoring + orchestrator (generarInsights)"
```

---

### Task 8: `cargarInsights` impure wrapper + dual-export wiring

**Files:**
- Modify: `js/insights.js`

No unit test (impure: depends on `db.js` globals + `new Date()`). Its only non-trivial logic — the 90-day slice — is `filtrarVentana`, already tested in Task 1.

- [ ] **Step 1: Add the wrapper and finish the `window` block**

In `js/insights.js`, replace the placeholder `window` block with:

```js
// cargarInsights() — ÚNICA parte impura. Lee de db.js (globales en window),
// recorta a 90 días y delega en generarInsights. try/catch → [] (nunca tumba
// el dashboard). No se unit-testea; la lógica de recorte vive en filtrarVentana.
async function cargarInsights() {
  try {
    const [transacciones, categorias, metas] = await Promise.all([
      window.getTransacciones(),
      window.getCategorias(),
      window.getMetas(),
    ]);
    const hoy = new Date();
    const recientes = filtrarVentana(transacciones || [], hoy, 90);
    return generarInsights({ transacciones: recientes, categorias: categorias || [], metas: metas || [], hoy });
  } catch (err) {
    console.error('Error en cargarInsights():', err && (err.message || err));
    return [];
  }
}

if (typeof window !== 'undefined') {
  window.generarInsights = generarInsights;
  window.cargarInsights = cargarInsights;
}
```

Add `cargarInsights` to the `export { ... }` list.

- [ ] **Step 2: Sanity-check the module still imports cleanly**

Run: `node --test test/`
Expected: PASS — adding `cargarInsights` (which references `window` only at call time) does not break any import.

- [ ] **Step 3: Commit**

```bash
git add js/insights.js
git commit -m "feat(insights): cargarInsights wrapper + window exports"
```

---

### Task 9: Load `insights.js` in `index.html`

**Files:**
- Modify: `index.html:149`

- [ ] **Step 1: Add the module script after `alerts.js`**

In `index.html`, find:

```html
    <script src="js/alerts.js"></script>
    <script src="js/router.js"></script>
```

Change to:

```html
    <script src="js/alerts.js"></script>
    <script type="module" src="js/insights.js"></script>
    <script src="js/router.js"></script>
```

`type="module"` is required (the file uses `export`). `cargarInsights` references `window.getTransacciones` etc. at call time, so load order vs `db.js` is irrelevant.

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat(insights): load insights.js module in app shell"
```

---

### Task 10: Dashboard render — mobile-first card carousel

**Files:**
- Modify: `views/dashboard.html` (HTML section, CSS, `<script>` render + wiring)

The dashboard `<script>` already defines `esc()` and `$()` helpers and a `cargar()` async IIFE using `Promise.allSettled`. We add a section, a `renderInsights()` function, CSS, and one more entry in the settled array.

- [ ] **Step 1: Add the section markup**

In `views/dashboard.html`, find the alerts section:

```html
  <!-- ── SECCIÓN 4 — Alertas ──────────────────────────────────── -->
  <section id="dashAlertas" class="dash-alertas" aria-live="polite" aria-label="Alertas activas"></section>
```

Insert immediately ABOVE it:

```html
  <!-- ── SECCIÓN 3.5 — Insights ───────────────────────────────── -->
  <section id="dashInsights" class="dash-insights" aria-label="Insights" aria-live="polite"></section>

```

- [ ] **Step 2: Add the carousel CSS**

In `views/dashboard.html`, inside the `<style>` block, just before the `/* ── Alertas ── */` comment, add:

```css
  /* ── Insights (carrusel mobile-first) ──────────────────── */
  .dash-insights:not(:empty) { margin-bottom: var(--space-md); }
  .dash-insights-track {
    display: flex;
    gap: var(--space-sm);
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    /* sangra a los bordes de pantalla en móvil → swipe edge-to-edge */
    margin-inline: calc(-1 * var(--space-md));
    padding-inline: var(--space-md);
    padding-bottom: var(--space-xs);
    scrollbar-width: thin;
  }
  .insight-card {
    flex: 0 0 auto;
    width: min(85%, 300px);
    scroll-snap-align: start;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding: var(--space-md);
    border-radius: var(--radius-md);
    border-left: 4px solid var(--border-light);
    background: var(--bg-light-secondary);
    box-shadow: var(--shadow-sm);
  }
  .insight-card--warn { border-left-color: var(--color-warning); }
  .insight-card--good { border-left-color: var(--color-success); }
  .insight-card--alert { border-left-color: var(--color-danger); }
  .insight-card--info { border-left-color: var(--color-primary); }
  .insight-icono .cat-icono { width: 24px; height: 24px; }
  .insight-titulo {
    margin: 0;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-bold);
    color: var(--text-dark);
    line-height: 1.25;
  }
  .insight-subtexto {
    margin: 0;
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    line-height: 1.35;
  }
  .insight-accion {
    margin-top: auto;
    padding-top: var(--space-xs);
    min-height: 44px;            /* target táctil */
    display: inline-flex;
    align-items: center;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--color-primary);
    text-decoration: none;
  }
  .insight-accion:hover { text-decoration: underline; }
  @media (min-width: 600px) {
    .insight-card { width: 280px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .dash-insights-track { scroll-behavior: auto; }
  }
```

- [ ] **Step 3: Add the `renderInsights` function**

In the `<script>` block of `views/dashboard.html`, just after the `renderAlertas` function definition, add:

```js
    // ── Render: insights (carrusel horizontal) ────────────────
    function renderInsights(insights) {
      const cont = $('dashInsights');
      if (!cont) return;
      if (!insights || !insights.length) { cont.innerHTML = ''; return; }
      const cards = insights.map((i) => {
        const icon = (typeof iconoCategoria === 'function') ? iconoCategoria(i.icono) : '';
        const accion = i.accion
          ? `<a class="insight-accion" href="${esc(i.accion.href)}">${esc(i.accion.label)} →</a>`
          : '';
        return `<article class="insight-card insight-card--${esc(i.tipo)}">
          <div class="insight-icono" aria-hidden="true">${icon}</div>
          <h3 class="insight-titulo">${esc(i.titulo)}</h3>
          <p class="insight-subtexto">${esc(i.subtexto)}</p>
          ${accion}
        </article>`;
      }).join('');
      cont.innerHTML = `<div class="dash-insights-track">${cards}</div>`;
    }
```

- [ ] **Step 4: Wire `cargarInsights` into the parallel load**

In the `cargar()` IIFE, the current `Promise.allSettled` destructures 9 results. Add insights as a 10th. Find:

```js
      const [hogar, personal, alertas, txs, metas, acumHogar, acumPersonal, ahorrosHogar, ahorrosPersonal] = await Promise.allSettled([
        getBalanceHogar(mes, anio),
        getBalancePersonal(mes, anio),
        evaluarAlertas(mes, anio),
        getUltimasTransacciones(5),
        getMetas(),
        getSaldoAcumuladoHogar(),
        getSaldoAcumuladoPersonal(),
        getAhorrosHogar(mes, anio),
        getAhorrosPersonal(mes, anio),
      ]);
```

Change to:

```js
      const [hogar, personal, alertas, txs, metas, acumHogar, acumPersonal, ahorrosHogar, ahorrosPersonal, insights] = await Promise.allSettled([
        getBalanceHogar(mes, anio),
        getBalancePersonal(mes, anio),
        evaluarAlertas(mes, anio),
        getUltimasTransacciones(5),
        getMetas(),
        getSaldoAcumuladoHogar(),
        getSaldoAcumuladoPersonal(),
        getAhorrosHogar(mes, anio),
        getAhorrosPersonal(mes, anio),
        cargarInsights(),
      ]);
```

Then, find:

```js
      if (alertas.status === 'fulfilled')  renderAlertas(alertas.value);
```

Add immediately after it:

```js
      if (insights.status === 'fulfilled') renderInsights(insights.value);
```

- [ ] **Step 5: Manual verification in the browser preview**

This is UI; verify via the preview workflow (no automated test). Steps:

1. `preview_start` (project preview config `nestra`, serves on `:5050`).
2. Log in with the test account (see memory `nestra-v2-test-account`): in the preview console, `await supabase.auth.signInWithPassword({ email:'nestra.pwa.test@gmail.com', password:'Test!Pwa-2026-throwaway' })` then `localStorage.setItem('sb-token', <access_token>)`, reload to `#dashboard`.
3. The test account may have little history → insights may legitimately be empty. To force-verify rendering, in the console run:
   `renderInsights(generarInsights({ transacciones:[], metas:[], categorias:[], hoy:new Date() }))` returns nothing, so instead synthesize: build a small `txs` array (like the Task 7 fixture, but with `fecha` values within the last 90 days of *today*) and call `renderInsights(generarInsights({transacciones:txs, metas:[], categorias:[], hoy:new Date()}))`.
4. `preview_console_logs` → confirm no errors.
5. `preview_snapshot` → confirm the `#dashInsights` carousel shows cards with Tabler SVG icons (NOT emojis), title, subtext, and an action link where present.
6. `preview_resize` to a narrow mobile width → confirm cards are `~85%` wide, the next card peeks, and horizontal swipe/scroll works with snap.
7. `preview_screenshot` → attach as proof.

- [ ] **Step 6: Commit**

```bash
git add views/dashboard.html
git commit -m "feat(insights): mobile-first insight carousel on dashboard"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Catalog #1 growth → Task 2. #2 decline → Task 2 (same detector). #3 weekday anomaly → Task 3. #4/#5 goal projection → Task 4. #6 monthly pace → Task 5. #7 closed-month savings → Task 6. ✓
- Insight shape (id/tipo/icono/titulo/subtexto/accion/score/meta) → defined in Tasks 2–7. ✓
- Tabler icons (no emojis), `iconoCategoria()` render → Task 10 Step 3 + verified Step 5. ✓
- Priority scoring + cap 6 → Task 7. ✓
- Pure detectors + dual-export + `cargarInsights` impure wrapper → Tasks 1–8. ✓
- 90-day slice via tested helper → `filtrarVentana`, Task 1. ✓
- Mobile-first carousel (snap, edge-bleed, 44px target, reduced-motion) → Task 10 Step 2. ✓
- TDD per detector with fire / no-fire / edge / determinism cases → Tasks 2–7. ✓
- Both ámbitos, tagged → Task 2 titles include `(personal)`/`(hogar)`; weekday/pace are intentionally combined (noted). ✓
- Budget stays in alerts.js (no overlap) → no budget detector in this plan. ✓
- No dismissal / no persistence → cards recompute each load (Task 10). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test shows assertions. ✓

**Type consistency:** `detectCrecimiento`, `detectDiaAnomalo`, `detectProyeccionMeta`, `detectRitmoMensual`, `detectBuenMes`, `priorizar`, `generarInsights`, `cargarInsights`, `filtrarVentana`, `diaISO`, `restarDias`, `parseFechaISO`, `fmtS` — names identical across definitions, exports, and call sites. Detector signature `(datos, opts)` with `opts.hoy` is uniform. `meta.magnitud` produced by every detector and consumed by `priorizar`. ✓
