// format.js — utilidades puras de formato (sin dependencias, funciones globales)

// formatMonto() — formatea un número como Sol Peruano: "S/ 1,200.00"
/**
 * @param {number} numero - Monto a formatear.
 * @returns {string} Monto formateado como "S/ X,XXX.XX". null/undefined/NaN → "S/ 0.00".
 */
function formatMonto(numero) {
  const num = Number(numero);
  if (numero === null || numero === undefined || Number.isNaN(num)) {
    return "S/ 0.00";
  }
  return "S/ " + num.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// formatFecha() — convierte ISO a "DD/MM/YYYY" sin usar new Date (evita bug de timezone)
/**
 * @param {string} isoString - Fecha ISO "2026-06-03" o datetime "2026-06-03T...".
 * @returns {string} Fecha como "DD/MM/YYYY". null/vacío → "".
 */
function formatFecha(isoString) {
  if (!isoString) {
    return "";
  }
  const [anio, mes, dia] = String(isoString).split('T')[0].split('-');
  return dia + "/" + mes + "/" + anio;
}

// formatFechaCorta() — convierte ISO a "DD/MM" sin usar new Date (evita bug de timezone)
/**
 * @param {string} isoString - Fecha ISO "2026-06-03" o datetime "2026-06-03T...".
 * @returns {string} Fecha como "DD/MM". null/vacío → "".
 */
function formatFechaCorta(isoString) {
  if (!isoString) {
    return "";
  }
  const [, mes, dia] = String(isoString).split('T')[0].split('-');
  return dia + "/" + mes;
}

// mesActual() — mes (1-based) y año actuales
/**
 * @returns {{mes: number, anio: number}} mes 1–12, anio de 4 dígitos.
 */
function mesActual() {
  const d = new Date();
  return { mes: d.getMonth() + 1, anio: d.getFullYear() };
}

// nombreMes() — nombre del mes en español: "Junio 2026"
/**
 * @param {number} mes - Mes 1-based (1–12).
 * @param {number} anio - Año de 4 dígitos.
 * @returns {string} Nombre del mes capitalizado y año, o "" si el mes está fuera de rango.
 */
function nombreMes(mes, anio) {
  const nombres = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  if (mes < 1 || mes > 12) {
    return "";
  }
  return nombres[mes - 1] + " " + anio;
}
