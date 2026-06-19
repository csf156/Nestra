-- supabase/migrations/20260618_fase0_multitenant_up.sql
-- Fase 0 — strict per-user tenancy. Apply in the v2 SQL Editor ONLY.
-- Idempotent: safe to run more than once. NEVER run on production.

begin;

-- ── A.1 Fold in the missing categorias_favoritas table ───────────────
create table if not exists public.categorias_favoritas (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  categoria_id uuid not null references public.categorias (id) on delete cascade,
  unique (user_id, categoria_id)
);
create index if not exists idx_categorias_favoritas_user_id
  on public.categorias_favoritas (user_id);
alter table public.categorias_favoritas enable row level security;

-- ── A.2 Add user_id where missing ────────────────────────────────────
alter table public.prestamos    add column if not exists user_id uuid references auth.users (id) on delete cascade;
alter table public.aportes_meta add column if not exists user_id uuid references auth.users (id) on delete cascade;
alter table public.categorias   add column if not exists user_id uuid references auth.users (id) on delete cascade;

-- ── A.3 Backfill (idempotent: only fills NULLs) ──────────────────────
-- prestamos.user_id ← owner of its transaction
update public.prestamos p
   set user_id = t.user_id
  from public.transacciones t
 where p.transaccion_id = t.id
   and p.user_id is null;

-- aportes_meta.user_id ← owner of its origin transaction
update public.aportes_meta a
   set user_id = t.user_id
  from public.transacciones t
 where a.transaccion_id = t.id
   and a.user_id is null;

-- legacy hogar rows (user_id null) ← designated owner (Christian)
update public.metas
   set user_id = 'aa5a03e9-12fe-4e9f-8900-ced28359db90'
 where user_id is null;
update public.desafios
   set user_id = 'aa5a03e9-12fe-4e9f-8900-ced28359db90'
 where user_id is null;

-- categorias seeds stay system rows: user_id remains NULL (no backfill).

-- ── A.4 Enforce NOT NULL on the now-populated columns ────────────────
alter table public.prestamos    alter column user_id set not null;
alter table public.aportes_meta alter column user_id set not null;
alter table public.metas        alter column user_id set not null;
alter table public.desafios     alter column user_id set not null;
-- categorias.user_id stays NULLABLE (NULL = system seed).

commit;

-- ── B. RLS REWRITE — drop ambito-based policies, create owner-scoped ──
begin;

-- profiles ────────────────────────────────────────────────────────────
drop policy if exists "profiles_select_autenticados" on public.profiles;
create policy "profiles_select_propio" on public.profiles for select
  to authenticated using ((select auth.uid()) = user_id);
-- profiles_insert_propio / profiles_update_propio already owner-scoped; keep.

-- categorias ──────────────────────────────────────────────────────────
drop policy if exists "categorias_todo_autenticados" on public.categorias;
create policy "categorias_select" on public.categorias for select
  to authenticated using (user_id is null or (select auth.uid()) = user_id);
create policy "categorias_insert" on public.categorias for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "categorias_update" on public.categorias for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "categorias_delete" on public.categorias for delete
  to authenticated using ((select auth.uid()) = user_id);

-- categorias_favoritas ────────────────────────────────────────────────
drop policy if exists "categorias_favoritas_acceso" on public.categorias_favoritas;
create policy "categorias_favoritas_acceso" on public.categorias_favoritas for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- transacciones ───────────────────────────────────────────────────────
drop policy if exists "transacciones_select" on public.transacciones;
drop policy if exists "transacciones_insert" on public.transacciones;
drop policy if exists "transacciones_update" on public.transacciones;
drop policy if exists "transacciones_delete" on public.transacciones;
create policy "transacciones_select" on public.transacciones for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "transacciones_insert" on public.transacciones for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "transacciones_update" on public.transacciones for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "transacciones_delete" on public.transacciones for delete
  to authenticated using ((select auth.uid()) = user_id);

-- prestamos ───────────────────────────────────────────────────────────
drop policy if exists "prestamos_acceso" on public.prestamos;
create policy "prestamos_acceso" on public.prestamos for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- metas ───────────────────────────────────────────────────────────────
drop policy if exists "metas_select" on public.metas;
drop policy if exists "metas_insert" on public.metas;
drop policy if exists "metas_update" on public.metas;
drop policy if exists "metas_delete" on public.metas;
create policy "metas_select" on public.metas for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "metas_insert" on public.metas for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "metas_update" on public.metas for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
-- fondo de emergencia still cannot be deleted
create policy "metas_delete" on public.metas for delete
  to authenticated
  using ((select auth.uid()) = user_id and es_fondo_emergencia = false);

-- aportes_meta ────────────────────────────────────────────────────────
drop policy if exists "aportes_meta_acceso" on public.aportes_meta;
create policy "aportes_meta_acceso" on public.aportes_meta for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- desafios ────────────────────────────────────────────────────────────
drop policy if exists "desafios_select" on public.desafios;
drop policy if exists "desafios_insert" on public.desafios;
drop policy if exists "desafios_update" on public.desafios;
drop policy if exists "desafios_delete" on public.desafios;
create policy "desafios_select" on public.desafios for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "desafios_insert" on public.desafios for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "desafios_update" on public.desafios for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "desafios_delete" on public.desafios for delete
  to authenticated using ((select auth.uid()) = user_id);

commit;

-- ── C. RPC UPDATES — stamp user_id on aportes_meta inserts ────────────
begin;

-- C.1 distribuir_ahorro (personal): owner = v_tx.user_id
create or replace function public.distribuir_ahorro(p_transaccion_id uuid)
returns void language plpgsql
security definer set search_path = public
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
  where es_fondo_emergencia = true and ambito = 'personal' and user_id = v_tx.user_id
  limit 1;
  if v_fondo_id is null then
    raise exception 'El usuario no tiene fondo de emergencia personal';
  end if;

  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.ambito = 'personal' and m.user_id = v_tx.user_id
      and m.es_fondo_emergencia = false and m.estado = 'en_curso'
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

  if v_suma_pesos <= 0 then return; end if;

  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.ambito = 'personal' and m.user_id = v_tx.user_id
      and m.es_fondo_emergencia = false and m.estado = 'en_curso'
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
    if v_asignado > v_restante then v_asignado := v_restante; end if;

    if v_asignado > 0 then
      insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
      values (r.id, v_tx.id, v_asignado, v_peso, v_tx.user_id);
      v_repartido := v_repartido + v_asignado;
    end if;
  end loop;

  select importancia into v_peso from public.metas where id = v_fondo_id;
  v_aporte_fondo := v_total - v_repartido;
  if v_aporte_fondo > 0 then
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
    values (v_fondo_id, v_tx.id, v_aporte_fondo, v_peso, v_tx.user_id);
  end if;
end;
$$;

-- C.2 distribuir_aporte_hogar (dormant in Fase 0): owner = v_ingreso.user_id
create or replace function public.distribuir_aporte_hogar(p_aporte_id uuid)
returns void language plpgsql
security definer set search_path = public
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
    where aporte_id = p_aporte_id and ambito = 'personal'
      and (select auth.uid()) = user_id
  ) then
    raise exception 'No autorizado: el aporte % no pertenece al usuario o no existe', p_aporte_id;
  end if;

  select * into v_ingreso
  from public.transacciones
  where aporte_id = p_aporte_id and ambito = 'hogar' and tipo = 'ingreso'
  limit 1;
  if not found then
    raise exception 'No existe la mitad de ingreso del hogar para el aporte %', p_aporte_id;
  end if;

  v_total := v_ingreso.monto;

  select id into v_fondo_id
  from public.metas where es_fondo_emergencia = true and ambito = 'hogar'
  limit 1;
  if v_fondo_id is null then
    raise exception 'No existe fondo de emergencia del hogar';
  end if;

  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.ambito = 'hogar' and m.es_fondo_emergencia = false and m.estado = 'en_curso'
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

  if v_suma_pesos <= 0 then return; end if;

  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.ambito = 'hogar' and m.es_fondo_emergencia = false and m.estado = 'en_curso'
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
    if v_asignado > v_restante then v_asignado := v_restante; end if;

    if v_asignado > 0 then
      insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
      values (r.id, v_ingreso.id, v_asignado, v_peso, v_ingreso.user_id);
      v_repartido := v_repartido + v_asignado;
    end if;
  end loop;

  select importancia into v_peso from public.metas where id = v_fondo_id;
  v_aporte_fondo := v_total - v_repartido;
  if v_aporte_fondo > 0 then
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
    values (v_fondo_id, v_ingreso.id, v_aporte_fondo, v_peso, v_ingreso.user_id);
  end if;
end;
$$;

-- C.3 aporte_directo_meta (personal): owner = v_uid
create or replace function public.aporte_directo_meta(
  p_meta_id uuid,
  p_monto   numeric,
  p_fecha   date,
  p_nota    text
)
returns uuid language plpgsql
security definer set search_path = public
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

  select id into v_cat_ahorro
  from public.categorias where nombre = 'Ahorro' and tipo = 'gasto'
  limit 1;
  if v_cat_ahorro is null then
    raise exception 'No existe la categoría Ahorro';
  end if;

  insert into public.transacciones
    (fecha, tipo, ambito, user_id, categoria_id, monto, nota, es_aporte_directo)
  values
    (coalesce(p_fecha, current_date), 'gasto', 'personal', v_uid, v_cat_ahorro, p_monto, p_nota, true)
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
    v_a_meta := 0; v_a_fondo := p_monto;
  elsif p_monto <= v_restante then
    v_a_meta := p_monto; v_a_fondo := 0;
  else
    v_a_meta := v_restante; v_a_fondo := p_monto - v_restante;
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

grant  execute on function public.distribuir_ahorro(uuid)            to authenticated;
grant  execute on function public.distribuir_aporte_hogar(uuid)      to authenticated;
grant  execute on function public.aporte_directo_meta(uuid, numeric, date, text) to authenticated;

commit;
