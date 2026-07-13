import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calcularRango, planMeta, costoOportunidad, sugerirMicroahorro } from '../js/brujula.js';

const HOY = new Date(2026, 6, 1); // 2026-07-01

// Métricas base: presupuesto 300, gastado 100, buena liquidez, ritmo normal.
function metricas(over = {}) {
  return Object.assign({
    limite: 300, gastoMes: 100,
    ingresos: 2000, gastos: 800, recurrentesPendientes: 200, colchonMetas: 100,
    gastoSemana: 40, diasSemana: 7, diasMes: 31,
  }, over);
}
const CAT = { nombre: 'Bicicleta', limite_mensual: 300, esencial: false };

test('sin monto → nivel consulta con rango cómodo y tope', () => {
  const r = calcularRango(0, metricas(), CAT);
  assert.equal(r.nivel, 'consulta');
  // margenCat = 300-100 = 200; liquidez = 2000-800-200-100 = 900; tope = min(200,900) = 200
  assert.equal(r.tope, 200);
  assert.equal(r.comodo, 200); // ritmo normal → cómodo = tope
});

test('ritmo rápido reduce el cómodo (70% del tope)', () => {
  // gastoSemana alto: 200 en 7 días → ritmoSemanal 200 > objetivoSemanal (300*7/31≈67.7)
  const r = calcularRango(0, metricas({ gastoSemana: 200 }), CAT);
  assert.equal(r.tope, 200);
  assert.equal(r.comodo, 140); // round(200*0.7)
});

test('monto ≤ cómodo → recomendable', () => {
  const r = calcularRango(120, metricas(), CAT);
  assert.equal(r.nivel, 'recomendable');
});

test('cómodo < monto ≤ tope → cautela', () => {
  const r = calcularRango(180, metricas({ gastoSemana: 200 }), CAT); // cómodo 140, tope 200
  assert.equal(r.nivel, 'cautela');
});

test('monto > tope → no', () => {
  const r = calcularRango(250, metricas(), CAT); // tope 200
  assert.equal(r.nivel, 'no');
});

test('sin presupuesto de categoría → cae a liquidez, sin bloquear', () => {
  const catSin = { nombre: 'Ocio', limite_mensual: null, esencial: false };
  const r = calcularRango(0, metricas({ limite: null }), catSin);
  assert.equal(r.nivel, 'consulta');
  assert.equal(r.tope, 900); // liquidez completa
  assert.equal(r.comodo, 900);
});

test('sin liquidez → sin-margen', () => {
  const r = calcularRango(50, metricas({ ingresos: 900 }), CAT); // liquidez = 900-800-200-100 = -200 → 0
  assert.equal(r.nivel, 'sin-margen');
  assert.equal(r.tope, 0);
});

test('planMeta: reparte el monto en 3 meses y calcula fecha', () => {
  const p = planMeta(380, 200, HOY); // HOY = 2026-07-01
  assert.equal(p.faltante, 180);       // 380 - 200
  assert.equal(p.aporteMes, 127);      // ceil(380/3) = 127
  assert.equal(p.fechaMeta, '2026-10-01'); // +3 meses
});

test('planMeta: aporteMes redondea hacia arriba', () => {
  const p = planMeta(100, 0, HOY);
  assert.equal(p.aporteMes, 34); // ceil(100/3)
});

test('costoOportunidad: categoría no esencial → texto con nº de aportes', () => {
  const cat = { nombre: 'Ocio', esencial: false };
  const r = costoOportunidad(100, cat, { nombre: 'Viaje', aporteTipico: 50 });
  assert.equal(r.n, 2); // round(100/50)
  assert.match(r.texto, /Viaje/);
});

test('costoOportunidad: categoría esencial → null', () => {
  const cat = { nombre: 'Comida', esencial: true };
  assert.equal(costoOportunidad(100, cat, { nombre: 'Viaje', aporteTipico: 50 }), null);
});

test('costoOportunidad: sin meta crítica → null', () => {
  const cat = { nombre: 'Ocio', esencial: false };
  assert.equal(costoOportunidad(100, cat, null), null);
});

test('costoOportunidad: esencial undefined se trata como esencial (null)', () => {
  const cat = { nombre: 'X' };
  assert.equal(costoOportunidad(100, cat, { nombre: 'Viaje', aporteTipico: 50 }), null);
});

test('sugerirMicroahorro: elige meta más cercana y sugiere 10% de liquidez', () => {
  const metas = [
    { id: 'a', nombre: 'Lejana', monto_actual: 0, monto_objetivo: 1000, estado: 'en_curso', fecha_limite: '2026-12-01' },
    { id: 'b', nombre: 'Cercana', monto_actual: 0, monto_objetivo: 1000, estado: 'en_curso', fecha_limite: '2026-08-01' },
  ];
  const r = sugerirMicroahorro(metas, 500, HOY);
  assert.equal(r.meta_id, 'b');
  assert.equal(r.sugerido, 50); // round(500 * 0.1)
  assert.match(r.texto, /Cercana/);
});

test('sugerirMicroahorro: no pasa del faltante de la meta', () => {
  const metas = [{ id: 'b', nombre: 'Casi', monto_actual: 970, monto_objetivo: 1000, estado: 'en_curso', fecha_limite: '2026-08-01' }];
  const r = sugerirMicroahorro(metas, 500, HOY); // 10% = 50, pero faltan 30
  assert.equal(r.sugerido, 30);
});

test('sugerirMicroahorro: sin liquidez → null', () => {
  const metas = [{ id: 'b', nombre: 'X', monto_actual: 0, monto_objetivo: 1000, estado: 'en_curso', fecha_limite: '2026-08-01' }];
  assert.equal(sugerirMicroahorro(metas, 0, HOY), null);
});

test('sugerirMicroahorro: sin metas en curso → null', () => {
  const metas = [{ id: 'b', nombre: 'X', monto_actual: 1000, monto_objetivo: 1000, estado: 'cumplida', fecha_limite: '2026-08-01' }];
  assert.equal(sugerirMicroahorro(metas, 500, HOY), null);
});
