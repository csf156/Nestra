import assert from 'node:assert';
import { test } from 'node:test';
import { validarPartesGastoHogar } from '../js/hogar-partes.js';

test('suma exacta de partes = total → válido', () => {
  const r = validarPartesGastoHogar(100, [{ user_id: 'A', monto: 60 }, { user_id: 'B', monto: 40 }]);
  assert.strictEqual(r.ok, true);
});

test('un solo pagador al 100% → válido', () => {
  const r = validarPartesGastoHogar(100, [{ user_id: 'A', monto: 100 }]);
  assert.strictEqual(r.ok, true);
});

test('suma distinta del total → inválido', () => {
  const r = validarPartesGastoHogar(100, [{ user_id: 'A', monto: 60 }, { user_id: 'B', monto: 30 }]);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /no coincide/);
});

test('un monto en 0 o negativo → inválido', () => {
  const r = validarPartesGastoHogar(100, [{ user_id: 'A', monto: 100 }, { user_id: 'B', monto: 0 }]);
  assert.strictEqual(r.ok, false);
});

test('user_id repetido → inválido', () => {
  const r = validarPartesGastoHogar(100, [{ user_id: 'A', monto: 50 }, { user_id: 'A', monto: 50 }]);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /dos partes/);
});

test('total en 0 o negativo → inválido', () => {
  const r = validarPartesGastoHogar(0, [{ user_id: 'A', monto: 0 }]);
  assert.strictEqual(r.ok, false);
});

test('sin partes → inválido', () => {
  const r = validarPartesGastoHogar(100, []);
  assert.strictEqual(r.ok, false);
});

test('tolerancia de redondeo de hasta 1 centavo → válido', () => {
  const r = validarPartesGastoHogar(100, [{ user_id: 'A', monto: 33.34 }, { user_id: 'B', monto: 66.67 }]);
  assert.strictEqual(r.ok, true); // suma 100.01, dentro de tolerancia
});
