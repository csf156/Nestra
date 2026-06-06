-- =====================================================================
-- Nestra — Esquema de base de datos (Fase 1)
-- PostgreSQL / Supabase
-- ---------------------------------------------------------------------
-- Ejecutar UNA SOLA VEZ en el SQL Editor de Supabase.
-- Orden del archivo:
--   1. Tablas (profiles, categorias, transacciones, prestamos, metas, desafios)
--   2. Row Level Security (políticas personal/hogar)
--   3. Trigger de creación automática de perfil
--   4. Datos semilla (categorías y metas iniciales)
-- Moneda: Sol Peruano (S/). Todos los montos son numeric(10,2).
-- =====================================================================


-- =====================================================================
-- 1. TABLAS
-- =====================================================================

-- 1.1 profiles --------------------------------------------------------
-- Un perfil por cuenta de Supabase Auth. Guarda solo identidad y el
-- aporte mensual esperado (referencia compartida, no dato financiero
-- privado). Lo ven ambos miembros; lo edita únicamente el dueño.
create table public.profiles (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null unique references auth.users (id) on delete cascade,
  nombre                   text not null,
  aporte_mensual_esperado  numeric(10,2) not null default 0
);

-- 1.2 categorias ------------------------------------------------------
-- Categorías de gasto e ingreso. Son compartidas: no pertenecen a un
-- usuario. limite_mensual NULL = sin alerta de límite.
create table public.categorias (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  tipo            text not null check (tipo in ('gasto', 'ingreso')),
  limite_mensual  numeric(10,2),
  color           text,
  estado          text not null default 'activa' check (estado in ('activa', 'archivada'))
);

-- 1.3 transacciones ---------------------------------------------------
-- Registro central de todos los movimientos. aporte_id vincula las dos
-- mitades de un aporte al hogar (gasto personal + ingreso del hogar).
create table public.transacciones (
  id            uuid primary key default gen_random_uuid(),
  fecha         date not null default current_date,
  tipo          text not null check (tipo in ('gasto', 'ingreso')),
  ambito        text not null check (ambito in ('personal', 'hogar')),
  user_id       uuid not null references auth.users (id) on delete cascade,
  categoria_id  uuid not null references public.categorias (id) on delete restrict,
  monto         numeric(10,2) not null check (monto > 0),
  nota          text,
  aporte_id     uuid,
  created_at    timestamptz not null default now()
);

-- 1.4 prestamos -------------------------------------------------------
-- Extensión de transacciones para la categoría "Dinero que prestamos".
-- Al borrarse la transacción, su préstamo se borra en cascada.
create table public.prestamos (
  id              uuid primary key default gen_random_uuid(),
  transaccion_id  uuid not null references public.transacciones (id) on delete cascade,
  deudor          text not null,
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'devuelto'))
);

-- 1.5 metas -----------------------------------------------------------
-- Objetivos financieros. user_id NULL = meta del hogar; con valor = meta
-- personal del dueño.
-- importancia (1..5) pondera la meta en el reparto automático de ahorro.
-- es_fondo_emergencia = true marca el fondo permanente (uno personal por
-- usuario + uno del hogar): no tiene objetivo/fecha/horizonte (NULL),
-- compite por peso Y absorbe el sobrante, y no se puede borrar.
-- El CHECK metas_fondo_o_completa_check exige que una meta normal tenga
-- objetivo>0, fecha límite y horizonte; el fondo puede tenerlos NULL.
-- NOTA: monto_actual es columna física heredada; el progreso real y
-- auditable se deriva en la vista metas_con_progreso (suma de aportes_meta).
create table public.metas (
  id                   uuid primary key default gen_random_uuid(),
  nombre               text not null,
  tipo                 text not null check (tipo in ('ahorro', 'reduccion_gasto', 'aporte_hogar')),
  horizonte            text check (horizonte in ('corto', 'mediano', 'largo')),
  ambito               text not null check (ambito in ('personal', 'hogar')),
  user_id              uuid references auth.users (id) on delete cascade,
  monto_objetivo       numeric(10,2),
  monto_actual         numeric(10,2) not null default 0 check (monto_actual >= 0),
  fecha_inicio         date not null default current_date,
  fecha_limite         date,
  estado               text not null default 'en_curso' check (estado in ('en_curso', 'lograda', 'vencida')),
  nota                 text,
  importancia          int not null default 3 check (importancia between 1 and 5),
  es_fondo_emergencia  boolean not null default false,
  constraint metas_fondo_o_completa_check check (
    es_fondo_emergencia = true
    or (
      monto_objetivo is not null and monto_objetivo > 0
      and fecha_limite is not null
      and horizonte   is not null
    )
  )
);

-- 1.5.1 aportes_meta --------------------------------------------------
-- Fuente de verdad del progreso de cada meta. Cada fila es una porción
-- de una transacción asignada a una meta (auditable y reversible). Al
-- borrarse la meta o la transacción, sus aportes se borran en cascada.
-- peso_aplicado guarda el peso con que se repartió (auditoría).
create table public.aportes_meta (
  id              uuid primary key default gen_random_uuid(),
  meta_id         uuid not null references public.metas (id)         on delete cascade,
  transaccion_id  uuid not null references public.transacciones (id) on delete cascade,
  monto           numeric(10,2) not null check (monto > 0),
  peso_aplicado   numeric,
  created_at      timestamptz not null default now()
);

-- 1.6 desafios --------------------------------------------------------
-- Retos financieros (vista Decisiones). fecha_fin se calcula a partir de
-- fecha_inicio + duracion_dias. user_id NULL = desafío del hogar.
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
-- 1.7 ÍNDICES
-- ---------------------------------------------------------------------
-- PostgreSQL no crea índices automáticamente sobre columnas FK. Estos
-- soportan los joins/filtros frecuentes y la evaluación de las políticas
-- RLS (que filtran por user_id).
-- =====================================================================

create index idx_transacciones_user_id     on public.transacciones (user_id);
create index idx_transacciones_categoria_id on public.transacciones (categoria_id);
create index idx_transacciones_fecha        on public.transacciones (fecha);
create index idx_transacciones_aporte_id    on public.transacciones (aporte_id);
create index idx_prestamos_transaccion_id   on public.prestamos (transaccion_id);
create index idx_metas_user_id              on public.metas (user_id);
-- Un solo fondo de emergencia por ámbito: índices únicos parciales.
-- Personal: uno por usuario. Hogar: uno único global (se indexa `ambito`,
-- valor constante bajo el predicado; PostgreSQL no permite indexar ((true))).
create unique index idx_metas_fondo_personal_unico
  on public.metas (user_id)
  where es_fondo_emergencia and ambito = 'personal';
create unique index idx_metas_fondo_hogar_unico
  on public.metas (ambito)
  where es_fondo_emergencia and ambito = 'hogar';
create index idx_aportes_meta_meta_id        on public.aportes_meta (meta_id);
create index idx_aportes_meta_transaccion_id on public.aportes_meta (transaccion_id);
create index idx_desafios_user_id           on public.desafios (user_id);
create index idx_desafios_categoria_id      on public.desafios (categoria_id);


-- =====================================================================
-- 1.8 VISTA metas_con_progreso
-- ---------------------------------------------------------------------
-- Expone todas las columnas de metas EXCEPTO la columna física
-- monto_actual, reemplazándola por la suma derivada de aportes_meta. Así
-- la app lee siempre el progreso real y auditable.
-- security_invoker = true: aplica el RLS del usuario que consulta.
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
    coalesce(sum(a.monto), 0) as monto_actual
  from public.metas m
  left join public.aportes_meta a on a.meta_id = m.id
  group by
    m.id, m.nombre, m.tipo, m.horizonte, m.ambito, m.user_id,
    m.monto_objetivo, m.fecha_inicio, m.fecha_limite, m.estado,
    m.nota, m.importancia, m.es_fondo_emergencia;

-- Una vista nueva no hereda los GRANT de sus tablas base: sin esto,
-- PostgREST responde "permission denied" al rol authenticated.
grant select on public.metas_con_progreso to authenticated;


-- =====================================================================
-- 2. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
-- Privacidad: datos 'personal' solo los ve su dueño (auth.uid()=user_id);
-- datos 'hogar' los ven ambos miembros autenticados.
-- =====================================================================

alter table public.profiles      enable row level security;
alter table public.categorias    enable row level security;
alter table public.transacciones enable row level security;
alter table public.prestamos     enable row level security;
alter table public.metas         enable row level security;
alter table public.aportes_meta  enable row level security;
alter table public.desafios      enable row level security;

-- 2.1 profiles --------------------------------------------------------
-- Lectura para cualquier autenticado (la app muestra ambos perfiles y
-- compara aportes). Inserción y edición solo del propio perfil.
create policy "profiles_select_autenticados"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_insert_propio"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "profiles_update_propio"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 2.2 categorias ------------------------------------------------------
-- Compartidas: cualquier autenticado lee y escribe.
create policy "categorias_todo_autenticados"
  on public.categorias for all
  to authenticated
  using (true)
  with check (true);

-- 2.3 transacciones ---------------------------------------------------
-- Lectura/edición/borrado: hogar compartido o propias. Pero la INSERCIÓN
-- exige (select auth.uid()) = user_id: nadie puede crear una transacción atribuida
-- a otra persona (cierra la falsificación de autoría vía ambito='hogar').
create policy "transacciones_select"
  on public.transacciones for select
  to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id);

create policy "transacciones_insert"
  on public.transacciones for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "transacciones_update"
  on public.transacciones for update
  to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id)
  with check (ambito = 'hogar' or (select auth.uid()) = user_id);

create policy "transacciones_delete"
  on public.transacciones for delete
  to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id);

-- 2.4 prestamos -------------------------------------------------------
-- Hereda el acceso de su transacción vinculada.
create policy "prestamos_acceso"
  on public.prestamos for all
  to authenticated
  using (
    exists (
      select 1
      from public.transacciones t
      where t.id = prestamos.transaccion_id
        and (t.ambito = 'hogar' or (select auth.uid()) = t.user_id)
    )
  )
  with check (
    exists (
      select 1
      from public.transacciones t
      where t.id = prestamos.transaccion_id
        and (t.ambito = 'hogar' or (select auth.uid()) = t.user_id)
    )
  );

-- 2.5 metas -----------------------------------------------------------
-- Lectura: hogar o propias. Escritura: una meta de hogar debe tener
-- user_id NULL y una personal debe pertenecer a quien la escribe; así
-- nadie crea una meta personal atribuida a otro miembro.
create policy "metas_select"
  on public.metas for select
  to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id);

create policy "metas_insert"
  on public.metas for insert
  to authenticated
  with check (
    (ambito = 'hogar'    and user_id is null)
    or (ambito = 'personal' and (select auth.uid()) = user_id)
  );

create policy "metas_update"
  on public.metas for update
  to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id)
  with check (
    (ambito = 'hogar'    and user_id is null)
    or (ambito = 'personal' and (select auth.uid()) = user_id)
  );

-- Borrado: se prohíbe borrar el fondo de emergencia (permanente).
create policy "metas_delete"
  on public.metas for delete
  to authenticated
  using ((ambito = 'hogar' or (select auth.uid()) = user_id) and es_fondo_emergencia = false);

-- Protección extra del fondo: metas_delete prohíbe borrarlo, pero un cliente
-- podría poner es_fondo_emergencia=false vía update y luego borrarlo. Este
-- trigger BEFORE UPDATE impide degradar un fondo (true→false).
create or replace function public.metas_proteger_fondo()
returns trigger
language plpgsql
as $$
begin
  if old.es_fondo_emergencia = true and new.es_fondo_emergencia = false then
    raise exception 'No se puede degradar el fondo de emergencia (es permanente)';
  end if;
  return new;
end;
$$;

create trigger metas_proteger_fondo
  before update on public.metas
  for each row
  execute function public.metas_proteger_fondo();

-- 2.5.1 aportes_meta --------------------------------------------------
-- Hereda el acceso de su meta vinculada (mismo patrón EXISTS que
-- prestamos): meta de hogar la ven ambos; meta personal solo su dueño.
create policy "aportes_meta_acceso"
  on public.aportes_meta for all
  to authenticated
  using (
    exists (
      select 1
      from public.metas m
      where m.id = aportes_meta.meta_id
        and (m.ambito = 'hogar' or (select auth.uid()) = m.user_id)
    )
  )
  with check (
    exists (
      select 1
      from public.metas m
      where m.id = aportes_meta.meta_id
        and (m.ambito = 'hogar' or (select auth.uid()) = m.user_id)
    )
  );

-- 2.6 desafios --------------------------------------------------------
-- Misma lógica de atribución que metas.
create policy "desafios_select"
  on public.desafios for select
  to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id);

create policy "desafios_insert"
  on public.desafios for insert
  to authenticated
  with check (
    (ambito = 'hogar'    and user_id is null)
    or (ambito = 'personal' and (select auth.uid()) = user_id)
  );

create policy "desafios_update"
  on public.desafios for update
  to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id)
  with check (
    (ambito = 'hogar'    and user_id is null)
    or (ambito = 'personal' and (select auth.uid()) = user_id)
  );

create policy "desafios_delete"
  on public.desafios for delete
  to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id);


-- =====================================================================
-- 3. TRIGGER: perfil automático al registrar un usuario
-- ---------------------------------------------------------------------
-- SECURITY DEFINER para poder insertar en profiles desde el evento de
-- auth.users (bypass de RLS controlado). El nombre se toma de la
-- metadata 'nombre' o, en su defecto, de la parte local del email.
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, nombre, aporte_mensual_esperado)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)),
    0
  );

  -- Fondo de emergencia personal: meta permanente, sin objetivo/fecha.
  -- Aislado en su propio sub-bloque: si la creación del fondo falla, NO
  -- debe abortar la creación del usuario/perfil (solo se avisa). El índice
  -- único parcial permite el on conflict do nothing ante un doble disparo.
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
  for each row
  execute function public.handle_new_user();

-- La función solo debe correr vía trigger, no como RPC pública.
revoke execute on function public.handle_new_user() from public, anon, authenticated;


-- =====================================================================
-- 4. DATOS SEMILLA
-- =====================================================================

-- 4.1 Categorías de gasto (21) — limite NULL = sin límite
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

-- 4.2 Categorías de ingreso (5)
insert into public.categorias (nombre, tipo) values
  ('Trabajo',                'ingreso'),
  ('Freelance / Extra',      'ingreso'),
  ('Devolución de préstamo', 'ingreso'),
  ('Venta de artículos',     'ingreso'),
  ('Otros ingresos',         'ingreso');

-- 4.3 Metas iniciales del hogar (2)
-- El "Fondo de emergencia" del hogar es el fondo permanente: sin
-- objetivo/fecha/horizonte (es_fondo_emergencia=true). La meta normal
-- "Viaje" sí lleva objetivo, fecha y horizonte.
insert into public.metas
  (nombre, tipo, horizonte, ambito, user_id, monto_objetivo, fecha_limite, nota, es_fondo_emergencia, importancia)
values
  ('Fondo de emergencia',        'ahorro', null,    'hogar', null,    null, null,         '3 meses de gastos básicos cubiertos', true,  2),
  ('Viaje o experiencia juntos', 'ahorro', 'corto', 'hogar', null,  800.00, '2026-09-30', null,                                   false, 3);
