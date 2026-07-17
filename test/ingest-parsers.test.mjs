// test/ingest-parsers.test.mjs
// Los cuerpos son fragmentos VERBATIM de correos reales capturados el
// 2026-07-14 de las bandejas de Christian (BBVA) y Darling (BCP/Yape).
// No inventar cuerpos: si un formato no está verificado, el parser debe
// devolver null a propósito.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCorreo, parse, PARSERS, FormatoNoReconocidoError,
  parseMonto, parseFechaLarga, parseFechaCorta, fechaEnLima, esAnteriorAlCorte,
} from '../workers/ingest/parsers/index.js';

const BBVA = 'BBVA <procesos@bbva.com.pe>';
const BCP = 'BCP Notificaciones <notificaciones@notificacionesbcp.com.pe>';
const YAPE = 'YAPE Notificaciones <notificaciones@yape.pe>';

// ── helpers ──────────────────────────────────────────────────────
test('parseMonto: decimales y miles', () => {
  assert.equal(parseMonto('52.00'), 52);
  assert.equal(parseMonto('S/ 1,234.56'), 1234.56);
  assert.equal(parseMonto('20.00'), 20);
  assert.equal(parseMonto(''), null);
  assert.equal(parseMonto('0'), null);
});

test('parseFechaLarga: variantes reales de los tres bancos', () => {
  assert.equal(parseFechaLarga('23 de junio de 2026 - 06:03 PM'), '2026-06-23');
  assert.equal(parseFechaLarga('10 junio 2026 - 07:08 a. m.'), '2026-06-10');
  assert.equal(parseFechaLarga('12 de julio, 2026 15:44'), '2026-07-12');
  assert.equal(parseFechaLarga('setiembre'), null);
});

test('parseFechaCorta: DD/MM/YYYY (no MM/DD)', () => {
  assert.equal(parseFechaCorta('06/07/2026'), '2026-07-06');
  assert.equal(parseFechaCorta('11/07/2026'), '2026-07-11');
});

test('fechaEnLima: 23:04 Lima no se corre al día siguiente', () => {
  // 2026-07-12T04:04:00Z == 2026-07-11 23:04 en Lima (UTC-5).
  assert.equal(fechaEnLima('2026-07-12T04:04:35.000Z'), '2026-07-11');
});

// ── BBVA consumo ─────────────────────────────────────────────────
const BBVA_CONSUMO_USD = `Hola, CHRISTIAN
Has realizado el siguiente consumo:

Comercio:

ANTHROPIC* CLAUDE

Monto:

20.00

Moneda:

USD

Fecha:

06/07/2026

Hora:

17:22:47

Este se cargará a tu tarjeta terminada en *1902`;

test('BBVA consumo USD: monto, comercio, moneda y fecha del cuerpo', () => {
  const r = parseCorreo({
    from: BBVA, subject: 'Has realizado un consumo con tu tarjeta BBVA',
    body: BBVA_CONSUMO_USD, date: '2026-07-06T22:22:47.000Z',
  });
  assert.equal(r.banco, 'bbva');
  assert.equal(r.tipo, 'gasto');
  assert.equal(r.monto, 20);
  assert.equal(r.moneda, 'USD');
  assert.equal(r.comercio, 'ANTHROPIC* CLAUDE');
  assert.equal(r.fecha, '2026-07-06');
});

const BBVA_CONSUMO_PEN = `Hola, CHRISTIAN
Has realizado el siguiente consumo:

Comercio:

CAPITANNA FUSION

Monto:

62.00

Moneda:

PEN

Fecha:

11/07/2026

Hora:

23:04:35`;

test('BBVA consumo PEN', () => {
  const r = parseCorreo({
    from: BBVA, subject: 'Has realizado un consumo con tu tarjeta BBVA',
    body: BBVA_CONSUMO_PEN, date: '2026-07-12T04:04:35.000Z',
  });
  assert.equal(r.monto, 62);
  assert.equal(r.moneda, 'PEN');
  assert.equal(r.comercio, 'CAPITANNA FUSION');
  // La fecha del cuerpo manda sobre la del correo (que en UTC sería el 12).
  assert.equal(r.fecha, '2026-07-11');
});

// ── BBVA rechazo: la trampa ──────────────────────────────────────
const BBVA_RECHAZO = `Hola, CHRISTIAN
Tu compra ha sido rechazada.
DETALLES DE OPERACIÓN

Comercio
ZOLUTIUM

Monto
10.01

Moneda
USD

Fecha
05/07/2026

Hora
16:05:34

Últimos digitos de tarjeta
*1902

Le recordamos que esta compra no se cargará a su tarjeta.`;

test('BBVA rechazo → null (NO es un gasto)', () => {
  const r = parseCorreo({
    from: BBVA, subject: 'La compra con tu tarjeta BBVA ha sido rechazada',
    body: BBVA_RECHAZO, date: '2026-07-05T21:05:34.000Z',
  });
  assert.equal(r, null);
});

test('BBVA rechazo → null aunque el asunto mienta (gate por cuerpo)', () => {
  const r = parseCorreo({
    from: BBVA, subject: 'Has realizado un consumo con tu tarjeta BBVA',
    body: BBVA_RECHAZO, date: '2026-07-05T21:05:34.000Z',
  });
  assert.equal(r, null);
});

// ── BBVA PLIN ────────────────────────────────────────────────────
const BBVA_PLIN = `Hola, CHRISTIAN

Plineaste S/ 20.00 a EDUARDO ALONSO DIAZ

Detalles de tu plineo

Celular: •1390
Destino: Plin
ITF: S/ 0.00
Fecha y hora: 12 de julio, 2026 15:44
Número de operación: AE60109FD2A9`;

test('BBVA PLIN: monto, destino como contraparte, fecha larga', () => {
  const r = parseCorreo({
    from: BBVA, subject: 'Constancia de operación transferencia PLIN',
    body: BBVA_PLIN, date: '2026-07-12T20:44:00.000Z',
  });
  assert.equal(r.banco, 'bbva');
  assert.equal(r.tipo, 'gasto');
  assert.equal(r.monto, 20);
  assert.equal(r.comercio, 'EDUARDO ALONSO DIAZ');
  assert.equal(r.contraparte, 'EDUARDO ALONSO DIAZ');
  assert.equal(r.fecha, '2026-07-12');
});

test('BBVA PLIN con QR: mismo parser', () => {
  const r = parseCorreo({
    from: BBVA, subject: 'Constancia de operación transferencia PLIN con QR',
    body: 'Hola, CHRISTIAN\n\nPlineaste S/ 6.00 a Luis P Cupe O De\n\nFecha y hora: 14 de julio, 2026 13:04',
    date: '2026-07-14T18:04:00.000Z',
  });
  assert.equal(r.monto, 6);
  assert.equal(r.comercio, 'Luis P Cupe O De');
});

// ── BCP consumo ──────────────────────────────────────────────────
const BCP_CONSUMO = `Hola Darling Gabriela,

Realizaste un consumo de S/ 52.00 con tu Tarjeta de Débito BCP en PLIN-Christian Sanchez.

Por tu seguridad, te enviamos los datos de tu operación.

Monto

Total del consumo S/ 52.00

Datos de la operación

Operación realizada Consumo Tarjeta de Débito
Fecha y hora 23 de junio de 2026 - 06:03 PM
Número de Tarjeta de Débito ************5632
Empresa PLIN-Christian Sanchez
Número de operación 800598`;

test('BCP consumo: usa "Empresa" como comercio y fecha larga', () => {
  const r = parseCorreo({
    from: BCP, subject: 'Realizaste un consumo con tu Tarjeta de Débito BCP - Servicio de Notificaciones BCP',
    body: BCP_CONSUMO, date: '2026-06-23T23:03:00.000Z',
  });
  assert.equal(r.banco, 'bcp');
  assert.equal(r.tipo, 'gasto');
  assert.equal(r.monto, 52);
  assert.equal(r.moneda, 'PEN');
  assert.equal(r.comercio, 'PLIN-Christian Sanchez');
  assert.equal(r.fecha, '2026-06-23');
});

test('BCP consumo PLIN-: p2p true y contraparte sin el prefijo del canal', () => {
  const r = parseCorreo({
    from: BCP, subject: 'Realizaste un consumo con tu Tarjeta de Débito BCP',
    body: BCP_CONSUMO, date: '2026-06-23T23:03:00.000Z',
  });
  assert.equal(r.p2p, true);
  // "PLIN-Christian Sanchez" → la contraparte es la persona, no el canal.
  assert.equal(r.contraparte, 'Christian Sanchez');
  // Modelo simétrico: sale plata → gasto, sin importar a quién ni por qué.
  assert.equal(r.tipo, 'gasto');
});

test('BCP consumo en comercio real: p2p false (nunca es liquidación)', () => {
  const body = BCP_CONSUMO
    .replace(/PLIN-Christian Sanchez/g, 'SUPERMERCADO CANDY 3');
  const r = parseCorreo({
    from: BCP, subject: 'Realizaste un consumo con tu Tarjeta de Débito BCP',
    body, date: '2026-06-23T23:03:00.000Z',
  });
  assert.equal(r.p2p, false);
  assert.equal(r.comercio, 'SUPERMERCADO CANDY 3');
});

test('BBVA consumo en comercio: p2p false; PLIN y yapeo: p2p true', () => {
  const consumo = parseCorreo({
    from: BBVA, subject: 'Has realizado un consumo con tu tarjeta BBVA',
    body: BBVA_CONSUMO_PEN, date: '2026-07-12T04:04:35.000Z',
  });
  assert.equal(consumo.p2p, false);

  const plin = parseCorreo({
    from: BBVA, subject: 'Constancia de operación transferencia PLIN',
    body: BBVA_PLIN, date: '2026-07-12T20:44:00.000Z',
  });
  assert.equal(plin.p2p, true);

  const yapeo = parseCorreo({
    from: YAPE, subject: 'Por tu seguridad, te notificaremos por cada yapeo que realices',
    body: YAPE_YAPEO, date: '2026-06-10T12:08:00.000Z',
  });
  assert.equal(yapeo.p2p, true);
});

test('Yape: cuerpo saliente sin asunto reconocible → igual se parsea', () => {
  // El gate es el cuerpo: si Yape cambia el asunto, el parser sigue andando.
  const r = parseCorreo({
    from: YAPE, subject: 'Otro asunto cualquiera',
    body: YAPE_YAPEO, date: '2026-06-10T12:08:00.000Z',
  });
  assert.equal(r.tipo, 'gasto');
  assert.equal(r.monto, 50);
});

test('BCP sin tildes (el banco avisa que puede mandarlos así) → parsea igual', () => {
  const r = parseCorreo({
    from: BCP, subject: 'Realizaste un consumo con tu Tarjeta de Debito BCP',
    body: BCP_CONSUMO.normalize('NFD').replace(/[̀-ͯ]/g, ''),
    date: '2026-06-23T23:03:00.000Z',
  });
  assert.equal(r.monto, 52);
  assert.equal(r.comercio, 'PLIN-Christian Sanchez');
});

// ── BCP yapeo recibido (el otro lado del modelo simétrico) ───────
const BCP_YAPEO_RECIBIDO = `Hola Darling Gabriela,

Recibiste un yapeo de S/ 60.00 de Ruesta Pastor Ariana.

Por tu seguridad te enviamos los datos de tu yapeo.

Monto

Monto recibido S/ 60.00

Datos de la operación

Operación realizada Yapeo a celular
Fecha y hora 18 de junio de 2026 - 04:01 PM
Enviado por Ruesta Pastor Ariana`;

test('BCP yapeo recibido → ingreso, con el emisor como contraparte', () => {
  const r = parseCorreo({
    from: BCP, subject: 'Constancia de recepción de Yapeo a celular BCP - Servicio de Notificaciones BCP',
    body: BCP_YAPEO_RECIBIDO, date: '2026-06-18T21:01:00.000Z',
  });
  assert.equal(r.banco, 'bcp');
  assert.equal(r.tipo, 'ingreso');
  assert.equal(r.monto, 60);
  assert.equal(r.contraparte, 'Ruesta Pastor Ariana');
  assert.equal(r.fecha, '2026-06-18');
});

test('modelo simétrico: la misma transferencia da gasto al emisor e ingreso al receptor', () => {
  // Christian plinea S/ 5 a Darling (saldando su parte de un gasto común).
  const ladoEmisor = parseCorreo({
    from: BBVA, subject: 'Constancia de operación transferencia PLIN',
    body: 'Hola, CHRISTIAN\n\nPlineaste S/ 5.00 a DARLING GABRIELA MEZA\n\nFecha y hora: 14 de julio, 2026 13:04',
    date: '2026-07-14T18:04:00.000Z',
  });
  // Darling lo recibe.
  const ladoReceptor = parseCorreo({
    from: BCP, subject: 'Constancia de recepción de Yapeo a celular BCP',
    body: BCP_YAPEO_RECIBIDO.replace(/60\.00/g, '5.00').replace(/Ruesta Pastor Ariana/g, 'Christian Sanchez'),
    date: '2026-07-14T18:04:00.000Z',
  });

  assert.equal(ladoEmisor.tipo, 'gasto');
  assert.equal(ladoEmisor.monto, 5);
  assert.equal(ladoReceptor.tipo, 'ingreso');
  assert.equal(ladoReceptor.monto, 5);
  // Neto del hogar = 0: la plata no salió de la pareja.
  assert.equal(ladoReceptor.monto - ladoEmisor.monto, 0);
});

// ── Yape ─────────────────────────────────────────────────────────
const YAPE_YAPEO = `¡Hola, DARLING GABRIELA MEZA R.!

¡Acabas de yapear exitosamente!

Monto de yapeo*

S/ 50.00
Yapero DARLING GABRIELA MEZA R.
Tu número de celular XXXXXXXXX153
Fecha y Hora de la operación 10 junio 2026 - 07:08 a. m.
Celular del Beneficiario XXXXXXXXX153
Nombre del Beneficiario DARLING GABRIELA MEZA R.
Nº de operación 8308457`;

test('Yape yapeo saliente: el asunto "cada yapeo que realices" es transacción, no ruido', () => {
  const r = parseCorreo({
    from: YAPE, subject: 'Por tu seguridad, te notificaremos por cada yapeo que realices',
    body: YAPE_YAPEO, date: '2026-06-10T12:08:00.000Z',
  });
  assert.equal(r.banco, 'yape');
  assert.equal(r.tipo, 'gasto');
  assert.equal(r.monto, 50);
  assert.equal(r.fecha, '2026-06-10');
  // "Nombre del Beneficiario" trae a la dueña de la cuenta, no a quien recibió
  // → no se usa como contraparte hasta poder verificarlo con un tercero.
  assert.equal(r.contraparte, null);
  assert.equal(r.comercio, null);
});

test('Yape: la dirección la decide el cuerpo, no el asunto', () => {
  // Mismo asunto de siempre, pero el cuerpo NO dice "Acabas de yapear":
  // no se puede afirmar que sea saliente → error tipado (el Worker lo encola
  // como revisar-manual), en vez de registrar un ingreso como si fuera gasto.
  assert.throws(() => parseCorreo({
    from: YAPE, subject: 'Por tu seguridad, te notificaremos por cada yapeo que realices',
    body: YAPE_YAPEO.replace('¡Acabas de yapear exitosamente!', '¡Te han yapeado!'),
    date: '2026-06-10T12:08:00.000Z',
  }), FormatoNoReconocidoError);
});

// ── Ruido y formatos no verificados → null ───────────────────────
test('ruido: OTP de Apple Pay → null', () => {
  const r = parseCorreo({
    from: BCP, subject: 'ENVIO AUTOMATICO - CONSTANCIA DE ENVIO DE OTP APPLE PAY',
    body: 'Hola MEZA REYES DARLING GABRIELA, Este es tu codigo de validacion 632738.',
    date: '2026-06-11T12:00:00.000Z',
  });
  assert.equal(r, null);
});

test('ruido: afiliación PEDIDOS YA → null', () => {
  const r = parseCorreo({
    from: YAPE, subject: '¡Tu afiliación en PEDIDOS YA fue exitosa!',
    body: 'Has agregado exitosamente tu cuenta Yape con BCP a PEDIDOS YA.',
    date: '2026-06-13T12:00:00.000Z',
  });
  assert.equal(r, null);
});

test('remitente desconocido → null', () => {
  const r = parseCorreo({
    from: 'promos@tienda.com', subject: 'Has realizado un consumo con tu tarjeta BBVA',
    body: BBVA_CONSUMO_PEN, date: '2026-07-11T12:00:00.000Z',
  });
  assert.equal(r, null);
});

test('formato no verificado (recarga Yape) → error tipado, no adivinar', () => {
  assert.throws(() => parseCorreo({
    from: YAPE, subject: 'Tu recarga en Yape ha sido confirmada',
    body: 'S/ 6 Número recargado: 910 735 153 Yapero: Darling Gabriela Meza Reyes',
    date: '2026-06-22T22:51:00.000Z',
  }), FormatoNoReconocidoError);
});

test('formato no verificado (devolución BCP) → error tipado, no adivinar', () => {
  try {
    parseCorreo({
      from: BCP, subject: 'Realizamos una devolución de una operación a tu Tarjeta de Débito BCP',
      body: 'Hola Darling Gabriela,\n\nSe ha devuelto el monto de S/ 5.00 a tu cuenta BCP.',
      date: '2026-01-09T12:00:00.000Z',
    });
    assert.fail('debió lanzar FormatoNoReconocidoError');
  } catch (e) {
    // El error carga el banco: el Worker lo necesita para la fila revisar-manual.
    assert.equal(e.name, 'FormatoNoReconocidoError');
    assert.equal(e.banco, 'bcp');
  }
});

// ── corte de fecha (no importar correos anteriores a la puesta en vivo) ──
test('esAnteriorAlCorte: viejo → true, nuevo/igual → false', () => {
  assert.equal(esAnteriorAlCorte('2026-07-14T23:59:59Z', '2026-07-15T00:00:00Z'), true);
  assert.equal(esAnteriorAlCorte('2026-07-15T00:00:00Z', '2026-07-15T00:00:00Z'), false);
  assert.equal(esAnteriorAlCorte('2026-07-16T10:00:00Z', '2026-07-15T00:00:00Z'), false);
});

test('esAnteriorAlCorte: sin fecha o corte inválido → false (se ingesta, no se pierde)', () => {
  assert.equal(esAnteriorAlCorte(null, '2026-07-15T00:00:00Z'), false);
  assert.equal(esAnteriorAlCorte('no es fecha', '2026-07-15T00:00:00Z'), false);
  assert.equal(esAnteriorAlCorte('2026-07-01T00:00:00Z', ''), false);
  assert.equal(esAnteriorAlCorte('2026-07-01T00:00:00Z', 'basura'), false);
});

// ── ultimos4 ─────────────────────────────────────────────────────
test('ultimos4: BBVA consumo ("tarjeta terminada en *1902") → "1902"', () => {
  const r = parseCorreo({
    from: BBVA, subject: 'Has realizado un consumo con tu tarjeta BBVA',
    body: BBVA_CONSUMO_USD, date: '2026-07-06T22:22:47.000Z',
  });
  assert.equal(r.ultimos4, '1902');
});

test('ultimos4: BCP consumo ("************5632") → "5632"', () => {
  const r = parseCorreo({
    from: BCP, subject: 'Realizaste un consumo con tu Tarjeta de Débito BCP',
    body: BCP_CONSUMO, date: '2026-06-23T23:03:00.000Z',
  });
  assert.equal(r.ultimos4, '5632');
});

test('ultimos4: PLIN y yapeo no traen tarjeta → null', () => {
  const plin = parseCorreo({
    from: BBVA, subject: 'Constancia de operación transferencia PLIN',
    body: BBVA_PLIN, date: '2026-07-12T20:44:00.000Z',
  });
  assert.equal(plin.ultimos4, null);
  const yapeo = parseCorreo({
    from: YAPE, subject: 'Por tu seguridad, te notificaremos por cada yapeo que realices',
    body: YAPE_YAPEO, date: '2026-06-10T12:08:00.000Z',
  });
  assert.equal(yapeo.ultimos4, null);
});

test('ultimos4: BBVA consumo sin la línea de tarjeta → null (no crashea)', () => {
  const r = parseCorreo({
    from: BBVA, subject: 'Has realizado un consumo con tu tarjeta BBVA',
    body: BBVA_CONSUMO_PEN, date: '2026-07-12T04:04:35.000Z',
  });
  assert.equal(r.ultimos4, null);
});

// ── registry por banco_slug ──────────────────────────────────────
test('PARSERS: un módulo por banco, registrado por slug', () => {
  assert.deepEqual(Object.keys(PARSERS).sort(), ['bbva', 'bcp', 'yape']);
  for (const [slug, mod] of Object.entries(PARSERS)) {
    assert.equal(mod.slug, slug);
    assert.equal(typeof mod.parse, 'function');
  }
});

test('parse(slug, correo): rutea directo al módulo del banco', () => {
  const r = parse('bbva', {
    subject: 'Has realizado un consumo con tu tarjeta BBVA',
    body: BBVA_CONSUMO_USD, date: '2026-07-06T22:22:47.000Z',
  });
  assert.equal(r.banco, 'bbva');
  assert.equal(r.monto, 20);
  assert.equal(r.ultimos4, '1902');
});

test('parse(slug desconocido) → lanza (error de programación, no de formato)', () => {
  assert.throws(() => parse('interbank', { subject: 'x', body: 'y', date: null }));
});
