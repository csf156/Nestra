-- El fondo de emergencia recibía su peso (importancia) compitiendo con las metas
-- MÁS todo el sobrante — se llevaba una fracción grande de cada ahorro. Ahora
-- recibe un % bajo CONFIGURABLE (default 10, cap 0–50) off the top cuando hay
-- metas, y las metas se llevan el resto por peso. Sin metas → el fondo se lleva
-- el 100% (cajón por defecto). Aplica a fondo personal y de hogar por igual.

-- 1. Columna: % del ahorro que va al fondo. Solo aplica a filas de fondo.
alter table public.metas
  add column if not exists pct_fondo_emergencia smallint not null default 10
  check (pct_fondo_emergencia between 0 and 50);

-- 2. Recrear la vista con la columna nueva (conserva security_invoker=true del
--    fix de RLS del 2026-07-19: sin él, el progreso de metas de hogar volvería a
--    mostrar solo los aportes propios).
create or replace view public.metas_con_progreso
  with (security_invoker = true) as
  select m.id, m.nombre, m.tipo, m.horizonte, m.ambito, m.hogar_id, m.user_id,
         m.monto_objetivo, m.fecha_inicio, m.fecha_limite, m.estado, m.nota,
         m.importancia, m.es_fondo_emergencia, m.pct_fondo_emergencia,
         coalesce(sum(a.monto), 0::numeric) as monto_actual
  from public.metas m
  left join public.aportes_meta a on a.meta_id = m.id
  group by m.id, m.nombre, m.tipo, m.horizonte, m.ambito, m.hogar_id, m.user_id,
           m.monto_objetivo, m.fecha_inicio, m.fecha_limite, m.estado, m.nota,
           m.importancia, m.es_fondo_emergencia, m.pct_fondo_emergencia;

-- 3. distribuir_ahorro reescrito: el fondo ya no compite por peso; recibe su
--    corte fijo off the top (o el 100% si no hay metas).
create or replace function public.distribuir_ahorro(p_transaccion_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_tx           public.transacciones%rowtype;
  v_total        numeric(10,2);
  v_fondo_id     uuid;
  v_fondo_pct    smallint;
  v_suma_pesos   numeric := 0;
  v_repartido    numeric(10,2) := 0;
  v_corte        numeric(10,2);
  v_repartible   numeric(10,2);
  v_aporte_fondo numeric(10,2);
  v_hay_metas    boolean := false;
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
  if not found then raise exception 'Transacción % no existe', p_transaccion_id; end if;
  if (select auth.uid()) <> v_tx.user_id then
    raise exception 'No autorizado: la transacción no pertenece al usuario';
  end if;

  v_total := v_tx.monto;

  -- Fondo del ámbito de la transacción, con su pct configurable.
  if v_tx.ambito = 'hogar' then
    select id, pct_fondo_emergencia into v_fondo_id, v_fondo_pct
    from public.metas
    where es_fondo_emergencia = true and ambito = 'hogar'
      and hogar_id = v_tx.hogar_id
    limit 1;
  else
    select id, pct_fondo_emergencia into v_fondo_id, v_fondo_pct
    from public.metas
    where es_fondo_emergencia = true and ambito = 'personal' and user_id = v_tx.user_id
    limit 1;
    if v_fondo_id is null then
      raise exception 'No existe el fondo de emergencia personal del usuario';
    end if;
  end if;

  -- Pasada 1: pesos de las metas que califican (el fondo YA NO compite por peso).
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
        or (v_tx.ambito = 'hogar' and m.ambito = 'hogar' and m.hogar_id = v_tx.hogar_id)
      )
  loop
    v_hay_metas := true;
    v_f_horizonte := case r.horizonte when 'corto' then 3 when 'mediano' then 2 else 1 end;
    v_f_urgencia  := case
                       when (r.fecha_limite - current_date) < 7  then 3
                       when (r.fecha_limite - current_date) < 30 then 2
                       else 1
                     end;
    v_avance   := r.progreso / r.monto_objetivo;
    v_f_rezago := greatest(0.2, least(1, 1 - v_avance));
    v_peso     := r.importancia * v_f_horizonte * v_f_urgencia * v_f_rezago;
    v_suma_pesos := v_suma_pesos + v_peso;
  end loop;

  -- Sin metas → el fondo se lleva todo (cajón por defecto).
  if not v_hay_metas then
    if v_fondo_id is not null then
      insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
      values (v_fondo_id, v_tx.id, v_total, null, v_tx.user_id);
    end if;
    return;
  end if;

  -- Con metas: el fondo recibe su corte fijo off the top; el resto va a metas.
  v_corte := round(v_total * coalesce(v_fondo_pct, 10) / 100.0, 2);
  if v_fondo_id is null then v_corte := 0; end if;   -- sin fondo, no hay dónde poner el corte
  v_repartible := v_total - v_corte;

  -- Pasada 2: repartir v_repartible entre las metas por peso, topado a lo que falta.
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
        or (v_tx.ambito = 'hogar' and m.ambito = 'hogar' and m.hogar_id = v_tx.hogar_id)
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
    v_asignado := round(v_repartible * (v_peso / v_suma_pesos), 2);
    if v_asignado > v_restante then v_asignado := v_restante; end if;
    if v_asignado > 0 then
      insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
      values (r.id, v_tx.id, v_asignado, v_peso, v_tx.user_id);
      v_repartido := v_repartido + v_asignado;
    end if;
  end loop;

  -- El fondo recibe total - repartido = corte + sobrante de metas topadas.
  v_aporte_fondo := v_total - v_repartido;
  if v_aporte_fondo > 0 and v_fondo_id is not null then
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado, user_id)
    values (v_fondo_id, v_tx.id, v_aporte_fondo, null, v_tx.user_id);
  end if;
end;
$function$;

-- 4. RPC para configurar el % (ambos miembros del hogar pueden el del hogar).
--    Mismo patrón acotado que set_aporte_esperado.
create or replace function public.set_pct_fondo(p_ambito text, p_pct int)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_hogar uuid;
begin
  if p_pct is null or p_pct < 0 or p_pct > 50 then
    raise exception 'Porcentaje inválido: debe estar entre 0 y 50';
  end if;
  if p_ambito = 'personal' then
    update public.metas set pct_fondo_emergencia = p_pct
     where es_fondo_emergencia = true and ambito = 'personal'
       and user_id = (select auth.uid());
  elsif p_ambito = 'hogar' then
    v_hogar := public.auth_hogar_id();
    if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
    update public.metas set pct_fondo_emergencia = p_pct
     where es_fondo_emergencia = true and ambito = 'hogar'
       and hogar_id = v_hogar;
  else
    raise exception 'Ámbito inválido: %', p_ambito;
  end if;
end;
$function$;

grant execute on function public.set_pct_fondo(text, int) to authenticated;
