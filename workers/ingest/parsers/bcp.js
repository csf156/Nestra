// bcp.js — parser de correos del BCP (notificaciones@notificacionesbcp.com.pe).
//
// Formatos verificados contra correo real (2026-07-14):
//   `Realizaste un consumo ... Tarjeta de Débito BCP` → gasto
//   `Constancia de recepción de Yapeo a celular`      → ingreso
//
// Ruido confirmado (null): códigos OTP / validación (ej. OTP Apple Pay).
// No verificado (FormatoNoReconocidoError → 'revisar-manual'):
//   "Se ha devuelto el monto de S/ X" (devolución → ingreso).

import {
  normalizar, lineas, parseMonto, parseFechaLarga,
  fechaEnLima, campoInline, ultimos4De,
} from './utils.js';
import { FormatoNoReconocidoError } from './errores.js';

const slug = 'bcp';

function parse({ subject, body, date }) {
  const subj = normalizar(subject).toLowerCase();
  const nbody = normalizar(body);
  const ls = lineas(body);

  // Ruido confirmado: códigos OTP / validación. No es movimiento → null.
  if (/\botp\b/i.test(subj) || /codigo de validacion/i.test(nbody)) {
    return null;
  }

  // Consumo con tarjeta de débito.
  // "Realizaste un consumo de S/ 52.00 con tu Tarjeta de Debito BCP en PLIN-Christian Sanchez."
  if (/realizaste un consumo/.test(subj)) {
    const m = nbody.match(/Realizaste un consumo de\s*S\/\s*([\d.,]+)\s+con tu Tarjeta de D[eé]bito BCP en\s+([^\n.]+)/i);
    if (!m) throw new FormatoNoReconocidoError(slug, 'consumo sin frase "Realizaste un consumo"');
    const monto = parseMonto(m[1]);
    // "Empresa X" es más limpio que el nombre embebido en la frase.
    const comercio = campoInline(ls, 'Empresa') || m[2].trim();
    const fecha = parseFechaLarga(campoInline(ls, 'Fecha y hora') || '') || fechaEnLima(date);
    if (!monto || !fecha) throw new FormatoNoReconocidoError(slug, 'consumo sin monto/fecha');
    // "Número de Tarjeta de Débito ************5632"
    const ultimos4 = ultimos4De(campoInline(ls, 'Numero de Tarjeta de Debito'));
    // El BCP rutea los PLIN/yapeos como "consumo" con la empresa
    // "PLIN-<persona>" / "YAPE-<persona>": transferencia entre personas.
    const p2p = /^(PLIN|YAPE)\s*-/i.test(comercio || '');
    return {
      banco: slug, tipo: 'gasto', monto, moneda: 'PEN',
      comercio, fecha,
      contraparte: p2p ? comercio.replace(/^(PLIN|YAPE)\s*-\s*/i, '') : comercio,
      operacion: campoInline(ls, 'Numero de operacion'),
      p2p, ultimos4,
    };
  }

  // Yapeo recibido → ingreso. Imprescindible para que el modelo simétrico
  // cuadre: si el que envía registra gasto y el que recibe no registra
  // ingreso, los gastos del receptor quedan inflados (ver plan).
  // "Recibiste un yapeo de S/ 60.00 de Ruesta Pastor Ariana."
  if (/recepcion de yapeo/.test(subj) || /Recibiste un yapeo/i.test(nbody)) {
    const m = nbody.match(/Recibiste un yapeo de\s*S\/\s*([\d.,]+)\s+de\s+([^\n.]+)/i);
    const monto = parseMonto(m ? m[1] : campoInline(ls, 'Monto recibido'));
    const emisor = campoInline(ls, 'Enviado por') || (m ? m[2].trim() : null);
    const fecha = parseFechaLarga(campoInline(ls, 'Fecha y hora') || '') || fechaEnLima(date);
    if (!monto || !fecha) throw new FormatoNoReconocidoError(slug, 'yapeo recibido sin monto/fecha');
    return {
      banco: slug, tipo: 'ingreso', monto, moneda: 'PEN',
      comercio: emisor, fecha, contraparte: emisor,
      operacion: campoInline(ls, 'Numero de operacion'),
      p2p: true, ultimos4: null,
    };
  }

  // Remitente BCP con formato no verificado (ej. devoluciones) → a revisión.
  throw new FormatoNoReconocidoError(slug, `asunto no reconocido: ${subj.slice(0, 80)}`);
}

export { slug, parse };
