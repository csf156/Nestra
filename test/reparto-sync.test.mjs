import assert from 'node:assert';
import { test } from 'node:test';
import { esAhorroRepartible } from '../js/reparto-sync.js';

test('un ahorro normal es repartible', () => {
  assert.strictEqual(esAhorroRepartible({ tipo: 'ahorro' }), true);
  assert.strictEqual(esAhorroRepartible({ tipo: 'ahorro', es_aporte_directo: false }), true);
  // Shape real de una fila de transacciones: la columna sin setear llega como
  // null, no ausente. Fija el comportamiento contra un futuro cambio a
  // `=== false` que rompería este caso en silencio.
  assert.strictEqual(esAhorroRepartible({ tipo: 'ahorro', es_aporte_directo: null }), true);
});
test('un aporte directo NO se reparte (ya se asignó a mano)', () => {
  assert.strictEqual(esAhorroRepartible({ tipo: 'ahorro', es_aporte_directo: true }), false);
});
test('gasto e ingreso no se reparten', () => {
  assert.strictEqual(esAhorroRepartible({ tipo: 'gasto' }), false);
  assert.strictEqual(esAhorroRepartible({ tipo: 'ingreso' }), false);
});
test('null / undefined / sin tipo no rompe', () => {
  assert.strictEqual(esAhorroRepartible(null), false);
  assert.strictEqual(esAhorroRepartible(undefined), false);
  assert.strictEqual(esAhorroRepartible({}), false);
});
