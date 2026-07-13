import assert from 'node:assert';
import { test } from 'node:test';
import { diaISO, restarDias, parseFechaISO, fmtS, filtrarVentana } from '../js/insights.js';

test('diaISO formatea Date local a YYYY-MM-DD', () => {
  assert.strictEqual(diaISO(new Date(2026, 5, 21)), '2026-06-21');
  assert.strictEqual(diaISO(new Date(2026, 0, 5)), '2026-01-05');
});

test('restarDias retrocede n días cruzando meses', () => {
  assert.strictEqual(diaISO(restarDias(new Date(2026, 5, 21), 30)), '2026-05-22');
  assert.strictEqual(diaISO(restarDias(new Date(2026, 0, 1), 1)), '2025-12-31');
});

test('parseFechaISO produce medianoche local', () => {
  const d = parseFechaISO('2026-06-21');
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 5);
  assert.strictEqual(d.getDate(), 21);
});

test('fmtS agrupa miles sin decimales', () => {
  assert.strictEqual(fmtS(420), 'S/420');
  assert.strictEqual(fmtS(1250.7), 'S/1,251');
  assert.strictEqual(fmtS(0), 'S/0');
});

test('filtrarVentana mantiene solo fechas dentro de [hoy-dias, hoy]', () => {
  const hoy = new Date(2026, 5, 21);
  const txs = [
    { fecha: '2026-06-21' }, // hoy
    { fecha: '2026-03-23' }, // dentro de 90d
    { fecha: '2026-03-20' }, // fuera (>90d)
    { fecha: '2026-06-22' }, // futuro, fuera
    { fecha: null },          // sin fecha, fuera
  ];
  const out = filtrarVentana(txs, hoy, 90).map((t) => t.fecha);
  assert.deepStrictEqual(out, ['2026-06-21', '2026-03-23']);
});
