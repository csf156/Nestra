-- supabase/tests/hogar_gasto_split_test.sql
-- Suite del split de gastos compartidos (Fase 6.3) — 2 usuarios.
-- Correr en el SQL Editor de v2 DESPUÉS de aplicar
-- 20260715_fase6_3_economia_hogar.sql. Imprime ALL TESTS PASSED si pasa.
-- Idempotente / re-ejecutable: el teardown borra las filas de ambos usuarios.
-- D = 44444444-...; E = 55555555-... (distintos de los de hogar_rls_test.sql
-- para poder correr ambas suites sin colisión).

-- ── Teardown previo ──────────────────────────────────────────────────
delete from public.transacciones where user_id in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');
delete from public.hogar_liquidaciones where de_user in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555')
  or a_user in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');
delete from public.hogar_codigos where hogar_id in (
  select id from public.hogares where creado_por in (
    '44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555'));
delete from public.hogar_miembros where user_id in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');
delete from public.hogares where creado_por in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');
delete from auth.users where id in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');

-- ── Setup usuarios ───────────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000','44444444-4444-4444-4444-444444444444','authenticated','authenticated','d@test.local',crypt('pw',gen_salt('bf')),now(),now(),now(),'{}','{"nombre":"D"}'),
  ('00000000-0000-0000-0000-000000000000','55555555-5555-5555-5555-555555555555','authenticated','authenticated','e@test.local',crypt('pw',gen_salt('bf')),now(),now(),now(),'{}','{"nombre":"E"}');

create temporary table if not exists _split_test_grupo (grupo_id uuid, cat_id uuid);
delete from _split_test_grupo;

-- ── D crea hogar, E se une ────────────────────────────────────────────
do $$
declare v_cod char(6); v_res jsonb; v_cat uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','44444444-4444-4444-4444-444444444444','role','authenticated')::text, true);
  set local role authenticated;
  v_res := public.crear_hogar('Casa DE');
  v_cod := v_res->>'codigo';
  select id into v_cat from public.categorias where user_id is null and tipo='gasto' limit 1;
  insert into _split_test_grupo (cat_id) values (v_cat);

  perform set_config('request.jwt.claims', json_build_object('sub','55555555-5555-5555-5555-555555555555','role','authenticated')::text, true);
  set local role authenticated;
  perform public.unirse_hogar(v_cod);

  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- ── ASSERT 1: D registra un gasto compartido 60/40 → 2 filas hermanas,
--    misma grupo_id, cada una con user_id correcto ────────────────────
do $$
declare v_cat uuid; v_grupo uuid := gen_random_uuid(); v_n int; v_suma numeric;
begin
  select cat_id into v_cat from _split_test_grupo limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','44444444-4444-4444-4444-444444444444','role','authenticated')::text, true);
  set local role authenticated;
  perform public.registrar_gasto_hogar(
    v_grupo, current_date, v_cat, 'cena test',
    jsonb_build_array(
      jsonb_build_object('user_id','44444444-4444-4444-4444-444444444444','monto',60),
      jsonb_build_object('user_id','55555555-5555-5555-5555-555555555555','monto',40)
    )
  );
  reset role;
  perform set_config('request.jwt.claims', '{}', true);

  update _split_test_grupo set grupo_id = v_grupo;

  select count(*), coalesce(sum(monto),0) into v_n, v_suma
    from public.transacciones where grupo_id = v_grupo;
  if v_n <> 2 then raise exception 'FALLO: esperaba 2 filas hermanas, hubo %', v_n; end if;
  if v_suma <> 100 then raise exception 'FALLO: suma de partes % <> 100', v_suma; end if;
end $$;

-- ── ASSERT 2: E ve las 2 filas del grupo (comparte hogar) ─────────────
do $$
declare v_grupo uuid; v_n int;
begin
  select grupo_id into v_grupo from _split_test_grupo limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','55555555-5555-5555-5555-555555555555','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.transacciones where grupo_id = v_grupo;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  if v_n <> 2 then raise exception 'FALLO: E no ve las 2 filas del grupo (vio %)', v_n; end if;
end $$;

-- ── ASSERT 3: registrar_gasto_hogar rechaza partes que no suman positivo ──
do $$
declare v_cat uuid; v_ok boolean := false;
begin
  select cat_id into v_cat from _split_test_grupo limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','44444444-4444-4444-4444-444444444444','role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.registrar_gasto_hogar(
      gen_random_uuid(), current_date, v_cat, null,
      jsonb_build_array(jsonb_build_object('user_id','44444444-4444-4444-4444-444444444444','monto',0))
    );
  exception when others then v_ok := true; end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  if not v_ok then raise exception 'FALLO: aceptó una parte con monto 0'; end if;
end $$;

-- ── ASSERT 4: registrar_gasto_hogar rechaza a un no-miembro en las partes ──
do $$
declare v_cat uuid; v_ok boolean := false;
begin
  select cat_id into v_cat from _split_test_grupo limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','44444444-4444-4444-4444-444444444444','role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.registrar_gasto_hogar(
      gen_random_uuid(), current_date, v_cat, null,
      jsonb_build_array(
        jsonb_build_object('user_id','44444444-4444-4444-4444-444444444444','monto',50),
        jsonb_build_object('user_id','99999999-9999-9999-9999-999999999999','monto',50)
      )
    );
  exception when others then v_ok := true; end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  if not v_ok then raise exception 'FALLO: aceptó una parte de un user_id fuera del hogar'; end if;
end $$;

-- ── ASSERT 5: E (no registrante) NO puede borrar el grupo directamente
--    (DELETE en transacciones es owner-scoped) pero SÍ vía borrar_gasto_hogar ──
do $$
declare v_grupo uuid; v_n int;
begin
  select grupo_id into v_grupo from _split_test_grupo limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','55555555-5555-5555-5555-555555555555','role','authenticated')::text, true);
  set local role authenticated;
  perform public.borrar_gasto_hogar(v_grupo);
  reset role;
  perform set_config('request.jwt.claims', '{}', true);

  select count(*) into v_n from public.transacciones where grupo_id = v_grupo;
  if v_n <> 0 then raise exception 'FALLO: borrar_gasto_hogar no borró ambas filas (quedaron %)', v_n; end if;
end $$;

-- ── ASSERT 6: registrar_gasto_hogar es idempotente por grupo_id ───────
do $$
declare v_cat uuid; v_grupo uuid := gen_random_uuid(); v_n int;
begin
  select cat_id into v_cat from _split_test_grupo limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','44444444-4444-4444-4444-444444444444','role','authenticated')::text, true);
  set local role authenticated;
  perform public.registrar_gasto_hogar(v_grupo, current_date, v_cat, null,
    jsonb_build_array(jsonb_build_object('user_id','44444444-4444-4444-4444-444444444444','monto',100)));
  -- replay (mismo grupo_id) — no debe crear una segunda fila
  perform public.registrar_gasto_hogar(v_grupo, current_date, v_cat, null,
    jsonb_build_array(jsonb_build_object('user_id','44444444-4444-4444-4444-444444444444','monto',100)));
  reset role;
  perform set_config('request.jwt.claims', '{}', true);

  select count(*) into v_n from public.transacciones where grupo_id = v_grupo;
  if v_n <> 1 then raise exception 'FALLO: el replay duplicó filas (hay %)', v_n; end if;
end $$;

-- ── ASSERT 7: CHECK bloquea ambito=hogar + tipo=ingreso ───────────────
do $$
declare v_cat uuid; v_ok boolean := false;
begin
  select id into v_cat from public.categorias where user_id is null and tipo='ingreso' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','44444444-4444-4444-4444-444444444444','role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.transacciones (tipo, ambito, user_id, categoria_id, monto)
    values ('ingreso', 'hogar', '44444444-4444-4444-4444-444444444444', v_cat, 10);
  exception when others then v_ok := true; end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  if not v_ok then raise exception 'FALLO: insertó ambito=hogar + tipo=ingreso (debía bloquearlo el CHECK)'; end if;
end $$;

-- ── Teardown final ───────────────────────────────────────────────────
drop table if exists _split_test_grupo;
delete from public.transacciones where user_id in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');
delete from public.hogar_liquidaciones where de_user in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555')
  or a_user in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');
delete from public.hogar_codigos where hogar_id in (
  select id from public.hogares where creado_por in (
    '44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555'));
delete from public.hogar_miembros where user_id in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');
delete from public.hogares where creado_por in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');
delete from auth.users where id in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555');

select 'ALL TESTS PASSED' as resultado;
