-- =====================================================================
-- Nestra — Migración: push notifications (FASE 6)
-- ---------------------------------------------------------------------
-- push_subscriptions: una fila por dispositivo/navegador suscrito.
-- notificaciones_log: candado idempotente anti-spam por periodo.
-- RLS estricta por dueño. La Edge Function usa service-role (salta RLS).
-- Idempotente: if not exists / drop if exists. Reusa set_updated_at().
-- =====================================================================

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_acceso" on public.push_subscriptions;
create policy "push_subscriptions_acceso"
  on public.push_subscriptions for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.notificaciones_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  tipo          text not null check (tipo in ('presupuesto', 'meta', 'prestamo')),
  ref_id        uuid,
  clave_dedupe  text not null,
  enviada_at    timestamptz not null default now()
);

-- Candado idempotente: mismo aviso, mismo periodo => no se reenvía.
create unique index if not exists idx_notif_log_user_clave
  on public.notificaciones_log (user_id, clave_dedupe);

alter table public.notificaciones_log enable row level security;

-- El usuario puede LEER su historial; solo service-role inserta.
drop policy if exists "notif_log_lectura" on public.notificaciones_log;
create policy "notif_log_lectura"
  on public.notificaciones_log for select
  to authenticated
  using ((select auth.uid()) = user_id);
