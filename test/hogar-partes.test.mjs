import assert from 'node:assert';
import { test } from 'node:test';
import { validarPartesGastoHogar, restanteGastoHogar } from '../js/hogar-partes.js';

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

test('un monto negativo → inválido', () => {
  const r = validarPartesGastoHogar(100, [{ user_id: 'A', monto: 110 }, { user_id: 'B', monto: -10 }]);
  assert.strictEqual(r.ok, false);
});

test('total negativo → inválido', () => {
  const r = validarPartesGastoHogar(-50, [{ user_id: 'A', monto: -50 }]);
  assert.strictEqual(r.ok, false);
});

test('parte sin user_id → inválido', () => {
  const r = validarPartesGastoHogar(100, [{ monto: 100 }]);
  assert.strictEqual(r.ok, false);
});

// ── restanteGastoHogar ────────────────────────────────────────────
test('restante: nada asignado → falta el total', () => {
  assert.strictEqual(restanteGastoHogar(100, []), 100);
});

test('restante: parcialmente asignado → falta la diferencia', () => {
  assert.strictEqual(restanteGastoHogar(100, [{ user_id: 'A', monto: 30 }]), 70);
});

test('restante: exactamente asignado → 0', () => {
  assert.strictEqual(restanteGastoHogar(100, [{ user_id: 'A', monto: 60 }, { user_id: 'B', monto: 40 }]), 0);
});

test('restante: sobre-asignado → negativo (sobran)', () => {
  assert.strictEqual(restanteGastoHogar(100, [{ user_id: 'A', monto: 60 }, { user_id: 'B', monto: 50 }]), -10);
});

test('restante: partes con monto 0 o negativo no cuentan como asignación', () => {
  assert.strictEqual(restanteGastoHogar(100, [{ user_id: 'A', monto: 30 }, { user_id: 'B', monto: 0 }]), 70);
  assert.strictEqual(restanteGastoHogar(100, [{ user_id: 'A', monto: 30 }, { user_id: 'B', monto: -5 }]), 70);
});

test('restante: sin redondeo de punto flotante (33.34 + 66.67 vs 100)', () => {
  assert.strictEqual(restanteGastoHogar(100, [{ user_id: 'A', monto: 33.34 }, { user_id: 'B', monto: 66.67 }]), -0.01);
});

test('restante: total no numérico o partes vacías → total completo', () => {
  assert.strictEqual(restanteGastoHogar(null, []), 0);
  assert.strictEqual(restanteGastoHogar(100, null), 100);
});
