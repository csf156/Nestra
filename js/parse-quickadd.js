// js/parse-quickadd.js — parser de reglas para quick-add (free-text → transacción).
// Sin AI. Carga: <script type="module"> (expone window.parseQuickAdd) y ESM en Node.
import { tokenize, matchCategoria } from './autocat.js';
import { resolverMeta } from './meta-resolver.js';

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

  // 4.5 Aporte a meta: "meta <nombre>" apunta a una meta concreta y fuerza
  // tipo=ahorro (un aporte a meta siempre lo es).
  //
  // Va DESPUES del monto a proposito: si se extrae antes, el nombre se traga la
  // cifra ("meta alquiler S/5" → nombre "alquiler S/5" y monto null).
  //
  // El \b de los dos lados no es decorativo: sin el, "meta" casaria dentro de
  // otras palabras.
  //
  // El ambito NO se toca: lo hereda la meta (aporte_directo_meta usa el suyo),
  // asi que un ambito escrito a mano se ignora — la meta es lo especifico.
  const mMeta = str.match(/\bmeta\b\s*(.*)$/i);
  if (mMeta) {
    out.tipo = 'ahorro';
    const res = resolverMeta(mMeta[1], (ctx && ctx.metas) || []);
    if (res.meta_id) out.meta_id = res.meta_id;
    else { out.metaError = res.error; out.metaCandidatas = res.candidatas || []; }
    str = str.slice(0, mMeta.index) + ' ';
  }

  // 5. Descripción.
  const desc = str.replace(/S\/\.?/ig, ' ').replace(/\s+/g, ' ').trim();
  out.descripcion = desc || null;

  // 6. El hogar solo registra gasto y ahorro: un ingreso es siempre personal.
  // Tipo y ámbito se reconocen como palabras independientes, así que "ingreso
  // hogar" produciría la combinación que el CHECK transacciones_hogar_sin_ingreso
  // rechaza. Sin esto el insert muere contra la base — y offline es peor: se
  // encola en el outbox y se espeja como confirmada, pero el sync la rechaza
  // para siempre y queda una fila fantasma solo en el cliente.
  // El ámbito gana, igual que en el form (transaccion.html:_gateTipoPorAmbito).
  if (out.ambito === 'hogar' && out.tipo === 'ingreso') out.tipo = 'gasto';

  // 7. Categoría: ahorro no lleva; resto vía matcher por tokens.
  if (out.tipo !== 'ahorro') {
    out.categoria_id = matchCategoria(tokenize(desc), ctx);
  }
  return out;
}

if (typeof window !== 'undefined') { window.parseQuickAdd = parseQuickAdd; }
export { parseQuickAdd };
