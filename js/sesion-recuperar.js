// js/sesion-recuperar.js — ¿esta pérdida de sesión es recuperable?
// Puro: el evento, la sesión, el error y el estado de red entran como
// argumentos. Carga doble: <script type="module"> (window.*) y ESM en node:test.

// clasificarPerdidaSesion({event, session, error, online}) → 'ok' | 'reintentar' | 'terminal'
//
// Existe porque js/auth.js trataba TODA pérdida de sesión como terminal y
// mandaba a #login. Un fallo de red al refrescar —lo normal cuando el teléfono
// despierta— era indistinguible de un token revocado, y el usuario acababa
// fuera con una sesión que el servidor seguía dando por buena (sus sesiones
// tienen not_after NULL: no caducan).
//
// Sesgo deliberado hacia 'reintentar': equivocarse ahí cuesta un intento
// fallido; equivocarse hacia 'terminal' expulsa a alguien con sesión válida.
function clasificarPerdidaSesion(ctx) {
  const c = ctx || {};
  if (c.session) return 'ok';
  // Cierre explícito del usuario: no hay nada que recuperar.
  if (c.event === 'SIGNED_OUT') return 'terminal';
  if (c.online === false) return 'reintentar';

  const msg = String((c.error && c.error.message) || '').toLowerCase();
  // Solo estos dicen "la credencial ya no sirve". Todo lo demás se reintenta.
  if (msg.includes('refresh token') || msg.includes('invalid token') ||
      msg.includes('jwt expired') || msg.includes('not found')) {
    return 'terminal';
  }
  return 'reintentar';
}

if (typeof window !== 'undefined') {
  window.clasificarPerdidaSesion = clasificarPerdidaSesion;
}
export { clasificarPerdidaSesion };
