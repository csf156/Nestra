import assert from 'node:assert';
import { test } from 'node:test';
import { estadoPresupuesto } from '../js/presupuestos.js';

test('límite inválido (0, negativo, NaN) → null', () => {
  assert.strictEqual(estadoPresupuesto(50, 0), null);
  assert.strictEqual(estadoPresupuesto(50, -10), null);
  assert.strictEqual(estadoPresupuesto(50, NaN), null);
  assert.strictEqual(estadoPresupuesto(50, null), null);
});

test('gasto 0 → verde, 0%', () => {
  const e = estadoPresupuesto(0, 100);
  assert.strictEqual(e.color, 'verde');
  assert.strictEqual(e.pctReal, 0);
  assert.strictEqual(e.ancho, 0);
  assert.strictEqual(e.superado, false);
});

test('justo por debajo del 70% → verde', () => {
  const e = estadoPresupuesto(69, 100);
  assert.strictEqual(e.color, 'verde');
  assert.strictEqual(e.pctReal, 69);
});

test('exactamente 70% → ámbar', () => {
  const e = estadoPresupuesto(70, 100);
  assert.strictEqual(e.color, 'ambar');
  assert.strictEqual(e.superado, false);
});

test('exactamente 100% → ámbar, no superado', () => {
  const e = estadoPresupuesto(100, 100);
  assert.strictEqual(e.color, 'ambar');
  assert.strictEqual(e.superado, false);
  assert.strictEqual(e.ancho, 100);
});

test('por encima del 100% → rojo + superado, pctReal sin tope, ancho acotado', () => {
  const e = estadoPresupuesto(120, 100);
  assert.strictEqual(e.color, 'rojo');
  assert.strictEqual(e.superado, true);
  assert.strictEqual(e.pctReal, 120);
  assert.strictEqual(e.ancho, 100);
});

test('redondeo de pctReal', () => {
  assert.strictEqual(estadoPresupuesto(100, 300).pctReal, 33);
});
