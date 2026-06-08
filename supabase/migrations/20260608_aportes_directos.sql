-- =====================================================================
-- Nestra — Migración: aportes directos a metas (SESIÓN 8)
-- ---------------------------------------------------------------------
--   * Nueva columna transacciones.es_aporte_directo: marca los gastos
--     generados por un aporte 100% a una meta (no editables en historial).
--   * aporte_directo_meta(): RPC atómica que crea el gasto en Ahorro y
--     asigna el monto íntegro a la meta; el excedente sobre el objetivo
--     va al fondo de emergencia del ámbito de la meta. NO reparte por peso.
--   * Se RETIRA el auto-marcado estado='lograda' de distribuir_ahorro y
--     distribuir_aporte_hogar: la meta llena queda en_curso hasta que el
--     usuario confirme la felicitación en la UI. (El filtro restante>0 ya
--     evita sobre-financiarla aunque siga en_curso.)
-- Migración ADITIVA e idempotente. Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

-- 1. Columna marca de aporte directo.
alter table public.transacciones
  add column if not exists es_aporte_directo boolean not null default false;


-- =====================================================================
-- 2. distribuir_ahorro SIN auto-lograda (resto idéntico al original).
-- =====================================================================
create or replace function public.distribuir_ahorro(p_transaccion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx           public.transacciones%rowtype;
  v_total        numeric(10,2);
  v_fondo_id     uuid;
  v_suma_pesos   numeric := 0;
  v_repartido    numeric(10,2) := 0;
  v_aporte_fondo numeric(10,2);
  r              record;
  v_avance       numeric;
  v_f_horizonte  numeric;
  v_f_urgencia   numeric;
  v_f_rezago     numeric;
  v_peso         numeric;
  v_restante     numeric(10,2);
  v_asignado     numeric(10,2);
begin
  select * into v_tx from public.transacciones where id = p_transaccion_id;
  if not found then
    raise exception 'Transacción % no existe', p_transaccion_id;
  end if;
  if (select auth.uid()) <> v_tx.user_id then
    raise exception 'No autorizado: la transacción no pertenece al usuario';
  end if;

  v_total := v_tx.monto;

  select id into v_fondo_id
  from public.metas
  where es_fondo_emergencia = true
    and ambito = 'personal'
    and user_id = v_tx.user_id
  limit 1;
  if v_fondo_id is null then
    raise exception 'El usuario no tiene fondo de emergencia personal';
  end if;

  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.ambito = 'personal'
      and m.user_id = v_tx.user_id
      and m.es_fondo_emergencia = false
      and m.estado = 'en_curso'
      and m.fecha_limite >= current_date
      and (m.monto_objetivo - coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0)) > 0
  loop
    v_f_horizonte := case r.horizonte when 'corto' then 3 when 'mediano' then 2 else 1 end;
    v_f_urgencia  := case
                       when (r.fecha_limite - current_date) < 7  then 3
                       when (r.fecha_limite - current_date) < 30 then 2
                       else 1
                     end;
    v_avance  := r.progreso / r.monto_objetivo;
    v_f_rezago := greatest(0.2, least(1, 1 - v_avance));
    v_peso := r.importancia * v_f_horizonte * v_f_urgencia * v_f_rezago;
    v_suma_pesos := v_suma_pesos + v_peso;
  end loop;

  select importancia into v_peso from public.metas where id = v_fondo_id;
  v_suma_pesos := v_suma_pesos + v_peso;

  if v_suma_pesos <= 0 then
    return;
  end if;

  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.ambito = 'personal'
      and m.user_id = v_tx.user_id
      and m.es_fondo_emergencia = false
      and m.estado = 'en_curso'
      and m.fecha_limite >= current_date
      and (m.monto_objetivo - coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0)) > 0
  loop
    v_f_horizonte := case r.horizonte when 'corto' then 3 when 'mediano' then 2 else 1 end;
    v_f_urgencia  := case
                       when (r.fecha_limite - current_date) < 7  then 3
                       when (r.fecha_limite - current_date) < 30 then 2
                       else 1
                     end;
    v_avance   := r.progreso / r.monto_objetivo;
    v_f_rezago := greatest(0.2, least(1, 1 - v_avance));
    v_peso     := r.importancia * v_f_horizonte * v_f_urgencia * v_f_rezago;

    v_restante := r.monto_objetivo - r.progreso;
    v_asignado := round(v_total * (v_peso / v_suma_pesos), 2);

    if v_asignado > v_restante then
      v_asignado := v_restante;
    end if;

    if v_asignado > 0 then
      insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
      values (r.id, v_tx.id, v_asignado, v_peso);
      v_repartido := v_repartido + v_asignado;
      -- (auto-marcado de 'lograda' RETIRADO intencionalmente)
    end if;
  end loop;

  select importancia into v_peso from public.metas where id = v_fondo_id;
  v_aporte_fondo := v_total - v_repartido;

  if v_aporte_fondo > 0 then
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
    values (v_fondo_id, v_tx.id, v_aporte_fondo, v_peso);
  end if;
end;
$$;

grant  execute on function public.distribuir_ahorro(uuid) to authenticated;
revoke execute on function public.distribuir_ahorro(uuid) from anon, public;


-- =====================================================================
-- 3. distribuir_aporte_hogar SIN auto-lograda (resto idéntico al original).
-- =====================================================================
create or replace function public.distribuir_aporte_hogar(p_aporte_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ingreso      public.transacciones%rowtype;
  v_total        numeric(10,2);
  v_fondo_id     uuid;
  v_suma_pesos   numeric := 0;
  v_repartido    numeric(10,2) := 0;
  v_aporte_fondo numeric(10,2);
  r              record;
  v_avance       numeric;
  v_f_horizonte  numeric;
  v_f_urgencia   numeric;
  v_f_rezago     numeric;
  v_peso         numeric;
  v_restante     numeric(10,2);
  v_asignado     numeric(10,2);
begin
  if not exists (
    select 1 from public.transacciones
    where aporte_id = p_aporte_id
      and ambito = 'personal'
      and (select auth.uid()) = user_id
  ) then
    raise exception 'No autorizado: el aporte % no pertenece al usuario o no existe', p_aporte_id;
  end if;

  select * into v_ingreso
  from public.transacciones
  where aporte_id = p_aporte_id
    and ambito = 'hogar'
    and tipo = 'ingreso'
  limit 1;
  if not found then
    raise exception 'No existe la mitad de ingreso del hogar para el aporte %', p_aporte_id;
  end if;

  v_total := v_ingreso.monto;

  select id into v_fondo_id
  from public.metas
  where es_fondo_emergencia = true
    and ambito = 'hogar'
  limit 1;
  if v_fondo_id is null then
    raise exception 'No existe fondo de emergencia del hogar';
  end if;

  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.ambito = 'hogar'
      and m.user_id is null
      and m.es_fondo_emergencia = false
      and m.estado = 'en_curso'
      and m.fecha_limite >= current_date
      and (m.monto_objetivo - coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0)) > 0
  loop
    v_f_horizonte := case r.horizonte when 'corto' then 3 when 'mediano' then 2 else 1 end;
    v_f_urgencia  := case
                       when (r.fecha_limite - current_date) < 7  then 3
                       when (r.fecha_limite - current_date) < 30 then 2
                       else 1
                     end;
    v_avance   := r.progreso / r.monto_objetivo;
    v_f_rezago := greatest(0.2, least(1, 1 - v_avance));
    v_peso     := r.importancia * v_f_horizonte * v_f_urgencia * v_f_rezago;
    v_suma_pesos := v_suma_pesos + v_peso;
  end loop;

  select importancia into v_peso from public.metas where id = v_fondo_id;
  v_suma_pesos := v_suma_pesos + v_peso;

  if v_suma_pesos <= 0 then
    return;
  end if;

  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.ambito = 'hogar'
      and m.user_id is null
      and m.es_fondo_emergencia = false
      and m.estado = 'en_curso'
      and m.fecha_limite >= current_date
      and (m.monto_objetivo - coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0)) > 0
  loop
    v_f_horizonte := case r.horizonte when 'corto' then 3 when 'mediano' then 2 else 1 end;
    v_f_urgencia  := case
                       when (r.fecha_limite - current_date) < 7  then 3
                       when (r.fecha_limite - current_date) < 30 then 2
                       else 1
                     end;
    v_avance   := r.progreso / r.monto_objetivo;
    v_f_rezago := greatest(0.2, least(1, 1 - v_avance));
    v_peso     := r.importancia * v_f_horizonte * v_f_urgencia * v_f_rezago;

    v_restante := r.monto_objetivo - r.progreso;
    v_asignado := round(v_total * (v_peso / v_suma_pesos), 2);

    if v_asignado > v_restante then
      v_asignado := v_restante;
    end if;

    if v_asignado > 0 then
      insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
      values (r.id, v_ingreso.id, v_asignado, v_peso);
      v_repartido := v_repartido + v_asignado;
      -- (auto-marcado de 'lograda' RETIRADO intencionalmente)
    end if;
  end loop;

  select importancia into v_peso from public.metas where id = v_fondo_id;
  v_aporte_fondo := v_total - v_repartido;

  if v_aporte_fondo > 0 then
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
    values (v_fondo_id, v_ingreso.id, v_aporte_fondo, v_peso);
  end if;
end;
$$;

grant  execute on function public.distribuir_aporte_hogar(uuid) to authenticated;
revoke execute on function public.distribuir_aporte_hogar(uuid) from anon, public;


-- =====================================================================
-- 4. aporte_directo_meta — aporte 100% a una meta (excedente al fondo).
-- ---------------------------------------------------------------------
-- Atómica: crea el gasto en Ahorro (es_aporte_directo=true) y el/los
-- aportes_meta. NO reparte por peso. NO marca 'lograda'. Topea la meta
-- en su restante; el excedente va al fondo de emergencia del ÁMBITO de
-- la meta (personal del usuario, o del hogar). Un fondo recibe todo sin
-- topear. peso_aplicado queda NULL (marca de "no repartido por peso").
-- SEGURIDAD: SECURITY DEFINER; valida acceso a la meta (propia o hogar).
-- =====================================================================
create or replace function public.aporte_directo_meta(
  p_meta_id uuid,
  p_monto   numeric,
  p_fecha   date,
  p_nota    text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_meta       public.metas%rowtype;
  v_cat_ahorro uuid;
  v_tx_id      uuid;
  v_progreso   numeric(10,2);
  v_restante   numeric(10,2);
  v_a_meta     numeric(10,2);
  v_a_fondo    numeric(10,2);
  v_fondo_id   uuid;
begin
  -- 1. Validar monto.
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del aporte debe ser mayor que 0';
  end if;

  -- 2. Cargar la meta y validar acceso.
  select * into v_meta from public.metas where id = p_meta_id;
  if not found then
    raise exception 'La meta % no existe', p_meta_id;
  end if;
  if not (v_meta.ambito = 'hogar' or v_meta.user_id = v_uid) then
    raise exception 'No autorizado: la meta no pertenece al usuario';
  end if;

  -- 3. Categoría Ahorro (compartida, tipo gasto).
  select id into v_cat_ahorro
  from public.categorias
  where nombre = 'Ahorro' and tipo = 'gasto'
  limit 1;
  if v_cat_ahorro is null then
    raise exception 'No existe la categoría Ahorro';
  end if;

  -- 4. Insertar el gasto personal del usuario, marcado como aporte directo.
  insert into public.transacciones
    (fecha, tipo, ambito, user_id, categoria_id, monto, nota, es_aporte_directo)
  values
    (coalesce(p_fecha, current_date), 'gasto', 'personal', v_uid, v_cat_ahorro, p_monto, p_nota, true)
  returning id into v_tx_id;

  -- 5. Progreso actual de la meta.
  select coalesce(sum(a.monto), 0) into v_progreso
  from public.aportes_meta a where a.meta_id = p_meta_id;

  -- Fondo o meta sin objetivo → todo a la meta, sin overflow.
  if v_meta.es_fondo_emergencia or v_meta.monto_objetivo is null then
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
    values (p_meta_id, v_tx_id, p_monto, null);
    return v_tx_id;
  end if;

  v_restante := v_meta.monto_objetivo - v_progreso;

  if v_restante <= 0 then
    v_a_meta  := 0;
    v_a_fondo := p_monto;
  elsif p_monto <= v_restante then
    v_a_meta  := p_monto;
    v_a_fondo := 0;
  else
    v_a_meta  := v_restante;
    v_a_fondo := p_monto - v_restante;
  end if;

  if v_a_meta > 0 then
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
    values (p_meta_id, v_tx_id, v_a_meta, null);
  end if;

  if v_a_fondo > 0 then
    if v_meta.ambito = 'hogar' then
      select id into v_fondo_id from public.metas
      where es_fondo_emergencia and ambito = 'hogar' limit 1;
    else
      select id into v_fondo_id from public.metas
      where es_fondo_emergencia and ambito = 'personal' and user_id = v_uid limit 1;
    end if;
    if v_fondo_id is null then
      raise exception 'No existe el fondo de emergencia del ámbito % para el excedente', v_meta.ambito;
    end if;
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
    values (v_fondo_id, v_tx_id, v_a_fondo, null);
  end if;

  return v_tx_id;
end;
$$;

grant  execute on function public.aporte_directo_meta(uuid, numeric, date, text) to authenticated;
revoke execute on function public.aporte_directo_meta(uuid, numeric, date, text) from anon, public;
