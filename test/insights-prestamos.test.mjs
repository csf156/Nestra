import assert from 'node:assert';
import { test } from 'node:test';
import { detectPrestamosSinCobro } from '../js/insights.js';

const HOY = new Date(2026, 5, 24); // 2026-06-24

// Fila de préstamo como la entrega getPrestamos(): transacción embebida + deudor + estado.
function prestamo(deudor, monto, fechaISO, estado = 'pendiente') {
  return { id: deudor + ':' + fechaISO, deudor, estado, transacciones: { fecha: fechaISO, monto, ambito: 'personal', nota: '' } };
}

test('préstamo pendiente sobre el umbral → warn con monto y días', () => {
  const out = detectPrestamosSinCobro([prestamo('Ana', 200, '2026-05-01')], { hoy: HOY });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'warn');
  assert.strictEqual(out[0].icono, 'cash');
  assert.match(out[0].titulo, /S\/200/);
  assert.match(out[0].subtexto, /54 días sin cobrar a Ana/);
  assert.strictEqual(out[0].accion.href, '#prestamos');
});

test('préstamo bajo el umbral → []', () => {
  const out = detectPrestamosSinCobro([prestamo('Ana', 200, '2026-06-10')], { hoy: HOY });
  assert.deepStrictEqual(out, []);
});

test('agrupa por deudor: suma montos y usa la fecha más antigua', () => {
  const txs = [prestamo('Beto', 100, '2026-05-20'), prestamo('Beto', 50, '2026-03-01')];
  const out = detectPrestamosSinCobro(txs, { hoy: HOY });
  assert.strictEqual(out.length, 1);
  assert.match(out[0].titulo, /S\/150/);
  assert.match(out[0].subtexto, /115 días/);
});

test('ignora devueltos', () => {
  const out = detectPrestamosSinCobro([prestamo('Ana', 200, '2026-01-01', 'devuelto')], { hoy: HOY });
  assert.deepStrictEqual(out, []);
});

test('múltiples deudores: ordena por monto×días desc', () => {
  const txs = [prestamo('Chico', 50, '2026-05-01'), prestamo('Dani', 500, '2026-05-15')];
  const out = detectPrestamosSinCobro(txs, { hoy: HOY });
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].meta.deudor, 'Dani');
});

test('sin datos → []', () => {
  assert.deepStrictEqual(detectPrestamosSinCobro([], { hoy: HOY }), []);
  assert.deepStrictEqual(detectPrestamosSinCobro(undefined, { hoy: HOY }), []);
});
