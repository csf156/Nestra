// utils.js — helpers puros compartidos por los parsers de banco.
// Sin I/O: testeables con node:test (ver test/ingest-parsers.test.mjs).

// BCP/Yape avisan que sus correos pueden omitir tildes o cambiarlas por otros
// caracteres → nunca dependemos de acentos en los patrones.
function normalizar(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ /g, ' ')
    .trim();
}

function lineas(body) {
  return normalizar(body).split(/\r?\n/).map((l) => l.trim());
}

// "1,234.56" | "52.00" | "S/ 6" → number | null
function parseMonto(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/[^\d.,]/g, '');
  if (!s) return null;
  // Formato es-PE: coma = miles, punto = decimal.
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
  // Abreviaturas: Yape las usa en las recargas ("30 ago. 2026").
  ene: 1, feb: 2, mar: 3, abr: 4, jun: 6, jul: 7,
  ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
};

function iso(y, m, d) {
  if (!y || !m || !d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// "23 de junio de 2026" | "10 junio 2026" | "12 de julio, 2026" → "2026-06-23"
function parseFechaLarga(txt) {
  const s = normalizar(txt).toLowerCase();
  // \.? tras el mes: Yape abrevia con punto ("ago.", "set.") en las recargas;
  // sin esto el punto rompe el separador [\s,]+ que sigue y la fecha entera
  // no matchea (verificado contra correo real del 2026-08-30).
  const m = s.match(/(\d{1,2})\s*(?:de\s+)?([a-z]+)\.?[\s,]+(?:de\s+)?(\d{4})/);
  if (!m) return null;
  const mes = MESES[m[2]];
  return mes ? iso(Number(m[3]), mes, Number(m[1])) : null;
}

// "06/07/2026" (DD/MM/YYYY) → "2026-07-06"
function parseFechaCorta(txt) {
  const m = normalizar(txt).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? iso(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

// Fallback: fecha del correo en horario de Lima (UTC-5). Sin esto, una compra
// de las 23:04 en Lima cae al día siguiente por usar UTC.
function fechaEnLima(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  return p; // en-CA ya da YYYY-MM-DD
}

// Valor de una etiqueta tipo "Comercio:" — admite mismo renglón o el siguiente
// no vacío (BBVA manda el valor en la línea de abajo).
function campoTrasEtiqueta(ls, etiqueta) {
  const re = new RegExp('^' + etiqueta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  for (let i = 0; i < ls.length; i++) {
    if (!re.test(ls[i])) continue;
    const mismo = ls[i].slice(etiqueta.length).trim();
    if (mismo) return mismo;
    for (let j = i + 1; j < ls.length; j++) if (ls[j]) return ls[j];
  }
  return null;
}

// Valor inline tipo "Empresa PLIN-Christian Sanchez" (etiqueta y valor juntos).
function campoInline(ls, etiqueta) {
  const re = new RegExp('^' + etiqueta + '\\s+(.+)$', 'i');
  for (const l of ls) {
    const m = l.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

// true solo si el correo es ANTERIOR al corte de puesta en vivo (INGEST_DESDE).
// Fecha ausente/ilegible o corte inválido → false: ante la duda se ingesta
// (queda en la cola de revisión, donde descartar es un tap; perderlo no).
function esAnteriorAlCorte(dateIso, corteIso) {
  if (!dateIso || !corteIso) return false;
  const d = new Date(dateIso).getTime();
  const c = new Date(corteIso).getTime();
  if (Number.isNaN(d) || Number.isNaN(c)) return false;
  return d < c;
}

// "*1902" | "************5632" | "tarjeta terminada en *1902" → "1902" | null
function ultimos4De(txt) {
  if (!txt) return null;
  const m = String(txt).match(/(\d{4})\s*\.?\s*$/);
  return m ? m[1] : null;
}

export {
  normalizar, lineas, parseMonto, parseFechaLarga, parseFechaCorta,
  fechaEnLima, campoTrasEtiqueta, campoInline, ultimos4De, esAnteriorAlCorte,
};
