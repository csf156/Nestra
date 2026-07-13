// js/parse-quickadd.js — parser de reglas para quick-add (free-text → transacción).
// Sin AI. Carga: <script type="module"> (expone window.parseQuickAdd) y ESM en Node.
import { tokenize, matchCategoria } from './autocat.js';

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
  const ctx = opts.ctx || {};
  const out = { tipo: 'gasto', ambito: 'personal', descripcion: null, monto: null, categoria_id: null, fecha: hoy };
  if (text == null) return out;
  let str = String(text).trim();
  if (!str) return out;

  // 1. Fecha relativa.
  let fecha = hoy;
  str = str.replace(/\b(anteayer|ayer|hoy|mañana|manana)\b/i, (m) => {
    if (hoy) fecha = _addDays(hoy, _FECHAS[m.toLowerCase()] ?? 0);
    return ' ';
  });
  out.fecha = fecha;

  // 2. Tipo (default gasto).
  str = str.replace(/\b(ingreso|ahorro)\b/i, (m) => { out.tipo = m.toLowerCase(); return ' '; });

  // 3. Ámbito (default personal).
  str = str.replace(/\b(hogar|personal)\b/i, (m) => { out.ambito = m.toLowerCase(); return ' '; });

  // 4. Monto. Si hay S/<num>, ese gana; si no, el mayor.
  let monto = null;
  const conS = str.match(/S\/\.?\s*([\d.,]+)/i);
  if (conS) {
    monto = _normalizeNum(conS[1]);
    str = str.replace(conS[0], ' ');
  } else {
    const re = /\d[\d.,]*\d|\d/g;
    let m, best = null, bestRaw = null, bestIdx = -1;
    while ((m = re.exec(str)) !== null) {
      const n = _normalizeNum(m[0]);
      if (n != null && (best == null || n > best)) { best = n; bestRaw = m[0]; bestIdx = m.index; }
    }
    monto = best;
    if (bestIdx >= 0) str = str.slice(0, bestIdx) + ' ' + str.slice(bestIdx + bestRaw.length);
  }
  out.monto = (monto != null && monto > 0) ? monto : null;

  // 5. Descripción.
  const desc = str.replace(/S\/\.?/ig, ' ').replace(/\s+/g, ' ').trim();
  out.descripcion = desc || null;

  // 6. Categoría: ahorro no lleva; resto vía matcher por tokens.
  if (out.tipo !== 'ahorro') {
    out.categoria_id = matchCategoria(tokenize(desc), ctx);
  }
  return out;
}

if (typeof window !== 'undefined') { window.parseQuickAdd = parseQuickAdd; }
export { parseQuickAdd };
