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

// _rangoSemana(ref?) — lunes 00:00 de la semana actual → hoy (hora local).
// Semana ISO (lunes primer día). ref: Date opcional (default: hoy).
// Retorna { desde: 'YYYY-MM-DD', hasta: 'YYYY-MM-DD', diasTranscurridos }.
function _rangoSemana(ref) {
  const hoy = ref ? new Date(ref) : new Date();
  const dow = hoy.getDay();              // 0=domingo … 6=sábado
  const offsetLunes = (dow + 6) % 7;     // días desde el lunes
  const lunes = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - offsetLunes);
  const fmt = (d) => d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
  return { desde: fmt(lunes), hasta: fmt(hoy), diasTranscurridos: offsetLunes + 1 };
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

    // Si es un gasto en categoría "Ahorro", repartir entre las metas personales
    // vía RPC atómico. Best-effort: la transacción ya existe (balance correcto);
    // un fallo del reparto NO debe revertirla ni propagarse.
    if (data.tipo === 'gasto') {
      await _distribuirSiAhorro(data);
    }
    return data;
  } catch (err) {
    console.error('Error en insertTransaccion():', err.message || err);
    throw err;
  }
}

// _distribuirSiAhorro(tx) — si la transacción es un gasto en categoría "Ahorro",
// invoca el RPC distribuir_ahorro. No lanza (best-effort).
async function _distribuirSiAhorro(tx) {
  try {
    // Los aportes directos ya asignan su monto a mano; nunca se reparten.
    if (tx && tx.es_aporte_directo) return;
    const cats = await getCategorias('gasto');
    const cat = cats.find((c) => c.id === tx.categoria_id);
    if (!cat || cat.nombre !== 'Ahorro') return;
    const { error } = await supabase.rpc('distribuir_ahorro', { p_transaccion_id: tx.id });
    if (error) throw error;
  } catch (err) {
    console.error('Aviso: no se pudo repartir el ahorro entre metas:', err.message || err);
  }
}

// _reDistribuirAhorro(txId, nuevaCatId) — re-reparte aportes_meta tras editar
// una transacción. Borra los aportes previos del tx y re-invoca distribuir_ahorro
// si la nueva categoría sigue siendo "Ahorro". Cubre los 4 casos:
//   Ahorro→Ahorro: borra viejos + redistribuye con nuevo monto.
//   Ahorro→otro:   borra viejos, sin redistribuir.
//   otro→Ahorro:   no hay aportes previos, redistribuye directamente.
//   otro→otro:     noop (no hay aportes, no es Ahorro).
// Best-effort: no lanza, no revierte la edición ya guardada.
async function _reDistribuirAhorro(txId, nuevaCatId) {
  try {
    const cats = await getCategorias('gasto');
    const esAhoraAhorro = cats.some((c) => c.id === nuevaCatId && c.nombre === 'Ahorro');

    // Borrar aportes_meta anteriores del tx (RLS ALL permite al usuario borrar los suyos).
    const { error: errDel } = await supabase
      .from('aportes_meta')
      .delete()
      .eq('transaccion_id', txId);
    if (errDel) throw errDel;

    if (esAhoraAhorro) {
      const { error: errRpc } = await supabase.rpc('distribuir_ahorro', { p_transaccion_id: txId });
      if (errRpc) throw errRpc;
    }
  } catch (err) {
    console.error('Aviso: no se pudo re-distribuir el ahorro tras editar:', err.message || err);
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

    // Repartir el aporte entre las metas del hogar vía RPC atómico. Best-effort:
    // el aporte y su aporte_id ya existen (balances correctos); un fallo del
    // reparto NO debe revertir las transacciones ni propagarse.
    try {
      const { error: errRpc } = await supabase.rpc('distribuir_aporte_hogar', { p_aporte_id: aporteId });
      if (errRpc) throw errRpc;
    } catch (errRpc) {
      console.error('Aviso: no se pudo repartir el aporte entre metas del hogar:', errRpc.message || errRpc);
    }
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

// getCategoriasConFavorito(tipo?) — todas las categorías activas (de `tipo` si se da)
// + bandera `favorita` para el usuario activo. Para la gestión en Configuración.
// Returns: [{ ...categoria, favorita: bool }] o [].
async function getCategoriasConFavorito(tipo = null) {
  try {
    const cats = await getCategorias(tipo);
    const { data: favs, error } = await supabase
      .from('categorias_favoritas')
      .select('categoria_id'); // RLS lo acota al usuario activo
    if (error) throw error;
    const favSet = new Set((favs || []).map((f) => f.categoria_id));
    return cats.map((c) => ({ ...c, favorita: favSet.has(c.id) }));
  } catch (err) {
    console.error('Error en getCategoriasConFavorito():', err.message || err);
    return [];
  }
}

// getCategoriasFavoritas(tipo?) — solo las categorías marcadas favoritas por el
// usuario activo (de `tipo` si se da). Para el Oráculo. Returns: [categoria] o [].
async function getCategoriasFavoritas(tipo = null) {
  const cats = await getCategoriasConFavorito(tipo);
  return cats.filter((c) => c.favorita);
}

// toggleFavorita(categoria_id, on) — marca (on=true) o desmarca (on=false) una
// categoría como favorita del usuario activo. Idempotente (upsert por unique).
// Lanza Error en fallo para que la UI revierta el toggle optimista.
async function toggleFavorita(categoria_id, on) {
  try {
    if (on) {
      const userId = _requireUserId();
      const { error } = await supabase
        .from('categorias_favoritas')
        .upsert({ categoria_id: categoria_id, user_id: userId }, { onConflict: 'user_id,categoria_id' });
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('categorias_favoritas')
        .delete()
        .eq('categoria_id', categoria_id); // RLS limita al usuario activo
      if (error) throw error;
    }
  } catch (err) {
    console.error('Error en toggleFavorita():', err.message || err);
    throw err;
  }
}

// getGastoCategoria(categoria_id, ambito, fecha_desde, fecha_hasta) — suma de
// GASTOS de una categoría en el rango y ámbito dados. Para el oráculo.
// Returns: número (0 en error o sin gastos).
async function getGastoCategoria(categoria_id, ambito, fecha_desde, fecha_hasta) {
  try {
    const txs = await getTransacciones({
      categoria_id: categoria_id,
      ambito: ambito,
      tipo: 'gasto',
      fecha_desde: fecha_desde,
      fecha_hasta: fecha_hasta,
    });
    return (txs || []).reduce((acc, t) => acc + Number(t.monto), 0);
  } catch (err) {
    console.error('Error en getGastoCategoria():', err.message || err);
    return 0;
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

// getAportesPorMiembro(mes, anio) — aporte real al hogar por cada miembro en el
// mes dado, junto al esperado de su perfil. Para el gráfico "aporte real vs. esperado".
// Real = SUMA de transacciones con aporte_id != null en el mes, agrupado por user_id.
// Returns: [{ user_id, nombre, esperado, real }] (un elemento por perfil) o [].
// RLS: perfiles del hogar y transacciones de aporte visibles entre miembros.
async function getAportesPorMiembro(mes, anio) {
  try {
    const { desde, hasta } = _rangoMes(mes, anio);
    const [profiles, txs] = await Promise.all([
      getProfiles(),
      supabase
        .from('transacciones')
        .select('user_id, monto')
        .not('aporte_id', 'is', null)
        .gte('fecha', desde)
        .lte('fecha', hasta),
    ]);
    if (txs.error) throw txs.error;

    const realPorUser = new Map();
    (txs.data || []).forEach((t) => {
      realPorUser.set(t.user_id, (realPorUser.get(t.user_id) || 0) + Number(t.monto));
    });

    return (profiles || []).map((p) => ({
      user_id: p.user_id,
      nombre: p.nombre,
      esperado: Number(p.aporte_mensual_esperado) || 0,
      real: realPorUser.get(p.user_id) || 0,
    }));
  } catch (err) {
    console.error('Error en getAportesPorMiembro():', err.message || err);
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

// getMetas(ambito) — metas visibles con progreso derivado (RLS: hogar + propias).
// Lee la vista metas_con_progreso: monto_actual = SUMA de aportes_meta (no manual).
// Incluye importancia y es_fondo_emergencia. Los fondos (fecha_limite NULL) van al
// final del orden (nullsFirst: false). ambito opcional: 'personal' | 'hogar'.
// Returns: array o [].
async function getMetas(ambito = null) {
  try {
    let query = supabase
      .from('metas_con_progreso')
      .select('*')
      .order('fecha_limite', { ascending: true, nullsFirst: false });
    if (ambito) query = query.eq('ambito', ambito);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error en getMetas():', err.message || err);
    return [];
  }
}

// getAportesDeMeta(meta_id) — aportes recibidos por una meta, con su transacción
// de origen embebida (auditoría / desglose). Returns: array o [].
async function getAportesDeMeta(meta_id) {
  try {
    const { data, error } = await supabase
      .from('aportes_meta')
      .select('*, transacciones(fecha, monto, nota)')
      .eq('meta_id', meta_id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error en getAportesDeMeta():', err.message || err);
    return [];
  }
}

// getAporteMetaMes(meta_id, mes, anio) — suma de aportes a una meta en el mes dado.
// Usado para la variación porcentual mensual del fondo de emergencia.
// Returns: número (0 en error o sin aportes).
async function getAporteMetaMes(meta_id, mes, anio) {
  try {
    const { desde, hasta } = _rangoMes(mes, anio);
    // created_at es timestamptz (UTC). Los límites del mes son hora local de
    // Perú (UTC-5); sin el offset, PostgREST los interpreta como UTC y se
    // pierden aportes de fin de mes por la tarde-noche. Anclar a -05:00.
    const { data, error } = await supabase
      .from('aportes_meta')
      .select('monto, created_at')
      .eq('meta_id', meta_id)
      .gte('created_at', `${desde}T00:00:00-05:00`)
      .lte('created_at', `${hasta}T23:59:59.999-05:00`);
    if (error) throw error;
    return (data || []).reduce((acc, a) => acc + Number(a.monto), 0);
  } catch (err) {
    console.error('Error en getAporteMetaMes():', err.message || err);
    return 0;
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

// insertAporteDirecto(meta_id, monto, fecha, nota) — aporte 100% a una meta.
// Vía RPC atómica aporte_directo_meta: crea un gasto en categoría Ahorro
// marcado como aporte directo y lo asigna íntegro a la meta; el excedente
// sobre el objetivo va al fondo de emergencia del ámbito de la meta. NO
// dispara el reparto por peso ni marca la meta como lograda.
// Returns: id (uuid) de la transacción creada. Lanza Error en fallo.
async function insertAporteDirecto(meta_id, monto, fecha, nota) {
  try {
    const { data, error } = await supabase.rpc('aporte_directo_meta', {
      p_meta_id: meta_id,
      p_monto: monto,
      p_fecha: fecha || null,
      p_nota: nota || null,
    });
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en insertAporteDirecto():', err.message || err);
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

// insertPrestamo(transaccion_id, deudor, estado?) — registra un préstamo nuevo.
// estado: 'pendiente' (default) | 'devuelto' (para registrar préstamos ya saldados).
// Llamar DESPUÉS de insertar la transacción de gasto asociada.
// Returns: fila insertada. Lanza Error en fallo.
async function insertPrestamo(transaccion_id, deudor, estado = 'pendiente') {
  try {
    const { data, error } = await supabase
      .from('prestamos')
      .insert({ transaccion_id, deudor, estado })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en insertPrestamo():', err.message || err);
    throw err;
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
      .update({ estado: 'devuelto', fecha_devolucion: new Date().toISOString().split('T')[0] })
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
