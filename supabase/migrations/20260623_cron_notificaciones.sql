-- =====================================================================
-- Nestra — Migración: cron diario de notificaciones push (FASE 6)
-- ---------------------------------------------------------------------
-- Habilita pg_cron + pg_net y agenda la invocación diaria (08:00 UTC)
-- de la Edge Function enviar-notificaciones. Idempotente.
-- Reemplazar <PROJECT_REF> y <SERVICE_ROLE_KEY> antes de aplicar.
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Quitar el job si ya existía (re-ejecución idempotente).
select cron.unschedule('enviar-notificaciones-diario')
where exists (select 1 from cron.job where jobname = 'enviar-notificaciones-diario');

select cron.schedule(
  'enviar-notificaciones-diario',
  '0 8 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/enviar-notificaciones',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
