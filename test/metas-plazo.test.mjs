// test/metas-plazo.test.mjs
// Lógica pura del rescate de metas vencidas. `hoy` se inyecta siempre: nada
// acá puede depender del reloj del proceso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mensajeAliento, nuevaFechaSugerida } from '../js/metas-plazo.js';

test('mensajeAliento: con avance, reconoce lo logrado', () => {
  const m = mensajeAliento({ monto_actual: 400, monto_objetivo: 650 });
  assert.match(m, /62%/);
  assert.match(m, /S\/ ?250|250/);
});

test('mensajeAliento: sin avance, no felicita en falso', () => {
  const m = mensajeAliento({ monto_actual: 0, monto_objetivo: 650 });
  assert.doesNotMatch(m, /0%/);
  assert.ok(m.length > 0);
});

test('mensajeAliento: sin objetivo, mensaje genérico sin NaN ni Infinity', () => {
  const m = mensajeAliento({ monto_actual: 100, monto_objetivo: null });
  assert.doesNotMatch(m, /NaN|Infinity/);
  assert.ok(m.length > 0);
});

test('nuevaFechaSugerida: un mes desde hoy, no desde el límite viejo', () => {
  // La meta venció hace rato: reprogramar sobre la fecha vieja daría otra
  // fecha ya pasada.
  assert.equal(nuevaFechaSugerida('2026-07-11', '2026-09-01'), '2026-10-01');
});

test('nuevaFechaSugerida: cruce de año', () => {
  assert.equal(nuevaFechaSugerida('2026-11-30', '2026-12-15'), '2027-01-15');
});

test('nuevaFechaSugerida: día 31 en un mes que no lo tiene → último día real', () => {
  assert.equal(nuevaFechaSugerida('2026-01-31', '2026-01-31'), '2026-02-28');
});

test('nuevaFechaSugerida: sin fecha de hoy válida → null', () => {
  assert.equal(nuevaFechaSugerida('2026-07-11', ''), null);
});
