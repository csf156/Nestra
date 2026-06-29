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
