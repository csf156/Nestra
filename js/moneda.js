// moneda.js — moneda configurable. Script global clásico (como format.js).
// Resolución sync desde cache localStorage; default PEN. NO convierte divisas:
// solo símbolo + locale + decimales para formateo.
(function () {
  var MONEDAS = {
    PEN: { symbol: 'S/', locale: 'es-PE', decimales: 2 },
    USD: { symbol: '$',  locale: 'en-US', decimales: 2 },
    EUR: { symbol: '€',  locale: 'es-ES', decimales: 2 },
    MXN: { symbol: '$',  locale: 'es-MX', decimales: 2 },
    COP: { symbol: '$',  locale: 'es-CO', decimales: 0 },
    ARS: { symbol: '$',  locale: 'es-AR', decimales: 2 },
    CLP: { symbol: '$',  locale: 'es-CL', decimales: 0 }
  };
  var KEY = 'nestra-moneda';
  var DEFAULT = 'PEN';

  function getMonedaActiva() {
    var code = null;
    try { code = localStorage.getItem(KEY); } catch (e) {}
    return (code && MONEDAS[code]) ? code : DEFAULT;
  }
  function infoMoneda(code) { return MONEDAS[code || getMonedaActiva()] || MONEDAS[DEFAULT]; }
  function monedaSimbolo(code) { return infoMoneda(code).symbol; }
  function monedaLocale(code) { return infoMoneda(code).locale; }
  function monedaDecimales(code) { return infoMoneda(code).decimales; }

  // setMoneda(code) → persiste cache + perfil + evento para re-render.
  async function setMoneda(code) {
    if (!MONEDAS[code]) return;
    try { localStorage.setItem(KEY, code); } catch (e) {}
    if (typeof updateProfile === 'function') {
      try { await updateProfile({ moneda: code }); } catch (e) {}
    }
    window.dispatchEvent(new CustomEvent('nestra:moneda-cambiada', { detail: { code: code } }));
  }
  // cacheMonedaDesdePerfil(perfil) → sincroniza cache desde el perfil cargado en boot.
  function cacheMonedaDesdePerfil(perfil) {
    if (perfil && perfil.moneda && MONEDAS[perfil.moneda]) {
      try { localStorage.setItem(KEY, perfil.moneda); } catch (e) {}
    }
  }

  window.MONEDAS = MONEDAS;
  window.getMonedaActiva = getMonedaActiva;
  window.monedaSimbolo = monedaSimbolo;
  window.monedaLocale = monedaLocale;
  window.monedaDecimales = monedaDecimales;
  window.setMoneda = setMoneda;
  window.cacheMonedaDesdePerfil = cacheMonedaDesdePerfil;
})();
