// test/hogar-aporte.test.mjs
import assert from 'node:assert';
import { test } from 'node:test';
import { aporteRealPorMiembro } from '../js/hogar-aporte.js';

const H = 'hogar1';
function tx(user_id, tipo, monto, hogar_id = H, fecha = '2026-06-10') {
  return { user_id, tipo, monto, hogar_id, fecha };
}
const RANGO = { desde: '2026-06-01', hasta: '2026-06-30' };

test('suma ingresos hogar + gastos hogar del miembro en el rango', () => {
  const txs = [
    tx('A', 'ingreso', 500), tx('A', 'gasto', 100),
    tx('B', 'gasto', 40),
  ];
  const r = aporteRealPorMiembro(txs, 'A', RANGO);
  assert.strictEqual(r, 600);
});

test('ignora filas de otro miembro', () => {
  const txs = [tx('A', 'ingreso', 500), tx('B', 'ingreso', 999)];
  assert.strictEqual(aporteRealPorMiembro(txs, 'A', RANGO), 500);
});

test('ignora filas sin hogar_id (personales)', () => {
  const txs = [tx('A', 'gasto', 100, null), tx('A', 'gasto', 50)];
  assert.strictEqual(aporteRealPorMiembro(txs, 'A', RANGO), 50);
});

test('ignora ahorro y fechas fuera de rango', () => {
  const txs = [
    tx('A', 'ahorro', 300), tx('A', 'gasto', 70, H, '2026-05-30'),
    tx('A', 'gasto', 20, H, '2026-06-15'),
  ];
  assert.strictEqual(aporteRealPorMiembro(txs, 'A', RANGO), 20);
});

test('sin filas → 0', () => {
  assert.strictEqual(aporteRealPorMiembro([], 'A', RANGO), 0);
});
