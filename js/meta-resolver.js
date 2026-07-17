// ─────────────────────────────────────────────────────────────────
// Nestra — meta-resolver.js (Tanda 3, #6)
// Resuelve el nombre que el usuario escribe en el quick-add a una meta.
// Puro: recibe las metas, no consulta la base. Dual-export.
// ─────────────────────────────────────────────────────────────────
'use strict';

import { tokenize } from './autocat.js';

// resolverMeta(nombre, metas) → { meta_id } | { error, candidatas }
//   error ∈ 'sin-nombre' | 'no-encontrada' | 'ambigua'
//
// Casa por tokens reusando tokenize(), que ya baja a minúsculas, quita tildes,
// emoji y stopwords: "alquiler" casa con "Alquiler 🏠" y "maquina" con
// "Máquina de afeitar" sin normalizar nada aparte.
//
// Una meta es candidata si TODOS los tokens escritos están entre los suyos. Por
// tokens y no por subcadena: así "casa" no casa con "Máquina" por accidente, y
// escribir más palabras desambigua en vez de romper.
function resolverMeta(nombre, metas) {
  var buscados = tokenize(nombre || '');
  if (!buscados.length) return { error: 'sin-nombre', candidatas: [] };
  var cand = (metas || []).filter(function (m) {
    var suyos = tokenize(m.nombre || '');
    return buscados.every(function (b) { return suyos.indexOf(b) !== -1; });
  });
  if (cand.length === 1) return { meta_id: cand[0].id };
  if (cand.length === 0) return { error: 'no-encontrada', candidatas: [] };
  return { error: 'ambigua', candidatas: cand.map(function (m) { return m.nombre; }) };
}

if (typeof window !== 'undefined') {
  window.resolverMeta = resolverMeta;
}

export { resolverMeta };
