-- supabase/migrations/20260630_fase6_1_hogar_config.sql
-- Fase 6.1 — config de hogar (aporte esperado + renombrar). SOLO v2. Idempotente.

begin;

alter table public.hogar_miembros
  add column if not exists aporte_esperado numeric(10,2) not null default 0;

-- Fija el aporte esperado mensual de un miembro del hogar del llamante.
-- Pareja acuerda: cualquier miembro puede fijar el de ambos.
create or replace function public.set_aporte_esperado(p_miembro uuid, p_monto numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_hogar uuid := public.auth_hogar_id();
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  if p_monto is null or p_monto < 0 then raise exception 'Monto inválido'; end if;
  if not exists (select 1 from public.hogar_miembros
                 where hogar_id = v_hogar and user_id = p_miembro) then
    raise exception 'El miembro no pertenece a tu hogar';
  end if;
  update public.hogar_miembros set aporte_esperado = round(p_monto, 2)
   where hogar_id = v_hogar and user_id = p_miembro;
end; $$;

create or replace function public.renombrar_hogar(p_nombre text)
returns void language plpgsql security definer set search_path = public as $$
declare v_hogar uuid := public.auth_hogar_id();
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  update public.hogares set nombre = coalesce(nullif(trim(p_nombre),''), nombre)
   where id = v_hogar;
end; $$;

grant execute on function public.set_aporte_esperado(uuid, numeric) to authenticated;
grant execute on function public.renombrar_hogar(text)             to authenticated;

-- ── Exponer hogar_id en metas_con_progreso (Fase 6.1) ────────────────
-- getMetas() lee esta vista con select('*'); el scoping por hogar_id en
-- safe-to-spend y graficos necesita la columna. La vista original
-- (20260606) no la incluía → m.hogar_id llegaba undefined al cliente.
drop view if exists public.metas_con_progreso;
create view public.metas_con_progreso
  with (security_invoker = true)
as
  select
    m.id,
    m.nombre,
    m.tipo,
    m.horizonte,
    m.ambito,
    m.hogar_id,
    m.user_id,
    m.monto_objetivo,
    m.fecha_inicio,
    m.fecha_limite,
    m.estado,
    m.nota,
    m.importancia,
    m.es_fondo_emergencia,
    coalesce(sum(a.monto), 0) as monto_actual
  from public.metas m
  left join public.aportes_meta a on a.meta_id = m.id
  group by
    m.id, m.nombre, m.tipo, m.horizonte, m.ambito, m.hogar_id, m.user_id,
    m.monto_objetivo, m.fecha_inicio, m.fecha_limite, m.estado,
    m.nota, m.importancia, m.es_fondo_emergencia;

commit;
