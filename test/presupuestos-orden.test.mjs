import assert from 'node:assert';
import { test } from 'node:test';
import { ordenarPresupuestos } from '../js/presupuestos-orden.js';

const fila = (id, gastado, limite, esHogar = false) => ({ id, nombre: id, gastado, limite, esHogar });

// gastado/limite: comida 0.9, transporte 0.25, ocio 0.5
const FILAS = [
  fila('comida', 90, 100),
  fila('transporte', 50, 200),
  fila('ocio', 25, 50),
];

test('criterio limite, desc: primero el más cerca de reventar', () => {
  const out = ordenarPresupuestos(FILAS, 'limite', 'desc');
  assert.deepStrictEqual(out.map((f) => f.id), ['comida', 'ocio', 'transporte']);
});

test('criterio limite, asc: invierte', () => {
  const out = ordenarPresupuestos(FILAS, 'limite', 'asc');
  assert.deepStrictEqual(out.map((f) => f.id), ['transporte', 'ocio', 'comida']);
});

test('criterio gasto, desc: primero el que más gastó en monto', () => {
  const out = ordenarPresupuestos(FILAS, 'gasto', 'desc');
  assert.deepStrictEqual(out.map((f) => f.id), ['comida', 'transporte', 'ocio']);
});

test('criterio gasto, asc: invierte', () => {
  const out = ordenarPresupuestos(FILAS, 'gasto', 'asc');
  assert.deepStrictEqual(out.map((f) => f.id), ['ocio', 'transporte', 'comida']);
});

test('los dos criterios NO dan el mismo orden (transporte gastó más que ocio pero está más lejos del límite)', () => {
  const porLimite = ordenarPresupuestos(FILAS, 'limite', 'desc').map((f) => f.id);
  const porGasto = ordenarPresupuestos(FILAS, 'gasto', 'desc').map((f) => f.id);
  assert.notDeepStrictEqual(porLimite, porGasto);
});

test('no muta el array de entrada', () => {
  const original = FILAS.map((f) => f.id);
  ordenarPresupuestos(FILAS, 'gasto', 'desc');
  assert.deepStrictEqual(FILAS.map((f) => f.id), original);
});

test('limite 0 no rompe ni produce NaN (no debe asumir el filtro > 0 del llamador)', () => {
  const out = ordenarPresupuestos([fila('cero', 10, 0), fila('comida', 90, 100)], 'limite', 'desc');
  assert.strictEqual(out.length, 2);
  assert.ok(out.every((f) => f.id));
});

test('limite 0 con gasto se trata como excedido: va antes que uno al 90%', () => {
  const out = ordenarPresupuestos([fila('comida', 90, 100), fila('cero', 10, 0)], 'limite', 'desc');
  assert.strictEqual(out[0].id, 'cero');
});

test('limite 0 sin gasto no es excedido: va al final', () => {
  const out = ordenarPresupuestos([fila('comida', 90, 100), fila('cero', 0, 0)], 'limite', 'desc');
  assert.strictEqual(out[0].id, 'comida');
});

test('empate: mantiene el orden relativo de entrada (estable)', () => {
  const out = ordenarPresupuestos([fila('a', 50, 100), fila('b', 50, 100)], 'limite', 'desc');
  assert.deepStrictEqual(out.map((f) => f.id), ['a', 'b']);
});

test('mezcla personal y hogar: el orden manda, no el agrupado', () => {
  const out = ordenarPresupuestos(
    [fila('personal-bajo', 10, 100), fila('hogar-alto', 95, 100, true)], 'limite', 'desc');
  assert.deepStrictEqual(out.map((f) => f.id), ['hogar-alto', 'personal-bajo']);
});

test('criterio desconocido cae a limite/desc', () => {
  const out = ordenarPresupuestos(FILAS, 'inventado', 'desc');
  assert.deepStrictEqual(out.map((f) => f.id), ['comida', 'ocio', 'transporte']);
});

test('lista vacía → lista vacía', () => {
  assert.deepStrictEqual(ordenarPresupuestos([], 'limite', 'desc'), []);
});
