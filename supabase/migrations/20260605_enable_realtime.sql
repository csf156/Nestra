-- Realtime: agregar las tablas a la publicación supabase_realtime para
-- habilitar la sincronización en tiempo real entre dispositivos.
-- RLS sigue aplicando a los eventos realtime: cada cliente solo recibe
-- cambios de las filas que su política le permite ver.
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.categorias;
alter publication supabase_realtime add table public.transacciones;
alter publication supabase_realtime add table public.prestamos;
alter publication supabase_realtime add table public.metas;
alter publication supabase_realtime add table public.desafios;
