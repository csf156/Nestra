-- =====================================================================
-- Nestra — Ahorro como tipo puro (sin categoría)
-- ---------------------------------------------------------------------
-- 1. categoria_id NULLABLE + CHECK (ahorro sin categoría; gasto/ingreso con ella).
-- 2. Borrar la categoría 'Ahorro' (sin uso en v2).
-- 3. distribuir_ahorro: generalizado por ámbito (personal | hogar).
-- 4. aporte_directo_meta: crea tipo='ahorro' sin categoría (ya no gasto en 'Ahorro').
-- Idempotente. Ejecutar en SQL Editor / vía MCP apply_migration.
-- =====================================================================

-- 1. categoria_id nullable + CHECK por tipo.
alter table public.transacciones alter column categoria_id drop not null;
alter table public.transacciones drop constraint if exists transacciones_categoria_por_tipo;
alter table public.transacciones add constraint transacciones_categoria_por_tipo
  check (tipo = 'ahorro' or categoria_id is not null);

-- 2. Borrar la categoría 'Ahorro' (0 referencias en v2).
delete from public.categorias where nombre = 'Ahorro' and tipo = 'gasto';

-- 3. distribuir_ahorro(p_transaccion_id) — reparte por ÁMBITO.
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

  -- Fondo del ámbito. Personal: siempre existe (auto-creado por usuario).
  -- Hogar: OPCIONAL (el fondo compartido es territorio de Fase 5); si no
  -- existe, el excedente sobre las metas queda sin asignar (el ahorro igual
  -- se registra como tipo='ahorro').
  if v_tx.ambito = 'hogar' then
    select id into v_fondo_id from public.metas
    where es_fondo_emergencia = true and ambito = 'hogar' limit 1;
  else
    select id into v_fondo_id from public.metas
    where es_fondo_emergencia = true and ambito = 'personal' and user_id = v_tx.user_id limit 1;
    if v_fondo_id is null then
      raise exception 'No existe el fondo de emergencia personal del usuario';
    end if;
  end if;

  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.es_fondo_emergencia = false
      and m.estado = 'en_curso'
      and m.fecha_limite >= current_date
      and (m.monto_objetivo - coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0)) > 0
      and (
        (v_tx.ambito = 'personal' and m.ambito = 'personal' and m.user_id = v_tx.user_id)
        or (v_tx.ambito = 'hogar' and m.ambito = 'hogar')
      )
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

  if v_fondo_id is not null then
    select importancia into v_peso from public.metas where id = v_fondo_id;
    v_suma_pesos := v_suma_pesos + v_peso;
  end if;

  if v_suma_pesos <= 0 then
    return;
  end if;

  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.es_fondo_emergencia = false
      and m.estado = 'en_curso'
      and m.fecha_limite >= current_date
      and (m.monto_objetivo - coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0)) > 0
      and (
        (v_tx.ambito = 'personal' and m.ambito = 'personal' and m.user_id = v_tx.user_id)
        or (v_tx.ambito = 'hogar' and m.ambito = 'hogar')
      )
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
      insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
      values (r.id, v_tx.id, v_asignado, v_peso, v_tx.user_id);
      v_repartido := v_repartido + v_asignado;
    end if;
  end loop;

  v_aporte_fondo := v_total - v_repartido;
  if v_aporte_fondo > 0 and v_fondo_id is not null then
    select importancia into v_peso from public.metas where id = v_fondo_id;
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
    values (v_fondo_id, v_tx.id, v_aporte_fondo, v_peso, v_tx.user_id);
  end if;
end;
$$;

grant  execute on function public.distribuir_ahorro(uuid) to authenticated;
revoke execute on function public.distribuir_ahorro(uuid) from anon, public;

-- 4. aporte_directo_meta — sin categoría 'Ahorro'; crea tipo='ahorro'.
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
  v_tx_id      uuid;
  v_progreso   numeric(10,2);
  v_restante   numeric(10,2);
  v_a_meta     numeric(10,2);
  v_a_fondo    numeric(10,2);
  v_fondo_id   uuid;
begin
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del aporte debe ser mayor que 0';
  end if;

  select * into v_meta from public.metas where id = p_meta_id;
  if not found then
    raise exception 'La meta % no existe', p_meta_id;
  end if;
  if not (v_meta.ambito = 'hogar' or v_meta.user_id = v_uid) then
    raise exception 'No autorizado: la meta no pertenece al usuario';
  end if;

  insert into public.transacciones
    (fecha, tipo, ambito, user_id, categoria_id, monto, nota, es_aporte_directo)
  values
    (coalesce(p_fecha, current_date), 'ahorro', 'personal', v_uid, null, p_monto, p_nota, true)
  returning id into v_tx_id;

  select coalesce(sum(a.monto), 0) into v_progreso
  from public.aportes_meta a where a.meta_id = p_meta_id;

  if v_meta.es_fondo_emergencia or v_meta.monto_objetivo is null then
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
    values (p_meta_id, v_tx_id, p_monto, null, v_uid);
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
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
    values (p_meta_id, v_tx_id, v_a_meta, null, v_uid);
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
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
    values (v_fondo_id, v_tx_id, v_a_fondo, null, v_uid);
  end if;

  return v_tx_id;
end;
$$;

grant  execute on function public.aporte_directo_meta(uuid, numeric, date, text) to authenticated;
revoke execute on function public.aporte_directo_meta(uuid, numeric, date, text) from anon, public;
