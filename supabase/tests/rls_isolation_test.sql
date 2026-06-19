-- supabase/tests/rls_isolation_test.sql
-- Two-user RLS isolation suite for Fase 0. Run in the v2 SQL Editor ONLY.
-- A passing run prints "ALL TESTS PASSED". Any failure raises an exception.
-- Idempotent: drops/recreates the two synthetic users each run.

-- ── Fixed UUIDs for the synthetic users ──────────────────────────────
--   A = 11111111-1111-1111-1111-111111111111
--   B = 22222222-2222-2222-2222-222222222222

-- ── Teardown (in case a previous run left rows) ──────────────────────
delete from public.transacciones where user_id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);
delete from public.categorias where user_id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);
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

  perform set_config('request.jwt.claims', '{}', true);
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

  perform set_config('request.jwt.claims', '{}', true);
  reset role;
  raise notice 'TEST 1 PASSED: B cannot read A transactions';
end $$;

-- ── TEST 1b: A CAN SELECT its own transaction ─────────────────────────
do $$
declare n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','11111111-1111-1111-1111-111111111111',
                      'role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.transacciones where nota = 'A-secret';
  if n <> 1 then raise exception 'TEST 1b FAILED: A cannot read its own transaction (count=%)', n; end if;

  perform set_config('request.jwt.claims', '{}', true);
  reset role;
  raise notice 'TEST 1b PASSED: A reads its own transaction';
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

  perform set_config('request.jwt.claims', '{}', true);
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

  perform set_config('request.jwt.claims', '{}', true);
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

  perform set_config('request.jwt.claims', '{}', true);
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
  exception when insufficient_privilege then
    ok := true; -- RLS rejected, as expected
  end;

  perform set_config('request.jwt.claims', '{}', true);
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

  perform set_config('request.jwt.claims', '{}', true);
  reset role;
  raise notice 'TEST 6 PASSED: B cannot read A profile';
end $$;

-- ── Teardown ─────────────────────────────────────────────────────────
delete from public.transacciones where user_id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);
delete from public.categorias where user_id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);

select 'ALL TESTS PASSED (7 tests)' as result;
