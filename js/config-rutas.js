// config-rutas.js — sub-rutas por barra para #configuracion (#configuracion/categorias, etc.)
// Lógica pura, sin dependencias de DOM, para poder testearla con node:test.
var SUBVISTAS = ['dinero', 'categorias', 'automatismos', 'hogar', 'apariencia', 'cuenta'];

// partirHash(hash) — separa "configuracion/categorias" en base + sub.
// Solo el primer slash importa; cualquier resto se ignora (no se esperan
// rutas de 3 niveles, pero tolerarlas sin romper es más seguro que fallar).
function partirHash(hash) {
  var partes = String(hash == null ? '' : hash).trim().split('/').filter(Boolean);
  return { base: partes[0] || '', sub: partes[1] || '' };
}

function subvistaValida(sub) {
  return SUBVISTAS.indexOf(String(sub || '')) !== -1;
}

if (typeof window !== 'undefined') {
  window.partirHash = partirHash;
  window.subvistaValida = subvistaValida;
  window.CFG_SUBVISTAS = SUBVISTAS;
}

export { partirHash, subvistaValida, SUBVISTAS };
