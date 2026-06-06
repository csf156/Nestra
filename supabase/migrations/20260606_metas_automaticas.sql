-- =====================================================================
-- Nestra — Migración: metas automáticas (FASE 1)
-- ---------------------------------------------------------------------
-- Introduce el modelo auditable + reversible de distribución de ahorro:
--   * Nueva tabla `aportes_meta` = fuente de verdad de cuánto se aportó
--     a cada meta y por qué transacción (auditable y reversible).
--   * Vista `metas_con_progreso` = monto_actual DERIVADO de aportes_meta.
--     (NO se elimina metas.monto_actual en esta fase; es aditivo. Una
--     fase posterior retirará la columna física.)
--   * "Fondo de emergencia": meta permanente, sin objetivo/fecha, que
--     COMPITE por peso Y ADEMÁS absorbe el sobrante. Uno PERSONAL por
--     usuario + uno compartido del HOGAR. No se puede borrar.
--   * Dos funciones RPC SECURITY DEFINER reparten el ahorro:
--       distribuir_ahorro(p_transaccion_id)        — ámbito personal
--       distribuir_aporte_hogar(p_aporte_id)        — ámbito hogar
--
-- Migración ADITIVA: no borra datos ni la columna monto_actual.
-- Pensada para re-ejecutarse sin error (if not exists / drop if exists).
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================


-- =====================================================================
-- 1.1 NUEVAS COLUMNAS EN metas
-- ---------------------------------------------------------------------
-- importancia (1..5, por defecto 3) pondera la meta en el reparto.
-- es_fondo_emergencia marca el fondo permanente (sin objetivo/fecha).
-- El fondo no tiene objetivo, fecha límite ni horizonte: esas columnas
-- pasan a ser NULLABLE y un CHECK a nivel de tabla exige que, para las
-- metas normales (es_fondo_emergencia=false), sigan completas y > 0.
-- =====================================================================

alter table public.metas add column if not exists importancia          int     not null default 3;
alter table public.metas add column if not exists es_fondo_emergencia  boolean not null default false;

-- importancia entre 1 y 5
alter table public.metas drop constraint if exists metas_importancia_check;
alter table public.metas add  constraint metas_importancia_check check (importancia between 1 and 5);

-- Hacer NULLABLE objetivo, fecha límite y horizonte (el fondo no los usa).
alter table public.metas alter column monto_objetivo drop not null;
alter table public.metas alter column fecha_limite   drop not null;
alter table public.metas alter column horizonte      drop not null;

-- Retirar los CHECK/NOT NULL antiguos sobre monto_objetivo: el check de
-- ">0" se reemplaza por uno condicional a nivel de tabla.
alter table public.metas drop constraint if exists metas_monto_objetivo_check;

-- CHECK condicional: una meta NORMAL debe tener objetivo>0, fecha y
-- horizonte; el FONDO puede tenerlos NULL.
alter table public.metas drop constraint if exists metas_fondo_o_completa_check;
alter table public.metas add  constraint metas_fondo_o_completa_check check (
  es_fondo_emergencia = true
  or (
    monto_objetivo is not null and monto_objetivo > 0
    and fecha_limite is not null
    and horizonte   is not null
  )
);


-- =====================================================================
-- 1.2 TABLA aportes_meta
-- ---------------------------------------------------------------------
-- Fuente de verdad del progreso de cada meta. Cada fila es una porción
-- de una transacción asignada a una meta. Al borrarse la meta o la
-- transacción, sus aportes se borran en cascada (reversible).
-- peso_aplicado guarda el peso con que se repartió (auditoría).
-- =====================================================================

create table if not exists public.aportes_meta (
  id              uuid primary key default gen_random_uuid(),
  meta_id         uuid not null references public.metas (id)        on delete cascade,
  transaccion_id  uuid not null references public.transacciones (id) on delete cascade,
  monto           numeric(10,2) not null check (monto > 0),
  peso_aplicado   numeric,
  created_at      timestamptz not null default now()
);

create index if not exists idx_aportes_meta_meta_id        on public.aportes_meta (meta_id);
create index if not exists idx_aportes_meta_transaccion_id on public.aportes_meta (transaccion_id);


-- =====================================================================
-- 1.3 VISTA metas_con_progreso
-- ---------------------------------------------------------------------
-- Expone todas las columnas de metas EXCEPTO monto_actual (columna
-- física), reemplazándola por la suma derivada de aportes_meta. Así la
-- app lee siempre el progreso real auditable.
-- security_invoker = true: aplica el RLS del usuario que consulta, no el
-- del dueño de la vista.
-- =====================================================================

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
    m.id, m.nombre, m.tipo, m.horizonte, m.ambito, m.user_id,
    m.monto_objetivo, m.fecha_inicio, m.fecha_limite, m.estado,
    m.nota, m.importancia, m.es_fondo_emergencia;


-- =====================================================================
-- 1.4 RLS en aportes_meta
-- ---------------------------------------------------------------------
-- Hereda el acceso de su meta vinculada (mismo patrón EXISTS que
-- prestamos sobre transacciones): meta de hogar la ven ambos; meta
-- personal solo su dueño.
-- =====================================================================

alter table public.aportes_meta enable row level security;

drop policy if exists "aportes_meta_acceso" on public.aportes_meta;
create policy "aportes_meta_acceso"
  on public.aportes_meta for all
  to authenticated
  using (
    exists (
      select 1
      from public.metas m
      where m.id = aportes_meta.meta_id
        and (m.ambito = 'hogar' or (select auth.uid()) = m.user_id)
    )
  )
  with check (
    exists (
      select 1
      from public.metas m
      where m.id = aportes_meta.meta_id
        and (m.ambito = 'hogar' or (select auth.uid()) = m.user_id)
    )
  );


-- =====================================================================
-- 1.5 PROTEGER EL FONDO DE BORRADO
-- ---------------------------------------------------------------------
-- El fondo de emergencia es permanente: se añade es_fondo_emergencia =
-- false a la política de borrado de metas.
-- =====================================================================

drop policy if exists "metas_delete" on public.metas;
create policy "metas_delete" on public.metas for delete to authenticated
  using ((ambito = 'hogar' or (select auth.uid()) = user_id) and es_fondo_emergencia = false);

-- Cerrar el bypass update-then-delete: metas_delete prohíbe borrar el fondo,
-- pero un cliente podría poner es_fondo_emergencia=false vía update y luego
-- borrarlo. Este trigger BEFORE UPDATE impide degradar un fondo (true→false).
create or replace function public.metas_proteger_fondo()
returns trigger
language plpgsql
as $$
begin
  if old.es_fondo_emergencia = true and new.es_fondo_emergencia = false then
    raise exception 'No se puede degradar el fondo de emergencia (es permanente)';
  end if;
  return new;
end;
$$;

drop trigger if exists metas_proteger_fondo on public.metas;
create trigger metas_proteger_fondo
  before update on public.metas
  for each row
  execute function public.metas_proteger_fondo();


-- =====================================================================
-- 1.6 FONDOS DE EMERGENCIA
-- ---------------------------------------------------------------------
-- HOGAR: convertir la meta semilla existente en fondo (sin objetivo).
-- PERSONAL: backfill de un fondo por cada usuario que no lo tenga, y
-- extender handle_new_user() para crearlo a los usuarios nuevos.
-- =====================================================================

-- HOGAR: la meta semilla "Fondo de emergencia" pasa a ser fondo real.
update public.metas
   set es_fondo_emergencia = true,
       monto_objetivo      = null,
       fecha_limite        = null,
       horizonte           = null
 where nombre = 'Fondo de emergencia'
   and ambito = 'hogar';

-- Garantizar UN solo fondo por ámbito ANTES del backfill: índices únicos
-- parciales. Personal: uno por usuario. Hogar: uno único global (expresión
-- constante). Así el guard + el índice impiden fondos duplicados y permiten
-- el on conflict do nothing de handle_new_user().
create unique index if not exists idx_metas_fondo_personal_unico
  on public.metas (user_id)
  where es_fondo_emergencia and ambito = 'personal';

create unique index if not exists idx_metas_fondo_hogar_unico
  on public.metas ((true))
  where es_fondo_emergencia and ambito = 'hogar';

-- PERSONAL (usuarios existentes): crear el fondo a quien no lo tenga.
insert into public.metas
  (nombre, tipo, ambito, user_id, es_fondo_emergencia, importancia, estado)
select 'Fondo de emergencia', 'ahorro', 'personal', u.id, true, 2, 'en_curso'
from auth.users u
where not exists (
  select 1 from public.metas m
  where m.user_id = u.id
    and m.ambito = 'personal'
    and m.es_fondo_emergencia = true
);

-- PERSONAL (usuarios nuevos): handle_new_user() crea perfil + fondo.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, nombre, aporte_mensual_esperado)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)),
    0
  );

  -- Fondo de emergencia personal: meta permanente, sin objetivo/fecha.
  -- Aislado en su propio sub-bloque: si la creación del fondo falla, NO
  -- debe abortar la creación del usuario/perfil (solo se avisa). El índice
  -- único parcial permite el on conflict do nothing ante un doble disparo.
  begin
    insert into public.metas
      (nombre, tipo, ambito, user_id, es_fondo_emergencia, importancia, estado)
    values
      ('Fondo de emergencia', 'ahorro', 'personal', new.id, true, 2, 'en_curso')
    on conflict do nothing;
  exception
    when others then
      raise warning 'No se pudo crear el fondo de emergencia para %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

-- La función solo debe correr vía trigger, no como RPC pública.
revoke execute on function public.handle_new_user() from public, anon, authenticated;


-- =====================================================================
-- 1.7 RPC distribuir_ahorro(p_transaccion_id)
-- ---------------------------------------------------------------------
-- Reparte el monto de una transacción de ahorro PERSONAL entre las metas
-- personales del usuario, según un peso, y vuelca el sobrante al fondo.
--
-- PESOS
--   normal = importancia * f_horizonte * f_urgencia * f_rezago
--   fondo  = importancia                                  (solo)
-- CONSTANTES
--   f_horizonte: corto=3, mediano=2, largo=1
--   f_urgencia : días hasta fecha_limite <7 => 3; <30 => 2; resto => 1
--   f_rezago   : (1 - avance) acotado a [0.2, 1]; avance = progreso/objetivo
--   (f_restante NO se usa intencionalmente)
--
-- REPARTO
--   * Cada meta normal se TOPEA en su restante (objetivo - progreso).
--   * El sobrante topeado se suma ENTERO al fondo (el fondo nunca se topea).
--   * El fondo siempre existe ⇒ nada queda sin asignar.
--   * Redondeo a 2 decimales; el resto de redondeo va al fondo, de modo
--     que la suma repartida == transaccion.monto.
-- SEGURIDAD: SECURITY DEFINER; solo el dueño de la transacción la reparte.
-- =====================================================================

create or replace function public.distribuir_ahorro(p_transaccion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
  -- 1. Cargar la transacción y validar autoría.
  select * into v_tx from public.transacciones where id = p_transaccion_id;
  if not found then
    raise exception 'Transacción % no existe', p_transaccion_id;
  end if;
  if (select auth.uid()) <> v_tx.user_id then
    raise exception 'No autorizado: la transacción no pertenece al usuario';
  end if;

  v_total := v_tx.monto;

  -- 2. Fondo personal del usuario (siempre existe).
  select id into v_fondo_id
  from public.metas
  where es_fondo_emergencia = true
    and ambito = 'personal'
    and user_id = v_tx.user_id
  limit 1;
  if v_fondo_id is null then
    raise exception 'El usuario no tiene fondo de emergencia personal';
  end if;

  -- 3. Calcular pesos de las metas normales candidatas (suma de pesos).
  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.ambito = 'personal'
      and m.user_id = v_tx.user_id
      and m.es_fondo_emergencia = false
      and m.estado = 'en_curso'
      and m.fecha_limite >= current_date
      and (m.monto_objetivo - coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0)) > 0
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

  -- Añadir el peso del fondo (solo importancia) a la suma total.
  select importancia into v_peso from public.metas where id = v_fondo_id;
  v_suma_pesos := v_suma_pesos + v_peso;

  -- Sin pesos no se reparte (no debería ocurrir: el fondo siempre suma).
  if v_suma_pesos <= 0 then
    return;
  end if;

  -- 4. Repartir entre las metas normales (topeadas), guardando peso.
  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.ambito = 'personal'
      and m.user_id = v_tx.user_id
      and m.es_fondo_emergencia = false
      and m.estado = 'en_curso'
      and m.fecha_limite >= current_date
      and (m.monto_objetivo - coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0)) > 0
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

    -- Topear en el restante; el exceso topeado irá al fondo.
    if v_asignado > v_restante then
      v_asignado := v_restante;
    end if;

    if v_asignado > 0 then
      insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
      values (r.id, v_tx.id, v_asignado, v_peso);
      v_repartido := v_repartido + v_asignado;

      -- Marcar como lograda si alcanza el objetivo.
      if (r.progreso + v_asignado) >= r.monto_objetivo then
        update public.metas set estado = 'lograda' where id = r.id;
      end if;
    end if;
  end loop;

  -- 5. El fondo recibe TODO lo no repartido a metas normales: su parte
  -- proporcional + el sobrante topeado + el resto de redondeo. Equivale a
  -- (v_total - v_repartido), lo que garantiza suma == v_total. Nunca se topea.
  select importancia into v_peso from public.metas where id = v_fondo_id;
  v_aporte_fondo := v_total - v_repartido;

  if v_aporte_fondo > 0 then
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
    values (v_fondo_id, v_tx.id, v_aporte_fondo, v_peso);
  end if;
end;
$$;

grant  execute on function public.distribuir_ahorro(uuid) to authenticated;
revoke execute on function public.distribuir_ahorro(uuid) from anon, public;


-- =====================================================================
-- 1.8 RPC distribuir_aporte_hogar(p_aporte_id)
-- ---------------------------------------------------------------------
-- Reparte la mitad de INGRESO del HOGAR de un aporte (par de
-- transacciones unidas por aporte_id: un gasto personal + un ingreso del
-- hogar) entre las metas del hogar, con el sobrante al fondo del hogar.
-- Misma lógica de pesos/tope/lograda que distribuir_ahorro.
--
-- VALIDACIÓN: debe existir la mitad personal del par y pertenecer al
-- usuario que llama (solo así puede repartir el ingreso del hogar).
-- aportes_meta.transaccion_id apunta a la transacción de INGRESO HOGAR.
-- =====================================================================

create or replace function public.distribuir_aporte_hogar(p_aporte_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ingreso      public.transacciones%rowtype;
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
  -- Validar que la mitad PERSONAL del par existe y pertenece al usuario.
  if not exists (
    select 1 from public.transacciones
    where aporte_id = p_aporte_id
      and ambito = 'personal'
      and (select auth.uid()) = user_id
  ) then
    raise exception 'No autorizado: el aporte % no pertenece al usuario o no existe', p_aporte_id;
  end if;

  -- La mitad de INGRESO del HOGAR es la que se reparte.
  select * into v_ingreso
  from public.transacciones
  where aporte_id = p_aporte_id
    and ambito = 'hogar'
    and tipo = 'ingreso'
  limit 1;
  if not found then
    raise exception 'No existe la mitad de ingreso del hogar para el aporte %', p_aporte_id;
  end if;

  v_total := v_ingreso.monto;

  -- Fondo de emergencia del hogar (siempre existe).
  select id into v_fondo_id
  from public.metas
  where es_fondo_emergencia = true
    and ambito = 'hogar'
  limit 1;
  if v_fondo_id is null then
    raise exception 'No existe fondo de emergencia del hogar';
  end if;

  -- Suma de pesos de las metas normales del hogar candidatas.
  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.ambito = 'hogar'
      and m.user_id is null
      and m.es_fondo_emergencia = false
      and m.estado = 'en_curso'
      and m.fecha_limite >= current_date
      and (m.monto_objetivo - coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0)) > 0
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
    v_suma_pesos := v_suma_pesos + v_peso;
  end loop;

  -- Peso del fondo del hogar (solo importancia).
  select importancia into v_peso from public.metas where id = v_fondo_id;
  v_suma_pesos := v_suma_pesos + v_peso;

  if v_suma_pesos <= 0 then
    return;
  end if;

  -- Repartir entre las metas normales del hogar (topeadas).
  for r in
    select m.id, m.importancia, m.horizonte, m.fecha_limite, m.monto_objetivo,
           coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0) as progreso
    from public.metas m
    where m.ambito = 'hogar'
      and m.user_id is null
      and m.es_fondo_emergencia = false
      and m.estado = 'en_curso'
      and m.fecha_limite >= current_date
      and (m.monto_objetivo - coalesce((select sum(a.monto) from public.aportes_meta a where a.meta_id = m.id), 0)) > 0
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
      insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
      values (r.id, v_ingreso.id, v_asignado, v_peso);
      v_repartido := v_repartido + v_asignado;

      if (r.progreso + v_asignado) >= r.monto_objetivo then
        update public.metas set estado = 'lograda' where id = r.id;
      end if;
    end if;
  end loop;

  -- El fondo del hogar recibe el resto (su parte + sobrante topeado +
  -- resto de redondeo). Nunca se topea; cuadra la suma a v_total.
  select importancia into v_peso from public.metas where id = v_fondo_id;
  v_aporte_fondo := v_total - v_repartido;

  if v_aporte_fondo > 0 then
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
    values (v_fondo_id, v_ingreso.id, v_aporte_fondo, v_peso);
  end if;
end;
$$;

grant  execute on function public.distribuir_aporte_hogar(uuid) to authenticated;
revoke execute on function public.distribuir_aporte_hogar(uuid) from anon, public;
