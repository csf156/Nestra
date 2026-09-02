// bbva.js — parser de correos de BBVA (procesos@bbva.com.pe).
//
// Formatos verificados contra correo real (2026-07-14):
//   `Has realizado un consumo con tu tarjeta BBVA`        → gasto
//   `Constancia de operación transferencia PLIN[ con QR]` → gasto
//   `La compra ... ha sido rechazada`                     → null (NO es gasto)
//
// REGLA: solo se parsean formatos verificados contra un correo real. Lo demás
// lanza FormatoNoReconocidoError → el Worker lo encola como 'revisar-manual'.

import {
  normalizar, lineas, parseMonto, parseFechaLarga, parseFechaCorta,
  fechaEnLima, campoTrasEtiqueta, campoInline, ultimos4De,
} from './utils.js';
import { FormatoNoReconocidoError } from './errores.js';

const slug = 'bbva';

function parse({ subject, body, date }) {
  const subj = normalizar(subject).toLowerCase();
  const nbody = normalizar(body);
  const ls = lineas(body);

  // Rechazo: cuerpo casi idéntico al consumo real (mismas claves, sin dos
  // puntos). Doble gate por asunto Y por la frase del cuerpo. No-transacción
  // confirmada → null, nunca 'revisar-manual'.
  if (/rechazad/.test(subj) || /no se cargar[aá] a su tarjeta/i.test(nbody)) {
    return null;
  }

  // Consumo con tarjeta.
  if (/has realizado un consumo/.test(subj)) {
    const monto = parseMonto(campoTrasEtiqueta(ls, 'Monto:'));
    const comercio = campoTrasEtiqueta(ls, 'Comercio:');
    const moneda = (campoTrasEtiqueta(ls, 'Moneda:') || 'PEN').toUpperCase();
    const fecha = parseFechaCorta(campoTrasEtiqueta(ls, 'Fecha:') || '') || fechaEnLima(date);
    // Asunto reconocido pero cuerpo ilegible = el formato cambió → a revisión.
    if (!monto || !fecha) throw new FormatoNoReconocidoError(slug, 'consumo sin monto/fecha');
    // "Este se cargará a tu tarjeta terminada en *1902"
    const ultimos4 = ultimos4De(nbody.match(/tarjeta terminada en\s+\S+/i)?.[0]);
    // Consumo en comercio: nunca es una liquidación con la pareja.
    return {
      banco: slug, tipo: 'gasto', monto, moneda, comercio: comercio || null,
      fecha, contraparte: null, operacion: null, p2p: false, ultimos4,
    };
  }

  // PLIN (incluye "con QR"): "Plineaste S/ 20.00 a EDUARDO ALONSO DIAZ"
  if (/transferencia plin/.test(subj)) {
    const m = nbody.match(/Plineaste\s+S\/\s*([\d.,]+)\s+a\s+([^\n]+)/i);
    if (!m) throw new FormatoNoReconocidoError(slug, 'PLIN sin frase "Plineaste"');
    const monto = parseMonto(m[1]);
    const destino = m[2].trim().replace(/\.$/, '');
    const fechaTxt = campoInline(ls, 'Fecha y hora:') || '';
    const fecha = parseFechaLarga(fechaTxt) || fechaEnLima(date);
    if (!monto || !fecha) throw new FormatoNoReconocidoError(slug, 'PLIN sin monto/fecha');
    return {
      banco: slug, tipo: 'gasto', monto, moneda: 'PEN',
      comercio: destino, fecha, contraparte: destino,
      operacion: campoInline(ls, 'Numero de operacion:'),
      p2p: true, ultimos4: null,
    };
  }

  // Pago con QR a comercio. Mismo layout que el resto de BBVA: etiqueta en una
  // línea, valor dos líneas abajo — campoTrasEtiqueta ya lo resuelve.
  // OJO: es distinto de "transferencia PLIN con QR" (P2P): acá hay comercio y
  // tarjeta, no una persona destino.
  if (/pago a comercios con qr/.test(subj)) {
    const monto = parseMonto(campoTrasEtiqueta(ls, 'Importe pagado'));
    const fecha = parseFechaLarga(campoTrasEtiqueta(ls, 'Fecha de la operacion') || '')
      || fechaEnLima(date);
    if (!monto || !fecha) throw new FormatoNoReconocidoError(slug, 'QR sin monto/fecha');
    const comercio = campoTrasEtiqueta(ls, 'Comercio');
    return {
      banco: slug, tipo: 'gasto', monto, moneda: 'PEN',
      comercio: comercio || null, fecha, contraparte: null,
      operacion: campoTrasEtiqueta(ls, 'ID de compra'),
      p2p: false,
      ultimos4: ultimos4De(campoTrasEtiqueta(ls, 'Numero de tarjeta')),
    };
  }

  // Remitente BBVA con formato no verificado → a revisión manual.
  throw new FormatoNoReconocidoError(slug, `asunto no reconocido: ${subj.slice(0, 80)}`);
}

export { slug, parse };
