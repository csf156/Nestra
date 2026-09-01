// test/autocat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDesc, tokenize, scoreCategorias, matchCategoria, mergeLearned, SEED } from '../js/autocat.js';

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

test('mergeLearned: suma entradas nuevas al mapa vacío', () => {
  const out = mergeLearned({}, [{ texto: 'LA PANERA CAFE', categoria_id: 'cat-comida', peso: 2 }]);
  // "la"/"cafe"/"panera" → tokens; "la" es stopword y se cae.
  assert.equal(out.panera['cat-comida'], 2);
  assert.equal(out.cafe['cat-comida'], 2);
  assert.equal(out.la, undefined);
});

test('mergeLearned: acumula sobre lo ya aprendido, no lo pisa', () => {
  const previo = { panera: { 'cat-comida': 5 } };
  const out = mergeLearned(previo, [{ texto: 'PANERA', categoria_id: 'cat-comida', peso: 2 }]);
  assert.equal(out.panera['cat-comida'], 7);
});

test('mergeLearned: lo aprendido en el navegador pesa más que lo del servidor', () => {
  // El mapa local viene de confirmaciones explícitas del usuario en ESTE
  // navegador; el del servidor es reconstruido. Ante empate manda el local.
  const previo = { rappi: { 'cat-a': 3 } };
  const out = mergeLearned(previo, [{ texto: 'RAPPI', categoria_id: 'cat-b', peso: 1 }]);
  assert.ok(out.rappi['cat-a'] > out.rappi['cat-b']);
});

test('mergeLearned: entradas inservibles se ignoran sin romper', () => {
  const out = mergeLearned({}, [
    { texto: '', categoria_id: 'cat-a', peso: 1 },
    { texto: 'ALGO', categoria_id: null, peso: 1 },
    null,
  ]);
  assert.deepEqual(out, {});
});

test('mergeLearned: no muta el mapa recibido', () => {
  const previo = { panera: { 'cat-comida': 5 } };
  mergeLearned(previo, [{ texto: 'PANERA', categoria_id: 'cat-comida', peso: 2 }]);
  assert.equal(previo.panera['cat-comida'], 5);
});
