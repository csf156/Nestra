-- =====================================================================
-- Nestra — Migración: notificaciones_log.tipo admite 'recurrente' (FASE 7)
-- ---------------------------------------------------------------------
-- El CHECK constraint original (20260623_push_subscriptions.sql) solo
-- permitía 'presupuesto'|'meta'|'prestamo'. Fase 7 agrega el disparador
-- de gasto/ingreso recurrente próximo a cobrarse; sin este ALTER, el
-- insert de candado idempotente falla y la notificación nunca se envía.
-- Idempotente. Ejecutar en SQL Editor de v2 antes de deployar
-- enviar-notificaciones con el detector de recurrentes.
-- =====================================================================

alter table public.notificaciones_log
  drop constraint if exists notificaciones_log_tipo_check;

alter table public.notificaciones_log
  add constraint notificaciones_log_tipo_check
  check (tipo in ('presupuesto', 'meta', 'prestamo', 'recurrente'));
