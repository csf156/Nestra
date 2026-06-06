// ─────────────────────────────────────────────────────────────────
// Nestra — db.js
// Capa de datos: centraliza TODAS las queries a Supabase.
// Ninguna vista hace queries directas — todo pasa por este módulo.
//
// Patrón: funciones globales (sin import/export), igual que el resto
// del codebase. Depende de globales ya cargados:
//   - supabase        (cliente, de supabase.js)
//   - getCurrentUser()(usuario activo, de auth.js)
//
// Convención de retorno:
//   - Lecturas → array u objeto de datos (o [] / null en error).
//   - Escrituras → fila insertada/actualizada, o lanza Error.
// Todos los errores se loguean en consola; las escrituras re-lanzan
// para que la vista muestre feedback.
// ─────────────────────────────────────────────────────────────────


// ─── Helpers internos ─────────────────────────────────────────────

// _rangoMes(mes, anio) — primer y último día del mes en formato ISO.
// mes: 1–12. Retorna { desde: 'YYYY-MM-01', hasta: 'YYYY-MM-DD' }.
function _rangoMes(mes, anio) {
  const mm = String(mes).padStart(2, '0');
  const desde = `${anio}-${mm}-01`;
  // new Date(anio, mes, 0) → último día del mes (mes es 1-based aquí).
  const ultimoDia = new Date(anio, mes, 0).getDate();
  const hasta = `${anio}-${mm}-${String(ultimoDia).padStart(2, '0')}`;
  return { desde, hasta };
}

// _requireUserId() — id del usuario activo o lanza si no hay sesión.
function _requireUserId() {
  const user = getCurrentUser();
  if (!user || !user.id) {
    throw new Error('No hay sesión activa');
  }
  return user.id;
}


// ═══════════════════════════════════════════════════════════════════
// TRANSACCIONES
// ═══════════════════════════════════════════════════════════════════

// getTransacciones(filtros) — lista transacciones visibles (RLS aplica).
// filtros (todos opcionales): { ambito, categoria_id, tipo,
//                               fecha_desde, fecha_hasta }
// Returns: array de transacciones (con categoria embebida) o [].
async function getTransacciones(filtros = {}) {
  try {
    let query = supabase
      .from('transacciones')
      .select('*, categorias(nombre, tipo, color)')
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false });

    if (filtros.ambito)       query = query.eq('ambito', filtros.ambito);
    if (filtros.categoria_id) query = query.eq('categoria_id', filtros.categoria_id);
    if (filtros.tipo)         query = query.eq('tipo', filtros.tipo);
    if (filtros.fecha_desde)  query = query.gte('fecha', filtros.fecha_desde);
    if (filtros.fecha_hasta)  query = query.lte('fecha', filtros.fecha_hasta);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error en getTransacciones():', err.message || err);
    return [];
  }
}

// getUltimasTransacciones(limite) — N transacciones más recientes.
// Returns: array (máx. `limite`) o [].
async function getUltimasTransacciones(limite = 5) {
  try {
    const { data, error } = await supabase
      .from('transacciones')
      .select('*, categorias(nombre, tipo, color)')
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limite);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error en getUltimasTransacciones():', err.message || err);
    return [];
  }
}

// insertTransaccion(datos) — crea una transacción.
// datos: { tipo, ambito, categoria_id, monto, fecha?, nota? }
// El user_id se fuerza al usuario activo (RLS exige auth.uid()=user_id).
// Returns: fila insertada. Lanza Error en fallo.
async function insertTransaccion(datos) {
  try {
    const userId = _requireUserId();
    const fila = {
      tipo:         datos.tipo,
      ambito:       datos.ambito,
      categoria_id: datos.categoria_id,
      monto:        datos.monto,
      nota:         datos.nota ?? null,
      user_id:      userId,
    };
    if (datos.fecha) fila.fecha = datos.fecha;

    const { data, error } = await supabase
      .from('transacciones')
      .insert(fila)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en insertTransaccion():', err.message || err);
    throw err;
  }
}

// updateTransaccion(id, datos) — actualiza campos de una transacción.
// datos: subconjunto de { tipo, ambito, categoria_id, monto, fecha, nota }
// Returns: fila actualizada. Lanza Error en fallo.
async function updateTransaccion(id, datos) {
  try {
    const { data, error } = await supabase
      .from('transacciones')
      .update(datos)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en updateTransaccion():', err.message || err);
    throw err;
  }
}

// deleteTransaccion(id) — borra una transacción.
// Si tiene aporte_id, borra ambas mitades del aporte de forma conjunta
// (gasto personal + ingreso hogar). prestamos se borra en cascada (FK).
// Returns: undefined. Lanza Error en fallo.
async function deleteTransaccion(id) {
  try {
    // Leer la fila para saber si es parte de un aporte vinculado.
    const { data: fila, error: errLeer } = await supabase
      .from('transacciones')
      .select('id, aporte_id')
      .eq('id', id)
      .single();
    if (errLeer) throw errLeer;

    let query = supabase.from('transacciones').delete();
    if (fila && fila.aporte_id) {
      // Borra las dos mitades del aporte de una sola vez.
      query = query.eq('aporte_id', fila.aporte_id);
    } else {
      query = query.eq('id', id);
    }

    const { error } = await query;
    if (error) throw error;
  } catch (err) {
    console.error('Error en deleteTransaccion():', err.message || err);
    throw err;
  }
}

// insertAporteHogar(monto, categoria_id, nota, fecha) — aporte al hogar.
// Crea atómicamente dos transacciones vinculadas por un mismo aporte_id:
//   1. Gasto PERSONAL del usuario activo (sale de su balance personal),
//      usando la categoría de gasto que se pasa en `categoria_id`.
//   2. Ingreso del HOGAR (entra al balance compartido), usando una
//      categoría de TIPO ingreso resuelta automáticamente (preferencia:
//      "Aporte al hogar" → "Otros ingresos" → primera categoría ingreso).
//      Así el ingreso no contamina una categoría de gasto en los gráficos.
// PostgREST inserta ambas filas en una sola sentencia (.insert([a, b])):
// es atómico server-side — si una falla, no se crea ninguna. deleteTransaccion
// limpia ambas mitades por aporte_id.
// Returns: array con las dos filas insertadas. Lanza Error en fallo.
async function insertAporteHogar(monto, categoria_id, nota, fecha) {
  try {
    const userId = _requireUserId();
    const aporteId = crypto.randomUUID();

    // Resolver categoría de tipo ingreso para la mitad del hogar.
    const catsIngreso = await getCategorias('ingreso');
    if (!catsIngreso.length) {
      throw new Error('No hay categorías de ingreso para el aporte al hogar');
    }
    const catIngreso =
      catsIngreso.find((c) => c.nombre === 'Aporte al hogar') ||
      catsIngreso.find((c) => c.nombre === 'Otros ingresos') ||
      catsIngreso[0];

    const base = {
      monto,
      nota: nota ?? null,
      user_id: userId,
      aporte_id: aporteId,
    };
    if (fecha) base.fecha = fecha;

    const filas = [
      { ...base, tipo: 'gasto',   ambito: 'personal', categoria_id },
      { ...base, tipo: 'ingreso', ambito: 'hogar',    categoria_id: catIngreso.id },
    ];

    const { data, error } = await supabase
      .from('transacciones')
      .insert(filas)
      .select();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en insertAporteHogar():', err.message || err);
    throw err;
  }
}


// ═══════════════════════════════════════════════════════════════════
// BALANCES
// ═══════════════════════════════════════════════════════════════════

// getBalanceHogar(mes, anio) — totales del hogar para el mes dado.
// Returns: { ingresos, gastos, balance }. Ceros en error.
async function getBalanceHogar(mes, anio) {
  try {
    const { desde, hasta } = _rangoMes(mes, anio);
    const { data, error } = await supabase
      .from('transacciones')
      .select('tipo, monto')
      .eq('ambito', 'hogar')
      .gte('fecha', desde)
      .lte('fecha', hasta);
    if (error) throw error;

    let ingresos = 0, gastos = 0;
    (data || []).forEach((t) => {
      if (t.tipo === 'ingreso') ingresos += Number(t.monto);
      else if (t.tipo === 'gasto') gastos += Number(t.monto);
    });
    return { ingresos, gastos, balance: ingresos - gastos };
  } catch (err) {
    console.error('Error en getBalanceHogar():', err.message || err);
    return { ingresos: 0, gastos: 0, balance: 0 };
  }
}

// getBalancePersonal(mes, anio) — totales personales del usuario activo.
// El aporte al hogar ya es un gasto personal (con aporte_id); por eso
// `gastos` lo incluye y `aporte_realizado` lo reporta por separado como
// subconjunto informativo (no se resta dos veces).
// Returns: { ingresos, gastos, aporte_realizado, balance }. Ceros en error.
async function getBalancePersonal(mes, anio) {
  try {
    const userId = _requireUserId();
    const { desde, hasta } = _rangoMes(mes, anio);
    const { data, error } = await supabase
      .from('transacciones')
      .select('tipo, monto, aporte_id')
      .eq('ambito', 'personal')
      .eq('user_id', userId)
      .gte('fecha', desde)
      .lte('fecha', hasta);
    if (error) throw error;

    let ingresos = 0, gastos = 0, aporte_realizado = 0;
    (data || []).forEach((t) => {
      const monto = Number(t.monto);
      if (t.tipo === 'ingreso') {
        ingresos += monto;
      } else if (t.tipo === 'gasto') {
        gastos += monto;
        if (t.aporte_id) aporte_realizado += monto;
      }
    });
    return { ingresos, gastos, aporte_realizado, balance: ingresos - gastos };
  } catch (err) {
    console.error('Error en getBalancePersonal():', err.message || err);
    return { ingresos: 0, gastos: 0, aporte_realizado: 0, balance: 0 };
  }
}


// ═══════════════════════════════════════════════════════════════════
// CATEGORÍAS
// ═══════════════════════════════════════════════════════════════════

// getCategorias(tipo) — categorías activas. tipo opcional: 'gasto'|'ingreso'.
// Returns: array ordenado por nombre o [].
async function getCategorias(tipo = null) {
  try {
    let query = supabase
      .from('categorias')
      .select('*')
      .eq('estado', 'activa')
      .order('nombre', { ascending: true });
    if (tipo) query = query.eq('tipo', tipo);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error en getCategorias():', err.message || err);
    return [];
  }
}

// insertCategoria(datos) — crea categoría.
// datos: { nombre, tipo, limite_mensual?, color? }
// Returns: fila insertada. Lanza Error en fallo.
async function insertCategoria(datos) {
  try {
    const { data, error } = await supabase
      .from('categorias')
      .insert(datos)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en insertCategoria():', err.message || err);
    throw err;
  }
}

// updateCategoria(id, datos) — actualiza categoría.
// Returns: fila actualizada. Lanza Error en fallo.
async function updateCategoria(id, datos) {
  try {
    const { data, error } = await supabase
      .from('categorias')
      .update(datos)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en updateCategoria():', err.message || err);
    throw err;
  }
}

// deleteCategoria(id) — borra categoría. Falla si tiene transacciones
// (FK on delete restrict); la vista debe ofrecer reasignar o archivar.
// Returns: undefined. Lanza Error en fallo.
async function deleteCategoria(id) {
  try {
    const { error } = await supabase
      .from('categorias')
      .delete()
      .eq('id', id);
    if (error) throw error;
  } catch (err) {
    console.error('Error en deleteCategoria():', err.message || err);
    throw err;
  }
}

// archivarCategoria(id) — oculta sin borrar (estado='archivada').
// Returns: fila actualizada. Lanza Error en fallo.
async function archivarCategoria(id) {
  try {
    const { data, error } = await supabase
      .from('categorias')
      .update({ estado: 'archivada' })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en archivarCategoria():', err.message || err);
    throw err;
  }
}


// ═══════════════════════════════════════════════════════════════════
// PERFILES
// ═══════════════════════════════════════════════════════════════════

// getProfiles() — ambos perfiles (RLS permite leer los dos).
// Returns: array de perfiles o [].
async function getProfiles() {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('nombre', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error en getProfiles():', err.message || err);
    return [];
  }
}

// updateProfile(datos) — actualiza el perfil del usuario activo.
// datos: { nombre?, aporte_mensual_esperado? }
// RLS solo permite editar el propio perfil (user_id = auth.uid()).
// Returns: fila actualizada. Lanza Error en fallo.
async function updateProfile(datos) {
  try {
    const userId = _requireUserId();
    const { data, error } = await supabase
      .from('profiles')
      .update(datos)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en updateProfile():', err.message || err);
    throw err;
  }
}


// ═══════════════════════════════════════════════════════════════════
// METAS
// ═══════════════════════════════════════════════════════════════════

// getMetas(ambito) — metas visibles (RLS: hogar + propias personales).
// ambito opcional: 'personal' | 'hogar'.
// Returns: array o [].
async function getMetas(ambito = null) {
  try {
    let query = supabase
      .from('metas')
      .select('*')
      .order('fecha_limite', { ascending: true });
    if (ambito) query = query.eq('ambito', ambito);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error en getMetas():', err.message || err);
    return [];
  }
}

// insertMeta(datos) — crea meta.
// datos: { nombre, tipo, horizonte, ambito, monto_objetivo,
//          fecha_limite, monto_actual?, fecha_inicio?, nota? }
// Para ambito 'personal' se fuerza user_id al usuario activo; para
// 'hogar' se fuerza user_id NULL (RLS exige esta atribución).
// Returns: fila insertada. Lanza Error en fallo.
async function insertMeta(datos) {
  try {
    const fila = { ...datos };
    if (datos.ambito === 'personal') {
      fila.user_id = _requireUserId();
    } else {
      fila.user_id = null;
    }
    const { data, error } = await supabase
      .from('metas')
      .insert(fila)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en insertMeta():', err.message || err);
    throw err;
  }
}

// updateMeta(id, datos) — actualiza meta.
// Returns: fila actualizada. Lanza Error en fallo.
async function updateMeta(id, datos) {
  try {
    const { data, error } = await supabase
      .from('metas')
      .update(datos)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en updateMeta():', err.message || err);
    throw err;
  }
}

// deleteMeta(id) — borra meta.
// Returns: undefined. Lanza Error en fallo.
async function deleteMeta(id) {
  try {
    const { error } = await supabase
      .from('metas')
      .delete()
      .eq('id', id);
    if (error) throw error;
  } catch (err) {
    console.error('Error en deleteMeta():', err.message || err);
    throw err;
  }
}


// ═══════════════════════════════════════════════════════════════════
// PRÉSTAMOS
// ═══════════════════════════════════════════════════════════════════

// getPrestamos(estado) — préstamos con su transacción embebida.
// estado opcional: 'pendiente' | 'devuelto'.
// Returns: array o [].
async function getPrestamos(estado = null) {
  try {
    let query = supabase
      .from('prestamos')
      .select('*, transacciones(fecha, monto, ambito, nota, user_id)');
    if (estado) query = query.eq('estado', estado);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error en getPrestamos():', err.message || err);
    return [];
  }
}

// marcarDevuelto(prestamo_id, transaccion_id) — cierra un préstamo.
// Orden seguro: marca el préstamo como 'devuelto' PRIMERO; solo si ese
// update tiene éxito registra el ingreso de devolución. Así un fallo al
// marcar no deja un ingreso duplicado huérfano. El ingreso es best-effort
// (si falta la categoría o falla, el préstamo igual queda cerrado).
// Returns: { prestamo, ingreso } (ingreso null si no se pudo crear).
// Lanza Error si falla marcar el préstamo.
async function marcarDevuelto(prestamo_id, transaccion_id) {
  try {
    // 1. Leer la transacción original para replicar monto/ámbito.
    const { data: original, error: errOrig } = await supabase
      .from('transacciones')
      .select('monto, ambito')
      .eq('id', transaccion_id)
      .single();
    if (errOrig) throw errOrig;

    // 2. Marcar el préstamo como devuelto (operación principal).
    const { data: prestamo, error: errPrestamo } = await supabase
      .from('prestamos')
      .update({ estado: 'devuelto' })
      .eq('id', prestamo_id)
      .select()
      .single();
    if (errPrestamo) throw errPrestamo;

    // 3. Registrar el ingreso de devolución (best-effort, post-cierre).
    let ingreso = null;
    try {
      const cats = await getCategorias('ingreso');
      const catDevolucion = cats.find(
        (c) => c.nombre === 'Devolución de préstamo'
      );
      if (catDevolucion) {
        ingreso = await insertTransaccion({
          tipo: 'ingreso',
          ambito: original.ambito,
          categoria_id: catDevolucion.id,
          monto: original.monto,
          nota: 'Devolución de préstamo',
        });
      } else {
        console.warn('marcarDevuelto: categoría "Devolución de préstamo" no encontrada; se omite el ingreso automático.');
      }
    } catch (errIngreso) {
      console.error('marcarDevuelto: préstamo cerrado pero no se pudo registrar el ingreso:', errIngreso.message || errIngreso);
    }

    return { prestamo, ingreso };
  } catch (err) {
    console.error('Error en marcarDevuelto():', err.message || err);
    throw err;
  }
}


// ═══════════════════════════════════════════════════════════════════
// DESAFÍOS
// ═══════════════════════════════════════════════════════════════════

// getDesafios(estado) — desafíos visibles (RLS: hogar + propios personales).
// estado opcional: 'activo' | 'completado' | 'abandonado'.
// Returns: array o [].
async function getDesafios(estado = null) {
  try {
    let query = supabase
      .from('desafios')
      .select('*, categorias(nombre, color)')
      .order('fecha_inicio', { ascending: false });
    if (estado) query = query.eq('estado', estado);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error en getDesafios():', err.message || err);
    return [];
  }
}

// insertDesafio(datos) — crea desafío.
// datos: { titulo, ambito, duracion_dias, descripcion?, fecha_inicio?,
//          categoria_id? }
// Para 'personal' fuerza user_id al activo; para 'hogar' fuerza NULL.
// fecha_fin se calcula en la BD (columna generada).
// Returns: fila insertada. Lanza Error en fallo.
async function insertDesafio(datos) {
  try {
    const fila = { ...datos };
    if (datos.ambito === 'personal') {
      fila.user_id = _requireUserId();
    } else {
      fila.user_id = null;
    }
    const { data, error } = await supabase
      .from('desafios')
      .insert(fila)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en insertDesafio():', err.message || err);
    throw err;
  }
}

// updateDesafio(id, datos) — actualiza desafío (p. ej. estado).
// Returns: fila actualizada. Lanza Error en fallo.
async function updateDesafio(id, datos) {
  try {
    const { data, error } = await supabase
      .from('desafios')
      .update(datos)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en updateDesafio():', err.message || err);
    throw err;
  }
}


// ═══════════════════════════════════════════════════════════════════
// RESUMEN
// ═══════════════════════════════════════════════════════════════════

// getResumenMensual(mes, anio) — cierre del mes: balances + desglose.
// Combina balance del hogar, balance personal del usuario activo, y el
// desglose de gastos por categoría (hogar + personales propios) del mes.
// Returns: { hogar, personal, porCategoria } — porCategoria es array de
//          { categoria_id, nombre, total }. Estructura vacía en error.
async function getResumenMensual(mes, anio) {
  try {
    const userId = _requireUserId();
    const { desde, hasta } = _rangoMes(mes, anio);

    const [hogar, personal] = await Promise.all([
      getBalanceHogar(mes, anio),
      getBalancePersonal(mes, anio),
    ]);

    // Gastos del mes visibles (hogar + personales propios) por categoría.
    const { data, error } = await supabase
      .from('transacciones')
      .select('categoria_id, monto, categorias(nombre)')
      .eq('tipo', 'gasto')
      .gte('fecha', desde)
      .lte('fecha', hasta);
    if (error) throw error;

    const mapa = new Map();
    (data || []).forEach((t) => {
      const prev = mapa.get(t.categoria_id) || {
        categoria_id: t.categoria_id,
        nombre: t.categorias ? t.categorias.nombre : '—',
        total: 0,
      };
      prev.total += Number(t.monto);
      mapa.set(t.categoria_id, prev);
    });
    const porCategoria = Array.from(mapa.values())
      .sort((a, b) => b.total - a.total);

    return { hogar, personal, porCategoria };
  } catch (err) {
    console.error('Error en getResumenMensual():', err.message || err);
    return {
      hogar: { ingresos: 0, gastos: 0, balance: 0 },
      personal: { ingresos: 0, gastos: 0, aporte_realizado: 0, balance: 0 },
      porCategoria: [],
    };
  }
}
