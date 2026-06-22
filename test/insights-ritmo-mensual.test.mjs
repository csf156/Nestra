import assert from 'node:assert';
import { test } from 'node:test';
import { detectRitmoMensual } from '../js/insights.js';

const HOY = new Date(2026, 5, 21); // 2026-06-21 (junio, 30 días)

function gasto(monto, fechaISO) {
  return { tipo: 'gasto', ambito: 'personal', monto, fecha: fechaISO, categorias: { nombre: 'X' } };
}

test('proyección por encima → warn', () => {
  // Mes pasado (mayo): total 600.
  const txs = [gasto(600, '2026-05-15')];
  // Junio: 700 en 21 días → proyección 700/21*30 = 1000 → +66%.
  txs.push(gasto(700, '2026-06-10'));
  const out = detectRitmoMensual(txs, { hoy: HOY });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'warn');
  assert.strictEqual(out[0].icono, 'chart-line');
  assert.match(out[0].titulo, /más que el mes pasado/);
});

test('proyección por debajo → good', () => {
  const txs = [gasto(1000, '2026-05-15')]; // mayo 1000
  txs.push(gasto(350, '2026-06-10'));       // junio 350/21*30 = 500 → -50%
  const out = detectRitmoMensual(txs, { hoy: HOY });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'good');
  assert.match(out[0].titulo, /menos que el mes pasado/);
});

test('NO dispara si el mes anterior no tiene datos', () => {
  const txs = [gasto(700, '2026-06-10')];
  assert.deepStrictEqual(detectRitmoMensual(txs, { hoy: HOY }), []);
});

test('NO dispara antes del día 5 del mes', () => {
  const hoyTemprano = new Date(2026, 5, 3);
  const txs = [gasto(600, '2026-05-15'), gasto(100, '2026-06-02')];
  assert.deepStrictEqual(detectRitmoMensual(txs, { hoy: hoyTemprano }), []);
});

test('dentro de ±15% → nada', () => {
  const txs = [gasto(700, '2026-05-15')]; // mayo 700
  txs.push(gasto(490, '2026-06-10'));      // junio 490/21*30 = 700 → 0%
  assert.deepStrictEqual(detectRitmoMensual(txs, { hoy: HOY }), []);
});
