// js/autocat.js (mínimo para Task 2; se amplía en Task 3)
function normalizeDesc(s) {
  return String(s ?? '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
if (typeof window !== 'undefined') { window.normalizeDesc = normalizeDesc; }
export { normalizeDesc };
