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
