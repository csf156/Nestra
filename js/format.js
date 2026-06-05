/**
 * formatMonto(amount)
 * Formatea un monto numérico en formato Sol Peruano
 * @param {number} amount - Monto a formatear
 * @returns {string} Monto formateado como "S/ X,XXX.XX"
 */
function formatMonto(amount) {
  if (amount === null || amount === undefined) {
    return "S/ 0.00";
  }
  const num = parseFloat(amount);
  return "S/ " + num.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * formatFecha(date)
 * Formatea una fecha en formato DD/MM/YYYY
 * @param {Date|string} date - Fecha a formatear
 * @returns {string} Fecha formateada como "DD/MM/YYYY"
 */
function formatFecha(date) {
  if (date === null || date === undefined) {
    return "";
  }
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return day + "/" + month + "/" + year;
}

// Vacío ahora, se llena en Fase 2+
