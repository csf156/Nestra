-- =====================================================================
-- Nestra — Migración: pct_ahorro_objetivo en profiles
-- ---------------------------------------------------------------------
-- Qué % del dinero disponible (ingreso estimado − gastos fijos) se reserva
-- para metas en el hero del dashboard. Hasta ahora estaba hardcodeado en 50
-- (js/safe-to-spend.js). DEFAULT 50 a propósito: ningún usuario existente
-- cambia de comportamiento al desplegar.
--
-- Rango 0–80: el 0 es válido (no reservar nada). El tope de 80 no es una
-- regla financiera sino una guarda de usabilidad — evita dejar el disponible
-- en casi cero por un dedazo.
--
-- NO se reutiliza profiles.aporte_mensual_esperado: existe pero no se usa en
-- ningún sitio (verificado por grep en js/ y views/), y es un MONTO, no un
-- porcentaje; reaprovecharlo dejaría un nombre que miente.
--
-- Idempotente.
-- =====================================================================

alter table public.profiles
  add column if not exists pct_ahorro_objetivo integer not null default 50;

alter table public.profiles
  drop constraint if exists profiles_pct_ahorro_objetivo_rango;

alter table public.profiles
  add constraint profiles_pct_ahorro_objetivo_rango
  check (pct_ahorro_objetivo >= 0 and pct_ahorro_objetivo <= 80);
