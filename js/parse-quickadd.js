// js/parse-quickadd.js — parser de reglas para quick-add (free-text → transacción).
// Sin AI. Carga: <script type="module"> (expone window.parseQuickAdd) y ESM en Node.
import { normalizeDesc } from './autocat.js';

function _normalizeNum(raw) {
  let s = String(raw).replace(/\s/g, '');
  const hasDot = s.includes('.'), hasComma = s.includes(',');
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

function _addDays(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

const _FECHAS = { hoy: 0, ayer: -1, anteayer: -2, 'mañana': 1, manana: 1 };

function parseQuickAdd(text, opts = {}) {
  const hoy = opts.hoy;
  const keywords = opts.keywords || {};
  const autocat = opts.autocat || {};
  const out = { descripcion: null, monto: null, categoria_id: null, categoria_keyword: null, fecha: hoy };
  if (text == null) return out;
  let str = String(text).trim();
  if (!str) return out;

  // 1. Fecha relativa: token aislado.
  let fecha = hoy;
  str = str.replace(/\b(anteayer|ayer|hoy|mañana|manana)\b/i, (m) => {
    fecha = _addDays(hoy, _FECHAS[m.toLowerCase()] ?? 0);
    return ' ';
  });
  out.fecha = fecha;

  // 2. Monto. Si hay S/<num>, ese gana. Si no, el mayor número plausible.
  let monto = null;
  const conS = str.match(/S\/\.?\s*([\d.,]+)/i);
  if (conS) {
    monto = _normalizeNum(conS[1]);
    str = str.replace(conS[0], ' ');
  } else {
    const nums = str.match(/\d[\d.,]*\d|\d/g) || [];
    let best = null, bestRaw = null;
    for (const raw of nums) {
      const n = _normalizeNum(raw);
      if (n != null && (best == null || n > best)) { best = n; bestRaw = raw; }
    }
    monto = best;
    if (bestRaw != null) str = str.replace(bestRaw, ' ');
  }
  out.monto = (monto != null && monto > 0) ? monto : null;

  // 3. Descripción: lo que queda, sin S/ sobrante, espacios colapsados.
  let desc = str.replace(/S\/\.?/ig, ' ').replace(/\s+/g, ' ').trim();
  out.descripcion = desc || null;

  // 4. Categoría: autocat (por desc normalizada) prioritario; luego keyword substring.
  const descNorm = normalizeDesc(desc);
  if (descNorm && autocat[descNorm]) {
    out.categoria_id = autocat[descNorm];
  } else if (descNorm) {
    for (const kw in keywords) {
      if (descNorm.includes(normalizeDesc(kw))) { out.categoria_keyword = keywords[kw]; break; }
    }
  }
  return out;
}

if (typeof window !== 'undefined') { window.parseQuickAdd = parseQuickAdd; }
export { parseQuickAdd };
