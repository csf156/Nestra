-- Fase 1: ahorro como tipo de transacción + categoría en metas

-- 1. Añade 'ahorro' al check de transacciones.tipo
alter table public.transacciones
  drop constraint if exists transacciones_tipo_check;

alter table public.transacciones
  add constraint transacciones_tipo_check
  check (tipo = any(array['gasto'::text, 'ingreso'::text, 'ahorro'::text]));

-- 2. Añade categoria_id a metas (nullable FK → categorias, SET NULL al borrar)
alter table public.metas
  add column if not exists categoria_id uuid references public.categorias(id) on delete set null;
