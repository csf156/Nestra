// test/parse-quickadd.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from '../js/parse-quickadd.js';

const HOY = '2026-06-24';
const CATS = [{ id: 'cT', nombre: 'Transporte' }, { id: 'cC', nombre: 'Comida' }, { id: 'cB', nombre: 'Partes de bicicleta' }];
const CTX = { categorias: CATS, seed: { uber: 'Transporte', taxi: 'Transporte', almuerzo: 'Comida' } };
const p = (text, ctx = CTX) => parseQuickAdd(text, { hoy: HOY, ctx });

test('gasto/personal por defecto + monto + categoría inferida', () => {
  const r = p('Uber 15');
  assert.equal(r.tipo, 'gasto');
  assert.equal(r.ambito, 'personal');
  assert.equal(r.monto, 15);
  assert.equal(r.categoria_id, 'cT');
  assert.equal(r.descripcion, 'Uber');
  assert.equal(r.fecha, HOY);
});

test('decimal con S/ + categoría', () => {
  const r = p('almuerzo S/12.50');
  assert.equal(r.monto, 12.5);
  assert.equal(r.categoria_id, 'cC');
});

test('ahorro hogar: tipo+ámbito, sin categoría', () => {
  const r = p('ahorro hogar 50');
  assert.equal(r.tipo, 'ahorro');
  assert.equal(r.ambito, 'hogar');
  assert.equal(r.monto, 50);
  assert.equal(r.categoria_id, null);
  assert.equal(r.descripcion, null);
});

test('ingreso con descripción', () => {
  const r = p('ingreso trabajo 100');
  assert.equal(r.tipo, 'ingreso');
  assert.equal(r.ambito, 'personal');
  assert.equal(r.monto, 100);
  assert.equal(r.descripcion, 'trabajo');
});

test('categoría custom por nombre, sin historial', () => {
  const r = p('llantas para bicicleta 100');
  assert.equal(r.categoria_id, 'cB');
});

test('keyword de tipo/ámbito se quita de la descripción', () => {
  const r = p('ahorro hogar viaje 200');
  assert.equal(r.descripcion, 'viaje');
});

test('sin categoría inferible → null', () => {
  assert.equal(p('chuches 5').categoria_id, null);
});

test('fecha relativa ayer', () => {
  assert.equal(p('15 taxi ayer').fecha, '2026-06-23');
});

test('sin monto → monto null', () => {
  assert.equal(p('recarga').monto, null);
});

test('nunca lanza con vacío/null', () => {
  assert.equal(parseQuickAdd('', { hoy: HOY }).monto, null);
  assert.equal(parseQuickAdd(null, { hoy: HOY }).monto, null);
});
