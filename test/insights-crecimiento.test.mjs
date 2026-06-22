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
  for (const f of ['2026-04-04', '2026-04-14', '2026-05-04', '2026-05-14', '2026-05-19', '2026-05-21']) txs.push(gasto('c3', 'personal', 100 / 3, f, 'C'));
  for (const f of ['2026-06-03', '2026-06-09', '2026-06-16']) txs.push(gasto('c3', 'personal', 130 / 3, f, 'C'));
  const out = detectCrecimiento(txs, { hoy: HOY });
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].meta.categoria_id, 'c2'); // +100% primero
  assert.strictEqual(out[1].meta.categoria_id, 'c1'); // +60% segundo
});
