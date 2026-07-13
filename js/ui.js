// ui.js — helpers de UI compartidos (empty states). Script global.
(function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // renderEmptyState({icon,title,desc,ctaLabel,ctaHref}) → HTML string.
  // icon: id del sprite Tabler sin prefijo 'tabler-'; usa <use href="...#tabler-ID">.
  function renderEmptyState(o) {
    o = o || {};
    var icono = o.icon
      ? '<svg class="empty-state-icon" aria-hidden="true"><use href="assets/tabler-sprite.svg#tabler-' + esc(o.icon) + '"></use></svg>'
      : '';
    var cta = (o.ctaLabel && o.ctaHref)
      ? '<a class="btn btn-primary btn-sm empty-state-cta" href="' + esc(o.ctaHref) + '">' + esc(o.ctaLabel) + '</a>'
      : '';
    return '<div class="empty-state">' + icono +
      '<p class="empty-state-title">' + esc(o.title || '') + '</p>' +
      (o.desc ? '<p class="empty-state-desc">' + esc(o.desc) + '</p>' : '') +
      cta + '</div>';
  }

  window.renderEmptyState = renderEmptyState;
})();
