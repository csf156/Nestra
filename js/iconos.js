// ═══════════════════════════════════════════════════════════════════
// ICONOS — helper global para íconos de categoría (sprite Tabler local)
// ═══════════════════════════════════════════════════════════════════
// Expone: iconoCategoria(nombre, opts), buscarIconos(query), iconosListos()
(function () {
  'use strict';

  var SPRITE_URL = 'assets/tabler-sprite.svg';
  var TAGS_URL   = 'assets/tabler-tags.json';
  var ICONO_DEFAULT = 'tag'; // ícono Tabler usado cuando la categoría no tiene uno

  var _tags = null;       // { nombre: [tags] }
  var _nombres = [];      // [nombre, ...]
  var _listoPromise = null;

  // Solo carga el índice de tags para la búsqueda. Los íconos se renderizan con
  // <use href="archivo.svg#id"> externo: el navegador descarga el sprite una vez
  // y lo cachea; no inyectamos los 2MB al DOM (evita bloat y carreras de timing).
  function cargarTags() {
    return fetch(TAGS_URL)
      .then(function (r) { return r.json(); })
      .then(function (data) { _tags = data; _nombres = Object.keys(data); });
  }

  function asegurarCargado() {
    if (!_listoPromise) {
      _listoPromise = cargarTags()
        .catch(function (e) { console.error('iconos: carga falló', e); });
    }
    return _listoPromise;
  }

  // iconoCategoria(nombre) → string HTML de un <svg><use></svg>.
  // nombre: nombre Tabler sin prefijo (ej. "car"). null/'' → ICONO_DEFAULT.
  function iconoCategoria(nombre, opts) {
    opts = opts || {};
    var icono = (nombre && String(nombre).trim()) ? String(nombre).trim() : ICONO_DEFAULT;
    var cls = 'cat-icono' + (opts.clase ? ' ' + opts.clase : '');
    return '<svg class="' + cls + '" aria-hidden="true"><use href="' +
      SPRITE_URL + '#tabler-' + icono + '"></use></svg>';
  }

  // buscarIconos(query) → [nombre, ...] (máx 120). Query vacía → primeros 120.
  function buscarIconos(query) {
    if (!_tags) return [];
    var q = String(query || '').trim().toLowerCase();
    if (!q) return _nombres.slice(0, 120);
    var res = [];
    for (var i = 0; i < _nombres.length && res.length < 120; i++) {
      var n = _nombres[i];
      if (n.indexOf(q) !== -1) { res.push(n); continue; }
      var tags = _tags[n];
      if (tags) {
        for (var j = 0; j < tags.length; j++) {
          if (tags[j].toLowerCase().indexOf(q) !== -1) { res.push(n); break; }
        }
      }
    }
    return res;
  }

  function iconosListos() { return asegurarCargado(); }

  // Precargar al cargar el script (no bloquea).
  asegurarCargado();

  window.iconoCategoria = iconoCategoria;
  window.buscarIconos   = buscarIconos;
  window.iconosListos   = iconosListos;
})();
