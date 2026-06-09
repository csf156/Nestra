// sidebar.js — Collapse/expand sidebar toggle with localStorage persistence
// Loaded after router.js in index.html.
// Depends on: #sidebarToggle button being present in index.html (desktop only via CSS).

(function () {
  'use strict';

  var STORAGE_KEY = 'sidebar-collapsed';

  // SVG inner paths for panel-left-close (expanded → click to collapse)
  var SVG_CLOSE =
    '<svg viewBox="0 0 24 24" aria-hidden="true" class="nav-icon">' +
    '<rect width="18" height="18" x="3" y="3" rx="2"/>' +
    '<path d="M9 3v18"/>' +
    '<path d="m16 15-3-3 3-3"/>' +
    '</svg>';

  // SVG inner paths for panel-left-open (collapsed → click to expand)
  var SVG_OPEN =
    '<svg viewBox="0 0 24 24" aria-hidden="true" class="nav-icon">' +
    '<rect width="18" height="18" x="3" y="3" rx="2"/>' +
    '<path d="M9 3v18"/>' +
    '<path d="m14 9 3 3-3 3"/>' +
    '</svg>';

  function readStorage() {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch (e) {
      return false; // private mode or blocked — default to expanded
    }
  }

  function writeStorage(collapsed) {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? 'true' : 'false');
    } catch (e) {
      // silent — toggle still works for this session
    }
  }

  function applyState(collapsed) {
    document.body.classList.toggle('sidebar-collapsed', collapsed);

    var btn = document.getElementById('sidebarToggle');
    if (!btn) return;

    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    btn.setAttribute('aria-label', collapsed ? 'Expandir menú' : 'Contraer menú');
    btn.innerHTML = collapsed ? SVG_OPEN : SVG_CLOSE;
  }

  // Init: restore persisted state on page load
  applyState(readStorage());

  // Wire toggle button
  var toggleBtn = document.getElementById('sidebarToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      var collapsed = !document.body.classList.contains('sidebar-collapsed');
      writeStorage(collapsed);
      applyState(collapsed);
    });
  }
})();
