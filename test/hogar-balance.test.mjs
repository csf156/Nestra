// test/hogar-balance.test.mjs
import assert from 'node:assert';
import { test } from 'node:test';
import { calcularBalanceHogar, repartoDisolucion } from '../js/hogar-balance.js';

const A = 'uidA', B = 'uidB';
function gas(user_id, monto) { return { tipo: 'gasto', ambito: 'hogar', user_id, monto }; }

test('sin gastos hogar → neto 0', () => {
  const r = calcularBalanceHogar([], [], A, B);
  assert.strictEqual(r.neto, 0);
});

test('A pagó más → B le debe la mitad de la diferencia', () => {
  // A pagó 100, B pagó 40 → (100-40)/2 = 30, B debe 30 a A
  const r = calcularBalanceHogar([gas(A,100), gas(B,40)], [], A, B);
  assert.strictEqual(r.neto, 30);
  assert.strictEqual(r.acreedor, A);
  assert.strictEqual(r.deudor, B);
});

test('liquidación previa de B→A reduce el neto', () => {
  const liq = [{ de_user: B, a_user: A, monto: 30 }];
  const r = calcularBalanceHogar([gas(A,100), gas(B,40)], liq, A, B);
  assert.strictEqual(r.neto, 0);
});

test('ignora transacciones personales y de ingreso', () => {
  const txs = [gas(A,100), { tipo:'ingreso', ambito:'hogar', user_id:A, monto:999 },
               { tipo:'gasto', ambito:'personal', user_id:A, monto:999 }];
  const r = calcularBalanceHogar(txs, [], A, B);
  assert.strictEqual(r.neto, 50); // (100-0)/2
});

test('reparto de disolución por % de aporte de ingresos', () => {
  // A aportó 600 de ingresos hogar, B 400 → A 60%. ahorro 1000.
  const r = repartoDisolucion(600, 400, 1000);
  assert.strictEqual(r.pctA, 0.6);
  assert.strictEqual(r.recibeA, 600);
  assert.strictEqual(r.recibeB, 400);
});

test('ambos sin ingresos → 50/50', () => {
  const r = repartoDisolucion(0, 0, 500);
  assert.strictEqual(r.pctA, 0.5);
  assert.strictEqual(r.recibeA, 250);
});

test('modo proporcional: parte justa pesada por ingresos hogar', () => {
  // A aportó 600 de ingresos hogar, B 400 → pesoA 60%. Gastos: A pagó 200, B 0.
  // total gastos = 200; parte justa A = 0.6*200 = 120; neto A = 200-120 = 80.
  const txs = [
    { user_id: A, tipo: 'ingreso', ambito: 'hogar', hogar_id: 'H', monto: 600 },
    { user_id: B, tipo: 'ingreso', ambito: 'hogar', hogar_id: 'H', monto: 400 },
    { user_id: A, tipo: 'gasto',   ambito: 'hogar', hogar_id: 'H', monto: 200 },
  ];
  const r = calcularBalanceHogar(txs, [], A, B, 'proporcional');
  assert.strictEqual(r.neto, 80);
  assert.strictEqual(r.acreedor, A);
  assert.strictEqual(r.deudor, B);
});

test('modo proporcional con ambos ingresos 0 → cae a 50/50', () => {
  const txs = [gas(A, 100), gas(B, 40)];
  const r = calcularBalanceHogar(txs, [], A, B, 'proporcional');
  assert.strictEqual(r.neto, 30); // (100-40)/2
});

test('sin modo (retrocompat) = 50/50', () => {
  const txs = [gas(A, 100), gas(B, 40)];
  const r = calcularBalanceHogar(txs, [], A, B);
  assert.strictEqual(r.neto, 30);
});
