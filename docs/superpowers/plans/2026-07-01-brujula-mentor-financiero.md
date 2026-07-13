# Brújula — mentor financiero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el "Oráculo" (validador reactivo) por "Brújula" (mentor): rango cómodo→tope sin monto, convertir compra grande en meta, freno anti-impulso y micro-ahorro proactivo de 1 toque.

**Architecture:** Toda la lógica de decisión se extrae a un módulo puro nuevo `js/brujula.js` (sin DOM ni red, testeable con `node --test`), siguiendo el patrón de `js/recurrentes-detect.js` (`export {}` para tests + `window.fn = fn` para las vistas). La vista `views/brujula.html` (refactor de `decisiones.html`) recolecta métricas vía `js/db.js` y llama a esas funciones puras. Un flag nuevo `categorias.esencial` alimenta el anti-impulso. La tarjeta de micro-ahorro vive en el dashboard.

**Tech Stack:** JS vanilla (sin build), ESM en `js/`, tests `node --test test/*.test.mjs`, Supabase (RPC para aportes/metas), PWA con `sw.js` precache.

**Contratos de las funciones puras (referencia para todas las tareas):**

- `calcularRango(monto, m, categoria)` → `{ nivel, comodo, tope, razon, sugerido }`
  - `nivel` ∈ `'consulta'` (sin monto, solo rango) | `'recomendable'` | `'cautela'` | `'no'` | `'sin-margen'`
  - `m` (métricas) = `{ limite, gastoMes, ingresos, gastos, recurrentesPendientes, colchonMetas, gastoSemana, diasSemana, diasMes }`
  - `categoria` = `{ nombre, limite_mensual, esencial }`
- `planMeta(monto, tope, hoy)` → `{ faltante, aporteMes, fechaMeta }` (horizonte fijo 3 meses)
- `costoOportunidad(monto, categoria, metaCritica)` → `{ n, texto }` | `null`
  - `metaCritica` = `{ nombre, aporteTipico }`
- `sugerirMicroahorro(metas, liquidezMes, hoy)` → `{ meta_id, meta, sugerido, texto }` | `null`
  - `metas` = filas con `{ id, nombre, monto_actual, monto_objetivo, estado, fecha_limite }`

---

### Task 1: `calcularRango` — corazón del rango cómodo→tope

**Files:**
- Create: `js/brujula.js`
- Test: `test/brujula.test.mjs`

- [ ] **Step 1: Escribir el test que falla**

Crear `test/brujula.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calcularRango } from '../js/brujula.js';

const HOY = new Date(2026, 6, 1); // 2026-07-01

// Métricas base: presupuesto 300, gastado 100, buena liquidez, ritmo normal.
function metricas(over = {}) {
  return Object.assign({
    limite: 300, gastoMes: 100,
    ingresos: 2000, gastos: 800, recurrentesPendientes: 200, colchonMetas: 100,
    gastoSemana: 40, diasSemana: 7, diasMes: 31,
  }, over);
}
const CAT = { nombre: 'Bicicleta', limite_mensual: 300, esencial: false };

test('sin monto → nivel consulta con rango cómodo y tope', () => {
  const r = calcularRango(0, metricas(), CAT);
  assert.equal(r.nivel, 'consulta');
  // margenCat = 300-100 = 200; liquidez = 2000-800-200-100 = 900; tope = min(200,900) = 200
  assert.equal(r.tope, 200);
  assert.equal(r.comodo, 200); // ritmo normal → cómodo = tope
});

test('ritmo rápido reduce el cómodo (70% del tope)', () => {
  // gastoSemana alto: 200 en 7 días → ritmoSemanal 200 > objetivoSemanal (300*7/31≈67.7)
  const r = calcularRango(0, metricas({ gastoSemana: 200 }), CAT);
  assert.equal(r.tope, 200);
  assert.equal(r.comodo, 140); // round(200*0.7)
});

test('monto ≤ cómodo → recomendable', () => {
  const r = calcularRango(120, metricas(), CAT);
  assert.equal(r.nivel, 'recomendable');
});

test('cómodo < monto ≤ tope → cautela', () => {
  const r = calcularRango(180, metricas({ gastoSemana: 200 }), CAT); // cómodo 140, tope 200
  assert.equal(r.nivel, 'cautela');
});

test('monto > tope → no', () => {
  const r = calcularRango(250, metricas(), CAT); // tope 200
  assert.equal(r.nivel, 'no');
});

test('sin presupuesto de categoría → cae a liquidez, sin bloquear', () => {
  const catSin = { nombre: 'Ocio', limite_mensual: null, esencial: false };
  const r = calcularRango(0, metricas({ limite: null }), catSin);
  assert.equal(r.nivel, 'consulta');
  assert.equal(r.tope, 900); // liquidez completa
  assert.equal(r.comodo, 900);
});

test('sin liquidez → sin-margen', () => {
  const r = calcularRango(50, metricas({ ingresos: 900 }), CAT); // liquidez = 900-800-200-100 = -200 → 0
  assert.equal(r.nivel, 'sin-margen');
  assert.equal(r.tope, 0);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `node --test test/brujula.test.mjs`
Expected: FAIL — `Cannot find module '../js/brujula.js'` o `calcularRango is not a function`.

- [ ] **Step 3: Implementar `js/brujula.js`**

Crear `js/brujula.js`:

```javascript
// Nestra — Brújula (mentor financiero). Funciones puras, sin DOM ni red.
// Testeable con node; las vistas las consumen vía window.* (ver export al final).

// calcularRango(monto, m, categoria) — techo de gasto para una categoría.
// Devuelve { nivel, comodo, tope, razon, sugerido }. Si monto no es > 0,
// nivel='consulta' (solo muestra el rango). Ver contrato en el plan.
function calcularRango(monto, m, categoria) {
  var tieneLimite = categoria.limite_mensual != null;
  var margenCat = tieneLimite ? Math.max(0, m.limite - m.gastoMes) : Infinity;
  var liquidez = Math.max(0, m.ingresos - m.gastos - m.recurrentesPendientes - m.colchonMetas);
  var topeRaw = tieneLimite ? Math.min(margenCat, liquidez) : liquidez;

  var ritmoRapido = false;
  if (tieneLimite && m.limite > 0) {
    var objetivoSemanal = m.limite * 7 / m.diasMes;
    var ritmoSemanal = (m.gastoSemana / Math.max(m.diasSemana, 1)) * 7;
    ritmoRapido = ritmoSemanal > objetivoSemanal;
  }
  var tope = Math.round(topeRaw);
  var comodo = ritmoRapido ? Math.round(topeRaw * 0.7) : tope;

  if (tope <= 0) {
    return { nivel: 'sin-margen', comodo: 0, tope: 0, sugerido: 0,
      razon: 'Este mes no te queda margen en ' + categoria.nombre + '. Revisa tus gastos o espera al próximo ciclo.' };
  }
  if (!(monto > 0)) {
    return { nivel: 'consulta', comodo: comodo, tope: tope, sugerido: tope,
      razon: 'Puedes gastar tranquilo hasta ' + comodo + '; tu tope este mes es ' + tope + '.' };
  }
  if (monto <= comodo) {
    return { nivel: 'recomendable', comodo: comodo, tope: tope, sugerido: tope,
      razon: 'Te alcanza sin apuros en ' + categoria.nombre + '.' };
  }
  if (monto <= tope) {
    return { nivel: 'cautela', comodo: comodo, tope: tope, sugerido: tope,
      razon: 'Cabe, pero ajustado: pasas tu zona cómoda (' + comodo + ').' };
  }
  return { nivel: 'no', comodo: comodo, tope: tope, sugerido: tope,
    razon: 'Superarías tu tope de este mes (' + tope + ').' };
}

if (typeof window !== 'undefined') window.calcularRango = calcularRango;

export { calcularRango };
```

- [ ] **Step 4: Verificar que pasa**

Run: `node --test test/brujula.test.mjs`
Expected: PASS — 7/7.

- [ ] **Step 5: Commit**

```bash
git add js/brujula.js test/brujula.test.mjs
git commit -m "feat(brujula): calcularRango — rango cómodo→tope por categoría"
```

---

### Task 2: `planMeta` — convertir compra grande en meta

**Files:**
- Modify: `js/brujula.js`
- Test: `test/brujula.test.mjs`

- [ ] **Step 1: Escribir el test que falla**

Añadir a `test/brujula.test.mjs` — extender el import de la primera línea:

```javascript
import { calcularRango, planMeta } from '../js/brujula.js';
```

Y añadir al final:

```javascript
test('planMeta: reparte el monto en 3 meses y calcula fecha', () => {
  const p = planMeta(380, 200, HOY); // HOY = 2026-07-01
  assert.equal(p.faltante, 180);       // 380 - 200
  assert.equal(p.aporteMes, 127);      // ceil(380/3) = 127
  assert.equal(p.fechaMeta, '2026-10-01'); // +3 meses
});

test('planMeta: aporteMes redondea hacia arriba', () => {
  const p = planMeta(100, 0, HOY);
  assert.equal(p.aporteMes, 34); // ceil(100/3)
});
```

- [ ] **Step 2: Verificar que falla**

Run: `node --test test/brujula.test.mjs`
Expected: FAIL — `planMeta is not a function`.

- [ ] **Step 3: Implementar**

En `js/brujula.js`, añadir antes de la línea `if (typeof window`:

```javascript
// planMeta(monto, tope, hoy) — plan de ahorro para una compra que no cabe.
// Horizonte fijo de 3 meses. Devuelve { faltante, aporteMes, fechaMeta }.
function planMeta(monto, tope, hoy) {
  var MESES_PLAN = 3;
  var faltante = Math.max(0, Math.round(monto - tope));
  var aporteMes = Math.ceil(monto / MESES_PLAN);
  var y = hoy.getFullYear();
  var mIdx = hoy.getMonth() + MESES_PLAN;
  var fecha = new Date(y, mIdx, 1);
  var p = function (n) { return String(n).padStart(2, '0'); };
  var fechaMeta = fecha.getFullYear() + '-' + p(fecha.getMonth() + 1) + '-01';
  return { faltante: faltante, aporteMes: aporteMes, fechaMeta: fechaMeta };
}
```

Y extender la línea de window + el export:

```javascript
if (typeof window !== 'undefined') { window.calcularRango = calcularRango; window.planMeta = planMeta; }

export { calcularRango, planMeta };
```

- [ ] **Step 4: Verificar que pasa**

Run: `node --test test/brujula.test.mjs`
Expected: PASS — 9/9.

- [ ] **Step 5: Commit**

```bash
git add js/brujula.js test/brujula.test.mjs
git commit -m "feat(brujula): planMeta — convertir compra grande en meta a 3 meses"
```

---

### Task 3: `costoOportunidad` — freno anti-impulso

**Files:**
- Modify: `js/brujula.js`
- Test: `test/brujula.test.mjs`

- [ ] **Step 1: Escribir el test que falla**

Extender el import:

```javascript
import { calcularRango, planMeta, costoOportunidad } from '../js/brujula.js';
```

Añadir al final:

```javascript
test('costoOportunidad: categoría no esencial → texto con nº de aportes', () => {
  const cat = { nombre: 'Ocio', esencial: false };
  const r = costoOportunidad(100, cat, { nombre: 'Viaje', aporteTipico: 50 });
  assert.equal(r.n, 2); // round(100/50)
  assert.match(r.texto, /Viaje/);
});

test('costoOportunidad: categoría esencial → null', () => {
  const cat = { nombre: 'Comida', esencial: true };
  assert.equal(costoOportunidad(100, cat, { nombre: 'Viaje', aporteTipico: 50 }), null);
});

test('costoOportunidad: sin meta crítica → null', () => {
  const cat = { nombre: 'Ocio', esencial: false };
  assert.equal(costoOportunidad(100, cat, null), null);
});

test('costoOportunidad: esencial undefined se trata como esencial (null)', () => {
  const cat = { nombre: 'X' };
  assert.equal(costoOportunidad(100, cat, { nombre: 'Viaje', aporteTipico: 50 }), null);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `node --test test/brujula.test.mjs`
Expected: FAIL — `costoOportunidad is not a function`.

- [ ] **Step 3: Implementar**

En `js/brujula.js`, añadir antes de la línea `if (typeof window`:

```javascript
// costoOportunidad(monto, categoria, metaCritica) — empujón anti-impulso.
// Solo para categorías NO esenciales (esencial === false explícito) y con meta.
// Devuelve { n, texto } o null.
function costoOportunidad(monto, categoria, metaCritica) {
  if (categoria.esencial !== false) return null;
  if (!metaCritica || !(metaCritica.aporteTipico > 0)) return null;
  var n = Math.max(1, Math.round(monto / metaCritica.aporteTipico));
  return {
    n: n,
    texto: 'Esto equivale a ' + n + ' aporte' + (n === 1 ? '' : 's') +
      ' a ' + metaCritica.nombre + '. ¿Es necesario ahora? Dale 48 h.',
  };
}
```

Extender window + export:

```javascript
if (typeof window !== 'undefined') { window.calcularRango = calcularRango; window.planMeta = planMeta; window.costoOportunidad = costoOportunidad; }

export { calcularRango, planMeta, costoOportunidad };
```

- [ ] **Step 4: Verificar que pasa**

Run: `node --test test/brujula.test.mjs`
Expected: PASS — 13/13.

- [ ] **Step 5: Commit**

```bash
git add js/brujula.js test/brujula.test.mjs
git commit -m "feat(brujula): costoOportunidad — freno anti-impulso en categorías no esenciales"
```

---

### Task 4: `sugerirMicroahorro` — coaching proactivo

**Files:**
- Modify: `js/brujula.js`
- Test: `test/brujula.test.mjs`

- [ ] **Step 1: Escribir el test que falla**

Extender el import:

```javascript
import { calcularRango, planMeta, costoOportunidad, sugerirMicroahorro } from '../js/brujula.js';
```

Añadir al final:

```javascript
test('sugerirMicroahorro: elige meta más cercana y sugiere 10% de liquidez', () => {
  const metas = [
    { id: 'a', nombre: 'Lejana', monto_actual: 0, monto_objetivo: 1000, estado: 'en_curso', fecha_limite: '2026-12-01' },
    { id: 'b', nombre: 'Cercana', monto_actual: 0, monto_objetivo: 1000, estado: 'en_curso', fecha_limite: '2026-08-01' },
  ];
  const r = sugerirMicroahorro(metas, 500, HOY);
  assert.equal(r.meta_id, 'b');
  assert.equal(r.sugerido, 50); // round(500 * 0.1)
  assert.match(r.texto, /Cercana/);
});

test('sugerirMicroahorro: no pasa del faltante de la meta', () => {
  const metas = [{ id: 'b', nombre: 'Casi', monto_actual: 970, monto_objetivo: 1000, estado: 'en_curso', fecha_limite: '2026-08-01' }];
  const r = sugerirMicroahorro(metas, 500, HOY); // 10% = 50, pero faltan 30
  assert.equal(r.sugerido, 30);
});

test('sugerirMicroahorro: sin liquidez → null', () => {
  const metas = [{ id: 'b', nombre: 'X', monto_actual: 0, monto_objetivo: 1000, estado: 'en_curso', fecha_limite: '2026-08-01' }];
  assert.equal(sugerirMicroahorro(metas, 0, HOY), null);
});

test('sugerirMicroahorro: sin metas en curso → null', () => {
  const metas = [{ id: 'b', nombre: 'X', monto_actual: 1000, monto_objetivo: 1000, estado: 'cumplida', fecha_limite: '2026-08-01' }];
  assert.equal(sugerirMicroahorro(metas, 500, HOY), null);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `node --test test/brujula.test.mjs`
Expected: FAIL — `sugerirMicroahorro is not a function`.

- [ ] **Step 3: Implementar**

En `js/brujula.js`, añadir antes de la línea `if (typeof window`:

```javascript
// sugerirMicroahorro(metas, liquidezMes, hoy) — nudge de ahorro para el dashboard.
// Elige la meta en curso más cercana a su fecha límite. Sugiere 10% de la
// liquidez sin pasar del faltante. Devuelve { meta_id, meta, sugerido, texto } o null.
function sugerirMicroahorro(metas, liquidezMes, hoy) {
  if (!(liquidezMes > 0)) return null;
  var enCurso = (metas || []).filter(function (m) {
    return m.estado === 'en_curso' && Number(m.monto_actual) < Number(m.monto_objetivo);
  });
  if (!enCurso.length) return null;
  enCurso.sort(function (a, b) {
    var fa = a.fecha_limite || '9999-12-31';
    var fb = b.fecha_limite || '9999-12-31';
    return fa < fb ? -1 : fa > fb ? 1 : 0;
  });
  var meta = enCurso[0];
  var faltante = Number(meta.monto_objetivo) - Number(meta.monto_actual);
  var sugerido = Math.min(Math.round(liquidezMes * 0.1), Math.round(faltante));
  if (sugerido <= 0) return null;
  return {
    meta_id: meta.id, meta: meta.nombre, sugerido: sugerido,
    texto: 'Aparta ' + sugerido + ' y te acercas a ' + meta.nombre + '.',
  };
}
```

Extender window + export:

```javascript
if (typeof window !== 'undefined') { window.calcularRango = calcularRango; window.planMeta = planMeta; window.costoOportunidad = costoOportunidad; window.sugerirMicroahorro = sugerirMicroahorro; }

export { calcularRango, planMeta, costoOportunidad, sugerirMicroahorro };
```

- [ ] **Step 4: Verificar que pasa**

Run: `node --test test/brujula.test.mjs`
Expected: PASS — 17/17.

- [ ] **Step 5: Commit**

```bash
git add js/brujula.js test/brujula.test.mjs
git commit -m "feat(brujula): sugerirMicroahorro — nudge de ahorro proactivo"
```

---

### Task 5: Flag `categorias.esencial` + toggle en Configuración

**Files:**
- Create: `supabase/migrations/20260701_brujula_categoria_esencial.sql`
- Modify: `views/configuracion.html` (form de edición de categoría)

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/20260701_brujula_categoria_esencial.sql`:

```sql
-- =====================================================================
-- Nestra — Migración: categorias.esencial (Brújula / anti-impulso)
-- ---------------------------------------------------------------------
-- Marca si una categoría es de gasto esencial. Las NO esenciales activan
-- el freno anti-impulso de la Brújula (costo de oportunidad + espera 48h).
-- Default true (conservador: no molesta salvo que el usuario marque lo
-- contrario). Categorías globales (user_id null) comparten el flag.
-- Idempotente. Ejecutar en SQL Editor de v2.
-- =====================================================================

alter table public.categorias
  add column if not exists esencial boolean not null default true;
```

- [ ] **Step 2: Aplicar la migración**

Aplicar vía el MCP de Supabase (`apply_migration`, name `brujula_categoria_esencial`) o pegar el SQL en el editor de v2. Verificar:

Run (MCP `execute_sql` o editor): `select column_name from information_schema.columns where table_name='categorias' and column_name='esencial';`
Expected: una fila `esencial`.

- [ ] **Step 3: Añadir el toggle en el form de edición de categoría**

En `views/configuracion.html`, localizar el form de edición de categoría (donde se edita `nombre`/`limite_mensual`/`icono`; el submit llama a `updateCategoria(_editCatId, datos)` cerca de la línea 1023). Añadir un checkbox en el markup del form, junto al campo de límite mensual:

```html
<label class="cfg-check">
  <input type="checkbox" id="cfgEditEsencial" />
  <span>Gasto esencial (la Brújula no te frenará en esta categoría)</span>
</label>
```

En el handler de submit, incluir el flag en `datos` y, al abrir el modal de edición, precargar el checkbox desde la categoría. En la construcción de `datos` (junto a `nombre`, `limite_mensual`, `icono`):

```javascript
esencial: $('cfgEditEsencial').checked,
```

Y donde se rellena el form al abrir la edición (junto a set de nombre/límite/icono), añadir:

```javascript
$('cfgEditEsencial').checked = (cat.esencial !== false);
```

Verificar que `updateCategoria` en `js/db.js` propaga campos arbitrarios de `datos` al `update` (usa `.update(datos)`); si filtra columnas explícitas, añadir `esencial` a la lista.

- [ ] **Step 4: Verificar en preview**

Levantar el server (`npx serve -l 5050 .`), entrar a Configuración, editar una categoría, alternar el checkbox y guardar. Confirmar sin errores en consola y que al reabrir la edición el estado persiste.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260701_brujula_categoria_esencial.sql views/configuracion.html
git commit -m "feat(brujula): flag categorias.esencial + toggle en Configuración"
```

---

### Task 6: Vista `views/brujula.html` — consulta, rango, plan, offline

**Files:**
- Create: `views/brujula.html` (basado en `views/decisiones.html`)
- Test: verificación en preview

- [ ] **Step 1: Crear la vista a partir de la actual**

Copiar `views/decisiones.html` a `views/brujula.html`. Cambios de contenido:
- Título `<h1 class="dec-title">Oráculo</h1>` → `Brújula`.
- El input de monto pasa a opcional: cambiar el `placeholder="0.00"` por `placeholder="Monto (opcional — no sé cuánto)"` y quitar cualquier `required`.

- [ ] **Step 2: Reemplazar la lógica de decisión por las funciones puras**

En el `<script>` de `views/brujula.html`, reemplazar la función `dictaminar(...)` (lógica local vieja) por llamadas a `window.calcularRango` (cargado globalmente por `js/brujula.js`). Extender `recolectar` para que devuelva las métricas que `calcularRango` espera, incluyendo `recurrentesPendientes` (leído de `getRecurrentes`, filtrando activos con `proximo_cargo` en lo que resta del mes y del ámbito correspondiente):

```javascript
async function recolectarMetricas(cat, ambito) {
  var rMes = { desde: hoy.anio + '-' + String(hoy.mes).padStart(2, '0') + '-01', hasta: _rangoSemana().hasta };
  var rSem = _rangoSemana();
  var diasMes = new Date(hoy.anio, hoy.mes, 0).getDate();

  var res = await Promise.all([
    getGastoCategoria(cat.id, ambito, rMes.desde, rMes.hasta),
    getGastoCategoria(cat.id, ambito, rSem.desde, rSem.hasta),
    (ambito === 'personal' ? getBalancePersonal(hoy.mes, hoy.anio) : getBalanceHogar(hoy.mes, hoy.anio)),
    getMetas(ambito),
    getRecurrentes(),
  ]);
  var gastoMes = res[0], gastoSemana = res[1], balance = res[2];
  var metasPend = (res[3] || []).filter(function (x) { return Number(x.monto_actual) < Number(x.monto_objetivo); });
  var recs = res[4] || [];

  // Colchón de metas (misma fórmula prorrateada que el Oráculo anterior).
  var colchon = 0, metaCritica = null;
  metasPend.forEach(function (mt) {
    if (!mt.fecha_limite) return;
    var hoyD = new Date(), limD = new Date(mt.fecha_limite);
    var meses = Math.max((limD.getFullYear() - hoyD.getFullYear()) * 12 + (limD.getMonth() - hoyD.getMonth()), 1);
    var faltante = Number(mt.monto_objetivo) - Number(mt.monto_actual);
    colchon += faltante / meses;
    if (!metaCritica || meses <= 2) metaCritica = { nombre: mt.nombre, aporteTipico: Math.round(faltante / meses) };
  });

  // Recurrentes pendientes en lo que queda del mes.
  var recurrentesPendientes = recs.reduce(function (s, r) {
    if (!r.activo || !r.proximo_cargo) return s;
    if (r.proximo_cargo < rMes.desde || r.proximo_cargo > rMes.hasta) return s;
    return s + Number(r.monto);
  }, 0);

  return {
    metricas: {
      limite: cat.limite_mensual == null ? null : Number(cat.limite_mensual),
      gastoMes: gastoMes, ingresos: balance.ingresos, gastos: balance.gastos,
      recurrentesPendientes: recurrentesPendientes, colchonMetas: Math.round(colchon),
      gastoSemana: gastoSemana, diasSemana: rSem.diasTranscurridos, diasMes: diasMes,
    },
    metaCritica: metaCritica,
  };
}
```

- [ ] **Step 3: Adaptar el submit y el render a los nuevos niveles**

En el handler de submit, permitir monto vacío (consulta de rango) y enrutar por `nivel`:

```javascript
$('decForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  var raw = String($('decMonto').value).replace(',', '.').trim();
  var monto = raw === '' ? 0 : parseFloat(raw);
  var cat = catsPorId[estado.categoriaId];
  ocultarVeredicto();
  if (!cat) return;

  mostrarCargando(true);
  try {
    var datos = await recolectarMetricas(cat, estado.ambito);
    var v = calcularRango(monto, datos.metricas, cat);
    renderBrujula(v, monto, datos, cat);
  } catch (err) {
    console.error('Brújula: fallo al consultar:', err);
    mostrarErrorBrujula();
  } finally {
    mostrarCargando(false);
  }
});
```

Reemplazar `renderVeredicto` por `renderBrujula(v, monto, datos, cat)` que:
- Muestra dos cifras (`v.comodo`, `v.tope`) cuando `nivel==='consulta'`.
- Muestra el veredicto (`recomendable`/`cautela`/`no`/`sin-margen`) con `v.razon`.
- Si `nivel==='no'`: calcula `planMeta(monto, v.tope, new Date())` y muestra "Vuélvela meta: aparta S/{aporteMes}/mes → botón Crear meta" (deshabilitado si `!navigator.onLine`).
- Si `nivel` es `cautela`/`no` y `costoOportunidad(monto, cat, datos.metaCritica)` no es null: añade su `.texto`.

Código del render (usa los helpers existentes `_icoSvg`, `formatMonto`, `revelar`):

```javascript
function renderBrujula(v, monto, datos, cat) {
  var box = $('decVeredicto');
  var CLASE = { consulta: 'veredicto-ok', recomendable: 'veredicto-ok', cautela: 'veredicto-alerta', no: 'veredicto-peligro', 'sin-margen': 'veredicto-peligro' };
  var TIT = { consulta: 'Puedes gastar en ' + cat.nombre, recomendable: 'Adelante', cautela: 'Con cautela', no: 'No cabe este mes', 'sin-margen': 'Sin margen' };
  box.className = 'dec-veredicto ' + (CLASE[v.nivel] || '');
  box.setAttribute('data-nivel', v.nivel);

  var html = '<div class="dec-ver-cabecera">' + TIT[v.nivel] + '</div>';
  if (v.nivel === 'consulta') {
    html += '<div class="dec-rango"><div class="dec-rango-c"><span>Cómodo</span><b>' + formatMonto(v.comodo) + '</b></div>' +
            '<div class="dec-rango-t"><span>Tope</span><b>' + formatMonto(v.tope) + '</b></div></div>';
  }
  html += '<p class="dec-ver-razon">' + v.razon + '</p>';

  if (v.nivel === 'no') {
    var plan = planMeta(monto, v.tope, new Date());
    html += '<p class="dec-ver-cifra">Vuélvela meta: aparta <span class="signature-num">' + formatMonto(plan.aporteMes) + '</span>/mes y la tienes para ' + plan.fechaMeta + '.</p>';
  }
  var co = costoOportunidad(monto, cat, datos.metaCritica);
  if ((v.nivel === 'cautela' || v.nivel === 'no') && co) {
    html += '<p class="dec-ver-detalle">' + co.texto + '</p>';
  }

  html += '<div class="dec-ver-acciones">';
  if (v.nivel === 'no') {
    var offline = !navigator.onLine;
    html += '<button type="button" class="btn btn-primary" id="decCrearMeta"' + (offline ? ' disabled' : '') + '>Crear meta</button>' +
            (offline ? '<span class="dec-offline">Necesitas conexión para esto.</span>' : '');
  } else if (v.nivel !== 'sin-margen') {
    html += '<button type="button" class="btn-ghost" id="decRegistrar">Registrar gasto</button>';
  }
  html += '</div>';
  box.innerHTML = html;

  var cm = $('decCrearMeta');
  if (cm) cm.addEventListener('click', async function () {
    cm.disabled = true;
    try {
      var plan2 = planMeta(monto, v.tope, new Date());
      await insertMeta({ nombre: cat.nombre, monto_objetivo: monto, fecha_limite: plan2.fechaMeta, ambito: estado.ambito });
      mostrarToast('Meta creada', 3000);
    } catch (err) { console.error('crear meta:', err); cm.disabled = false; }
  });
  var reg = $('decRegistrar');
  if (reg) reg.addEventListener('click', function () {
    if (typeof abrirModalTransaccion === 'function') abrirModalTransaccion();
    else window.location.hash = '#transaccion';
  });
  revelar(box);
}
function mostrarErrorBrujula() {
  var box = $('decVeredicto');
  box.className = 'dec-veredicto'; box.setAttribute('data-nivel', '');
  box.innerHTML = '<div class="dec-ver-cabecera">' + _icoSvg('cloud') + ' La Brújula está nublada</div>' +
    '<p class="dec-ver-razon">No pude leer tus datos ahora. Inténtalo de nuevo.</p>';
  revelar(box);
}
```

Añadir CSS mínimo en el `<style>` de la vista para el rango:

```css
.dec-rango { display:flex; gap:10px; margin: var(--space-sm) 0; }
.dec-rango-c, .dec-rango-t { flex:1; padding: var(--space-sm); border-radius: var(--radius-md); }
.dec-rango-c { background: color-mix(in srgb, var(--color-success) 12%, transparent); }
.dec-rango-t { background: color-mix(in srgb, var(--color-warning) 12%, transparent); }
.dec-rango span { display:block; font-size: var(--font-size-sm); color: var(--text-secondary); }
.dec-rango b { font-size: var(--font-size-lg); }
.dec-offline { display:block; font-size: var(--font-size-sm); color: var(--text-secondary); margin-top: 4px; }
```

Verificar que `insertMeta` acepta `ambito`; si su firma difiere, ajustar el objeto a las columnas reales de `metas` (revisar `insertMeta` en `js/db.js:851`).

- [ ] **Step 4: Verificar en preview**

Levantar el server, navegar a `#brujula` (tras Task 7 la ruta existirá; mientras tanto, probar cargando la vista directamente o completar Task 7 antes de verificar). Consultar sin monto (ver rango), con monto bajo (recomendable), alto (no cabe → botón Crear meta). Con `navigator.onLine=false` en DevTools, confirmar botón deshabilitado + aviso. `preview_console_logs` sin errores.

- [ ] **Step 5: Commit**

```bash
git add views/brujula.html
git commit -m "feat(brujula): vista con rango, plan-meta y manejo offline"
```

---

### Task 7: Ruta, nav e integración PWA

**Files:**
- Modify: `js/router.js:151`, `index.html` (nav ~149-152, viewsConfig ~376, script includes ~220), `sw.js`
- Delete: `views/decisiones.html`

- [ ] **Step 1: Registrar la ruta y su alias**

En `js/router.js`, línea 151, reemplazar:

```javascript
  decisiones: { view: 'decisiones' },
```

por (nueva ruta `brujula` + alias `decisiones` para bookmarks viejos apuntando a la nueva vista):

```javascript
  brujula: { view: 'brujula' },
  decisiones: { view: 'brujula' },
```

- [ ] **Step 2: Actualizar el nav en `index.html`**

En `index.html` (~149-152), cambiar el enlace del nav:

```html
<a href="#brujula" class="nav-link" title="Brújula">
```

y el label:

```html
<span class="nav-label">Brújula</span>
```

En el `viewsConfig` (~376), añadir la entrada de `brujula` junto a la de `decisiones` (mantener ambas para el alias):

```javascript
        brujula:       { show: false, label: '' },
        decisiones:    { show: false, label: '' },
```

- [ ] **Step 3: Cargar `js/brujula.js` como módulo**

En `index.html`, junto a los otros `<script type="module">` de lógica (~220, donde está `recurrentes-detect.js`), añadir:

```html
    <script type="module" src="js/brujula.js"></script>
```

- [ ] **Step 4: Precache + bump SHELL_VERSION**

En `sw.js`, añadir `{ url: 'js/brujula.js', revision: SHELL_VERSION }` a la lista de precache (junto a `js/recurrentes-detect.js`). Subir `SHELL_VERSION` al siguiente valor (de `'v19'` a `'v20'`).

- [ ] **Step 5: Borrar la vista vieja y verificar**

```bash
git rm views/decisiones.html
```

Levantar el server, navegar por el nav a Brújula (`#brujula`) y también probar `#decisiones` (alias) — ambos deben cargar la nueva vista sin error. `preview_console_logs` limpio.

- [ ] **Step 6: Commit**

```bash
git add js/router.js index.html sw.js
git commit -m "feat(brujula): ruta, nav, precache y baja del Oráculo (SHELL_VERSION v20)"
```

---

### Task 8: Tarjeta de micro-ahorro en el dashboard

**Files:**
- Modify: `views/dashboard.html`

- [ ] **Step 1: Añadir el contenedor de la tarjeta**

En `views/dashboard.html`, añadir un contenedor donde tenga sentido en el flujo (p. ej. tras el resumen del mes):

```html
<div id="brujulaMicroahorro" class="dash-microahorro" hidden></div>
```

Y CSS mínimo en el `<style>` del dashboard:

```css
.dash-microahorro { margin: var(--space-md) 0; padding: var(--space-md); border-radius: var(--radius-lg); border: 1px solid var(--border-light); background: color-mix(in srgb, var(--color-success) 8%, transparent); display:flex; flex-direction:column; gap: var(--space-sm); }
.dash-microahorro[hidden] { display:none; }
.dash-microahorro-txt { font-size: var(--font-size-base); }
.dash-microahorro .dec-offline { color: var(--text-secondary); font-size: var(--font-size-sm); }
```

- [ ] **Step 2: Renderizar la sugerencia**

En el `<script>` del dashboard, tras cargar metas/balance, añadir:

```javascript
async function renderMicroahorro() {
  try {
    var cont = document.getElementById('brujulaMicroahorro');
    if (!cont || typeof sugerirMicroahorro !== 'function') return;
    var balance = await getBalancePersonal(hoy.mes, hoy.anio); // ámbito personal para el nudge
    var metas = await getMetas('personal');
    var liquidez = Math.max(0, balance.ingresos - balance.gastos);
    var s = sugerirMicroahorro(metas, liquidez, new Date());
    if (!s) { cont.hidden = true; return; }
    var offline = !navigator.onLine;
    cont.innerHTML = '<div class="dash-microahorro-txt">' + s.texto + '</div>' +
      '<button type="button" class="btn btn-primary" id="microApartar"' + (offline ? ' disabled' : '') + '>Apartar ' + formatMonto(s.sugerido) + '</button>' +
      (offline ? '<span class="dec-offline">Necesitas conexión para esto.</span>' : '');
    cont.hidden = false;
    var b = document.getElementById('microApartar');
    if (b) b.addEventListener('click', async function () {
      b.disabled = true;
      try { await insertAporteDirecto(s.meta_id, s.sugerido); mostrarToast('Aporte registrado', 3000); cont.hidden = true; }
      catch (err) { console.error('microahorro aporte:', err); b.disabled = false; }
    });
  } catch (err) { console.error('renderMicroahorro:', err); }
}
```

Llamar `renderMicroahorro();` junto a las otras cargas iniciales del dashboard. Verificar los nombres reales de los helpers del dashboard (`hoy`, `formatMonto`, `mostrarToast`, `getBalancePersonal`, `getMetas`, `insertAporteDirecto`) — todos existen globalmente; ajustar si el dashboard usa otra variable de fecha.

- [ ] **Step 2b: Asegurar que `js/brujula.js` esté disponible en el dashboard**

`sugerirMicroahorro` se expone en `window` vía el `<script type="module" src="js/brujula.js">` añadido en Task 7 (carga global en `index.html`, disponible para todas las vistas). No se requiere include adicional en la vista.

- [ ] **Step 3: Verificar en preview**

Levantar el server, ir al dashboard con al menos una meta en curso y liquidez positiva. Confirmar que aparece la tarjeta y el botón; con `navigator.onLine=false`, botón deshabilitado + aviso. `preview_console_logs` limpio.

- [ ] **Step 4: Commit**

```bash
git add views/dashboard.html
git commit -m "feat(brujula): tarjeta de micro-ahorro proactiva en el dashboard"
```

---

## Self-Review

**Cobertura del spec:**
- ¿Cuánto puedo gastar (rango cómodo→tope) → Task 1 + Task 6. ✓
- Simular compra grande (convertir en meta) → Task 2 + render en Task 6. ✓
- Freno anti-impulso (costo oportunidad + flag esencial) → Task 3 + Task 5 + render en Task 6. ✓
- Micro-ahorro 1 toque proactivo → Task 4 + Task 8. ✓
- Presencia reactiva (pestaña Brújula) → Task 6 + Task 7. ✓
- Presencia proactiva (dashboard) → Task 8. ✓
- Cálculo del rango (fórmulas liquidez/tope/cómodo/ritmo) → Task 1, fórmulas exactas del spec. ✓
- Offline (deshabilitar + avisar) → render en Task 6 y Task 8. ✓
- Separación lógica/UI (js/brujula.js puro) → Tasks 1-4. ✓
- Migración `categorias.esencial` → Task 5. ✓
- Rename ruta/nav + baja del Oráculo → Task 7. ✓

**Placeholders:** ninguno — cada paso trae código real, comandos y salidas esperadas.

**Consistencia de tipos/firmas:** `calcularRango(monto, m, categoria)` con `m` = `{ limite, gastoMes, ingresos, gastos, recurrentesPendientes, colchonMetas, gastoSemana, diasSemana, diasMes }` usado idéntico en Task 1 (tests), Task 6 (`recolectarMetricas` produce exactamente esas claves). `planMeta` devuelve `{ faltante, aporteMes, fechaMeta }`, consumido en Task 6. `costoOportunidad(monto, categoria, metaCritica)` con `metaCritica = { nombre, aporteTipico }`, producido en `recolectarMetricas` (Task 6) y testeado en Task 3. `sugerirMicroahorro` devuelve `{ meta_id, meta, sugerido, texto }`, consumido en Task 8. Niveles de `calcularRango` (`consulta`/`recomendable`/`cautela`/`no`/`sin-margen`) mapeados en `renderBrujula` (Task 6). Coherente.

**Riesgos anotados para el ejecutor:** verificar en `js/db.js` que `updateCategoria` propaga `esencial` (Task 5), que `insertMeta` acepta `ambito`/columnas reales (Task 6), y los nombres de helpers del dashboard (Task 8). Estos son puntos de verificación, no supuestos.
