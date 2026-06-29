import assert from 'node:assert';
import { test } from 'node:test';
import { proyectarFlujo } from '../js/flujo-proyeccion.js';

// Junio 2026: 30 días. HOY = día 20 → proyecta días 20..30 (11 días).
const HOY = new Date(2026, 5, 20);

test('sin recurrentes ni aportes → línea plana, sin día negativo', () => {
  const r = proyectarFlujo({ saldoInicial: 500, hoy: HOY, recurrentes: [], aportesMeta: [] });
  assert.strictEqual(r.dias.length, 11);
  assert.strictEqual(r.dias[0].fecha, '2026-06-20');
  assert.strictEqual(r.dias[10].fecha, '2026-06-30');
  assert.strictEqual(r.saldoFinal, 500);
  assert.strictEqual(r.primerDiaNegativo, null);
});

test('gasto recurrente mensual el día 25 resta del saldo', () => {
  const r = proyectarFlujo({
    saldoInicial: 100, hoy: HOY,
    recurrentes: [{ tipo: 'gasto', monto: 40, frecuencia: 'mensual', dia_cargo: 25 }],
    aportesMeta: [],
  });
  assert.strictEqual(r.saldoFinal, 60);
  assert.strictEqual(r.primerDiaNegativo, null);
});

test('gasto que supera el saldo → marca primerDiaNegativo', () => {
  const r = proyectarFlujo({
    saldoInicial: 30, hoy: HOY,
    recurrentes: [{ tipo: 'gasto', monto: 50, frecuencia: 'mensual', dia_cargo: 22 }],
    aportesMeta: [],
  });
  assert.strictEqual(r.primerDiaNegativo, '2026-06-22');
  assert.strictEqual(r.saldoFinal, -20);
});

test('ingreso fijo mensual levanta el saldo', () => {
  const r = proyectarFlujo({
    saldoInicial: 0, hoy: HOY,
    recurrentes: [{ tipo: 'ingreso', monto: 200, frecuencia: 'mensual', dia_cargo: 28 }],
    aportesMeta: [],
  });
  assert.strictEqual(r.saldoFinal, 200);
});

test('aporte a meta resta en su día', () => {
  const r = proyectarFlujo({
    saldoInicial: 300, hoy: HOY, recurrentes: [],
    aportesMeta: [{ dia: 30, monto: 120 }],
  });
  assert.strictEqual(r.saldoFinal, 180);
});

test('recurrente con dia_cargo anterior a hoy no cuenta este mes', () => {
  const r = proyectarFlujo({
    saldoInicial: 100, hoy: HOY,
    recurrentes: [{ tipo: 'gasto', monto: 40, frecuencia: 'mensual', dia_cargo: 5 }],
    aportesMeta: [],
  });
  assert.strictEqual(r.saldoFinal, 100);
});
