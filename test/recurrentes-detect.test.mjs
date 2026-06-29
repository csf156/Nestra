import assert from 'node:assert';
import { test } from 'node:test';
import { detectarRecurrentes } from '../js/recurrentes-detect.js';

const HOY = new Date(2026, 5, 29); // 2026-06-29

function tx(monto, fecha, categoria_id = 'c1', nota = 'Netflix', tipo = 'gasto') {
  return { id: fecha + monto, tipo, monto, categoria_id, fecha, nota };
}

test('dos cargos mensuales iguales → candidato', () => {
  const txs = [tx(44.9, '2026-04-05'), tx(44.9, '2026-05-05'), tx(44.9, '2026-06-05')];
  const out = detectarRecurrentes(txs, [], HOY);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].categoria_id, 'c1');
  assert.strictEqual(out[0].frecuencia, 'mensual');
  assert.ok(out[0].monto >= 44 && out[0].monto <= 46);
  assert.ok(out[0].ocurrencias >= 2);
});

test('una sola ocurrencia → no candidato', () => {
  assert.strictEqual(detectarRecurrentes([tx(44.9, '2026-06-05')], [], HOY).length, 0);
});

test('montos dispares (no mensual estable) → no candidato', () => {
  const txs = [tx(10, '2026-04-05'), tx(80, '2026-05-05')];
  assert.strictEqual(detectarRecurrentes(txs, [], HOY).length, 0);
});

test('tolerancia ±5%: 100 y 103 se agrupan', () => {
  const txs = [tx(100, '2026-04-10', 'c2'), tx(103, '2026-05-10', 'c2')];
  assert.strictEqual(detectarRecurrentes(txs, [], HOY).length, 1);
});

test('excluye los ya registrados (mismo categoria + monto±tol)', () => {
  const txs = [tx(44.9, '2026-04-05'), tx(44.9, '2026-05-05')];
  const existentes = [{ categoria_id: 'c1', monto: 45, frecuencia: 'mensual' }];
  assert.strictEqual(detectarRecurrentes(txs, existentes, HOY).length, 0);
});

test('separación semanal (~7 días) no cuenta como mensual', () => {
  const txs = [tx(20, '2026-06-01'), tx(20, '2026-06-08'), tx(20, '2026-06-15')];
  assert.strictEqual(detectarRecurrentes(txs, [], HOY).length, 0);
});
