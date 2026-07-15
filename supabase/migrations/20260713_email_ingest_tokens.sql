-- =====================================================================
-- Nestra — Migración: email ingest tokens (ingesta de correos bancarios)
-- ---------------------------------------------------------------------
-- Una fila por token de ingesta. El token identifica al usuario dueño de
-- una cuenta Gmail que reenvía sus correos del banco vía Apps Script.
-- Se guarda SOLO el SHA-256 del token (hex, 64 chars), nunca el token en
-- claro. El Worker (fetch) recibe el token, lo hashea y busca aquí el
-- user_id usando service-role (salta RLS). La transacción resultante se
-- inserta como PERSONAL del user_id (hogar_id = NULL).
--
-- Escalabilidad: dar de alta un usuario = insertar una fila (no tocar el
-- código del Worker ni redesplegar). Revocar = flag `revoked`.
-- RLS estricta por dueño. Idempotente. Reusa set_updated_at().
-- =====================================================================

create table if not exists public.email_ingest_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  token_hash    text not null unique,          -- SHA-256(token) en hex minúsculas
  label         text,                          -- ej. "Gmail personal"
  revoked       boolean not null default false,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

-- Lookup del Worker: por hash, ignorando revocados.
create index if not exists idx_email_ingest_tokens_hash
  on public.email_ingest_tokens (token_hash)
  where not revoked;

create index if not exists idx_email_ingest_tokens_user
  on public.email_ingest_tokens (user_id);

alter table public.email_ingest_tokens enable row level security;

-- El dueño gestiona sus propios tokens (ver label/estado, revocar, alta
-- self-service futura desde la PWA). El Worker usa service-role → salta RLS.
drop policy if exists "email_ingest_tokens_acceso" on public.email_ingest_tokens;
create policy "email_ingest_tokens_acceso"
  on public.email_ingest_tokens for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
