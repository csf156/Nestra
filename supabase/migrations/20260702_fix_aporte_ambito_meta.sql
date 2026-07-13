-- =====================================================================
-- Nestra — Fix: aporte_directo_meta respeta el ámbito de la meta
-- ---------------------------------------------------------------------
-- Bug: la transacción de ahorro se insertaba SIEMPRE con ambito='personal',
-- así que aportar a una meta de HOGAR figuraba como ahorro PERSONAL.
-- Fix: usar v_meta.ambito. El trigger sync_hogar_id (Fase 6) estampa el
-- hogar_id correcto cuando ambito='hogar'. Resto de la función idéntico a
-- 20260623_ahorro_tipo.sql. Idempotente (create or replace). SOLO v2.
-- =====================================================================

create or replace function public.aporte_directo_meta(
  p_meta_id uuid,
  p_monto   numeric,
  p_fecha   date,
  p_nota    text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_meta       public.metas%rowtype;
  v_tx_id      uuid;
  v_progreso   numeric(10,2);
  v_restante   numeric(10,2);
  v_a_meta     numeric(10,2);
  v_a_fondo    numeric(10,2);
  v_fondo_id   uuid;
begin
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del aporte debe ser mayor que 0';
  end if;

  select * into v_meta from public.metas where id = p_meta_id;
  if not found then
    raise exception 'La meta % no existe', p_meta_id;
  end if;
  if not (v_meta.ambito = 'hogar' or v_meta.user_id = v_uid) then
    raise exception 'No autorizado: la meta no pertenece al usuario';
  end if;

  -- ambito de la transacción = el de la meta (el trigger sync_hogar_id
  -- estampa hogar_id cuando es 'hogar'). Antes estaba hardcodeado 'personal'.
  insert into public.transacciones
    (fecha, tipo, ambito, user_id, categoria_id, monto, nota, es_aporte_directo)
  values
    (coalesce(p_fecha, current_date), 'ahorro', v_meta.ambito, v_uid, null, p_monto, p_nota, true)
  returning id into v_tx_id;

  select coalesce(sum(a.monto), 0) into v_progreso
  from public.aportes_meta a where a.meta_id = p_meta_id;

  if v_meta.es_fondo_emergencia or v_meta.monto_objetivo is null then
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
    values (p_meta_id, v_tx_id, p_monto, null, v_uid);
    return v_tx_id;
  end if;

  v_restante := v_meta.monto_objetivo - v_progreso;

  if v_restante <= 0 then
    v_a_meta  := 0;
    v_a_fondo := p_monto;
  elsif p_monto <= v_restante then
    v_a_meta  := p_monto;
    v_a_fondo := 0;
  else
    v_a_meta  := v_restante;
    v_a_fondo := p_monto - v_restante;
  end if;

  if v_a_meta > 0 then
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
    values (p_meta_id, v_tx_id, v_a_meta, null, v_uid);
  end if;

  if v_a_fondo > 0 then
    if v_meta.ambito = 'hogar' then
      select id into v_fondo_id from public.metas
      where es_fondo_emergencia and ambito = 'hogar' limit 1;
    else
      select id into v_fondo_id from public.metas
      where es_fondo_emergencia and ambito = 'personal' and user_id = v_uid limit 1;
    end if;
    if v_fondo_id is null then
      raise exception 'No existe el fondo de emergencia del ámbito % para el excedente', v_meta.ambito;
    end if;
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
    values (v_fondo_id, v_tx_id, v_a_fondo, null, v_uid);
  end if;

  return v_tx_id;
end;
$$;

grant  execute on function public.aporte_directo_meta(uuid, numeric, date, text) to authenticated;
revoke execute on function public.aporte_directo_meta(uuid, numeric, date, text) from anon, public;
