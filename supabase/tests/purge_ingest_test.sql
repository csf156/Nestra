-- =====================================================================
-- Nestra — Test: purgar_ingest_descartados NO borra datos vivos
-- ---------------------------------------------------------------------
-- Corre en el SQL Editor (o execute_sql). Siembra 4 filas de prueba,
-- invoca la función de purga y verifica el invariante de seguridad. TODA
-- la siembra se revierte por una excepción centinela al final: el test es
-- de solo-efecto-nulo sobre datos reales, aunque la purga corra de verdad
-- (cualquier borrado real dentro de la tx también se revierte).
--
-- Resultado esperado: si algo falla, la corrida termina con ERROR
-- 'PURGE TEST FAILED: ...'. Si pasa, imprime 'PURGE TEST PASSED' y revierte.
--
-- Casos:
--   _tst_desc40  descartado, resuelto hace 40d  -> DEBE borrarse
--   _tst_desc5   descartado, resuelto hace  5d  -> sobrevive (reciente)
--   _tst_conf40  confirmado, resuelto hace 40d  -> sobrevive (dato vivo)
--   _tst_pend    pendiente,  sin resolver       -> sobrevive
-- =====================================================================

do $$
declare
  v_user uuid;
  v_desc40_borrado boolean;
  v_desc5_vive     boolean;
  v_conf40_vive    boolean;
  v_pend_vive      boolean;
begin
  select user_id into v_user from public.ingest_pendientes limit 1;
  if v_user is null then
    raise exception 'PURGE TEST FAILED: no hay filas en ingest_pendientes para tomar un user_id de prueba';
  end if;

  insert into public.ingest_pendientes (user_id, message_id, banco, tipo, monto, fecha, estado, resolved_at)
  values
    (v_user, '_tst_desc40', 'bbva', 'gasto', 10, '2026-01-01', 'descartado', now() - interval '40 days'),
    (v_user, '_tst_desc5',  'bbva', 'gasto', 10, '2026-01-01', 'descartado', now() - interval '5 days'),
    (v_user, '_tst_conf40', 'bbva', 'gasto', 10, '2026-01-01', 'confirmado', now() - interval '40 days'),
    (v_user, '_tst_pend',   'bbva', 'gasto', 10, '2026-01-01', 'pendiente',  null);

  perform public.purgar_ingest_descartados(30);

  select not exists (select 1 from public.ingest_pendientes where user_id = v_user and message_id = '_tst_desc40') into v_desc40_borrado;
  select     exists (select 1 from public.ingest_pendientes where user_id = v_user and message_id = '_tst_desc5')  into v_desc5_vive;
  select     exists (select 1 from public.ingest_pendientes where user_id = v_user and message_id = '_tst_conf40') into v_conf40_vive;
  select     exists (select 1 from public.ingest_pendientes where user_id = v_user and message_id = '_tst_pend')   into v_pend_vive;

  if not v_desc40_borrado then raise exception 'PURGE TEST FAILED: no borró el descartado de 40 dias'; end if;
  if not v_desc5_vive     then raise exception 'PURGE TEST FAILED: borró un descartado reciente (5 dias)'; end if;
  if not v_conf40_vive    then raise exception 'PURGE TEST FAILED: borró un CONFIRMADO (dato vivo)'; end if;
  if not v_pend_vive      then raise exception 'PURGE TEST FAILED: borró un pendiente sin resolver'; end if;

  raise notice 'PURGE TEST PASSED';

  -- Revertir siempre la siembra (y cualquier borrado real de la purga).
  raise exception 'nestra_rollback_ok';
exception
  when others then
    if sqlerrm = 'nestra_rollback_ok' then
      raise notice 'PURGE TEST PASSED — siembra revertida, datos reales intactos';
    else
      raise;  -- propaga PURGE TEST FAILED o cualquier error real
    end if;
end $$;
