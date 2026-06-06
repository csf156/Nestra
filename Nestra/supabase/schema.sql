-- ============================================================================
-- Nestra · schema.sql
-- Base de datos completa: tablas, RLS, trigger de perfil y datos iniciales.
-- Motor: PostgreSQL (Supabase). Moneda: Sol Peruano (S/).
--
-- Orden de ejecución pensado para correrse de una sola vez en el SQL Editor
-- de Supabase. Es idempotente en la medida de lo posible (drop policy if exists,
-- create or replace function, on conflict en seeds).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensiones
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ============================================================================
-- 1. TABLAS
-- ============================================================================

-- 1.1 profiles -----------------------------------------------------------------
-- Un perfil por usuario de auth.users. Se crea automáticamente vía trigger.
create table if not exists public.profiles (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null unique references auth.users(id) on delete cascade,
  nombre                   text,
  aporte_mensual_esperado  numeric(10,2)
);

-- 1.2 categorias ---------------------------------------------------------------
-- Catálogo compartido de categorías de gasto e ingreso.
create table if not exists public.categorias (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  tipo            text not null check (tipo in ('gasto', 'ingreso')),
  limite_mensual  numeric(10,2),
  color           text,
  estado          text not null default 'activa'
);

-- 1.3 transacciones ------------------------------------------------------------
-- Movimientos personales o del hogar. La privacidad la controla 'ambito'.
create table if not exists public.transacciones (
  id           uuid primary key default gen_random_uuid(),
  fecha        date not null,
  tipo         text not null check (tipo in ('gasto', 'ingreso')),
  ambito       text not null check (ambito in ('personal', 'hogar')),
  user_id      uuid not null references auth.users(id) on delete cascade,
  categoria_id uuid references public.categorias(id),
  monto        numeric(10,2) not null,
  nota         text,
  aporte_id    uuid,
  created_at   timestamptz not null default now()
);

-- 1.4 prestamos ----------------------------------------------------------------
-- Préstamos asociados a una transacción de tipo 'Dinero que prestamos'.
-- El acceso se hereda de la transacción vinculada (ver RLS más abajo).
create table if not exists public.prestamos (
  id             uuid primary key default gen_random_uuid(),
  transaccion_id uuid not null references public.transacciones(id) on delete cascade,
  deudor         text,
  estado         text not null default 'pendiente'
);

-- 1.5 metas --------------------------------------------------------------------
-- Metas de ahorro / reducción de gasto / aporte al hogar.
create table if not exists public.metas (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  tipo            text not null check (tipo in ('ahorro', 'reduccion_gasto', 'aporte_hogar')),
  horizonte       text not null check (horizonte in ('corto', 'mediano', 'largo')),
  ambito          text not null check (ambito in ('personal', 'hogar')),
  user_id         uuid references auth.users(id) on delete cascade,
  monto_objetivo  numeric(10,2) not null,
  monto_actual    numeric(10,2) not null default 0,
  fecha_inicio    date not null default current_date,
  fecha_limite    date,
  estado          text not null default 'en_curso',
  nota            text
);

-- 1.6 desafios -----------------------------------------------------------------
-- Retos personales o del hogar (p. ej. "una semana sin comer fuera").
create table if not exists public.desafios (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  ambito        text not null check (ambito in ('personal', 'hogar')),
  user_id       uuid references auth.users(id) on delete cascade,
  fecha_inicio  date,
  fecha_fin     date,
  estado        text not null default 'activo' check (estado in ('activo', 'logrado', 'abandonado')),
  categoria_id  uuid references public.categorias(id)
);

-- ============================================================================
-- 2. ROW LEVEL SECURITY
-- ============================================================================

alter table public.profiles      enable row level security;
alter table public.categorias    enable row level security;
alter table public.transacciones enable row level security;
alter table public.prestamos     enable row level security;
alter table public.metas         enable row level security;
alter table public.desafios      enable row level security;

-- 2.1 profiles: cada usuario sólo lee y edita su propio perfil -----------------
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_delete on public.profiles;

create policy profiles_select on public.profiles
  for select to authenticated
  using (auth.uid() = user_id);

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy profiles_update on public.profiles
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy profiles_delete on public.profiles
  for delete to authenticated
  using (auth.uid() = user_id);

-- 2.2 categorias: cualquier usuario autenticado lee y escribe ------------------
drop policy if exists categorias_select on public.categorias;
drop policy if exists categorias_insert on public.categorias;
drop policy if exists categorias_update on public.categorias;
drop policy if exists categorias_delete on public.categorias;

create policy categorias_select on public.categorias
  for select to authenticated
  using (true);

create policy categorias_insert on public.categorias
  for insert to authenticated
  with check (true);

create policy categorias_update on public.categorias
  for update to authenticated
  using (true)
  with check (true);

create policy categorias_delete on public.categorias
  for delete to authenticated
  using (true);

-- 2.3 transacciones: hogar → cualquier autenticado; personal → sólo dueño ------
drop policy if exists transacciones_select on public.transacciones;
drop policy if exists transacciones_insert on public.transacciones;
drop policy if exists transacciones_update on public.transacciones;
drop policy if exists transacciones_delete on public.transacciones;

create policy transacciones_select on public.transacciones
  for select to authenticated
  using (ambito = 'hogar' or auth.uid() = user_id);

-- En escritura el dueño siempre debe ser el usuario autenticado.
create policy transacciones_insert on public.transacciones
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and (ambito = 'hogar' or ambito = 'personal')
  );

create policy transacciones_update on public.transacciones
  for update to authenticated
  using (ambito = 'hogar' or auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy transacciones_delete on public.transacciones
  for delete to authenticated
  using (ambito = 'hogar' or auth.uid() = user_id);

-- 2.4 prestamos: hereda el acceso de su transacción vinculada ------------------
drop policy if exists prestamos_select on public.prestamos;
drop policy if exists prestamos_insert on public.prestamos;
drop policy if exists prestamos_update on public.prestamos;
drop policy if exists prestamos_delete on public.prestamos;

create policy prestamos_select on public.prestamos
  for select to authenticated
  using (
    exists (
      select 1 from public.transacciones t
      where t.id = prestamos.transaccion_id
        and (t.ambito = 'hogar' or auth.uid() = t.user_id)
    )
  );

create policy prestamos_insert on public.prestamos
  for insert to authenticated
  with check (
    exists (
      select 1 from public.transacciones t
      where t.id = prestamos.transaccion_id
        and (t.ambito = 'hogar' or auth.uid() = t.user_id)
    )
  );

create policy prestamos_update on public.prestamos
  for update to authenticated
  using (
    exists (
      select 1 from public.transacciones t
      where t.id = prestamos.transaccion_id
        and (t.ambito = 'hogar' or auth.uid() = t.user_id)
    )
  )
  with check (
    exists (
      select 1 from public.transacciones t
      where t.id = prestamos.transaccion_id
        and (t.ambito = 'hogar' or auth.uid() = t.user_id)
    )
  );

create policy prestamos_delete on public.prestamos
  for delete to authenticated
  using (
    exists (
      select 1 from public.transacciones t
      where t.id = prestamos.transaccion_id
        and (t.ambito = 'hogar' or auth.uid() = t.user_id)
    )
  );

-- 2.5 metas: hogar → cualquier autenticado; personal → sólo dueño --------------
drop policy if exists metas_select on public.metas;
drop policy if exists metas_insert on public.metas;
drop policy if exists metas_update on public.metas;
drop policy if exists metas_delete on public.metas;

create policy metas_select on public.metas
  for select to authenticated
  using (ambito = 'hogar' or auth.uid() = user_id);

create policy metas_insert on public.metas
  for insert to authenticated
  with check (
    ambito = 'hogar' or auth.uid() = user_id
  );

create policy metas_update on public.metas
  for update to authenticated
  using (ambito = 'hogar' or auth.uid() = user_id)
  with check (ambito = 'hogar' or auth.uid() = user_id);

create policy metas_delete on public.metas
  for delete to authenticated
  using (ambito = 'hogar' or auth.uid() = user_id);

-- 2.6 desafios: hogar → cualquier autenticado; personal → sólo dueño -----------
drop policy if exists desafios_select on public.desafios;
drop policy if exists desafios_insert on public.desafios;
drop policy if exists desafios_update on public.desafios;
drop policy if exists desafios_delete on public.desafios;

create policy desafios_select on public.desafios
  for select to authenticated
  using (ambito = 'hogar' or auth.uid() = user_id);

create policy desafios_insert on public.desafios
  for insert to authenticated
  with check (
    ambito = 'hogar' or auth.uid() = user_id
  );

create policy desafios_update on public.desafios
  for update to authenticated
  using (ambito = 'hogar' or auth.uid() = user_id)
  with check (ambito = 'hogar' or auth.uid() = user_id);

create policy desafios_delete on public.desafios
  for delete to authenticated
  using (ambito = 'hogar' or auth.uid() = user_id);

-- ============================================================================
-- 3. TRIGGER: crear perfil automáticamente al registrar un usuario
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, nombre)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'nombre',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 4. DATOS INICIALES
-- ============================================================================

-- 4.1 Categorías de gasto (21) -------------------------------------------------
insert into public.categorias (nombre, tipo, limite_mensual) values
  ('Entretenimiento',           'gasto', 150),
  ('Comer fuera',               'gasto', 400),
  ('Salidas en bicicleta',      'gasto', 150),
  ('Ahorro',                    'gasto', null),
  ('Gastos hormiga',            'gasto', 100),
  ('Ganjah',                    'gasto', 100),
  ('Partes de bicicleta',       'gasto', 150),
  ('Artículos del hogar',       'gasto', 150),
  ('Mascotas',                  'gasto', 100),
  ('Vestimenta',                'gasto', 150),
  ('Dinero que prestamos',      'gasto', null),
  ('Capital de trabajo',        'gasto', null),
  ('Salud y medicamentos',      'gasto', 100),
  ('Transporte',                'gasto', 150),
  ('Servicios del hogar',       'gasto', 200),
  ('Mercado / Comida en casa',  'gasto', 300),
  ('Educación',                 'gasto', 150),
  ('Belleza y cuidado personal','gasto', 100),
  ('Regalos',                   'gasto', 100),
  ('Imprevistos',               'gasto', 150),
  ('Suscripciones digitales',   'gasto', 80);

-- 4.2 Categorías de ingreso (5) ------------------------------------------------
insert into public.categorias (nombre, tipo, limite_mensual) values
  ('Trabajo',                'ingreso', null),
  ('Freelance / Extra',      'ingreso', null),
  ('Devolución de préstamo', 'ingreso', null),
  ('Venta de artículos',     'ingreso', null),
  ('Otros ingresos',         'ingreso', null);

-- 4.3 Metas iniciales del hogar (2) --------------------------------------------
insert into public.metas
  (nombre, tipo, horizonte, ambito, monto_objetivo, fecha_limite, nota) values
  ('Fondo de emergencia',        'ahorro', 'mediano', 'hogar', 2000, '2026-12-31', '3 meses de gastos básicos cubiertos'),
  ('Viaje o experiencia juntos', 'ahorro', 'corto',   'hogar',  800, '2026-09-30', null);

-- ============================================================================
-- Fin de schema.sql
-- ============================================================================
