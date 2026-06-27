// test/autocat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDesc, tokenize, scoreCategorias, matchCategoria, SEED } from '../js/autocat.js';

test('normalizeDesc quita tildes, baja caja, colapsa espacios', () => {
  assert.equal(normalizeDesc('  Café  CON Leche '), 'cafe con leche');
});

test('tokenize: stopwords fuera + singular simple', () => {
  assert.deepEqual(tokenize('Llantas para bicicleta'), ['llanta', 'bicicleta']);
});

test('tokenize: numérico suelto y len<2 fuera', () => {
  assert.deepEqual(tokenize('uber 15 a'), ['uber']);
});

test('tokenize: meses→mes (es,len>4); mes intacto', () => {
  assert.deepEqual(tokenize('meses'), ['mes']);
  assert.deepEqual(tokenize('mes'), ['mes']);
});

test('scoreCategorias: token en nombre de categoría custom → +2', () => {
  const cats = [{ id: 'c1', nombre: 'Partes de bicicleta' }, { id: 'c2', nombre: 'Comida' }];
  const s = scoreCategorias(['bicicleta'], { categorias: cats });
  assert.equal(s.c1, 2);
  assert.equal(s.c2 || 0, 0);
});

test('scoreCategorias: aprendido domina (3*freq)', () => {
  const cats = [{ id: 'c1', nombre: 'Otros' }];
  const s = scoreCategorias(['uber'], { learned: { uber: { c1: 3 } }, categorias: cats });
  assert.equal(s.c1, 9);
});

test('scoreCategorias: semilla +1 resuelta por nombre', () => {
  const cats = [{ id: 'cT', nombre: 'Transporte' }];
  const s = scoreCategorias(['uber'], { categorias: cats, seed: { uber: 'Transporte' } });
  assert.equal(s.cT, 1);
});

test('matchCategoria: máximo único sobre umbral → id', () => {
  const cats = [{ id: 'cT', nombre: 'Transporte' }, { id: 'cC', nombre: 'Comida' }];
  const id = matchCategoria(['uber'], { categorias: cats, seed: { uber: 'Transporte' } });
  assert.equal(id, 'cT');
});

test('matchCategoria: empate → null', () => {
  const cats = [{ id: 'a', nombre: 'Alfa' }, { id: 'b', nombre: 'Beta' }];
  const ctx = { learned: { x: { a: 1, b: 1 } }, categorias: cats };
  assert.equal(matchCategoria(['x'], ctx), null);
});

test('matchCategoria: sin señal → null', () => {
  assert.equal(matchCategoria(['zzz'], { categorias: [{ id: 'c1', nombre: 'Comida' }] }), null);
});

test('SEED incluye semillas es-PE', () => {
  assert.equal(SEED.uber, 'Transporte');
  assert.equal(SEED.almuerzo, 'Comida');
});
