-- =====================================================================
-- Nestra — Migración: recurrentes (FASE 4)
-- ---------------------------------------------------------------------
-- Gastos/ingresos recurrentes por-usuario (suscripciones, sueldo, renta).
-- `tipo` cubre ingreso fijo y gasto recurrente (ambos alimentan la
-- proyección de flujo de caja). RLS estricta por dueño. updated_at + trigger
-- para LWW (espejo offline). Idempotente. Ejecutar en SQL Editor de v2.
-- =====================================================================

create table if not exists public.recurrentes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  descripcion   text not null,
  monto         numeric(10,2) not null check (monto > 0),
  tipo          text not null default 'gasto' check (tipo in ('gasto','ingreso')),
  categoria_id  uuid references public.categorias (id) on delete set null,
  frecuencia    text not null default 'mensual'
                  check (frecuencia in ('mensual','quincenal','semanal')),
  dia_cargo     smallint check (dia_cargo between 1 and 31),
  proximo_cargo date,
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_recurrentes_user on public.recurrentes (user_id);

alter table public.recurrentes enable row level security;

drop policy if exists "recurrentes_acceso" on public.recurrentes;
create policy "recurrentes_acceso"
  on public.recurrentes for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop trigger if exists trg_recurrentes_updated_at on public.recurrentes;
create trigger trg_recurrentes_updated_at
  before update on public.recurrentes
  for each row execute function public.set_updated_at();
