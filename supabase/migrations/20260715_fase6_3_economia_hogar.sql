-- supabase/migrations/20260715_fase6_3_economia_hogar.sql
-- Fase 6.3 (correctiva) — el hogar deja de tener ingresos propios.
-- SOLO v2. Afecta 5 filas de producción (verificadas 2026-07-14). Reversible
-- vía las tablas _backup_fase63_*. NO aplicar sin revisión manual del SQL.
--
-- ⚠ SECUENCIA DE DEPLOY: esta migración y el rewrite de js/db.js + las vistas
-- (Fase 6.3, tareas posteriores del plan) deben llegar a producción en la
-- MISMA ventana. Tras aplicar esta migración, insertAporteHogar() (js/db.js,
-- versión vieja) queda rota: inserta ambito='hogar' tipo='ingreso' (bloqueado
-- por el CHECK tx_hogar_sin_ingreso de abajo), usa la columna aporte_id
-- (renombrada a grupo_id) y llama a distribuir_aporte_hogar (borrada en el
-- paso 8). Si el frontend desplegado sigue siendo el viejo cuando esto se
-- aplica, "aportar al hogar" falla para cualquier usuario real hasta que el
-- frontend nuevo se despliegue. Aplicar cuando se pueda seguir de inmediato
-- con el resto de tareas hasta el push a v2, sin demora entre medio.

begin;

-- ── 0. Respaldo para rollback ─────────────────────────────────────────
-- Cubre las FILAS de datos tocadas (transacciones + aportes_meta relacionados).
-- NO cubre definiciones de esquema: el rename aporte_id→grupo_id (paso 3) y
-- la función distribuir_aporte_hogar borrada (paso 8) no tienen snapshot acá
-- — para revertir esas dos cosas, la definición de distribuir_aporte_hogar
-- vive en supabase/migrations/20260608_aportes_directos.sql (git history),
-- y el rename se revierte con un ALTER TABLE ... RENAME COLUMN inverso.
create table if not exists public._backup_fase63_transacciones as
  select * from public.transacciones where ambito = 'hogar' or aporte_id is not null;
create table if not exists public._backup_fase63_aportes_meta as
  select * from public.aportes_meta
  where transaccion_id in (select id from public._backup_fase63_transacciones);

commit;

-- ── 1. Colapsar los pares aporte_id en una sola fila de ahorro ────────
-- Conserva el id de la pata-ingreso ⇒ aportes_meta.transaccion_id sigue
-- válido, el reparto a metas ya hecho no se toca.
begin;

-- El trigger trg_sync_hogar_id_tx exige auth.uid() no-null en cada UPDATE de
-- una fila ambito='hogar' (re-estampa hogar_id); en el contexto de migración
-- (sin sesión JWT) auth.uid() es null y el trigger abortaría. Estas filas ya
-- tienen ambito='hogar' y no lo cambian, así que se desactiva el trigger
-- solo para este UPDATE puntual (no toca la semántica de hogar_id).
alter table public.transacciones disable trigger trg_sync_hogar_id_tx;

update public.transacciones
   set tipo = 'ahorro', categoria_id = null, aporte_id = null
 where aporte_id is not null and ambito = 'hogar' and tipo = 'ingreso';

alter table public.transacciones enable trigger trg_sync_hogar_id_tx;

delete from public.transacciones
 where aporte_id is not null and ambito = 'personal' and tipo = 'gasto';

commit;

-- ── 2. Fila huérfana (S/200, 22-jun-2026): aporte real → ahorro + reparto ──
begin;

alter table public.transacciones disable trigger trg_sync_hogar_id_tx;

update public.transacciones
   set tipo = 'ahorro', categoria_id = null
 where id = 'a6fe851a-ac7e-4d2f-bd02-8e6ad0ee046d';

alter table public.transacciones enable trigger trg_sync_hogar_id_tx;

commit;

-- distribuir_ahorro hace sus propios inserts; fuera de la transacción anterior
-- por si la RPC abre su propio manejo de errores (idéntico a como se invoca
-- desde db.js: best-effort, no debe abortar la migración si falla).
-- Guardia de idempotencia: distribuir_ahorro no tiene protección propia
-- contra re-ejecución (inserta aportes_meta sin marca de "ya repartido"), y
-- este proyecto tiene migraciones re-aplicadas a mano por el SQL Editor
-- documentado como riesgo real (ver CLAUDE.md). Sin este guard, correr este
-- archivo dos veces duplicaría el aporte de S/200 a las metas del hogar.
do $$
begin
  if not exists (
    select 1 from public.aportes_meta where transaccion_id = 'a6fe851a-ac7e-4d2f-bd02-8e6ad0ee046d'::uuid
  ) then
    perform public.distribuir_ahorro('a6fe851a-ac7e-4d2f-bd02-8e6ad0ee046d'::uuid);
  end if;
exception when others then
  raise notice 'distribuir_ahorro sobre la fila huérfana falló: %', sqlerrm;
end $$;

-- ── 3. aporte_id → grupo_id (0 filas lo usan tras el paso 1) ──────────
-- No idempotente a propósito (RENAME COLUMN falla en un re-run, a diferencia
-- del guard if-not-exists del paso 5): aplicar SIEMPRE con apply_migration
-- (queda registrada en el ledger, CLAUDE.md), nunca por el SQL Editor a
-- mano — así el ledger sí es confiable para ESTA migración puntual y un
-- re-run accidental no debería ocurrir.
begin;

alter table public.transacciones rename column aporte_id to grupo_id;
alter index if exists idx_transacciones_aporte_id rename to idx_transacciones_grupo_id;

commit;

-- ── 4. Blindar la ficción: ambito=hogar + tipo=ingreso es ilegal ──────
begin;

alter table public.transacciones
  add constraint tx_hogar_sin_ingreso
  check (not (ambito = 'hogar' and tipo = 'ingreso'));

commit;

-- ── 5. hogares.reparto (nunca existió en prod — Fase 6.2 no se aplicó) ──
-- Idempotente frente a la tarea paralela que también puede crear esta
-- columna: add column if not exists + constraint guardada por nombre.
begin;

alter table public.hogares
  add column if not exists reparto text not null default '50_50';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'hogares_reparto_check' and conrelid = 'public.hogares'::regclass
  ) then
    alter table public.hogares
      add constraint hogares_reparto_check check (reparto in ('50_50','proporcional'));
  end if;
end $$;

create or replace function public.set_reparto_hogar(p_modo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_hogar uuid := public.auth_hogar_id();
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  if p_modo not in ('50_50','proporcional') then raise exception 'Modo inválido'; end if;
  update public.hogares set reparto = p_modo where id = v_hogar;
end; $$;

grant  execute on function public.set_reparto_hogar(text) to authenticated;
revoke execute on function public.set_reparto_hogar(text) from anon, public;

commit;

-- ── 6. registrar_gasto_hogar — inserta N filas hermanas (el split) ────
begin;

create or replace function public.registrar_gasto_hogar(
  p_grupo_id     uuid,
  p_fecha        date,
  p_categoria_id uuid,
  p_nota         text,
  p_partes       jsonb   -- [{"user_id": "...", "monto": 123.45}, ...]
)
returns setof public.transacciones
language plpgsql security definer set search_path = public as $$
declare
  v_hogar    uuid := public.auth_hogar_id();
  v_count    int;
  v_distinct int;
  v_miembros int;
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;

  -- Idempotencia: si el grupo ya existe (replay de la outbox), devolverlo
  -- sin re-insertar.
  if exists (select 1 from public.transacciones where grupo_id = p_grupo_id) then
    return query select * from public.transacciones where grupo_id = p_grupo_id;
    return;
  end if;

  if p_partes is null or jsonb_typeof(p_partes) <> 'array' or jsonb_array_length(p_partes) = 0 then
    raise exception 'Debe haber al menos una parte';
  end if;

  select count(*), count(distinct (elem->>'user_id')::uuid)
    into v_count, v_distinct
    from jsonb_array_elements(p_partes) elem;
  if v_count <> v_distinct then
    raise exception 'Un miembro no puede tener dos partes';
  end if;

  select count(*) into v_miembros
    from jsonb_array_elements(p_partes) elem
    join public.hogar_miembros hm
      on hm.user_id = (elem->>'user_id')::uuid and hm.hogar_id = v_hogar;
  if v_miembros <> v_count then
    raise exception 'Todas las partes deben ser miembros de tu hogar';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_partes) elem
    where not ((elem->>'monto')::numeric > 0)
  ) then
    raise exception 'Cada parte debe ser mayor que 0';
  end if;

  insert into public.transacciones (id, fecha, tipo, ambito, user_id, categoria_id, monto, nota, grupo_id)
  select gen_random_uuid(), coalesce(p_fecha, current_date), 'gasto', 'hogar',
         (elem->>'user_id')::uuid, p_categoria_id, (elem->>'monto')::numeric, p_nota, p_grupo_id
  from jsonb_array_elements(p_partes) elem;

  return query select * from public.transacciones where grupo_id = p_grupo_id;
end;
$$;

grant  execute on function public.registrar_gasto_hogar(uuid, date, uuid, text, jsonb) to authenticated;
revoke execute on function public.registrar_gasto_hogar(uuid, date, uuid, text, jsonb) from anon, public;

commit;

-- ── 7. borrar_gasto_hogar — borra todas las filas hermanas del grupo ──
-- Necesario porque transacciones_delete exige auth.uid()=user_id: A no
-- puede borrar la fila de B directamente.
begin;

create or replace function public.borrar_gasto_hogar(p_grupo_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_hogar uuid := public.auth_hogar_id();
  v_n     int;
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  select count(*) into v_n from public.transacciones where grupo_id = p_grupo_id and hogar_id = v_hogar;
  if v_n = 0 then raise exception 'El grupo % no existe en tu hogar', p_grupo_id; end if;
  delete from public.transacciones where grupo_id = p_grupo_id and hogar_id = v_hogar;
end;
$$;

grant  execute on function public.borrar_gasto_hogar(uuid) to authenticated;
revoke execute on function public.borrar_gasto_hogar(uuid) from anon, public;

commit;

-- ── 8. Borrar distribuir_aporte_hogar (RPC de la ficción, ya sin uso) ──
-- Repartía la pata-ingreso-hogar del viejo par aporte_id (paso 1). Con la
-- ficción eliminada, "ahorro al hogar" es una fila tipo='ahorro' normal y
-- ya usa distribuir_ahorro (misma función que el ahorro personal) — no
-- necesita una copia especializada.
begin;

drop function if exists public.distribuir_aporte_hogar(uuid);

commit;

-- ── 9. disolver_hogar — reparte por ahorro real, informa el desequilibrio aparte ──
-- Antes: repartía por % de ingresos-hogar (ya no existen) y guardaba una
-- liquidación final en hogar_liquidaciones que nadie podía leer jamás
-- (tras disolver, auth_hogar_id() da null para ambos y la fila cae fuera
-- de RLS). Ahora: el ahorro se reparte por identidad (cada quien recupera
-- lo que puso) y el desequilibrio de gastos se informa en el jsonb de
-- retorno para que la UI lo muestre — no se cobra ni se inserta liquidación.
begin;

create or replace function public.disolver_hogar()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_hogar   uuid := public.auth_hogar_id();
  v_creador uuid;
  v_otro    uuid;
  v_ahorro_creador numeric := 0;
  v_ahorro_otro    numeric := 0;
  v_pago_creador   numeric := 0;
  v_pago_otro      numeric := 0;
  v_liq_otro_a_creador   numeric := 0;
  v_liq_creador_a_otro   numeric := 0;
  v_neto    numeric;
  v_brecha  numeric := 0;
  v_debe_mas uuid;
  v_ya_mas   uuid;
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  select creado_por into v_creador from public.hogares where id = v_hogar;
  select user_id into v_otro from public.hogar_miembros where hogar_id = v_hogar and user_id <> v_creador limit 1;

  select coalesce(sum(monto),0) into v_ahorro_creador from public.transacciones
    where hogar_id = v_hogar and ambito='hogar' and tipo='ahorro' and user_id = v_creador;
  select coalesce(sum(monto),0) into v_pago_creador from public.transacciones
    where hogar_id = v_hogar and ambito='hogar' and tipo='gasto' and user_id = v_creador;

  -- v_otro null (hogar de 1 solo miembro): el bloque de desequilibrio se
  -- salta entero; v_brecha/v_debe_mas/v_ya_mas quedan en sus defaults
  -- (0/null/null) y se reportan así, sin dividir por cero ni fallar.
  if v_otro is not null then
    select coalesce(sum(monto),0) into v_ahorro_otro from public.transacciones
      where hogar_id = v_hogar and ambito='hogar' and tipo='ahorro' and user_id = v_otro;
    select coalesce(sum(monto),0) into v_pago_otro from public.transacciones
      where hogar_id = v_hogar and ambito='hogar' and tipo='gasto' and user_id = v_otro;

    -- Desequilibrio 50/50 (mismo cálculo que calcularDesequilibrioHogar,
    -- objetivo 50/50), neteado contra pagos en efectivo ya registrados.
    v_neto := v_pago_creador - (v_pago_creador + v_pago_otro) / 2;
    select coalesce(sum(monto),0) into v_liq_otro_a_creador from public.hogar_liquidaciones
      where hogar_id = v_hogar and de_user = v_otro and a_user = v_creador;
    select coalesce(sum(monto),0) into v_liq_creador_a_otro from public.hogar_liquidaciones
      where hogar_id = v_hogar and de_user = v_creador and a_user = v_otro;
    v_neto := v_neto - v_liq_otro_a_creador + v_liq_creador_a_otro;
    v_neto := round(v_neto, 2);
    v_brecha := abs(v_neto);
    if v_neto > 0 then v_debe_mas := v_otro; v_ya_mas := v_creador;
    elsif v_neto < 0 then v_debe_mas := v_creador; v_ya_mas := v_otro;
    end if;
  end if;

  -- reasignar aportes de esas metas al creador (antes de soltar el hogar_id)
  update public.aportes_meta set user_id = v_creador
   where meta_id in (select id from public.metas where hogar_id = v_hogar and ambito = 'hogar');

  -- reasignar metas/fondo de hogar al creador como personales
  update public.metas set ambito='personal', hogar_id=null, user_id=v_creador
    where hogar_id = v_hogar and ambito='hogar';

  -- borrar membresías (las transacciones conservan hogar_id como historial)
  delete from public.hogar_miembros where hogar_id = v_hogar;

  return jsonb_build_object(
    'ahorro_creador', v_ahorro_creador,
    'ahorro_otro', v_ahorro_otro,
    'desequilibrio_brecha', v_brecha,
    'desequilibrio_debe_aportar_mas', v_debe_mas,
    'desequilibrio_ya_aporto_de_mas', v_ya_mas
  );
end;
$$;

commit;
