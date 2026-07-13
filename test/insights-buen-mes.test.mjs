import assert from 'node:assert';
import { test } from 'node:test';
import { detectBuenMes } from '../js/insights.js';

const HOY = new Date(2026, 5, 21); // junio: mes en curso, se excluye

function gasto(monto, fechaISO) {
  return { tipo: 'gasto', ambito: 'personal', monto, fecha: fechaISO, categorias: { nombre: 'X' } };
}

test('último mes cerrado por debajo del promedio → good', () => {
  const txs = [
    gasto(1000, '2026-03-10'), // marzo 1000
    gasto(1000, '2026-04-10'), // abril 1000
    gasto(700, '2026-05-10'),  // mayo 700 (último cerrado) vs prom 1000 → -30%
    gasto(50, '2026-06-05'),   // junio (en curso) ignorado
  ];
  const out = detectBuenMes(txs, { hoy: HOY });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'good');
  assert.strictEqual(out[0].icono, 'circle-check');
  assert.match(out[0].titulo, /En mayo gastaste 30% menos/);
});

test('NO dispara si el último mes cerrado NO bajó ≥15%', () => {
  const txs = [
    gasto(1000, '2026-03-10'),
    gasto(1000, '2026-04-10'),
    gasto(950, '2026-05-10'), // -5%
  ];
  assert.deepStrictEqual(detectBuenMes(txs, { hoy: HOY }), []);
});

test('NO dispara con menos de 2 meses cerrados', () => {
  const txs = [gasto(700, '2026-05-10'), gasto(50, '2026-06-05')];
  assert.deepStrictEqual(detectBuenMes(txs, { hoy: HOY }), []);
});

test('array vacío → []', () => {
  assert.deepStrictEqual(detectBuenMes([], { hoy: HOY }), []);
});
