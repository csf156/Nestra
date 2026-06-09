-- Migration: add fecha_devolucion to prestamos
-- Apply once in Supabase SQL Editor.

alter table public.prestamos
  add column if not exists fecha_devolucion date;
