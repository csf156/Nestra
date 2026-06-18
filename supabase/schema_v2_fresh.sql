-- =====================================================================
-- Nestra v2 — Schema completo (estado final, aplicar en instancia NUEVA)
-- ---------------------------------------------------------------------
-- Este archivo es la fuente de verdad del schema v2. Consolida el
-- schema base de v1 + todas las migraciones hasta 20260611.
-- Aplicar UNA SOLA VEZ en el SQL Editor del proyecto Supabase v2.
-- NO ejecutar en el proyecto de producción (v1).
-- =====================================================================


-- =====================================================================
-- 1. TABLAS
-- =====================================================================

-- 1.1 profiles
create table public.profiles (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null unique references auth.users (id) on delete cascade,
  nombre                   text not null,
  aporte_mensual_esperado  numeric(10,2) not null default 0
);

-- 1.2 categorias (incluye columna icono de migración 20260611)
create table public.categorias (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  tipo            text not null check (tipo in ('gasto', 'ingreso')),
  limite_mensual  numeric(10,2),
  color           text,
  icono           text,
  estado          text not null default 'activa' check (estado in ('activa', 'archivada'))
);

-- 1.3 transacciones (tipo incluye 'ahorro'; columna es_aporte_directo)
create table public.transacciones (
  id                uuid primary key default gen_random_uuid(),
  fecha             date not null default current_date,
  tipo              text not null check (tipo in ('gasto', 'ingreso', 'ahorro')),
  ambito            text not null check (ambito in ('personal', 'hogar')),
  user_id           uuid not null references auth.users (id) on delete cascade,
  categoria_id      uuid not null references public.categorias (id) on delete restrict,
  monto             numeric(10,2) not null check (monto > 0),
  nota              text,
  aporte_id         uuid,
  es_aporte_directo boolean not null default false,
  created_at        timestamptz not null default now()
);

-- 1.4 prestamos (incluye fecha_devolucion de migración 20260608)
create table public.prestamos (
  id               uuid primary key default gen_random_uuid(),
  transaccion_id   uuid not null references public.transacciones (id) on delete cascade,
  deudor           text not null,
  estado           text not null default 'pendiente' check (estado in ('pendiente', 'devuelto')),
  fecha_devolucion date
);

-- 1.5 metas (importancia, es_fondo_emergencia, categoria_id; nullable objetivo/fecha/horizonte)
create table public.metas (
  id                   uuid primary key default gen_random_uuid(),
  nombre               text not null,
  tipo                 text not null check (tipo in ('ahorro', 'reduccion_gasto', 'aporte_hogar')),
  horizonte            text check (horizonte in ('corto', 'mediano', 'largo')),
  ambito               text not null check (ambito in ('personal', 'hogar')),
  user_id              uuid references auth.users (id) on delete cascade,
  monto_objetivo       numeric(10,2),
  monto_actual         numeric(10,2) not null default 0,
  fecha_inicio         date not null default current_date,
  fecha_limite         date,
  estado               text not null default 'en_curso' check (estado in ('en_curso', 'lograda', 'vencida')),
  nota                 text,
  importancia          int not null default 3 check (importancia between 1 and 5),
  es_fondo_emergencia  boolean not null default false,
  categoria_id         uuid references public.categorias (id) on delete set null,
  constraint metas_monto_objetivo_check check (monto_objetivo > 0),
  constraint metas_monto_actual_check   check (monto_actual >= 0),
  constraint metas_fondo_o_completa_check check (
    es_fondo_emergencia = true
    or (
      monto_objetivo is not null and monto_objetivo > 0
      and fecha_limite is not null
      and horizonte   is not null
    )
  )
);

-- 1.6 aportes_meta
create table public.aportes_meta (
  id              uuid primary key default gen_random_uuid(),
  meta_id         uuid not null references public.metas (id)         on delete cascade,
  transaccion_id  uuid not null references public.transacciones (id) on delete cascade,
  monto           numeric(10,2) not null check (monto > 0),
  peso_aplicado   numeric,
  created_at      timestamptz not null default now()
);

-- 1.7 desafios
create table public.desafios (
  id             uuid primary key default gen_random_uuid(),
  titulo         text not null,
  descripcion    text,
  ambito         text not null check (ambito in ('personal', 'hogar')),
  user_id        uuid references auth.users (id) on delete cascade,
  duracion_dias  integer not null check (duracion_dias > 0),
  fecha_inicio   date not null default current_date,
  fecha_fin      date generated always as (fecha_inicio + duracion_dias) stored,
  estado         text not null default 'activo' check (estado in ('activo', 'completado', 'abandonado')),
  categoria_id   uuid references public.categorias (id) on delete set null
);


-- =====================================================================
-- 2. ÍNDICES
-- =====================================================================

create index idx_transacciones_user_id      on public.transacciones (user_id);
create index idx_transacciones_categoria_id on public.transacciones (categoria_id);
create index idx_transacciones_fecha        on public.transacciones (fecha);
create index idx_transacciones_aporte_id    on public.transacciones (aporte_id);
create index idx_prestamos_transaccion_id   on public.prestamos (transaccion_id);
create index idx_metas_user_id              on public.metas (user_id);

-- Un fondo de emergencia personal por usuario; uno de hogar global.
create unique index idx_metas_fondo_personal_unico
  on public.metas (user_id)
  where es_fondo_emergencia and ambito = 'personal';

create unique index idx_metas_fondo_hogar_unico
  on public.metas (ambito)
  where es_fondo_emergencia and ambito = 'hogar';

create index idx_aportes_meta_meta_id        on public.aportes_meta (meta_id);
create index idx_aportes_meta_transaccion_id on public.aportes_meta (transaccion_id);
create index idx_desafios_user_id            on public.desafios (user_id);
create index idx_desafios_categoria_id       on public.desafios (categoria_id);


-- =====================================================================
-- 3. VISTA metas_con_progreso
-- =====================================================================

create view public.metas_con_progreso
  with (security_invoker = true)
as
  select
    m.id,
    m.nombre,
    m.tipo,
    m.horizonte,
    m.ambito,
    m.user_id,
    m.monto_objetivo,
    m.fecha_inicio,
    m.fecha_limite,
    m.estado,
    m.nota,
    m.importancia,
    m.es_fondo_emergencia,
    m.categoria_id,
    coalesce(sum(a.monto), 0) as monto_actual
  from public.metas m
  left join public.aportes_meta a on a.meta_id = m.id
  group by
    m.id, m.nombre, m.tipo, m.horizonte, m.ambito, m.user_id,
    m.monto_objetivo, m.fecha_inicio, m.fecha_limite, m.estado,
    m.nota, m.importancia, m.es_fondo_emergencia, m.categoria_id;

grant select on public.metas_con_progreso to authenticated;
grant select on public.aportes_meta        to authenticated;


-- =====================================================================
-- 4. ROW LEVEL SECURITY
-- =====================================================================

alter table public.profiles      enable row level security;
alter table public.categorias    enable row level security;
alter table public.transacciones enable row level security;
alter table public.prestamos     enable row level security;
alter table public.metas         enable row level security;
alter table public.aportes_meta  enable row level security;
alter table public.desafios      enable row level security;

-- profiles
create policy "profiles_select_autenticados" on public.profiles for select
  to authenticated using (true);

create policy "profiles_insert_propio" on public.profiles for insert
  to authenticated with check ((select auth.uid()) = user_id);

create policy "profiles_update_propio" on public.profiles for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- categorias
create policy "categorias_todo_autenticados" on public.categorias for all
  to authenticated using (true) with check (true);

-- transacciones
create policy "transacciones_select" on public.transacciones for select
  to authenticated using (ambito = 'hogar' or (select auth.uid()) = user_id);

create policy "transacciones_insert" on public.transacciones for insert
  to authenticated with check ((select auth.uid()) = user_id);

create policy "transacciones_update" on public.transacciones for update
  to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id)
  with check (ambito = 'hogar' or (select auth.uid()) = user_id);

create policy "transacciones_delete" on public.transacciones for delete
  to authenticated using (ambito = 'hogar' or (select auth.uid()) = user_id);

-- prestamos
create policy "prestamos_acceso" on public.prestamos for all
  to authenticated
  using (
    exists (
      select 1 from public.transacciones t
      where t.id = prestamos.transaccion_id
        and (t.ambito = 'hogar' or (select auth.uid()) = t.user_id)
    )
  )
  with check (
    exists (
      select 1 from public.transacciones t
      where t.id = prestamos.transaccion_id
        and (t.ambito = 'hogar' or (select auth.uid()) = t.user_id)
    )
  );

-- metas
create policy "metas_select" on public.metas for select
  to authenticated using (ambito = 'hogar' or (select auth.uid()) = user_id);

create policy "metas_insert" on public.metas for insert
  to authenticated
  with check (
    (ambito = 'hogar' and user_id is null)
    or (ambito = 'personal' and (select auth.uid()) = user_id)
  );

create policy "metas_update" on public.metas for update
  to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id)
  with check (
    (ambito = 'hogar' and user_id is null)
    or (ambito = 'personal' and (select auth.uid()) = user_id)
  );

-- El fondo de emergencia no se puede borrar.
create policy "metas_delete" on public.metas for delete
  to authenticated
  using ((ambito = 'hogar' or (select auth.uid()) = user_id) and es_fondo_emergencia = false);

-- aportes_meta
create policy "aportes_meta_acceso" on public.aportes_meta for all
  to authenticated
  using (
    exists (
      select 1 from public.metas m
      where m.id = aportes_meta.meta_id
        and (m.ambito = 'hogar' or (select auth.uid()) = m.user_id)
    )
  )
  with check (
    exists (
      select 1 from public.metas m
      where m.id = aportes_meta.meta_id
        and (m.ambito = 'hogar' or (select auth.uid()) = m.user_id)
    )
  );

-- desafios
create policy "desafios_select" on public.desafios for select
  to authenticated using (ambito = 'hogar' or (select auth.uid()) = user_id);

create policy "desafios_insert" on public.desafios for insert
  to authenticated
  with check (
    (ambito = 'hogar' and user_id is null)
    or (ambito = 'personal' and (select auth.uid()) = user_id)
  );

create policy "desafios_update" on public.desafios for update
  to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id)
  with check (
    (ambito = 'hogar' and user_id is null)
    or (ambito = 'personal' and (select auth.uid()) = user_id)
  );

create policy "desafios_delete" on public.desafios for delete
  to authenticated using (ambito = 'hogar' or (select auth.uid()) = user_id);


-- =====================================================================
-- 5. FUNCIONES Y TRIGGERS
-- =====================================================================

-- 5.1 Proteger fondo de emergencia contra degradación vía UPDATE
create or replace function public.metas_proteger_fondo()
returns trigger language plpgsql as $$
begin
  if old.es_fondo_emergencia = true and new.es_fondo_emergencia = false then
    raise exception 'No se puede degradar el fondo de emergencia (es permanente)';
  end if;
  return new;
end;
$$;

create trigger metas_proteger_fondo
  before update on public.metas
  for each row execute function public.metas_proteger_fondo();


-- 5.2 Creación automática de perfil + fondo personal al registrar usuario
create or replace function public.handle_new_user()
returns trigger language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, nombre, aporte_mensual_esperado)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)),
    0
  );

  begin
    insert into public.metas
      (nombre, tipo, ambito, user_id, es_fondo_emergencia, importancia, estado)
    values
      ('Fondo de emergencia', 'ahorro', 'personal', new.id, true, 2, 'en_curso')
    on conflict do nothing;
  exception
    when others then
      raise warning 'No se pudo crear el fondo de emergencia para %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke execute on function public.handle_new_user() from public, anon, authenticated;


-- 5.3 distribuir_ahorro — reparte transacción de ahorro personal entre metas
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
      insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
      values (r.id, v_tx.id, v_asignado, v_peso);
      v_repartido := v_repartido + v_asignado;
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


-- 5.4 distribuir_aporte_hogar — reparte ingreso de hogar entre metas del hogar
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
    where m.ambito = 'hogar' and m.user_id is null
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
    where m.ambito = 'hogar' and m.user_id is null
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
      insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
      values (r.id, v_ingreso.id, v_asignado, v_peso);
      v_repartido := v_repartido + v_asignado;
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


-- 5.5 aporte_directo_meta — aporte 100% a una meta específica
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
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
    values (p_meta_id, v_tx_id, p_monto, null);
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


-- =====================================================================
-- 6. REALTIME
-- =====================================================================

alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.categorias;
alter publication supabase_realtime add table public.transacciones;
alter publication supabase_realtime add table public.prestamos;
alter publication supabase_realtime add table public.metas;
alter publication supabase_realtime add table public.desafios;


-- =====================================================================
-- 7. DATOS SEMILLA
-- =====================================================================

-- 7.1 Categorías de gasto (21)
insert into public.categorias (nombre, tipo, limite_mensual) values
  ('Entretenimiento',            'gasto', 150),
  ('Comer fuera',                'gasto', 400),
  ('Salidas en bicicleta',       'gasto', 150),
  ('Ahorro',                     'gasto', null),
  ('Gastos hormiga',             'gasto', 100),
  ('Ganjah',                     'gasto', 100),
  ('Partes de bicicleta',        'gasto', 150),
  ('Artículos del hogar',        'gasto', 150),
  ('Mascotas',                   'gasto', 100),
  ('Vestimenta',                 'gasto', 150),
  ('Dinero que prestamos',       'gasto', null),
  ('Capital de trabajo',         'gasto', null),
  ('Salud y medicamentos',       'gasto', 100),
  ('Transporte',                 'gasto', 150),
  ('Servicios del hogar',        'gasto', 200),
  ('Mercado / Comida en casa',   'gasto', 300),
  ('Educación',                  'gasto', 150),
  ('Belleza y cuidado personal', 'gasto', 100),
  ('Regalos',                    'gasto', 100),
  ('Imprevistos',                'gasto', 150),
  ('Suscripciones digitales',    'gasto', 80);

-- 7.2 Categorías de ingreso (6, incluye Préstamo recibido)
insert into public.categorias (nombre, tipo) values
  ('Trabajo',                'ingreso'),
  ('Freelance / Extra',      'ingreso'),
  ('Devolución de préstamo', 'ingreso'),
  ('Venta de artículos',     'ingreso'),
  ('Otros ingresos',         'ingreso'),
  ('Préstamo recibido',      'ingreso');

-- 7.3 Metas iniciales del hogar
insert into public.metas
  (nombre, tipo, horizonte, ambito, user_id, monto_objetivo, fecha_limite, nota, es_fondo_emergencia, importancia)
values
  ('Fondo de emergencia',        'ahorro', null,    'hogar', null,    null,   null,         '3 meses de gastos básicos cubiertos', true,  2),
  ('Viaje o experiencia juntos', 'ahorro', 'corto', 'hogar', null,  800.00, '2026-09-30', null,                                   false, 3);
