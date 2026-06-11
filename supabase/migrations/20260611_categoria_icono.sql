-- Añade columna `icono` a categorias: nombre del ícono Tabler (ej. "car").
-- Nullable; null → ícono por defecto en la UI. Aditivo, no rompe v1.
alter table public.categorias add column if not exists icono text;
