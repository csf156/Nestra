import assert from 'node:assert';
import { test } from 'node:test';
import { calcularSafeToSpend } from '../js/safe-to-spend.js';

// Junio 2026 tiene 30 días. HOY = día 24 → díasRestantes = 30-24+1 = 7.
const HOY = new Date(2026, 5, 24);

function ing(monto, fechaISO) { return { tipo: 'ingreso', ambito: 'personal', monto, fecha: fechaISO }; }
function gas(monto, fechaISO, categoria_id = 'c1') { return { tipo: 'gasto', ambito: 'personal', monto, fecha: fechaISO, categoria_id }; }

test('sin ingreso estimado → null', () => {
  assert.strictEqual(calcularSafeToSpend([], [], { hoy: HOY }), null);
});

test('ingreso del mes, sin gastos ni fijos ni metas → reparte entre días restantes', () => {
  const out = calcularSafeToSpend([ing(2100, '2026-06-05')], [], { hoy: HOY });
  assert.strictEqual(out.estado, 'ok');
  assert.strictEqual(out.diario, 300);
  assert.strictEqual(out.restanteMes, 2100);
  assert.strictEqual(out.diasRestantes, 7);
});

test('gasto acumulado reduce el disponible', () => {
  const out = calcularSafeToSpend([ing(2100, '2026-06-05'), gas(700, '2026-06-10')], [], { hoy: HOY });
  assert.strictEqual(out.diario, 200);
});

test('numerador negativo → estado excedido, sin número negativo', () => {
  const out = calcularSafeToSpend([ing(500, '2026-06-05'), gas(900, '2026-06-10')], [], { hoy: HOY });
  assert.strictEqual(out.estado, 'excedido');
  assert.strictEqual(out.exceso, 400);
});

test('solo cuenta ámbito personal', () => {
  const txs = [ing(2100, '2026-06-05'), { tipo: 'gasto', ambito: 'hogar', monto: 9999, fecha: '2026-06-10', categoria_id: 'c1' }];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 300);
});
