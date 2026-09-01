// js/metas-plazo.js — rescate de metas vencidas: qué decirle al usuario y qué
// fecha proponerle. Puro: sin DOM, sin red, y `hoy` se inyecta siempre.
// Carga doble: <script type="module"> (window.*) y ESM en node:test.

// mensajeAliento(meta) — texto de aliento para una meta vencida.
// Con avance real reconoce lo logrado y nombra lo que falta; sin avance no
// felicita en falso. Nunca devuelve NaN/Infinity aunque falte el objetivo.
function mensajeAliento(meta) {
  const act = Number(meta && meta.monto_actual) || 0;
  const obj = Number(meta && meta.monto_objetivo) || 0;
  if (obj <= 0) {
    return 'La fecha pasó, pero lo que juntaste sigue siendo tuyo. Ponle un plazo nuevo y sigue.';
  }
  const falta = Math.max(0, Math.round(obj - act));
  const pct = Math.round(act / obj * 100);
  if (pct <= 0) {
    return 'Esta no arrancó, y no pasa nada. Dale un plazo realista y empieza con un aporte chico.';
  }
  return 'Ya llevas ' + pct + '% y te faltan ' + falta + '. La fecha se venció, no la meta: date un plazo nuevo.';
}

// nuevaFechaSugerida(fechaLimite, hoyISO) — "YYYY-MM-DD" un mes DESPUÉS DE HOY.
// Sobre hoy y no sobre el límite viejo: una meta vencida hace dos meses
// reprogramada sobre su propia fecha nacería vencida otra vez.
// Un día que no existe en el mes destino (31 → febrero) cae al último día real.
function nuevaFechaSugerida(fechaLimite, hoyISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(hoyISO || ''));
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);       // 1-based
  const dia = Number(m[3]);
  const anioDest = mes === 12 ? anio + 1 : anio;
  const mesDest = mes === 12 ? 1 : mes + 1;
  // Día 0 del mes siguiente = último día del mes destino.
  const ultimo = new Date(anioDest, mesDest, 0).getDate();
  const diaDest = Math.min(dia, ultimo);
  const p = (n) => String(n).padStart(2, '0');
  return anioDest + '-' + p(mesDest) + '-' + p(diaDest);
}

if (typeof window !== 'undefined') {
  window.mensajeAliento = mensajeAliento;
  window.nuevaFechaSugerida = nuevaFechaSugerida;
}
export { mensajeAliento, nuevaFechaSugerida };
