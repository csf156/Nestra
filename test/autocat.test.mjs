// test/autocat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDesc, matchAutocat, KEYWORDS } from '../js/autocat.js';

test('normalizeDesc quita tildes, baja caja, colapsa espacios', () => {
  assert.equal(normalizeDesc('  Café  CON Leche '), 'cafe con leche');
});

test('match exacto', () => {
  assert.equal(matchAutocat('uber', { uber: 'c1' }), 'c1');
});

test('match por substring (clave del dict dentro de la desc)', () => {
  assert.equal(matchAutocat('uber eats', { uber: 'c1' }), 'c1');
});

test('sin match → null', () => {
  assert.equal(matchAutocat('chuches', { uber: 'c1' }), null);
});

test('exacto gana sobre substring', () => {
  assert.equal(matchAutocat('taxi', { taxi: 'cT', 'taxi aeropuerto': 'cA' }), 'cT');
});

test('KEYWORDS incluye categorías es-PE base', () => {
  assert.equal(KEYWORDS.uber, 'Transporte');
  assert.equal(KEYWORDS.almuerzo, 'Comida');
});
