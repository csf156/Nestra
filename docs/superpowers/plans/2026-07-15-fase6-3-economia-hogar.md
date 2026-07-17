# Fase 6.3 — Economía del hogar sin ingresos propios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "hogar has its own income" fiction with a model where money always lives in a member's wallet: shared expenses split across sibling rows (`grupo_id`), household savings reuse the existing `distribuir_ahorro` engine, and "who owes what" becomes a prospective, no-reset "contribution gap" instead of a debt.

**Architecture:** Pure JS modules first (TDD, zero DB dependency) → one reviewed SQL migration (schema + 5-row data fix + 2 new RPCs, applied only after explicit human sign-off) → `js/db.js`/`js/sync.js` wiring → 8 view files updated to the new shapes. Every consumer of the old `ambito='hogar' AND tipo='ingreso'` fiction is enumerated below; nothing is left silently broken.

**Tech Stack:** Vanilla JS (IIFE, `var`, no build step), Supabase Postgres (RLS, `security definer` RPCs), `node --test` for pure-function tests, synthetic-user SQL suites in `supabase/tests/` for RLS/RPC verification (no local Postgres stack exists in this repo — verification happens against the real v2 project with disposable fake-UUID users, torn down after).

**Spec:** [docs/superpowers/specs/2026-07-14-fase6-3-economia-hogar-design.md](../specs/2026-07-14-fase6-3-economia-hogar-design.md)

**Path correction from spec:** the spec says `tests/*.test.mjs`; the actual directory is `test/` (no `s`). This plan uses the real path throughout.

---

## File Structure

| File | Responsibility |
|---|---|
| `js/hogar-desequilibrio.js` (new) | Pure: prospective contribution gap from gasto-hogar rows + cash adjustments. Replaces `js/hogar-balance.js` (deleted). |
| `js/hogar-partes.js` (new) | Pure: validates a shared-expense split (parts sum to total, no dup members, positive amounts) before it's sent to the RPC. |
| `js/hogar-aporte.js` (rewritten) | Pure: `aporteRealPorMiembro` re-based on gasto-hogar + ahorro-hogar (income term removed). |
| `supabase/migrations/20260715_fase6_3_economia_hogar.sql` (new) | Schema change, 5-row data migration with backup tables, 2 new RPCs, `disolver_hogar` rework, `hogares.reparto` + `set_reparto_hogar`. **Not applied until the user reviews it (Task 7 checkpoint).** |
| `supabase/tests/hogar_gasto_split_test.sql` (new) | Synthetic 2-user RLS/RPC suite, same pattern as `hogar_rls_test.sql`. Run manually in the SQL Editor after the migration lands. |
| `js/db.js` | Balances rewritten (no more hogar "ingresos"), `insertAporteHogar` deleted, new `registrarGastoHogar` wrapper, `_serverDeleteTransaccion` routes `grupo_id` rows through the new RPC. |
| `js/sync.js` | New outbox entity `gasto_hogar` (RPC replay, mirrors the existing `delete_transaccion`/`delete_recurrente` special cases). |
| `views/transaccion.html` | Aporte checkbox removed; a "partes" editor appears for `ambito=hogar && tipo=gasto`, always visible, prefilled 100% to the registrant. |
| `views/historial.html` | `aporte_id` → `grupo_id` rename throughout badges/modal/delete-guard. |
| `views/hogar.html` | "Balance" card → desequilibrio card (prospective language). "Saldar" demoted to a small "Registrar pago en efectivo" link. Disolución preview re-based on real ahorro. |
| `views/dashboard.html` | Hogar card → "Ahorro del hogar". Deuda card → desequilibrio card. |
| `views/graficos.html` | chart1/chart6 drop hogar "ingresos". chart4 sourced from real ahorro instead of mislabeled net-balance. chart3 unaffected (already generic). |
| `views/resumen.html` | Hogar KPI section: Gastos + Ahorro aportado (Ingresos/Balance removed). |
| `views/brujula.html` | Ámbito hogar evaluates liquidity against the asker's personal wallet (one-line fix). |
| `views/configuracion.html` | Reparto toggle re-added (it was pulled pending this phase — see Task 20) with new "qué significa igualar" semantics. |
| `sw.js` | Precache list: `hogar-balance.js` → `hogar-desequilibrio.js`, add `hogar-partes.js`. `SHELL_VERSION` bump. |

---

## Task 1: `js/hogar-desequilibrio.js` — pure contribution-gap calculator

**Files:**
- Create: `js/hogar-desequilibrio.js`
- Test: `test/hogar-desequilibrio.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// test/hogar-desequilibrio.test.mjs
import assert from 'node:assert';
import { test } from 'node:test';
import { calcularDesequilibrioHogar } from '../js/hogar-desequilibrio.js';

const A = 'uidA', B = 'uidB';
function gasto(user_id, monto) { return { tipo: 'gasto', ambito: 'hogar', user_id, monto }; }
function ahorro(user_id, monto) { return { tipo: 'ahorro', ambito: 'hogar', user_id, monto }; }
function personal(user_id, monto) { return { tipo: 'gasto', ambito: 'personal', user_id, monto }; }

test('50/50, uno paga todo → brecha = mitad del total', () => {
  const r = calcularDesequilibrioHogar([gasto(A, 100)], [], A, B, { modo: '50_50' });
  assert.strictEqual(r.brecha, 50);
  assert.strictEqual(r.debeAportarMas, B);
  assert.strictEqual(r.yaAportoDeMas, A);
});

test('50/50, pagos iguales → brecha 0, sin acreedor/deudor', () => {
  const r = calcularDesequilibrioHogar([gasto(A, 60), gasto(B, 60)], [], A, B, { modo: '50_50' });
  assert.strictEqual(r.brecha, 0);
  assert.strictEqual(r.debeAportarMas, null);
  assert.strictEqual(r.yaAportoDeMas, null);
});

test('proporcional con aporte_esperado dispares', () => {
  const txs = [gasto(A, 100)];
  const objetivo = { modo: 'proporcional', esperadoA: 700, esperadoB: 300 };
  const r = calcularDesequilibrioHogar(txs, [], A, B, objetivo);
  // objetivoA = 0.7; neto = 100 - 0.7*100 = 30
  assert.strictEqual(r.brecha, 30);
  assert.strictEqual(r.debeAportarMas, B);
});

test('proporcional con ambos aporte_esperado en 0 → cae a 50/50', () => {
  const txs = [gasto(A, 100), gasto(B, 40)];
  const objetivo = { modo: 'proporcional', esperadoA: 0, esperadoB: 0 };
  const r = calcularDesequilibrioHogar(txs, [], A, B, objetivo);
  assert.strictEqual(r.brecha, 30); // (100-40)/2
  assert.strictEqual(r.debeAportarMas, B);
});

test('ajuste en efectivo reduce la brecha', () => {
  const txs = [gasto(A, 100)];
  const ajustes = [{ de_user: B, a_user: A, monto: 50 }]; // B ya compensó 50 a A
  const r = calcularDesequilibrioHogar(txs, ajustes, A, B, { modo: '50_50' });
  assert.strictEqual(r.brecha, 0);
  assert.strictEqual(r.debeAportarMas, null);
});

test('ajuste en efectivo que sobre-compensa invierte la brecha', () => {
  const txs = [gasto(A, 100)];
  const ajustes = [{ de_user: B, a_user: A, monto: 80 }]; // brecha previa era 50, B pagó 80
  const r = calcularDesequilibrioHogar(txs, ajustes, A, B, { modo: '50_50' });
  assert.strictEqual(r.brecha, 30);
  assert.strictEqual(r.debeAportarMas, A);
  assert.strictEqual(r.yaAportoDeMas, B);
});

test('sin gastos del hogar → brecha 0, sin división por cero', () => {
  const r = calcularDesequilibrioHogar([], [], A, B, { modo: '50_50' });
  assert.strictEqual(r.brecha, 0);
  const rProp = calcularDesequilibrioHogar([], [], A, B, { modo: 'proporcional', esperadoA: 0, esperadoB: 0 });
  assert.strictEqual(rProp.brecha, 0);
});

test('filas de ahorro-hogar presentes no afectan la brecha', () => {
  const conAhorro = calcularDesequilibrioHogar([gasto(A, 100), ahorro(A, 999)], [], A, B, { modo: '50_50' });
  const sinAhorro = calcularDesequilibrioHogar([gasto(A, 100)], [], A, B, { modo: '50_50' });
  assert.strictEqual(conAhorro.brecha, sinAhorro.brecha);
});

test('filas personales presentes son ignoradas', () => {
  const conPersonal = calcularDesequilibrioHogar([gasto(A, 100), personal(A, 999)], [], A, B, { modo: '50_50' });
  const sinPersonal = calcularDesequilibrioHogar([gasto(A, 100)], [], A, B, { modo: '50_50' });
  assert.strictEqual(conPersonal.brecha, sinPersonal.brecha);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/hogar-desequilibrio.test.mjs`
Expected: FAIL — `Cannot find module '../js/hogar-desequilibrio.js'`

- [ ] **Step 3: Write the implementation**

```js
// ─────────────────────────────────────────────────────────────────
// Nestra — hogar-desequilibrio.js (Fase 6.3)
// Desequilibrio de aportes: cuánto puso cada miembro en gastos COMPARTIDOS
// del hogar (histórico completo, sin reset) contra un objetivo de reparto.
// Es prospectivo ("B debería aportar más en los próximos gastos"), no una
// deuda. El ahorro al hogar NO cuenta aquí (decisión de diseño: se acredita
// aparte, en la disolución, por ahorro real aportado).
// Determinista, sin red. Dual-export como safe-to-spend.js / insights.js.
// ─────────────────────────────────────────────────────────────────
'use strict';

// calcularDesequilibrioHogar(transacciones, ajustes, uidA, uidB, objetivo)
//   transacciones: filas con { tipo, ambito, user_id, monto }. Solo cuentan
//     tipo='gasto' && ambito='hogar'.
//   ajustes: pagos en efectivo ya registrados: [{ de_user, a_user, monto }].
//   objetivo: { modo: '50_50'|'proporcional', esperadoA?, esperadoB? }.
//     'proporcional' cae a 50/50 si esperadoA+esperadoB es 0.
// Returns: { brecha, debeAportarMas, yaAportoDeMas, pagoA, pagoB }.
//   brecha=0 ⇒ debeAportarMas y yaAportoDeMas son null (van igual).
function calcularDesequilibrioHogar(transacciones, ajustes, uidA, uidB, objetivo) {
  var pagoA = 0, pagoB = 0;
  (transacciones || []).forEach(function (t) {
    if (t.ambito !== 'hogar' || t.tipo !== 'gasto') return;
    if (t.user_id === uidA) pagoA += Number(t.monto) || 0;
    else if (t.user_id === uidB) pagoB += Number(t.monto) || 0;
  });

  var objetivoA = 0.5;
  if (objetivo && objetivo.modo === 'proporcional') {
    var eA = Number(objetivo.esperadoA) || 0, eB = Number(objetivo.esperadoB) || 0;
    if (eA + eB > 0) objetivoA = eA / (eA + eB);
  }

  // >0 ⇒ A puso de más ⇒ B debería aportar más en los próximos gastos.
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

if (typeof window !== 'undefined') {
  window.calcularDesequilibrioHogar = calcularDesequilibrioHogar;
}

export { calcularDesequilibrioHogar };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/hogar-desequilibrio.test.mjs`
Expected: PASS — 9 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
git add js/hogar-desequilibrio.js test/hogar-desequilibrio.test.mjs
git commit -m "$(cat <<'EOF'
feat(fase6.3): calcularDesequilibrioHogar — brecha de aportes prospectiva

Reemplaza el balance "quien debe que" (50/50 de gastos hogar, deuda a pagar)
por un objetivo prospectivo: cuanto deberia aportar cada uno en los proximos
gastos compartidos para igualar el objetivo de reparto. Solo cuenta gasto
ambito=hogar; el ahorro al hogar queda fuera (se acredita en la disolucion).
EOF
)"
```

---

## Task 2: `js/hogar-partes.js` — pure split validator

**Files:**
- Create: `js/hogar-partes.js`
- Test: `test/hogar-partes.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// test/hogar-partes.test.mjs
import assert from 'node:assert';
import { test } from 'node:test';
import { validarPartesGastoHogar } from '../js/hogar-partes.js';

test('suma exacta de partes = total → válido', () => {
  const r = validarPartesGastoHogar(100, [{ user_id: 'A', monto: 60 }, { user_id: 'B', monto: 40 }]);
  assert.strictEqual(r.ok, true);
});

test('un solo pagador al 100% → válido', () => {
  const r = validarPartesGastoHogar(100, [{ user_id: 'A', monto: 100 }]);
  assert.strictEqual(r.ok, true);
});

test('suma distinta del total → inválido', () => {
  const r = validarPartesGastoHogar(100, [{ user_id: 'A', monto: 60 }, { user_id: 'B', monto: 30 }]);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /no coincide/);
});

test('un monto en 0 o negativo → inválido', () => {
  const r = validarPartesGastoHogar(100, [{ user_id: 'A', monto: 100 }, { user_id: 'B', monto: 0 }]);
  assert.strictEqual(r.ok, false);
});

test('user_id repetido → inválido', () => {
  const r = validarPartesGastoHogar(100, [{ user_id: 'A', monto: 50 }, { user_id: 'A', monto: 50 }]);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /dos partes/);
});

test('total en 0 o negativo → inválido', () => {
  const r = validarPartesGastoHogar(0, [{ user_id: 'A', monto: 0 }]);
  assert.strictEqual(r.ok, false);
});

test('sin partes → inválido', () => {
  const r = validarPartesGastoHogar(100, []);
  assert.strictEqual(r.ok, false);
});

test('tolerancia de redondeo de hasta 1 centavo → válido', () => {
  const r = validarPartesGastoHogar(100, [{ user_id: 'A', monto: 33.34 }, { user_id: 'B', monto: 66.67 }]);
  assert.strictEqual(r.ok, true); // suma 100.01, dentro de tolerancia
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/hogar-partes.test.mjs`
Expected: FAIL — `Cannot find module '../js/hogar-partes.js'`

- [ ] **Step 3: Write the implementation**

```js
// ─────────────────────────────────────────────────────────────────
// Nestra — hogar-partes.js (Fase 6.3)
// Validador puro de un split de gasto compartido antes de enviarlo al RPC
// registrar_gasto_hogar. El servidor re-valida (fuente de verdad); esto es
// solo feedback inmediato en el formulario.
// ─────────────────────────────────────────────────────────────────
'use strict';

// validarPartesGastoHogar(total, partes) — partes: [{ user_id, monto }].
// Returns: { ok: true } | { ok: false, error: string }.
function validarPartesGastoHogar(total, partes) {
  var t = Math.round((Number(total) || 0) * 100) / 100;
  if (!(t > 0)) return { ok: false, error: 'El total debe ser mayor que 0.' };
  if (!Array.isArray(partes) || !partes.length) {
    return { ok: false, error: 'Debe haber al menos una parte.' };
  }

  var vistos = {};
  var suma = 0;
  for (var i = 0; i < partes.length; i++) {
    var p = partes[i];
    if (!p || !p.user_id) return { ok: false, error: 'Falta el usuario de una parte.' };
    if (vistos[p.user_id]) return { ok: false, error: 'Un miembro no puede tener dos partes.' };
    vistos[p.user_id] = true;
    var m = Number(p.monto);
    if (!(m > 0)) return { ok: false, error: 'Cada parte debe ser mayor que 0.' };
    suma += m;
  }
  suma = Math.round(suma * 100) / 100;
  if (Math.abs(suma - t) > 0.01) {
    return { ok: false, error: 'La suma de las partes (' + suma + ') no coincide con el total (' + t + ').' };
  }
  return { ok: true };
}

if (typeof window !== 'undefined') {
  window.validarPartesGastoHogar = validarPartesGastoHogar;
}

export { validarPartesGastoHogar };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/hogar-partes.test.mjs`
Expected: PASS — 8 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
git add js/hogar-partes.js test/hogar-partes.test.mjs
git commit -m "feat(fase6.3): validarPartesGastoHogar — validador puro del split antes del RPC"
```

---

## Task 3: `js/hogar-aporte.js` — re-base `aporteRealPorMiembro`

**Files:**
- Modify: `js/hogar-aporte.js`
- Test: `test/hogar-aporte.test.mjs` (rewritten)

- [ ] **Step 1: Overwrite the test file (old assertions relied on the income fiction)**

```js
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
  assert.strictEqual(aporteRealPorMiembro(txs, 'A', RANGO), 300);
});

test('ignora filas de otro miembro', () => {
  const txs = [tx('A', 'gasto', 'hogar', 100), tx('B', 'gasto', 'hogar', 999)];
  assert.strictEqual(aporteRealPorMiembro(txs, 'A', RANGO), 100);
});

test('ignora filas personales', () => {
  const txs = [tx('A', 'gasto', 'personal', 999), tx('A', 'gasto', 'hogar', 50)];
  assert.strictEqual(aporteRealPorMiembro(txs, 'A', RANGO), 50);
});

test('ignora tipo=ingreso (ya no cuenta) y fechas fuera de rango', () => {
  const txs = [
    tx('A', 'ingreso', 'hogar', 999),           // estado ilegal en el modelo nuevo; igual se ignora si aparece
    tx('A', 'gasto', 'hogar', 70, '2026-05-30'), // fuera de rango
    tx('A', 'gasto', 'hogar', 20, '2026-06-15'),
  ];
  assert.strictEqual(aporteRealPorMiembro(txs, 'A', RANGO), 20);
});

test('sin filas → 0', () => {
  assert.strictEqual(aporteRealPorMiembro([], 'A', RANGO), 0);
});
```

- [ ] **Step 2: Run tests to verify they fail against the current implementation**

Run: `node --test test/hogar-aporte.test.mjs`
Expected: FAIL — first test expects 300, current implementation (sums ingreso+gasto) returns something else / undefined shape mismatch

- [ ] **Step 3: Rewrite the implementation**

```js
// ─────────────────────────────────────────────────────────────────
// Nestra — hogar-aporte.js (Fase 6.3, re-basado)
// Aporte real de un miembro al hogar en un rango: gasto hogar (su parte de
// gastos compartidos) + ahorro hogar (lo que apartó para metas/fondo).
// Deliberadamente incluye AMBOS flujos, a diferencia del desequilibrio
// (hogar-desequilibrio.js), que es solo-gastos: "aporte esperado" significa
// "cuánto acordamos poner al hogar al mes", cualquiera sea la vía.
// Puro y determinista. Dual-export como safe-to-spend.js.
// ─────────────────────────────────────────────────────────────────
'use strict';

function aporteRealPorMiembro(transacciones, userId, rango) {
  var desde = rango && rango.desde, hasta = rango && rango.hasta;
  return (transacciones || []).reduce(function (sum, t) {
    if (t.user_id !== userId) return sum;
    if (t.ambito !== 'hogar') return sum;
    if (t.tipo !== 'gasto' && t.tipo !== 'ahorro') return sum;
    if (desde && t.fecha < desde) return sum;
    if (hasta && t.fecha > hasta) return sum;
    return sum + (Number(t.monto) || 0);
  }, 0);
}

if (typeof window !== 'undefined') {
  window.aporteRealPorMiembro = aporteRealPorMiembro;
}

export { aporteRealPorMiembro };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/hogar-aporte.test.mjs`
Expected: PASS — 5 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
git add js/hogar-aporte.js test/hogar-aporte.test.mjs
git commit -m "$(cat <<'EOF'
fix(fase6.3): aporteRealPorMiembro re-basado en gasto+ahorro hogar

Antes sumaba ingreso-hogar (la ficcion) + gasto-hogar. Ahora suma
gasto-hogar + ahorro-hogar, consistente con que el hogar ya no tiene
ingresos propios. Deliberadamente incluye ahorro (a diferencia del
desequilibrio, que es solo-gastos): "aporte esperado" cubre cualquier via.
EOF
)"
```

---

## Task 4: Delete `js/hogar-balance.js`

**Files:**
- Delete: `js/hogar-balance.js`
- Delete: `test/hogar-balance.test.mjs`

- [ ] **Step 1: Delete both files**

```bash
git rm js/hogar-balance.js test/hogar-balance.test.mjs
```

- [ ] **Step 2: Verify nothing else in the repo still references the deleted symbols**

Run: `grep -rn "hogar-balance\|calcularBalanceHogar\|repartoDisolucion" --include=*.js --include=*.html .`
Expected: matches ONLY in files this plan will edit later (`views/dashboard.html`, `views/hogar.html`, `sw.js`) — not in any file already committed as final. If this is run before Task 15/16/22, those matches are expected and will be cleared by those tasks.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(fase6.3): borra hogar-balance.js — modelo viejo (deuda 50/50 de gastos,
reparto de disolucion por % de ingresos). Reemplazado por
hogar-desequilibrio.js. Los consumidores (dashboard.html, hogar.html, sw.js)
se actualizan en tareas siguientes de este plan.
EOF
)"
```

---

## Task 5: SQL migration — schema, data fix, new RPCs (write only, not applied)

**Files:**
- Create: `supabase/migrations/20260715_fase6_3_economia_hogar.sql`

This task only **writes** the file. It is applied to production in Task 7, after explicit user review — do not call `apply_migration` in this task.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260715_fase6_3_economia_hogar.sql
-- Fase 6.3 (correctiva) — el hogar deja de tener ingresos propios.
-- SOLO v2. Afecta 5 filas de producción (verificadas 2026-07-14). Reversible
-- vía las tablas _backup_fase63_*. NO aplicar sin revisión manual del SQL.

begin;

-- ── 0. Respaldo para rollback ─────────────────────────────────────────
create table if not exists public._backup_fase63_transacciones as
  select * from public.transacciones where ambito = 'hogar' or aporte_id is not null;
create table if not exists public._backup_fase63_aportes_meta as
  select * from public.aportes_meta
  where transaccion_id in (select id from public._backup_fase63_transacciones);

commit;

-- ── 1. Colapsar los pares aporte_id en una sola fila de ahorro ────────
-- Conserva el id de la pata-ingreso ⇒ aportes_meta.transaccion_id sigue
-- válido, el reparto a metas ya hecho no se toca.
begin;

update public.transacciones
   set tipo = 'ahorro', categoria_id = null, aporte_id = null
 where aporte_id is not null and ambito = 'hogar' and tipo = 'ingreso';

delete from public.transacciones
 where aporte_id is not null and ambito = 'personal' and tipo = 'gasto';

commit;

-- ── 2. Fila huérfana (S/200, 22-jun-2026): aporte real → ahorro + reparto ──
begin;

update public.transacciones
   set tipo = 'ahorro', categoria_id = null
 where id = 'a6fe851a-ac7e-4d2f-bd02-8e6ad0ee046d';

commit;

-- distribuir_ahorro hace sus propios inserts; fuera de la transacción anterior
-- por si la RPC abre su propio manejo de errores (idéntico a como se invoca
-- desde db.js: best-effort, no debe abortar la migración si falla).
do $$
begin
  perform public.distribuir_ahorro('a6fe851a-ac7e-4d2f-bd02-8e6ad0ee046d'::uuid);
exception when others then
  raise notice 'distribuir_ahorro sobre la fila huérfana falló: %', sqlerrm;
end $$;

-- ── 3. aporte_id → grupo_id (0 filas lo usan tras el paso 1) ──────────
begin;

alter table public.transacciones rename column aporte_id to grupo_id;
alter index if exists idx_transacciones_aporte_id rename to idx_transacciones_grupo_id;

commit;

-- ── 4. Blindar la ficción: ambito=hogar + tipo=ingreso es ilegal ──────
begin;

alter table public.transacciones
  add constraint tx_hogar_sin_ingreso
  check (not (ambito = 'hogar' and tipo = 'ingreso'));

commit;

-- ── 5. hogares.reparto (nunca existió en prod — Fase 6.2 no se aplicó) ──
-- Idempotente frente a la tarea paralela que también puede crear esta
-- columna: add column if not exists + constraint guardada por nombre.
begin;

alter table public.hogares
  add column if not exists reparto text not null default '50_50';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'hogares_reparto_check' and conrelid = 'public.hogares'::regclass
  ) then
    alter table public.hogares
      add constraint hogares_reparto_check check (reparto in ('50_50','proporcional'));
  end if;
end $$;

create or replace function public.set_reparto_hogar(p_modo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_hogar uuid := public.auth_hogar_id();
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  if p_modo not in ('50_50','proporcional') then raise exception 'Modo inválido'; end if;
  update public.hogares set reparto = p_modo where id = v_hogar;
end; $$;

grant execute on function public.set_reparto_hogar(text) to authenticated;

commit;

-- ── 6. registrar_gasto_hogar — inserta N filas hermanas (el split) ────
begin;

create or replace function public.registrar_gasto_hogar(
  p_grupo_id     uuid,
  p_fecha        date,
  p_categoria_id uuid,
  p_nota         text,
  p_partes       jsonb   -- [{"user_id": "...", "monto": 123.45}, ...]
)
returns setof public.transacciones
language plpgsql security definer set search_path = public as $$
declare
  v_hogar    uuid := public.auth_hogar_id();
  v_count    int;
  v_distinct int;
  v_miembros int;
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;

  -- Idempotencia: si el grupo ya existe (replay de la outbox), devolverlo
  -- sin re-insertar.
  if exists (select 1 from public.transacciones where grupo_id = p_grupo_id) then
    return query select * from public.transacciones where grupo_id = p_grupo_id;
    return;
  end if;

  if p_partes is null or jsonb_typeof(p_partes) <> 'array' or jsonb_array_length(p_partes) = 0 then
    raise exception 'Debe haber al menos una parte';
  end if;

  select count(*), count(distinct (elem->>'user_id')::uuid)
    into v_count, v_distinct
    from jsonb_array_elements(p_partes) elem;
  if v_count <> v_distinct then
    raise exception 'Un miembro no puede tener dos partes';
  end if;

  select count(*) into v_miembros
    from jsonb_array_elements(p_partes) elem
    join public.hogar_miembros hm
      on hm.user_id = (elem->>'user_id')::uuid and hm.hogar_id = v_hogar;
  if v_miembros <> v_count then
    raise exception 'Todas las partes deben ser miembros de tu hogar';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_partes) elem
    where not ((elem->>'monto')::numeric > 0)
  ) then
    raise exception 'Cada parte debe ser mayor que 0';
  end if;

  insert into public.transacciones (id, fecha, tipo, ambito, user_id, categoria_id, monto, nota, grupo_id)
  select gen_random_uuid(), coalesce(p_fecha, current_date), 'gasto', 'hogar',
         (elem->>'user_id')::uuid, p_categoria_id, (elem->>'monto')::numeric, p_nota, p_grupo_id
  from jsonb_array_elements(p_partes) elem;

  return query select * from public.transacciones where grupo_id = p_grupo_id;
end;
$$;

grant  execute on function public.registrar_gasto_hogar(uuid, date, uuid, text, jsonb) to authenticated;
revoke execute on function public.registrar_gasto_hogar(uuid, date, uuid, text, jsonb) from anon, public;

commit;

-- ── 7. borrar_gasto_hogar — borra todas las filas hermanas del grupo ──
-- Necesario porque transacciones_delete exige auth.uid()=user_id: A no
-- puede borrar la fila de B directamente.
begin;

create or replace function public.borrar_gasto_hogar(p_grupo_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_hogar uuid := public.auth_hogar_id();
  v_n     int;
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  select count(*) into v_n from public.transacciones where grupo_id = p_grupo_id and hogar_id = v_hogar;
  if v_n = 0 then raise exception 'El grupo % no existe en tu hogar', p_grupo_id; end if;
  delete from public.transacciones where grupo_id = p_grupo_id and hogar_id = v_hogar;
end;
$$;

grant  execute on function public.borrar_gasto_hogar(uuid) to authenticated;
revoke execute on function public.borrar_gasto_hogar(uuid) from anon, public;

commit;

-- ── 8. distribuir_aporte_hogar sobra — el ahorro hogar ya usa distribuir_ahorro ──
begin;

drop function if exists public.distribuir_aporte_hogar(uuid);

commit;

-- ── 9. disolver_hogar — reparte por ahorro real, informa el desequilibrio aparte ──
-- Antes: repartía por % de ingresos-hogar (ya no existen) y guardaba una
-- liquidación final en hogar_liquidaciones que nadie podía leer jamás
-- (tras disolver, auth_hogar_id() da null para ambos y la fila cae fuera
-- de RLS). Ahora: el ahorro se reparte por identidad (cada quien recupera
-- lo que puso) y el desequilibrio de gastos se informa en el jsonb de
-- retorno para que la UI lo muestre — no se cobra ni se inserta liquidación.
begin;

create or replace function public.disolver_hogar()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_hogar   uuid := public.auth_hogar_id();
  v_creador uuid;
  v_otro    uuid;
  v_ahorro_creador numeric := 0;
  v_ahorro_otro    numeric := 0;
  v_pago_creador   numeric := 0;
  v_pago_otro      numeric := 0;
  v_liq_otro_a_creador   numeric := 0;
  v_liq_creador_a_otro   numeric := 0;
  v_neto    numeric;
  v_brecha  numeric := 0;
  v_debe_mas uuid;
  v_ya_mas   uuid;
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  select creado_por into v_creador from public.hogares where id = v_hogar;
  select user_id into v_otro from public.hogar_miembros where hogar_id = v_hogar and user_id <> v_creador limit 1;

  select coalesce(sum(monto),0) into v_ahorro_creador from public.transacciones
    where hogar_id = v_hogar and ambito='hogar' and tipo='ahorro' and user_id = v_creador;
  select coalesce(sum(monto),0) into v_pago_creador from public.transacciones
    where hogar_id = v_hogar and ambito='hogar' and tipo='gasto' and user_id = v_creador;

  if v_otro is not null then
    select coalesce(sum(monto),0) into v_ahorro_otro from public.transacciones
      where hogar_id = v_hogar and ambito='hogar' and tipo='ahorro' and user_id = v_otro;
    select coalesce(sum(monto),0) into v_pago_otro from public.transacciones
      where hogar_id = v_hogar and ambito='hogar' and tipo='gasto' and user_id = v_otro;

    -- Desequilibrio 50/50 (mismo cálculo que calcularDesequilibrioHogar,
    -- objetivo 50/50), neteado contra pagos en efectivo ya registrados.
    v_neto := v_pago_creador - (v_pago_creador + v_pago_otro) / 2;
    select coalesce(sum(monto),0) into v_liq_otro_a_creador from public.hogar_liquidaciones
      where hogar_id = v_hogar and de_user = v_otro and a_user = v_creador;
    select coalesce(sum(monto),0) into v_liq_creador_a_otro from public.hogar_liquidaciones
      where hogar_id = v_hogar and de_user = v_creador and a_user = v_otro;
    v_neto := v_neto - v_liq_otro_a_creador + v_liq_creador_a_otro;
    v_neto := round(v_neto, 2);
    v_brecha := abs(v_neto);
    if v_neto > 0 then v_debe_mas := v_otro; v_ya_mas := v_creador;
    elsif v_neto < 0 then v_debe_mas := v_creador; v_ya_mas := v_otro;
    end if;
  end if;

  -- reasignar aportes de esas metas al creador (antes de soltar el hogar_id)
  update public.aportes_meta set user_id = v_creador
   where meta_id in (select id from public.metas where hogar_id = v_hogar and ambito = 'hogar');

  -- reasignar metas/fondo de hogar al creador como personales
  update public.metas set ambito='personal', hogar_id=null, user_id=v_creador
    where hogar_id = v_hogar and ambito='hogar';

  -- borrar membresías (las transacciones conservan hogar_id como historial)
  delete from public.hogar_miembros where hogar_id = v_hogar;

  return jsonb_build_object(
    'ahorro_creador', v_ahorro_creador,
    'ahorro_otro', v_ahorro_otro,
    'desequilibrio_brecha', v_brecha,
    'desequilibrio_debe_aportar_mas', v_debe_mas,
    'desequilibrio_ya_aporto_de_mas', v_ya_mas
  );
end;
$$;

commit;
```

- [ ] **Step 2: Sanity-check the file parses as valid SQL syntax (no DB call)**

Read the file back and confirm: every `begin;`/`commit;` pair balances, every `create or replace function` has a matching `$$;` close, no stray characters. This is a manual read, not a tool call — the migration is not executed in this task.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260715_fase6_3_economia_hogar.sql
git commit -m "$(cat <<'EOF'
feat(fase6.3): migracion SQL — hogar sin ingresos propios (NO aplicada)

Backup + colapsa 2 pares aporte_id en ahorro, corrige la fila huerfana
(S/200, 22-jun) a aporte real repartido a metas, renombra aporte_id a
grupo_id, blinda ambito=hogar+tipo=ingreso con un CHECK, agrega
hogares.reparto (nunca existio en prod), registrar_gasto_hogar y
borrar_gasto_hogar (RPCs security definer para el split), retira
distribuir_aporte_hogar, y rehace disolver_hogar (reparte ahorro real,
informa el desequilibrio aparte en vez de insertar una liquidacion
write-only). Pendiente de revision manual antes de aplicar (Task 7).
EOF
)"
```

---

## Task 6: Synthetic-user SQL verification suite (write only)

**Files:**
- Create: `supabase/tests/hogar_gasto_split_test.sql`

Follows the exact pattern of `supabase/tests/hogar_rls_test.sql`: 2 synthetic users (fake UUIDs), acts as each via `set_config('request.jwt.claims', ...)`, asserts, tears down. Run manually in the SQL Editor **after** Task 7 applies the migration — this task only writes the file.

- [ ] **Step 1: Write the test suite**

```sql
-- supabase/tests/hogar_gasto_split_test.sql
-- Suite del split de gastos compartidos (Fase 6.3) — 2 usuarios.
-- Correr en el SQL Editor de v2 DESPUÉS de aplicar
-- 20260715_fase6_3_economia_hogar.sql. Imprime ALL TESTS PASSED si pasa.
-- Idempotente / re-ejecutable: el teardown borra las filas de ambos usuarios.
-- D = 44444444-...; E = 55555555-... (distintos de los de hogar_rls_test.sql
-- para poder correr ambas suites sin colisión).

-- ── Teardown previo ──────────────────────────────────────────────────
delete from public.transacciones where user_id in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');
delete from public.hogar_liquidaciones where de_user in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555')
  or a_user in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');
delete from public.hogar_codigos where hogar_id in (
  select id from public.hogares where creado_por in (
    '44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555'));
delete from public.hogar_miembros where user_id in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');
delete from public.hogares where creado_por in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');
delete from auth.users where id in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');

-- ── Setup usuarios ───────────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000','44444444-4444-4444-4444-444444444444','authenticated','authenticated','d@test.local',crypt('pw',gen_salt('bf')),now(),now(),now(),'{}','{"nombre":"D"}'),
  ('00000000-0000-0000-0000-000000000000','55555555-5555-5555-5555-555555555555','authenticated','authenticated','e@test.local',crypt('pw',gen_salt('bf')),now(),now(),now(),'{}','{"nombre":"E"}');

create temporary table if not exists _split_test_grupo (grupo_id uuid, cat_id uuid);
delete from _split_test_grupo;

-- ── D crea hogar, E se une ────────────────────────────────────────────
do $$
declare v_cod char(6); v_res jsonb; v_cat uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','44444444-4444-4444-4444-444444444444','role','authenticated')::text, true);
  set local role authenticated;
  v_res := public.crear_hogar('Casa DE');
  v_cod := v_res->>'codigo';
  select id into v_cat from public.categorias where user_id is null and tipo='gasto' limit 1;
  insert into _split_test_grupo (cat_id) values (v_cat);

  perform set_config('request.jwt.claims', json_build_object('sub','55555555-5555-5555-5555-555555555555','role','authenticated')::text, true);
  set local role authenticated;
  perform public.unirse_hogar(v_cod);

  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- ── ASSERT 1: D registra un gasto compartido 60/40 → 2 filas hermanas,
--    misma grupo_id, cada una con user_id correcto ────────────────────
do $$
declare v_cat uuid; v_grupo uuid := gen_random_uuid(); v_n int; v_suma numeric;
begin
  select cat_id into v_cat from _split_test_grupo limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','44444444-4444-4444-4444-444444444444','role','authenticated')::text, true);
  set local role authenticated;
  perform public.registrar_gasto_hogar(
    v_grupo, current_date, v_cat, 'cena test',
    jsonb_build_array(
      jsonb_build_object('user_id','44444444-4444-4444-4444-444444444444','monto',60),
      jsonb_build_object('user_id','55555555-5555-5555-5555-555555555555','monto',40)
    )
  );
  reset role;
  perform set_config('request.jwt.claims', '{}', true);

  update _split_test_grupo set grupo_id = v_grupo;

  select count(*), coalesce(sum(monto),0) into v_n, v_suma
    from public.transacciones where grupo_id = v_grupo;
  if v_n <> 2 then raise exception 'FALLO: esperaba 2 filas hermanas, hubo %', v_n; end if;
  if v_suma <> 100 then raise exception 'FALLO: suma de partes % <> 100', v_suma; end if;
end $$;

-- ── ASSERT 2: E ve las 2 filas del grupo (comparte hogar) ─────────────
do $$
declare v_grupo uuid; v_n int;
begin
  select grupo_id into v_grupo from _split_test_grupo limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','55555555-5555-5555-5555-555555555555','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.transacciones where grupo_id = v_grupo;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  if v_n <> 2 then raise exception 'FALLO: E no ve las 2 filas del grupo (vio %)', v_n; end if;
end $$;

-- ── ASSERT 3: registrar_gasto_hogar rechaza partes que no suman positivo ──
do $$
declare v_cat uuid; v_ok boolean := false;
begin
  select cat_id into v_cat from _split_test_grupo limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','44444444-4444-4444-4444-444444444444','role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.registrar_gasto_hogar(
      gen_random_uuid(), current_date, v_cat, null,
      jsonb_build_array(jsonb_build_object('user_id','44444444-4444-4444-4444-444444444444','monto',0))
    );
  exception when others then v_ok := true; end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  if not v_ok then raise exception 'FALLO: aceptó una parte con monto 0'; end if;
end $$;

-- ── ASSERT 4: registrar_gasto_hogar rechaza a un no-miembro en las partes ──
do $$
declare v_cat uuid; v_ok boolean := false;
begin
  select cat_id into v_cat from _split_test_grupo limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','44444444-4444-4444-4444-444444444444','role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.registrar_gasto_hogar(
      gen_random_uuid(), current_date, v_cat, null,
      jsonb_build_array(
        jsonb_build_object('user_id','44444444-4444-4444-4444-444444444444','monto',50),
        jsonb_build_object('user_id','99999999-9999-9999-9999-999999999999','monto',50)
      )
    );
  exception when others then v_ok := true; end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  if not v_ok then raise exception 'FALLO: aceptó una parte de un user_id fuera del hogar'; end if;
end $$;

-- ── ASSERT 5: E (no registrante) NO puede borrar el grupo directamente
--    (DELETE en transacciones es owner-scoped) pero SÍ vía borrar_gasto_hogar ──
do $$
declare v_grupo uuid; v_n int;
begin
  select grupo_id into v_grupo from _split_test_grupo limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','55555555-5555-5555-5555-555555555555','role','authenticated')::text, true);
  set local role authenticated;
  perform public.borrar_gasto_hogar(v_grupo);
  reset role;
  perform set_config('request.jwt.claims', '{}', true);

  select count(*) into v_n from public.transacciones where grupo_id = v_grupo;
  if v_n <> 0 then raise exception 'FALLO: borrar_gasto_hogar no borró ambas filas (quedaron %)', v_n; end if;
end $$;

-- ── ASSERT 6: registrar_gasto_hogar es idempotente por grupo_id ───────
do $$
declare v_cat uuid; v_grupo uuid := gen_random_uuid(); v_n int;
begin
  select cat_id into v_cat from _split_test_grupo limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','44444444-4444-4444-4444-444444444444','role','authenticated')::text, true);
  set local role authenticated;
  perform public.registrar_gasto_hogar(v_grupo, current_date, v_cat, null,
    jsonb_build_array(jsonb_build_object('user_id','44444444-4444-4444-4444-444444444444','monto',100)));
  -- replay (mismo grupo_id) — no debe crear una segunda fila
  perform public.registrar_gasto_hogar(v_grupo, current_date, v_cat, null,
    jsonb_build_array(jsonb_build_object('user_id','44444444-4444-4444-4444-444444444444','monto',100)));
  reset role;
  perform set_config('request.jwt.claims', '{}', true);

  select count(*) into v_n from public.transacciones where grupo_id = v_grupo;
  if v_n <> 1 then raise exception 'FALLO: el replay duplicó filas (hay %)', v_n; end if;
end $$;

-- ── ASSERT 7: CHECK bloquea ambito=hogar + tipo=ingreso ───────────────
do $$
declare v_cat uuid; v_ok boolean := false;
begin
  select id into v_cat from public.categorias where user_id is null and tipo='ingreso' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','44444444-4444-4444-4444-444444444444','role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.transacciones (tipo, ambito, user_id, categoria_id, monto)
    values ('ingreso', 'hogar', '44444444-4444-4444-4444-444444444444', v_cat, 10);
  exception when others then v_ok := true; end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  if not v_ok then raise exception 'FALLO: insertó ambito=hogar + tipo=ingreso (debía bloquearlo el CHECK)'; end if;
end $$;

-- ── Teardown final ───────────────────────────────────────────────────
drop table if exists _split_test_grupo;
delete from public.transacciones where user_id in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');
delete from public.hogar_liquidaciones where de_user in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555')
  or a_user in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');
delete from public.hogar_codigos where hogar_id in (
  select id from public.hogares where creado_por in (
    '44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555'));
delete from public.hogar_miembros where user_id in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');
delete from public.hogares where creado_por in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');
delete from auth.users where id in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');

select 'ALL TESTS PASSED' as resultado;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/tests/hogar_gasto_split_test.sql
git commit -m "test(fase6.3): suite sintetica del split de gastos compartidos (correr tras aplicar la migracion)"
```

---

## Task 7: CHECKPOINT — apply the migration to production

**This task is a manual gate, not an autonomous step.** If executing this plan via subagent-driven-development or executing-plans, stop here and hand control back for explicit human approval before proceeding — do not call `apply_migration` without it, per the project's guardrails (real data, 2 users).

- [ ] **Step 1: Present the migration SQL to the user for review**

Show the full contents of `supabase/migrations/20260715_fase6_3_economia_hogar.sql` and summarize the visible effect (from the spec): household savings 300 → 500 (the orphan row joins), personal balance of the user with id `d83a9b58-f740-4c77-af01-d3ebf2669938` drops by 200 (correcting money counted as available since June that wasn't). Wait for explicit go-ahead.

- [ ] **Step 2: Apply the migration**

Use `mcp__supabase__apply_migration` with the file contents, name `fase6_3_economia_hogar`. This targets the real v2 project (`ombnhxueclqfeyjzhroz`) — there is no staging environment.

- [ ] **Step 3: Verify the data migration landed correctly**

```sql
select
  (select count(*) from public.transacciones where grupo_id is not null) as filas_grupo,       -- expect 0 (no splits created yet)
  (select count(*) from public.transacciones where ambito='hogar' and tipo='ingreso') as ing_hogar, -- expect 0
  (select coalesce(sum(monto),0) from public.transacciones where ambito='hogar' and tipo='ahorro') as ahorro_hogar, -- expect 500
  (select coalesce(sum(a.monto),0) from public.aportes_meta a
     join public.transacciones t on t.id=a.transaccion_id
     where t.id='a6fe851a-ac7e-4d2f-bd02-8e6ad0ee046d') as aportes_de_la_huerfana; -- expect 200
```

- [ ] **Step 4: Run the synthetic-user verification suite**

Paste the full contents of `supabase/tests/hogar_gasto_split_test.sql` into the Supabase SQL Editor and run it. Expected final row: `ALL TESTS PASSED`. If any `ASSERT` raises, stop — do not proceed to Task 8 until the migration is fixed and re-verified.

- [ ] **Step 5: Confirm rollback path is intact**

```sql
select count(*) from public._backup_fase63_transacciones; -- expect 5
select count(*) from public._backup_fase63_aportes_meta;
```

No commit in this task (no code changed) — note in the conversation that the migration is live before starting Task 8.

---

## Task 8: `js/db.js` — hogar balances without income

**Files:**
- Modify: `js/db.js:342-457` (replaces `getBalanceHogar`, `getSaldoAcumuladoHogar`; keeps `getBalancePersonal`/`getSaldoAcumuladoPersonal` names but rewrites bodies)
- Modify: `js/db.js:274-335` (delete `insertAporteHogar`)

Requires Task 7 (migration live) since `getGastosHogar`/`getAhorroHogarAcumulado` query the post-migration shape (no `ambito='hogar' AND tipo='ingreso'` rows expected).

- [ ] **Step 1: Delete `insertAporteHogar` (`js/db.js:274-335`)**

Remove the entire function, including its header comment, from:
```js
// insertAporteHogar(monto, categoria_id, nota, fecha) — aporte al hogar.
```
through the closing brace before `// ═══... BALANCES`.

- [ ] **Step 2: Replace `getBalanceHogar` and `getSaldoAcumuladoHogar` (`js/db.js:342-426`)**

Replace both functions with:

```js
// getGastosHogar(mes, anio) — total de GASTOS compartidos del hogar en el mes
// (todas las filas ambito='hogar' tipo='gasto', de cualquier miembro).
// Returns: número (0 en error).
async function getGastosHogar(mes, anio) {
  try {
    const { desde, hasta } = _rangoMes(mes, anio);
    const { data, error } = await supabase
      .from('transacciones')
      .select('monto')
      .not('hogar_id', 'is', null)
      .eq('ambito', 'hogar')
      .eq('tipo', 'gasto')
      .gte('fecha', desde)
      .lte('fecha', hasta);
    if (error) throw error;
    return (data || []).reduce((sum, t) => sum + Number(t.monto), 0);
  } catch (err) {
    console.error('Error en getGastosHogar():', err.message || err);
    return 0;
  }
}

// getAhorroHogarAcumulado() — ahorro total aportado al hogar, todos los
// tiempos, de cualquier miembro. Es el número de cabecera: "Ahorro del
// hogar". Reemplaza el viejo "Balance del hogar" (ingresos-gastos), que
// dependía de la ficción de ingresos-hogar.
// Returns: número (0 en error).
async function getAhorroHogarAcumulado() {
  try {
    const { data, error } = await supabase
      .from('transacciones')
      .select('monto')
      .not('hogar_id', 'is', null)
      .eq('ambito', 'hogar')
      .eq('tipo', 'ahorro');
    if (error) throw error;
    return (data || []).reduce((sum, t) => sum + Number(t.monto), 0);
  } catch (err) {
    console.error('Error en getAhorroHogarAcumulado():', err.message || err);
    return 0;
  }
}
```

- [ ] **Step 3: Rewrite `getBalancePersonal` — drop the `hogar_id` filter (`js/db.js:368-402` post-deletion)**

```js
// getBalancePersonal(mes, anio) — totales personales del usuario activo.
// SIN filtro de hogar_id: el dinero vive en el miembro sea cual sea el
// ámbito de la fila (Fase 6.3 — invariante central). `aporte_realizado`
// reporta, como subconjunto informativo, cuánto de `gastos` fue hacia el
// hogar (no se resta dos veces).
// Returns: { ingresos, gastos, aporte_realizado, balance }. Ceros en error.
async function getBalancePersonal(mes, anio) {
  try {
    const userId = _requireUserId();
    const { desde, hasta } = _rangoMes(mes, anio);
    const { data, error } = await supabase
      .from('transacciones')
      .select('tipo, monto, ambito')
      .eq('user_id', userId)
      .neq('tipo', 'ahorro')
      .gte('fecha', desde)
      .lte('fecha', hasta);
    if (error) throw error;

    let ingresos = 0, gastos = 0, aporte_realizado = 0;
    (data || []).forEach((t) => {
      const monto = Number(t.monto);
      if (t.tipo === 'ingreso') {
        ingresos += monto;
      } else if (t.tipo === 'gasto') {
        gastos += monto;
        if (t.ambito === 'hogar') aporte_realizado += monto;
      }
    });
    return { ingresos, gastos, aporte_realizado, balance: ingresos - gastos };
  } catch (err) {
    console.error('Error en getBalancePersonal():', err.message || err);
    return { ingresos: 0, gastos: 0, aporte_realizado: 0, balance: 0 };
  }
}
```

- [ ] **Step 4: Rewrite `getSaldoAcumuladoPersonal` — drop the `hogar_id` filter**

```js
// getSaldoAcumuladoPersonal() — saldo disponible personal (todos los tiempos).
// SIN filtro de hogar_id (Fase 6.3): un gasto o ahorro hacia el hogar sale
// igual del bolsillo del miembro. balance = ingresos − gastos − ahorros.
// Returns: { ingresos, gastos, aporte_realizado, balance }. Ceros en error.
async function getSaldoAcumuladoPersonal() {
  try {
    const userId = _requireUserId();
    const { data, error } = await supabase
      .from('transacciones')
      .select('tipo, monto, ambito')
      .eq('user_id', userId);
    if (error) throw error;
    let ingresos = 0, gastos = 0, ahorros = 0, aporte_realizado = 0;
    (data || []).forEach((t) => {
      const monto = Number(t.monto);
      if (t.tipo === 'ingreso') {
        ingresos += monto;
      } else if (t.tipo === 'gasto') {
        gastos += monto;
        if (t.ambito === 'hogar') aporte_realizado += monto;
      } else if (t.tipo === 'ahorro') {
        ahorros += monto;
        if (t.ambito === 'hogar') aporte_realizado += monto;
      }
    });
    return { ingresos, gastos, aporte_realizado, balance: ingresos - gastos - ahorros };
  } catch (err) {
    console.error('Error en getSaldoAcumuladoPersonal():', err.message || err);
    return { ingresos: 0, gastos: 0, aporte_realizado: 0, balance: 0 };
  }
}
```

Note `aporte_realizado` in the accumulated variant now also counts ahorro-hogar rows (it didn't before, since the old `aporte_id` mechanism only ever tagged the personal-gasto half of an aporte pair). This is correct under the new model: contributing savings to the household is just as much "aporte" as a shared expense.

- [ ] **Step 5: No automated test for this step** — these functions hit Supabase directly (no pure logic to unit-test in isolation; correctness is verified in Task 9's manual 2-account pass and Task 23's end-to-end check).

- [ ] **Step 6: Commit**

```bash
git add js/db.js
git commit -m "$(cat <<'EOF'
fix(fase6.3): balances sin ficcion de ingresos-hogar

getBalanceHogar/getSaldoAcumuladoHogar -> getGastosHogar/getAhorroHogarAcumulado
(el hogar ya no tiene ingresos ni "balance"; el numero de cabecera es el
ahorro acumulado). getBalancePersonal/getSaldoAcumuladoPersonal pierden el
filtro .is('hogar_id', null): un gasto o ahorro hacia el hogar sale del
bolsillo del miembro igual que uno personal — esto corrige el bug donde
aportar a una meta de hogar no descontaba del saldo personal. Borra
insertAporteHogar (creaba la pata-ingreso ficticia).
EOF
)"
```

---

## Task 9: `js/db.js` — `getResumenMensual` and `getAportesPorMiembro`

**Files:**
- Modify: `js/db.js:1233-1264` (`getResumenMensual`)
- Modify: `js/db.js:708-745` (`getAportesPorMiembro`)

- [ ] **Step 1: Rewrite the `hogar` half of `getResumenMensual`**

Replace:
```js
    const [hogar, personal] = await Promise.all([
      getBalanceHogar(mes, anio),
      getBalancePersonal(mes, anio),
    ]);
```
with:
```js
    const [gastosHogar, ahorroHogar, personal] = await Promise.all([
      getGastosHogar(mes, anio),
      getAhorrosHogar(mes, anio),
      getBalancePersonal(mes, anio),
    ]);
    const hogar = { gastos: gastosHogar, ahorro: ahorroHogar };
```

(`getAhorrosHogar(mes, anio)` — plural, month-scoped — already exists unchanged at `js/db.js:461-477`; it already computes exactly "ahorro aportado al hogar este mes".)

Find the function's final `return` statement (a few lines below, after the `porCategoria` computation) and confirm it still returns `{ hogar, personal, porCategoria }` — no change needed there, only the shape of the local `hogar` variable changed.

- [ ] **Step 2: Rewrite `getAportesPorMiembro` to drop `tipo: 'ingreso'`**

In the query around `js/db.js:721-728`, change:
```js
    const { data: txs, error: errT } = await supabase
      .from('transacciones')
      .select('user_id, tipo, monto')
      .not('hogar_id', 'is', null)
      .in('tipo', ['ingreso', 'gasto'])
      .gte('fecha', desde)
      .lte('fecha', hasta);
```
to:
```js
    const { data: txs, error: errT } = await supabase
      .from('transacciones')
      .select('user_id, tipo, monto')
      .not('hogar_id', 'is', null)
      .in('tipo', ['gasto', 'ahorro'])
      .gte('fecha', desde)
      .lte('fecha', hasta);
```

Update the comment above the function (`js/db.js:705`) from "Real = SUMA de transacciones con aporte_id != null" to:
```js
// Real = SUMA de gasto hogar + ahorro hogar del miembro en el mes.
// Consistente con aporteRealPorMiembro (js/hogar-aporte.js).
```

- [ ] **Step 3: Commit**

```bash
git add js/db.js
git commit -m "fix(fase6.3): getResumenMensual y getAportesPorMiembro sin ingreso-hogar"
```

---

## Task 10: `js/db.js` + `js/sync.js` — split writes, delete routing, outbox

**Files:**
- Modify: `js/db.js:242-252` (`_serverDeleteTransaccion`)
- Modify: `js/db.js` (new `registrarGastoHogar`, added near `insertSplit` in the SPLIT section)
- Modify: `js/sync.js:21-92` (`_replayOp`)

- [ ] **Step 1: Rewrite `_serverDeleteTransaccion` to route `grupo_id` rows through the RPC**

Replace (`js/db.js:242-252`):
```js
async function _serverDeleteTransaccion(id) {
  const { data: fila, error: errLeer } = await supabase
    .from('transacciones').select('id, aporte_id').eq('id', id).single();
  if (errLeer) throw errLeer;
  let query = supabase.from('transacciones').delete();
  query = (fila && fila.aporte_id) ? query.eq('aporte_id', fila.aporte_id) : query.eq('id', id);
  const { error } = await query;
  if (error) throw error;
}
```
with:
```js
// _serverDeleteTransaccion(id) — borra en el servidor. Si la fila tiene
// grupo_id (gasto compartido con partes de otro miembro), borra el grupo
// completo vía RPC (la policy DELETE es owner-scoped: no se puede borrar
// la fila del otro miembro directamente). Usado online y en el replay
// de la outbox.
async function _serverDeleteTransaccion(id) {
  const { data: fila, error: errLeer } = await supabase
    .from('transacciones').select('id, grupo_id').eq('id', id).single();
  if (errLeer) throw errLeer;
  if (fila && fila.grupo_id) {
    const { error } = await supabase.rpc('borrar_gasto_hogar', { p_grupo_id: fila.grupo_id });
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from('transacciones').delete().eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 2: Add `registrarGastoHogar` near `insertSplit` (`js/db.js`, SPLIT section, after `deleteSplit`)**

```js
// ═══════════════════════════════════════════════════════════════════
// GASTO COMPARTIDO (Fase 6.3) — split de un gasto de hogar entre miembros
// ═══════════════════════════════════════════════════════════════════
// registrarGastoHogar(fecha, categoria_id, nota, partes) — partes:
// [{ user_id, monto }]. Un solo elemento con user_id = usuario activo NO
// pasa por aquí (usar insertTransaccion normal: es el camino rápido de un
// solo pagador, editable y offline como cualquier gasto).
// Online: RPC registrar_gasto_hogar (security definer, valida en servidor).
// Offline: encola en la outbox (entity 'gasto_hogar'); el replay reintenta
// el mismo RPC con el mismo grupo_id (idempotente).
// Returns: array de filas creadas (u optimista con _pending:true si offline).
// Lanza Error en fallo online real.
async function registrarGastoHogar(fecha, categoria_id, nota, partes) {
  const grupoId = crypto.randomUUID();
  const payload = { grupo_id: grupoId, fecha: fecha || null, categoria_id, nota: nota ?? null, partes };

  if (!navigator.onLine) {
    await outboxAdd('gasto_hogar', payload);
    const filasOptimistas = partes.map((p) => ({
      id: crypto.randomUUID(), grupo_id: grupoId, tipo: 'gasto', ambito: 'hogar',
      user_id: p.user_id, categoria_id, monto: p.monto, nota: nota ?? null,
      fecha: fecha || new Date().toISOString().slice(0, 10), _pending: true,
    }));
    for (const fila of filasOptimistas) await mirrorPut('transacciones', fila);
    if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
    return filasOptimistas;
  }

  try {
    const { data, error } = await supabase.rpc('registrar_gasto_hogar', {
      p_grupo_id: grupoId,
      p_fecha: fecha || null,
      p_categoria_id: categoria_id,
      p_nota: nota ?? null,
      p_partes: partes,
    });
    if (error) throw error;
    for (const fila of data || []) await mirrorPut('transacciones', fila);
    return data;
  } catch (err) {
    if (_isNetworkError(err)) {
      await outboxAdd('gasto_hogar', payload);
      if (typeof notifyPendingChanged === 'function') notifyPendingChanged();
      return partes.map((p) => ({ ...p, grupo_id: grupoId, _pending: true }));
    }
    console.error('Error en registrarGastoHogar():', err.message || err);
    throw err;
  }
}
```

- [ ] **Step 3: Add the `gasto_hogar` case to `_replayOp` (`js/sync.js`, after the `delete_recurrente` block, before the generic upsert fallback)**

```js
  if (op.entity === 'gasto_hogar') {
    try {
      const p = op.payload;
      const { data, error } = await supabase.rpc('registrar_gasto_hogar', {
        p_grupo_id: p.grupo_id,
        p_fecha: p.fecha,
        p_categoria_id: p.categoria_id,
        p_nota: p.nota,
        p_partes: p.partes,
      });
      if (error) throw error;
      for (const fila of data || []) await mirrorPut('transacciones', fila);
      return 'done';
    } catch (err) {
      if (!navigator.onLine || /failed to fetch|networkerror|load failed/i.test((err && err.message) + '')) return 'retry';
      console.error('Sync gasto_hogar falló:', err.message || err);
      await outboxSetStatus(op.op_id, 'error', (err && err.message) + '');
      return 'skip';
    }
  }
```

- [ ] **Step 4: Manual verification of offline replay (no automated test — this path needs a real Supabase session)**

In the browser preview (Task 20 will exercise the full UI), toggle DevTools to offline, register a shared expense, confirm it appears optimistically, go back online, confirm `syncOutbox()` clears the pending badge and the RPC actually created 2 rows with a shared `grupo_id`.

- [ ] **Step 5: Commit**

```bash
git add js/db.js js/sync.js
git commit -m "$(cat <<'EOF'
feat(fase6.3): registrarGastoHogar + outbox entity gasto_hogar

Camino online/offline para el split de gastos compartidos: llama al RPC
registrar_gasto_hogar (security definer, valida partes en servidor),
encola en la outbox si esta offline (idempotente por grupo_id, el replay
reintenta el mismo RPC). _serverDeleteTransaccion enruta filas con
grupo_id a traves de borrar_gasto_hogar, porque la policy DELETE es
owner-scoped y A no puede borrar la fila de B directamente.
EOF
)"
```

---

## Task 11: `views/transaccion.html` — partes editor replaces the aporte checkbox

**Files:**
- Modify: `views/transaccion.html:187-195` (HTML)
- Modify: `views/transaccion.html:734-735, 851-858` (JS wiring)
- Modify: `views/transaccion.html:1177-1178` (save flow)

The old "aporte al hogar" checkbox only ever appeared for `ambito=hogar && tipo=gasto`. That is the exact same slot the new partes editor occupies. Saving a household **ahorro** (`ambito=hogar && tipo=ahorro`) needs zero new code — `insertTransaccion` already handles it via the existing `sync_hogar_id` trigger + `_distribuirAhorroTx`, which calls `distribuir_ahorro` unchanged.

- [ ] **Step 1: Replace the checkbox markup (`views/transaccion.html:187-195`)**

```html
      <!-- Partes del gasto compartido (condicional: ambito=hogar && tipo=gasto) -->
      <div id="partesGroup" class="form-group partes-group" style="display:none;" aria-live="polite">
        <p class="form-hint" style="margin:0 0 8px">¿Quién puso cuánto?</p>
        <div id="partesFilas"></div>
        <p id="partesError" class="field-error" style="display:none"></p>
      </div>
```

- [ ] **Step 2: Add CSS for the partes rows** (near the existing `.aporte-hogar-group` rule around `views/transaccion.html:403`)

```css
  .partes-group { border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: var(--space-sm) var(--space-md); }
  .partes-fila { display: flex; align-items: center; gap: var(--space-sm); margin-bottom: 6px; }
  .partes-fila label { flex: 1 1 auto; font-size: var(--font-size-sm); }
  .partes-fila input { width: 110px; }
```

- [ ] **Step 3: Replace the JS wiring (`views/transaccion.html:734-735` and `851-858`)**

Replace:
```js
    const aporteHogarGroup = document.getElementById('aporteHogarGroup');
    const aporteHogarEl    = document.getElementById('aporteHogar');
```
with:
```js
    const partesGroup = document.getElementById('partesGroup');
    const partesFilas  = document.getElementById('partesFilas');
    const partesError  = document.getElementById('partesError');
```

Replace the `_mostrarAporteHogar` function block:
```js
    // ── Aporte al hogar ───────────────────────────────────────
    function _mostrarAporteHogar() {
      // En edición no ofrecemos convertir en aporte (rompería la mitad ya existente).
      if (editTx) { aporteHogarGroup.style.display = 'none'; aporteHogarEl.checked = false; return; }
      const esHogarGasto = ambitoEl.value === 'hogar' && tipoEl.value === 'gasto';
      aporteHogarGroup.style.display = esHogarGasto ? 'block' : 'none';
      if (!esHogarGasto) aporteHogarEl.checked = false;
    }
```
with:
```js
    // ── Partes del gasto compartido (Fase 6.3) ──────────────────
    // Siempre visible para ambito=hogar && tipo=gasto (no checkbox), prefill
    // 100% al registrante. En edición no se ofrece (rompería el grupo existente
    // si ya tiene grupo_id — y no-editable por guard en historial.html de todos modos).
    function _miembrosHogar() {
      const st = window.hogarState || {};
      return (st.miembros || []).map((m) => ({
        user_id: m.user_id,
        nombre: (window.currentUser && m.user_id === window.currentUser.id) ? 'Tú' : 'Pareja',
      }));
    }
    function _renderPartesFilas() {
      const miembros = _miembrosHogar();
      const total = parseFloat(montoEl.value) || 0;
      if (miembros.length < 2) { partesFilas.innerHTML = ''; return; }
      const uid = window.currentUser && window.currentUser.id;
      partesFilas.innerHTML = miembros.map((m) => {
        const prefill = m.user_id === uid ? total : 0;
        return `<div class="partes-fila" data-uid="${esc(m.user_id)}">` +
          `<label>${esc(m.nombre)}</label>` +
          `<input type="number" min="0" step="0.01" class="partes-monto" value="${prefill}">` +
          `</div>`;
      }).join('');
    }
    function _leerPartes() {
      return Array.from(partesFilas.querySelectorAll('.partes-fila')).map((row) => ({
        user_id: row.getAttribute('data-uid'),
        monto: parseFloat(row.querySelector('.partes-monto').value) || 0,
      }));
    }
    function _mostrarPartes() {
      if (editTx) { partesGroup.style.display = 'none'; return; }
      const esHogarGasto = ambitoEl.value === 'hogar' && tipoEl.value === 'gasto';
      partesGroup.style.display = esHogarGasto ? 'block' : 'none';
      if (esHogarGasto) _renderPartesFilas();
    }
```

Update the two call sites that referenced the old function name — `views/transaccion.html:822` (inside `_setTipo`) and `:830` (inside `_setAmbito`) both call `_mostrarAporteHogar();` — rename both calls to `_mostrarPartes();`. Also add a listener so editing the monto field re-prefills the registrant's row:
```js
    montoEl.addEventListener('input', () => { if (partesGroup.style.display !== 'none') _renderPartesFilas(); });
```

- [ ] **Step 4: Replace the save-flow branch (`views/transaccion.html:1177-1178`)**

Replace:
```js
        if (aporteHogarEl.checked) {
          await insertAporteHogar(monto, savedCatId, nota, fecha);
        } else {
```
with:
```js
        const esHogarGastoConPartes = ambitoEl.value === 'hogar' && tipoEl.value === 'gasto' && !editTx;
        if (esHogarGastoConPartes) {
          const partes = _leerPartes().filter((p) => p.monto > 0);
          const check = validarPartesGastoHogar(monto, partes);
          if (!check.ok) {
            partesError.textContent = check.error;
            partesError.style.display = 'block';
            setCargando(false);
            return;
          }
          partesError.style.display = 'none';
          if (partes.length === 1) {
            // Camino rápido: un solo pagador → transacción normal, offline y editable.
            await insertTransaccion({ tipo: 'gasto', ambito: 'hogar', categoria_id: savedCatId, monto, fecha, nota });
          } else {
            await registrarGastoHogar(fecha, savedCatId, nota, partes);
          }
        } else {
```

The `else` branch immediately below (currently the `insertTransaccion(...)` call for the normal path) stays exactly as-is — it's now the fallback for every case that isn't a multi-payer household expense.

- [ ] **Step 5: Remove the now-dead reset line (`views/transaccion.html:1230`)**

Replace:
```js
      aporteHogarGroup.style.display = 'none';
```
with:
```js
      partesGroup.style.display = 'none';
```
(this line is inside the post-save reset function — confirm by reading the surrounding 5 lines before editing, since the exact function name wasn't captured during exploration; it resets form visibility state after a successful save).

- [ ] **Step 6: Verify in the browser preview**

Start the local server (`.claude/launch.json` config `nestra`, `npx serve -l 5050 .`), open `#transaccion`, switch ámbito to Hogar + tipo Gasto, confirm the partes editor appears with the registrant prefilled to the full amount and the other member at 0. Edit both amounts so they don't sum to the total, confirm the inline error appears on save attempt. Fix the sum, save, confirm success. Repeat with only the registrant's amount > 0 (partes.length === 1 after filtering) and confirm it saves as a normal single transaction (check via historial that it has no split badge).

- [ ] **Step 7: Commit**

```bash
git add views/transaccion.html
git commit -m "$(cat <<'EOF'
feat(fase6.3): editor de partes reemplaza el checkbox "aporte al hogar"

Para ambito=hogar && tipo=gasto, el formulario siempre muestra un editor
de partes (prefill 100% al registrante) en vez del viejo checkbox que
creaba la ficcion de ingreso-hogar. Un solo pagador -> transaccion normal
(offline, editable). 2+ pagadores -> registrarGastoHogar (RPC). El ahorro
al hogar no necesita codigo nuevo: ya funciona via el flujo normal de
ahorro (tipo=ahorro, ambito=hogar).
EOF
)"
```

---

## Task 12: `views/historial.html` — `aporte_id` → `grupo_id`

**Files:**
- Modify: `views/historial.html:758, 778, 782, 806, 811, 1154, 1217-1253, 1258`

- [ ] **Step 1: Rename the field in `_datosTx` (`views/historial.html:758`)**

Replace:
```js
        aporte: !!t.aporte_id,
```
with:
```js
        grupo: !!t.grupo_id,
```

- [ ] **Step 2: Update `cardTx` (`views/historial.html:778, 782`)**

Replace:
```js
      var aporteBadge = d.aporte ? '<span class="hist-badge hist-badge--aporte" title="Aporte vinculado">↔ aporte</span>' : '';
```
with:
```js
      var aporteBadge = d.grupo ? '<span class="hist-badge hist-badge--aporte" title="Gasto compartido">⚭ compartido</span>' : '';
```
Replace:
```js
      var btnEditar = (d.aporte || d.directo || t._split) ? '' :
```
(both occurrences, `cardTx` line 782 and `rowTx` line 811) with:
```js
      var btnEditar = (d.grupo || d.directo || t._split) ? '' :
```

- [ ] **Step 3: Update `rowTx` (`views/historial.html:806`)**

Replace:
```js
      var aporteMark = d.aporte ? ' <span class="hist-badge hist-badge--aporte" title="Aporte vinculado">↔ aporte</span>' : '';
```
with:
```js
      var aporteMark = d.grupo ? ' <span class="hist-badge hist-badge--aporte" title="Gasto compartido">⚭ compartido</span>' : '';
```

- [ ] **Step 4: Update the delete guard (`views/historial.html:1154`)**

Replace:
```js
      if (tx && tx.aporte_id) { abrirModalAporte(tx); return; }   // irreversible → modal
```
with:
```js
      if (tx && tx.grupo_id) { abrirModalAporte(tx); return; }   // toca las filas de ambos → modal
```

- [ ] **Step 5: Update the modal copy and confirm handler (`views/historial.html:1217-1253`)**

Replace the modal body text:
```js
    function abrirModalAporte(tx) {
      aporteTxId = tx.id;
      $('histAporteBody').innerHTML =
        'Este movimiento es parte de un <strong>aporte al hogar</strong> de ' +
        esc(formatMonto(tx.monto)) + '. Borrarlo elimina <strong>las dos mitades</strong> ' +
        '(tu gasto y el ingreso del hogar) y revierte lo repartido a las metas. No se puede deshacer.';
```
with:
```js
    function abrirModalAporte(tx) {
      aporteTxId = tx.id;
      $('histAporteBody').innerHTML =
        'Este movimiento es parte de un <strong>gasto compartido del hogar</strong>. ' +
        'Borrarlo elimina <strong>la parte de ambos miembros</strong>. No se puede deshacer.';
```

`$('histAporteConfirm')`'s click handler already calls `deleteTransaccion(id)` (unchanged — Task 10 made `_serverDeleteTransaccion` route `grupo_id` rows through `borrar_gasto_hogar` automatically), so no logic change needed there, only update the toast copy `mostrarToast('Aporte eliminado', ...)` → `mostrarToast('Gasto compartido eliminado', ...)`.

- [ ] **Step 6: Update the edit guard (`views/historial.html:1258`)**

Replace:
```js
      if (!tx || tx.aporte_id || tx.es_aporte_directo) return; // aporte vinculado / directo no editable
```
with:
```js
      if (!tx || tx.grupo_id || tx.es_aporte_directo) return; // gasto compartido / aporte directo no editables
```

- [ ] **Step 7: Verify in the browser preview**

Open `#historial` with the migrated production data (2 accounts). Confirm the two collapsed-pair rows (now `tipo=ahorro`) show no "compartido" badge (they never had `grupo_id`, only the old `aporte_id` which is gone). After Task 11 is live, create a real 2-payer shared expense and confirm the "⚭ compartido" badge appears on both rows, editing is disabled, and deleting opens the modal and removes both rows.

- [ ] **Step 8: Commit**

```bash
git add views/historial.html
git commit -m "fix(fase6.3): historial.html usa grupo_id (gasto compartido) en vez de aporte_id"
```

---

## Task 13: `views/hogar.html` — desequilibrio card, discreet cash settlement, dissolution preview

**Files:**
- Modify: `views/hogar.html:371-578` (`previewDisolucionHtml`, `renderConHogar`, saldar listener)

- [ ] **Step 1: Rewrite `previewDisolucionHtml` (`views/hogar.html:371-407`)**

```js
    /* ── Preview de disolución (cliente) ──────────────────── */
    function previewDisolucionHtml(txs, uidActual, otroId, deseq) {
      function sumAhorro(uid) {
        return (txs || []).reduce(function (s, t) {
          return (t.ambito === 'hogar' && t.tipo === 'ahorro' && t.user_id === uid)
            ? s + (Number(t.monto) || 0) : s;
        }, 0);
      }
      var miAhorro = sumAhorro(uidActual);
      var otroAhorro = otroId ? sumAhorro(otroId) : 0;
      var html =
        '<p class="hogar-modal-body" style="margin:0 0 var(--space-sm)">' +
          'Cada quien recupera lo que ahorró al hogar: tú <strong>' + escHtml(fmt(miAhorro)) + '</strong>' +
          (otroId ? ' · tu pareja <strong>' + escHtml(fmt(otroAhorro)) + '</strong>' : '') +
          '.' +
        '</p>';
      if (deseq && deseq.brecha > 0) {
        var yoDebo = deseq.debeAportarMas === uidActual;
        html +=
          '<p class="hogar-modal-body" style="color:var(--color-danger);margin:0">' +
            '⚠ Queda un desequilibrio de gastos compartidos de ' + escHtml(fmt(deseq.brecha)) +
            (yoDebo ? ' a tu favor de la pareja' : ' a favor tuyo') +
            '. La disolución no lo cobra; queda como referencia si quieren zanjarlo aparte.' +
          '</p>';
      }
      return html;
    }
```

- [ ] **Step 2: Rewrite the balance section of `renderConHogar` (`views/hogar.html:409-472`)**

Replace the block from `// Balance "quién debe qué"...` through the end of the `balCard` construction:
```js
      // Balance "quién debe qué" (solo con un segundo miembro).
      var bal = { neto: 0, acreedor: null, deudor: null };
      if (otro && typeof window.calcularBalanceHogar === 'function') {
        var modo = (estado.hogar && estado.hogar.reparto) || '50_50';
        bal = window.calcularBalanceHogar(txs, liqs, uidActual, otro, modo);
      }
```
with:
```js
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

(`calcularDesequilibrioHogar` is keyed by `uidA=creadorId, uidB=otro` — consistent regardless of whether the caller is the creator or not; `deseq.debeAportarMas`/`yaAportoDeMas` are absolute user ids, compared against `uidActual` below, not against A/B roles.)

Replace the `balCard` block:
```js
      // ── Bloque balance ──
      var balCard;
      if (!otro) {
        balCard =
          '<div class="hogar-card">' +
            '<h2 class="hogar-card-title">Balance</h2>' +
            '<p class="hogar-card-sub">Comparte el código para que tu pareja se una y empiecen a balancear gastos.</p>' +
          '</div>';
      } else if (bal.neto === 0) {
        balCard =
          '<div class="hogar-card">' +
            '<h2 class="hogar-card-title">Balance</h2>' +
            '<p class="hogar-balance-num hogar-balance-num--mano">Están a mano</p>' +
            '<p class="hogar-balance-sub">Nadie le debe nada al otro.</p>' +
          '</div>';
      } else {
        var meDeben = bal.acreedor === uidActual;
        balCard =
          '<div class="hogar-card">' +
            '<h2 class="hogar-card-title">Balance</h2>' +
            '<p class="hogar-balance-num ' + (meDeben ? 'hogar-balance-num--cobra' : 'hogar-balance-num--debe') + '">' +
              (meDeben ? 'Te deben ' : 'Le debes ') + escHtml(fmt(bal.neto)) +
            '</p>' +
            '<p class="hogar-balance-sub">Reparto 50/50 de los gastos del hogar, menos lo ya saldado.</p>' +
            '<button type="button" class="btn btn-primary btn-sm" id="hogarBtnSaldar">Saldar ' + escHtml(fmt(bal.neto)) + '</button>' +
          '</div>';
      }
```
with:
```js
      // ── Bloque desequilibrio de aportes ──
      var balCard;
      if (!otro) {
        balCard =
          '<div class="hogar-card">' +
            '<h2 class="hogar-card-title">Desequilibrio de aportes</h2>' +
            '<p class="hogar-card-sub">Comparte el código para que tu pareja se una y empiecen a registrar gastos compartidos.</p>' +
          '</div>';
      } else if (deseq.brecha === 0) {
        balCard =
          '<div class="hogar-card">' +
            '<h2 class="hogar-card-title">Desequilibrio de aportes</h2>' +
            '<p class="hogar-balance-num hogar-balance-num--mano">Van igual</p>' +
            '<p class="hogar-balance-sub">Ambos aportan su parte justa a los gastos compartidos.</p>' +
          '</div>';
      } else {
        var yoDeboMas = deseq.debeAportarMas === uidActual;
        balCard =
          '<div class="hogar-card">' +
            '<h2 class="hogar-card-title">Desequilibrio de aportes</h2>' +
            '<p class="hogar-balance-num ' + (yoDeboMas ? 'hogar-balance-num--debe' : 'hogar-balance-num--cobra') + '">' +
              (yoDeboMas ? 'Deberías aportar ' : 'Tu pareja debería aportar ') + escHtml(fmt(deseq.brecha)) + ' más' +
            '</p>' +
            '<p class="hogar-balance-sub">En los próximos gastos compartidos, para igualar el reparto. No es una deuda: se corrige gastando.' +
              ' <a href="#" id="hogarLinkPagoEfectivo" style="font-size:var(--font-size-sm)">Registrar pago en efectivo</a>' +
            '</p>' +
          '</div>';
      }
```

- [ ] **Step 3: Rewrite the aporte card's rangoMes usage stays intact** (`views/hogar.html:474-492` — `aporteRealPorMiembro` signature and behavior are unchanged from the caller's perspective; Task 3 changed its internals, not its interface. No edit needed here.)

- [ ] **Step 4: Replace the saldar listener with the discreet link listener (`views/hogar.html:548-561`)**

Replace:
```js
      var btnSaldar = $('hogarBtnSaldar');
      if (btnSaldar) {
        btnSaldar.addEventListener('click', async function () {
          btnSaldar.disabled = true;
          try {
            await window.saldarHogar(bal.deudor, bal.acreedor, bal.neto, null);
            toast('Saldado', 3000);
            await render();
          } catch (e) {
            toast((e && e.message) || 'No se pudo saldar', 5000);
            btnSaldar.disabled = false;
          }
        });
      }
```
with:
```js
      var linkPago = $('hogarLinkPagoEfectivo');
      if (linkPago) {
        linkPago.addEventListener('click', async function (e) {
          e.preventDefault();
          if (!confirm('¿Registrar que ' + (deseq.debeAportarMas === uidActual ? 'ya pagaste' : 'tu pareja ya pagó') +
            ' ' + fmt(deseq.brecha) + ' en efectivo para cerrar el desequilibrio?')) return;
          try {
            await window.saldarHogar(deseq.debeAportarMas, deseq.yaAportoDeMas, deseq.brecha, 'Pago en efectivo');
            toast('Registrado', 3000);
            await render();
          } catch (e2) {
            toast((e2 && e2.message) || 'No se pudo registrar', 5000);
          }
        });
      }
```

- [ ] **Step 5: Update the `previewDisolucionHtml` call site and disolver button copy (`views/hogar.html:563-567`)**

Replace:
```js
      $('hogarBtnDisolver').addEventListener('click', function () {
        $('hogarDisolverPreview').innerHTML = previewDisolucionHtml(txs, creadorId, otro, uidActual, bal);
        abrirModal('hogarDisolverModal');
        setTimeout(function () { $('hogarDisolverCancelar').focus(); }, 50);
      });
```
with:
```js
      $('hogarBtnDisolver').addEventListener('click', function () {
        $('hogarDisolverPreview').innerHTML = previewDisolucionHtml(txs, uidActual, otro, deseq);
        abrirModal('hogarDisolverModal');
        setTimeout(function () { $('hogarDisolverCancelar').focus(); }, 50);
      });
```

- [ ] **Step 6: Update the disolver confirm handler's toast (`views/hogar.html:582-602`)**

Replace:
```js
        var creador = (r && r.recibe_creador != null) ? fmt(r.recibe_creador) : null;
        var otro    = (r && r.recibe_otro != null) ? fmt(r.recibe_otro) : null;
        if (creador != null && otro != null) {
          toast('Hogar disuelto. Reparto: creador ' + creador + ', pareja ' + otro, 6000);
        } else {
          toast('Hogar disuelto', 4000);
        }
```
with:
```js
        var miAhorroFinal = (r && r.ahorro_creador != null) ? fmt(r.ahorro_creador) : null;
        toast(miAhorroFinal != null ? ('Hogar disuelto. Ahorro recuperado: ' + miAhorroFinal) : 'Hogar disuelto', 5000);
```

(`disolver_hogar`'s new return shape from Task 5 is `{ ahorro_creador, ahorro_otro, desequilibrio_brecha, desequilibrio_debe_aportar_mas, desequilibrio_ya_aporto_de_mas }` — the toast shows a simple confirmation rather than trying to attribute "creador"/"pareja" labels correctly for both possible callers in one string.)

- [ ] **Step 7: Verify in the browser preview with 2 accounts**

Log in as each of the 2 real accounts in turn (see the project's test-account memory for how preview auth works). Confirm: "Desequilibrio de aportes" card renders correctly for both (0 gasto-hogar rows currently in prod, so expect "Van igual" until Task 11 creates real split data). Confirm the "Registrar pago en efectivo" link only appears when `brecha > 0`. Confirm the disolution preview shows real ahorro figures and, if `deseq.brecha > 0`, the informational warning — do not actually click "confirm disolver" against production data.

- [ ] **Step 8: Commit**

```bash
git add views/hogar.html
git commit -m "$(cat <<'EOF'
feat(fase6.3): hogar.html — desequilibrio de aportes reemplaza "quien debe que"

Card renombrada, lenguaje prospectivo ("deberia aportar mas", no "debe").
"Saldar" se degrada a un link discreto "Registrar pago en efectivo" bajo
la card (antes era un boton primario prominente). Preview de disolucion
usa ahorro real por miembro (identidad: cada quien recupera lo que puso)
e informa el desequilibrio de gastos aparte, sin cobrarlo.
EOF
)"
```

---

## Task 14: `views/dashboard.html` — cards rework

**Files:**
- Modify: `views/dashboard.html:594-617` (`renderHogar`)
- Modify: `views/dashboard.html:889-978` (`cargar()`, `cargarDeudaHogar()`)

- [ ] **Step 1: Rewrite `renderHogar` (`views/dashboard.html:594-617`)**

Replace:
```js
    function renderHogar(b, acum, ahorros) {
      const body = $('hogarBody');
      body.setAttribute('aria-busy', 'false');
      body.innerHTML = `
        <div class="dash-line">
          <span class="dash-line-label">Ingresos</span>
          <span class="dash-line-value dash-line-value--ingreso">${esc(formatMonto(b.ingresos))}</span>
        </div>
        <div class="dash-line">
          <span class="dash-line-label">Gastos</span>
          <span class="dash-line-value dash-line-value--gasto">${esc(formatMonto(b.gastos))}</span>
        </div>
        <div class="dash-line">
          <span class="dash-line-label">Ahorros</span>
          <span class="dash-line-value dash-line-value--ahorro">${esc(formatMonto(ahorros))}</span>
        </div>
        <div class="dash-neto">
          <div>
            <span class="dash-neto-label">Balance acumulado</span>
            <span class="dash-neto-sublabel">${deltaMesHtml(b.balance - ahorros)}</span>
          </div>
          <span class="dash-neto-value ${netoClass(acum.balance)}">${esc(formatMonto(acum.balance))}</span>
        </div>`;
    }
```
with:
```js
    // ── Render: ahorro del hogar (gastosMes, ahorroMes, ahorroAcumulado) ──
    function renderHogar(gastosMes, ahorroMes, ahorroAcumulado) {
      const body = $('hogarBody');
      body.setAttribute('aria-busy', 'false');
      body.innerHTML = `
        <div class="dash-line">
          <span class="dash-line-label">Gastos compartidos</span>
          <span class="dash-line-value dash-line-value--gasto">${esc(formatMonto(gastosMes))}</span>
        </div>
        <div class="dash-line">
          <span class="dash-line-label">Ahorro aportado</span>
          <span class="dash-line-value dash-line-value--ahorro">${esc(formatMonto(ahorroMes))}</span>
        </div>
        <div class="dash-neto">
          <div>
            <span class="dash-neto-label">Ahorro del hogar</span>
          </div>
          <span class="dash-neto-value ${netoClass(ahorroAcumulado)}">${esc(formatMonto(ahorroAcumulado))}</span>
        </div>`;
    }
```

- [ ] **Step 2: Update the loader (`views/dashboard.html:890-914`)**

Replace:
```js
      const [hogar, personal, alertas, txs, metas, acumHogar, acumPersonal, ahorrosHogar, ahorrosPersonal, insights, categoriasGasto, gastosCat, safeToSpend, gastosCatHogar] = await Promise.allSettled([
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
        getGastoHogarPorCategoria(mes, anio),
      ]);

      const acumH = acumHogar.status === 'fulfilled' ? acumHogar.value : (hogar.status === 'fulfilled' ? hogar.value : { balance: 0 });
      const acumP = acumPersonal.status === 'fulfilled' ? acumPersonal.value : (personal.status === 'fulfilled' ? personal.value : { balance: 0 });
      const ahorH = ahorrosHogar.status === 'fulfilled' ? ahorrosHogar.value : 0;
      const ahorP = ahorrosPersonal.status === 'fulfilled' ? ahorrosPersonal.value : 0;

      if (hogar.status === 'fulfilled')    renderHogar(hogar.value, acumH, ahorH);
      if (personal.status === 'fulfilled') renderPersonal(personal.value, acumP, ahorP);
```
with:
```js
      const [gastosHogar, personal, alertas, txs, metas, ahorroHogarAcum, acumPersonal, ahorrosHogar, ahorrosPersonal, insights, categoriasGasto, gastosCat, safeToSpend, gastosCatHogar] = await Promise.allSettled([
        getGastosHogar(mes, anio),
        getBalancePersonal(mes, anio),
        evaluarAlertas(mes, anio),
        getUltimasTransacciones(5),
        getMetas(),
        getAhorroHogarAcumulado(),
        getSaldoAcumuladoPersonal(),
        getAhorrosHogar(mes, anio),
        getAhorrosPersonal(mes, anio),
        cargarInsights(),
        getCategorias('gasto'),
        getGastosPorCategoriaMes(mes, anio),
        cargarSafeToSpend(),
        getGastoHogarPorCategoria(mes, anio),
      ]);

      const acumP = acumPersonal.status === 'fulfilled' ? acumPersonal.value : (personal.status === 'fulfilled' ? personal.value : { balance: 0 });
      const ahorHAcum = ahorroHogarAcum.status === 'fulfilled' ? ahorroHogarAcum.value : 0;
      const ahorH = ahorrosHogar.status === 'fulfilled' ? ahorrosHogar.value : 0;
      const ahorP = ahorrosPersonal.status === 'fulfilled' ? ahorrosPersonal.value : 0;

      if (gastosHogar.status === 'fulfilled') renderHogar(gastosHogar.value, ahorH, ahorHAcum);
      if (personal.status === 'fulfilled') renderPersonal(personal.value, acumP, ahorP);
```

`renderPersonal` (`views/dashboard.html:620-648`) and the `todoFallo` check a few lines below both reference `hogar` — update the `todoFallo` line:
```js
      const todoFallo = [hogar, personal, alertas, txs, metas]
        .every((r) => r.status === 'rejected');
```
to:
```js
      const todoFallo = [gastosHogar, personal, alertas, txs, metas]
        .every((r) => r.status === 'rejected');
```

`renderPersonal` itself is unchanged (still consumes `getBalancePersonal`'s `{ingresos, gastos, balance, aporte_realizado}` shape, which Task 8 preserved).

- [ ] **Step 3: Rewrite `cargarDeudaHogar` (`views/dashboard.html:946-977`)**

Replace the entire IIFE body:
```js
    // ── Fase 6 — "Quién debe qué" (card solo si hay hogar compartido) ──
    // Carga aparte: es opcional y no debe tumbar el resto del dashboard.
    (async function cargarDeudaHogar() {
      try {
        if (typeof tieneHogar === 'function' && !tieneHogar()) return; // gating Fase 6.1
        if (typeof getEstadoHogar !== 'function') return;
        const estado = await getEstadoHogar();
        if (!estado || !estado.hogar) return;
        const uid  = (window.currentUser && window.currentUser.id) || null;
        const otro = ((estado.miembros || []).find((m) => m.user_id !== uid) || {}).user_id || null;
        if (!otro || typeof calcularBalanceHogar !== 'function') return; // hace falta un 2º miembro
        const [txs, liqs] = await Promise.all([getTransacciones({}), getLiquidacionesHogar()]);
        const modo = (estado.hogar && estado.hogar.reparto) || '50_50';
        const bal  = calcularBalanceHogar(txs, liqs, uid, otro, modo);
        const card = $('dashDeudaCard');
        const body = $('dashDeudaBody');
        if (!card || !body) return;
        if (bal.neto === 0) {
          body.innerHTML = '<p class="dash-neto-label">Están a mano</p>';
        } else {
          const meDeben = bal.acreedor === uid;
          body.innerHTML =
            '<div class="dash-neto"><div><span class="dash-neto-label">' +
              (meDeben ? 'Te deben' : 'Le debes') + '</span></div>' +
            '<span class="dash-neto-value ' + netoClass(meDeben ? bal.neto : -bal.neto) + '">' +
              esc(formatMonto(bal.neto)) + '</span></div>';
        }
        card.style.display = '';
      } catch (e) {
        // Hogar no disponible (p.ej. tabla aún sin migrar) → no mostrar la card.
      }
    })();
```
with:
```js
    // ── Fase 6.3 — Desequilibrio de aportes (card solo si hay hogar) ──
    // Carga aparte: es opcional y no debe tumbar el resto del dashboard.
    (async function cargarDesequilibrioHogar() {
      try {
        if (typeof tieneHogar === 'function' && !tieneHogar()) return;
        if (typeof getEstadoHogar !== 'function') return;
        const estado = await getEstadoHogar();
        if (!estado || !estado.hogar) return;
        const uid  = (window.currentUser && window.currentUser.id) || null;
        const miembros = estado.miembros || [];
        const creadorId = (miembros.find((m) => m.rol === 'creador') || {}).user_id || uid;
        const otro = (miembros.find((m) => m.user_id !== creadorId) || {}).user_id || null;
        if (!otro || typeof calcularDesequilibrioHogar !== 'function') return;
        const [txs, liqs] = await Promise.all([getTransacciones({}), getLiquidacionesHogar()]);
        const modo = (estado.hogar && estado.hogar.reparto) || '50_50';
        const objetivo = { modo };
        if (modo === 'proporcional') {
          const mA = miembros.find((m) => m.user_id === creadorId) || {};
          const mB = miembros.find((m) => m.user_id === otro) || {};
          objetivo.esperadoA = mA.aporte_esperado; objetivo.esperadoB = mB.aporte_esperado;
        }
        const deseq = calcularDesequilibrioHogar(txs, liqs, creadorId, otro, objetivo);
        const card = $('dashDeudaCard');
        const body = $('dashDeudaBody');
        if (!card || !body) return;
        if (deseq.brecha === 0) {
          body.innerHTML = '<p class="dash-neto-label">Van igual</p>';
        } else {
          const yoDeboMas = deseq.debeAportarMas === uid;
          body.innerHTML =
            '<div class="dash-neto"><div><span class="dash-neto-label">' +
              (yoDeboMas ? 'Deberías aportar más' : 'Tu pareja debería aportar más') + '</span></div>' +
            '<span class="dash-neto-value ' + netoClass(yoDeboMas ? -deseq.brecha : deseq.brecha) + '">' +
              esc(formatMonto(deseq.brecha)) + '</span></div>';
        }
        card.style.display = '';
      } catch (e) {
        // Hogar no disponible → no mostrar la card.
      }
    })();
```

- [ ] **Step 4: Rename the card title (`views/dashboard.html:51-57`)**

Replace:
```html
  <section class="card dash-balance-card" id="dashDeudaCard" aria-labelledby="deudaTitle" style="display:none">
    <h2 class="dash-card-title" id="deudaTitle">
      <svg class="cat-icono" aria-hidden="true"><use href="assets/tabler-sprite.svg#tabler-users"></use></svg> Quién debe qué
      <a href="#hogar" class="dash-card-periodo" style="text-decoration:none">Ver hogar →</a>
    </h2>
```
with:
```html
  <section class="card dash-balance-card" id="dashDeudaCard" aria-labelledby="deudaTitle" style="display:none">
    <h2 class="dash-card-title" id="deudaTitle">
      <svg class="cat-icono" aria-hidden="true"><use href="assets/tabler-sprite.svg#tabler-users"></use></svg> Desequilibrio de aportes
      <a href="#hogar" class="dash-card-periodo" style="text-decoration:none">Ver hogar →</a>
    </h2>
```

Also rename the "Balance del hogar" card header (`views/dashboard.html:24-26`), swapping the label text only:
```html
      <h2 class="dash-card-title" id="hogarTitle">
        <svg class="cat-icono" aria-hidden="true"><use href="assets/tabler-sprite.svg#tabler-home"></use></svg> Hogar
        <span class="dash-card-periodo" id="hogarPeriodo"></span>
      </h2>
```
No change needed here — "Hogar" as a section label is still accurate; the reframing is inside the card body (Step 1), not the header.

- [ ] **Step 5: Verify in the browser preview with 2 accounts**

Load `#dashboard` for both accounts. Confirm the hogar card shows "Gastos compartidos" / "Ahorro aportado" / "Ahorro del hogar" (500 after migration) instead of Ingresos/Gastos/Balance. Confirm the desequilibrio card shows "Van igual" (no gasto-hogar rows exist yet pre-Task-11 testing).

- [ ] **Step 6: Commit**

```bash
git add views/dashboard.html
git commit -m "$(cat <<'EOF'
feat(fase6.3): dashboard.html — "Ahorro del hogar" y "Desequilibrio de aportes"

Card hogar deja de mostrar Ingresos/Balance (ya no existen): ahora Gastos
compartidos + Ahorro aportado (mes) + Ahorro del hogar (acumulado). Card
"Quien debe que" -> "Desequilibrio de aportes", lenguaje prospectivo.
EOF
)"
```

---

## Task 15: `views/graficos.html` — chart1, chart4, chart6 data sources

**Files:**
- Modify: `views/graficos.html:280-306` (`cargarDatos` composition)
- Modify: `views/graficos.html:498-501` (chart6 flujo de caja)

chart3 ("aporte real vs. esperado") needs **no changes** — it already just reads `.esperado`/`.real` off whatever `getAportesPorMiembro` returns, and Task 9 already re-based that function.

- [ ] **Step 1: Rewrite the hogar branch's 6-month series source (`views/graficos.html:280-306`)**

Replace:
```js
      var resHog = await Promise.all([
        getTransacciones({ fecha_desde: r.desde, fecha_hasta: r.hasta })
          .then(function (a) { return (a || []).filter(function (x) { return x.hogar_id != null; }); }),
        getResumenMensual(m, a),
        getResumenMensual(ant.mes, ant.anio),
        getAportesPorMiembro(m, a),
        Promise.all(meses6.map(function (x) { return getBalanceHogar(x.mes, x.anio); })),
        getMetas(),
      ]);
      var metasH = (resHog[5] || []).filter(function (x) {
        return x.hogar_id != null && Number(x.monto_actual) < Number(x.monto_objetivo);
      });
      var aportesH = await Promise.all(metasH.map(function (mt) { return getAportesDeMeta(mt.id); }));
      return {
        txMes: resHog[0] || [],
        resumen: resHog[1],
        resumenAnterior: resHog[2],
        categoriasGasto: categoriasGasto || [],
        aportesMiembro: resHog[3] || [],
        balance6m: meses6.map(function (x, i) {
          return { label: nombreMes(x.mes, x.anio).split(' ')[0].slice(0, 3), balance: (resHog[4][i] || {}).balance || 0 };
        }),
        metas: metasH.map(function (mt, i) { return { meta: mt, aportes: aportesH[i] || [] }; }),
        recurrentes: recurrentes || [],
        rango: r,
      };
```
with:
```js
      var resHog = await Promise.all([
        getTransacciones({ fecha_desde: r.desde, fecha_hasta: r.hasta })
          .then(function (a) { return (a || []).filter(function (x) { return x.hogar_id != null; }); }),
        getResumenMensual(m, a),
        getResumenMensual(ant.mes, ant.anio),
        getAportesPorMiembro(m, a),
        Promise.all(meses6.map(function (x) { return getAhorrosHogar(x.mes, x.anio); })),
        getMetas(),
      ]);
      var metasH = (resHog[5] || []).filter(function (x) {
        return x.hogar_id != null && Number(x.monto_actual) < Number(x.monto_objetivo);
      });
      var aportesH = await Promise.all(metasH.map(function (mt) { return getAportesDeMeta(mt.id); }));
      return {
        txMes: resHog[0] || [],
        resumen: resHog[1],
        resumenAnterior: resHog[2],
        categoriasGasto: categoriasGasto || [],
        aportesMiembro: resHog[3] || [],
        // "balance" aquí es ahorro real del mes (getAhorrosHogar), no ingresos-gastos:
        // chart4 hace un cumsum y lo titula "Ahorro acumulado" — con esta fuente el
        // título por fin coincide con el dato (antes sumaba ingresos-hogar, la ficción).
        balance6m: meses6.map(function (x, i) {
          return { label: nombreMes(x.mes, x.anio).split(' ')[0].slice(0, 3), balance: Number(resHog[4][i]) || 0 };
        }),
        metas: metasH.map(function (mt, i) { return { meta: mt, aportes: aportesH[i] || [] }; }),
        recurrentes: recurrentes || [],
        rango: r,
      };
```

Note `render1` (`views/graficos.html:308+`, "Evolución temporal") already sums `tipo==='ingreso'` and `tipo==='gasto'` off `datos.txMes` — since `txMes` for the hogar branch is filtered to `hogar_id != null` rows, and those rows can no longer be `tipo='ingreso'` post-migration, the ingresos line on chart1 will simply plot flat at 0 for the hogar ámbito. No code change needed there; it degrades correctly on its own. Confirm this visually in Step 3.

- [ ] **Step 2: Fix chart6 "Flujo de caja" (`views/graficos.html:498-501`)**

Replace:
```js
      var resumen = datos.resumen;
      var ingresos = (resumen.hogar.ingresos || 0) + (resumen.personal.ingresos || 0);
      var gastos   = (resumen.hogar.gastos   || 0) + (resumen.personal.gastos   || 0);
```
with:
```js
      var resumen = datos.resumen;
      var ingresos = resumen.personal.ingresos || 0; // el hogar ya no tiene ingresos propios
      var gastos   = (resumen.hogar.gastos || 0) + (resumen.personal.gastos || 0);
```

- [ ] **Step 3: Verify in the browser preview**

Open `#graficos`, toggle to ámbito Hogar. Confirm chart1 "Evolución temporal" shows a flat ingresos line at 0 and a real gastos line. Confirm chart4 "Ahorro acumulado" plots a cumulative sum that now matches `getAhorrosHogar` per month (500 total after the orphan-row migration, spread across whichever months have ahorro rows). Confirm chart6 "Flujo de caja" no longer double-counts a phantom hogar ingreso.

- [ ] **Step 4: Commit**

```bash
git add views/graficos.html
git commit -m "$(cat <<'EOF'
fix(fase6.3): graficos.html sin ingresos-hogar

chart4 "Ahorro acumulado" ahora se alimenta de getAhorrosHogar (ahorro
real) en vez de getBalanceHogar (ingresos-gastos, la ficcion) — el titulo
del chart por fin coincide con el dato que grafica. chart6 "Flujo de caja"
deja de sumar resumen.hogar.ingresos (ya no existe). chart3 no cambia:
ya era generico sobre .esperado/.real, que Task 9 re-baso en db.js.
EOF
)"
```

---

## Task 16: `views/resumen.html` — hogar KPI section

**Files:**
- Modify: `views/resumen.html:383-395` (`renderHogar`)

- [ ] **Step 1: Rewrite `renderHogar`**

Replace:
```js
    /* ── Render Hogar ─────────────────────────────────────── */
    function renderHogar(actual, prev) {
      // Gating Fase 6.1: la sección hogar solo aparece con hogar.
      if (!(typeof tieneHogar === 'function' && tieneHogar())) {
        $('resHogarSection').style.display = 'none';
        return;
      }
      $('resHogarKpis').innerHTML =
        kpiCard('Ingresos', actual.ingresos, calcDelta(actual.ingresos, prev.ingresos), false, 'pos') +
        kpiCard('Gastos',   actual.gastos,   calcDelta(actual.gastos,   prev.gastos),   true,  'neg') +
        kpiCard('Balance',  actual.balance,  calcDelta(actual.balance,  prev.balance),  false, 'balance');
      $('resHogarSection').style.display = 'block';
      $('resHogarSection').style.opacity = '1';
    }
```
with:
```js
    /* ── Render Hogar ─────────────────────────────────────── */
    function renderHogar(actual, prev) {
      // Gating Fase 6.1: la sección hogar solo aparece con hogar.
      if (!(typeof tieneHogar === 'function' && tieneHogar())) {
        $('resHogarSection').style.display = 'none';
        return;
      }
      // actual/prev son datos.resumen.hogar de getResumenMensual: { gastos, ahorro }.
      // El hogar ya no tiene ingresos propios ni "balance" (Fase 6.3).
      $('resHogarKpis').innerHTML =
        kpiCard('Gastos compartidos', actual.gastos, calcDelta(actual.gastos, prev.gastos), true, 'neg') +
        kpiCard('Ahorro aportado',    actual.ahorro, calcDelta(actual.ahorro, prev.ahorro),  false, 'pos');
      $('resHogarSection').style.display = 'block';
      $('resHogarSection').style.opacity = '1';
    }
```

`renderPersonal` (`views/resumen.html:399-407`) is unchanged — it already reads `actual.ingresos/gastos/balance/aporte_realizado`, all fields Task 8 preserved on `getBalancePersonal`.

- [ ] **Step 2: Verify in the browser preview**

Open `#resumen`. Confirm the Hogar section shows 2 KPI cards (Gastos compartidos, Ahorro aportado) instead of 3 (no more Ingresos/Balance). Confirm the Personal section is unaffected, still showing the "↳ de eso, aporte al hogar" line correctly (Task 8's `aporte_realizado` still populates it).

- [ ] **Step 3: Commit**

```bash
git add views/resumen.html
git commit -m "fix(fase6.3): resumen.html — KPIs del hogar sin ingresos ni balance"
```

---

## Task 17: `views/brujula.html` — liquidity fix

**Files:**
- Modify: `views/brujula.html:192`

This is the bug the spec flagged as the worst silent breakage: `js/brujula.js:10`'s `liquidez = max(0, ingresos − gastos − ...)` would go permanently to 0 for ámbito hogar once hogar has no ingresos, making the Brújula answer "no" to everything in that ámbito forever.

- [ ] **Step 1: Always evaluate against the asker's personal wallet**

Replace:
```js
        (ambito === 'personal' ? getBalancePersonal(hoy.mes, hoy.anio) : getBalanceHogar(hoy.mes, hoy.anio)),
```
with:
```js
        getBalancePersonal(hoy.mes, hoy.anio), // Fase 6.3: liquidez siempre contra el bolsillo del que pregunta, sea cual sea el ámbito de la categoría
```

Everything downstream (`balance.ingresos`, `balance.gastos` at `views/brujula.html:224`) keeps working unchanged since `getBalancePersonal` still returns that shape. `getGastoCategoria(cat.id, ambito, ...)` (the `gastoMes`/`gastoSemana` inputs) is untouched — the ámbito still correctly scopes which category spend is being asked about; only the affordability ceiling changes source.

- [ ] **Step 2: Verify in the browser preview**

Open `#brujula` (Oráculo), select ámbito Hogar and a category with a limit, enter an amount. Confirm the response is no longer always "sin margen" — it should reflect real personal liquidity now.

- [ ] **Step 3: Commit**

```bash
git add views/brujula.html
git commit -m "$(cat <<'EOF'
fix(fase6.3): brujula.html — ambito hogar evalua contra el bolsillo personal

Bug detectado durante el diseno de Fase 6.3, fuera del encargo original:
calcularRango usa liquidez = ingresos-gastos-...; en ambito hogar leia de
getBalanceHogar, cuyos ingresos pasan a ser siempre 0 tras esta fase ->
liquidez=0 -> la Brujula respondia "no" a todo, para siempre, en silencio.
Ahora liquidez sale siempre del balance personal del que pregunta; el
ambito sigue filtrando que categoria/metas se consultan.
EOF
)"
```

---

## Task 18: `views/configuracion.html` — re-add the reparto toggle

**Files:**
- Modify: `views/configuracion.html` (inside `initHogarConfig`, replacing the `// El selector de reparto vuelve con la Fase 6.3...` comment)

The toggle was already pulled from this view pending this phase (comment found in place: `// El selector de reparto vuelve con la Fase 6.3, que redefine su semántica.`). This task adds it back with the new meaning: it no longer infers debt, it defines what "equal" means for the desequilibrio calculation.

- [ ] **Step 1: Insert the reparto control**

Find the line:
```js
        // El selector de reparto vuelve con la Fase 6.3, que redefine su semántica.
```
and, immediately after the per-member `aporte_esperado` block's `.join('')` and before the `'<div class="cfg-datos-separador"></div>' + '<p class="cfg-label">Presupuesto del hogar por categoría (S/)</p>' +` block, insert:
```js
          '<div class="cfg-datos-separador"></div>' +
          '<p class="cfg-label">Qué significa "igualar" en el desequilibrio de aportes</p>' +
          '<p class="hogar-card-sub" style="margin:0 0 8px">No es una deuda: define el objetivo contra el que se compara cuánto puso cada uno.</p>' +
          '<div class="cfg-reparto-toggle" role="group" aria-label="Modo de reparto">' +
            '<button type="button" class="btn btn-secondary btn-sm cfg-reparto-btn" data-modo="50_50">Mitad y mitad</button>' +
            '<button type="button" class="btn btn-secondary btn-sm cfg-reparto-btn" data-modo="proporcional">Proporcional al aporte esperado</button>' +
          '</div>' +
```

Then, in the same function, after the `.cfg-hogar-aporte-save` listener block, add:
```js
        var modoActual = hogar.reparto || '50_50';
        Array.prototype.forEach.call(body.querySelectorAll('.cfg-reparto-btn'), function (btn) {
          var activo = btn.getAttribute('data-modo') === modoActual;
          btn.classList.toggle('btn-primary', activo);
          btn.classList.toggle('btn-secondary', !activo);
          btn.setAttribute('aria-pressed', String(activo));
          btn.addEventListener('click', async function () {
            var modo = btn.getAttribute('data-modo');
            try { await setRepartoHogar(modo); mostrarToast('Reparto actualizado', 3000); await render(); }
            catch (e) { mostrarToast((e && e.message) || 'No se pudo cambiar el reparto', 4000); }
          });
        });
```

(The `insert immediately after` and `insert after the listener block` instructions require reading the surrounding ~15 lines in the editor before applying — the exact `.join('')` line and listener block boundaries were captured in exploration but re-verify against the live file before editing, since line numbers may have shifted slightly if Task 20's parallel background task already touched this section.)

- [ ] **Step 2: Add minimal CSS for the toggle** (near existing `.cfg-input-group` rules)

```css
  .cfg-reparto-toggle { display: flex; gap: var(--space-sm); flex-wrap: wrap; margin-bottom: var(--space-md); }
```

- [ ] **Step 3: Verify in the browser preview with 2 accounts**

Open `#configuracion`, scroll to the Hogar section. Confirm both reparto buttons render, the current mode is visually distinguished (`btn-primary`), clicking the other one calls `setRepartoHogar` and persists (reload confirms the new mode stays highlighted). Confirm `window.hogarState.hogar.reparto` updates (check via `hogar:changed` re-render, same pattern as the rest of this function).

- [ ] **Step 4: Commit**

```bash
git add views/configuracion.html
git commit -m "$(cat <<'EOF'
feat(fase6.3): configuracion.html — reparto toggle re-agregado, semantica nueva

Se habia retirado pendiente de esta fase. Ya no infiere deuda: define que
significa "igualar" para el desequilibrio de aportes (mitad y mitad vs.
proporcional al aporte esperado de cada miembro).
EOF
)"
```

---

## Task 19: `sw.js` — precache list + `SHELL_VERSION` bump

**Files:**
- Modify: `sw.js:15` (`SHELL_VERSION`)
- Modify: `sw.js:36-37` (precache list)

This is the last code task — do it once every prior task's browser verification has passed, right before the final end-to-end pass (Task 20).

- [ ] **Step 1: Update the precache list**

Replace:
```js
  { url: 'js/hogar-balance.js', revision: SHELL_VERSION },
  { url: 'js/hogar-aporte.js', revision: SHELL_VERSION },
```
with:
```js
  { url: 'js/hogar-desequilibrio.js', revision: SHELL_VERSION },
  { url: 'js/hogar-partes.js', revision: SHELL_VERSION },
  { url: 'js/hogar-aporte.js', revision: SHELL_VERSION },
```

- [ ] **Step 2: Bump `SHELL_VERSION`**

Replace:
```js
const SHELL_VERSION = 'v22';
```
with:
```js
const SHELL_VERSION = 'v23';
```

- [ ] **Step 3: Verify every view referencing the new pure modules loads them**

`grep -n "hogar-desequilibrio.js\|hogar-partes.js" index.html views/*.html` — confirm `js/hogar-desequilibrio.js` and `js/hogar-partes.js` are `<script>`-tagged wherever `js/hogar-balance.js` used to be (check `index.html` and any view that loads it directly, following the same pattern as the existing `js/hogar-aporte.js` include).

- [ ] **Step 4: Commit**

```bash
git add sw.js index.html
git commit -m "chore(fase6.3): sw.js precache hogar-desequilibrio.js + hogar-partes.js, bump SHELL_VERSION v23"
```

---

## Task 20: End-to-end verification and push

**Files:** none (verification only)

- [ ] **Step 1: Run the full pure-function test suite**

Run: `node --test test/*.test.mjs`
Expected: PASS, 0 failures, including the new `hogar-desequilibrio.test.mjs`, `hogar-partes.test.mjs`, and the rewritten `hogar-aporte.test.mjs`. Confirm `test/hogar-balance.test.mjs` is gone (no longer listed).

- [ ] **Step 2: Full holistic review**

Re-read every file this plan touched against the spec's "Ondas expansivas" table (`docs/superpowers/specs/2026-07-14-fase6-3-economia-hogar-design.md`) — confirm every row has a corresponding completed task.

- [ ] **Step 3: 2-account manual pass in the browser preview**

With both real accounts:
1. Account A registers a shared expense split 60/40 with account B (Task 11's editor). Confirm on account B's `#historial` the "⚭ compartido" badge appears on both halves and neither is editable.
2. Account B registers a single-payer shared expense (100% to self). Confirm it appears as a normal, editable transaction with no split badge.
3. On `#hogar` for both accounts, confirm the desequilibrio card now shows a real number reflecting the 60/40 split against the current reparto mode.
4. Account A registers an ahorro-hogar contribution via the normal ahorro flow (`ambito=hogar`, `tipo=ahorro`). Confirm `#dashboard`'s "Ahorro del hogar" figure increases and account A's own saldo personal decreases by the same amount.
5. Delete the split expense from Task 20.1 via the historial modal; confirm both halves disappear for both accounts.
6. On `#configuracion`, toggle reparto to `proporcional`, confirm the desequilibrio number recalculates using `aporte_esperado`.
7. Do **not** click "Salir / disolver hogar" against production data — the dissolution preview text is enough to confirm correctness (verified in Task 13, Step 7).

- [ ] **Step 4: Push to `v2`**

```bash
git push origin v2
```

- [ ] **Step 5: Verify the live deploy**

```bash
curl -sL https://nestra-8rl.pages.dev/sw.js | grep SHELL_VERSION
```
Expected: `const SHELL_VERSION = 'v23';`. Reload/reopen the PWA on the phone to confirm the new shell loads (per the project's phone-preview memory: NetworkFirst views update on reload; the shell may need a full app close/reopen).

- [ ] **Step 6: Clean up the backup tables**

Once the migration is confirmed stable in production (a few days of real use, at the user's discretion — do not do this automatically as part of this task):
```sql
drop table if exists public._backup_fase63_transacciones;
drop table if exists public._backup_fase63_aportes_meta;
```
This step is informational only — leave the backup tables in place until the user explicitly says to drop them.

---

## Self-Review

**Spec coverage:** every row of the spec's "Decisiones tomadas" table (10 rows) and "Ondas expansivas" table (9 rows) maps to a task above — desequilibrio-solo-gastos (Task 1), escape hatch degradado (Task 13), filas hermanas (Task 5/11), RPC security definer (Task 5), split siempre visible (Task 11), histórico completo (Task 1), `aporte_esperado` en proporcional (Task 1/13/14/18), disolución reporta aparte (Task 5), fila huérfana (Task 5), Brújula (Task 17), dashboard/hogar/graficos/resumen/configuracion/db.js/SQL (Tasks 5, 8-19).

**Placeholder scan:** no TBD/TODO, no "add appropriate handling" — every step shows the literal code to write. The two steps flagged as needing a live re-check before editing (Task 11 Step 5, Task 18 Step 1) are marked as such explicitly because their exact line boundaries depend on file state at execution time, not because the content is unspecified — the code to insert is fully written out in both cases.

**Type/name consistency:** `calcularDesequilibrioHogar` return shape (`brecha`, `debeAportarMas`, `yaAportoDeMas`, `pagoA`, `pagoB`) is identical across Task 1 (definition), Task 13 (`hogar.html`), and Task 14 (`dashboard.html`). `registrarGastoHogar`/`registrar_gasto_hogar` naming matches between Task 5 (SQL), Task 10 (`db.js`/`sync.js`), and Task 11 (`transaccion.html`). `grupo_id` is used consistently from Task 5 (column rename) through Tasks 10-12 — no lingering `aporte_id` reference outside of the historical `_backup_fase63_*` tables and old commit messages.
