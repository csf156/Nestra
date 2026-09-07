// test/auth-listo.test.mjs
// Promesa de "auth ya decidió". Pura: sin DOM, sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearGateAuth } from '../js/auth-listo.js';

test('espera hasta que se marque listo, no un tiempo fijo', async () => {
  const g = crearGateAuth();
  let resuelto = false;
  g.cuandoListo().then(() => { resuelto = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(resuelto, false, 'no debe resolver antes de marcarse');
  g.marcarListo();
  await g.cuandoListo();
  assert.equal(resuelto, true);
});

test('marcar listo dos veces no rompe ni re-resuelve', () => {
  const g = crearGateAuth();
  g.marcarListo();
  g.marcarListo();
  assert.equal(g.estaListo(), true);
});

test('si ya está listo, cuandoListo resuelve de inmediato', async () => {
  const g = crearGateAuth();
  g.marcarListo();
  const t0 = Date.now();
  await g.cuandoListo();
  assert.ok(Date.now() - t0 < 50);
});

test('estaListo arranca en false', () => {
  const g = crearGateAuth();
  assert.equal(g.estaListo(), false);
  g.marcarListo(); // limpia el timeout de seguridad para no colgar el proceso
});

test('el timeout de seguridad resuelve aunque nadie marque', async () => {
  // Si initAuth muriera sin marcar, la app no puede quedarse en blanco para
  // siempre: se sigue adelante y el router decidirá con lo que haya.
  const g = crearGateAuth({ timeoutMs: 30 });
  const t0 = Date.now();
  await g.cuandoListo();
  assert.ok(Date.now() - t0 >= 25);
  assert.equal(g.estaListo(), true);
});
