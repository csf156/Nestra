-- supabase/migrations/20260701_fase6_2_hogar.sql
-- Fase 6.2 — presupuestos hogar + reparto configurable. SOLO v2. Idempotente.

begin;

-- Presupuesto del hogar por categoría (paralelo a categorias.limite_mensual,
-- que es el presupuesto personal). Las categorías compartidas (user_id IS NULL)
-- ya son editables por cualquier miembro (categorias_update de 20260622).
alter table public.categorias
  add column if not exists limite_mensual_hogar numeric(10,2);

-- Modo de reparto del balance "quién debe qué" del hogar.
alter table public.hogares
  add column if not exists reparto text not null default '50_50'
  check (reparto in ('50_50','proporcional'));

create or replace function public.set_reparto_hogar(p_modo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_hogar uuid := public.auth_hogar_id();
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  if p_modo not in ('50_50','proporcional') then raise exception 'Modo inválido'; end if;
  update public.hogares set reparto = p_modo where id = v_hogar;
end; $$;

grant execute on function public.set_reparto_hogar(text) to authenticated;

commit;
