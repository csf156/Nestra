// ─────────────────────────────────────────────────────────────────
// Nestra — hogar-partes.js (Fase 6.3)
// Validador puro de un split de gasto compartido antes de enviarlo al RPC
// registrar_gasto_hogar. El servidor re-valida (fuente de verdad); esto es
// solo feedback inmediato en el formulario.
// ─────────────────────────────────────────────────────────────────
'use strict';

// validarPartesGastoHogar(total, partes) — partes: [{ user_id, monto }].
// Returns: { ok: true } | { ok: false, error: string }.
function validarPartesGastoHogar(total, partes) {
  // Se trabaja en centavos (enteros) para evitar el error de redondeo de
  // punto flotante de JS (p.ej. 33.34 + 66.67 !== 100.01 exactamente).
  var totalCent = Math.round((Number(total) || 0) * 100);
  if (!(totalCent > 0)) return { ok: false, error: 'El total debe ser mayor que 0.' };
  if (!Array.isArray(partes) || !partes.length) {
    return { ok: false, error: 'Debe haber al menos una parte.' };
  }

  var vistos = {};
  var sumaCent = 0;
  for (var i = 0; i < partes.length; i++) {
    var p = partes[i];
    if (!p || !p.user_id) return { ok: false, error: 'Falta el usuario de una parte.' };
    if (vistos[p.user_id]) return { ok: false, error: 'Un miembro no puede tener dos partes.' };
    vistos[p.user_id] = true;
    var m = Number(p.monto);
    if (!(m > 0)) return { ok: false, error: 'Cada parte debe ser mayor que 0.' };
    sumaCent += Math.round(m * 100);
  }
  if (Math.abs(sumaCent - totalCent) > 1) {
    return {
      ok: false,
      error: 'La suma de las partes (' + (sumaCent / 100) + ') no coincide con el total (' + (totalCent / 100) + ').'
    };
  }
  return { ok: true };
}

// restanteGastoHogar(total, partes) — cuánto falta (o sobra, si es negativo)
// por asignar del total. Partes con monto <= 0 no cuentan como asignación
// (mismo criterio que validarPartesGastoHogar). Cent-safe, sin el error de
// redondeo de punto flotante de JS. Solo para feedback en vivo del
// formulario — no valida, no lanza; validarPartesGastoHogar sigue siendo
// la fuente de verdad antes de enviar.
function restanteGastoHogar(total, partes) {
  var totalCent = Math.round((Number(total) || 0) * 100);
  var sumaCent = 0;
  (partes || []).forEach(function (p) {
    var m = Number(p && p.monto);
    if (m > 0) sumaCent += Math.round(m * 100);
  });
  return Math.round(totalCent - sumaCent) / 100;
}

if (typeof window !== 'undefined') {
  window.validarPartesGastoHogar = validarPartesGastoHogar;
  window.restanteGastoHogar = restanteGastoHogar;
}

export { validarPartesGastoHogar, restanteGastoHogar };
