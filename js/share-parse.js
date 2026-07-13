// js/share-parse.js — extrae un monto de texto compartido (Web Share Target).
// Cárgalo como <script type="module"> (expone window.parseSharedMonto) y como
// módulo ESM en Node (export). Heurística es-PE: prefijo S/, miles con coma,
// decimal con punto o coma.

function _normalizeNum(raw) {
  let s = String(raw).replace(/\s/g, '');
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const tho = dec === '.' ? ',' : '.';
    s = s.split(tho).join('');
    if (dec === ',') s = s.replace(',', '.');
  } else if (hasComma) {
    if (/,\d{1,2}$/.test(s)) s = s.replace(',', '.');
    else s = s.split(',').join('');
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseSharedMonto(text) {
  if (text == null) return null;
  const str = String(text);
  let m = str.match(/S\/\.?\s*([\d.,]+)/i);
  if (!m) m = str.match(/(\d[\d.,]*\d|\d)/);
  if (!m) return null;
  const n = _normalizeNum(m[1] || m[0]);
  return (n != null && n > 0) ? n : null;
}

if (typeof window !== 'undefined') { window.parseSharedMonto = parseSharedMonto; }
export { parseSharedMonto };
