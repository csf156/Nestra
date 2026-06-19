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
