// sparkline.js — tendencia 7 días por categoría (lógica pura, sin DOM).
// Módulo ES (testeable) + adjunta helpers a window para scripts clásicos.

// agruparGasto7dias(txs, categoria_id, hoy) → number[7]
// Suma de gasto por día, índice 0 = hace 6 días, índice 6 = hoy.
// hoy: Date local. Compara por fecha YYYY-MM-DD (slice, sin timezone shift).
export function agruparGasto7dias(txs, categoria_id, hoy) {
  const out = [0, 0, 0, 0, 0, 0, 0];
  const claves = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - i);
    const iso = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    claves.push(iso);
  }
  const idx = new Map(claves.map((k, i) => [k, i]));
  for (const t of (txs || [])) {
    if (t.tipo !== 'gasto') continue;
    if (t.categoria_id !== categoria_id) continue;
    const key = String(t.fecha || '').slice(0, 10);
    if (!idx.has(key)) continue;
    out[idx.get(key)] += Number(t.monto) || 0;
  }
  return out;
}

// sparklineSVG(values, opts) → string SVG inline o '' si no hay señal (>=2 días con dato).
export function sparklineSVG(values, opts = {}) {
  const w = opts.w || 48, h = opts.h || 16, pad = 2;
  const conDato = values.filter((v) => v > 0).length;
  if (conDato < 2) return '';
  const max = Math.max(...values, 1);
  const n = values.length;
  const stepX = (w - pad * 2) / (n - 1);
  const pts = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - (v / max) * (h - pad * 2);
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return '<svg class="sparkline" width="' + w + '" height="' + h +
    '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true" focusable="false">' +
    '<polyline points="' + pts + '" fill="none" stroke="var(--color-primary)" ' +
    'stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

// Adjuntar a window para uso en scripts inline de vistas (clásicos).
if (typeof window !== 'undefined') {
  window.agruparGasto7dias = agruparGasto7dias;
  window.sparklineSVG = sparklineSVG;
}
