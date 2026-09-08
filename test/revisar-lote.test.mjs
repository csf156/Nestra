// test/revisar-lote.test.mjs
// Lógica pura del modo lote de #revisar. Sin DOM: las funciones reciben las
// filas de ingest_pendientes tal como las devuelve getIngestPendientes().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loteable, resumenLote, notaDePendiente, aliasDe, contextoContraparte, agruparPorDia,
} from '../js/revisar-lote.js';

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

// ── contextoContraparte (B3) ──────────────────────────────────────
test('contextoContraparte: cuenta las veces y da la última', () => {
  const previos = [
    { comercio: null, contraparte: 'KAREN R GAGO O', fecha: '2026-08-12', monto: 50 },
    { comercio: null, contraparte: 'karen r gago o', fecha: '2026-07-03', monto: 50 },
  ];
  const c = contextoContraparte({ contraparte: 'Karen R Gago O' }, previos);
  assert.equal(c.veces, 3);              // las 2 previas + esta
  assert.equal(c.ultimaFecha, '2026-08-12');
  assert.equal(c.montoTipico, 50);
});

test('contextoContraparte: primera vez se declara como tal', () => {
  const c = contextoContraparte({ contraparte: 'ALGUIEN NUEVO' }, []);
  assert.equal(c.veces, 1);
  assert.equal(c.primeraVez, true);
});

test('contextoContraparte: sin contraparte ni comercio devuelve null', () => {
  assert.equal(contextoContraparte({ contraparte: null, comercio: null }, []), null);
});

test('contextoContraparte: cae a comercio cuando no hay contraparte, y las variantes cuentan igual', () => {
  const previos = [{ comercio: 'Recarga Bitel', fecha: '2026-08-01', monto: 7 }];
  const c = contextoContraparte({ comercio: 'RECARGA BITEL' }, previos);
  assert.equal(c.veces, 2);
  assert.equal(c.montoTipico, 7);
});

test('contextoContraparte: solo cuenta coincidencias reales, no todo lo demás', () => {
  const previos = [
    { comercio: null, contraparte: 'Karen R Gago O', fecha: '2026-08-12', monto: 50 },
    { comercio: null, contraparte: 'Otra Persona', fecha: '2026-08-10', monto: 30 },
  ];
  const c = contextoContraparte({ contraparte: 'Karen R Gago O' }, previos);
  assert.equal(c.veces, 2);
  assert.equal(c.ultimaFecha, '2026-08-12');
});

// ── agruparPorDia (B3) ─────────────────────────────────────────────
test('agruparPorDia: agrupa y ordena de más reciente a más antiguo', () => {
  const filas = [
    { id: 'a', fecha: '2026-09-01', hora: '14:00' },
    { id: 'b', fecha: '2026-09-02', hora: '09:00' },
    { id: 'c', fecha: '2026-09-01', hora: '08:00' },
  ];
  const g = agruparPorDia(filas);
  assert.deepEqual(g.map((x) => x.fecha), ['2026-09-02', '2026-09-01']);
  // Dentro del día, la más reciente primero.
  assert.deepEqual(g[1].filas.map((f) => f.id), ['a', 'c']);
});

test('agruparPorDia: las filas sin hora no se pierden ni rompen el orden', () => {
  const g = agruparPorDia([
    { id: 'a', fecha: '2026-09-01', hora: null },
    { id: 'b', fecha: '2026-09-01', hora: '10:00' },
  ]);
  assert.equal(g[0].filas.length, 2);
});

test('agruparPorDia: conserva las MISMAS referencias de fila (para que _filas.indexOf siga funcionando)', () => {
  // Task B3 no reordena _filas — el índice i que usan data-rev-check/alias/chip
  // sigue siendo la posición en _filas. agruparPorDia solo decide el orden de
  // pintado; el llamador resuelve el índice real vía indexOf sobre estas mismas
  // referencias. Si esto clonara las filas, indexOf() ya no las encontraría.
  const a = { id: 'a', fecha: '2026-09-01', hora: '14:00' };
  const b = { id: 'b', fecha: '2026-09-02', hora: '09:00' };
  const filas = [a, b];
  const g = agruparPorDia(filas);
  assert.equal(g[0].filas[0], b);
  assert.equal(g[1].filas[0], a);
});

test('agruparPorDia: lista vacía → []', () => {
  assert.deepEqual(agruparPorDia([]), []);
  assert.deepEqual(agruparPorDia(null), []);
});

test('agruparPorDia: filas sin fecha (revisar-manual) van al final, en su propio grupo', () => {
  // Sin este caso, sort() alfabético colaría "null" ANTES que cualquier
  // "2026-...", y con el reverse() de "más reciente primero" terminarían
  // arriba de todo — justo al revés de "al final".
  const filas = [
    { id: 'manual', fecha: null, hora: null },
    { id: 'a', fecha: '2026-09-01', hora: '14:00' },
  ];
  const g = agruparPorDia(filas);
  assert.equal(g.length, 2);
  assert.equal(g[0].fecha, '2026-09-01');
  assert.equal(g[1].fecha, null);
  assert.deepEqual(g[1].filas.map((f) => f.id), ['manual']);
});
