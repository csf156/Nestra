-- =====================================================================
-- Nestra — Migración: purga de propuestas de ingesta descartadas
-- ---------------------------------------------------------------------
-- Una propuesta de correo bancario descartada (estado='descartado')
-- guarda datos transitorios de origen HOSTIL: raw_subject / comercio /
-- contraparte / raw_body (hasta 20 KB del cuerpo del correo). No hay razón
-- para retenerlos indefinidamente una vez el usuario los descartó.
--
-- Esta función borra SOLO las filas 'descartado' resueltas hace más de
-- `p_dias` días (default 30). Invariante de seguridad, verificado por
-- supabase/tests/purge_ingest_test.sql:
--   * NUNCA toca 'confirmado' (dato vivo del usuario, aunque sea antiguo).
--   * NUNCA toca 'pendiente' ni 'revisar-manual' (sin resolver).
--   * NUNCA toca un 'descartado' con resolved_at NULL (no se puede envejecer)
--     ni uno resuelto hace menos de p_dias.
--
-- Por qué función + pg_cron y NO Edge Function: un borrado es puro SQL
-- en la base. El patrón Edge Function + pg_net (enviar-notificaciones)
-- existe solo porque el push necesita HTTP externo a FCM/APNs. Meter una
-- Edge Function aquí solo añadiría superficie (otro endpoint, el
-- service_role viajando por HTTP) sin ganar nada, y sería menos testeable.
--
-- SECURITY DEFINER + search_path='' fijo: la función corre con privilegios
-- del dueño para saltar RLS (borra de todos los usuarios), pero se le revoca
-- EXECUTE a public/anon/authenticated — solo el job de pg_cron (que corre
-- como el dueño) puede invocarla. Ningún cliente puede dispararla.
--
-- Idempotente: create or replace / unschedule condicional.
-- =====================================================================

create extension if not exists pg_cron;

create or replace function public.purgar_ingest_descartados(p_dias integer default 30)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_borradas integer;
begin
  delete from public.ingest_pendientes
   where estado = 'descartado'
     and resolved_at is not null
     and resolved_at < now() - make_interval(days => p_dias);
  get diagnostics v_borradas = row_count;

  raise log 'purgar_ingest_descartados: % filas borradas (> % dias)', v_borradas, p_dias;
  return v_borradas;
end;
$$;

-- Solo el job de pg_cron (dueño) la ejecuta. Nadie más — ni anon ni un
-- usuario autenticado — puede llamarla vía /rest/v1/rpc.
revoke all on function public.purgar_ingest_descartados(integer) from public;
revoke all on function public.purgar_ingest_descartados(integer) from anon;
revoke all on function public.purgar_ingest_descartados(integer) from authenticated;

-- Cron diario 03:30 UTC (fuera de pico; distinto del 08:00 de notificaciones).
select cron.unschedule('purgar-ingest-descartados')
where exists (select 1 from cron.job where jobname = 'purgar-ingest-descartados');

select cron.schedule(
  'purgar-ingest-descartados',
  '30 3 * * *',
  $$ select public.purgar_ingest_descartados(30); $$
);
