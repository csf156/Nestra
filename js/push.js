// Nestra — Web Push (Fase 6): soporte, permiso, subscribe/unsubscribe y
// prompt contextual. Depende de `supabase` (js/supabase.js), `VAPID_PUBLIC_KEY`
// (js/config.js) y un usuario autenticado.

// VAPID public key Base64 URL-safe → Uint8Array para applicationServerKey.
function _urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// pushSupported() — el navegador soporta SW + Push + Notification.
function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// _currentUserId() — id del usuario autenticado, o null.
async function _currentUserId() {
  try {
    const { data } = await supabase.auth.getUser();
    return data && data.user ? data.user.id : null;
  } catch (_) { return null; }
}

// pushIsSubscribed() — true si hay una suscripción activa en este navegador.
async function pushIsSubscribed() {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

// pushSubscribe() — pide permiso, suscribe y persiste en Supabase.
// NUNCA lanza: cualquier fallo se atrapa y se devuelve un objeto con la razón
// para que el llamador refleje el estado real y dé feedback.
// Returns: { ok, reason } donde reason ∈ 'ok' | 'unsupported' | 'no-session' |
//          'denied' | 'subscribe-error' | 'save-error'.
async function pushSubscribe() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  const userId = await _currentUserId();
  if (!userId) return { ok: false, reason: 'no-session' };

  let permiso;
  try {
    permiso = await Notification.requestPermission();
  } catch (e) {
    // En algunos navegadores requestPermission con callback lanza/rechaza.
    console.error('pushSubscribe requestPermission:', e);
    return { ok: false, reason: 'denied' };
  }
  if (permiso !== 'granted') return { ok: false, reason: 'denied' };

  let sub;
  try {
    const reg = await navigator.serviceWorker.ready;
    sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
  } catch (e) {
    // iOS Safari (sin PWA instalada), VAPID inválida, push service inalcanzable…
    console.error('pushSubscribe subscribe:', e);
    return { ok: false, reason: 'subscribe-error' };
  }

  try {
    const json = sub.toJSON();
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent,
    }, { onConflict: 'endpoint' });
    if (error) { console.error('pushSubscribe upsert:', error.message); return { ok: false, reason: 'save-error' }; }
  } catch (e) {
    console.error('pushSubscribe upsert:', e);
    return { ok: false, reason: 'save-error' };
  }
  return { ok: true, reason: 'ok' };
}

// pushUnsubscribe() — cancela la suscripción local y borra la fila. No lanza.
async function pushUnsubscribe() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    try { await sub.unsubscribe(); } catch (_) {}
    await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  } catch (e) {
    console.error('pushUnsubscribe:', e);
  }
}

// pushOfrecerContextual(clave, mensaje) — ofrece activar push UNA vez por clave.
// Solo si: soportado, permiso aún 'default', y no se ofreció antes (localStorage).
// Usa confirm() nativo para no añadir UI; si acepta, llama pushSubscribe().
async function pushOfrecerContextual(clave, mensaje) {
  if (!pushSupported()) return;
  if (Notification.permission !== 'default') return;
  const flag = 'nestra-push-ofrecido-' + clave;
  if (localStorage.getItem(flag) === '1') return;
  localStorage.setItem(flag, '1');
  if (window.confirm(mensaje)) await pushSubscribe();
}

// pushEstadoServidor() — ¿existe la fila de ESTE navegador en la base?
// Distinto de pushIsSubscribed(), que solo mira el navegador. La Edge Function
// borra la fila ante un 410/404 del servicio de push (endpoint expirado), y sin
// esta consulta el cliente no se entera: el toggle sigue en "activo" y el cron
// notifica a nadie. Returns: true | false | null (null = no se pudo saber).
async function pushEstadoServidor() {
  if (!pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return false;
    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('endpoint')
      .eq('endpoint', sub.endpoint)
      .maybeSingle();
    if (error) return null;
    return !!data;
  } catch (e) {
    console.error('pushEstadoServidor:', e);
    return null;
  }
}

// pushReconciliar() — arregla la deriva entre navegador y base, en silencio.
// Se llama en cada arranque con sesión activa. NUNCA pide permiso: si el
// usuario nunca lo concedió, no hay nada que reparar y no se le molesta.
// Returns: 'sin-permiso' | 'ok' | 'reparado' | 'fallo'.
async function pushReconciliar() {
  if (!pushSupported()) return 'sin-permiso';
  if (Notification.permission !== 'granted') return 'sin-permiso';
  const userId = await _currentUserId();
  if (!userId) return 'sin-permiso';

  const enServidor = await pushEstadoServidor();
  if (enServidor === true) return 'ok';
  if (enServidor === null) return 'fallo';   // sin red o error: no tocar nada

  // El permiso está concedido pero la fila no está. Puede faltar la
  // suscripción del navegador (endpoint expirado) o solo la fila. pushSubscribe
  // resuelve los dos casos: reutiliza la suscripción viva si la hay, crea una
  // nueva si no, y hace upsert por endpoint.
  const res = await pushSubscribe();
  return res.ok ? 'reparado' : 'fallo';
}
