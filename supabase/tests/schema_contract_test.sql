-- supabase/tests/schema_contract_test.sql
-- Contrato de esquema: toda tabla/RPC que el CLIENTE realmente invoca debe
-- existir en la base contra la que corre. Correr tras cada migración y
-- periódicamente (ver CLAUDE.md § Migraciones). Imprime ALL TESTS PASSED
-- si pasa. Solo lectura (pg_tables/pg_proc); no modifica datos.
--
-- Por qué existe: la Fase 6.2 se desplegó en código (SHELL_VERSION v21) con
-- su migración sin aplicar. `list_migrations`/`schema_migrations` no lo
-- detectó porque en este proyecto NO es fiable — migraciones aplicadas a
-- mano por el SQL Editor no quedan registradas (ver CLAUDE.md). El bug vivió
-- 13 días porque el código degradaba en silencio (`|| '50_50'`) en vez de
-- fallar. Este test ataca la causa raíz: en vez de confiar en el ledger o en
-- la memoria, pregunta directamente al esquema si lo que el cliente usa
-- existe.
--
-- Mantenimiento: la lista de abajo se generó grepeando `.from('...')` y
-- `.rpc('...')` en js/*.js (las vistas NO llaman a Supabase directo, todo
-- pasa por js/db.js, js/auth.js, js/push.js, js/sync.js — verificado
-- 2026-07-15). Al añadir una tabla/RPC nueva a js/, añadir su fila aquí en
-- el mismo commit. Un test que no se actualiza junto al código que protege
-- deja de proteger nada.
--
-- Cuidado al re-grepear: `supabase.storage.from('recibos')` (Storage,
-- bucket) NO es `supabase.from('...')` (Postgres, tabla) aunque el patrón
-- `.from('...')` los confunde — 'recibos' se verifica aparte, contra
-- list_storage_buckets, no contra pg_class. Un primer intento de este test
-- mezcló ambos y reportó un falso "FALLO: recibos no existe".

-- ── Tablas/vistas que el cliente usa vía supabase.from(...) ──────────
do $$
declare
  v_tablas text[] := array[
    'profiles','transacciones','aportes_meta','categorias',
    'categorias_favoritas','hogar_miembros','metas_con_progreso','metas',
    'recurrentes','prestamos','desafios','plantillas','hogares',
    'hogar_codigos','hogar_liquidaciones','push_subscriptions',
    'ingest_pendientes', -- cola de revisión de ingesta (db.js getIngestPendientes/confirmar/descartar, 2026-07-15)
    'contraparte_alias'  -- alias de contrapartes (db.js getAliasContrapartes/setAliasContraparte, 2026-09-05)
  ];
  v_tabla text;
  v_faltan text[] := array[]::text[];
begin
  foreach v_tabla in array v_tablas loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_tabla
        and c.relkind in ('r','v')  -- tabla o vista (metas_con_progreso es vista)
    ) then
      v_faltan := array_append(v_faltan, v_tabla);
    end if;
  end loop;
  if array_length(v_faltan, 1) > 0 then
    raise exception 'FALLO: tablas/vistas que el cliente usa y NO existen: %', v_faltan;
  end if;
end $$;

-- ── RPCs que el cliente invoca vía .rpc(...) ─────────────────────────
-- set_reparto_hogar excluido a propósito: ver sección "Diferido" abajo.
--
-- distribuir_aporte_hogar retirado el 2026-07-16: era un fósil. Repartía el
-- "ingreso de hogar" entre las metas del hogar, y la Fase 6.3 eliminó ese
-- concepto — el hogar no tiene ingresos propios. La migración a3a9496 borró
-- el RPC de la base y 3dd164b quitó las llamadas del cliente, pero nadie lo
-- sacó de esta lista, así que el test quedó rojo de forma permanente desde
-- entonces: exactamente el modo de fallo contra el que advierte la cabecera
-- de este archivo. Verificado antes de quitarlo: no existe en pg_proc y no
-- lo invoca ni js/ ni views/.
do $$
declare
  v_rpcs text[] := array[
    'distribuir_ahorro','aporte_directo_meta','set_pct_fondo',
    'crear_hogar','generar_codigo','unirse_hogar','saldar_hogar',
    'disolver_hogar','set_aporte_esperado','renombrar_hogar'
  ];
  v_rpc text;
  v_faltan text[] := array[]::text[];
begin
  foreach v_rpc in array v_rpcs loop
    if not exists (
      select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_rpc
    ) then
      v_faltan := array_append(v_faltan, v_rpc);
    end if;
  end loop;
  if array_length(v_faltan, 1) > 0 then
    raise exception 'FALLO: RPCs que el cliente llama y NO existen: %', v_faltan;
  end if;
end $$;

-- ── Columnas frágiles: referenciadas con patrón `x != null ? x : fallback`
-- o `x || fallback` en el cliente. Si faltan, el código NO falla — degrada
-- en silencio (el bug de Fase 6.2). Por eso se verifican aparte y con
-- mensaje explícito de dónde está el fallback que las esconde.
do $$
declare
  v_cols text[][] := array[
    array['hogar_miembros','aporte_esperado','views/configuracion.html:1846'],
    array['categorias','limite_mensual_hogar','views/configuracion.html:1856, dashboard.html:713/745, alerts.js:124'],
    array['transacciones','hogar_id','db.js:585, safe-to-spend.js:137, graficos.html:282/290'],
    array['ingest_pendientes','updated_at','db.js _aplicarIngestEstado + sync.js op ingest_estado (LWW); si falta, el UPDATE offline no puede resolver conflictos'],
    array['profiles','pct_ahorro_objetivo','js/ahorro-pct.js + safe-to-spend (techo de reserva); si falta, el techo cae a 50 en silencio'],
    array['metas','pct_fondo_emergencia','js/db.js getPctFondo + configuracion.html; si falta, el % del fondo cae a 10 en silencio y set_pct_fondo falla']
  ];
  v_col text[];
  v_faltan text[] := array[]::text[];
begin
  foreach v_col slice 1 in array v_cols loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_col[1] and column_name = v_col[2]
    ) then
      v_faltan := array_append(v_faltan, v_col[1] || '.' || v_col[2] || ' (usada en ' || v_col[3] || ')');
    end if;
  end loop;
  if array_length(v_faltan, 1) > 0 then
    raise exception 'FALLO: columnas frágiles (degradan en silencio si faltan): %', v_faltan;
  end if;
end $$;

-- ── Aislamiento entre hogares en distribuir_ahorro ───────────────────
-- La rama 'hogar' de distribuir_ahorro no filtraba por hogar_id en 3 sitios
-- (el fondo + las dos pasadas del loop de metas), así que repartía el ahorro
-- de un hogar entre las metas de CUALQUIER hogar. Como es SECURITY DEFINER,
-- escribía saltándose la RLS. Estaba dormido porque solo existía un hogar
-- (`limit 1` siempre acertaba); se detectó el 2026-07-16 al crear un segundo.
-- Migración: 20260716_distribuir_ahorro_aisla_hogar.sql.
--
-- Este check es textual a propósito: no hay forma barata de ejercitar el RPC
-- desde un test de solo lectura (exige auth.uid() y dos hogares con metas).
-- Vigila que nadie reintroduzca la versión sin filtrar al re-crear la función.
do $$
declare
  v_def text;
  v_loops int;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'distribuir_ahorro';

  if v_def is null then
    raise exception 'FALLO: distribuir_ahorro no existe';
  end if;

  if v_def not like '%and hogar_id = v_tx.hogar_id%' then
    raise exception 'FALLO: distribuir_ahorro busca el fondo del hogar sin filtrar por hogar_id — reparte a las metas de otro hogar';
  end if;

  v_loops := (length(v_def) - length(replace(v_def, 'm.hogar_id = v_tx.hogar_id', '')))
             / length('m.hogar_id = v_tx.hogar_id');
  if v_loops < 2 then
    raise exception 'FALLO: distribuir_ahorro tiene % de los 2 loops de metas acotados a v_tx.hogar_id — fuga entre hogares', v_loops;
  end if;
end $$;

-- ── Buckets de Storage que el cliente usa vía supabase.storage.from(...) ──
do $$
declare
  v_buckets text[] := array['recibos'];  -- db.js:1404,1422 (subirRecibo/getReciboUrl)
  v_bucket text;
  v_faltan text[] := array[]::text[];
begin
  foreach v_bucket in array v_buckets loop
    if not exists (
      select 1 from storage.buckets where id = v_bucket
    ) then
      v_faltan := array_append(v_faltan, v_bucket);
    end if;
  end loop;
  if array_length(v_faltan, 1) > 0 then
    raise exception 'FALLO: buckets de Storage que el cliente usa y NO existen: %', v_faltan;
  end if;
end $$;

-- ── RLS de aportes_meta: lectura de hogar compartida ─────────────────
-- El progreso de metas de HOGAR se suma vía metas_con_progreso
-- (security_invoker). Si la RLS de aportes_meta vuelve a restringir SELECT a
-- solo auth.uid()=user_id, cada miembro ve solo SU fracción del progreso (bug
-- arreglado el 2026-07-19, migración 20260719_aportes_meta_rls_hogar.sql).
-- Este check vigila que la policy de SELECT siga ampliada a los co-miembros
-- del hogar (referencia auth_hogar_id). Las policies de escritura siguen
-- restringidas al dueño a propósito; no se verifican aquí.
do $$
declare
  v_select_qual text;
begin
  select pg_get_expr(pol.polqual, pol.polrelid) into v_select_qual
  from pg_policy pol
  where pol.polrelid = 'public.aportes_meta'::regclass
    and pol.polcmd in ('r','*')   -- SELECT o ALL
  limit 1;

  if v_select_qual is null then
    raise exception 'FALLO: aportes_meta no tiene policy de SELECT (ni ALL)';
  end if;

  if v_select_qual not like '%auth_hogar_id%' then
    raise exception 'FALLO: la RLS de SELECT de aportes_meta no incluye a los co-miembros del hogar (falta auth_hogar_id) — el progreso de metas de hogar volvería a mostrar solo los aportes propios';
  end if;
end $$;

-- ── Diferido a Fase 6.3 (informativo, NO falla el test) ──────────────
-- hogares.reparto y set_reparto_hogar se retiraron deliberadamente de la
-- migración de Fase 6.2 el 2026-07-14 (commit c9bddb8) porque la Fase 6.3
-- redefine su semántica. El selector de UI que los usaba también se retiró
-- (views/configuracion.html). Se espera que NO existan hasta que 6.3 los
-- cree. Si este bloque imprime "YA EXISTEN", 6.3 avanzó — no es un fallo,
-- pero hay que revisar si esta sección del test debe promoverse arriba.
do $$
declare v_existe boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='hogares' and column_name='reparto'
  ) into v_existe;
  if v_existe then
    raise notice 'hogares.reparto YA EXISTE — revisar si Fase 6.3 avanzó y promover este check arriba.';
  else
    raise notice 'hogares.reparto ausente, como se espera hasta Fase 6.3.';
  end if;
end $$;

select 'ALL TESTS PASSED' as resultado;
