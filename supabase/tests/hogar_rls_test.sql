-- supabase/tests/hogar_rls_test.sql
-- Suite RLS de hogar — 3 usuarios. Correr en el SQL Editor de v2 tras la migración.
-- A = 11111111-...; B = 22222222-...; C = 33333333-...
-- A y B en el mismo hogar; C fuera. Imprime ALL TESTS PASSED si pasa.
-- Idempotente / re-ejecutable: el teardown borra las filas de los 3 usuarios.

-- ── Teardown ─────────────────────────────────────────────────────────
-- Las tablas hogar_codigos/hogar_liquidaciones/hogar_miembros tienen FK
-- a hogares(id) ON DELETE CASCADE, así que borrar `hogares` las arrastra.
-- Se borran explícitamente igual (orden hijos→padres) para no depender de
-- que las filas cuelguen de un hogar de estos usuarios.
delete from public.transacciones where user_id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');
delete from public.hogar_liquidaciones where de_user in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333')
  or a_user in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');
delete from public.hogar_codigos where hogar_id in (
  select id from public.hogares where creado_por in (
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333'));
delete from public.hogar_miembros where user_id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');
delete from public.hogares where creado_por in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');

-- ── Setup usuarios ───────────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111','authenticated','authenticated','a@test.local',crypt('pw',gen_salt('bf')),now(),now(),now(),'{}','{"nombre":"A"}'),
  ('00000000-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222','authenticated','authenticated','b@test.local',crypt('pw',gen_salt('bf')),now(),now(),now(),'{}','{"nombre":"B"}'),
  ('00000000-0000-0000-0000-000000000000','33333333-3333-3333-3333-333333333333','authenticated','authenticated','c@test.local',crypt('pw',gen_salt('bf')),now(),now(),now(),'{}','{"nombre":"C"}');

-- ── Helper inline para actuar como un usuario ────────────────────────
-- perform set_config('request.jwt.claims', json_build_object('sub',<uuid>,'role','authenticated')::text, true);
-- set local role authenticated;

-- Tabla temporal para pasar el código generado en el setup a ASSERT 4.
create temporary table if not exists _hogar_test_codigo (codigo char(6));
delete from _hogar_test_codigo;

-- ── A crea hogar, B se une vía código ────────────────────────────────
do $$
declare v_cod char(6); v_res jsonb; v_cat uuid;
begin
  -- A actúa
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111111','role','authenticated')::text, true);
  set local role authenticated;
  v_res := public.crear_hogar('Casa AB');
  v_cod := v_res->>'codigo';
  -- A registra un gasto HOGAR y uno PERSONAL
  select id into v_cat from public.categorias where user_id is null limit 1;
  insert into public.transacciones (tipo,ambito,user_id,categoria_id,monto,nota)
    values ('gasto','hogar','11111111-1111-1111-1111-111111111111',v_cat,100,'A-hogar');
  insert into public.transacciones (tipo,ambito,user_id,categoria_id,monto,nota)
    values ('gasto','personal','11111111-1111-1111-1111-111111111111',v_cat,50,'A-personal');

  -- B actúa: se une
  perform set_config('request.jwt.claims', json_build_object('sub','22222222-2222-2222-2222-222222222222','role','authenticated')::text, true);
  set local role authenticated;
  perform public.unirse_hogar(v_cod);
  insert into public.transacciones (tipo,ambito,user_id,categoria_id,monto,nota)
    values ('gasto','hogar','22222222-2222-2222-2222-222222222222',v_cat,40,'B-hogar');
  insert into public.transacciones (tipo,ambito,user_id,categoria_id,monto,nota)
    values ('gasto','personal','22222222-2222-2222-2222-222222222222',v_cat,30,'B-personal');

  -- guarda el código (ya consumido por B) para el assert de cap-2
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  insert into _hogar_test_codigo (codigo) values (v_cod);
end $$;

-- ── ASSERT 1: A ve el gasto HOGAR de B, NO el personal de B ───────────
do $$
declare v_hogar_b int; v_pers_b int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111111','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_hogar_b from public.transacciones where nota='B-hogar';
  select count(*) into v_pers_b  from public.transacciones where nota='B-personal';
  if v_hogar_b <> 1 then raise exception 'FALLO: A no ve el gasto hogar de B (esperaba 1, vio %)', v_hogar_b; end if;
  if v_pers_b  <> 0 then raise exception 'FALLO: A ve el gasto PERSONAL de B (debía ser 0, vio %)', v_pers_b; end if;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- ── ASSERT 2: C (fuera) no ve nada de A/B ────────────────────────────
do $$
declare v_n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','33333333-3333-3333-3333-333333333333','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.transacciones where nota in ('A-hogar','A-personal','B-hogar','B-personal');
  if v_n <> 0 then raise exception 'FALLO: C ve % filas de A/B (debía ser 0)', v_n; end if;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- ── ASSERT 3: ya-en-hogar bloquea crear otro hogar ───────────────────
do $$
declare v_ok boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','22222222-2222-2222-2222-222222222222','role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.crear_hogar('Otro');
  exception when others then v_ok := true; end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  if not v_ok then raise exception 'FALLO: B pudo crear un 2º hogar estando ya en uno'; end if;
end $$;

-- ── ASSERT 4 (cap-2): C no puede unirse a un hogar lleno ─────────────
-- A+B ya ocupan el hogar (cap 2) y B consumió el código de un solo uso.
-- El intento de C debe fallar (código ya usado / hogar lleno).
do $$
declare v_ok boolean := false; v_cod char(6);
begin
  select codigo into v_cod from _hogar_test_codigo limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','33333333-3333-3333-3333-333333333333','role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.unirse_hogar(v_cod);
  exception when others then v_ok := true; end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  if not v_ok then raise exception 'FALLO: C se unió a un hogar lleno / con código ya usado'; end if;
end $$;

-- ── ASSERT 5: código claramente inválido es rechazado ────────────────
do $$
declare v_ok boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','33333333-3333-3333-3333-333333333333','role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.unirse_hogar('000000');
  exception when others then v_ok := true; end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  if not v_ok then raise exception 'FALLO: unirse_hogar aceptó un código inválido (000000)'; end if;
end $$;

-- ── Teardown final ───────────────────────────────────────────────────
drop table if exists _hogar_test_codigo;
delete from public.transacciones where user_id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');
delete from public.hogar_liquidaciones where de_user in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333')
  or a_user in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');
delete from public.hogar_codigos where hogar_id in (
  select id from public.hogares where creado_por in (
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333'));
delete from public.hogar_miembros where user_id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');
delete from public.hogares where creado_por in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');

select 'ALL TESTS PASSED' as resultado;
