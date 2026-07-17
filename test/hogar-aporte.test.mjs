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
