-- Verificación manual (ejecutar en SQL Editor o via MCP). Comprueba: unicidad de
-- endpoint, unicidad de (user_id, clave_dedupe). Valida constraints, no RLS de sesión.
-- user_id tiene FK a auth.users, así que reusamos un usuario real existente.

-- 1. endpoint único: el segundo insert debe fallar.
do $$
declare uid uuid;
begin
  select id into uid from auth.users limit 1;
  if uid is null then raise notice 'SKIP: no hay usuarios en auth.users'; return; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (uid, 'https://test.endpoint/abc', 'k1', 'a1');
  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
      values (uid, 'https://test.endpoint/abc', 'k2', 'a2');
    raise exception 'FALLO: endpoint duplicado se aceptó';
  exception when unique_violation then
    raise notice 'OK: endpoint único respetado';
  end;
  delete from public.push_subscriptions where endpoint = 'https://test.endpoint/abc';
end $$;

-- 2. (user_id, clave_dedupe) único: el segundo insert debe fallar.
do $$
declare uid uuid;
begin
  select id into uid from auth.users limit 1;
  if uid is null then raise notice 'SKIP: no hay usuarios en auth.users'; return; end if;
  insert into public.notificaciones_log (user_id, tipo, clave_dedupe)
    values (uid, 'presupuesto', 'presupuesto:x:2026-06');
  begin
    insert into public.notificaciones_log (user_id, tipo, clave_dedupe)
      values (uid, 'presupuesto', 'presupuesto:x:2026-06');
    raise exception 'FALLO: clave_dedupe duplicada se aceptó';
  exception when unique_violation then
    raise notice 'OK: dedupe único respetado';
  end;
  delete from public.notificaciones_log where clave_dedupe = 'presupuesto:x:2026-06';
end $$;
