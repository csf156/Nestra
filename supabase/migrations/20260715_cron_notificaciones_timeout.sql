-- supabase/migrations/20260715_cron_notificaciones_timeout.sql
-- Sube el timeout de net.http_post del cron de push a 30s. SOLO v2. Idempotente.
-- Reemplazar <SERVICE_ROLE_KEY> antes de aplicar (mismo patrón que
-- 20260623_cron_notificaciones.sql) — el service role real NUNCA se
-- commitea; se sustituye solo en la query que se envía a apply_migration.
--
-- net.http_post tiene timeout_milliseconds DEFAULT 5000. La Edge Function
-- enviar-notificaciones (20260623_cron_notificaciones.sql) tardó 4929ms en su
-- última ejecución medida (2026-07-15 08:00 UTC) — 71ms de margen sobre el
-- timeout. pg_net registró esa fila como timed_out=true en net._http_response
-- aunque la función completó con 200 (ver logs de Edge Functions). Sin este
-- cambio, cualquier cold start o aumento de suscripciones corta la llamada:
-- cron.job_run_details sigue reportando "succeeded" porque eso solo mide que
-- el http_post se encoló, no que la función respondiera — el fallo sería
-- silencioso, igual que el bug de Fase 6.2 (columna ausente degradada por
-- `|| '50_50'` en vez de fallar visible).

begin;

select cron.unschedule('enviar-notificaciones-diario')
where exists (select 1 from cron.job where jobname = 'enviar-notificaciones-diario');

select cron.schedule(
  'enviar-notificaciones-diario',
  '0 8 * * *',
  $$
  select net.http_post(
    url := 'https://ombnhxueclqfeyjzhroz.supabase.co/functions/v1/enviar-notificaciones',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

commit;
