-- Alias de contrapartes: el banco manda nombres completos ("RODOLFO MARTIN
-- ANDERSON HUARCAYA") que el usuario no reconoce de un vistazo. El alias se
-- guarda por nombre NORMALIZADO (minúsculas, sin tildes, espacios colapsados)
-- para que variantes del mismo nombre caigan en la misma fila.
--
-- Idempotente entera, a propósito: `create table if not exists` ya lo era, pero
-- `create policy` y `create trigger` no, y una re-ejecución habría fallado ahí.
-- CLAUDE.md señala ese riesgo con la CLI contra esta base.
create table if not exists public.contraparte_alias (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  nombre_norm text        not null,
  alias       text        not null check (length(trim(alias)) between 1 and 60),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Por usuario: los dos miembros del hogar pueden ponerle nombres distintos
  -- a la misma contraparte.
  primary key (user_id, nombre_norm)
);

alter table public.contraparte_alias enable row level security;

drop policy if exists "alias propios" on public.contraparte_alias;
create policy "alias propios" on public.contraparte_alias
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Grant de TABLA, no por columna: un grant por columna dejaría fuera cualquier
-- columna que se añada después (ver CLAUDE.md).
grant select, insert, update, delete on public.contraparte_alias to authenticated;

drop trigger if exists trg_contraparte_alias_updated_at on public.contraparte_alias;
create trigger trg_contraparte_alias_updated_at
  before update on public.contraparte_alias
  for each row execute function public.set_updated_at();
