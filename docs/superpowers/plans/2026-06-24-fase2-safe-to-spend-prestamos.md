# Fase 2 — Safe-to-spend + Insight de préstamos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir las dos piezas faltantes de la Fase 2 — el número hero "safe-to-spend" del dashboard y el insight de préstamos dados sin cobrar.

**Architecture:** Lógica pura y determinista (inyectando `hoy`), testeada con datos sintéticos. Safe-to-spend en módulo nuevo `js/safe-to-spend.js` (dual-export window+ESM como `insights.js`); detector de préstamos dentro de `insights.js`. Loaders impuros leen de `db.js`. Render en `views/dashboard.html`; registro de script en `index.html` y precache en `sw.js`.

**Tech Stack:** Vanilla JS (sin build), ESM dual-export, `node:test` para pruebas, Supabase/IndexedDB vía `db.js`.

---

## File Structure

- **Create:** `js/safe-to-spend.js` — safe-to-spend personal (puro `calcularSafeToSpend` + impuro `cargarSafeToSpend`).
- **Create:** `test/safe-to-spend.test.mjs` — pruebas de `calcularSafeToSpend`.
- **Create:** `test/insights-prestamos.test.mjs` — pruebas de `detectPrestamosSinCobro`.
- **Modify:** `js/insights.js` — `detectPrestamosSinCobro` + threading de `prestamos` por `generarInsights`/`cargarInsights`; exportarlo.
- **Modify:** `views/dashboard.html` — sección hero `#dashSafeToSpend`, estilos `.dash-s2s`, `renderSafeToSpend`, loader en `Promise.allSettled`.
- **Modify:** `index.html:203` — `<script type="module" src="js/safe-to-spend.js">` tras `insights.js`.
- **Modify:** `sw.js:15` (bump `SHELL_VERSION` a `v9`) y `sw.js:31` (+ entrada precache `js/safe-to-spend.js`).

**Convención de tests (existente):** `import { test } from 'node:test'`, `import assert from 'node:assert'`, import desde `'../js/<mod>.js'`. Correr glob entre comillas: `node --test "test/*.test.mjs"`.

---

## Task 1: Detector de préstamos sin cobro (`detectPrestamosSinCobro`)

**Files:**
- Test: `test/insights-prestamos.test.mjs` (create)
- Modify: `js/insights.js` (añadir detector antes de `const PESO_TIPO`, línea ~305; añadir al `export` final línea 359)

- [ ] **Step 1: Write the failing test**

Create `test/insights-prestamos.test.mjs`:

```javascript
import assert from 'node:assert';
import { test } from 'node:test';
import { detectPrestamosSinCobro } from '../js/insights.js';

const HOY = new Date(2026, 5, 24); // 2026-06-24

// Fila de préstamo como la entrega getPrestamos(): transacción embebida + deudor + estado.
function prestamo(deudor, monto, fechaISO, estado = 'pendiente') {
  return { id: deudor + ':' + fechaISO, deudor, estado, transacciones: { fecha: fechaISO, monto, ambito: 'personal', nota: '' } };
}

test('préstamo pendiente sobre el umbral → warn con monto y días', () => {
  const out = detectPrestamosSinCobro([prestamo('Ana', 200, '2026-05-01')], { hoy: HOY });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'warn');
  assert.strictEqual(out[0].icono, 'cash');
  assert.match(out[0].titulo, /S\/200/);
  assert.match(out[0].subtexto, /54 días sin cobrar a Ana/); // 24-may a 24-jun... 1-may→24-jun = 54
  assert.strictEqual(out[0].accion.href, '#prestamos');
});

test('préstamo bajo el umbral → []', () => {
  const out = detectPrestamosSinCobro([prestamo('Ana', 200, '2026-06-10')], { hoy: HOY }); // 14 días
  assert.deepStrictEqual(out, []);
});

test('agrupa por deudor: suma montos y usa la fecha más antigua', () => {
  const txs = [prestamo('Beto', 100, '2026-05-20'), prestamo('Beto', 50, '2026-03-01')];
  const out = detectPrestamosSinCobro(txs, { hoy: HOY });
  assert.strictEqual(out.length, 1);
  assert.match(out[0].titulo, /S\/150/);            // 100+50
  assert.match(out[0].subtexto, /115 días/);         // desde 2026-03-01 (más antiguo)
});

test('ignora devueltos', () => {
  const out = detectPrestamosSinCobro([prestamo('Ana', 200, '2026-01-01', 'devuelto')], { hoy: HOY });
  assert.deepStrictEqual(out, []);
});

test('múltiples deudores: ordena por monto×días desc', () => {
  const txs = [prestamo('Chico', 50, '2026-05-01'), prestamo('Dani', 500, '2026-05-15')];
  const out = detectPrestamosSinCobro(txs, { hoy: HOY });
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].meta.deudor, 'Dani'); // 500×40 > 50×54
});

test('sin datos → []', () => {
  assert.deepStrictEqual(detectPrestamosSinCobro([], { hoy: HOY }), []);
  assert.deepStrictEqual(detectPrestamosSinCobro(undefined, { hoy: HOY }), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "test/insights-prestamos.test.mjs"`
Expected: FAIL — `detectPrestamosSinCobro` no exportado (undefined is not a function).

- [ ] **Step 3: Write minimal implementation**

En `js/insights.js`, insertar antes de `const PESO_TIPO = ...` (línea ~305):

```javascript
// detectPrestamosSinCobro(prestamos, { hoy, diasUmbral? })
// Préstamos DADOS pendientes agrupados por deudor; si el más antiguo lleva más
// de `diasUmbral` días sin cobrar → warn. Sumamos el monto del deudor y usamos
// su préstamo más antiguo para los días. Asimétrico a propósito: el esquema solo
// modela préstamos dados (no deudas propias). Ordena por monto×días.
function detectPrestamosSinCobro(prestamos, opts) {
  const hoy = opts.hoy;
  const UMBRAL = opts.diasUmbral != null ? opts.diasUmbral : 30;
  const porDeudor = new Map();
  for (const p of (prestamos || [])) {
    if (!p || p.estado !== 'pendiente') continue;
    const tx = p.transacciones;
    if (!tx || !tx.fecha) continue;
    const deudor = (p.deudor || '').trim() || 'alguien';
    let g = porDeudor.get(deudor);
    if (!g) { g = { deudor, monto: 0, fechaMin: tx.fecha }; porDeudor.set(deudor, g); }
    g.monto += Number(tx.monto) || 0;
    if (tx.fecha < g.fechaMin) g.fechaMin = tx.fecha;
  }
  const out = [];
  for (const g of porDeudor.values()) {
    const dias = Math.floor((hoy - parseFechaISO(g.fechaMin)) / 86400000);
    if (dias <= UMBRAL) continue;
    out.push({
      id: 'prestamo:' + g.deudor, tipo: 'warn', icono: 'cash',
      titulo: `Te deben ${fmtS(g.monto)}`,
      subtexto: `${dias} días sin cobrar a ${g.deudor}`,
      accion: { label: 'Ver préstamos', href: '#prestamos' },
      meta: { deudor: g.deudor, dias, monto: g.monto, magnitud: Math.min(1, dias / 90) },
    });
  }
  out.sort((a, b) => (b.meta.monto * b.meta.dias) - (a.meta.monto * a.meta.dias));
  return out;
}
```

En el `export { ... }` final (línea 359), añadir `detectPrestamosSinCobro` a la lista.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "test/insights-prestamos.test.mjs"`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add js/insights.js test/insights-prestamos.test.mjs
git commit -m "feat(fase2): detector de prestamos sin cobro"
```

---

## Task 2: Threading de préstamos en `generarInsights` / `cargarInsights`

**Files:**
- Modify: `js/insights.js:321-333` (`generarInsights`) y `js/insights.js:338-352` (`cargarInsights`)
- Test: `test/insights-generar.test.mjs` (añadir caso) — verificar import actual del archivo antes de editar.

- [ ] **Step 1: Write the failing test**

Añadir a `test/insights-generar.test.mjs` (usa `generarInsights` ya importado allí):

```javascript
test('generarInsights incluye insight de préstamos cuando se pasan', () => {
  const hoy = new Date(2026, 5, 24);
  const prestamos = [{ deudor: 'Ana', estado: 'pendiente', transacciones: { fecha: '2026-04-01', monto: 300 } }];
  const out = generarInsights({ transacciones: [], categorias: [], metas: [], prestamos, hoy });
  assert.ok(out.some((i) => i.id === 'prestamo:Ana'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "test/insights-generar.test.mjs"`
Expected: FAIL — `generarInsights` ignora `prestamos`, ningún insight `prestamo:Ana`.

- [ ] **Step 3: Write minimal implementation**

En `js/insights.js`, dentro de `generarInsights` (línea ~321), tras `const metas = datos.metas || [];` añadir:

```javascript
  const prestamos = datos.prestamos || [];
```

y tras `corre(detectBuenMes, transacciones);` (línea ~331) añadir:

```javascript
  corre(detectPrestamosSinCobro, prestamos);
```

En `cargarInsights` (línea ~338), cambiar el `Promise.all` para incluir préstamos pendientes:

```javascript
    const [transacciones, categorias, metas, prestamos] = await Promise.all([
      window.getTransacciones(),
      window.getCategorias(),
      window.getMetas(),
      window.getPrestamos('pendiente'),
    ]);
    const hoy = new Date();
    const recientes = filtrarVentana(transacciones || [], hoy, 90);
    return generarInsights({ transacciones: recientes, categorias: categorias || [], metas: metas || [], prestamos: prestamos || [], hoy });
```

Nota: los préstamos NO se recortan con `filtrarVentana` — un préstamo viejo sin cobrar es justo lo que se quiere detectar.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "test/insights-generar.test.mjs"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/insights.js test/insights-generar.test.mjs
git commit -m "feat(fase2): threading de prestamos en generarInsights/cargarInsights"
```

---

## Task 3: Safe-to-spend puro — esqueleto, días restantes y guardas básicas

**Files:**
- Create: `js/safe-to-spend.js`
- Test: `test/safe-to-spend.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `test/safe-to-spend.test.mjs`:

```javascript
import assert from 'node:assert';
import { test } from 'node:test';
import { calcularSafeToSpend } from '../js/safe-to-spend.js';

// Junio 2026 tiene 30 días. HOY = día 24 → díasRestantes = 30-24+1 = 7.
const HOY = new Date(2026, 5, 24);

function ing(monto, fechaISO) { return { tipo: 'ingreso', ambito: 'personal', monto, fecha: fechaISO }; }
function gas(monto, fechaISO, categoria_id = 'c1') { return { tipo: 'gasto', ambito: 'personal', monto, fecha: fechaISO, categoria_id }; }

test('sin ingreso estimado → null', () => {
  assert.strictEqual(calcularSafeToSpend([], [], { hoy: HOY }), null);
});

test('ingreso del mes, sin gastos ni fijos ni metas → reparte entre días restantes', () => {
  // Ingreso 2100 este mes, nada gastado. díasRestantes = 7. diario = 2100/7 = 300.
  const out = calcularSafeToSpend([ing(2100, '2026-06-05')], [], { hoy: HOY });
  assert.strictEqual(out.estado, 'ok');
  assert.strictEqual(out.diario, 300);
  assert.strictEqual(out.restanteMes, 2100);
  assert.strictEqual(out.diasRestantes, 7);
});

test('gasto acumulado reduce el disponible', () => {
  // Ingreso 2100, gastado 700 este mes (variable). restante = 1400 / 7 = 200.
  const out = calcularSafeToSpend([ing(2100, '2026-06-05'), gas(700, '2026-06-10')], [], { hoy: HOY });
  assert.strictEqual(out.diario, 200);
});

test('numerador negativo → estado excedido, sin número negativo', () => {
  const out = calcularSafeToSpend([ing(500, '2026-06-05'), gas(900, '2026-06-10')], [], { hoy: HOY });
  assert.strictEqual(out.estado, 'excedido');
  assert.strictEqual(out.exceso, 400);
});

test('solo cuenta ámbito personal', () => {
  const txs = [ing(2100, '2026-06-05'), { tipo: 'gasto', ambito: 'hogar', monto: 9999, fecha: '2026-06-10', categoria_id: 'c1' }];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 300); // gasto de hogar ignorado
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "test/safe-to-spend.test.mjs"`
Expected: FAIL — módulo no existe / `calcularSafeToSpend` undefined.

- [ ] **Step 3: Write minimal implementation**

Create `js/safe-to-spend.js`:

```javascript
// ─────────────────────────────────────────────────────────────────
// Nestra — safe-to-spend.js
// "¿Cuánto puedo gastar hoy?" — el número hero del dashboard (Fase 2).
// Ámbito PERSONAL, periodo = mes calendario actual. Puro y determinista
// (hoy inyectado); única parte impura: cargarSafeToSpend() lee de db.js.
// Patrón dual-export como insights.js. Un número malo mata la confianza →
// guardas estrictas: sin ingreso estimable devuelve null; nunca negativo crudo.
// ─────────────────────────────────────────────────────────────────
'use strict';

// fmtS — idéntico a insights.js (se duplica deliberadamente: módulos independientes).
function fmtS(n) {
  const r = Math.round(Number(n) || 0);
  return 'S/' + String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function parseFechaISO(iso) {
  const [y, m, dd] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, dd);
}

function diaISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// mediana(nums) — mediana numérica (ordena copia). [] → 0.
function mediana(nums) {
  const a = nums.slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// calcularSafeToSpend(transacciones, metas, { hoy }) — número hero personal.
// Devuelve null (no mostrar) | {estado:'ok',diario,restanteMes,diasRestantes}
// | {estado:'excedido',exceso,diasRestantes}.
function calcularSafeToSpend(transacciones, metas, opts) {
  const hoy = opts.hoy;
  const y = hoy.getFullYear(), mo = hoy.getMonth();
  const diasDelMes = new Date(y, mo + 1, 0).getDate();
  const diasRestantes = diasDelMes - hoy.getDate() + 1; // incluye hoy, ≥1
  const ymActual = diaISO(hoy).slice(0, 7);

  const personales = (transacciones || []).filter((t) => t.ambito === 'personal' && t.fecha);

  // Ingreso del mes actual.
  let ingresoMes = 0;
  for (const t of personales) {
    if (t.tipo === 'ingreso' && t.fecha.slice(0, 7) === ymActual) ingresoMes += Number(t.monto) || 0;
  }
  const ingresoEstimado = Math.max(ingresoMes, baselineIngreso(personales, ymActual));
  if (ingresoEstimado <= 0) return null;

  // Gasto acumulado del mes (todos los gastos personales del mes).
  let gastoAcumulado = 0;
  for (const t of personales) {
    if (t.tipo === 'gasto' && t.fecha.slice(0, 7) === ymActual) gastoAcumulado += Number(t.monto) || 0;
  }

  const fijosComprometidos = calcularFijosComprometidos(personales, hoy);
  const aporteMetasRestante = calcularAporteMetas(metas, hoy, diasRestantes, diasDelMes);

  const numerador = ingresoEstimado - gastoAcumulado - fijosComprometidos - aporteMetasRestante;
  if (numerador < 0) {
    return { estado: 'excedido', exceso: Math.round(-numerador), diasRestantes };
  }
  return {
    estado: 'ok',
    diario: Math.round(numerador / diasRestantes),
    restanteMes: Math.round(numerador),
    diasRestantes,
  };
}

// Stubs reemplazados en Tasks 4 y 5.
function baselineIngreso(_personales, _ymActual) { return 0; }
function calcularFijosComprometidos(_personales, _hoy) { return 0; }
function calcularAporteMetas(_metas, _hoy, _diasRestantes, _diasDelMes) { return 0; }

async function cargarSafeToSpend() {
  try {
    const [transacciones, metas] = await Promise.all([
      window.getTransacciones(),
      window.getMetas(),
    ]);
    const hoy = new Date();
    return calcularSafeToSpend(transacciones || [], metas || [], { hoy });
  } catch (err) {
    console.error('Error en cargarSafeToSpend():', err && (err.message || err));
    return null;
  }
}

if (typeof window !== 'undefined') {
  window.calcularSafeToSpend = calcularSafeToSpend;
  window.cargarSafeToSpend = cargarSafeToSpend;
}

export { fmtS, mediana, calcularSafeToSpend, baselineIngreso, calcularFijosComprometidos, calcularAporteMetas, cargarSafeToSpend };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "test/safe-to-spend.test.mjs"`
Expected: PASS (5 tests). Con los stubs en 0, baseline=0 e ingresoMes manda; los casos no dependen aún de fijos/metas.

- [ ] **Step 5: Commit**

```bash
git add js/safe-to-spend.js test/safe-to-spend.test.mjs
git commit -m "feat(fase2): safe-to-spend puro (dias restantes + guardas)"
```

---

## Task 4: Baseline de ingreso (bug día-1) y fijos comprometidos

**Files:**
- Modify: `js/safe-to-spend.js` (reemplazar stubs `baselineIngreso` y `calcularFijosComprometidos`)
- Test: `test/safe-to-spend.test.mjs` (añadir casos)

- [ ] **Step 1: Write the failing test**

Añadir a `test/safe-to-spend.test.mjs`:

```javascript
function ing2(monto, fechaISO) { return { tipo: 'ingreso', ambito: 'personal', monto, fecha: fechaISO }; }
function gas2(monto, fechaISO, categoria_id) { return { tipo: 'gasto', ambito: 'personal', monto, fecha: fechaISO, categoria_id }; }

test('baseline cubre el bug día-1: sueldo aún no cae este mes', () => {
  // HOY día 24 pero el sueldo del mes aún no llegó (ingresoMes = 0).
  // Meses cerrados abril+mayo: 3000 c/u → baseline 3000. Sin gastos → 3000/7 ≈ 428.57 → 429.
  const txs = [ing2(3000, '2026-04-10'), ing2(3000, '2026-05-10')];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.estado, 'ok');
  assert.strictEqual(out.diario, 429); // round(3000/7)
});

test('usa el mayor entre ingreso del mes y baseline', () => {
  // Mes actual 4000 > baseline 3000 → usa 4000. Sin gastos → 4000/7 = 571.43 → 571.
  const txs = [ing2(3000, '2026-04-10'), ing2(4000, '2026-06-03')];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 571);
});

test('categoría fija reserva su remanente no pagado', () => {
  // Alquiler 1000 en abril y mayo (≥2 meses cerrados) → fija, estimado 1000.
  // Este mes (junio) aún no se pagó alquiler → comprometido 1000.
  // Ingreso junio 2400, sin otros gastos. (2400 - 0 - 1000) / 7 = 200.
  const txs = [
    ing2(2400, '2026-06-03'),
    gas2(1000, '2026-04-02', 'alquiler'), gas2(1000, '2026-05-02', 'alquiler'),
  ];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 200);
});

test('fija ya pagada este mes no se vuelve a reservar', () => {
  // Mismo alquiler pero ya pagado en junio → comprometido 0, pero gastoAcumulado +1000.
  // (2400 - 1000 - 0) / 7 = 200. (igual número, distinto origen → valida no doble conteo)
  const txs = [
    ing2(2400, '2026-06-03'),
    gas2(1000, '2026-04-02', 'alquiler'), gas2(1000, '2026-05-02', 'alquiler'),
    gas2(1000, '2026-06-02', 'alquiler'),
  ];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 200);
});

test('categoría con un solo mes cerrado no es fija', () => {
  // Solo aparece en mayo → <2 meses → no fija → no reserva.
  // Ingreso 2100, sin gastos en junio. 2100/7 = 300.
  const txs = [ing2(2100, '2026-06-03'), gas2(800, '2026-05-02', 'viaje')];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 300);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "test/safe-to-spend.test.mjs"`
Expected: FAIL — stubs devuelven 0; baseline y fijos no se calculan.

- [ ] **Step 3: Write minimal implementation**

Reemplazar los stubs `baselineIngreso` y `calcularFijosComprometidos` en `js/safe-to-spend.js`:

```javascript
// baselineIngreso — promedio del ingreso personal de hasta 3 meses calendario
// CERRADOS previos (ym < ymActual). Cubre el bug día-1 (sueldo que aún no cae).
function baselineIngreso(personales, ymActual) {
  const porMes = new Map();
  for (const t of personales) {
    if (t.tipo !== 'ingreso') continue;
    const ym = t.fecha.slice(0, 7);
    if (ym >= ymActual) continue;
    porMes.set(ym, (porMes.get(ym) || 0) + (Number(t.monto) || 0));
  }
  const cerrados = [...porMes.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 3);
  if (!cerrados.length) return 0;
  return cerrados.reduce((s, [, v]) => s + v, 0) / cerrados.length;
}

// calcularFijosComprometidos — infiere categorías "fijas" del historial (sin esquema):
// gasto personal en ≥2 de los 3 meses cerrados previos. estimadoMensual = mediana de
// sus totales mensuales. Reserva max(0, estimado − gastadoEsteMes) (remanente no pagado).
function calcularFijosComprometidos(personales, hoy) {
  const ymActual = diaISO(hoy).slice(0, 7);
  // 3 meses cerrados previos (YYYY-MM).
  const cerrados = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    cerrados.push(diaISO(d).slice(0, 7));
  }
  // catId → { ym → total } sobre los meses cerrados.
  const porCat = new Map();
  const gastadoEsteMes = new Map();
  for (const t of personales) {
    if (t.tipo !== 'gasto') continue;
    const ym = t.fecha.slice(0, 7);
    const cat = t.categoria_id != null ? t.categoria_id : '∅';
    const monto = Number(t.monto) || 0;
    if (ym === ymActual) {
      gastadoEsteMes.set(cat, (gastadoEsteMes.get(cat) || 0) + monto);
    } else if (cerrados.includes(ym)) {
      let m = porCat.get(cat);
      if (!m) { m = new Map(); porCat.set(cat, m); }
      m.set(ym, (m.get(ym) || 0) + monto);
    }
  }
  let total = 0;
  for (const [cat, porMes] of porCat) {
    if (porMes.size < 2) continue; // <2 meses cerrados → no fija
    const estimado = mediana([...porMes.values()]);
    const yaPagado = gastadoEsteMes.get(cat) || 0;
    total += Math.max(0, estimado - yaPagado);
  }
  return total;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "test/safe-to-spend.test.mjs"`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add js/safe-to-spend.js test/safe-to-spend.test.mjs
git commit -m "feat(fase2): baseline de ingreso + fijos inferidos del historial"
```

---

## Task 5: Aporte planificado a metas

**Files:**
- Modify: `js/safe-to-spend.js` (reemplazar stub `calcularAporteMetas`)
- Test: `test/safe-to-spend.test.mjs` (añadir casos)

- [ ] **Step 1: Write the failing test**

Añadir a `test/safe-to-spend.test.mjs`:

```javascript
function meta(over) {
  return Object.assign({
    id: 'm1', ambito: 'personal', estado: 'en_curso', es_fondo_emergencia: false,
    monto_objetivo: 1200, monto_actual: 0, fecha_limite: '2026-12-31',
  }, over);
}

test('aporte de meta prorratea la cuota mensual por días restantes', () => {
  // Faltan 1200; de 2026-06-24 a 2026-12-31 ≈ 190 días → mesesRestantes ceil(190/30)=7.
  // planMensual = 1200/7 ≈ 171.43; prorrateo × (7/30) ≈ 40.0 → reserva ~40.
  // Ingreso 2100, sin gastos. (2100 - 0 - 0 - 40) / 7 ≈ 294.28 → 294.
  const out = calcularSafeToSpend([ing2(2100, '2026-06-03')], [meta()], { hoy: HOY });
  assert.strictEqual(out.estado, 'ok');
  assert.strictEqual(out.diario, 294);
});

test('meta fondo de emergencia se ignora', () => {
  const out = calcularSafeToSpend([ing2(2100, '2026-06-03')], [meta({ es_fondo_emergencia: true })], { hoy: HOY });
  assert.strictEqual(out.diario, 300); // 2100/7, sin reserva
});

test('meta de hogar se ignora (solo personal)', () => {
  const out = calcularSafeToSpend([ing2(2100, '2026-06-03')], [meta({ ambito: 'hogar' })], { hoy: HOY });
  assert.strictEqual(out.diario, 300);
});

test('meta ya cubierta (actual ≥ objetivo) no reserva', () => {
  const out = calcularSafeToSpend([ing2(2100, '2026-06-03')], [meta({ monto_actual: 1200 })], { hoy: HOY });
  assert.strictEqual(out.diario, 300);
});

test('meta sin fecha_limite se ignora', () => {
  const out = calcularSafeToSpend([ing2(2100, '2026-06-03')], [meta({ fecha_limite: null })], { hoy: HOY });
  assert.strictEqual(out.diario, 300);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "test/safe-to-spend.test.mjs"`
Expected: FAIL — stub `calcularAporteMetas` devuelve 0; el primer caso espera 294 ≠ 300.

- [ ] **Step 3: Write minimal implementation**

Reemplazar el stub `calcularAporteMetas` en `js/safe-to-spend.js`:

```javascript
// calcularAporteMetas — reserva la cuota de ahorro pendiente del mes. Por cada meta
// personal en curso (no fondo emergencia) con objetivo>0 y fecha_limite futura:
// planMensual = (objetivo−actual)/mesesRestantes; reserva planMensual×(díasRest/díasMes).
function calcularAporteMetas(metas, hoy, diasRestantes, diasDelMes) {
  let total = 0;
  for (const m of (metas || [])) {
    if (m.ambito !== 'personal') continue;
    if (m.estado !== 'en_curso') continue;
    if (m.es_fondo_emergencia) continue;
    const objetivo = Number(m.monto_objetivo) || 0;
    const actual = Number(m.monto_actual) || 0;
    if (objetivo <= 0) continue;
    if (!m.fecha_limite) continue;
    const restante = objetivo - actual;
    if (restante <= 0) continue;
    const diasHastaLimite = Math.floor((parseFechaISO(m.fecha_limite) - hoy) / 86400000);
    if (diasHastaLimite <= 0) continue; // límite vencido → no se prorratea aquí
    const mesesRestantes = Math.max(1, Math.ceil(diasHastaLimite / 30));
    const planMensual = restante / mesesRestantes;
    total += planMensual * (diasRestantes / diasDelMes);
  }
  return total;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "test/safe-to-spend.test.mjs"`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add js/safe-to-spend.js test/safe-to-spend.test.mjs
git commit -m "feat(fase2): aporte planificado a metas en safe-to-spend"
```

---

## Task 6: Registrar script y precache

**Files:**
- Modify: `index.html:203`
- Modify: `sw.js:15` y `sw.js:31`

- [ ] **Step 1: Registrar el script en index.html**

En `index.html`, tras la línea 203 (`<script type="module" src="js/insights.js"></script>`) añadir:

```html
    <script type="module" src="js/safe-to-spend.js"></script>
```

- [ ] **Step 2: Precache + bump de versión en sw.js**

En `sw.js` línea 15, cambiar:

```javascript
const SHELL_VERSION = 'v9';
```

En `sw.js`, tras la línea 31 (`{ url: 'js/insights.js', revision: SHELL_VERSION },`) añadir:

```javascript
  { url: 'js/safe-to-spend.js', revision: SHELL_VERSION },
```

- [ ] **Step 3: Commit**

```bash
git add index.html sw.js
git commit -m "chore(fase2): registrar safe-to-spend.js + precache (bump v9)"
```

---

## Task 7: Render del hero safe-to-spend en el dashboard

**Files:**
- Modify: `views/dashboard.html` (markup tras línea 9; CSS tras la sección Saludo ~línea 113; JS: `renderSafeToSpend` + entrada en `Promise.allSettled` ~líneas 783-813)

- [ ] **Step 1: Añadir el markup hero**

En `views/dashboard.html`, justo después del `</header>` de `.dash-hero` (línea 9) e inmediatamente antes del bloque `<!-- Error global de conexión -->`:

```html
  <!-- ── SECCIÓN 1.5 — Safe-to-spend (hero) ───────────────────── -->
  <section id="dashSafeToSpend" class="dash-s2s" aria-live="polite"></section>
```

- [ ] **Step 2: Añadir estilos**

En el `<style>` de `views/dashboard.html`, tras el bloque `.dash-saludo { ... }` (línea ~113):

```css
  /* ── Safe-to-spend (hero) ───────────────────────────────── */
  .dash-s2s:not(:empty) { margin-bottom: var(--space-lg); }
  .dash-s2s-card {
    padding: var(--space-lg);
    border-radius: var(--radius-md);
    background: linear-gradient(135deg, var(--color-primary), var(--color-success));
    color: #fff;
    box-shadow: var(--shadow-md);
  }
  .dash-s2s-card--excedido {
    background: linear-gradient(135deg, var(--color-danger), #8a1c1c);
  }
  .dash-s2s-label {
    margin: 0;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.9;
  }
  .dash-s2s-monto {
    margin: var(--space-xs) 0 0;
    font-family: var(--font-display);
    font-size: 2.6rem;
    font-weight: var(--font-weight-bold);
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
  }
  .dash-s2s-sub {
    margin: var(--space-xs) 0 0;
    font-size: var(--font-size-sm);
    opacity: 0.92;
  }
```

- [ ] **Step 3: Añadir `renderSafeToSpend` y enchufar el loader**

En el `<script>` de `views/dashboard.html`, añadir la función render junto a las otras (p.ej. tras `renderInsights`, línea ~625):

```javascript
    // ── Render: safe-to-spend (hero) ──────────────────────────
    function renderSafeToSpend(res) {
      const cont = $('dashSafeToSpend');
      if (!cont) return;
      if (!res) { cont.innerHTML = ''; return; }
      if (res.estado === 'excedido') {
        cont.innerHTML = `
          <div class="dash-s2s-card dash-s2s-card--excedido">
            <p class="dash-s2s-label">Este mes</p>
            <p class="dash-s2s-monto">${esc(formatMonto(res.exceso))}</p>
            <p class="dash-s2s-sub">Te pasaste de lo disponible. Cuida los próximos ${res.diasRestantes} días.</p>
          </div>`;
        return;
      }
      cont.innerHTML = `
        <div class="dash-s2s-card">
          <p class="dash-s2s-label">Puedes gastar hoy</p>
          <p class="dash-s2s-monto">${esc(formatMonto(res.diario))}</p>
          <p class="dash-s2s-sub">Te quedan ${esc(formatMonto(res.restanteMes))} para ${res.diasRestantes} día${res.diasRestantes === 1 ? '' : 's'}.</p>
        </div>`;
    }
```

En el `Promise.allSettled` de `cargar()` (línea ~784), añadir `cargarSafeToSpend()` al array y su destructuring. El array pasa a:

```javascript
      const [hogar, personal, alertas, txs, metas, acumHogar, acumPersonal, ahorrosHogar, ahorrosPersonal, insights, categoriasGasto, gastosCat, safeToSpend] = await Promise.allSettled([
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
        getCategorias('gasto'),
        getGastosPorCategoriaMes(mes, anio),
        cargarSafeToSpend(),
      ]);
```

Y tras `if (insights.status === 'fulfilled') renderInsights(insights.value);` (línea ~807) añadir:

```javascript
      if (safeToSpend.status === 'fulfilled') renderSafeToSpend(safeToSpend.value);
```

- [ ] **Step 4: Verificar en el navegador**

Seguir el workflow de verificación con las preview tools (cuenta de prueba en memoria `nestra-v2-test-account`):
1. `preview_start` y abrir el dashboard.
2. `preview_console_logs` — sin errores.
3. `preview_snapshot` — el hero "Puedes gastar hoy" aparece arriba, sobre los balances; el carrusel de insights puede mostrar el préstamo si aplica.
4. `preview_screenshot` — adjuntar prueba visual.

- [ ] **Step 5: Commit**

```bash
git add views/dashboard.html
git commit -m "feat(fase2): hero safe-to-spend en el dashboard"
```

---

## Task 8: Suite completa + actualizar memoria

**Files:**
- Verificación + `C:\Users\csf93\.claude\projects\C--Users-csf93-Desktop-Nestra\memory\nestra-v2-insights-engine.md` (+ `MEMORY.md` si hace falta)

- [ ] **Step 1: Correr toda la suite**

Run: `node --test "test/*.test.mjs"`
Expected: PASS — los 40 tests previos + los nuevos de préstamos, generar y safe-to-spend.

- [ ] **Step 2: Actualizar la memoria del proyecto**

Editar `nestra-v2-insights-engine.md`: añadir el módulo `safe-to-spend.js` (hero personal, fórmula, fijos inferidos, baseline día-1), el detector `detectPrestamosSinCobro` (solo dados; deudas propias = deuda técnica diferida) y el threading de préstamos. Subir el conteo de tests.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs(fase2): actualizar memoria con safe-to-spend + prestamos"
```

---

## Notas de verificación

- Toda la lógica nueva es pura y cubierta por tests; el render se valida con preview tools.
- Precisión ante todo: cada función devuelve neutro (`null`/`[]`/`0`) ante datos insuficientes.
- No se modifica el esquema ni `alerts.js`. La simetría de deudas propias queda como deuda técnica documentada en el spec.
