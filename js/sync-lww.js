// js/sync-lww.js — comparador LWW por updated_at. Cárgalo como <script type="module">
// en el navegador (expone window.lwwWinner) y como módulo ESM en Node (export).
function lwwWinner(local, server) {
  if (!server) return 'local';
  if (!local) return 'server';
  const l = Date.parse(local.updated_at || 0) || 0;
  const s = Date.parse(server.updated_at || 0) || 0;
  return l > s ? 'local' : 'server';
}
if (typeof window !== 'undefined') { window.lwwWinner = lwwWinner; }
export { lwwWinner };
