-- =====================================================================
-- Nestra — Migración: categorias.esencial (Brújula / anti-impulso)
-- ---------------------------------------------------------------------
-- Marca si una categoría es de gasto esencial. Las NO esenciales activan
-- el freno anti-impulso de la Brújula (costo de oportunidad + espera 48h).
-- Default true (conservador: no molesta salvo que el usuario marque lo
-- contrario). Categorías globales (user_id null) comparten el flag.
-- Idempotente. Ejecutar en SQL Editor de v2.
-- =====================================================================

alter table public.categorias
  add column if not exists esencial boolean not null default true;
