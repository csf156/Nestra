# Fase 0 — Multi-tenant Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Nestra from the shared-`ambito` model to strict per-user tenancy (`auth.uid() = user_id`), add Google OAuth, and ship an idempotent + reversible migration — applied only to the v2 Supabase instance.

**Architecture:** A forward (`up`) and reverse (`down`) SQL migration rewrites every RLS policy to owner-scoped checks, adds `user_id` to the tables that lack it, folds in the missing `categorias_favoritas` table, and updates the security-definer RPCs to stamp `user_id` on `aportes_meta`. Isolation is proven by a SQL test suite run with two synthetic users. The JS layer gains a Google sign-in path and stamps `user_id` on every owner-scoped insert.

**Tech Stack:** PostgreSQL + Supabase RLS, supabase-js v2 (CDN), vanilla JS (IIFE/global-function style), hash-routing SPA.

---

## CRITICAL EXECUTION CONSTRAINTS

Read before starting any task.

1. **The Supabase MCP (`mcp__supabase__*`) is connected to PRODUCTION (`rblxwqdphhmpglxxtgtv`), NOT v2.** NEVER call `apply_migration` or `execute_sql` (writes) through the MCP for this work — it would hit production. Production reads are also gated. Treat the MCP as off-limits for this phase.
2. **All v2 DB operations run in the v2 SQL Editor** (project `ombnhxueclqfeyjzhroz`), pasted manually by the user after reviewing the SQL. There is no Supabase CLI, psql, or `config.toml` in this environment.
3. **The "run the test / apply the migration" steps are user-in-the-loop checkpoints.** The implementer produces the exact SQL and the expected output; the user runs it in the v2 SQL Editor and reports the result back. Do not attempt to automate these against any database.
4. Branch is `v2`. Commit there. Never touch `master`/`main` or production.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `supabase/tests/rls_isolation_test.sql` | Two-user isolation test suite (setup + assertions + teardown) |
| `supabase/migrations/20260618_fase0_multitenant_up.sql` | Forward migration: schema + backfill + RLS rewrite + RPC updates |
| `supabase/migrations/20260618_fase0_multitenant_down.sql` | Reverse migration back to the `ambito` model |
| `supabase/schema_v2_fresh.sql` | Reconciled to the post-migration end-state for fresh installs |
| `js/db.js` | Stamp `user_id` on owner-scoped inserts (categorias, prestamos, metas, desafios) |
| `js/auth.js` | `signInWithGoogle()` + handle `SIGNED_IN` from the OAuth redirect |
| `views/login.html` | "Continuar con Google" button + handler |
| `docs/V2-ISOLATION.md` | Append the Google OAuth dashboard setup steps |

**Designated owner for legacy hogar rows:** Christian — `aa5a03e9-12fe-4e9f-8900-ced28359db90`.

---

## Task 1: RLS isolation test suite (write the failing test)

Write the test first. It defines the contract every later task must satisfy. Two synthetic auth users (A, B) created in `auth.users`; RLS simulated via `request.jwt.claims`.

**Files:**
- Create: `supabase/tests/rls_isolation_test.sql`

- [ ] **Step 1: Write the test suite**

```sql
-- supabase/tests/rls_isolation_test.sql
-- Two-user RLS isolation suite for Fase 0. Run in the v2 SQL Editor ONLY.
-- A passing run prints "ALL TESTS PASSED". Any failure raises an exception.
-- Idempotent: drops/recreates the two synthetic users each run.

-- ── Fixed UUIDs for the synthetic users ──────────────────────────────
--   A = 11111111-1111-1111-1111-111111111111
--   B = 22222222-2222-2222-2222-222222222222

-- ── Teardown (in case a previous run left rows) ──────────────────────
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);

-- ── Setup: create users A and B (trigger creates their profile+fondo) ─
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000',
   '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
   'a@test.local', crypt('test-pw-a', gen_salt('bf')),
   now(), now(), now(), '{}'::jsonb, '{"nombre":"UserA"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000',
   '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
   'b@test.local', crypt('test-pw-b', gen_salt('bf')),
   now(), now(), now(), '{}'::jsonb, '{"nombre":"UserB"}'::jsonb);

-- ── Helper: act as a given user (RLS on) ─────────────────────────────
-- Usage pattern repeated inline below:
--   set local role authenticated;
--   select set_config('request.jwt.claims',
--     json_build_object('sub', '<uuid>', 'role','authenticated')::text, true);

-- ── Seed: A inserts a transaction in a system category ────────────────
do $$
declare
  v_cat uuid;
  v_tx  uuid;
begin
  -- A acts
  perform set_config('request.jwt.claims',
    json_build_object('sub','11111111-1111-1111-1111-111111111111',
                      'role','authenticated')::text, true);
  set local role authenticated;

  select id into v_cat from public.categorias where user_id is null limit 1;

  insert into public.transacciones (tipo, ambito, user_id, categoria_id, monto, nota)
  values ('gasto','personal','11111111-1111-1111-1111-111111111111', v_cat, 10, 'A-secret')
  returning id into v_tx;

  -- A also creates a custom category
  insert into public.categorias (nombre, tipo, user_id)
  values ('A-custom','gasto','11111111-1111-1111-1111-111111111111');

  reset role;
end $$;

-- ── TEST 1: B cannot SELECT A's transaction ──────────────────────────
do $$
declare n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','22222222-2222-2222-2222-222222222222',
                      'role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.transacciones where nota = 'A-secret';
  if n <> 0 then raise exception 'TEST 1 FAILED: B sees % of A''s transactions', n; end if;

  reset role;
  raise notice 'TEST 1 PASSED: B cannot read A transactions';
end $$;

-- ── TEST 2: B cannot SELECT A's custom category ──────────────────────
do $$
declare n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','22222222-2222-2222-2222-222222222222',
                      'role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.categorias where nombre = 'A-custom';
  if n <> 0 then raise exception 'TEST 2 FAILED: B sees A''s custom category'; end if;

  reset role;
  raise notice 'TEST 2 PASSED: B cannot read A custom category';
end $$;

-- ── TEST 3: B CAN SELECT system categories (user_id is null) ──────────
do $$
declare n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','22222222-2222-2222-2222-222222222222',
                      'role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.categorias where user_id is null;
  if n = 0 then raise exception 'TEST 3 FAILED: B cannot read system categories'; end if;

  reset role;
  raise notice 'TEST 3 PASSED: B reads system categories';
end $$;

-- ── TEST 4: B cannot UPDATE A's transaction ──────────────────────────
do $$
declare n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','22222222-2222-2222-2222-222222222222',
                      'role','authenticated')::text, true);
  set local role authenticated;

  with upd as (
    update public.transacciones set monto = 999 where nota = 'A-secret' returning 1
  )
  select count(*) into n from upd;
  if n <> 0 then raise exception 'TEST 4 FAILED: B updated % of A''s rows', n; end if;

  reset role;
  raise notice 'TEST 4 PASSED: B cannot update A transactions';
end $$;

-- ── TEST 5: A cannot insert a row owned by B (with check) ─────────────
do $$
declare ok boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','11111111-1111-1111-1111-111111111111',
                      'role','authenticated')::text, true);
  set local role authenticated;

  begin
    insert into public.transacciones (tipo, ambito, user_id, categoria_id, monto)
    values ('gasto','personal','22222222-2222-2222-2222-222222222222',
            (select id from public.categorias where user_id is null limit 1), 5);
  exception when others then
    ok := true; -- RLS rejected, as expected
  end;

  reset role;
  if not ok then raise exception 'TEST 5 FAILED: A inserted a row owned by B'; end if;
  raise notice 'TEST 5 PASSED: A cannot insert rows owned by B';
end $$;

-- ── TEST 6: B cannot SELECT A's profile ──────────────────────────────
do $$
declare n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','22222222-2222-2222-2222-222222222222',
                      'role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.profiles
  where user_id = '11111111-1111-1111-1111-111111111111';
  if n <> 0 then raise exception 'TEST 6 FAILED: B sees A''s profile'; end if;

  reset role;
  raise notice 'TEST 6 PASSED: B cannot read A profile';
end $$;

-- ── Teardown ─────────────────────────────────────────────────────────
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);

select 'ALL TESTS PASSED' as result;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/tests/rls_isolation_test.sql
git commit -m "test(rls): two-user isolation suite for Fase 0 multi-tenant"
```

---

## Task 2: Establish the RED baseline (run tests against current v2)

Prove the suite fails on the *current* shared-`ambito` schema. This is the RED state TDD requires.

**Files:** none (verification checkpoint)

- [ ] **Step 1: User runs the suite in the v2 SQL Editor**

Paste the full contents of `supabase/tests/rls_isolation_test.sql` into the v2 SQL Editor (project `ombnhxueclqfeyjzhroz`) and Run.

Expected on the CURRENT schema (RED):
- **TEST 2 FAILS** with `TEST 2 FAILED: B sees A's custom category` — because today `categorias` has policy `using (true)` (all authenticated see all). (Note: `categorias` has no `user_id` column yet, so the suite's `insert ... user_id` in setup will actually error first — that error itself confirms the column is missing.)
- Equivalent leaks exist for `transacciones`/`profiles` under the `ambito='hogar'` / `using(true)` rules.

The point: the suite cannot pass until the migration runs. Record the failure output.

- [ ] **Step 2: No commit** (verification only). Proceed to build the migration.

---

## Task 3: Migration UP — schema changes (columns, table, backfill)

**Files:**
- Create: `supabase/migrations/20260618_fase0_multitenant_up.sql`

- [ ] **Step 1: Write Part A (schema) into the up migration**

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260618_fase0_multitenant_up.sql
git commit -m "feat(migration): Fase 0 up part A — user_id columns, categorias_favoritas, backfill"
```

---

## Task 4: Migration UP — RLS rewrite

Append the policy rewrite to the same up migration.

**Files:**
- Modify: `supabase/migrations/20260618_fase0_multitenant_up.sql` (append before/replacing nothing; add a new transaction block)

- [ ] **Step 1: Append Part B (RLS) to the up migration**

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260618_fase0_multitenant_up.sql
git commit -m "feat(migration): Fase 0 up part B — owner-scoped RLS rewrite"
```

---

## Task 5: Migration UP — update RPCs to stamp aportes_meta.user_id

`aportes_meta.user_id` is now NOT NULL. The three security-definer RPCs insert into `aportes_meta` and must set it. Each insert's owner = the origin transaction's `user_id` (`v_tx.user_id` / `v_ingreso.user_id` / `v_uid`).

**Files:**
- Modify: `supabase/migrations/20260618_fase0_multitenant_up.sql` (append Part C)

- [ ] **Step 1: Append Part C — recreate the three RPCs with user_id in every aportes_meta insert**

```sql
-- ── C. RPC UPDATES — stamp user_id on aportes_meta inserts ────────────
begin;

-- C.1 distribuir_ahorro (personal): owner = v_tx.user_id
create or replace function public.distribuir_ahorro(p_transaccion_id uuid)
returns void language plpgsql
security definer set search_path = public
as $$
declare
  v_tx           public.transacciones%rowtype;
  v_total        numeric(10,2);
  v_fondo_id     uuid;
  v_suma_pesos   numeric := 0;
  v_repartido    numeric(10,2) := 0;
  v_aporte_fondo numeric(10,2);
  r              record;
  v_avance       numeric;
  v_f_horizonte  numeric;
  v_f_urgencia   numeric;
  v_f_rezago     numeric;
  v_peso         numeric;
  v_restante     numeric(10,2);
  v_asignado     numeric(10,2);
begin
  select * into v_tx from public.transacciones where id = p_transaccion_id;
  if not found then
    raise exception 'Transacción % no existe', p_transaccion_id;
  end if;
  if (select auth.uid()) <> v_tx.user_id then
    raise exception 'No autorizado: la transacción no pertenece al usuario';
  end if;

  v_total := v_tx.monto;

  select id into v_fondo_id
  from public.metas
  where es_fondo_emergencia = true and ambito = 'personal' and user_id = v_tx.user_id
  limit 1;
  if v_fondo_id is null then
    raise exception 'El usuario no tiene fondo de emergencia personal';
  end if;

  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.ambito = 'personal' and m.user_id = v_tx.user_id
      and m.es_fondo_emergencia = false and m.estado = 'en_curso'
      and m.fecha_limite >= current_date
      and (m.monto_objetivo - coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0)) > 0
  loop
    v_f_horizonte := case r.horizonte when 'corto' then 3 when 'mediano' then 2 else 1 end;
    v_f_urgencia  := case
                       when (r.fecha_limite - current_date) < 7  then 3
                       when (r.fecha_limite - current_date) < 30 then 2
                       else 1
                     end;
    v_avance   := r.progreso / r.monto_objetivo;
    v_f_rezago := greatest(0.2, least(1, 1 - v_avance));
    v_peso     := r.importancia * v_f_horizonte * v_f_urgencia * v_f_rezago;
    v_suma_pesos := v_suma_pesos + v_peso;
  end loop;

  select importancia into v_peso from public.metas where id = v_fondo_id;
  v_suma_pesos := v_suma_pesos + v_peso;

  if v_suma_pesos <= 0 then return; end if;

  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.ambito = 'personal' and m.user_id = v_tx.user_id
      and m.es_fondo_emergencia = false and m.estado = 'en_curso'
      and m.fecha_limite >= current_date
      and (m.monto_objetivo - coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0)) > 0
  loop
    v_f_horizonte := case r.horizonte when 'corto' then 3 when 'mediano' then 2 else 1 end;
    v_f_urgencia  := case
                       when (r.fecha_limite - current_date) < 7  then 3
                       when (r.fecha_limite - current_date) < 30 then 2
                       else 1
                     end;
    v_avance   := r.progreso / r.monto_objetivo;
    v_f_rezago := greatest(0.2, least(1, 1 - v_avance));
    v_peso     := r.importancia * v_f_horizonte * v_f_urgencia * v_f_rezago;

    v_restante := r.monto_objetivo - r.progreso;
    v_asignado := round(v_total * (v_peso / v_suma_pesos), 2);
    if v_asignado > v_restante then v_asignado := v_restante; end if;

    if v_asignado > 0 then
      insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
      values (r.id, v_tx.id, v_asignado, v_peso, v_tx.user_id);
      v_repartido := v_repartido + v_asignado;
    end if;
  end loop;

  select importancia into v_peso from public.metas where id = v_fondo_id;
  v_aporte_fondo := v_total - v_repartido;
  if v_aporte_fondo > 0 then
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
    values (v_fondo_id, v_tx.id, v_aporte_fondo, v_peso, v_tx.user_id);
  end if;
end;
$$;

-- C.2 distribuir_aporte_hogar (dormant): owner = v_ingreso.user_id
create or replace function public.distribuir_aporte_hogar(p_aporte_id uuid)
returns void language plpgsql
security definer set search_path = public
as $$
declare
  v_ingreso      public.transacciones%rowtype;
  v_total        numeric(10,2);
  v_fondo_id     uuid;
  v_suma_pesos   numeric := 0;
  v_repartido    numeric(10,2) := 0;
  v_aporte_fondo numeric(10,2);
  r              record;
  v_avance       numeric;
  v_f_horizonte  numeric;
  v_f_urgencia   numeric;
  v_f_rezago     numeric;
  v_peso         numeric;
  v_restante     numeric(10,2);
  v_asignado     numeric(10,2);
begin
  if not exists (
    select 1 from public.transacciones
    where aporte_id = p_aporte_id and ambito = 'personal'
      and (select auth.uid()) = user_id
  ) then
    raise exception 'No autorizado: el aporte % no pertenece al usuario o no existe', p_aporte_id;
  end if;

  select * into v_ingreso
  from public.transacciones
  where aporte_id = p_aporte_id and ambito = 'hogar' and tipo = 'ingreso'
  limit 1;
  if not found then
    raise exception 'No existe la mitad de ingreso del hogar para el aporte %', p_aporte_id;
  end if;

  v_total := v_ingreso.monto;

  select id into v_fondo_id
  from public.metas where es_fondo_emergencia = true and ambito = 'hogar'
  limit 1;
  if v_fondo_id is null then
    raise exception 'No existe fondo de emergencia del hogar';
  end if;

  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.ambito = 'hogar' and m.es_fondo_emergencia = false and m.estado = 'en_curso'
      and m.fecha_limite >= current_date
      and (m.monto_objetivo - coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0)) > 0
  loop
    v_f_horizonte := case r.horizonte when 'corto' then 3 when 'mediano' then 2 else 1 end;
    v_f_urgencia  := case
                       when (r.fecha_limite - current_date) < 7  then 3
                       when (r.fecha_limite - current_date) < 30 then 2
                       else 1
                     end;
    v_avance   := r.progreso / r.monto_objetivo;
    v_f_rezago := greatest(0.2, least(1, 1 - v_avance));
    v_peso     := r.importancia * v_f_horizonte * v_f_urgencia * v_f_rezago;
    v_suma_pesos := v_suma_pesos + v_peso;
  end loop;

  select importancia into v_peso from public.metas where id = v_fondo_id;
  v_suma_pesos := v_suma_pesos + v_peso;

  if v_suma_pesos <= 0 then return; end if;

  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.ambito = 'hogar' and m.es_fondo_emergencia = false and m.estado = 'en_curso'
      and m.fecha_limite >= current_date
      and (m.monto_objetivo - coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0)) > 0
  loop
    v_f_horizonte := case r.horizonte when 'corto' then 3 when 'mediano' then 2 else 1 end;
    v_f_urgencia  := case
                       when (r.fecha_limite - current_date) < 7  then 3
                       when (r.fecha_limite - current_date) < 30 then 2
                       else 1
                     end;
    v_avance   := r.progreso / r.monto_objetivo;
    v_f_rezago := greatest(0.2, least(1, 1 - v_avance));
    v_peso     := r.importancia * v_f_horizonte * v_f_urgencia * v_f_rezago;

    v_restante := r.monto_objetivo - r.progreso;
    v_asignado := round(v_total * (v_peso / v_suma_pesos), 2);
    if v_asignado > v_restante then v_asignado := v_restante; end if;

    if v_asignado > 0 then
      insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
      values (r.id, v_ingreso.id, v_asignado, v_peso, v_ingreso.user_id);
      v_repartido := v_repartido + v_asignado;
    end if;
  end loop;

  select importancia into v_peso from public.metas where id = v_fondo_id;
  v_aporte_fondo := v_total - v_repartido;
  if v_aporte_fondo > 0 then
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
    values (v_fondo_id, v_ingreso.id, v_aporte_fondo, v_peso, v_ingreso.user_id);
  end if;
end;
$$;

-- C.3 aporte_directo_meta (personal): owner = v_uid
create or replace function public.aporte_directo_meta(
  p_meta_id uuid,
  p_monto   numeric,
  p_fecha   date,
  p_nota    text
)
returns uuid language plpgsql
security definer set search_path = public
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_meta       public.metas%rowtype;
  v_cat_ahorro uuid;
  v_tx_id      uuid;
  v_progreso   numeric(10,2);
  v_restante   numeric(10,2);
  v_a_meta     numeric(10,2);
  v_a_fondo    numeric(10,2);
  v_fondo_id   uuid;
begin
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del aporte debe ser mayor que 0';
  end if;

  select * into v_meta from public.metas where id = p_meta_id;
  if not found then
    raise exception 'La meta % no existe', p_meta_id;
  end if;
  if not (v_meta.ambito = 'hogar' or v_meta.user_id = v_uid) then
    raise exception 'No autorizado: la meta no pertenece al usuario';
  end if;

  select id into v_cat_ahorro
  from public.categorias where nombre = 'Ahorro' and tipo = 'gasto'
  limit 1;
  if v_cat_ahorro is null then
    raise exception 'No existe la categoría Ahorro';
  end if;

  insert into public.transacciones
    (fecha, tipo, ambito, user_id, categoria_id, monto, nota, es_aporte_directo)
  values
    (coalesce(p_fecha, current_date), 'gasto', 'personal', v_uid, v_cat_ahorro, p_monto, p_nota, true)
  returning id into v_tx_id;

  select coalesce(sum(a.monto), 0) into v_progreso
  from public.aportes_meta a where a.meta_id = p_meta_id;

  if v_meta.es_fondo_emergencia or v_meta.monto_objetivo is null then
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
    values (p_meta_id, v_tx_id, p_monto, null, v_uid);
    return v_tx_id;
  end if;

  v_restante := v_meta.monto_objetivo - v_progreso;

  if v_restante <= 0 then
    v_a_meta := 0; v_a_fondo := p_monto;
  elsif p_monto <= v_restante then
    v_a_meta := p_monto; v_a_fondo := 0;
  else
    v_a_meta := v_restante; v_a_fondo := p_monto - v_restante;
  end if;

  if v_a_meta > 0 then
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
    values (p_meta_id, v_tx_id, v_a_meta, null, v_uid);
  end if;

  if v_a_fondo > 0 then
    if v_meta.ambito = 'hogar' then
      select id into v_fondo_id from public.metas
      where es_fondo_emergencia and ambito = 'hogar' limit 1;
    else
      select id into v_fondo_id from public.metas
      where es_fondo_emergencia and ambito = 'personal' and user_id = v_uid limit 1;
    end if;
    if v_fondo_id is null then
      raise exception 'No existe el fondo de emergencia del ámbito % para el excedente', v_meta.ambito;
    end if;
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
    values (v_fondo_id, v_tx_id, v_a_fondo, null, v_uid);
  end if;

  return v_tx_id;
end;
$$;

grant  execute on function public.distribuir_ahorro(uuid)            to authenticated;
grant  execute on function public.distribuir_aporte_hogar(uuid)      to authenticated;
grant  execute on function public.aporte_directo_meta(uuid, numeric, date, text) to authenticated;

commit;
```

> Note on C.2: the legacy hogar fondo lookups (`ambito='hogar'`) still run but are dormant in Fase 0 (no shared hogar metas remain after backfill assigns them to Christian). The RPC is kept callable for Fase 5; it is not invoked by the Fase 0 app paths.

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260618_fase0_multitenant_up.sql
git commit -m "feat(migration): Fase 0 up part C — RPCs stamp aportes_meta.user_id"
```

---

## Task 6: Apply UP to v2 and reach GREEN

**Files:** none (verification checkpoint)

- [ ] **Step 1: User reviews + applies the up migration in the v2 SQL Editor**

Paste the full `supabase/migrations/20260618_fase0_multitenant_up.sql` into the v2 SQL Editor and Run. Expected: all three `commit;` blocks succeed, no errors.

- [ ] **Step 2: User re-runs the test suite**

Paste `supabase/tests/rls_isolation_test.sql` again and Run.
Expected output (GREEN): final row `ALL TESTS PASSED`, with notices `TEST 1..6 PASSED`.

- [ ] **Step 3: Record the GREEN result** in the task notes. If any test fails, fix the migration SQL (back to Task 3/4/5), re-apply, re-test. Do not proceed until GREEN.

---

## Task 7: Migration DOWN (reversibility)

**Files:**
- Create: `supabase/migrations/20260618_fase0_multitenant_down.sql`

- [ ] **Step 1: Write the down migration**

```sql
-- supabase/migrations/20260618_fase0_multitenant_down.sql
-- Reverse of Fase 0 up. Restores the shared-ambito model. v2 SQL Editor ONLY.

begin;

-- D.1 Drop the strict policies ────────────────────────────────────────
drop policy if exists "profiles_select_propio"        on public.profiles;
drop policy if exists "categorias_select"             on public.categorias;
drop policy if exists "categorias_insert"             on public.categorias;
drop policy if exists "categorias_update"             on public.categorias;
drop policy if exists "categorias_delete"             on public.categorias;
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

-- D.3 Re-null the legacy hogar rows (revert backfill) ─────────────────
update public.metas    set user_id = null where ambito = 'hogar';
update public.desafios set user_id = null where ambito = 'hogar';

-- D.4 Relax NOT NULL, then drop the added columns ─────────────────────
alter table public.metas        alter column user_id drop not null;
alter table public.desafios     alter column user_id drop not null;
alter table public.prestamos    drop column if exists user_id;
alter table public.aportes_meta drop column if exists user_id;
alter table public.categorias   drop column if exists user_id;

-- D.5 Leave categorias_favoritas in place (it exists in prod too).
--     To fully reverse, uncomment:
-- drop table if exists public.categorias_favoritas;

commit;
```

> Note: D.3/D.4 cannot perfectly distinguish which `metas`/`desafios` were originally hogar vs personal-owned-by-Christian if Christian created personal rows too. Down is a best-effort structural reverse (restores policies + drops columns); it is for dev rollback during Fase 0, not a production data-restore tool. The RPCs from Part C remain (they are backward-compatible — `aportes_meta` keeps accepting the extra column only while it exists; after D.4 drops it, re-run the original RPC definitions from `schema_v2_fresh.sql` if a full down is needed). State this in the commit body.

- [ ] **Step 2: User verifies down in v2** — apply `down`, confirm no errors, then re-apply `up` to return to the working state. (Optional but recommended dev check.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260618_fase0_multitenant_down.sql
git commit -m "feat(migration): Fase 0 down — reverse to ambito model (dev rollback)"
```

---

## Task 8: db.js — stamp user_id on owner-scoped inserts

Under strict RLS, inserts without `user_id` fail (`with check`). Fix the four insert paths.

**Files:**
- Modify: `js/db.js`

- [ ] **Step 1: `insertCategoria` — stamp the owner (custom categories)**

Replace the body of `insertCategoria` (currently `js/db.js:555-568`):

```javascript
async function insertCategoria(datos) {
  try {
    const fila = { ...datos, user_id: _requireUserId() };
    const { data, error } = await supabase
      .from('categorias')
      .insert(fila)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en insertCategoria():', err.message || err);
    throw err;
  }
}
```

- [ ] **Step 2: `insertPrestamo` — stamp the owner**

Replace the insert in `insertPrestamo` (currently `js/db.js:912-925`):

```javascript
async function insertPrestamo(transaccion_id, deudor, estado = 'pendiente') {
  try {
    const { data, error } = await supabase
      .from('prestamos')
      .insert({ transaccion_id, deudor, estado, user_id: _requireUserId() })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en insertPrestamo():', err.message || err);
    throw err;
  }
}
```

- [ ] **Step 3: `insertMeta` — always stamp owner (hogar dormant)**

Replace the ownership block in `insertMeta` (currently `js/db.js:808-827`):

```javascript
async function insertMeta(datos) {
  try {
    // Fase 0: every meta is owner-scoped (hogar sharing deferred to Fase 5).
    const fila = { ...datos, user_id: _requireUserId() };
    const { data, error } = await supabase
      .from('metas')
      .insert(fila)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en insertMeta():', err.message || err);
    throw err;
  }
}
```

- [ ] **Step 4: `insertDesafio` — always stamp owner**

Replace the ownership block in `insertDesafio` (currently `js/db.js:1013-1032`):

```javascript
async function insertDesafio(datos) {
  try {
    // Fase 0: owner-scoped (hogar sharing deferred to Fase 5).
    const fila = { ...datos, user_id: _requireUserId() };
    const { data, error } = await supabase
      .from('desafios')
      .insert(fila)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en insertDesafio():', err.message || err);
    throw err;
  }
}
```

- [ ] **Step 5: Verify in the browser preview**

Run the app (preview), log in as the existing user, create: a custom category, a transaction, a meta, a loan. Each must save without an RLS error in the console (check `preview_console_logs`).

- [ ] **Step 6: Commit**

```bash
git add js/db.js
git commit -m "fix(db): stamp user_id on categoria/prestamo/meta/desafio inserts for strict RLS"
```

---

## Task 9: auth.js — Google OAuth sign-in

**Files:**
- Modify: `js/auth.js`

- [ ] **Step 1: Add `signInWithGoogle()`**

Add after `login()` (around `js/auth.js:65`):

```javascript
// signInWithGoogle() — Start Google OAuth redirect flow
// Returns: undefined (browser redirects away; session handled on return)
// Side effects: redirects to Google; on return, onAuthStateChange fires SIGNED_IN
async function signInWithGoogle() {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) {
      console.error('Google OAuth error:', error.message);
      throw new Error(error.message);
    }
  } catch (err) {
    console.error('Unexpected error in signInWithGoogle():', err);
    throw err;
  }
}
```

- [ ] **Step 2: Handle `SIGNED_IN` in the auth state listener**

In `setupAuthStateListener()` (currently `js/auth.js:197-207`), extend the callback so a fresh OAuth sign-in rehydrates and routes to the dashboard:

```javascript
  supabase.auth.onAuthStateChange(async (event, session) => {
    console.log('Auth state change:', event);
    // Fresh sign-in (incl. OAuth redirect return) — rehydrate + go to app
    if (event === 'SIGNED_IN' && session && session.user) {
      window.currentUser = session.user;
      localStorage.setItem('sb-token', session.access_token);
      try { await loadProfile(session.user.id); } catch (e) { /* profile created by trigger */ }
      if (typeof updateUserChip === 'function') updateUserChip();
      if (window.location.hash === '#login' || window.location.hash === '') {
        window.location.hash = '#dashboard';
      }
    }
    // Token expired and refresh failed, user signed out, or account removed
    if (event === 'SIGNED_OUT' || ((event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && !session)) {
      handleSessionExpired();
    }
    // Password recovery link clicked — redirect to reset form
    if (event === 'PASSWORD_RECOVERY') {
      window.location.hash = '#reset-password';
    }
  });
```

> supabase-js v2 has `detectSessionInUrl: true` by default, so it auto-parses the OAuth redirect (`?code=` / `#access_token`) and emits `SIGNED_IN`. No manual URL parsing needed.

- [ ] **Step 3: Commit**

```bash
git add js/auth.js
git commit -m "feat(auth): add Google OAuth sign-in + SIGNED_IN rehydration"
```

---

## Task 10: login.html — "Continuar con Google" button

**Files:**
- Modify: `views/login.html`

- [ ] **Step 1: Add the button + divider after the form**

Insert after the `</form>` close (currently `views/login.html:25`):

```html
    <div class="login-divider"><span>o</span></div>

    <button type="button" id="googleSignIn" class="btn btn-secondary btn-block">
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style="vertical-align:-3px;margin-right:8px;">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.15-4.53H2.18v2.84A11 11 0 0 0 12 23Z"/>
        <path fill="#FBBC05" d="M5.85 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.67-2.84Z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.67 2.84C6.71 7.31 9.14 5.38 12 5.38Z"/>
      </svg>
      Continuar con Google
    </button>
```

- [ ] **Step 2: Add minimal divider styling**

Inside the existing `<style>` block (before its closing `</style>`, `views/login.html:72`):

```css
  .login-divider {
    display: flex;
    align-items: center;
    text-align: center;
    margin: var(--space-md) 0;
    color: var(--text-muted, #888);
    font-size: 0.85rem;
  }
  .login-divider::before,
  .login-divider::after {
    content: "";
    flex: 1;
    border-bottom: 1px solid var(--border-color, #ddd);
  }
  .login-divider span { padding: 0 var(--space-sm); }
```

- [ ] **Step 3: Wire the click handler**

Inside the existing `<script>` block (after the form submit listener, before `</script>` at `views/login.html:113`):

```javascript
  document.getElementById('googleSignIn').addEventListener('click', async function () {
    const loginError = document.getElementById('loginError');
    loginError.style.display = 'none';
    this.disabled = true;
    try {
      await signInWithGoogle(); // redirects away on success
    } catch (error) {
      loginError.textContent = error.message || 'No se pudo iniciar con Google.';
      loginError.style.display = 'flex';
      this.disabled = false;
    }
  });
```

- [ ] **Step 4: Verify in the browser preview**

Load `#login` in the preview. Confirm the Google button renders below the divider and `preview_console_logs` shows no errors. (Full OAuth round-trip needs the provider enabled in Task 12; clicking before that returns a provider-not-enabled error in the alert, which is expected.)

- [ ] **Step 5: Commit**

```bash
git add views/login.html
git commit -m "feat(login): add Continuar con Google button"
```

---

## Task 11: Reconcile schema_v2_fresh.sql to the post-migration end-state

So a fresh v2 install matches a migrated one.

**Files:**
- Modify: `supabase/schema_v2_fresh.sql`

- [ ] **Step 1: Apply these edits to `supabase/schema_v2_fresh.sql`**

1. In the `categorias` create-table, add `  user_id  uuid references auth.users (id) on delete cascade,` (after `id`).
2. In `prestamos`, `aportes_meta` create-tables, add `  user_id  uuid not null references auth.users (id) on delete cascade,`.
3. In `metas`, `desafios`, change `user_id` to `not null`.
4. Add the `categorias_favoritas` table + its index + RLS enable (copy from migration A.1).
5. Replace the entire RLS section (policies) with the owner-scoped set from Task 4 (`categorias_*`, `categorias_favoritas_acceso`, `transacciones_*`, `prestamos_acceso`, `metas_*`, `aportes_meta_acceso`, `desafios_*`, `profiles_select_propio` + keep `profiles_insert_propio`/`profiles_update_propio`).
6. Replace the three RPC bodies with the Part C versions (with `user_id` in `aportes_meta` inserts).
7. Add `alter publication supabase_realtime add table public.categorias_favoritas;` if favoritas needs realtime (optional — skip unless used).
8. In the seed section, leave `categorias` seeds without `user_id` (they stay system rows).

- [ ] **Step 2: Sanity-check the file parses**

Read the file back and confirm: every owner-scoped table has `user_id`, no `using (true)` remains except intentionally none, and the three RPCs reference `user_id` in `aportes_meta` inserts.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema_v2_fresh.sql
git commit -m "chore(schema): reconcile schema_v2_fresh to post-Fase0 end-state"
```

---

## Task 12: Google provider setup guide (dashboard, user-performed)

**Files:**
- Modify: `docs/V2-ISOLATION.md`

- [ ] **Step 1: Append a "Google OAuth setup (v2)" section**

```markdown
## Google OAuth setup (proyecto v2)

Pasos manuales en el dashboard (los hace el dueño de la cuenta):

1. **Google Cloud Console** → crear proyecto (o reusar) → APIs & Services →
   Credentials → Create Credentials → OAuth client ID → Web application.
2. Authorized redirect URI: `https://ombnhxueclqfeyjzhroz.supabase.co/auth/v1/callback`.
3. Copiar **Client ID** y **Client Secret**.
4. **Supabase v2** → Authentication → Providers → Google → Enable → pegar
   Client ID + Secret → Save.
5. **Authentication → URL Configuration** → Site URL = la URL de la app
   (local: `http://localhost:<puerto>/`; prod futura: el dominio de v2).
   Añadir esa misma URL a **Redirect URLs**.
6. Verificar que los emails de Google de Christian y Darling coinciden con sus
   cuentas email/password actuales (Supabase vincula por email).
```

- [ ] **Step 2: Commit**

```bash
git add docs/V2-ISOLATION.md
git commit -m "docs(v2): Google OAuth dashboard setup steps"
```

---

## Self-Review (planner)

**Spec coverage:**
- Strict RLS rewrite → Tasks 4, 7 (down restores old). ✅
- `user_id` on all tables → Tasks 3 (cols+backfill), 8 (app inserts). ✅
- `categorias` system/personal split → Tasks 3, 4. ✅
- `categorias_favoritas` fold-in → Tasks 3, 11. ✅
- RPC `aportes_meta.user_id` → Task 5. ✅
- Idempotent + reversible migration → Tasks 3–5 (`if not exists`/guarded), 7 (down). ✅
- Google OAuth + email/password kept → Tasks 9, 10, 12. ✅
- TDD isolation (A can't see B) → Tasks 1, 2 (RED), 6 (GREEN). ✅
- "Don't apply to prod / review first" → CRITICAL CONSTRAINTS + user-in-loop checkpoints (Tasks 2, 6, 7). ✅
- Designated owner for hogar rows = Christian → Task 3 A.3. ✅

**Placeholder scan:** No TBD/TODO; all SQL and JS shown in full; exact `js/db.js` line ranges given.

**Type/name consistency:** Policy names match between up (create) and down (drop). `signInWithGoogle` defined (Task 9) and called (Task 10). `_requireUserId()` reused (exists in db.js). RPC signatures unchanged (only insert columns added).

**Known limitation (documented in Task 7 note):** `down` is a structural dev-rollback, not a data-perfect restore of the original hogar/personal split.
