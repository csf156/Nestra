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
