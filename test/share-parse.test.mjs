import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSharedMonto } from '../js/share-parse.js';

test('extrae monto con prefijo S/ y decimales', () => {
  assert.equal(parseSharedMonto('Te Yapearon S/ 50.00 de Juan Perez'), 50);
});

test('extrae monto con separador de miles', () => {
  assert.equal(parseSharedMonto('Pago de 1,250.50 soles'), 1250.5);
});

test('coma como separador decimal', () => {
  assert.equal(parseSharedMonto('Almuerzo 25,90'), 25.9);
});

test('numero entero suelto', () => {
  assert.equal(parseSharedMonto('150'), 150);
});

test('S/ pegado al numero', () => {
  assert.equal(parseSharedMonto('Cobro S/8'), 8);
});

test('texto sin monto devuelve null', () => {
  assert.equal(parseSharedMonto('captura sin importe'), null);
});

test('entrada nula devuelve null', () => {
  assert.equal(parseSharedMonto(null), null);
});

test('cero o negativo no es valido', () => {
  assert.equal(parseSharedMonto('S/ 0.00'), null);
});
