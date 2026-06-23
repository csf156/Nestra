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
// Returns: true si quedó suscrito, false si no (sin soporte/permiso/login).
async function pushSubscribe() {
  if (!pushSupported()) return false;
  const userId = await _currentUserId();
  if (!userId) return false;

  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return false;

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: sub.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent,
  }, { onConflict: 'endpoint' });
  if (error) { console.error('pushSubscribe upsert:', error.message); return false; }
  return true;
}

// pushUnsubscribe() — cancela la suscripción local y borra la fila.
async function pushUnsubscribe() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch (_) {}
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
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
