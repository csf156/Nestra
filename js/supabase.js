// Supabase Client & Session Helpers
// NOTE: Supabase SDK vendorizado en js/vendor/supabase-js-*.js (index.html).
// This initializes the client using credentials from config.js

// Guarda: si el script vendorizado no cargó (build roto, un bloqueador de
// contenido agresivo, etc.), window.supabase sigue siendo el objeto del SDK
// UMD (con .createClient) o no existe en absoluto — nunca algo con .auth ya
// listo. Sin esta guarda, la línea de abajo lanzaba un TypeError que abortaba
// TODO el script: getSession/getUser nunca se definían, y el primer síntoma
// visible para el usuario era un ReferenceError críptico al pulsar "Continuar
// con Google" en auth.js. Ahora se avisa con un mensaje accionable.
if (!window.supabase || typeof window.supabase.createClient !== 'function') {
  var msg = 'Nestra no pudo cargar un componente necesario para iniciar sesión. ' +
    'Recarga la página; si el problema sigue, revisa tu conexión o un bloqueador de contenido.';
  console.error('Supabase SDK no disponible: js/vendor/supabase-js-*.js no cargó.');
  document.addEventListener('DOMContentLoaded', function () {
    var b = document.createElement('div');
    b.setAttribute('role', 'alert');
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;' +
      'background:#dc2626;color:#fff;padding:12px 16px;font:14px/1.4 sans-serif;' +
      'text-align:center;';
    b.textContent = msg;
    document.body.prepend(b);
  });
  throw new Error('Supabase SDK no disponible');
}

// Create Supabase client
window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// getSession() — Retrieve current session
// Returns: session object or null
// Errors are caught and logged; function returns null on error
async function getSession() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.error('Error fetching session:', error.message);
      return null;
    }
    return session;
  } catch (err) {
    console.error('Unexpected error in getSession():', err);
    return null;
  }
}

// getUser() — Retrieve authenticated user
// Returns: user object or null
// Errors are caught and logged; function returns null on error
async function getUser() {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) {
      console.error('Error fetching user:', error.message);
      return null;
    }
    return user;
  } catch (err) {
    console.error('Unexpected error in getUser():', err);
    return null;
  }
}
