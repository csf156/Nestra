// test/sesion-recuperar.test.mjs
// Decide si una pérdida de sesión es recuperable. Puro: el estado de red y el
// evento entran como argumentos, nada se lee del entorno.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clasificarPerdidaSesion } from '../js/sesion-recuperar.js';

test('con sesión viva no hay nada que hacer', () => {
  assert.equal(clasificarPerdidaSesion({ event: 'TOKEN_REFRESHED', session: { access_token: 'x' } }), 'ok');
});

test('SIGNED_OUT es terminal: el usuario cerró sesión a propósito', () => {
  assert.equal(clasificarPerdidaSesion({ event: 'SIGNED_OUT', session: null, online: true }), 'terminal');
});

test('sin red es recuperable, nunca terminal', () => {
  // El caso del teléfono que despierta: el token no se pudo refrescar porque
  // no había conexión, no porque la sesión muriera.
  assert.equal(clasificarPerdidaSesion({ event: 'TOKEN_REFRESHED', session: null, online: false }), 'reintentar');
});

test('refresh token inválido es terminal', () => {
  const r = clasificarPerdidaSesion({
    event: 'TOKEN_REFRESHED', session: null, online: true,
    error: { message: 'Invalid Refresh Token: Refresh Token Not Found' },
  });
  assert.equal(r, 'terminal');
});

test('error de red con conexión aparente es recuperable', () => {
  const r = clasificarPerdidaSesion({
    event: 'TOKEN_REFRESHED', session: null, online: true,
    error: { message: 'Failed to fetch' },
  });
  assert.equal(r, 'reintentar');
});

test('error desconocido NO expulsa', () => {
  // Regla de sesgo: equivocarse hacia "reintentar" cuesta un intento fallido;
  // equivocarse hacia "terminal" saca al usuario de una sesión válida.
  const r = clasificarPerdidaSesion({
    event: 'TOKEN_REFRESHED', session: null, online: true,
    error: { message: 'algo rarísimo' },
  });
  assert.equal(r, 'reintentar');
});

test('sin error ni sesión, con red: recuperable', () => {
  assert.equal(clasificarPerdidaSesion({ event: 'USER_UPDATED', session: null, online: true }), 'reintentar');
});
