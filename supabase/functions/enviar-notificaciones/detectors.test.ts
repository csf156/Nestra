// Tests de los detectores puros (Fase 6). Runtime-agnostic; aquí se ejecutan con
// `node --experimental-strip-types --test`. detectors.ts no depende de node ni deno.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectarPresupuestos, detectarMetas, detectarPrestamos, detectarRecurrentesProximos,
} from './detectors.ts';

const HOY = new Date('2026-06-23T08:00:00Z');

test('presupuesto: gasto >= límite produce aviso', () => {
  const categorias = [{ id: 'c1', nombre: 'Comida', limite_mensual: 100 }];
  const r = detectarPresupuestos(categorias, new Map([['c1', 120]]), HOY);
  assert.equal(r.length, 1);
  assert.equal(r[0].clave_dedupe, 'presupuesto:c1:2026-06');
  assert.equal(r[0].tipo, 'presupuesto');
});

test('presupuesto: gasto < límite NO produce aviso', () => {
  const categorias = [{ id: 'c1', nombre: 'Comida', limite_mensual: 100 }];
  const r = detectarPresupuestos(categorias, new Map([['c1', 80]]), HOY);
  assert.equal(r.length, 0);
});

test('presupuesto: categoría sin límite (null/0) NO produce aviso', () => {
  const categorias = [
    { id: 'c1', nombre: 'Comida', limite_mensual: null },
    { id: 'c2', nombre: 'Ocio', limite_mensual: 0 },
  ];
  const r = detectarPresupuestos(categorias, new Map([['c1', 500], ['c2', 500]]), HOY);
  assert.equal(r.length, 0);
});

test('meta: en_curso sin aporte este mes produce aviso', () => {
  const metas = [{ id: 'm1', nombre: 'Viaje', estado: 'en_curso', monto_actual: 50, monto_objetivo: 500 }];
  const r = detectarMetas(metas, new Set<string>(), HOY);
  assert.equal(r.length, 1);
  assert.equal(r[0].clave_dedupe, 'meta:m1:2026-06');
});

test('meta: con aporte este mes NO produce aviso', () => {
  const metas = [{ id: 'm1', nombre: 'Viaje', estado: 'en_curso', monto_actual: 50, monto_objetivo: 500 }];
  const r = detectarMetas(metas, new Set(['m1']), HOY);
  assert.equal(r.length, 0);
});

test('meta: ya cumplida NO produce aviso', () => {
  const metas = [{ id: 'm1', nombre: 'Viaje', estado: 'en_curso', monto_actual: 500, monto_objetivo: 500 }];
  const r = detectarMetas(metas, new Set(), HOY);
  assert.equal(r.length, 0);
});

test('prestamo: presté (gasto) >30 días → aviso de cobro', () => {
  const prestamos = [{ id: 'l1', deudor: 'Ana', estado: 'pendiente', fecha: '2026-05-01', monto: 50, tipo: 'gasto' }];
  const r = detectarPrestamos(prestamos, HOY);
  assert.equal(r.length, 1);
  assert.equal(r[0].clave_dedupe, 'prestamo:l1:2026-06');
  assert.equal(r[0].title, 'Préstamo por cobrar');
});

test('prestamo: me prestaron (ingreso) >30 días → aviso de pago', () => {
  const prestamos = [{ id: 'l2', deudor: 'Beto', estado: 'pendiente', fecha: '2026-05-01', monto: 50, tipo: 'ingreso' }];
  const r = detectarPrestamos(prestamos, HOY);
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'Préstamo por pagar');
  assert.equal(r[0].body, 'Le debes a Beto desde hace 53 días.');
});

test('prestamo: pendiente <=30 días NO produce aviso', () => {
  const prestamos = [{ id: 'l1', deudor: 'Ana', estado: 'pendiente', fecha: '2026-06-10', monto: 50, tipo: 'gasto' }];
  const r = detectarPrestamos(prestamos, HOY);
  assert.equal(r.length, 0);
});

test('recurrente: proximo_cargo dentro de 3 días produce aviso', () => {
  const recs = [{ id: 'r1', descripcion: 'Netflix', monto: 15, tipo: 'gasto', activo: true, proximo_cargo: '2026-06-25' }];
  const r = detectarRecurrentesProximos(recs, HOY);
  assert.equal(r.length, 1);
  assert.equal(r[0].clave_dedupe, 'recurrente:r1:2026-06');
  assert.equal(r[0].tipo, 'recurrente');
  assert.equal(r[0].title, 'Cargo recurrente próximo');
  assert.equal(r[0].body, 'Netflix ($15) se cobra el 2026-06-25.');
});

test('recurrente: proximo_cargo hoy produce aviso', () => {
  const recs = [{ id: 'r1', descripcion: 'Renta', monto: 500, tipo: 'gasto', activo: true, proximo_cargo: '2026-06-23' }];
  const r = detectarRecurrentesProximos(recs, HOY);
  assert.equal(r.length, 1);
});

test('recurrente: proximo_cargo lejano (>3 días) NO produce aviso', () => {
  const recs = [{ id: 'r1', descripcion: 'Netflix', monto: 15, tipo: 'gasto', activo: true, proximo_cargo: '2026-06-30' }];
  const r = detectarRecurrentesProximos(recs, HOY);
  assert.equal(r.length, 0);
});

test('recurrente: proximo_cargo ya pasado NO produce aviso', () => {
  const recs = [{ id: 'r1', descripcion: 'Netflix', monto: 15, tipo: 'gasto', activo: true, proximo_cargo: '2026-06-20' }];
  const r = detectarRecurrentesProximos(recs, HOY);
  assert.equal(r.length, 0);
});

test('recurrente: inactivo (activo=false) NO produce aviso', () => {
  const recs = [{ id: 'r1', descripcion: 'Netflix', monto: 15, tipo: 'gasto', activo: false, proximo_cargo: '2026-06-25' }];
  const r = detectarRecurrentesProximos(recs, HOY);
  assert.equal(r.length, 0);
});

test('recurrente: sin proximo_cargo (null) NO produce aviso', () => {
  const recs = [{ id: 'r1', descripcion: 'Netflix', monto: 15, tipo: 'gasto', activo: true, proximo_cargo: null }];
  const r = detectarRecurrentesProximos(recs, HOY);
  assert.equal(r.length, 0);
});

test('recurrente: ingreso fijo también produce aviso', () => {
  const recs = [{ id: 'r1', descripcion: 'Sueldo', monto: 1000, tipo: 'ingreso', activo: true, proximo_cargo: '2026-06-24' }];
  const r = detectarRecurrentesProximos(recs, HOY);
  assert.equal(r.length, 1);
  assert.equal(r[0].url, '/#/configuracion');
});
