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
