-- supabase/migrations/20260629_fase6_hogares.sql
-- Fase 6 — Hogar compartido (pareja). Aplicar SOLO en la instancia v2.
-- Idempotente. NUNCA correr en producción sin revisión manual.

begin;

-- ── Tablas de hogar ──────────────────────────────────────────────────
create table if not exists public.hogares (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  creado_por  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.hogar_miembros (
  id        uuid primary key default gen_random_uuid(),
  hogar_id  uuid not null references public.hogares(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  rol       text not null check (rol in ('creador','miembro')),
  joined_at timestamptz not null default now(),
  unique (user_id),
  unique (hogar_id, user_id)
);
create index if not exists idx_hogar_miembros_hogar on public.hogar_miembros (hogar_id);

create table if not exists public.hogar_codigos (
  id         uuid primary key default gen_random_uuid(),
  hogar_id   uuid not null references public.hogares(id) on delete cascade,
  codigo     char(6) not null,
  expira_at  timestamptz not null,
  usado      boolean not null default false,
  created_at timestamptz not null default now()
);
-- Solo un código activo (no usado y no expirado) puede existir por valor:
create unique index if not exists idx_hogar_codigos_activo
  on public.hogar_codigos (codigo) where usado = false;

create table if not exists public.hogar_liquidaciones (
  id         uuid primary key default gen_random_uuid(),
  hogar_id   uuid not null references public.hogares(id) on delete cascade,
  de_user    uuid not null references auth.users(id),
  a_user     uuid not null references auth.users(id),
  monto      numeric(10,2) not null check (monto > 0),
  fecha      date not null default current_date,
  nota       text,
  created_at timestamptz not null default now()
);
create index if not exists idx_hogar_liquidaciones_hogar on public.hogar_liquidaciones (hogar_id);

-- ── Columna hogar_id en transacciones y metas ────────────────────────
alter table public.transacciones add column if not exists hogar_id uuid references public.hogares(id) on delete set null;
alter table public.metas         add column if not exists hogar_id uuid references public.hogares(id) on delete set null;
create index if not exists idx_transacciones_hogar_id on public.transacciones (hogar_id) where hogar_id is not null;
create index if not exists idx_metas_hogar_id          on public.metas (hogar_id) where hogar_id is not null;

-- ── Trigger de cap 2 miembros ────────────────────────────────────────
create or replace function public.hogar_check_cap()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.hogar_miembros where hogar_id = new.hogar_id) >= 2 then
    raise exception 'El hogar % ya tiene 2 miembros', new.hogar_id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_hogar_cap on public.hogar_miembros;
create trigger trg_hogar_cap before insert on public.hogar_miembros
  for each row execute function public.hogar_check_cap();

commit;

-- ── Helper: hogar del usuario actual (evita recursión de RLS) ─────────
begin;

create or replace function public.auth_hogar_id()
returns uuid language sql stable security definer set search_path = public as $$
  select hogar_id from public.hogar_miembros where user_id = (select auth.uid()) limit 1;
$$;
grant execute on function public.auth_hogar_id() to authenticated;

-- ── Trigger de invariante ambito ↔ hogar_id en transacciones/metas ────
-- ambito='hogar'    ⇒ hogar_id = hogar del que escribe (impide inyección).
-- ambito='personal' ⇒ hogar_id = NULL.
create or replace function public.sync_hogar_id()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_hogar uuid := public.auth_hogar_id();
begin
  if new.ambito = 'hogar' then
    if v_hogar is null then
      raise exception 'No puedes marcar ambito=hogar sin pertenecer a un hogar';
    end if;
    new.hogar_id := v_hogar;
  else
    new.hogar_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_hogar_id_tx on public.transacciones;
create trigger trg_sync_hogar_id_tx before insert or update on public.transacciones
  for each row execute function public.sync_hogar_id();

drop trigger if exists trg_sync_hogar_id_metas on public.metas;
create trigger trg_sync_hogar_id_metas before insert or update on public.metas
  for each row execute function public.sync_hogar_id();

commit;

-- ── RLS compartida ───────────────────────────────────────────────────
begin;

-- transacciones: ver propias O las del hogar (ambito='hogar').
drop policy if exists "transacciones_select" on public.transacciones;
create policy "transacciones_select" on public.transacciones for select
  to authenticated using (
    (select auth.uid()) = user_id
    or (hogar_id is not null and hogar_id = (select public.auth_hogar_id()))
  );
-- insert/update/delete siguen siendo solo-propias (el trigger fija hogar_id).
-- (Las policies de insert/update/delete de Fase 0 ya exigen auth.uid()=user_id;
--  no se tocan.)

-- metas: ver propias O las del hogar.
drop policy if exists "metas_select" on public.metas;
create policy "metas_select" on public.metas for select
  to authenticated using (
    (select auth.uid()) = user_id
    or (hogar_id is not null and hogar_id = (select public.auth_hogar_id()))
  );

-- hogares: visible si soy miembro.
alter table public.hogares enable row level security;
drop policy if exists "hogares_select" on public.hogares;
create policy "hogares_select" on public.hogares for select
  to authenticated using (id = (select public.auth_hogar_id()));

-- hogar_miembros: visibles los miembros de mi hogar.
alter table public.hogar_miembros enable row level security;
drop policy if exists "hogar_miembros_select" on public.hogar_miembros;
create policy "hogar_miembros_select" on public.hogar_miembros for select
  to authenticated using (hogar_id = (select public.auth_hogar_id()));

-- hogar_codigos: visibles solo a miembros (la validación de unión va por RPC).
alter table public.hogar_codigos enable row level security;
drop policy if exists "hogar_codigos_select" on public.hogar_codigos;
create policy "hogar_codigos_select" on public.hogar_codigos for select
  to authenticated using (hogar_id = (select public.auth_hogar_id()));

-- hogar_liquidaciones: visibles a miembros del hogar.
alter table public.hogar_liquidaciones enable row level security;
drop policy if exists "hogar_liquidaciones_select" on public.hogar_liquidaciones;
create policy "hogar_liquidaciones_select" on public.hogar_liquidaciones for select
  to authenticated using (hogar_id = (select public.auth_hogar_id()));

-- Sin policies de INSERT/UPDATE/DELETE directas en las tablas de hogar:
-- toda mutación pasa por los RPCs SECURITY DEFINER (Task 4).

commit;

-- ── RPCs de hogar (SECURITY DEFINER) ─────────────────────────────────
begin;

-- Genera un código de 6 dígitos único entre los activos.
create or replace function public._gen_codigo_hogar(p_hogar_id uuid)
returns char(6) language plpgsql security definer set search_path = public as $$
declare v_cod char(6); v_try int := 0;
begin
  -- invalida códigos activos previos del hogar
  update public.hogar_codigos set usado = true
   where hogar_id = p_hogar_id and usado = false;
  loop
    v_cod := lpad((floor(random()*1000000))::int::text, 6, '0');
    begin
      insert into public.hogar_codigos (hogar_id, codigo, expira_at)
      values (p_hogar_id, v_cod, now() + interval '24 hours');
      return v_cod;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 50 then raise exception 'No se pudo generar un código único'; end if;
    end;
  end loop;
end;
$$;

create or replace function public.crear_hogar(p_nombre text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := (select auth.uid()); v_hogar uuid; v_cod char(6);
begin
  if exists (select 1 from public.hogar_miembros where user_id = v_uid) then
    raise exception 'Ya perteneces a un hogar; sal primero';
  end if;
  insert into public.hogares (nombre, creado_por) values (coalesce(nullif(trim(p_nombre),''),'Hogar'), v_uid)
    returning id into v_hogar;
  insert into public.hogar_miembros (hogar_id, user_id, rol) values (v_hogar, v_uid, 'creador');
  -- backfill: filas ambito='hogar' previas del creador se asocian al hogar
  update public.transacciones set hogar_id = v_hogar where user_id = v_uid and ambito = 'hogar';
  update public.metas         set hogar_id = v_hogar where user_id = v_uid and ambito = 'hogar';
  v_cod := public._gen_codigo_hogar(v_hogar);
  return jsonb_build_object('hogar_id', v_hogar, 'codigo', v_cod);
end;
$$;

create or replace function public.generar_codigo()
returns char(6) language plpgsql security definer set search_path = public as $$
declare v_hogar uuid := public.auth_hogar_id();
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  return public._gen_codigo_hogar(v_hogar);
end;
$$;

create or replace function public.unirse_hogar(p_codigo char(6))
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := (select auth.uid()); v_row public.hogar_codigos%rowtype;
begin
  if exists (select 1 from public.hogar_miembros where user_id = v_uid) then
    raise exception 'Ya perteneces a un hogar; sal primero';
  end if;
  select * into v_row from public.hogar_codigos
   where codigo = p_codigo and usado = false and expira_at > now() limit 1;
  if not found then raise exception 'Código inválido o expirado'; end if;
  -- serializa uniones concurrentes al mismo hogar (cierra la race del cap 2)
  perform pg_advisory_xact_lock(hashtext('hogar_join:' || v_row.hogar_id::text));
  if (select count(*) from public.hogar_miembros where hogar_id = v_row.hogar_id) >= 2 then
    raise exception 'El hogar ya está completo';
  end if;
  insert into public.hogar_miembros (hogar_id, user_id, rol) values (v_row.hogar_id, v_uid, 'miembro');
  update public.hogar_codigos set usado = true where id = v_row.id;
  -- backfill: filas ambito='hogar' previas del que se une se asocian al hogar
  update public.transacciones set hogar_id = v_row.hogar_id where user_id = v_uid and ambito = 'hogar';
  update public.metas         set hogar_id = v_row.hogar_id where user_id = v_uid and ambito = 'hogar';
  return jsonb_build_object('hogar_id', v_row.hogar_id);
end;
$$;

-- Registra una liquidación en la dirección del neto que pasa el cliente.
create or replace function public.saldar_hogar(p_de uuid, p_a uuid, p_monto numeric, p_nota text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := (select auth.uid()); v_hogar uuid := public.auth_hogar_id(); v_id uuid;
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  if v_uid not in (p_de, p_a) then raise exception 'No autorizado'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'Monto inválido'; end if;
  insert into public.hogar_liquidaciones (hogar_id, de_user, a_user, monto, nota)
  values (v_hogar, p_de, p_a, round(p_monto,2), p_nota) returning id into v_id;
  return v_id;
end;
$$;

-- Disuelve el hogar: reparte el ahorro neto por % de aporte de ingresos,
-- reasigna metas/fondo de hogar al creador, registra liquidación final,
-- y borra las membresías. La fila `hogares` NO se borra: las transacciones
-- conservan su `hogar_id` como historial (FK on delete set null lo anularía).
-- Tras disolver, auth_hogar_id() devuelve null para ambos, así que el hogar
-- y su liquidación final quedan fuera de RLS (el statement se devuelve en el
-- jsonb de retorno). Devuelve el statement.
create or replace function public.disolver_hogar()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_hogar uuid := public.auth_hogar_id();
  v_creador uuid; v_otro uuid;
  v_ing_creador numeric := 0; v_ing_otro numeric := 0; v_pct_creador numeric;
  v_ahorro numeric := 0; v_recibe_otro numeric;
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  select creado_por into v_creador from public.hogares where id = v_hogar;
  select user_id into v_otro from public.hogar_miembros where hogar_id = v_hogar and user_id <> v_creador limit 1;

  -- aportes históricos de ingresos hogar por miembro
  select coalesce(sum(monto),0) into v_ing_creador from public.transacciones
    where hogar_id = v_hogar and ambito='hogar' and tipo='ingreso' and user_id = v_creador;
  if v_otro is not null then
    select coalesce(sum(monto),0) into v_ing_otro from public.transacciones
      where hogar_id = v_hogar and ambito='hogar' and tipo='ingreso' and user_id = v_otro;
  end if;
  if (v_ing_creador + v_ing_otro) = 0 then v_pct_creador := 0.5;
  else v_pct_creador := v_ing_creador / (v_ing_creador + v_ing_otro); end if;

  -- ahorro neto del hogar = ingresos hogar - gastos hogar
  select coalesce(sum(case when tipo='ingreso' then monto else -monto end),0) into v_ahorro
    from public.transacciones where hogar_id = v_hogar and ambito='hogar';
  if v_ahorro < 0 then v_ahorro := 0; end if;
  v_recibe_otro := round(v_ahorro * (1 - v_pct_creador), 2);

  -- reasignar aportes de esas metas al creador (antes de soltar el hogar_id)
  update public.aportes_meta set user_id = v_creador
   where meta_id in (select id from public.metas where hogar_id = v_hogar and ambito = 'hogar');

  -- reasignar metas/fondo de hogar al creador como personales
  update public.metas set ambito='personal', hogar_id=null, user_id=v_creador
    where hogar_id = v_hogar and ambito='hogar';

  -- liquidación final: el creador (retiene metas) debe al otro su parte
  if v_otro is not null and v_recibe_otro > 0 then
    insert into public.hogar_liquidaciones (hogar_id, de_user, a_user, monto, nota)
    values (v_hogar, v_creador, v_otro, v_recibe_otro, 'Liquidación final de disolución');
  end if;

  -- borrar membresías (las transacciones conservan hogar_id como historial)
  delete from public.hogar_miembros where hogar_id = v_hogar;

  return jsonb_build_object(
    'pct_creador', round(v_pct_creador,4),
    'ahorro', v_ahorro,
    'recibe_creador', round(v_ahorro * v_pct_creador,2),
    'recibe_otro', v_recibe_otro
  );
end;
$$;

grant execute on function public.crear_hogar(text)                          to authenticated;
grant execute on function public.generar_codigo()                           to authenticated;
grant execute on function public.unirse_hogar(char)                         to authenticated;
grant execute on function public.saldar_hogar(uuid, uuid, numeric, text)    to authenticated;
grant execute on function public.disolver_hogar()                           to authenticated;

commit;
