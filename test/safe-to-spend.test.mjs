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

function ing2(monto, fechaISO) { return { tipo: 'ingreso', ambito: 'personal', monto, fecha: fechaISO }; }
function gas2(monto, fechaISO, categoria_id) { return { tipo: 'gasto', ambito: 'personal', monto, fecha: fechaISO, categoria_id }; }

test('baseline cubre el bug día-1: sueldo aún no cae este mes', () => {
  const txs = [ing2(3000, '2026-04-10'), ing2(3000, '2026-05-10')];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.estado, 'ok');
  assert.strictEqual(out.diario, 429); // round(3000/7)
});

test('usa el mayor entre ingreso del mes y baseline', () => {
  const txs = [ing2(3000, '2026-04-10'), ing2(4000, '2026-06-03')];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 571); // round(4000/7)
});

test('categoría fija reserva su remanente no pagado', () => {
  const txs = [
    ing2(2400, '2026-06-03'),
    gas2(1000, '2026-04-02', 'alquiler'), gas2(1000, '2026-05-02', 'alquiler'),
  ];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 200); // (2400-1000)/7
});

test('fija ya pagada este mes no se vuelve a reservar', () => {
  const txs = [
    ing2(2400, '2026-06-03'),
    gas2(1000, '2026-04-02', 'alquiler'), gas2(1000, '2026-05-02', 'alquiler'),
    gas2(1000, '2026-06-02', 'alquiler'),
  ];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 200); // (2400-1000-0)/7
});

test('categoría con un solo mes cerrado no es fija', () => {
  const txs = [ing2(2100, '2026-06-03'), gas2(800, '2026-05-02', 'viaje')];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 300); // 2100/7, sin reserva
});
