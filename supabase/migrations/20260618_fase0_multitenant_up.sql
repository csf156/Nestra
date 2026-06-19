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

-- ── B. RLS REWRITE — drop ambito-based policies, create owner-scoped ──
begin;

-- profiles ────────────────────────────────────────────────────────────
drop policy if exists "profiles_select_autenticados" on public.profiles;
create policy "profiles_select_propio" on public.profiles for select
  to authenticated using ((select auth.uid()) = user_id);
-- profiles_insert_propio / profiles_update_propio already owner-scoped; keep.

-- categorias ──────────────────────────────────────────────────────────
drop policy if exists "categorias_todo_autenticados" on public.categorias;
create policy "categorias_select" on public.categorias for select
  to authenticated using (user_id is null or (select auth.uid()) = user_id);
create policy "categorias_insert" on public.categorias for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "categorias_update" on public.categorias for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "categorias_delete" on public.categorias for delete
  to authenticated using ((select auth.uid()) = user_id);

-- categorias_favoritas ────────────────────────────────────────────────
drop policy if exists "categorias_favoritas_acceso" on public.categorias_favoritas;
create policy "categorias_favoritas_acceso" on public.categorias_favoritas for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- transacciones ───────────────────────────────────────────────────────
drop policy if exists "transacciones_select" on public.transacciones;
drop policy if exists "transacciones_insert" on public.transacciones;
drop policy if exists "transacciones_update" on public.transacciones;
drop policy if exists "transacciones_delete" on public.transacciones;
create policy "transacciones_select" on public.transacciones for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "transacciones_insert" on public.transacciones for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "transacciones_update" on public.transacciones for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "transacciones_delete" on public.transacciones for delete
  to authenticated using ((select auth.uid()) = user_id);

-- prestamos ───────────────────────────────────────────────────────────
drop policy if exists "prestamos_acceso" on public.prestamos;
create policy "prestamos_acceso" on public.prestamos for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- metas ───────────────────────────────────────────────────────────────
drop policy if exists "metas_select" on public.metas;
drop policy if exists "metas_insert" on public.metas;
drop policy if exists "metas_update" on public.metas;
drop policy if exists "metas_delete" on public.metas;
create policy "metas_select" on public.metas for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "metas_insert" on public.metas for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "metas_update" on public.metas for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
-- fondo de emergencia still cannot be deleted
create policy "metas_delete" on public.metas for delete
  to authenticated
  using ((select auth.uid()) = user_id and es_fondo_emergencia = false);

-- aportes_meta ────────────────────────────────────────────────────────
drop policy if exists "aportes_meta_acceso" on public.aportes_meta;
create policy "aportes_meta_acceso" on public.aportes_meta for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- desafios ────────────────────────────────────────────────────────────
drop policy if exists "desafios_select" on public.desafios;
drop policy if exists "desafios_insert" on public.desafios;
drop policy if exists "desafios_update" on public.desafios;
drop policy if exists "desafios_delete" on public.desafios;
create policy "desafios_select" on public.desafios for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "desafios_insert" on public.desafios for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "desafios_update" on public.desafios for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "desafios_delete" on public.desafios for delete
  to authenticated using ((select auth.uid()) = user_id);

commit;
