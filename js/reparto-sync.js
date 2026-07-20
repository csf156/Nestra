// reparto-sync.js — regla pura: ¿esta transacción debe pasar por
// distribuir_ahorro? Dual-export como sync-lww.js (window para los scripts
// clásicos db.js/sync.js; ESM para node:test). Un aporte directo NO se reparte:
// aporte_directo_meta ya asignó su monto y marcó es_aporte_directo.
function esAhorroRepartible(tx) {
  return !!tx && tx.tipo === 'ahorro' && !tx.es_aporte_directo;
}

if (typeof window !== 'undefined') { window.esAhorroRepartible = esAhorroRepartible; }
export { esAhorroRepartible };
