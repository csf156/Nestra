-- =====================================================================
-- Nestra — Migración: presupuestos por categoría (FASE 3)
-- ---------------------------------------------------------------------
-- Tabla `presupuestos`: límite mensual PERSONAL por categoría (por-usuario).
-- Distinta de categorias.limite_mensual (global, compartido, usado por
-- alerts.js). RLS estricta: cada usuario solo ve/edita los suyos.
-- updated_at + trigger para LWW (espejo offline), igual que el resto.
-- Idempotente: if not exists / drop if exists. Ejecutar en SQL Editor.
-- =====================================================================

create table if not exists public.presupuestos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  categoria_id  uuid not null references public.categorias (id) on delete cascade,
  monto_limite  numeric(10,2) not null check (monto_limite > 0),
  periodo       text not null default 'mensual' check (periodo = 'mensual'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Un presupuesto por (usuario, categoría, periodo).
create unique index if not exists idx_presupuestos_user_cat_periodo
  on public.presupuestos (user_id, categoria_id, periodo);

-- RLS: estrictamente por dueño (no compartido con el hogar).
alter table public.presupuestos enable row level security;

drop policy if exists "presupuestos_acceso" on public.presupuestos;
create policy "presupuestos_acceso"
  on public.presupuestos for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- updated_at: reusa la función compartida set_updated_at() (ya existe).
drop trigger if exists trg_presupuestos_updated_at on public.presupuestos;
create trigger trg_presupuestos_updated_at
  before update on public.presupuestos
  for each row execute function public.set_updated_at();
