// test/revisar-lote.test.mjs
// Lógica pura del modo lote de #revisar. Sin DOM: las funciones reciben las
// filas de ingest_pendientes tal como las devuelve getIngestPendientes().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loteable, resumenLote, notaDePendiente, aliasDe } from '../js/revisar-lote.js';

const BANCO_LABEL = { bbva: 'BBVA', bcp: 'BCP', yape: 'Yape' };

function fila(over) {
  return {
    id: 'x', estado: 'pendiente', banco: 'bbva', tipo: 'gasto',
    monto: 12.5, fecha: '2026-08-20', comercio: 'LA PANERA CAFE',
    contraparte: null, moneda_original: null, raw_subject: 'BBVA - consumo',
    ...over,
  };
}

test('loteable: fila completa con categoría → true', () => {
  assert.equal(loteable(fila(), 'cat-1'), true);
});

test('loteable: sin categoría resuelta → false', () => {
  assert.equal(loteable(fila(), null), false);
  assert.equal(loteable(fila(), ''), false);
});

test('loteable: revisar-manual nunca entra al lote', () => {
  assert.equal(loteable(fila({ estado: 'revisar-manual' }), 'cat-1'), false);
});

test('loteable: monto ausente, cero o negativo → false', () => {
  assert.equal(loteable(fila({ monto: null }), 'cat-1'), false);
  assert.equal(loteable(fila({ monto: 0 }), 'cat-1'), false);
  assert.equal(loteable(fila({ monto: -5 }), 'cat-1'), false);
});

test('loteable: sin fecha → false', () => {
  assert.equal(loteable(fila({ fecha: null }), 'cat-1'), false);
});

test('loteable: tipo ahorro exige abrir la card → false', () => {
  assert.equal(loteable(fila({ tipo: 'ahorro' }), 'cat-1'), false);
});

test('loteable: moneda extranjera exige revisión → false', () => {
  assert.equal(loteable(fila({ moneda_original: 'USD' }), 'cat-1'), false);
  // PEN explícito no estorba.
  assert.equal(loteable(fila({ moneda_original: 'PEN' }), 'cat-1'), true);
});

test('resumenLote: cuenta y suma los montos', () => {
  const r = resumenLote([fila({ monto: 10 }), fila({ monto: 2.5 })]);
  assert.equal(r.n, 2);
  assert.equal(r.total, 12.5);
});

test('resumenLote: lista vacía → cero, no NaN', () => {
  assert.deepEqual(resumenLote([]), { n: 0, total: 0 });
});

test('notaDePendiente: prefiere comercio', () => {
  assert.equal(notaDePendiente(fila(), BANCO_LABEL), 'LA PANERA CAFE');
});

test('notaDePendiente: sin comercio cae a contraparte, luego al asunto', () => {
  assert.equal(
    notaDePendiente(fila({ comercio: null, contraparte: 'EDUARDO DIAZ' }), BANCO_LABEL),
    'EDUARDO DIAZ');
  assert.equal(
    notaDePendiente(fila({ comercio: null, contraparte: null }), BANCO_LABEL),
    'BBVA - consumo');
});

test('notaDePendiente: sin nada usable, etiqueta el banco', () => {
  const f = fila({ comercio: null, contraparte: null, raw_subject: null });
  assert.equal(notaDePendiente(f, BANCO_LABEL), 'Correo BBVA');
});

test('aliasDe: encuentra el alias normalizando el nombre', () => {
  const mapa = { 'rodolfo martin anderson huarcaya': 'Rodolfo (gimnasio)' };
  assert.equal(aliasDe('RODOLFO MARTIN ANDERSON HUARCAYA', mapa), 'Rodolfo (gimnasio)');
  assert.equal(aliasDe('  Rodolfo Martin Anderson Huarcaya  ', mapa), 'Rodolfo (gimnasio)');
});

test('aliasDe: sin alias devuelve null, no el nombre crudo', () => {
  assert.equal(aliasDe('ALGUIEN NUEVO', {}), null);
  assert.equal(aliasDe(null, {}), null);
  assert.equal(aliasDe('X', null), null);
});

test('notaDePendiente: el alias gana al nombre del banco', () => {
  const fila = { comercio: null, contraparte: 'KAREN R GAGO O', banco: 'bbva', raw_subject: 'x' };
  const mapa = { 'karen r gago o': 'Karen' };
  assert.equal(notaDePendiente(fila, { bbva: 'BBVA' }, mapa), 'Karen');
});

test('notaDePendiente: sin mapa se comporta igual que antes', () => {
  // Compatibilidad: los llamadores que no pasen alias no cambian de conducta.
  const fila = { comercio: 'LA PANERA CAFE', contraparte: null, banco: 'bbva', raw_subject: 'x' };
  assert.equal(notaDePendiente(fila, { bbva: 'BBVA' }), 'LA PANERA CAFE');
});
