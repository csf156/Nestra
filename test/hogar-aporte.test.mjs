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
