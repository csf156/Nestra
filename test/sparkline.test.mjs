import assert from 'node:assert';
import { test } from 'node:test';
import { agruparGasto7dias, sparklineSVG } from '../js/sparkline.js';

const HOY = new Date(2026, 5, 24); // 24 jun 2026

function gas(monto, fechaISO, categoria_id = 'c1') {
  return { tipo: 'gasto', monto, fecha: fechaISO, categoria_id };
}

test('agruparGasto7dias: 7 valores, hoy es el último', () => {
  const out = agruparGasto7dias([gas(10, '2026-06-24')], 'c1', HOY);
  assert.strictEqual(out.length, 7);
  assert.strictEqual(out[6], 10);   // hoy
  assert.strictEqual(out[0], 0);    // hace 6 días
});

test('agruparGasto7dias: suma por día y filtra por categoría', () => {
  const txs = [
    gas(10, '2026-06-22', 'c1'),
    gas(5,  '2026-06-22', 'c1'),
    gas(99, '2026-06-22', 'c2'), // otra categoría → excluida
    gas(7,  '2026-06-24', 'c1'),
  ];
  const out = agruparGasto7dias(txs, 'c1', HOY);
  assert.strictEqual(out[4], 15); // 22 jun = índice 4 (24-22=2 → 6-2=4)
  assert.strictEqual(out[6], 7);  // 24 jun
});

test('agruparGasto7dias: ignora ingresos y fechas fuera de ventana', () => {
  const txs = [
    { tipo: 'ingreso', monto: 100, fecha: '2026-06-24', categoria_id: 'c1' },
    gas(50, '2026-06-10', 'c1'), // fuera de los 7 días
  ];
  const out = agruparGasto7dias(txs, 'c1', HOY);
  assert.deepStrictEqual(out, [0, 0, 0, 0, 0, 0, 0]);
});

test('sparklineSVG: devuelve <svg> con polyline cuando hay >=2 datos', () => {
  const svg = sparklineSVG([0, 1, 2, 3, 2, 1, 4]);
  assert.match(svg, /^<svg/);
  assert.match(svg, /<polyline/);
  assert.match(svg, /aria-hidden="true"/);
});

test('sparklineSVG: cadena vacía si <2 puntos con dato', () => {
  assert.strictEqual(sparklineSVG([0, 0, 0, 0, 0, 0, 0]), '');
  assert.strictEqual(sparklineSVG([0, 0, 0, 0, 0, 0, 5]), '');
});
