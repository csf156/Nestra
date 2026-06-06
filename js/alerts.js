// ─────────────────────────────────────────────────────────────────
// Nestra — alerts.js
// Motor de alertas: evalúa condiciones financieras y devuelve mensajes.
// NO renderiza — solo retorna datos; la vista decide cómo mostrarlos.
//
// Patrón: funciones globales (sin import/export), igual que el codebase.
// Depende de globales ya cargados:
//   - db.js     → getCategorias, getResumenMensual, getMetas,
//                 getPrestamos, getDesafios
//   - format.js → formatMonto, formatFecha
//
// Forma de cada alerta:
//   {
//     nivel:   'suave' | 'critica' | 'positiva',
//     icono:   '⚠️' | '🚨' | '✅',
//     origen:  'categoria' | 'meta' | 'prestamo' | 'desafio',
//     mensaje: string legible,
//     contexto:{ ...datos útiles para la vista (ids, montos, %) }
//   }
//
// Cada evaluador parcial está en su propio try/catch: si una fuente de
// datos falla, devuelve [] y el resto de alertas se siguen calculando.
// ─────────────────────────────────────────────────────────────────


// ─── Constantes de umbral (sección 9 de la arquitectura) ──────────
const ALERT_UMBRAL_CATEGORIA_SUAVE = 80;   // % del límite → ⚠️ suave
const ALERT_DIAS_META_POR_VENCER   = 7;    // < 7 días → ⚠️ suave
const ALERT_DIAS_PRESTAMO_VIEJO    = 30;   // > 30 días → ⚠️ suave
const ALERT_DIAS_DESAFIO_POR_FIN   = 2;    // < 2 días → ⚠️ suave

const ALERT_ICONO = { suave: '⚠️', critica: '🚨', positiva: '✅' };


// ─── Helpers de fecha ─────────────────────────────────────────────

// _hoyMidnight() — Date de hoy a medianoche local (para comparar días).
function _hoyMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// _parseFecha(iso) — 'YYYY-MM-DD' → Date a medianoche local.
function _parseFecha(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

// _diasDesde(iso) — días transcurridos desde `iso` hasta hoy (entero).
// Positivo = en el pasado. Ej: fecha de ayer → 1.
function _diasDesde(iso) {
  const ms = _hoyMidnight() - _parseFecha(iso);
  return Math.floor(ms / 86400000);
}

// _diasHasta(iso) — días desde hoy hasta `iso` (entero).
// Positivo = en el futuro; negativo = ya pasó.
function _diasHasta(iso) {
  const ms = _parseFecha(iso) - _hoyMidnight();
  return Math.floor(ms / 86400000);
}

// _alerta(nivel, origen, mensaje, contexto) — construye una alerta.
function _alerta(nivel, origen, mensaje, contexto = {}) {
  return { nivel, icono: ALERT_ICONO[nivel], origen, mensaje, contexto };
}


// ═══════════════════════════════════════════════════════════════════
// Evaluadores parciales
// ═══════════════════════════════════════════════════════════════════

// _alertasCategorias(mes, anio) — gasto vs. límite mensual por categoría.
// ⚠️ suave: 80–99% del límite. 🚨 crítica: ≥100%.
// Solo categorías con limite_mensual definido (> 0).
async function _alertasCategorias(mes, anio) {
  try {
    const [categorias, resumen] = await Promise.all([
      getCategorias('gasto'),
      getResumenMensual(mes, anio),
    ]);

    // Mapa categoria_id → gasto total del mes.
    const gastoPorCat = new Map();
    (resumen.porCategoria || []).forEach((c) => {
      gastoPorCat.set(c.categoria_id, c.total);
    });

    const alertas = [];
    categorias.forEach((cat) => {
      const limite = Number(cat.limite_mensual);
      if (!limite || limite <= 0) return; // sin límite → sin alerta

      const gastado = Number(gastoPorCat.get(cat.id) || 0);
      const ratio = gastado / limite;          // crudo, para comparar umbrales
      const pct = Math.round(ratio * 100);      // redondeado, solo para mostrar

      if (ratio >= 1) {
        alertas.push(_alerta(
          'critica', 'categoria',
          `Superaste el límite de "${cat.nombre}": ${formatMonto(gastado)} de ${formatMonto(limite)} (${pct}%).`,
          { categoria_id: cat.id, nombre: cat.nombre, gastado, limite, pct }
        ));
      } else if (ratio * 100 >= ALERT_UMBRAL_CATEGORIA_SUAVE) {
        alertas.push(_alerta(
          'suave', 'categoria',
          `"${cat.nombre}" va al ${pct}% de su límite: ${formatMonto(gastado)} de ${formatMonto(limite)}.`,
          { categoria_id: cat.id, nombre: cat.nombre, gastado, limite, pct }
        ));
      }
    });
    return alertas;
  } catch (err) {
    console.error('Error en _alertasCategorias():', err.message || err);
    return [];
  }
}

// _alertasMetas() — metas por vencer o vencidas sin cumplir.
// ⚠️ suave: en curso y vence en < 7 días. 🚨 crítica: vencida sin lograr.
async function _alertasMetas() {
  try {
    const metas = await getMetas();
    const alertas = [];

    metas.forEach((meta) => {
      const cumplida = Number(meta.monto_actual) >= Number(meta.monto_objetivo);
      const dias = _diasHasta(meta.fecha_limite);

      // Crítica: marcada vencida, o en curso ya pasada y sin cumplir.
      const venceSinCumplir =
        meta.estado === 'vencida' ||
        (meta.estado === 'en_curso' && dias < 0 && !cumplida);

      if (venceSinCumplir) {
        alertas.push(_alerta(
          'critica', 'meta',
          `Meta vencida sin cumplir: "${meta.nombre}" (${formatMonto(meta.monto_actual)} de ${formatMonto(meta.monto_objetivo)}).`,
          { meta_id: meta.id, nombre: meta.nombre, fecha_limite: meta.fecha_limite }
        ));
        return;
      }

      // Suave: en curso, vence pronto (0–6 días), aún sin cumplir.
      if (meta.estado === 'en_curso' && !cumplida &&
          dias >= 0 && dias < ALERT_DIAS_META_POR_VENCER) {
        alertas.push(_alerta(
          'suave', 'meta',
          `La meta "${meta.nombre}" vence en ${dias} día${dias === 1 ? '' : 's'} (${formatFecha(meta.fecha_limite)}).`,
          { meta_id: meta.id, nombre: meta.nombre, dias, fecha_limite: meta.fecha_limite }
        ));
      }
    });
    return alertas;
  } catch (err) {
    console.error('Error en _alertasMetas():', err.message || err);
    return [];
  }
}

// _alertasPrestamos() — préstamos pendientes con más de 30 días.
async function _alertasPrestamos() {
  try {
    const prestamos = await getPrestamos('pendiente');
    const alertas = [];

    prestamos.forEach((p) => {
      const fecha = p.transacciones ? p.transacciones.fecha : null;
      if (!fecha) return;
      const dias = _diasDesde(fecha);
      if (dias > ALERT_DIAS_PRESTAMO_VIEJO) {
        const monto = p.transacciones ? p.transacciones.monto : null;
        alertas.push(_alerta(
          'suave', 'prestamo',
          `Préstamo a ${p.deudor} pendiente hace ${dias} días${monto != null ? ` (${formatMonto(monto)})` : ''}.`,
          { prestamo_id: p.id, deudor: p.deudor, dias, monto }
        ));
      }
    });
    return alertas;
  } catch (err) {
    console.error('Error en _alertasPrestamos():', err.message || err);
    return [];
  }
}

// _alertasDesafios() — desafíos por terminar (< 2 días) y completados.
// ⚠️ suave: activo, termina en < 2 días. ✅ positiva: completado.
async function _alertasDesafios() {
  try {
    const desafios = await getDesafios();
    const alertas = [];

    desafios.forEach((d) => {
      if (d.estado === 'activo' && d.fecha_fin) {
        const dias = _diasHasta(d.fecha_fin);
        if (dias >= 0 && dias < ALERT_DIAS_DESAFIO_POR_FIN) {
          alertas.push(_alerta(
            'suave', 'desafio',
            `El desafío "${d.titulo}" termina en ${dias} día${dias === 1 ? '' : 's'}.`,
            { desafio_id: d.id, titulo: d.titulo, dias }
          ));
        }
      } else if (d.estado === 'completado') {
        alertas.push(_alerta(
          'positiva', 'desafio',
          `¡Desafío completado: "${d.titulo}"! 🎉`,
          { desafio_id: d.id, titulo: d.titulo }
        ));
      }
    });
    return alertas;
  } catch (err) {
    console.error('Error en _alertasDesafios():', err.message || err);
    return [];
  }
}


// ═══════════════════════════════════════════════════════════════════
// API pública
// ═══════════════════════════════════════════════════════════════════

// evaluarAlertas(mes, anio) — evalúa TODAS las condiciones para el mes.
// Pensada para el Dashboard (y cualquier vista que muestre el panel).
// mes/anio opcionales: por defecto el mes actual.
// Returns: array de alertas ordenado por nivel (críticas → suaves →
//          positivas). Nunca lanza; en error total devuelve [].
async function evaluarAlertas(mes, anio) {
  try {
    const ahora = new Date();
    const m = mes  || (ahora.getMonth() + 1);
    const a = anio || ahora.getFullYear();

    const grupos = await Promise.all([
      _alertasCategorias(m, a),
      _alertasMetas(),
      _alertasPrestamos(),
      _alertasDesafios(),
    ]);

    const orden = { critica: 0, suave: 1, positiva: 2 };
    return grupos
      .flat()
      .sort((x, y) => orden[x.nivel] - orden[y.nivel]);
  } catch (err) {
    console.error('Error en evaluarAlertas():', err.message || err);
    return [];
  }
}

// evaluarAlertaCategoria(categoria_id, mes, anio) — alerta puntual de UNA
// categoría. Pensada para mostrarse justo al registrar una transacción
// (feedback inmediato sobre el límite de esa categoría).
// Returns: una alerta {nivel,...} o null si la categoría no tiene límite
//          o aún está por debajo del 80%. Nunca lanza.
async function evaluarAlertaCategoria(categoria_id, mes, anio) {
  try {
    const todas = await _alertasCategorias(
      mes  || (new Date().getMonth() + 1),
      anio || new Date().getFullYear()
    );
    return todas.find((al) => al.contexto.categoria_id === categoria_id) || null;
  } catch (err) {
    console.error('Error en evaluarAlertaCategoria():', err.message || err);
    return null;
  }
}
