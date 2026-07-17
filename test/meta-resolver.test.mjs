import assert from 'node:assert';
import { test } from 'node:test';
import { resolverMeta } from '../js/meta-resolver.js';

// Nombres reales de la base: llevan emoji y tildes a propósito.
const METAS = [
  { id: 'm1', nombre: 'Alquiler 🏠' },
  { id: 'm2', nombre: 'Máquina de afeitar' },
  { id: 'm3', nombre: 'Fondo de emergencia' },
];

test('casa ignorando el emoji', () => {
  assert.deepStrictEqual(resolverMeta('alquiler', METAS), { meta_id: 'm1' });
});

test('casa ignorando tildes y stopwords', () => {
  assert.deepStrictEqual(resolverMeta('maquina', METAS), { meta_id: 'm2' });
  assert.deepStrictEqual(resolverMeta('máquina de afeitar', METAS), { meta_id: 'm2' });
});

test('sin match → error, sin meta_id', () => {
  const r = resolverMeta('viaje a japon', METAS);
  assert.strictEqual(r.error, 'no-encontrada');
  assert.strictEqual(r.meta_id, undefined);
});

test('ambigua → lista las candidatas', () => {
  const dos = [{ id: 'a', nombre: 'Viaje a Cusco' }, { id: 'b', nombre: 'Viaje a Lima' }];
  const r = resolverMeta('viaje', dos);
  assert.strictEqual(r.error, 'ambigua');
  assert.deepStrictEqual(r.candidatas, ['Viaje a Cusco', 'Viaje a Lima']);
});

test('mas tokens desambiguan', () => {
  const dos = [{ id: 'a', nombre: 'Viaje a Cusco' }, { id: 'b', nombre: 'Viaje a Lima' }];
  assert.deepStrictEqual(resolverMeta('viaje cusco', dos), { meta_id: 'a' });
});

test('nombre vacio → error', () => {
  assert.strictEqual(resolverMeta('', METAS).error, 'sin-nombre');
  assert.strictEqual(resolverMeta(null, METAS).error, 'sin-nombre');
});

test('lista de metas vacia → no-encontrada', () => {
  assert.strictEqual(resolverMeta('alquiler', []).error, 'no-encontrada');
});

// "casa" NO debe casar con "Máquina" por ser subcadena.
test('NO casa por subcadena accidental', () => {
  assert.strictEqual(resolverMeta('casa', METAS).error, 'no-encontrada');
});
