// js/auth-listo.js — puerta de "la autenticación ya decidió".
// Existe porque el router esperaba 100 ms fijos y luego preguntaba por una
// variable que initAuth aún no había rellenado: en un iPhone arrancando en
// frío nunca alcanzaban, y el usuario acababa en el login teniendo sesión
// válida. Esperar a un HECHO en vez de a un reloj.
function crearGateAuth(opts) {
  var listo = false;
  var resolver;
  var promesa = new Promise(function (res) { resolver = res; });

  // Red de seguridad: si initAuth muriera sin marcar, la app no puede quedar
  // colgada. Se sigue adelante y el router decide con lo que haya.
  var ms = (opts && opts.timeoutMs) || 8000;
  var t = setTimeout(function () { marcarListo(); }, ms);

  function marcarListo() {
    if (listo) return;
    listo = true;
    clearTimeout(t);
    resolver();
  }
  return {
    marcarListo: marcarListo,
    estaListo: function () { return listo; },
    cuandoListo: function () { return promesa; },
  };
}

if (typeof window !== 'undefined') {
  window.crearGateAuth = crearGateAuth;
  // OJO: este archivo se carga como <script type="module">, que SIEMPRE se
  // difiere hasta después de parsear todo el documento — sin importar dónde
  // se coloque el tag. js/auth.js es un script clásico que puede terminar
  // initAuth() de forma SÍNCRONA (camino "sin token", sin ningún await) antes
  // de que este módulo llegue a ejecutar. Por eso auth.js trae su propio
  // bootstrap síncrono de window.authGate (misma lógica, duplicada a
  // propósito). `|| ` en vez de asignación directa: si ese bootstrap ya creó
  // la puerta y ya la marcó lista, no se pisa con una nueva sin marcar.
  window.authGate = window.authGate || crearGateAuth();
}
export { crearGateAuth };
