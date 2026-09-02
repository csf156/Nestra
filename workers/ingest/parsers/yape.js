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
  normalizar, lineasPlanas, parseMonto, parseFechaLarga,
  fechaEnLima, campoTrasEtiqueta,
} from './utils.js';
import { FormatoNoReconocidoError } from './errores.js';

const slug = 'yape';

function parse({ subject, body, date }) {
  const subj = normalizar(subject).toLowerCase();
  const nbody = normalizar(body);
  const ls = lineasPlanas(body);

  // Ruido confirmado: no son movimientos → null.
  if (/afiliacion/.test(subj) || /bienvenida a su billetera/i.test(nbody)) {
    return null;
  }

  // Yapeo SALIENTE → gasto.
  // El asunto "Por tu seguridad, te notificaremos por cada yapeo que realices"
  // NO es ruido (es el estándar de cada yapeo), pero TAMPOCO define la
  // dirección: la decide el cuerpo, que sí es inequívoco.
  if (/Acabas de yapear/i.test(nbody)) {
    // Yape marca las etiquetas con asteriscos de negrita ("*Monto de yapeo**")
    // y manda el valor dos líneas abajo. Sin limpiar los asteriscos, el ancla
    // de campoTrasEtiqueta no matchea y el monto sale null: eso mandó los 11
    // correos de Yape a 'revisar-manual' entre agosto y setiembre de 2026.
    const monto = parseMonto(campoTrasEtiqueta(ls, 'Monto de yapeo'));
    // Varios campos vienen aplastados en un solo renglón: se leen del cuerpo
    // plano acotando cada valor con la etiqueta siguiente.
    const plano = nbody.replace(/\s+/g, ' ');
    const mFecha = plano.match(/Fecha y Hora de la operacion\s+(.+?)\s+Celular del Beneficiario/i);
    const fecha = parseFechaLarga(mFecha ? mFecha[1] : '') || fechaEnLima(date);
    if (!monto || !fecha) throw new FormatoNoReconocidoError(slug, 'yapeo saliente sin monto/fecha');

    // "Nombre del Beneficiario" solo sirve como comercio si NO es el titular:
    // en los correos de julio de 2026 traía a la dueña de la cuenta (igual que
    // "Yapero"), y en los de agosto trae el comercio real. Comparar contra el
    // yapero resuelve los dos casos sin adivinar.
    const mBenef = plano.match(/Nombre del Beneficiario\s+(.+?)\s+N.? de operacion/i);
    const mYapero = plano.match(/Yapero\s+(.+?)\s+Tu numero de celular/i);
    const benef = mBenef ? mBenef[1].trim() : null;
    const yapero = mYapero ? mYapero[1].trim() : null;
    const comercio = (benef && benef !== yapero) ? benef : null;

    const mOp = plano.match(/N.? de operacion\s+(\d+)/i);
    return {
      banco: slug, tipo: 'gasto', monto, moneda: 'PEN',
      comercio, fecha, contraparte: comercio,
      operacion: mOp ? mOp[1] : null,
      p2p: true, ultimos4: null,
    };
  }

  // Remitente Yape con formato no verificado (entrantes, recargas, pagos en
  // apps) → a revisión manual, en vez de adivinar la dirección del dinero.
  throw new FormatoNoReconocidoError(slug, `formato no reconocido: ${subj.slice(0, 80)}`);
}

export { slug, parse };
