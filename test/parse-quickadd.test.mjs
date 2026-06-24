// test/parse-quickadd.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from '../js/parse-quickadd.js';

const KW = { uber:'Transporte', taxi:'Transporte', almuerzo:'Comida', cine:'Ocio' };
const HOY = '2026-06-24';
const base = (text, autocat={}) => parseQuickAdd(text, { hoy: HOY, keywords: KW, autocat });

test('monto simple + descripción', () => {
  const r = base('Uber 15');
  assert.equal(r.monto, 15);
  assert.equal(r.descripcion, 'Uber');
  assert.equal(r.categoria_keyword, 'Transporte');
  assert.equal(r.fecha, HOY);
});

test('decimal con punto y S/', () => {
  const r = base('S/12.50 almuerzo');
  assert.equal(r.monto, 12.5);
  assert.equal(r.categoria_keyword, 'Comida');
  assert.equal(r.descripcion, 'almuerzo');
});

test('decimal con coma', () => {
  assert.equal(base('taxi S/ 7,50 anteayer').monto, 7.5);
});

test('fecha relativa ayer', () => {
  assert.equal(base('15 taxi ayer').fecha, '2026-06-23');
});

test('fecha relativa anteayer', () => {
  assert.equal(base('taxi S/ 7,50 anteayer').fecha, '2026-06-22');
});

test('multi-palabra y espacios colapsados', () => {
  const r = base('  café   con   leche 8 ');
  assert.equal(r.monto, 8);
  assert.equal(r.descripcion, 'café con leche');
});

test('varios números sin S/ → el mayor', () => {
  assert.equal(base('cine 2 entradas 40').monto, 40);
});

test('con S/ gana el número de S/ aunque haya otro mayor', () => {
  assert.equal(base('combo 100 puntos S/ 30').monto, 30);
});

test('sin monto → monto null (parse fallido)', () => {
  assert.equal(base('recarga').monto, null);
});

test('categoría desde autocat tiene prioridad sobre keyword', () => {
  const r = base('uber 10', { uber: 'cat-uuid-1' });
  assert.equal(r.categoria_id, 'cat-uuid-1');
});

test('sin categoría inferible → categoria_id null', () => {
  const r = base('chuches 5');
  assert.equal(r.categoria_id, null);
  assert.equal(r.categoria_keyword, null);
});

test('nunca lanza con entrada vacía/null', () => {
  assert.equal(parseQuickAdd('', { hoy: HOY }).monto, null);
  assert.equal(parseQuickAdd(null, { hoy: HOY }).monto, null);
});
