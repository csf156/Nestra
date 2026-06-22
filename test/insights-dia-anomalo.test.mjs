import assert from 'node:assert';
import { test } from 'node:test';
import { detectDiaAnomalo } from '../js/insights.js';

const HOY = new Date(2026, 5, 21); // domingo 2026-06-21

function gasto(monto, fechaISO, ambito = 'personal') {
  return { tipo: 'gasto', ambito, monto, fecha: fechaISO, categorias: { nombre: 'X' } };
}

test('detecta el weekday con gasto promedio ≥ 1.8x del global', () => {
  const txs = [];
  // 8 viernes con gasto alto (200 c/u). Viernes en abril-junio 2026.
  const viernes = ['2026-04-03', '2026-04-10', '2026-04-17', '2026-04-24',
    '2026-05-01', '2026-05-08', '2026-05-15', '2026-05-22'];
  for (const f of viernes) txs.push(gasto(200, f));
  // 8 lunes con gasto bajo (20 c/u).
  const lunes = ['2026-04-06', '2026-04-13', '2026-04-20', '2026-04-27',
    '2026-05-04', '2026-05-11', '2026-05-18', '2026-05-25'];
  for (const f of lunes) txs.push(gasto(20, f));
  const out = detectDiaAnomalo(txs, { hoy: HOY });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'info');
  assert.strictEqual(out[0].icono, 'calendar-stats');
  assert.match(out[0].titulo, /viernes/);
  assert.strictEqual(out[0].meta.wd, 5); // viernes
  // El multiplicador del título compara contra los DEMÁS días (200 vs 20 = 10x),
  // y debe ser coherente con las cifras del subtexto.
  assert.strictEqual(out[0].meta.ratio, 10);
  assert.match(out[0].titulo, /Gastas 10x más los viernes/);
  assert.match(out[0].subtexto, /S\/200 .* vs S\/20 /);
});

test('NO dispara si el weekday tiene < 6 ocurrencias', () => {
  const txs = [];
  // Solo 4 viernes altos.
  for (const f of ['2026-05-01', '2026-05-08', '2026-05-15', '2026-05-22']) txs.push(gasto(200, f));
  for (const f of ['2026-05-04', '2026-05-11', '2026-05-18', '2026-05-25', '2026-06-01', '2026-06-08']) txs.push(gasto(50, f));
  assert.deepStrictEqual(detectDiaAnomalo(txs, { hoy: HOY }), []);
});

test('NO dispara si no hay un weekday 1.8x sobre el resto (gasto uniforme)', () => {
  const txs = [];
  const fechas = ['2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10',
    '2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17',
    '2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08',
    '2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15'];
  for (const f of fechas) txs.push(gasto(50, f));
  assert.deepStrictEqual(detectDiaAnomalo(txs, { hoy: HOY }), []);
});

test('NO dispara si el total < S/100', () => {
  const txs = [gasto(5, '2026-05-01'), gasto(5, '2026-05-08')];
  assert.deepStrictEqual(detectDiaAnomalo(txs, { hoy: HOY }), []);
});

test('array vacío → []', () => {
  assert.deepStrictEqual(detectDiaAnomalo([], { hoy: HOY }), []);
});
