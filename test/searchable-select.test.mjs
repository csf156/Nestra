// test/searchable-select.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterOptions } from '../js/searchable-select.js';

const OPTS = [
  { value: '1', text: 'Comida' },
  { value: '2', text: 'Transporte' },
  { value: '3', text: 'Café y antojos' },
];

test('filtra por substring', () => {
  assert.deepEqual(filterOptions(OPTS, 'tra').map((o) => o.value), ['2']);
});
test('match sin tildes (cafe → Café)', () => {
  assert.deepEqual(filterOptions(OPTS, 'cafe').map((o) => o.value), ['3']);
});
test('substring en medio', () => {
  assert.deepEqual(filterOptions(OPTS, 'porte').map((o) => o.value), ['2']);
});
test('query vacío → todas, orden preservado', () => {
  assert.deepEqual(filterOptions(OPTS, '').map((o) => o.value), ['1', '2', '3']);
});
test('sin coincidencias → []', () => {
  assert.deepEqual(filterOptions(OPTS, 'zzz'), []);
});
test('no lanza con entradas raras', () => {
  assert.deepEqual(filterOptions([], 'x'), []);
  assert.deepEqual(filterOptions(OPTS, null).length, 3);
});
