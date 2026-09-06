import test from 'node:test';
import assert from 'node:assert/strict';
import { partirHash, subvistaValida } from '../js/config-rutas.js';

test('partirHash: hash vacío da base y sub vacíos', () => {
  assert.deepEqual(partirHash(''), { base: '', sub: '' });
});

test('partirHash: null da base y sub vacíos', () => {
  assert.deepEqual(partirHash(null), { base: '', sub: '' });
});

test('partirHash: solo espacios da base y sub vacíos', () => {
  assert.deepEqual(partirHash('   '), { base: '', sub: '' });
});

test('partirHash: hash sin barra da solo base', () => {
  assert.deepEqual(partirHash('dashboard'), { base: 'dashboard', sub: '' });
});

test('partirHash: hash con barra separa base y sub', () => {
  assert.deepEqual(partirHash('configuracion/categorias'), { base: 'configuracion', sub: 'categorias' });
});

test('partirHash: solo importa el primer slash, el resto se ignora', () => {
  assert.deepEqual(partirHash('configuracion/categorias/extra'), { base: 'configuracion', sub: 'categorias' });
});

test('subvistaValida: reconoce las 6 subvistas válidas', () => {
  ['dinero', 'categorias', 'automatismos', 'hogar', 'apariencia', 'cuenta'].forEach((s) => {
    assert.equal(subvistaValida(s), true, s);
  });
});

test('subvistaValida: rechaza nombres inválidos', () => {
  assert.equal(subvistaValida('inventada'), false);
  assert.equal(subvistaValida(''), false);
  assert.equal(subvistaValida(undefined), false);
});
