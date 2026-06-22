-- Fase 1 PWA — LWW: updated_at + trigger en las tablas espejadas offline.
-- Idempotente: usa add column if not exists y create or replace.

-- 1. Columnas updated_at (default now() cubre INSERT y filas existentes).
alter table public.transacciones add column if not exists updated_at timestamptz not null default now();
alter table public.categorias   add column if not exists updated_at timestamptz not null default now();
alter table public.metas        add column if not exists updated_at timestamptz not null default now();
alter table public.prestamos    add column if not exists updated_at timestamptz not null default now();

-- 2. Función trigger compartida: sella updated_at en cada UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 3. Triggers por tabla (drop+create para reaplicar sin error).
drop trigger if exists trg_transacciones_updated_at on public.transacciones;
create trigger trg_transacciones_updated_at
  before update on public.transacciones
  for each row execute function public.set_updated_at();

drop trigger if exists trg_categorias_updated_at on public.categorias;
create trigger trg_categorias_updated_at
  before update on public.categorias
  for each row execute function public.set_updated_at();

drop trigger if exists trg_metas_updated_at on public.metas;
create trigger trg_metas_updated_at
  before update on public.metas
  for each row execute function public.set_updated_at();

drop trigger if exists trg_prestamos_updated_at on public.prestamos;
create trigger trg_prestamos_updated_at
  before update on public.prestamos
  for each row execute function public.set_updated_at();
