-- =====================================================================
-- Nestra — Migración: updated_at en ingest_pendientes (para LWW)
-- ---------------------------------------------------------------------
-- El cliente pasa a resolver confirmar/descartar/revertir offline por la
-- outbox con Last-Write-Wins por updated_at (mismo mecanismo que
-- transacciones). La tabla no tenía la columna. Backfill con
-- coalesce(resolved_at, created_at) para las filas existentes.
--
-- SIN trigger a propósito: el cliente es el único que escribe `estado`
-- (el Worker de ingesta solo INSERTA filas nuevas con service-role) y fija
-- updated_at explícito en cada UPDATE. Un trigger BEFORE UPDATE que hiciera
-- updated_at = now() pisaría el valor del cliente y rompería la guardia LWW
-- del replay (js/sync.js compara el updated_at del payload contra el de la
-- fila del servidor antes de escribir).
--
-- Idempotente: add column if not exists.
-- =====================================================================

alter table public.ingest_pendientes
  add column if not exists updated_at timestamptz not null default now();

update public.ingest_pendientes
  set updated_at = coalesce(resolved_at, created_at)
  where updated_at = created_at;
