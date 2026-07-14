-- supabase/migrations/20260701_fase6_2_hogar.sql
-- Fase 6.2 — presupuestos del hogar. SOLO v2. Idempotente.
--
-- Alcance recortado el 2026-07-14: esta migración nunca llegó a aplicarse a la
-- base de producción v2, y la Fase 6.3 redefine el significado de `reparto`
-- (deja de inferir deuda; pasa a definir qué significa "igualar" el
-- desequilibrio de aportes). La columna `hogares.reparto` y el RPC
-- `set_reparto_hogar` se retiran de aquí y los crea la migración de 6.3, con la
-- semántica y los valores definitivos. Hasta entonces `hogar.reparto` llega
-- undefined al cliente y calcularBalanceHogar cae a la rama '50_50', que es el
-- comportamiento vivo desde la Fase 6.

begin;

-- Presupuesto del hogar por categoría (paralelo a categorias.limite_mensual,
-- que es el presupuesto personal). Las categorías compartidas (user_id IS NULL)
-- ya son editables por cualquier miembro (categorias_update de 20260622).
alter table public.categorias
  add column if not exists limite_mensual_hogar numeric(10,2);

commit;
