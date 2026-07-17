// yape.js — parser de correos de Yape (notificaciones@yape.pe).
//
// Formato verificado contra correo real (2026-07-14):
//   yapeo SALIENTE ("¡Acabas de yapear exitosamente!") → gasto
//
// Ruido confirmado (null): afiliaciones ("¡Tu afiliación en X fue exitosa!"),
// bienvenidas a la billetera.
// No verificado (FormatoNoReconocidoError → 'revisar-manual'): yapeo ENTRANTE
// (los entrantes llegaron vía BCP "Constancia de recepción"), "Tu recarga en
// Yape", "Tu pago en PEDIDOS YA".

import {
  normalizar, lineas, parseMonto, parseFechaLarga,
  fechaEnLima, campoTrasEtiqueta, campoInline,
} from './utils.js';
import { FormatoNoReconocidoError } from './errores.js';

const slug = 'yape';

function parse({ subject, body, date }) {
  const subj = normalizar(subject).toLowerCase();
  const nbody = normalizar(body);
  const ls = lineas(body);

  // Ruido confirmado: no son movimientos → null.
  if (/afiliacion/.test(subj) || /bienvenida a su billetera/i.test(nbody)) {
    return null;
  }

  // Yapeo SALIENTE → gasto.
  // El asunto "Por tu seguridad, te notificaremos por cada yapeo que realices"
  // NO es ruido (es el estándar de cada yapeo), pero TAMPOCO define la
  // dirección: la decide el cuerpo, que sí es inequívoco.
  if (/Acabas de yapear/i.test(nbody)) {
    const monto = parseMonto(campoTrasEtiqueta(ls, 'Monto de yapeo*'));
    const fecha = parseFechaLarga(campoInline(ls, 'Fecha y Hora de la operacion') || '') || fechaEnLima(date);
    if (!monto || !fecha) throw new FormatoNoReconocidoError(slug, 'yapeo saliente sin monto/fecha');

    // OJO: "Nombre del Beneficiario" NO es confiable como contraparte. En los
    // dos correos reales verificados traía a la dueña de la cuenta (igual que
    // "Yapero") y el mismo celular enmascarado, no a quien recibió. Se deja
    // null hasta verificarlo contra un yapeo a un tercero: mejor sin comercio
    // que con el nombre del propio usuario como "comercio" de su gasto.
    return {
      banco: slug, tipo: 'gasto', monto, moneda: 'PEN',
      comercio: null, fecha, contraparte: null,
      operacion: campoInline(ls, 'N.? de operacion'),
      p2p: true, ultimos4: null,
    };
  }

  // Remitente Yape con formato no verificado (entrantes, recargas, pagos en
  // apps) → a revisión manual, en vez de adivinar la dirección del dinero.
  throw new FormatoNoReconocidoError(slug, `formato no reconocido: ${subj.slice(0, 80)}`);
}

export { slug, parse };
