-- supabase/tests/hogar_gasto_split_test.sql
-- Suite del split de gastos compartidos (Fase 6.3) — 2 hogares, 4 usuarios.
-- Correr en el SQL Editor de v2 DESPUÉS de aplicar
-- 20260715_fase6_3_economia_hogar.sql. Imprime ALL TESTS PASSED si pasa.
-- Idempotente / re-ejecutable: el teardown borra las filas de los 4 usuarios.
-- D = 44444444-...; E = 55555555-... (hogar "Casa DE", el hogar principal
-- bajo prueba). C = 66666666-...; F = 77777777-... (C empieza sin hogar,
-- para el ASSERT de "outsider"; luego crea "Casa CF" y F se une, para el
-- ASSERT de idempotencia acotada por hogar). Todos distintos de los de
-- hogar_rls_test.sql (11111111.../22222222.../33333333...) para poder
-- correr ambas suites sin colisión.

-- ── Teardown previo ──────────────────────────────────────────────────
delete from public.transacciones where user_id in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666',
  '77777777-7777-7777-7777-777777777777');
delete from public.hogar_liquidaciones where de_user in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666',
  '77777777-7777-7777-7777-777777777777')
  or a_user in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666',
  '77777777-7777-7777-7777-777777777777');
delete from public.hogar_codigos where hogar_id in (
  select id from public.hogares where creado_por in (
    '44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555',
    '66666666-6666-6666-6666-666666666666',
    '77777777-7777-7777-7777-777777777777'));
delete from public.hogar_miembros where user_id in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666',
  '77777777-7777-7777-7777-777777777777');
delete from public.hogares where creado_por in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666',
  '77777777-7777-7777-7777-777777777777');
delete from auth.users where id in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666',
  '77777777-7777-7777-7777-777777777777');

-- ── Setup usuarios ───────────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000','44444444-4444-4444-4444-444444444444','authenticated','authenticated','d@test.local',crypt('pw',gen_salt('bf')),now(),now(),now(),'{}','{"nombre":"D"}'),
  ('00000000-0000-0000-0000-000000000000','55555555-5555-5555-5555-555555555555','authenticated','authenticated','e@test.local',crypt('pw',gen_salt('bf')),now(),now(),now(),'{}','{"nombre":"E"}'),
  ('00000000-0000-0000-0000-000000000000','66666666-6666-6666-6666-666666666666','authenticated','authenticated','c@test.local',crypt('pw',gen_salt('bf')),now(),now(),now(),'{}','{"nombre":"C"}'),
  ('00000000-0000-0000-0000-000000000000','77777777-7777-7777-7777-777777777777','authenticated','authenticated','f@test.local',crypt('pw',gen_salt('bf')),now(),now(),now(),'{}','{"nombre":"F"}');

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
  if v_cat is null then
    raise exception 'Precondición: no hay categoría global de gasto en producción (user_id is null, tipo=gasto)';
  end if;
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

-- ── ASSERT 3: registrar_gasto_hogar rechaza monto 0 y monto negativo ──
do $$
declare v_cat uuid; v_ok0 boolean := false; v_okneg boolean := false;
begin
  select cat_id into v_cat from _split_test_grupo limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','44444444-4444-4444-4444-444444444444','role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.registrar_gasto_hogar(
      gen_random_uuid(), current_date, v_cat, null,
      jsonb_build_array(jsonb_build_object('user_id','44444444-4444-4444-4444-444444444444','monto',0))
    );
  exception when others then v_ok0 := true; end;
  begin
    perform public.registrar_gasto_hogar(
      gen_random_uuid(), current_date, v_cat, null,
      jsonb_build_array(jsonb_build_object('user_id','44444444-4444-4444-4444-444444444444','monto',-10))
    );
  exception when others then v_okneg := true; end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  if not v_ok0 then raise exception 'FALLO: aceptó una parte con monto 0'; end if;
  if not v_okneg then raise exception 'FALLO: aceptó una parte con monto negativo'; end if;
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

-- ── ASSERT 6: registrar_gasto_hogar es idempotente por grupo_id (mismo hogar) ──
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

-- ── ASSERT 8: registrar_gasto_hogar rechaza dos partes con el mismo user_id ──
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
        jsonb_build_object('user_id','44444444-4444-4444-4444-444444444444','monto',50)
      )
    );
  exception when others then v_ok := true; end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  if not v_ok then raise exception 'FALLO: aceptó dos partes con el mismo user_id'; end if;
end $$;

-- ── ASSERT 9: un outsider (C, sin hogar) es rechazado por ambos RPCs ──
do $$
declare v_cat uuid; v_ok1 boolean := false; v_ok2 boolean := false;
begin
  select cat_id into v_cat from _split_test_grupo limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','66666666-6666-6666-6666-666666666666','role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.registrar_gasto_hogar(gen_random_uuid(), current_date, v_cat, null,
      jsonb_build_array(jsonb_build_object('user_id','66666666-6666-6666-6666-666666666666','monto',10)));
  exception when others then v_ok1 := true; end;
  begin
    perform public.borrar_gasto_hogar(gen_random_uuid());
  exception when others then v_ok2 := true; end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  if not v_ok1 then raise exception 'FALLO: registrar_gasto_hogar aceptó a un usuario sin hogar'; end if;
  if not v_ok2 then raise exception 'FALLO: borrar_gasto_hogar aceptó a un usuario sin hogar'; end if;
end $$;

-- ── ASSERT 10: borrar_gasto_hogar rechaza un grupo_id inexistente,
--    llamado por un miembro real (rama v_n=0, distinta de "sin hogar") ──
do $$
declare v_ok boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','44444444-4444-4444-4444-444444444444','role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.borrar_gasto_hogar(gen_random_uuid());
  exception when others then v_ok := true; end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  if not v_ok then raise exception 'FALLO: borrar_gasto_hogar aceptó un grupo_id inexistente'; end if;
end $$;

-- ── ASSERT 11 (regresión de seguridad): la idempotencia de
--    registrar_gasto_hogar está acotada al hogar del llamante. Un
--    grupo_id que ya existe en OTRO hogar no se devuelve: se inserta una
--    fila nueva en el hogar del llamante. Antes del fix, la función era
--    security definer (ve transacciones sin RLS) y el guard solo filtraba
--    por grupo_id, así que un replay tardío de la outbox tras salir de un
--    hogar y entrar a otro devolvía filas del hogar ajeno. ──────────────
do $$
declare
  v_cod char(6); v_cat_cf uuid; v_grupo_ajeno uuid := gen_random_uuid();
  v_cat uuid; v_n_hogar_ajeno int; v_n_hogar_de int;
begin
  -- C crea "Casa CF", F se une (hogar distinto de "Casa DE")
  perform set_config('request.jwt.claims', json_build_object('sub','66666666-6666-6666-6666-666666666666','role','authenticated')::text, true);
  set local role authenticated;
  v_cod := (public.crear_hogar('Casa CF')->>'codigo');
  select id into v_cat_cf from public.categorias where user_id is null and tipo='gasto' limit 1;
  perform public.registrar_gasto_hogar(v_grupo_ajeno, current_date, v_cat_cf, 'gasto de Casa CF',
    jsonb_build_array(jsonb_build_object('user_id','66666666-6666-6666-6666-666666666666','monto',30)));
  reset role;
  perform set_config('request.jwt.claims', '{}', true);

  perform set_config('request.jwt.claims', json_build_object('sub','77777777-7777-7777-7777-777777777777','role','authenticated')::text, true);
  set local role authenticated;
  perform public.unirse_hogar(v_cod);
  reset role;
  perform set_config('request.jwt.claims', '{}', true);

  -- D (Casa DE, ajeno a Casa CF) llama registrar_gasto_hogar con el MISMO
  -- grupo_id que ya existe en Casa CF. Con el fix, NO debe devolver las
  -- filas de Casa CF: debe insertar una fila nueva en el hogar de D.
  select cat_id into v_cat from _split_test_grupo limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub','44444444-4444-4444-4444-444444444444','role','authenticated')::text, true);
  set local role authenticated;
  perform public.registrar_gasto_hogar(v_grupo_ajeno, current_date, v_cat, 'gasto de Casa DE',
    jsonb_build_array(jsonb_build_object('user_id','44444444-4444-4444-4444-444444444444','monto',15)));
  reset role;
  perform set_config('request.jwt.claims', '{}', true);

  select count(*) into v_n_hogar_ajeno from public.transacciones
    where grupo_id = v_grupo_ajeno and nota = 'gasto de Casa CF';
  select count(*) into v_n_hogar_de from public.transacciones
    where grupo_id = v_grupo_ajeno and nota = 'gasto de Casa DE';
  if v_n_hogar_ajeno <> 1 then
    raise exception 'FALLO: la fila original de Casa CF desapareció (había %)', v_n_hogar_ajeno;
  end if;
  if v_n_hogar_de <> 1 then
    raise exception 'FALLO: D no pudo insertar su propia fila con el grupo_id ajeno (había %) — ¿el guard de idempotencia sigue devolviendo datos de otro hogar?', v_n_hogar_de;
  end if;
end $$;

-- ── Teardown final ───────────────────────────────────────────────────
drop table if exists _split_test_grupo;
delete from public.transacciones where user_id in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666',
  '77777777-7777-7777-7777-777777777777');
delete from public.hogar_liquidaciones where de_user in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666',
  '77777777-7777-7777-7777-777777777777')
  or a_user in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666',
  '77777777-7777-7777-7777-777777777777');
delete from public.hogar_codigos where hogar_id in (
  select id from public.hogares where creado_por in (
    '44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555',
    '66666666-6666-6666-6666-666666666666',
    '77777777-7777-7777-7777-777777777777'));
delete from public.hogar_miembros where user_id in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666',
  '77777777-7777-7777-7777-777777777777');
delete from public.hogares where creado_por in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666',
  '77777777-7777-7777-7777-777777777777');
delete from auth.users where id in (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666',
  '77777777-7777-7777-7777-777777777777');

select 'ALL TESTS PASSED' as resultado;
