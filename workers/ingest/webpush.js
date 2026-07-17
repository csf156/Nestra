/**
 * Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) sin dependencias npm — Web
 * Crypto puro, corre nativo en el runtime de Cloudflare Workers.
 *
 * Reusa el MISMO par de claves VAPID que la Edge Function de Supabase
 * `enviar-notificaciones` (Deno + npm:web-push@3.6.7): formato "raw" —
 * pública = punto EC sin comprimir (65 bytes, 0x04||x||y) en base64url,
 * privada = escalar d (32 bytes) en base64url. Los clientes (`js/push.js`)
 * se suscribieron con esa pública vía `applicationServerKey`; usar un par
 * distinto aquí haría que los push services (FCM/Mozilla) rechacen el envío
 * por no coincidir con la clave con la que se creó la suscripción.
 */

const te = new TextEncoder();

function b64urlToBytes(b64url) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes) {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBytes(...arrs) {
  const len = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

// JWK de la privada VAPID: Web Crypto no importa un escalar EC "raw" para
// ECDSA, exige JWK con x/y — que sí tenemos (son la pública, no secreta).
async function importVapidPrivateKey(privB64url, pubB64url) {
  const d = b64urlToBytes(privB64url);
  const pub = b64urlToBytes(pubB64url); // 0x04 || x(32) || y(32)
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    d: bytesToB64url(d), x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)),
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

// Authorization: vapid t=<JWT ES256>, k=<clave pública> (RFC 8292 §4.1).
async function vapidAuthHeader(endpoint, subject, vapidPublic, vapidPrivate) {
  const origin = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: origin, exp, sub: subject };
  const unsigned = bytesToB64url(te.encode(JSON.stringify(header))) + '.' +
    bytesToB64url(te.encode(JSON.stringify(payload)));
  const key = await importVapidPrivateKey(vapidPrivate, vapidPublic);
  // Web Crypto firma ECDSA ya en formato JOSE (r||s, 64 bytes) — no DER.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(unsigned));
  const jwt = unsigned + '.' + bytesToB64url(new Uint8Array(sig));
  return `vapid t=${jwt}, k=${vapidPublic}`;
}

// Cifra el payload para un suscriptor concreto (p256dh + auth), RFC 8291.
async function encryptPayload(payloadBytes, p256dhB64url, authB64url) {
  const uaPublicRaw = b64urlToBytes(p256dhB64url);
  const authSecret = b64urlToBytes(authB64url);

  const uaPublicKey = await crypto.subtle.importKey(
    'raw', uaPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));

  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, ephemeral.privateKey, 256)
  );

  // ikm = HKDF(salt=auth_secret, ikm=ecdh_secret, info="WebPush: info\0"||ua_pub||as_pub)
  const authInfo = concatBytes(te.encode('WebPush: info\0'), uaPublicRaw, asPublicRaw);
  const ecdhSecretKey = await crypto.subtle.importKey('raw', ecdhSecret, { name: 'HKDF' }, false, ['deriveBits']);
  const ikmBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: authInfo }, ecdhSecretKey, 256
  );
  const ikmKey = await crypto.subtle.importKey('raw', ikmBits, { name: 'HKDF' }, false, ['deriveBits']);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cekBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: te.encode('Content-Encoding: aes128gcm\0') }, ikmKey, 128
  );
  const nonceBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: te.encode('Content-Encoding: nonce\0') }, ikmKey, 96
  );

  const cekKey = await crypto.subtle.importKey('raw', cekBits, { name: 'AES-GCM' }, false, ['encrypt']);
  const plaintextPadded = concatBytes(payloadBytes, new Uint8Array([2])); // delimitador de registro único
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonceBits }, cekKey, plaintextPadded)
  );

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096); // record size, big-endian
  const header = concatBytes(salt, rs, new Uint8Array([asPublicRaw.length]), asPublicRaw);
  return concatBytes(header, ciphertext);
}

/**
 * Envía una notificación push a un suscriptor.
 * @param {{endpoint:string,p256dh:string,auth:string}} sub
 * @param {object} payloadObj — se serializa a JSON y se cifra.
 * @param {{publicKey:string,privateKey:string,subject:string}} vapid
 * @returns {Promise<Response>} la respuesta cruda del push service (revisar status: 201 ok, 410/404 caducada).
 */
export async function sendWebPush(sub, payloadObj, vapid) {
  const payloadBytes = te.encode(JSON.stringify(payloadObj));
  const body = await encryptPayload(payloadBytes, sub.p256dh, sub.auth);
  const authHeader = await vapidAuthHeader(sub.endpoint, vapid.subject, vapid.publicKey, vapid.privateKey);
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  });
}
