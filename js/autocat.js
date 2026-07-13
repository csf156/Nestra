// js/autocat.js — normalización + matcher de categoría por tokens (scoring).
// Sin AI, determinista. Carga: <script type="module"> (window.*) y ESM en Node.

function normalizeDesc(s) {
  return String(s ?? '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

const STOP = new Set([
  'de','del','la','el','los','las','un','una','unos','unas',
  'y','o','a','en','con','por','para','mi','mis','su','sus','lo','al',
]);

function _singular(w) {
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}

// tokenize(desc) → tokens normalizados, sin stopwords ni numéricos, singular simple.
function tokenize(desc) {
  const norm = normalizeDesc(desc);
  if (!norm) return [];
  return norm.split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((t) => !/^\d+$/.test(t))
    .filter((t) => !STOP.has(t))
    .map(_singular)
    .filter((t) => t.length >= 2);
}

// scoreCategorias(tokens, ctx) → { [categoria_id]: score }.
// ctx: { learned:{token:{catId:freq}}, categorias:[{id,nombre}], seed:{token:nombre} }
function scoreCategorias(tokens, ctx) {
  const learned = (ctx && ctx.learned) || {};
  const categorias = (ctx && ctx.categorias) || [];
  const seed = (ctx && ctx.seed) || {};
  const scores = {};
  const add = (id, n) => { if (id) scores[id] = (scores[id] || 0) + n; };
  const catTok = categorias.map((c) => ({ id: c.id, nombre: c.nombre, toks: new Set(tokenize(c.nombre)) }));
  for (const tok of tokens) {
    if (learned[tok]) for (const id in learned[tok]) add(id, 3 * learned[tok][id]);
    for (const c of catTok) if (c.toks.has(tok)) add(c.id, 2);
    if (seed[tok]) {
      const sn = normalizeDesc(seed[tok]);
      for (const c of categorias) if (normalizeDesc(c.nombre) === sn) add(c.id, 1);
    }
  }
  return scores;
}

// matchCategoria(tokens, ctx, umbral=1) → categoria_id | null. Empate → null.
function matchCategoria(tokens, ctx, umbral = 1) {
  const scores = scoreCategorias(tokens, ctx);
  let best = null, bestScore = -1, tie = false;
  for (const id in scores) {
    const s = scores[id];
    if (s > bestScore) { bestScore = s; best = id; tie = false; }
    else if (s === bestScore) { tie = true; }
  }
  if (best == null || bestScore < umbral || tie) return null;
  return best;
}

// Diccionario semilla token → NOMBRE de categoría (es-PE). Claves SIN tildes.
const SEED = {
  uber:'Transporte', taxi:'Transporte', pasaje:'Transporte', combi:'Transporte',
  metro:'Transporte', gasolina:'Transporte',
  almuerzo:'Comida', cena:'Comida', desayuno:'Comida', cafe:'Comida',
  menu:'Comida', restaurante:'Comida',
  mercado:'Mercado', super:'Mercado', verdura:'Mercado',
  luz:'Servicios', agua:'Servicios', internet:'Servicios', recarga:'Servicios',
  celular:'Servicios',
  farmacia:'Salud', clinica:'Salud',
  cine:'Ocio', bar:'Ocio',
};

if (typeof window !== 'undefined') {
  window.normalizeDesc = normalizeDesc;
  window.tokenize = tokenize;
  window.scoreCategorias = scoreCategorias;
  window.matchCategoria = matchCategoria;
  window.NESTRA_SEED = SEED;
}
export { normalizeDesc, tokenize, scoreCategorias, matchCategoria, SEED };
