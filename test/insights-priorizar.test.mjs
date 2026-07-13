import assert from 'node:assert';
import { test } from 'node:test';
import { priorizar, generarInsights } from '../js/insights.js';

test('ordena por score desc (pesoTipo * (1+magnitud))', () => {
  const insights = [
    { id: 'i', tipo: 'info', meta: { magnitud: 0.9 } }, // 1 * 1.9 = 1.9
    { id: 'w', tipo: 'warn', meta: { magnitud: 0.1 } }, // 2 * 1.1 = 2.2
    { id: 'g', tipo: 'good', meta: { magnitud: 0 } },   // 1.5 * 1 = 1.5
  ];
  const out = priorizar(insights, {});
  assert.deepStrictEqual(out.map((x) => x.id), ['w', 'i', 'g']);
});

test('capa a 6 cards', () => {
  const insights = Array.from({ length: 10 }, (_, n) => ({ id: 'x' + n, tipo: 'info', meta: { magnitud: 0 } }));
  assert.strictEqual(priorizar(insights, {}).length, 6);
});

test('magnitud ausente cuenta como 0', () => {
  const out = priorizar([{ id: 'a', tipo: 'warn', meta: {} }], {});
  assert.strictEqual(out[0].score, 2);
});

test('generarInsights combina detectores y nunca lanza con datos vacíos', () => {
  const out = generarInsights({ transacciones: [], categorias: [], metas: [], hoy: new Date(2026, 5, 21) });
  assert.ok(Array.isArray(out));
  assert.strictEqual(out.length, 0);
});

test('generarInsights produce insights reales con datos sintéticos', () => {
  const HOY = new Date(2026, 5, 21);
  const txs = [];
  for (const f of ['2026-04-01', '2026-04-15', '2026-05-01', '2026-05-10', '2026-05-15', '2026-05-20']) {
    txs.push({ tipo: 'gasto', ambito: 'personal', categoria_id: 'c1', monto: 50, fecha: f, categorias: { nombre: 'Delivery' } });
  }
  for (const f of ['2026-05-25', '2026-06-05', '2026-06-12', '2026-06-18']) {
    txs.push({ tipo: 'gasto', ambito: 'personal', categoria_id: 'c1', monto: 60, fecha: f, categorias: { nombre: 'Delivery' } });
  }
  const out = generarInsights({ transacciones: txs, categorias: [], metas: [], hoy: HOY });
  assert.ok(out.length >= 1);
  assert.ok(out.some((i) => i.id.startsWith('crecimiento:')));
});
