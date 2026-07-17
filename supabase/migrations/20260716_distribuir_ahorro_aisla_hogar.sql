-- FIX de aislamiento entre hogares en distribuir_ahorro.
--
-- El bug: tres consultas de la rama 'hogar' no filtraban por hogar_id, así que
-- el ahorro de un hogar se repartía entre las metas de CUALQUIER hogar:
--
--   1. El fondo de emergencia:
--        where es_fondo_emergencia = true and ambito = 'hogar' limit 1
--      → agarraba el primero de la tabla, de quien fuera.
--   2 y 3. El loop de metas (pasada de pesos y pasada de reparto):
--        or (v_tx.ambito = 'hogar' and m.ambito = 'hogar')
--      → matcheaba las metas de hogar de todos los hogares.
--
-- La rama 'personal' sí acotaba (`and m.user_id = v_tx.user_id`); a la de hogar
-- le faltaba el equivalente. Como la función es SECURITY DEFINER, el reparto
-- escribía en aportes_meta de otro hogar saltándose la RLS.
--
-- Estaba dormido porque solo existía un hogar (con `limit 1` siempre acertaba).
-- Se detectó el 2026-07-16 al crear un segundo hogar de pruebas: sus S/505 de
-- ahorro aterrizaron en las metas del hogar real (Alquiler 🏠 pasó de 155 a
-- 530.65). Esos aportes se borraron a mano; no queda otra fila afectada.
--
-- v_tx.hogar_id siempre está poblado cuando ambito='hogar': lo garantiza el
-- trigger sync_hogar_id(), que además rechaza el insert si el usuario no
-- pertenece a un hogar.
--
-- Único cambio respecto a la versión anterior: los tres `hogar_id` de abajo.
create or replace function public.distribuir_ahorro(p_transaccion_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tx           public.transacciones%rowtype;
  v_total        numeric(10,2);
  v_fondo_id     uuid;
  v_suma_pesos   numeric := 0;
  v_repartido    numeric(10,2) := 0;
  v_aporte_fondo numeric(10,2);
  r              record;
  v_avance       numeric;
  v_f_horizonte  numeric;
  v_f_urgencia   numeric;
  v_f_rezago     numeric;
  v_peso         numeric;
  v_restante     numeric(10,2);
  v_asignado     numeric(10,2);
begin
  select * into v_tx from public.transacciones where id = p_transaccion_id;
  if not found then
    raise exception 'Transacción % no existe', p_transaccion_id;
  end if;
  if (select auth.uid()) <> v_tx.user_id then
    raise exception 'No autorizado: la transacción no pertenece al usuario';
  end if;

  v_total := v_tx.monto;

  if v_tx.ambito = 'hogar' then
    select id into v_fondo_id from public.metas
    where es_fondo_emergencia = true and ambito = 'hogar'
      and hogar_id = v_tx.hogar_id                      -- FIX 1: acota al hogar de la transacción
    limit 1;
    -- Sin fondo del hogar no se lanza: crear_hogar no lo crea, así que un hogar
    -- sin metas simplemente no reparte (el ahorro queda sin asignar, igual que
    -- ya hacía). La rama personal sí lanza porque ese fondo se auto-crea al
    -- registrarse y su ausencia sí sería una anomalía.
  else
    select id into v_fondo_id from public.metas
    where es_fondo_emergencia = true and ambito = 'personal' and user_id = v_tx.user_id limit 1;
    if v_fondo_id is null then
      raise exception 'No existe el fondo de emergencia personal del usuario';
    end if;
  end if;

  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.es_fondo_emergencia = false
      and m.estado = 'en_curso'
      and m.fecha_limite >= current_date
      and (m.monto_objetivo - coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0)) > 0
      and (
        (v_tx.ambito = 'personal' and m.ambito = 'personal' and m.user_id = v_tx.user_id)
        or (v_tx.ambito = 'hogar' and m.ambito = 'hogar' and m.hogar_id = v_tx.hogar_id)  -- FIX 2
      )
  loop
    v_f_horizonte := case r.horizonte when 'corto' then 3 when 'mediano' then 2 else 1 end;
    v_f_urgencia  := case
                       when (r.fecha_limite - current_date) < 7  then 3
                       when (r.fecha_limite - current_date) < 30 then 2
                       else 1
                     end;
    v_avance  := r.progreso / r.monto_objetivo;
    v_f_rezago := greatest(0.2, least(1, 1 - v_avance));
    v_peso := r.importancia * v_f_horizonte * v_f_urgencia * v_f_rezago;
    v_suma_pesos := v_suma_pesos + v_peso;
  end loop;

  if v_fondo_id is not null then
    select importancia into v_peso from public.metas where id = v_fondo_id;
    v_suma_pesos := v_suma_pesos + v_peso;
  end if;

  if v_suma_pesos <= 0 then
    return;
  end if;

  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.es_fondo_emergencia = false
      and m.estado = 'en_curso'
      and m.fecha_limite >= current_date
      and (m.monto_objetivo - coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0)) > 0
      and (
        (v_tx.ambito = 'personal' and m.ambito = 'personal' and m.user_id = v_tx.user_id)
        or (v_tx.ambito = 'hogar' and m.ambito = 'hogar' and m.hogar_id = v_tx.hogar_id)  -- FIX 3
      )
  loop
    v_f_horizonte := case r.horizonte when 'corto' then 3 when 'mediano' then 2 else 1 end;
    v_f_urgencia  := case
                       when (r.fecha_limite - current_date) < 7  then 3
                       when (r.fecha_limite - current_date) < 30 then 2
                       else 1
                     end;
    v_avance   := r.progreso / r.monto_objetivo;
    v_f_rezago := greatest(0.2, least(1, 1 - v_avance));
    v_peso     := r.importancia * v_f_horizonte * v_f_urgencia * v_f_rezago;

    v_restante := r.monto_objetivo - r.progreso;
    v_asignado := round(v_total * (v_peso / v_suma_pesos), 2);

    if v_asignado > v_restante then
      v_asignado := v_restante;
    end if;

    if v_asignado > 0 then
      insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
      values (r.id, v_tx.id, v_asignado, v_peso, v_tx.user_id);
      v_repartido := v_repartido + v_asignado;
    end if;
  end loop;

  v_aporte_fondo := v_total - v_repartido;
  if v_aporte_fondo > 0 and v_fondo_id is not null then
    select importancia into v_peso from public.metas where id = v_fondo_id;
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
    values (v_fondo_id, v_tx.id, v_aporte_fondo, v_peso, v_tx.user_id);
  end if;
end;
$function$;
