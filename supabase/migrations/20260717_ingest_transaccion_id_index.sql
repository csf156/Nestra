-- =====================================================================
-- Nestra — Migración: índice en ingest_pendientes.transaccion_id
-- ---------------------------------------------------------------------
-- Advisor 0001 (unindexed_foreign_keys): el FK transaccion_id no tenía
-- índice de cobertura. La FK es `on delete set null`, así que al borrar una
-- transacción Postgres escanea ingest_pendientes buscando filas que la
-- referencien; sin índice es un seq scan. El undo de "confirmar" borra la
-- transacción creada (deleteTransaccion) — camino caliente del feature.
--
-- Parcial: solo las filas con enlace real (la mayoría es null).
-- Idempotente: if not exists.
-- =====================================================================

create index if not exists idx_ingest_pendientes_transaccion_id
  on public.ingest_pendientes (transaccion_id)
  where transaccion_id is not null;
