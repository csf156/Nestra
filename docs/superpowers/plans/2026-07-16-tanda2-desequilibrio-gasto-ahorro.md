# Tanda 2 — Desequilibrio en gasto y en ahorro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar el desequilibrio de aportes del hogar en dos cifras —gastos compartidos y ahorro al hogar— cada una con su brecha histórica, en `#hogar` y en el dashboard.

**Architecture:** Todo en el cliente; la base no se toca (`transacciones` ya tiene `tipo`, `ambito`, `user_id`, `monto`). `js/hogar-desequilibrio.js` pasa de una función a dos: `desequilibrioGastoHogar` (con `ajustes`) y `desequilibrioAhorroHogar` (**sin** `ajustes`, para que restar un pago en efectivo del ahorro sea inexpresable). `js/hogar-aporte.js` pasa de devolver un número a `{ gasto, ahorro, total }`. Las dos vistas consumidoras se actualizan en el mismo commit que cada firma que rompen.

**Tech Stack:** JS vanilla sin build, módulos puros con dual-export (`window.X` + `export`), tests con `node --test test/*.test.mjs`, deploy por push a `v2` (Cloudflare Pages).

**Spec:** `docs/superpowers/specs/2026-07-16-tanda2-desequilibrio-gasto-ahorro-design.md`

---

## Contexto imprescindible

**No hay "desequilibrio general".** El item lo pedía; se descartó en el diseño con los datos
reales del hogar. Gasto y ahorro no son la misma moneda: el gasto se fue, el ahorro vuelve a
quien lo puso al disolver (`disolver_hogar` reparte el bote por ahorro real, que es la
identidad `pot × ahorroA/(ahorroA+ahorroB) = ahorroA`). Con los montos reales las dos brechas
apuntan a **miembros distintos**; sumarlas invertía la conclusión. Si al implementar sientes
la tentación de sumar las dos cifras "para dar un total", **no lo hagas** — hay un test que
lo impide a propósito.

**Estado actual verificado (2026-07-16):** 233 tests pasan. `SHELL_VERSION = 'v28'`
(`sw.js:15`). Los módulos puros se cargan como `<script type="module">` en `index.html` y se
precachean en `sw.js`. `js/hogar-desequilibrio.js` y `js/hogar-aporte.js` ya están en ambas
listas — **no hay que añadirlos**.

**Datos reales del hogar** (para los tests de regresión y la verificación manual):

| | gasto hogar | ahorro hogar |
|---|---|---|
| César (creador) | 125.54 | 55.00 |
| Darling (miembro) | 50.00 | 450.00 |

`reparto = '50_50'`, `aporte_esperado = 0.00` en ambos.
Brechas: gasto → Darling debe aportar **S/37.77** más; ahorro → César debe ahorrar **S/197.50** más.

---

## File Structure

| Archivo | Responsabilidad | Tarea |
|---------|-----------------|-------|
| `js/hogar-desequilibrio.js` | `desequilibrioGastoHogar` + `desequilibrioAhorroHogar` | 1 |
| `test/hogar-desequilibrio.test.mjs` | 9 tests re-apuntados + los de ahorro + regresión con datos reales | 1 |
| `js/hogar-aporte.js` | `aporteRealPorMiembro` → `{ gasto, ahorro, total }` | 2 |
| `test/hogar-aporte.test.mjs` | 5 tests migrados a `.total` + los de `.gasto`/`.ahorro` | 2 |
| `views/hogar.html` | Card en dos bloques + "Aporte del mes" desglosado | 3 |
| `views/dashboard.html` | `dashDeudaCard` en dos filas | 4 |
| `sw.js` | Bump `SHELL_VERSION` | 5 |

---

### Task 1: Dos funciones de desequilibrio

**Files:**
- Modify: `js/hogar-desequilibrio.js` (el archivo entero, son 57 líneas)
- Modify: `test/hogar-desequilibrio.test.mjs`

- [ ] **Step 1: Re-apuntar los 9 tests existentes y añadir los nuevos**

Reemplazar `test/hogar-desequilibrio.test.mjs` **entero** por:

```javascript
import assert from 'node:assert';
import { test } from 'node:test';
import { desequilibrioGastoHogar, desequilibrioAhorroHogar } from '../js/hogar-desequilibrio.js';

const A = 'uidA', B = 'uidB';
function gasto(user_id, monto) { return { tipo: 'gasto', ambito: 'hogar', user_id, monto }; }
function ahorro(user_id, monto) { return { tipo: 'ahorro', ambito: 'hogar', user_id, monto }; }
function personal(user_id, monto) { return { tipo: 'gasto', ambito: 'personal', user_id, monto }; }

// ── Gasto: los 9 de antes, con el nombre nuevo. Si alguno cambia de resultado,
// el rename rompió algo. ────────────────────────────────────────────────────

test('50/50, uno paga todo → brecha = mitad del total', () => {
  const r = desequilibrioGastoHogar([gasto(A, 100)], [], A, B, { modo: '50_50' });
  assert.strictEqual(r.brecha, 50);
  assert.strictEqual(r.debeAportarMas, B);
  assert.strictEqual(r.yaAportoDeMas, A);
});

test('50/50, pagos iguales → brecha 0, sin acreedor/deudor', () => {
  const r = desequilibrioGastoHogar([gasto(A, 60), gasto(B, 60)], [], A, B, { modo: '50_50' });
  assert.strictEqual(r.brecha, 0);
  assert.strictEqual(r.debeAportarMas, null);
  assert.strictEqual(r.yaAportoDeMas, null);
});

test('proporcional con aporte_esperado dispares', () => {
  const txs = [gasto(A, 100)];
  const objetivo = { modo: 'proporcional', esperadoA: 700, esperadoB: 300 };
  const r = desequilibrioGastoHogar(txs, [], A, B, objetivo);
  // objetivoA = 0.7; neto = 100 - 0.7*100 = 30
  assert.strictEqual(r.brecha, 30);
  assert.strictEqual(r.debeAportarMas, B);
});

test('proporcional con ambos aporte_esperado en 0 → cae a 50/50', () => {
  const txs = [gasto(A, 100), gasto(B, 40)];
  const objetivo = { modo: 'proporcional', esperadoA: 0, esperadoB: 0 };
  const r = desequilibrioGastoHogar(txs, [], A, B, objetivo);
  assert.strictEqual(r.brecha, 30); // (100-40)/2
  assert.strictEqual(r.debeAportarMas, B);
});

test('ajuste en efectivo reduce la brecha', () => {
  const txs = [gasto(A, 100)];
  const ajustes = [{ de_user: B, a_user: A, monto: 50 }]; // B ya compensó 50 a A
  const r = desequilibrioGastoHogar(txs, ajustes, A, B, { modo: '50_50' });
  assert.strictEqual(r.brecha, 0);
  assert.strictEqual(r.debeAportarMas, null);
});

test('ajuste en efectivo que sobre-compensa invierte la brecha', () => {
  const txs = [gasto(A, 100)];
  const ajustes = [{ de_user: B, a_user: A, monto: 80 }]; // brecha previa era 50, B pagó 80
  const r = desequilibrioGastoHogar(txs, ajustes, A, B, { modo: '50_50' });
  assert.strictEqual(r.brecha, 30);
  assert.strictEqual(r.debeAportarMas, A);
  assert.strictEqual(r.yaAportoDeMas, B);
});

test('sin gastos del hogar → brecha 0, sin división por cero', () => {
  const r = desequilibrioGastoHogar([], [], A, B, { modo: '50_50' });
  assert.strictEqual(r.brecha, 0);
  const rProp = desequilibrioGastoHogar([], [], A, B, { modo: 'proporcional', esperadoA: 0, esperadoB: 0 });
  assert.strictEqual(rProp.brecha, 0);
});

test('filas de ahorro-hogar presentes no afectan la brecha de gasto', () => {
  const conAhorro = desequilibrioGastoHogar([gasto(A, 100), ahorro(A, 999)], [], A, B, { modo: '50_50' });
  const sinAhorro = desequilibrioGastoHogar([gasto(A, 100)], [], A, B, { modo: '50_50' });
  assert.strictEqual(conAhorro.brecha, sinAhorro.brecha);
});

test('filas personales presentes son ignoradas', () => {
  const conPersonal = desequilibrioGastoHogar([gasto(A, 100), personal(A, 999)], [], A, B, { modo: '50_50' });
  const sinPersonal = desequilibrioGastoHogar([gasto(A, 100)], [], A, B, { modo: '50_50' });
  assert.strictEqual(conPersonal.brecha, sinPersonal.brecha);
});

// ── Ahorro ─────────────────────────────────────────────────────────────────

test('ahorro 50/50, uno ahorra todo → brecha = mitad del total', () => {
  const r = desequilibrioAhorroHogar([ahorro(A, 100)], A, B, { modo: '50_50' });
  assert.strictEqual(r.brecha, 50);
  assert.strictEqual(r.debeAportarMas, B);
  assert.strictEqual(r.yaAportoDeMas, A);
});

test('ahorro 50/50, iguales → brecha 0', () => {
  const r = desequilibrioAhorroHogar([ahorro(A, 60), ahorro(B, 60)], A, B, { modo: '50_50' });
  assert.strictEqual(r.brecha, 0);
  assert.strictEqual(r.debeAportarMas, null);
});

test('ahorro: las filas de gasto-hogar NO cuentan', () => {
  const r = desequilibrioAhorroHogar([ahorro(A, 100), gasto(A, 999), gasto(B, 999)], A, B, { modo: '50_50' });
  assert.strictEqual(r.brecha, 50); // solo cuenta el ahorro de 100
  assert.strictEqual(r.debeAportarMas, B);
});

test('ahorro: las filas personales NO cuentan', () => {
  const personalAhorro = { tipo: 'ahorro', ambito: 'personal', user_id: A, monto: 999 };
  const r = desequilibrioAhorroHogar([ahorro(A, 100), personalAhorro], A, B, { modo: '50_50' });
  assert.strictEqual(r.brecha, 50);
});

test('ahorro: modo proporcional usa el mismo ratio que gasto', () => {
  const objetivo = { modo: 'proporcional', esperadoA: 700, esperadoB: 300 };
  const r = desequilibrioAhorroHogar([ahorro(A, 100)], A, B, objetivo);
  assert.strictEqual(r.brecha, 30); // neto = 100 - 0.7*100
  assert.strictEqual(r.debeAportarMas, B);
});

test('ahorro: sin filas → brecha 0, sin división por cero', () => {
  assert.strictEqual(desequilibrioAhorroHogar([], A, B, { modo: '50_50' }).brecha, 0);
  assert.strictEqual(
    desequilibrioAhorroHogar([], A, B, { modo: 'proporcional', esperadoA: 0, esperadoB: 0 }).brecha, 0);
});

// El pago en efectivo NO zanja el ahorro: no mueve el bote. La función no acepta
// `ajustes` justamente para que sea inexpresable. Este test fija que un 4º
// argumento colado por error no se interprete como ajustes.
test('ahorro: un array de ajustes pasado por error NO altera la brecha', () => {
  const ajustes = [{ de_user: B, a_user: A, monto: 50 }];
  const sinAjustes = desequilibrioAhorroHogar([ahorro(A, 100)], A, B, { modo: '50_50' });
  const conAjustes = desequilibrioAhorroHogar([ahorro(A, 100)], A, B, { modo: '50_50' }, ajustes);
  assert.strictEqual(conAjustes.brecha, sinAjustes.brecha);
  assert.strictEqual(conAjustes.brecha, 50);
});

// ── Regresión: los datos reales del hogar (2026-07-16) ─────────────────────
// Existe para impedir que alguien "simplifique" sumando las dos brechas. Con
// los montos reales apuntan a miembros DISTINTOS: sumarlas invierte quién debe.
// Ver el spec (§"Por qué no hay general").
test('datos reales: gasto y ahorro apuntan a miembros distintos', () => {
  const txs = [
    gasto(A, 125.54), gasto(B, 50.00),
    ahorro(A, 55.00), ahorro(B, 450.00),
  ];
  const g = desequilibrioGastoHogar(txs, [], A, B, { modo: '50_50' });
  const s = desequilibrioAhorroHogar(txs, A, B, { modo: '50_50' });

  assert.strictEqual(g.brecha, 37.77);
  assert.strictEqual(g.debeAportarMas, B);   // Darling debe aportar más en gastos

  assert.strictEqual(s.brecha, 197.5);
  assert.strictEqual(s.debeAportarMas, A);   // César debe ahorrar más

  // El corazón del diseño: apuntan a personas distintas. Si esto empieza a
  // fallar, alguien fusionó las métricas.
  assert.notStrictEqual(g.debeAportarMas, s.debeAportarMas);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `node --test test/hogar-desequilibrio.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../js/hogar-desequilibrio.js' does not provide an export named 'desequilibrioAhorroHogar'`.

- [ ] **Step 3: Implementar las dos funciones**

Reemplazar `js/hogar-desequilibrio.js` **entero** por:

```javascript
// ─────────────────────────────────────────────────────────────────
// Nestra — hogar-desequilibrio.js (Fase 6.3 · Tanda 2)
// Desequilibrio de aportes: cuánto puso cada miembro al hogar contra un
// objetivo de reparto, histórico completo y sin reset. Es prospectivo
// ("B debería aportar más de acá en adelante"), no una deuda.
//
// Hay DOS métricas, deliberadamente separadas y nunca sumadas:
//
//   gasto  — gastos compartidos. El dinero se gastó y no vuelve: si pusiste
//            de más, estás abajo de verdad. Un pago en efectivo entre los dos
//            (hogar_liquidaciones) lo zanja.
//   ahorro — ahorro al hogar. El dinero está aparcado y VUELVE a quien lo
//            puso al disolver (disolver_hogar reparte el bote por ahorro real:
//            pot × ahorroA/(ahorroA+ahorroB) = ahorroA). Nadie está abajo, así
//            que un pago en efectivo NO lo zanja — solo se cierra ahorrando.
//
// Por eso desequilibrioAhorroHogar NO recibe `ajustes`: hace inexpresable
// restar un pago en efectivo de una brecha que el pago no mueve.
//
// NO SUMAR LAS DOS BRECHAS. Con los datos reales del hogar apuntan a miembros
// distintos y el total invierte la conclusión, apoyándose en dinero que vuelve.
// Ver docs/superpowers/specs/2026-07-16-tanda2-desequilibrio-gasto-ahorro-design.md
// y el test 'datos reales: gasto y ahorro apuntan a miembros distintos'.
//
// Determinista, sin red. Dual-export como safe-to-spend.js / insights.js.
// ─────────────────────────────────────────────────────────────────
'use strict';

// _brecha(transacciones, tipo, ajustes, uidA, uidB, objetivo)
//   Núcleo compartido. `ajustes` puede ser null (el caso del ahorro).
//   objetivo: { modo: '50_50'|'proporcional', esperadoA?, esperadoB? }.
//     'proporcional' cae a 50/50 si esperadoA+esperadoB es 0.
// Returns: { brecha, debeAportarMas, yaAportoDeMas, pagoA, pagoB }.
//   brecha=0 ⇒ debeAportarMas y yaAportoDeMas son null (van igual).
function _brecha(transacciones, tipo, ajustes, uidA, uidB, objetivo) {
  var pagoA = 0, pagoB = 0;
  (transacciones || []).forEach(function (t) {
    if (t.ambito !== 'hogar' || t.tipo !== tipo) return;
    if (t.user_id === uidA) pagoA += Number(t.monto) || 0;
    else if (t.user_id === uidB) pagoB += Number(t.monto) || 0;
  });

  var objetivoA = 0.5;
  if (objetivo && objetivo.modo === 'proporcional') {
    var eA = Number(objetivo.esperadoA) || 0, eB = Number(objetivo.esperadoB) || 0;
    if (eA + eB > 0) objetivoA = eA / (eA + eB);
  }

  // >0 ⇒ A puso de más ⇒ B debería aportar más de acá en adelante.
  var neto = pagoA - objetivoA * (pagoA + pagoB);

  (ajustes || []).forEach(function (a) {
    var m = Number(a.monto) || 0;
    if (a.de_user === uidB && a.a_user === uidA) neto -= m; // B ya compensó a A
    else if (a.de_user === uidA && a.a_user === uidB) neto += m; // A ya compensó a B
  });

  neto = Math.round(neto * 100) / 100;
  return {
    brecha: Math.abs(neto),
    debeAportarMas: neto > 0 ? uidB : (neto < 0 ? uidA : null),
    yaAportoDeMas: neto > 0 ? uidA : (neto < 0 ? uidB : null),
    pagoA: pagoA,
    pagoB: pagoB,
  };
}

// desequilibrioGastoHogar(transacciones, ajustes, uidA, uidB, objetivo)
//   Solo cuenta tipo='gasto' && ambito='hogar'.
//   ajustes: pagos en efectivo ya registrados: [{ de_user, a_user, monto }].
//   pagoA/pagoB = lo que gastó cada uno en el hogar.
function desequilibrioGastoHogar(transacciones, ajustes, uidA, uidB, objetivo) {
  return _brecha(transacciones, 'gasto', ajustes, uidA, uidB, objetivo);
}

// desequilibrioAhorroHogar(transacciones, uidA, uidB, objetivo)
//   Solo cuenta tipo='ahorro' && ambito='hogar'.
//   SIN `ajustes` a propósito: un pago en efectivo no mueve el bote, así que no
//   puede zanjar esta brecha. La firma lo hace inexpresable.
//   pagoA/pagoB = lo que ahorró cada uno al hogar (el nombre se conserva del
//   núcleo compartido; acá significan "ahorró", no "pagó").
function desequilibrioAhorroHogar(transacciones, uidA, uidB, objetivo) {
  return _brecha(transacciones, 'ahorro', null, uidA, uidB, objetivo);
}

if (typeof window !== 'undefined') {
  window.desequilibrioGastoHogar = desequilibrioGastoHogar;
  window.desequilibrioAhorroHogar = desequilibrioAhorroHogar;
}

export { desequilibrioGastoHogar, desequilibrioAhorroHogar };
```

- [ ] **Step 4: Verificar que pasa**

Run: `node --test test/hogar-desequilibrio.test.mjs`
Expected: PASS — 16/16 tests (9 de gasto + 6 de ahorro + 1 de regresión con datos reales).

- [ ] **Step 5: Confirmar que no queda ningún caller del nombre viejo sin actualizar**

Run: `grep -rn "calcularDesequilibrioHogar" js/ views/ test/`
Expected: 2 hits, ambos en `views/` (`hogar.html`, `dashboard.html`). Se arreglan en las
Tasks 3 y 4. **No los toques todavía** — cada vista se actualiza en su propia tarea.

Nota: la app quedará rota entre esta tarea y la Task 4. Es a propósito: son commits
consecutivos de la misma tanda y no se despliega hasta la Task 5. Si prefieres no dejar la
rama rota entre commits, haz Tasks 1, 3 y 4 juntas antes de commitear.

- [ ] **Step 6: Commit**

```bash
git add js/hogar-desequilibrio.js test/hogar-desequilibrio.test.mjs
git commit -m "feat(hogar): separa el desequilibrio en gasto y ahorro

calcularDesequilibrioHogar se parte en desequilibrioGastoHogar y
desequilibrioAhorroHogar. El nombre viejo no decía qué medía, así que no se
conserva como alias: los callers se actualizan en los commits siguientes.

desequilibrioAhorroHogar NO recibe \`ajustes\`. No es un olvido: un pago en
efectivo entre los dos no mueve el bote, así que no puede zanjar una brecha
de ahorro — esa solo se cierra ahorrando. La firma lo hace inexpresable en
vez de dejarlo a una convención que alguien puede ignorar.

Los 9 tests de gasto se re-apuntan sin cambiar de resultado. Se añade una
regresión con los datos reales del hogar: las dos brechas apuntan a miembros
DISTINTOS (Darling debe S/37.77 en gastos, César S/197.50 en ahorro), así que
sumarlas invierte quién debe apoyándose en dinero que vuelve al disolver. Ese
test existe para que nadie las fusione."
```

---

### Task 2: `aporteRealPorMiembro` devuelve el desglose

**Files:**
- Modify: `js/hogar-aporte.js` (el archivo entero, son 29 líneas)
- Modify: `test/hogar-aporte.test.mjs`

Contexto: hoy devuelve un número (gasto+ahorro sumados). La card "Aporte del mes" lo compara
contra `aporte_esperado`; con `aporte_esperado = 0` en ambos —su estado real— degenera en
"Tú S/180.54 · Pareja S/500.00", el mismo general engañoso pero por miembro.

El `total` **sí** se sigue exponiendo y sigue siendo legítimo sumar acá: cada miembro se
compara contra **su propia meta mensual**, no contra el otro. Lo que se añade es el desglose.

- [ ] **Step 1: Migrar los tests**

Reemplazar `test/hogar-aporte.test.mjs` **entero** por:

```javascript
// test/hogar-aporte.test.mjs
import assert from 'node:assert';
import { test } from 'node:test';
import { aporteRealPorMiembro } from '../js/hogar-aporte.js';

const RANGO = { desde: '2026-06-01', hasta: '2026-06-30' };
function tx(user_id, tipo, ambito, monto, fecha) {
  return { user_id, tipo, ambito, monto, fecha: fecha || '2026-06-10' };
}

test('suma gasto hogar + ahorro hogar del miembro en el rango', () => {
  const txs = [
    tx('A', 'gasto', 'hogar', 100),
    tx('A', 'ahorro', 'hogar', 200),
    tx('B', 'gasto', 'hogar', 40),
  ];
  assert.strictEqual(aporteRealPorMiembro(txs, 'A', RANGO).total, 300);
});

test('ignora filas de otro miembro', () => {
  const txs = [tx('A', 'gasto', 'hogar', 100), tx('B', 'gasto', 'hogar', 999)];
  assert.strictEqual(aporteRealPorMiembro(txs, 'A', RANGO).total, 100);
});

test('ignora filas personales', () => {
  const txs = [tx('A', 'gasto', 'personal', 999), tx('A', 'gasto', 'hogar', 50)];
  assert.strictEqual(aporteRealPorMiembro(txs, 'A', RANGO).total, 50);
});

test('ignora tipo=ingreso (ya no cuenta) y fechas fuera de rango', () => {
  const txs = [
    tx('A', 'ingreso', 'hogar', 999),           // estado ilegal en el modelo nuevo; igual se ignora si aparece
    tx('A', 'gasto', 'hogar', 70, '2026-05-30'), // fuera de rango
    tx('A', 'gasto', 'hogar', 20, '2026-06-15'),
  ];
  assert.strictEqual(aporteRealPorMiembro(txs, 'A', RANGO).total, 20);
});

test('sin filas → todo en 0', () => {
  const r = aporteRealPorMiembro([], 'A', RANGO);
  assert.deepStrictEqual(r, { gasto: 0, ahorro: 0, total: 0 });
});

// ── Desglose (Tanda 2) ─────────────────────────────────────────────────────

test('devuelve gasto y ahorro por separado, y total = gasto + ahorro', () => {
  const txs = [
    tx('A', 'gasto', 'hogar', 100),
    tx('A', 'gasto', 'hogar', 25.54),
    tx('A', 'ahorro', 'hogar', 55),
  ];
  const r = aporteRealPorMiembro(txs, 'A', RANGO);
  assert.strictEqual(r.gasto, 125.54);
  assert.strictEqual(r.ahorro, 55);
  assert.strictEqual(r.total, 180.54);
});

test('solo gasto → ahorro en 0', () => {
  const r = aporteRealPorMiembro([tx('A', 'gasto', 'hogar', 100)], 'A', RANGO);
  assert.strictEqual(r.gasto, 100);
  assert.strictEqual(r.ahorro, 0);
  assert.strictEqual(r.total, 100);
});

test('solo ahorro → gasto en 0', () => {
  const r = aporteRealPorMiembro([tx('A', 'ahorro', 'hogar', 450)], 'A', RANGO);
  assert.strictEqual(r.gasto, 0);
  assert.strictEqual(r.ahorro, 450);
  assert.strictEqual(r.total, 450);
});

test('el desglose respeta el rango de fechas igual que el total', () => {
  const txs = [
    tx('A', 'gasto', 'hogar', 999, '2026-05-30'),   // fuera
    tx('A', 'ahorro', 'hogar', 999, '2026-07-01'),  // fuera
    tx('A', 'gasto', 'hogar', 10, '2026-06-15'),
    tx('A', 'ahorro', 'hogar', 20, '2026-06-15'),
  ];
  const r = aporteRealPorMiembro(txs, 'A', RANGO);
  assert.strictEqual(r.gasto, 10);
  assert.strictEqual(r.ahorro, 20);
  assert.strictEqual(r.total, 30);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `node --test test/hogar-aporte.test.mjs`
Expected: FAIL — los tests con `.total` fallan porque hoy devuelve un número
(`undefined === 300`), y `deepStrictEqual` contra `{gasto,ahorro,total}` también.

- [ ] **Step 3: Implementar el desglose**

Reemplazar `js/hogar-aporte.js` **entero** por:

```javascript
// ─────────────────────────────────────────────────────────────────
// Nestra — hogar-aporte.js (Fase 6.3 · Tanda 2)
// Aporte real de un miembro al hogar en un rango, desglosado en gasto
// (su parte de gastos compartidos) y ahorro (lo que apartó para metas/fondo).
//
// Devuelve los dos por separado Y su total. El total es legítimo acá, a
// diferencia del desequilibrio: la card compara a cada miembro contra SU
// propia meta mensual (hogar_miembros.aporte_esperado = "cuánto acordamos
// poner al hogar al mes"), no contra el otro miembro. "¿Cumplí lo que
// acordé?" no tiene el problema de doble conteo que hace que las brechas de
// hogar-desequilibrio.js no se puedan sumar.
//
// El desglose existe porque con aporte_esperado en 0 no hay meta contra la
// que medir, y dos totales lado a lado se leen como una carrera — insinuando
// que quien ahorró 450 aportó más que quien gastó 125, cuando esos 450 le
// vuelven al disolver.
//
// Puro y determinista. Dual-export como safe-to-spend.js.
// ─────────────────────────────────────────────────────────────────
'use strict';

// aporteRealPorMiembro(transacciones, userId, rango)
//   rango: { desde, hasta } en ISO (YYYY-MM-DD); ambos opcionales.
// Returns: { gasto, ahorro, total } — solo filas de ambito='hogar' del miembro.
function aporteRealPorMiembro(transacciones, userId, rango) {
  var desde = rango && rango.desde, hasta = rango && rango.hasta;
  var gasto = 0, ahorro = 0;
  (transacciones || []).forEach(function (t) {
    if (t.user_id !== userId) return;
    if (t.ambito !== 'hogar') return;
    if (t.tipo !== 'gasto' && t.tipo !== 'ahorro') return;
    if (desde && t.fecha < desde) return;
    if (hasta && t.fecha > hasta) return;
    var m = Number(t.monto) || 0;
    if (t.tipo === 'gasto') gasto += m; else ahorro += m;
  });
  var r2 = function (n) { return Math.round(n * 100) / 100; };
  gasto = r2(gasto); ahorro = r2(ahorro);
  return { gasto: gasto, ahorro: ahorro, total: r2(gasto + ahorro) };
}

if (typeof window !== 'undefined') {
  window.aporteRealPorMiembro = aporteRealPorMiembro;
}

export { aporteRealPorMiembro };
```

- [ ] **Step 4: Verificar que pasa**

Run: `node --test test/hogar-aporte.test.mjs`
Expected: PASS — 9/9 tests (5 migrados + 4 nuevos).

- [ ] **Step 5: Commit**

```bash
git add js/hogar-aporte.js test/hogar-aporte.test.mjs
git commit -m "feat(hogar): aporteRealPorMiembro devuelve { gasto, ahorro, total }

Devolvía un número con gasto+ahorro sumados. Con aporte_esperado en 0 —el
estado real del hogar— la card 'Aporte del mes' degeneraba en 'Tú S/180.54 ·
Pareja S/500.00': el mismo total engañoso que se rechazó para el
desequilibrio, pero por miembro.

El total se conserva y sigue siendo legítimo acá: cada miembro se compara
contra SU meta mensual, no contra el otro, así que no hay doble conteo. El
desglose es lo que evita que dos cifras lado a lado se lean como una carrera."
```

---

### Task 3: La card del hogar en dos bloques

**Files:**
- Modify: `views/hogar.html` (~líneas 412-489)

- [ ] **Step 1: Calcular las dos brechas**

En `renderConHogar`, reemplazar el bloque de las líneas ~412-423:

```javascript
      // Desequilibrio de aportes (solo con un segundo miembro). Prospectivo,
      // histórico completo, solo gastos compartidos (Fase 6.3).
      var deseq = { brecha: 0, debeAportarMas: null, yaAportoDeMas: null };
      var objetivo = { modo: (estado.hogar && estado.hogar.reparto) || '50_50' };
      if (objetivo.modo === 'proporcional') {
        var mA = miembros.find(function (m) { return m.user_id === creadorId; }) || {};
        var mB = miembros.find(function (m) { return m.user_id === otro; }) || {};
        objetivo.esperadoA = mA.aporte_esperado; objetivo.esperadoB = mB.aporte_esperado;
      }
      if (otro && typeof window.calcularDesequilibrioHogar === 'function') {
        deseq = window.calcularDesequilibrioHogar(txs, liqs, creadorId, otro, objetivo);
      }
```

por:

```javascript
      // Desequilibrio de aportes (solo con un segundo miembro). Prospectivo,
      // histórico completo. DOS métricas separadas, nunca sumadas: el gasto se
      // fue, el ahorro vuelve a quien lo puso al disolver (Tanda 2).
      var vacio = { brecha: 0, debeAportarMas: null, yaAportoDeMas: null, pagoA: 0, pagoB: 0 };
      var deseqGasto = vacio, deseqAhorro = vacio;
      var objetivo = { modo: (estado.hogar && estado.hogar.reparto) || '50_50' };
      if (objetivo.modo === 'proporcional') {
        var mA = miembros.find(function (m) { return m.user_id === creadorId; }) || {};
        var mB = miembros.find(function (m) { return m.user_id === otro; }) || {};
        objetivo.esperadoA = mA.aporte_esperado; objetivo.esperadoB = mB.aporte_esperado;
      }
      if (otro && typeof window.desequilibrioGastoHogar === 'function') {
        deseqGasto = window.desequilibrioGastoHogar(txs, liqs, creadorId, otro, objetivo);
        // Sin liqs: un pago en efectivo no mueve el bote, así que no zanja ahorro.
        deseqAhorro = window.desequilibrioAhorroHogar(txs, creadorId, otro, objetivo);
      }
```

- [ ] **Step 2: Reescribir la card**

Reemplazar el bloque de las líneas ~442-469 (`// ── Bloque desequilibrio de aportes ──`
hasta el cierre de ese `if/else`) por:

```javascript
      // ── Bloque desequilibrio de aportes (Tanda 2: gasto y ahorro aparte) ──
      // Los montos crudos por miembro hacen legible la brecha: antes solo se
      // veía "S/37.77 más" sin saber de dónde salía.
      function _montosHtml(d) {
        var mio = (uidActual === creadorId) ? d.pagoA : d.pagoB;
        var suyo = (uidActual === creadorId) ? d.pagoB : d.pagoA;
        return '<span class="hogar-deseq-montos">Tú ' + escHtml(fmt(mio)) +
               ' · Pareja ' + escHtml(fmt(suyo)) + '</span>';
      }

      function _bloqueHtml(d, titulo, verboDebe, sub, extraHtml) {
        var cuerpo;
        if (d.brecha === 0) {
          cuerpo = '<p class="hogar-balance-num hogar-balance-num--mano">Van igual</p>';
        } else {
          var yoDeboMas = d.debeAportarMas === uidActual;
          cuerpo =
            '<p class="hogar-balance-num ' + (yoDeboMas ? 'hogar-balance-num--debe' : 'hogar-balance-num--cobra') + '">' +
              (yoDeboMas ? 'Deberías ' + verboDebe + ' ' : 'Tu pareja debería ' + verboDebe + ' ') +
              escHtml(fmt(d.brecha)) + ' más' +
            '</p>' +
            '<p class="hogar-balance-sub">' + sub + (extraHtml || '') + '</p>';
        }
        return '<div class="hogar-deseq-bloque">' +
                 '<div class="hogar-deseq-head">' +
                   '<h3 class="hogar-deseq-titulo">' + titulo + '</h3>' + _montosHtml(d) +
                 '</div>' + cuerpo +
               '</div>';
      }

      var balCard;
      if (!otro) {
        balCard =
          '<div class="hogar-card">' +
            '<h2 class="hogar-card-title">Desequilibrio de aportes</h2>' +
            '<p class="hogar-card-sub">Comparte el código para que tu pareja se una y empiecen a registrar gastos compartidos.</p>' +
          '</div>';
      } else {
        balCard =
          '<div class="hogar-card">' +
            '<h2 class="hogar-card-title">Desequilibrio de aportes</h2>' +
            _bloqueHtml(deseqGasto, 'Gastos compartidos', 'aportar',
              'En los próximos gastos compartidos, para igualar el reparto. No es una deuda: se corrige gastando.',
              ' <a href="#" id="hogarLinkPagoEfectivo" style="font-size:var(--font-size-sm)">Registrar pago en efectivo</a>') +
            _bloqueHtml(deseqAhorro, 'Ahorro al hogar', 'ahorrar',
              'Para igualar el aporte al bote común. Se corrige ahorrando: un pago en efectivo no lo mueve.') +
            '<p class="hogar-deseq-nota">No se suman: el ahorro vuelve a quien lo puso al disolver, el gasto no.</p>' +
          '</div>';
      }
```

Nota: el link `hogarLinkPagoEfectivo` va **solo** en el bloque de gastos. Su listener
(línea ~549) ya busca ese id y no cambia — pero sus referencias a `deseq` sí (Step 4).

- [ ] **Step 3: Añadir el CSS**

En el `<style>` de `views/hogar.html`, junto a las reglas `.hogar-balance-*`:

```css
  .hogar-deseq-bloque { padding: var(--space-sm) 0; }
  .hogar-deseq-bloque + .hogar-deseq-bloque { border-top: 1px solid var(--border-light); }
  .hogar-deseq-head {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: var(--space-sm); flex-wrap: wrap;
  }
  .hogar-deseq-titulo {
    margin: 0; font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold);
    text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-secondary);
  }
  .hogar-deseq-montos { font-size: var(--font-size-sm); color: var(--text-secondary); }
  .hogar-deseq-nota {
    margin: var(--space-sm) 0 0; padding-top: var(--space-sm);
    border-top: 1px solid var(--border-light);
    font-size: var(--font-size-xs); color: var(--text-secondary);
  }
```

- [ ] **Step 4: Actualizar los consumidores de `deseq` en el mismo archivo**

`deseq` ya no existe. Hay 3 sitios que lo usan y todos hablan de **gastos**:

En el listener del pago en efectivo (~línea 549-552), cambiar `deseq.` por `deseqGasto.`:

```javascript
          if (!confirm('¿Registrar que ' + (deseqGasto.debeAportarMas === uidActual ? 'ya pagaste' : 'tu pareja ya pagó') +
            ' ' + fmt(deseqGasto.brecha) + ' en efectivo para cerrar el desequilibrio?')) return;
```

y

```javascript
            await window.saldarHogar(deseqGasto.debeAportarMas, deseqGasto.yaAportoDeMas, deseqGasto.brecha, 'Pago en efectivo');
```

En el botón de disolver (~línea 562):

```javascript
        $('hogarDisolverPreview').innerHTML = previewDisolucionHtml(txs, uidActual, otro, deseqGasto);
```

`previewDisolucionHtml` (~línea 372) **no se toca**: recibe el desequilibrio por parámetro y
su texto ya dice "desequilibrio de gastos compartidos", que sigue siendo exacto. Al disolver,
la brecha de ahorro es irrelevante — cada quien recupera lo suyo, que es lo que ese preview
ya muestra arriba (decisión 7 del spec).

- [ ] **Step 5: Desglosar "Aporte del mes"**

En el bloque `aporteCard` (~línea 476-488), reemplazar el `detalle`:

```javascript
          var real = (typeof window.aporteRealPorMiembro === 'function')
            ? window.aporteRealPorMiembro(txs, m.user_id, rangoMes) : 0;
          var esp = Number(m.aporte_esperado) || 0;
          var quien = (m.user_id === uidActual) ? 'Tú' : 'Tu pareja';
          var detalle = esp > 0
            ? escHtml(fmt(real)) + ' de ' + escHtml(fmt(esp)) + ' (' + Math.min(100, Math.round(real / esp * 100)) + '%)'
            : escHtml(fmt(real)) + ' (sin meta de aporte)';
          return '<p class="hogar-card-sub" style="margin:0 0 2px"><strong>' + escHtml(quien) + '</strong></p>' +
                 '<p class="hogar-balance-sub" style="margin:0 0 8px">' + detalle + '</p>';
```

por:

```javascript
          var real = (typeof window.aporteRealPorMiembro === 'function')
            ? window.aporteRealPorMiembro(txs, m.user_id, rangoMes)
            : { gasto: 0, ahorro: 0, total: 0 };
          var esp = Number(m.aporte_esperado) || 0;
          var quien = (m.user_id === uidActual) ? 'Tú' : 'Tu pareja';
          // El total sí se suma acá: se compara contra la meta propia del
          // miembro, no contra el otro. El desglose evita que dos totales lado
          // a lado se lean como una carrera (quien ahorra recupera lo suyo).
          var detalle = esp > 0
            ? escHtml(fmt(real.total)) + ' de ' + escHtml(fmt(esp)) + ' (' + Math.min(100, Math.round(real.total / esp * 100)) + '%)'
            : escHtml(fmt(real.total)) + ' (sin meta de aporte)';
          var desglose = escHtml(fmt(real.gasto)) + ' en gastos · ' + escHtml(fmt(real.ahorro)) + ' en ahorro';
          return '<p class="hogar-card-sub" style="margin:0 0 2px"><strong>' + escHtml(quien) + '</strong></p>' +
                 '<p class="hogar-balance-sub" style="margin:0">' + detalle + '</p>' +
                 '<p class="hogar-deseq-montos" style="margin:0 0 8px">' + desglose + '</p>';
```

- [ ] **Step 6: Verificar que no quedan referencias muertas**

Run: `grep -n "calcularDesequilibrioHogar\|\bdeseq\." views/hogar.html`
Expected: sin resultados (exit 1). Si sale algo, quedó un consumidor sin migrar.

Run: `node --test test/*.test.mjs`
Expected: `# fail 0` (esta tarea no añade tests; solo confirma que no rompiste nada).

- [ ] **Step 7: Commit**

```bash
git add views/hogar.html
git commit -m "feat(hogar): la card muestra el desequilibrio de gasto y el de ahorro

Dos bloques con los montos crudos por miembro y su brecha. Antes solo se veía
la cifra de gasto ('S/37.77 más') sin saber de dónde salía ni que existía una
brecha de ahorro apuntando al otro lado.

El link 'Registrar pago en efectivo' va solo en gastos: no zanja el ahorro.
La nota final ('no se suman: el ahorro vuelve a quien lo puso') es la defensa
contra que dos cifras juntas se resten mentalmente.

'Aporte del mes' desglosa gasto y ahorro bajo el total. El total se queda:
compara contra la meta propia, no contra la pareja."
```

---

### Task 4: El dashboard en dos filas

**Files:**
- Modify: `views/dashboard.html` (~líneas 1021-1060, `cargarDesequilibrioHogar`)

Contexto: `cargarDesequilibrioHogar` ya es una función nombrada con listener idempotente de
`hogar:changed` (arreglado en la Tanda 1, commit `3b14633`). **Esa parte no se toca** — solo
el cálculo y el render.

- [ ] **Step 1: Calcular las dos brechas y renderizar dos filas**

Reemplazar el bloque desde `if (!otro || typeof calcularDesequilibrioHogar !== 'function') return;`
hasta `card.style.display = '';` (~líneas 1032-1054) por:

```javascript
        if (!otro || typeof desequilibrioGastoHogar !== 'function') return;
        const [txs, liqs] = await Promise.all([getTransacciones({}), getLiquidacionesHogar()]);
        const modo = (estado.hogar && estado.hogar.reparto) || '50_50';
        const objetivo = { modo };
        if (modo === 'proporcional') {
          const mA = miembros.find((m) => m.user_id === creadorId) || {};
          const mB = miembros.find((m) => m.user_id === otro) || {};
          objetivo.esperadoA = mA.aporte_esperado; objetivo.esperadoB = mB.aporte_esperado;
        }
        // Dos métricas separadas, nunca sumadas: el gasto se fue, el ahorro
        // vuelve a quien lo puso al disolver (Tanda 2). El ahorro va sin liqs:
        // un pago en efectivo no mueve el bote.
        const dGasto = desequilibrioGastoHogar(txs, liqs, creadorId, otro, objetivo);
        const dAhorro = desequilibrioAhorroHogar(txs, creadorId, otro, objetivo);
        const card = $('dashDeudaCard');
        const body = $('dashDeudaBody');
        if (!card || !body) return;

        if (dGasto.brecha === 0 && dAhorro.brecha === 0) {
          body.innerHTML = '<p class="dash-neto-label">Van igual</p>';
        } else {
          const fila = (d, etiqueta, verbo) => {
            if (d.brecha === 0) {
              return '<div class="dash-neto"><div><span class="dash-neto-label">' +
                esc(etiqueta) + '</span></div><span class="dash-neto-value">Van igual</span></div>';
            }
            const yoDeboMas = d.debeAportarMas === uid;
            return '<div class="dash-neto"><div><span class="dash-neto-label">' +
              esc(etiqueta) + ': ' + (yoDeboMas ? 'deberías ' + verbo : 'tu pareja debería ' + verbo) +
              ' más</span></div>' +
              '<span class="dash-neto-value ' + netoClass(yoDeboMas ? -d.brecha : d.brecha) + '">' +
              esc(formatMonto(d.brecha)) + '</span></div>';
          };
          body.innerHTML = fila(dGasto, 'Gastos', 'aportar') + fila(dAhorro, 'Ahorro', 'ahorrar');
        }
        card.style.display = '';
```

- [ ] **Step 2: Verificar que no quedan referencias muertas**

Run: `grep -n "calcularDesequilibrioHogar" views/dashboard.html`
Expected: sin resultados (exit 1).

Run: `grep -rn "calcularDesequilibrioHogar" js/ views/ test/`
Expected: **sin resultados en todo el repo** (exit 1). El nombre viejo está totalmente
retirado.

Run: `node --test test/*.test.mjs`
Expected: `# pass 244`, `# fail 0`.
(Baseline 233 + 7 netos del Task 1 —16 menos los 9 que ya existían— + 4 del Task 2.)

- [ ] **Step 3: Commit**

```bash
git add views/dashboard.html
git commit -m "feat(dashboard): la card de desequilibrio muestra gasto y ahorro

Dos filas en vez de una, misma estructura comprimida: sin montos crudos ni
link (es un vistazo, el detalle está en #hogar). 'Van igual' una sola vez si
ambas brechas son 0.

Con esto se retira el último caller de calcularDesequilibrioHogar."
```

---

### Task 5: Verificar en el navegador y desplegar

**Files:**
- Modify: `sw.js:15`

- [ ] **Step 1: Levantar el preview y montar un hogar de prueba**

Levantar el server (`preview_start`, config `nestra`) y entrar con la cuenta de test
(`nestra.pwa.test@gmail.com` / `Test!Pwa-2026-throwaway`, ver memoria `nestra-v2-test-account`).

**Gotcha del SW:** el Service Worker sirve el `js/` cacheado, así que un cambio en
`js/hogar-*.js` NO se ve hasta desregistrarlo. Antes de creer cualquier resultado:

```javascript
for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
for (const k of await caches.keys()) await caches.delete(k);
location.reload(true);
```

y confirmar que el código nuevo está vivo:

```javascript
typeof window.desequilibrioAhorroHogar === 'function'  // debe dar true
```

La cuenta de test **no está en ningún hogar** y el único hogar real es el de los 2 usuarios
—**no tocarlo**. Crear uno de prueba: `await window.crearHogar('ZZ Hogar tanda2')`.

Con un solo miembro no hay `otro`, así que la card no muestra brechas. Para verificarlas hay
dos caminos: (a) sembrar transacciones de ambos `user_id` directamente y llamar a las
funciones puras en consola, o (b) confiar en los tests unitarios para la matemática y
verificar en el navegador solo el render y el cableado. **(b) es suficiente** — la matemática
ya está cubierta por el test de datos reales.

- [ ] **Step 2: Verificar el render**

Con el hogar de prueba creado, en `#hogar`:
- La card "Desequilibrio de aportes" muestra los dos bloques con sus títulos
  ("Gastos compartidos" y "Ahorro al hogar"), cada uno con "Tú S/… · Pareja S/…".
- La nota "No se suman: el ahorro vuelve a quien lo puso al disolver" está presente.
- El link "Registrar pago en efectivo" aparece **una sola vez**, en el bloque de gastos.
- "Aporte del mes" muestra el desglose "… en gastos · … en ahorro" bajo el total.
- En móvil (DevTools, 375px) los dos bloques entran sin romper el layout.
- Consola sin errores.

En `#dashboard`: la card de desequilibrio muestra dos filas.

- [ ] **Step 3: Limpiar el hogar de prueba**

```javascript
await window.disolverHogar();
```

`disolver_hogar` borra las membresías pero **deja la fila de `hogares`** (es por diseño: las
transacciones conservan `hogar_id` como historial). Borrarla a mano vía `execute_sql`, tras
confirmar que nada la referencia:

```sql
-- sustituir <ID> por el hogar_id que devolvió crearHogar
select (select count(*) from public.transacciones where hogar_id='<ID>') as txs,
       (select count(*) from public.metas where hogar_id='<ID>') as metas,
       (select count(*) from public.hogar_miembros where hogar_id='<ID>') as miembros;
-- si todo es 0:
delete from public.hogar_codigos where hogar_id='<ID>';
delete from public.hogares where id='<ID>';
```

Verificar que solo queda "Nuestro hogar" con 2 miembros:

```sql
select h.nombre, (select count(*) from public.hogar_miembros m where m.hogar_id=h.id) as miembros
from public.hogares h;
```

- [ ] **Step 4: Bump y suite**

En `sw.js:15`, cambiar `const SHELL_VERSION = 'v28';` por `const SHELL_VERSION = 'v29';`.

Run: `node --test test/*.test.mjs`
Expected: `# pass 244`, `# fail 0`. **Si algo falla, parar.** No se despliega en rojo.

- [ ] **Step 5: Commit y push**

```bash
git add sw.js
git commit -m "chore(tanda2): bump SHELL_VERSION a v29

Cambiaron js/hogar-desequilibrio.js, js/hogar-aporte.js, views/hogar.html y
views/dashboard.html."
git push origin v2
```

- [ ] **Step 6: Verificar el deploy live**

Esperar el build de Cloudflare Pages (~30-60s). **Usar cache-buster**: la caché de borde
sirve el archivo viejo y da falsos negativos.

Run: `curl -sL "https://nestra-8rl.pages.dev/sw.js?cb=$RANDOM" | grep SHELL_VERSION`
Expected: `const SHELL_VERSION = 'v29';`

Run: `curl -sL "https://nestra-8rl.pages.dev/js/hogar-desequilibrio.js?cb=$RANDOM" | grep -c "desequilibrioAhorroHogar"`
Expected: un número > 0.

- [ ] **Step 7: Avisar al usuario**

Decirle que recargue o cierre y reabra la PWA, y qué va a ver: en `#hogar`, dos bloques
—Darling debería aportar **S/37.77** más en gastos, y él debería ahorrar **S/197.50** más al
hogar— con los montos crudos de cada uno; en el dashboard, las mismas dos cifras
comprimidas.

---

## Self-Review

**Spec coverage:**

| Requisito del spec | Tarea |
|---|---|
| §1 — dos funciones, ahorro sin `ajustes`, helper compartido, sin alias | Task 1 |
| §1 — `pagoA`/`pagoB` se conservan, documentados en el JSDoc | Task 1 Step 3 |
| §2 — card en dos bloques, montos crudos, link solo en gastos, estados por bloque, nota final | Task 3 |
| §3 — dashboard en dos filas, sin montos ni link, "Van igual" una vez | Task 4 |
| §4 — `{ gasto, ahorro, total }` + card desglosada | Tasks 2 y 3 Step 5 |
| Decisión 7 — la disolución no cambia | Task 3 Step 4 (explícito: `previewDisolucionHtml` no se toca) |
| Decisión 8 — la base no cambia | Ninguna tarea toca SQL |
| Pruebas — 9 re-apuntados, los de ahorro, regresión con datos reales | Task 1 Step 1 |
| Pruebas — 5 migrados a `.total` + desglose | Task 2 Step 1 |
| Pruebas — manual en navegador con hogar de prueba y limpieza | Task 5 |

Sin huecos.

**Placeholder scan:** sin TBD/TODO. El único `<ID>` a sustituir es el `hogar_id` del hogar de
prueba en Task 5 Step 3, que no existe hasta ejecutarlo.

**Type consistency:**
- `desequilibrioGastoHogar(txs, ajustes, uidA, uidB, objetivo)` y
  `desequilibrioAhorroHogar(txs, uidA, uidB, objetivo)` — mismas firmas en el test (Task 1
  Step 1), la implementación (Step 3) y los dos callers (Tasks 3 y 4). El de ahorro se llama
  **sin** `ajustes` en ambos callers. Verificado.
- Las dos devuelven `{ brecha, debeAportarMas, yaAportoDeMas, pagoA, pagoB }` — `_montosHtml`
  (Task 3) lee `pagoA`/`pagoB`, que el helper compartido siempre puebla.
- `aporteRealPorMiembro` devuelve `{ gasto, ahorro, total }` — el test (Task 2 Step 1), la
  implementación (Step 3) y el caller (Task 3 Step 5) coinciden, incluido el fallback
  `{ gasto: 0, ahorro: 0, total: 0 }` cuando la función no está cargada.
- `deseqGasto`/`deseqAhorro` en `hogar.html`, `dGasto`/`dAhorro` en `dashboard.html` — cada
  uno consistente dentro de su archivo.
