/**
 * Nestra — Email Ingest Worker (Opción A: Apps Script → HTTP)
 *
 * Recibe POSTs desde Google Apps Script (uno por cuenta Gmail). El token
 * Bearer identifica al usuario: se hashea (SHA-256) y se busca en la tabla
 * `email_ingest_tokens`. NO hay usuarios ni tokens hardcodeados → dar de alta
 * un usuario es insertar una fila, sin tocar este código ni redesplegar.
 *
 * El Worker NO crea transacciones: parsea y encola una propuesta en
 * `ingest_pendientes` para que el usuario la confirme/corrija desde la PWA.
 * Tampoco infiere la categoría — eso lo hace la PWA con js/autocat.js, cuyo
 * mapa aprendido vive en IndexedDB (por dispositivo) y es inalcanzable desde acá.
 *
 * Secrets requeridos (wrangler secret put):
 *   SUPABASE_URL           https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE  service_role JWT (salta RLS; NUNCA en cliente/repo)
 *
 * Logs en vivo: npx wrangler tail nestra-email-ingest
 */

import { parseCorreo, FormatoNoReconocidoError, esAnteriorAlCorte } from '../parsers/index.js';
import { sendWebPush } from '../webpush.js';

/** SHA-256 de un string → hex en minúsculas (mismo formato que la tabla). */
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function headersSupabase(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
    ...extra,
  };
}

/**
 * Resuelve el token Bearer a un user_id consultando email_ingest_tokens.
 * Devuelve { id, user_id } o null.
 */
async function resolverUsuario(request, env) {
  const auth = request.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const url =
    `${env.SUPABASE_URL}/rest/v1/email_ingest_tokens` +
    `?select=id,user_id&revoked=eq.false&token_hash=eq.${tokenHash}`;

  const resp = await fetch(url, { headers: headersSupabase(env) });
  if (!resp.ok) {
    console.error('lookup token falló: HTTP ' + resp.status + ' ' + (await resp.text()));
    return null;
  }
  const rows = await resp.json();
  return rows.length ? rows[0] : null;
}

/** Marca el token como usado (best-effort; no bloquea la respuesta). */
function tocarUltimoUso(env, tokenId) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/email_ingest_tokens?id=eq.${tokenId}`, {
    method: 'PATCH',
    headers: headersSupabase(env, { 'content-type': 'application/json', prefer: 'return=minimal' }),
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  }).catch((e) => console.error('touch last_used_at falló: ' + e));
}

/**
 * Tasa <moneda> → PEN. Devuelve number o null si la API falla.
 * Se usa la tasa de HOY: el trigger corre cada 10 min, así que el correo es
 * fresco. (Al importar historial viejo la tasa sería la de hoy → por eso el
 * monto queda editable en la cola de revisión.)
 * open.er-api.com: sin API key y con soporte PEN (las basadas en ECB no lo tienen).
 */
async function tasaAPen(moneda) {
  try {
    const r = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(moneda)}`);
    if (!r.ok) return null;
    const j = await r.json();
    const t = j && j.rates && j.rates.PEN;
    return typeof t === 'number' && t > 0 ? t : null;
  } catch (e) {
    console.error('tasa de cambio falló: ' + e);
    return null;
  }
}

const redondear2 = (n) => Math.round(n * 100) / 100;

/**
 * huboInsercion(filas) — ¿PostgREST creó realmente la fila?
 *
 * Con `resolution=ignore-duplicates` el INSERT es ON CONFLICT DO NOTHING y la
 * respuesta es 2xx tanto si insertó como si ignoró el duplicado. Con
 * `return=representation` la diferencia sí es visible: la fila creada viene en
 * un array, y un duplicado ignorado devuelve el array vacío.
 *
 * Importa porque el Apps Script reenvía TODOS los mensajes de un hilo de Gmail
 * cada vez que llega uno nuevo (ver Code.gs). Sin esta distinción, cada gasto
 * nuevo volvía a notificar todos los anteriores del mismo hilo.
 *
 * Ante un cuerpo inesperado devuelve false: una notificación de más es peor que
 * una de menos — la fila ya está encolada y el usuario la verá en #revisar.
 */
function huboInsercion(filas) {
  return Array.isArray(filas) && filas.length > 0;
}
export { huboInsercion };

/**
 * Inserta una fila en ingest_pendientes con dedupe por (user_id, message_id).
 * on_conflict + ignore-duplicates: el script reenvía todos los mensajes de un
 * hilo en cada corrida; el mismo correo no debe encolarse dos veces.
 * Devuelve { response, insertada }:
 *   response  → la Response HTTP para el Apps Script.
 *               200 → el script etiqueta el hilo como procesado.
 *               500 → NO etiqueta y reintenta en la próxima corrida (ej.
 *                     migración de 'revisar-manual' aún sin aplicar: el correo
 *                     no se pierde).
 *   insertada → si la fila es NUEVA. Los duplicados también responden 200 a
 *               propósito: el script solo etiqueta el hilo si TODO le fue bien,
 *               y devolver un no-2xx aquí lo dejaría sin etiquetar para
 *               siempre, reenviándose en bucle. Lo único que cambia con el
 *               duplicado es que no se notifica.
 */
async function insertarPendiente(env, fila, userId, messageId) {
  const resp = await fetch(
    `${env.SUPABASE_URL}/rest/v1/ingest_pendientes?on_conflict=user_id,message_id`,
    {
      method: 'POST',
      headers: headersSupabase(env, {
        'content-type': 'application/json',
        // representation (antes minimal): sin cuerpo no hay forma de saber si
        // el ON CONFLICT DO NOTHING insertó o ignoró, y sin eso se notificaba
        // cada reenvío de hilo. Ver plan 2026-09-04.
        prefer: 'resolution=ignore-duplicates,return=representation',
      }),
      body: JSON.stringify(fila),
    }
  );

  if (!resp.ok) {
    const detalle = await resp.text();
    console.error(JSON.stringify({
      event: 'insert_failed', userId, messageId,
      status: resp.status, detalle,
    }));
    return { response: json({ error: 'insert failed' }, 500), insertada: false };
  }

  const filas = await resp.json().catch(() => null);
  const insertada = huboInsercion(filas);

  console.log(JSON.stringify({
    event: insertada ? 'email_encolado' : 'email_duplicado', userId, messageId,
    banco: fila.banco, tipo: fila.tipo, monto: fila.monto,
    estado: fila.estado || 'pendiente',
    moneda_original: fila.moneda_original || null,
    comercio: fila.comercio, fecha: fila.fecha,
  }));
  return {
    response: json({ ok: true, insertada, tipo: fila.tipo, monto: fila.monto }),
    insertada,
  };
}

/**
 * Push "¿Confirmar gasto?" a las suscripciones del usuario tras encolar un
 * pendiente parseado. Fire-and-forget vía ctx.waitUntil: un fallo de push
 * NUNCA debe tumbar la respuesta al Apps Script (el correo ya quedó encolado).
 */
function avisarPendiente(env, ctx, userId, fila) {
  ctx.waitUntil(
    enviarPushConfirmacion(env, userId, fila).catch((e) =>
      console.error('push confirmación falló: ' + (e && e.stack || e)))
  );
}

async function enviarPushConfirmacion(env, userId, fila) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    console.error('push: faltan secrets VAPID_*');
    return;
  }
  const resp = await fetch(
    `${env.SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${userId}&select=endpoint,p256dh,auth`,
    { headers: headersSupabase(env) }
  );
  if (!resp.ok) { console.error('push: lookup subscriptions falló HTTP ' + resp.status); return; }
  const subs = await resp.json();
  if (!subs.length) return;

  const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
  const payload = {
    title: '¿Confirmar gasto?',
    body: `S/${fila.monto} en ${fila.comercio || fila.contraparte || 'movimiento'}`,
    url: './#revisar',
    // Segunda capa sobre el dedupe de insertarPendiente: un tag por correo hace
    // que un aviso repetido REEMPLACE al anterior en vez de apilarse. Gastos
    // distintos tienen message_id distinto, así que nunca se colapsan entre sí.
    tag: fila.message_id || undefined,
  };

  for (const sub of subs) {
    try {
      const r = await sendWebPush(sub, payload, vapid);
      if (r.status === 410 || r.status === 404) {
        // Suscripción caducada: borrarla, no reintentar.
        await fetch(
          `${env.SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`,
          { method: 'DELETE', headers: headersSupabase(env) }
        );
      } else if (!r.ok) {
        console.error('push: envío falló HTTP ' + r.status + ' ' + (await r.text()));
      }
    } catch (e) {
      console.error('push: excepción al enviar: ' + (e && e.stack || e));
    }
  }
}

export default {
  /**
   * @param {Request} request
   * @param {Record<string, string>} env
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method !== 'POST' || url.pathname !== '/ingest') {
      return json({ error: 'not found' }, 404);
    }
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) {
      console.error('faltan secrets SUPABASE_URL / SUPABASE_SERVICE_ROLE');
      return json({ error: 'server not configured' }, 500);
    }

    const usuario = await resolverUsuario(request, env);
    if (!usuario) return json({ error: 'unauthorized' }, 401);

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'invalid json' }, 400);
    }

    const { messageId, from, subject, date, body } = payload || {};
    if (!messageId || !from || !body) {
      return json({ error: 'missing fields (messageId, from, body)' }, 400);
    }

    ctx.waitUntil(tocarUltimoUso(env, usuario.id));

    // Corte de puesta en vivo: los correos ANTERIORES a INGEST_DESDE no se
    // registran (decisión del usuario 2026-07-15: nada de backlog, solo lo
    // que llegue con la herramienta ya lista). 200 → el script etiqueta el
    // hilo y no lo reintenta. Cinturón además de la etiqueta nestra-procesado:
    // protege si algún día se quita la etiqueta o se amplía newer_than.
    if (esAnteriorAlCorte(date, env.INGEST_DESDE)) {
      console.log(JSON.stringify({
        event: 'email_anterior_al_corte', userId: usuario.user_id, messageId,
        date, corte: env.INGEST_DESDE, subject: subject || null,
      }));
      return json({ ok: true, skipped: true, anteriorAlCorte: true });
    }

    let prop;
    try {
      prop = parseCorreo({ from, subject, body, date });
    } catch (e) {
      if (e instanceof FormatoNoReconocidoError) {
        // Remitente bancario con formato no verificado: se encola SIN campos
        // parseados (estado 'revisar-manual') para que el usuario lo triagee
        // desde la PWA. Nunca crashea ni pierde el movimiento.
        console.log(JSON.stringify({
          event: 'email_revisar_manual', userId: usuario.user_id, messageId,
          banco: e.banco, motivo: e.motivo, subject: subject || null,
        }));
        // Esta rama nunca notifica (una fila 'revisar-manual' no tiene monto ni
        // comercio que mostrar), así que solo devuelve la respuesta.
        const manual = await insertarPendiente(env, {
          user_id: usuario.user_id,
          message_id: messageId,
          banco: e.banco,
          estado: 'revisar-manual',
          tipo: null,
          monto: null,
          fecha: null,
          comercio: null,
          contraparte: null,
          raw_subject: subject || null,
          raw_body: String(body).slice(0, 20000),
        }, usuario.user_id, messageId);
        return manual.response;
      }
      // Bug inesperado del parser: se loguea y se responde 200 para que el
      // script no reintente eternamente un correo que siempre va a fallar.
      console.error(JSON.stringify({
        event: 'parser_crash', userId: usuario.user_id, messageId,
        error: String(e && e.stack || e), subject: subject || null,
      }));
      return json({ ok: true, skipped: true, parserCrash: true });
    }

    // Ruido confirmado o no-transacción (ej. compra rechazada, OTP).
    // 200 a propósito: el script NO debe reintentar, pero lo logueamos con el
    // asunto para detectar formatos nuevos que haya que soportar.
    if (!prop) {
      console.log(JSON.stringify({
        event: 'email_skipped', userId: usuario.user_id, messageId, from,
        subject: subject || null,
      }));
      return json({ ok: true, skipped: true });
    }

    // Conversión de divisa. Si la API falla, se encola igual con el monto en la
    // moneda original y tasa null: la UI pide corregirlo. Preferimos un
    // pendiente marcado a un movimiento perdido.
    let monto = prop.monto;
    let montoOriginal = null;
    let monedaOriginal = null;
    let tasa = null;
    if (prop.moneda && prop.moneda !== 'PEN') {
      montoOriginal = prop.monto;
      monedaOriginal = prop.moneda;
      tasa = await tasaAPen(prop.moneda);
      if (tasa) monto = redondear2(prop.monto * tasa);
    }

    // Modelo simétrico: el tipo sale del parser (gasto si la transferencia
    // sale, ingreso si entra). No se infiere el motivo ni se detecta a la
    // pareja: una transferencia cuadra igual sea saldar un gasto común, un
    // regalo o un préstamo, y así se evita el match por nombre.
    const fila = {
      user_id: usuario.user_id,
      message_id: messageId,
      banco: prop.banco,
      tipo: prop.tipo,
      monto,
      comercio: prop.comercio,
      fecha: prop.fecha,
      contraparte: prop.contraparte,
      monto_original: montoOriginal,
      moneda_original: monedaOriginal,
      tasa_cambio: tasa,
      raw_subject: subject || null,
      raw_body: String(body).slice(0, 20000),
    };

    const { response, insertada } = await insertarPendiente(env, fila, usuario.user_id, messageId);
    // Solo la PRIMERA vez que este correo entra. El Apps Script reenvía todos
    // los mensajes del hilo cada vez que llega uno nuevo (ver Code.gs), y
    // notificar en cada reenvío repetía los gastos anteriores del mismo día.
    if (insertada) avisarPendiente(env, ctx, usuario.user_id, fila);
    return response;
  },
};
