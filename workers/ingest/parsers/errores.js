// errores.js — error tipado para formatos no reconocidos.
//
// Un remitente bancario cuyo cuerpo NO matchea ningún formato verificado ni
// el ruido confirmado lanza este error: el Worker lo captura y encola el
// correo SIN campos parseados (estado 'revisar-manual') para que el usuario
// lo triagee desde la PWA. Nunca crashea el Worker ni pierde el movimiento.
//
// Distinto de devolver null: null = ruido confirmado o no-transacción
// (OTP, afiliación, compra rechazada) → se ignora y se loguea.

class FormatoNoReconocidoError extends Error {
  /**
   * @param {string} banco  slug del banco ('bbva'|'bcp'|'yape')
   * @param {string} motivo descripción corta para el log
   */
  constructor(banco, motivo) {
    super(`formato no reconocido (${banco}): ${motivo}`);
    this.name = 'FormatoNoReconocidoError';
    this.banco = banco;
    this.motivo = motivo;
  }
}

export { FormatoNoReconocidoError };
