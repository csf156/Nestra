// index.js — registro de parsers por banco_slug + router por remitente.
//
// parse(slug, correo)  → propuesta | null | throw FormatoNoReconocidoError
//   Rutea directo al módulo del banco. Slug desconocido = error de
//   programación (throw Error a secas), no de formato.
//
// parseCorreo({from, subject, body, date}) → propuesta | null | throw
//   Detecta el banco por el remitente y delega. Remitente desconocido → null
//   (no es un correo bancario nuestro; se ignora y se loguea).
//
// Contrato de cada módulo de banco ({slug, parse}):
//   propuesta                  → { banco, tipo, monto, moneda, comercio,
//                                  fecha, contraparte, operacion, p2p, ultimos4 }
//   null                       → ruido confirmado o no-transacción (rechazo, OTP)
//   FormatoNoReconocidoError   → remitente bancario con formato no verificado;
//                                el Worker lo encola como 'revisar-manual'.
//
// La categoría NO se infiere acá: la sugiere la PWA con js/autocat.js (mapa
// aprendido en IndexedDB, inalcanzable desde el Worker) — ver plan 2026-07-14.

import * as bbva from './bbva.js';
import * as bcp from './bcp.js';
import * as yape from './yape.js';
import { FormatoNoReconocidoError } from './errores.js';
import {
  normalizar, parseMonto, parseFechaLarga, parseFechaCorta, fechaEnLima,
  campoTrasEtiqueta, campoInline, ultimos4De, esAnteriorAlCorte,
} from './utils.js';

const PARSERS = Object.freeze({
  [bbva.slug]: bbva,
  [bcp.slug]: bcp,
  [yape.slug]: yape,
});

// Dominio del remitente → slug. Whitelist: lo que no está acá no es nuestro.
const REMITENTES = [
  ['bbva.com.pe', bbva.slug],
  ['notificacionesbcp.com.pe', bcp.slug],
  ['yape.pe', yape.slug],
];

function parse(slug, correo) {
  const mod = PARSERS[slug];
  if (!mod) throw new Error(`banco no registrado: ${slug}`);
  return mod.parse(correo);
}

function bancoDesdeRemitente(from) {
  const f = normalizar(from).toLowerCase();
  for (const [dominio, slug] of REMITENTES) {
    if (f.includes(dominio)) return slug;
  }
  return null;
}

function parseCorreo({ from, subject, body, date }) {
  if (!from || !body) return null;
  const slug = bancoDesdeRemitente(from);
  if (!slug) return null;
  return parse(slug, { subject, body, date });
}

export {
  PARSERS, parse, parseCorreo, bancoDesdeRemitente, FormatoNoReconocidoError,
  // helpers puros re-exportados para los tests
  normalizar, parseMonto, parseFechaLarga, parseFechaCorta, fechaEnLima,
  campoTrasEtiqueta, campoInline, ultimos4De, esAnteriorAlCorte,
};
