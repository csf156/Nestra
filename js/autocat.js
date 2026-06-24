// js/autocat.js — normalización + matcher determinista descripcion→categoria.
// Sin fuzzy. Carga: <script type="module"> (window.*) y ESM en Node.

function normalizeDesc(s) {
  return String(s ?? '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '').replace(/\s+/g, ' ').trim();
}

// matchAutocat(descNorm, dict) → categoria_id o null.
// Exacto primero; luego una clave del dict que sea substring de descNorm. Sin Levenshtein.
function matchAutocat(descNorm, dict) {
  if (!descNorm || !dict) return null;
  if (dict[descNorm]) return dict[descNorm];
  for (const key in dict) {
    if (key && descNorm.includes(key)) return dict[key];
  }
  return null;
}

// Diccionario keyword → NOMBRE de categoría (es-PE). Ampliable.
const KEYWORDS = {
  uber:'Transporte', taxi:'Transporte', pasaje:'Transporte', combi:'Transporte',
  metro:'Transporte', gasolina:'Transporte',
  almuerzo:'Comida', cena:'Comida', desayuno:'Comida', 'café':'Comida',
  cafe:'Comida', 'menú':'Comida', menu:'Comida', restaurante:'Comida',
  mercado:'Mercado', super:'Mercado', verdura:'Mercado',
  luz:'Servicios', agua:'Servicios', internet:'Servicios', recarga:'Servicios',
  celular:'Servicios',
  farmacia:'Salud', 'clínica':'Salud', clinica:'Salud',
  cine:'Ocio', bar:'Ocio',
};

if (typeof window !== 'undefined') {
  window.normalizeDesc = normalizeDesc;
  window.matchAutocat = matchAutocat;
  window.NESTRA_KEYWORDS = KEYWORDS;
}
export { normalizeDesc, matchAutocat, KEYWORDS };
