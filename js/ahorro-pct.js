// ahorro-pct.js — % del disponible que se reserva para metas. Script global
// clásico (como moneda.js). Resolución sync desde cache localStorage; default
// 50 (= el valor que estuvo hardcodeado en safe-to-spend.js hasta 2026-07-18,
// así nadie cambia de comportamiento al desplegar).
(function () {
  var KEY = 'nestra-pct-ahorro';
  var DEFAULT = 50;
  var MIN = 0, MAX = 80;   // mismo rango que el CHECK de la base

  // normalizarPct(v) → entero 0–80, o null si no es utilizable. Se usa tanto al
  // leer del cache (que puede traer basura) como al validar lo que teclea el
  // usuario, para no duplicar la regla.
  function normalizarPct(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return null;
    n = Math.round(n);
    if (n < MIN || n > MAX) return null;
    return n;
  }

  function getPctAhorro() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    var n = normalizarPct(raw);
    return n == null ? DEFAULT : n;
  }

  // setPctAhorro(pct) → persiste cache + perfil + evento para re-render.
  // Devuelve el valor aplicado, o null si el input no era válido (el llamador
  // decide qué mensaje mostrar; aquí no se inventa un valor).
  async function setPctAhorro(pct) {
    var n = normalizarPct(pct);
    if (n == null) return null;
    try { localStorage.setItem(KEY, String(n)); } catch (e) {}
    if (typeof updateProfile === 'function') {
      try { await updateProfile({ pct_ahorro_objetivo: n }); } catch (e) {}
    }
    window.dispatchEvent(new CustomEvent('nestra:pct-ahorro-cambiado', { detail: { pct: n } }));
    return n;
  }

  // cachePctAhorroDesdePerfil(perfil) → sincroniza cache desde el perfil del boot.
  function cachePctAhorroDesdePerfil(perfil) {
    if (!perfil) return;
    var n = normalizarPct(perfil.pct_ahorro_objetivo);
    if (n == null) return;
    try { localStorage.setItem(KEY, String(n)); } catch (e) {}
  }

  window.PCT_AHORRO_MIN = MIN;
  window.PCT_AHORRO_MAX = MAX;
  window.PCT_AHORRO_DEFAULT = DEFAULT;
  window.normalizarPctAhorro = normalizarPct;
  window.getPctAhorro = getPctAhorro;
  window.setPctAhorro = setPctAhorro;
  window.cachePctAhorroDesdePerfil = cachePctAhorroDesdePerfil;
})();
