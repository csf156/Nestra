import assert from 'node:assert';
import { test } from 'node:test';
import { calcularSafeToSpend } from '../js/safe-to-spend.js';

// Junio 2026 tiene 30 días. HOY = día 24 → díasRestantes = 30-24+1 = 7.
const HOY = new Date(2026, 5, 24);

function ing(monto, fechaISO) { return { tipo: 'ingreso', ambito: 'personal', hogar_id: null, monto, fecha: fechaISO }; }
function gas(monto, fechaISO, categoria_id = 'c1') { return { tipo: 'gasto', ambito: 'personal', hogar_id: null, monto, fecha: fechaISO, categoria_id }; }

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
  const txs = [ing(2100, '2026-06-05'), { tipo: 'gasto', ambito: 'hogar', hogar_id: 'H', monto: 9999, fecha: '2026-06-10', categoria_id: 'c1' }];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 300);
});

test('baseline cubre el bug día-1: sueldo aún no cae este mes', () => {
  const txs = [ing(3000, '2026-04-10'), ing(3000, '2026-05-10')];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.estado, 'ok');
  assert.strictEqual(out.diario, 429); // round(3000/7)
});

test('usa el mayor entre ingreso del mes y baseline', () => {
  const txs = [ing(3000, '2026-04-10'), ing(4000, '2026-06-03')];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 571); // round(4000/7)
});

test('categoría fija reserva su remanente no pagado', () => {
  const txs = [
    ing(2400, '2026-06-03'),
    gas(1000, '2026-04-02', 'alquiler'), gas(1000, '2026-05-02', 'alquiler'),
  ];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 200); // (2400-1000)/7
});

test('fija ya pagada este mes no se vuelve a reservar', () => {
  const txs = [
    ing(2400, '2026-06-03'),
    gas(1000, '2026-04-02', 'alquiler'), gas(1000, '2026-05-02', 'alquiler'),
    gas(1000, '2026-06-02', 'alquiler'),
  ];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 200); // (2400-1000-0)/7
});

test('categoría con un solo mes cerrado no es fija', () => {
  const txs = [ing(2100, '2026-06-03'), gas(800, '2026-05-02', 'viaje')];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 300); // 2100/7, sin reserva
});

function meta(over) {
  return Object.assign({
    id: 'm1', ambito: 'personal', hogar_id: null, estado: 'en_curso', es_fondo_emergencia: false,
    monto_objetivo: 1200, monto_actual: 0, fecha_limite: '2026-12-31',
  }, over);
}

test('aporte de meta prorratea la cuota mensual por días restantes', () => {
  const out = calcularSafeToSpend([ing(2100, '2026-06-03')], [meta()], { hoy: HOY });
  assert.strictEqual(out.estado, 'ok');
  assert.strictEqual(out.diario, 294);
});

test('meta fondo de emergencia se ignora', () => {
  const out = calcularSafeToSpend([ing(2100, '2026-06-03')], [meta({ es_fondo_emergencia: true })], { hoy: HOY });
  assert.strictEqual(out.diario, 300);
});

test('meta de hogar se ignora (solo personal)', () => {
  const out = calcularSafeToSpend([ing(2100, '2026-06-03')], [meta({ hogar_id: 'H' })], { hoy: HOY });
  assert.strictEqual(out.diario, 300);
});

test('meta ya cubierta (actual ≥ objetivo) no reserva', () => {
  const out = calcularSafeToSpend([ing(2100, '2026-06-03')], [meta({ monto_actual: 1200 })], { hoy: HOY });
  assert.strictEqual(out.diario, 300);
});

test('meta sin fecha_limite se ignora', () => {
  const out = calcularSafeToSpend([ing(2100, '2026-06-03')], [meta({ fecha_limite: null })], { hoy: HOY });
  assert.strictEqual(out.diario, 300);
});

test('meta con fecha_limite inválida no rompe el cálculo (sin NaN)', () => {
  const txs = [ing(2100, '2026-06-03')];
  const out = calcularSafeToSpend(txs, [meta({ fecha_limite: 'not-a-date' })], { hoy: HOY });
  assert.strictEqual(out.estado, 'ok');
  assert.strictEqual(out.diario, 300); // meta ignorada → 2100/7
});

test('gastos sin categoría no se infieren como fijos', () => {
  // Dos meses cerrados con gasto sin categoría; no debe reservarse como fijo.
  const txs = [
    ing(2100, '2026-06-03'),
    { tipo: 'gasto', ambito: 'personal', hogar_id: null, monto: 1000, fecha: '2026-04-02', categoria_id: null },
    { tipo: 'gasto', ambito: 'personal', hogar_id: null, monto: 1000, fecha: '2026-05-02', categoria_id: null },
  ];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 300); // sin reserva por fijos → 2100/7
});
