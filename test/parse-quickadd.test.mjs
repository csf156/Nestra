// test/parse-quickadd.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from '../js/parse-quickadd.js';

const HOY = '2026-06-24';
const CATS = [{ id: 'cT', nombre: 'Transporte' }, { id: 'cC', nombre: 'Comida' }, { id: 'cB', nombre: 'Partes de bicicleta' }];
const CTX = { categorias: CATS, seed: { uber: 'Transporte', taxi: 'Transporte', almuerzo: 'Comida' } };
const p = (text, ctx = CTX) => parseQuickAdd(text, { hoy: HOY, ctx });

test('gasto/personal por defecto + monto + categoría inferida', () => {
  const r = p('Uber 15');
  assert.equal(r.tipo, 'gasto');
  assert.equal(r.ambito, 'personal');
  assert.equal(r.monto, 15);
  assert.equal(r.categoria_id, 'cT');
  assert.equal(r.descripcion, 'Uber');
  assert.equal(r.fecha, HOY);
});

test('decimal con S/ + categoría', () => {
  const r = p('almuerzo S/12.50');
  assert.equal(r.monto, 12.5);
  assert.equal(r.categoria_id, 'cC');
});

test('ahorro hogar: tipo+ámbito, sin categoría', () => {
  const r = p('ahorro hogar 50');
  assert.equal(r.tipo, 'ahorro');
  assert.equal(r.ambito, 'hogar');
  assert.equal(r.monto, 50);
  assert.equal(r.categoria_id, null);
  assert.equal(r.descripcion, null);
});

test('ingreso con descripción', () => {
  const r = p('ingreso trabajo 100');
  assert.equal(r.tipo, 'ingreso');
  assert.equal(r.ambito, 'personal');
  assert.equal(r.monto, 100);
  assert.equal(r.descripcion, 'trabajo');
});

test('categoría custom por nombre, sin historial', () => {
  const r = p('llantas para bicicleta 100');
  assert.equal(r.categoria_id, 'cB');
});

test('keyword de tipo/ámbito se quita de la descripción', () => {
  const r = p('ahorro hogar viaje 200');
  assert.equal(r.descripcion, 'viaje');
});

test('sin categoría inferible → null', () => {
  assert.equal(p('chuches 5').categoria_id, null);
});

test('fecha relativa ayer', () => {
  assert.equal(p('15 taxi ayer').fecha, '2026-06-23');
});

test('sin monto → monto null', () => {
  assert.equal(p('recarga').monto, null);
});

test('nunca lanza con vacío/null', () => {
  assert.equal(parseQuickAdd('', { hoy: HOY }).monto, null);
  assert.equal(parseQuickAdd(null, { hoy: HOY }).monto, null);
});

// El hogar solo registra gasto y ahorro (CHECK transacciones_hogar_sin_ingreso,
// migración 20260716). El parser reconocía tipo y ámbito como palabras sueltas
// e independientes, así que "ingreso hogar" producía la combinación prohibida y
// el insert moría contra la base: online con un error opaco, y offline peor —
// se encolaba en el outbox, se espejaba como confirmada, y al sincronizar el
// CHECK la rechazaba para siempre dejando una fila fantasma solo en el cliente.
// El ámbito gana, igual que en el form (views/transaccion.html:_gateTipoPorAmbito).
test('hogar + ingreso: el ámbito gana, el tipo cae a gasto', () => {
  const r = p('sueldo 3000 ingreso hogar');
  assert.equal(r.ambito, 'hogar');
  assert.equal(r.tipo, 'gasto');
  assert.equal(r.monto, 3000);
});

test('hogar + ingreso: da igual el orden de las palabras', () => {
  const r = p('hogar ingreso alquiler 1200');
  assert.equal(r.ambito, 'hogar');
  assert.equal(r.tipo, 'gasto');
});

test('hogar + ahorro sigue siendo válido', () => {
  const r = p('ahorro hogar 200');
  assert.equal(r.ambito, 'hogar');
  assert.equal(r.tipo, 'ahorro');
});

test('personal + ingreso sigue siendo válido', () => {
  const r = p('sueldo 3000 ingreso personal');
  assert.equal(r.ambito, 'personal');
  assert.equal(r.tipo, 'ingreso');
});

test('ingreso sin ámbito explícito sigue siendo personal', () => {
  const r = p('sueldo 3000 ingreso');
  assert.equal(r.ambito, 'personal');
  assert.equal(r.tipo, 'ingreso');
});

// ── Aporte a meta (Tanda 3, #6) ────────────────────────────────────────────
// Nombres con emoji y tilde a propósito: son los reales de la base.
const METAS_T3 = [{ id: 'm1', nombre: 'Alquiler 🏠' }, { id: 'm2', nombre: 'Máquina de afeitar' }];
const pm = (s) => parseQuickAdd(s, { hoy: HOY, ctx: { metas: METAS_T3 } });

test('"aporte meta alquiler S/5" → ahorro + meta_id + monto', () => {
  const r = pm('aporte meta alquiler S/5');
  assert.equal(r.tipo, 'ahorro');
  assert.equal(r.meta_id, 'm1');
  assert.equal(r.monto, 5);
});

test('meta sin S/: "meta alquiler 5"', () => {
  const r = pm('meta alquiler 5');
  assert.equal(r.meta_id, 'm1');
  assert.equal(r.monto, 5);
});

test('meta casa con tildes: "meta maquina 20"', () => {
  assert.equal(pm('meta maquina 20').meta_id, 'm2');
});

test('la meta gana al ambito escrito', () => {
  const r = pm('meta alquiler personal S/5');
  assert.equal(r.meta_id, 'm1');
  assert.equal(r.tipo, 'ahorro');
});

test('meta sin match → metaError, sin meta_id, pero el monto se conserva', () => {
  const r = pm('meta viaje a japon S/5');
  assert.equal(r.meta_id, undefined);
  assert.equal(r.metaError, 'no-encontrada');
  assert.equal(r.monto, 5);
});

test('meta ambigua → candidatas', () => {
  const r = parseQuickAdd('meta viaje S/5', {
    hoy: HOY, ctx: { metas: [{ id: 'a', nombre: 'Viaje Cusco' }, { id: 'b', nombre: 'Viaje Lima' }] },
  });
  assert.equal(r.metaError, 'ambigua');
  assert.deepEqual(r.metaCandidatas, ['Viaje Cusco', 'Viaje Lima']);
});

test('REGRESION: sin la palabra "meta" nada cambia', () => {
  const r = pm('uber 15');
  assert.equal(r.tipo, 'gasto');
  assert.equal(r.monto, 15);
  assert.equal(r.meta_id, undefined);
});

test('REGRESION: "ahorro hogar S/100" sigue igual (ya funcionaba)', () => {
  const r = pm('ahorro hogar S/100');
  assert.equal(r.tipo, 'ahorro');
  assert.equal(r.ambito, 'hogar');
  assert.equal(r.monto, 100);
  assert.equal(r.meta_id, undefined);
});
