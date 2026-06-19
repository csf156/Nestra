-- supabase/migrations/20260618_fase0_multitenant_down.sql
-- Reverse of Fase 0 up. Restores the shared-ambito model. v2 SQL Editor ONLY.
-- NOTE: This is a structural dev-rollback. It restores policies and drops
-- added columns. It is NOT a perfect data restore — legacy hogar rows that
-- were backfilled to Christian cannot be auto-re-nulled without knowing which
-- metas were originally hogar vs personal.

begin;

-- D.1 Drop the strict policies ────────────────────────────────────────
drop policy if exists "profiles_select_propio"        on public.profiles;
drop policy if exists "categorias_select"             on public.categorias;
drop policy if exists "categorias_insert"             on public.categorias;
drop policy if exists "categorias_update"             on public.categorias;
drop policy if exists "categorias_delete"             on public.categorias;
drop policy if exists "categorias_favoritas_acceso"   on public.categorias_favoritas;
drop policy if exists "transacciones_select"          on public.transacciones;
drop policy if exists "transacciones_insert"          on public.transacciones;
drop policy if exists "transacciones_update"          on public.transacciones;
drop policy if exists "transacciones_delete"          on public.transacciones;
drop policy if exists "prestamos_acceso"              on public.prestamos;
drop policy if exists "metas_select"                  on public.metas;
drop policy if exists "metas_insert"                  on public.metas;
drop policy if exists "metas_update"                  on public.metas;
drop policy if exists "metas_delete"                  on public.metas;
drop policy if exists "aportes_meta_acceso"           on public.aportes_meta;
drop policy if exists "desafios_select"               on public.desafios;
drop policy if exists "desafios_insert"               on public.desafios;
drop policy if exists "desafios_update"               on public.desafios;
drop policy if exists "desafios_delete"               on public.desafios;

-- D.2 Recreate the original ambito-based policies ─────────────────────
create policy "profiles_select_autenticados" on public.profiles for select
  to authenticated using (true);

create policy "categorias_todo_autenticados" on public.categorias for all
  to authenticated using (true) with check (true);

create policy "transacciones_select" on public.transacciones for select
  to authenticated using (ambito = 'hogar' or (select auth.uid()) = user_id);
create policy "transacciones_insert" on public.transacciones for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "transacciones_update" on public.transacciones for update
  to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id)
  with check (ambito = 'hogar' or (select auth.uid()) = user_id);
create policy "transacciones_delete" on public.transacciones for delete
  to authenticated using (ambito = 'hogar' or (select auth.uid()) = user_id);

create policy "prestamos_acceso" on public.prestamos for all
  to authenticated
  using (exists (select 1 from public.transacciones t
    where t.id = prestamos.transaccion_id
      and (t.ambito = 'hogar' or (select auth.uid()) = t.user_id)))
  with check (exists (select 1 from public.transacciones t
    where t.id = prestamos.transaccion_id
      and (t.ambito = 'hogar' or (select auth.uid()) = t.user_id)));

create policy "metas_select" on public.metas for select
  to authenticated using (ambito = 'hogar' or (select auth.uid()) = user_id);
create policy "metas_insert" on public.metas for insert
  to authenticated with check (
    (ambito = 'hogar' and user_id is null)
    or (ambito = 'personal' and (select auth.uid()) = user_id));
create policy "metas_update" on public.metas for update
  to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id)
  with check (
    (ambito = 'hogar' and user_id is null)
    or (ambito = 'personal' and (select auth.uid()) = user_id));
create policy "metas_delete" on public.metas for delete
  to authenticated
  using ((ambito = 'hogar' or (select auth.uid()) = user_id) and es_fondo_emergencia = false);

create policy "aportes_meta_acceso" on public.aportes_meta for all
  to authenticated
  using (exists (select 1 from public.metas m
    where m.id = aportes_meta.meta_id
      and (m.ambito = 'hogar' or (select auth.uid()) = m.user_id)))
  with check (exists (select 1 from public.metas m
    where m.id = aportes_meta.meta_id
      and (m.ambito = 'hogar' or (select auth.uid()) = m.user_id)));

create policy "desafios_select" on public.desafios for select
  to authenticated using (ambito = 'hogar' or (select auth.uid()) = user_id);
create policy "desafios_insert" on public.desafios for insert
  to authenticated with check (
    (ambito = 'hogar' and user_id is null)
    or (ambito = 'personal' and (select auth.uid()) = user_id));
create policy "desafios_update" on public.desafios for update
  to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id)
  with check (
    (ambito = 'hogar' and user_id is null)
    or (ambito = 'personal' and (select auth.uid()) = user_id));
create policy "desafios_delete" on public.desafios for delete
  to authenticated using (ambito = 'hogar' or (select auth.uid()) = user_id);

-- D.3 Re-null the legacy hogar rows (best-effort — see header note) ───
update public.metas    set user_id = null where ambito = 'hogar';
update public.desafios set user_id = null where ambito = 'hogar';

-- D.4 Relax NOT NULL, then drop the added columns ─────────────────────
alter table public.metas        alter column user_id drop not null;
alter table public.desafios     alter column user_id drop not null;
alter table public.prestamos    drop column if exists user_id;
alter table public.aportes_meta drop column if exists user_id;
alter table public.categorias   drop column if exists user_id;

-- D.5 Leave categorias_favoritas in place (it exists in prod too).
--     To fully remove, uncomment:
-- drop table if exists public.categorias_favoritas;

commit;
