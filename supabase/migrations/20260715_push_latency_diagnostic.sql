-- supabase/migrations/20260715_push_latency_diagnostic.sql
-- Tabla diagnóstica TEMPORAL para medir la latencia real de la Edge Function
-- enviar-notificaciones durante la ventana de medición de la rutina
-- nestra-push-latency-watch (10 días desde 2026-07-15). No es esquema de
-- app: sin RLS habilitada al crearla, este proyecto concede por defecto
-- INSERT/SELECT/UPDATE/DELETE a anon+authenticated en toda tabla public
-- nueva (verificado por introspección al aplicar esta migración) — así que
-- se habilita RLS sin policies (deny-all vía PostgREST; execute_sql/
-- apply_migration corren como service role y no se ven afectados). Borrar
-- esta tabla (y opcionalmente esta migración) al cerrar la medición.

begin;

create table if not exists public._debug_push_latency_log (
  id bigserial primary key,
  fecha date not null unique,
  sample_utc timestamptz not null default now(),
  execution_time_ms integer,
  status_code integer,
  timed_out boolean,
  n_subscriptions integer,
  error_msg text,
  nota text
);

comment on table public._debug_push_latency_log is
  'Diagnóstico temporal (rutina nestra-push-latency-watch): mide execution_time_ms real de enviar-notificaciones frente al timeout de net.http_post (30000ms, 20260715_cron_notificaciones_timeout.sql). Borrar tras cerrar la medición.';

alter table public._debug_push_latency_log enable row level security;

commit;
