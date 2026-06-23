-- Verificación manual (ejecutar en SQL Editor con un usuario auth real o via service-role
-- simulando dos user_id distintos). Comprueba: unicidad de endpoint, unicidad de
-- (user_id, clave_dedupe). No depende de RLS de sesión; valida constraints.

-- 1. endpoint único: el segundo insert debe fallar.
do $$
declare uid uuid := gen_random_uuid();
begin
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
declare uid uuid := gen_random_uuid();
begin
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
