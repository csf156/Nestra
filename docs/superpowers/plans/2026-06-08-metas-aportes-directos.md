# Metas — Aportes directos, felicitación y confirmación de borrado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir aportes que van 100% a una meta (excedente al fondo), reemplazar el marcado manual de "lograda" por un panel de felicitación con confirmación del usuario, y exigir confirmación en modal para eliminar metas. Los aportes directos aparecen como gasto en el historial pero no son editables (solo borrables).

**Architecture:** Una RPC atómica `aporte_directo_meta` (SECURITY DEFINER) crea el gasto en categoría Ahorro + el/los `aportes_meta` sin disparar el reparto por peso. Se quita el auto-marcado de `estado='lograda'` de las RPC de reparto para que la meta llena espere la confirmación del usuario en la UI. Nueva columna `transacciones.es_aporte_directo` marca estas transacciones para bloquear su edición en historial.

**Tech Stack:** PostgreSQL/Supabase (plpgsql RPCs, RLS), Vanilla JS (IIFE en vistas), db.js como capa de acceso. Sin framework de tests — verificación SQL en el editor de Supabase + harness de stubs en navegador (preview_*).

**Reference spec:** `docs/superpowers/specs/2026-06-08-metas-aportes-directos-design.md`

**Convenciones verificadas (código vivo):**
- `aportes_meta`: `{ id, meta_id, transaccion_id NOT NULL, monto > 0, peso_aplicado, created_at }`. Cascade-delete por meta y por transacción. RLS hereda acceso de la meta.
- `metas_con_progreso.monto_actual = SUM(aportes_meta.monto)`.
- `transacciones`: `{ fecha, tipo, ambito, user_id, categoria_id, monto, nota, aporte_id, created_at }`. Categoría "Ahorro" = compartida, `tipo='gasto'`, por nombre.
- Fondo: `metas` con `es_fondo_emergencia=true` (uno personal por usuario `user_id`, uno de hogar `user_id IS NULL`). Sin objetivo. Nunca topeado.
- `distribuir_ahorro` y `distribuir_aporte_hogar` (migración `20260606_metas_automaticas.sql`) reparten por peso, topean cada meta, vuelcan sobrante al fondo, y HOY auto-marcan `estado='lograda'` (bloques a eliminar).
- db.js: `getMetas`, `insertMeta`, `updateMeta`, `deleteMeta`, `getCategorias`, `insertTransaccion`→`_distribuirSiAhorro`, `_reDistribuirAhorro`. `getTransacciones` usa `select('*, categorias(...)')`.
- `views/metas.html`: IIFE con `cargar`, `renderActivas`, `renderCompletadas`, delegación `data-act` (aporte/lograda/eliminar), `registrarAporte` (abre modal global), `marcarLograda`, `eliminarMeta` (toast-undo con `borradoPendiente`), `mostrarToast(msg,label,cb,ms)`, `_hoyISO()`, `formatMonto` global.
- `views/historial.html`: `cardTx`/`rowTx` ocultan "Editar" si `d.aporte` (aporte_id); `abrirEdicion(id)` (≈línea 1088) hace `if (!tx || tx.aporte_id) return;`. Borrado por modal `histDeleteModal`.

---

## File Structure

| File | Change |
|---|---|
| `supabase/migrations/20260608_aportes_directos.sql` | **Nuevo** — columna `es_aporte_directo`; `create or replace` de `distribuir_ahorro` y `distribuir_aporte_hogar` SIN auto-lograda; nueva RPC `aporte_directo_meta` |
| `js/db.js` | **Modificar** — `insertAporteDirecto`; guard defensivo en `_distribuirSiAhorro` |
| `views/metas.html` | **Modificar** — markup mini-modal aporte + modal confirmación borrado + CSS; panel felicitación; `registrarAporte` reescrito; `confirmarLograda`; quitar botón "lograda"; `eliminarMeta` con modal |
| `views/historial.html` | **Modificar** — `es_aporte_directo` no editable (+ badge informativo) |

---

### Task 1: Migración SQL — columna + RPCs sin auto-lograda + RPC de aporte directo

**Files:**
- Create: `supabase/migrations/20260608_aportes_directos.sql`

- [ ] **Step 1: Crear la migración**

```sql
-- =====================================================================
-- Nestra — Migración: aportes directos a metas (SESIÓN 8)
-- ---------------------------------------------------------------------
--   * Nueva columna transacciones.es_aporte_directo: marca los gastos
--     generados por un aporte 100% a una meta (no editables en historial).
--   * aporte_directo_meta(): RPC atómica que crea el gasto en Ahorro y
--     asigna el monto íntegro a la meta; el excedente sobre el objetivo
--     va al fondo de emergencia del ámbito de la meta. NO reparte por peso.
--   * Se RETIRA el auto-marcado estado='lograda' de distribuir_ahorro y
--     distribuir_aporte_hogar: la meta llena queda en_curso hasta que el
--     usuario confirme la felicitación en la UI. (El filtro restante>0 ya
--     evita sobre-financiarla aunque siga en_curso.)
-- Migración ADITIVA e idempotente. Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

-- 1. Columna marca de aporte directo.
alter table public.transacciones
  add column if not exists es_aporte_directo boolean not null default false;


-- =====================================================================
-- 2. distribuir_ahorro SIN auto-lograda (resto idéntico al original).
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
  select * into v_tx from public.transacciones where id = p_transaccion_id;
  if not found then
    raise exception 'Transacción % no existe', p_transaccion_id;
  end if;
  if (select auth.uid()) <> v_tx.user_id then
    raise exception 'No autorizado: la transacción no pertenece al usuario';
  end if;

  v_total := v_tx.monto;

  select id into v_fondo_id
  from public.metas
  where es_fondo_emergencia = true
    and ambito = 'personal'
    and user_id = v_tx.user_id
  limit 1;
  if v_fondo_id is null then
    raise exception 'El usuario no tiene fondo de emergencia personal';
  end if;

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

  select importancia into v_peso from public.metas where id = v_fondo_id;
  v_suma_pesos := v_suma_pesos + v_peso;

  if v_suma_pesos <= 0 then
    return;
  end if;

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

    if v_asignado > v_restante then
      v_asignado := v_restante;
    end if;

    if v_asignado > 0 then
      insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
      values (r.id, v_tx.id, v_asignado, v_peso);
      v_repartido := v_repartido + v_asignado;
      -- (auto-marcado de 'lograda' RETIRADO intencionalmente)
    end if;
  end loop;

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
-- 3. distribuir_aporte_hogar SIN auto-lograda (resto idéntico al original).
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
  if not exists (
    select 1 from public.transacciones
    where aporte_id = p_aporte_id
      and ambito = 'personal'
      and (select auth.uid()) = user_id
  ) then
    raise exception 'No autorizado: el aporte % no pertenece al usuario o no existe', p_aporte_id;
  end if;

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

  select id into v_fondo_id
  from public.metas
  where es_fondo_emergencia = true
    and ambito = 'hogar'
  limit 1;
  if v_fondo_id is null then
    raise exception 'No existe fondo de emergencia del hogar';
  end if;

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

  select importancia into v_peso from public.metas where id = v_fondo_id;
  v_suma_pesos := v_suma_pesos + v_peso;

  if v_suma_pesos <= 0 then
    return;
  end if;

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
      -- (auto-marcado de 'lograda' RETIRADO intencionalmente)
    end if;
  end loop;

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


-- =====================================================================
-- 4. aporte_directo_meta — aporte 100% a una meta (excedente al fondo).
-- ---------------------------------------------------------------------
-- Atómica: crea el gasto en Ahorro (es_aporte_directo=true) y el/los
-- aportes_meta. NO reparte por peso. NO marca 'lograda'. Topea la meta
-- en su restante; el excedente va al fondo de emergencia del ÁMBITO de
-- la meta (personal del usuario, o del hogar). Un fondo recibe todo sin
-- topear. peso_aplicado queda NULL (marca de "no repartido por peso").
-- SEGURIDAD: SECURITY DEFINER; valida acceso a la meta (propia o hogar).
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
  v_cat_ahorro uuid;
  v_tx_id      uuid;
  v_progreso   numeric(10,2);
  v_restante   numeric(10,2);
  v_a_meta     numeric(10,2);
  v_a_fondo    numeric(10,2);
  v_fondo_id   uuid;
begin
  -- 1. Validar monto.
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del aporte debe ser mayor que 0';
  end if;

  -- 2. Cargar la meta y validar acceso.
  select * into v_meta from public.metas where id = p_meta_id;
  if not found then
    raise exception 'La meta % no existe', p_meta_id;
  end if;
  if not (v_meta.ambito = 'hogar' or v_meta.user_id = v_uid) then
    raise exception 'No autorizado: la meta no pertenece al usuario';
  end if;

  -- 3. Categoría Ahorro (compartida, tipo gasto).
  select id into v_cat_ahorro
  from public.categorias
  where nombre = 'Ahorro' and tipo = 'gasto'
  limit 1;
  if v_cat_ahorro is null then
    raise exception 'No existe la categoría Ahorro';
  end if;

  -- 4. Insertar el gasto personal del usuario, marcado como aporte directo.
  insert into public.transacciones
    (fecha, tipo, ambito, user_id, categoria_id, monto, nota, es_aporte_directo)
  values
    (coalesce(p_fecha, current_date), 'gasto', 'personal', v_uid, v_cat_ahorro, p_monto, p_nota, true)
  returning id into v_tx_id;

  -- 5. Progreso actual de la meta.
  select coalesce(sum(a.monto), 0) into v_progreso
  from public.aportes_meta a where a.meta_id = p_meta_id;

  -- Fondo o meta sin objetivo → todo a la meta, sin overflow.
  if v_meta.es_fondo_emergencia or v_meta.monto_objetivo is null then
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
    values (p_meta_id, v_tx_id, p_monto, null);
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
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
    values (p_meta_id, v_tx_id, v_a_meta, null);
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
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
    values (v_fondo_id, v_tx_id, v_a_fondo, null);
  end if;

  return v_tx_id;
end;
$$;

grant  execute on function public.aporte_directo_meta(uuid, numeric, date, text) to authenticated;
revoke execute on function public.aporte_directo_meta(uuid, numeric, date, text) from anon, public;
```

- [ ] **Step 2: Aplicar y verificar en el SQL Editor de Supabase**

Ejecutar el archivo completo en el SQL Editor. Debe terminar sin error. Luego verificar la columna y las funciones:

```sql
-- columna existe
select column_name from information_schema.columns
where table_name='transacciones' and column_name='es_aporte_directo';
-- esperado: 1 fila

-- el auto-lograda ya NO está en el cuerpo de las RPC
select count(*) as ocurrencias from pg_proc
where proname in ('distribuir_ahorro','distribuir_aporte_hogar')
  and prosrc ilike '%set estado = ''lograda''%';
-- esperado: 0

-- la nueva RPC existe
select proname from pg_proc where proname = 'aporte_directo_meta';
-- esperado: 1 fila
```

- [ ] **Step 3: Prueba funcional de la RPC (SQL Editor, con una sesión real)**

Con un usuario autenticado en el SQL Editor (rol `authenticated`), elegir una meta normal con restante conocido y probar overflow:

```sql
-- tomar una meta normal en curso con restante pequeño
select id, nombre, monto_objetivo,
       coalesce((select sum(monto) from aportes_meta a where a.meta_id=m.id),0) as progreso
from metas m where es_fondo_emergencia=false and estado='en_curso' limit 5;

-- aportar un monto que supere el restante; sustituir <META_ID> y <MONTO>
select aporte_directo_meta('<META_ID>'::uuid, <MONTO>, current_date, 'prueba directa');

-- verificar: la meta quedó topeada en su objetivo y el excedente fue al fondo
select m.nombre, m.es_fondo_emergencia,
       sum(a.monto) filter (where a.transaccion_id = (select max(id) from transacciones where es_aporte_directo)) as ult_aporte
from metas m join aportes_meta a on a.meta_id=m.id
group by m.id, m.nombre, m.es_fondo_emergencia
order by ult_aporte desc nulls last;
-- esperado: la meta recibió su restante; el fondo recibió el excedente
```

(Si se desea, borrar la transacción de prueba: `delete from transacciones where nota='prueba directa';` — el cascade revierte los aportes.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260608_aportes_directos.sql
git commit -m "feat(db): direct goal contributions RPC + remove auto-lograda from distribution"
```

---

### Task 2: db.js — `insertAporteDirecto` + guard defensivo

**Files:**
- Modify: `js/db.js` (añadir `insertAporteDirecto` en la sección METAS; guard en `_distribuirSiAhorro`)

- [ ] **Step 1: Añadir `insertAporteDirecto`**

Insertar tras `deleteMeta` (final de la sección METAS, antes del siguiente bloque de comentario de sección):

```js
// insertAporteDirecto(meta_id, monto, fecha, nota) — aporte 100% a una meta.
// Vía RPC atómica aporte_directo_meta: crea un gasto en categoría Ahorro
// marcado como aporte directo y lo asigna íntegro a la meta; el excedente
// sobre el objetivo va al fondo de emergencia del ámbito de la meta. NO
// dispara el reparto por peso ni marca la meta como lograda.
// Returns: id (uuid) de la transacción creada. Lanza Error en fallo.
async function insertAporteDirecto(meta_id, monto, fecha, nota) {
  try {
    const { data, error } = await supabase.rpc('aporte_directo_meta', {
      p_meta_id: meta_id,
      p_monto: monto,
      p_fecha: fecha || null,
      p_nota: nota || null,
    });
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error en insertAporteDirecto():', err.message || err);
    throw err;
  }
}
```

- [ ] **Step 2: Guard defensivo en `_distribuirSiAhorro`**

En `js/db.js`, en la función `_distribuirSiAhorro(tx)` (≈línea 144), añadir al inicio del `try` (antes de `const cats = ...`):

```js
    // Los aportes directos ya asignan su monto a mano; nunca se reparten.
    if (tx && tx.es_aporte_directo) return;
```

- [ ] **Step 3: Verificar sintaxis**

`preview_start` (o recargar). `preview_eval`:
```js
(async function(){
  var src = await (await fetch('js/db.js')).text();
  try { new Function(src); } catch(e){ return {parse:'SyntaxError', message:String(e)}; }
  return { hasFn: /async function insertAporteDirecto\(/.test(src),
           hasGuard: /tx\.es_aporte_directo/.test(src) };
})()
```
Esperado: `{ hasFn:true, hasGuard:true }`, sin SyntaxError.

- [ ] **Step 4: Commit**

```bash
git add js/db.js
git commit -m "feat(db): insertAporteDirecto helper + skip-distribution guard"
```

---

### Task 3: metas.html — markup (mini-modal aporte + modal borrado) + CSS

**Files:**
- Modify: `views/metas.html` (markup tras el modal de alta; CSS en el `<style>`)

- [ ] **Step 1: Añadir el markup de los dos modales**

En `views/metas.html`, inmediatamente DESPUÉS del bloque `<!-- Toast -->` ... `</div>` (cierre del div con id `metasToast`) y ANTES del `</div>` final de `.metas`, insertar:

```html
  <!-- Mini-modal: aporte directo a meta -->
  <div class="metas-modal-overlay" id="aporteModal" role="dialog" aria-modal="true" aria-labelledby="aporteModalTitle" hidden>
    <div class="metas-modal">
      <h2 class="metas-modal-title" id="aporteModalTitle">Registrar aporte</h2>
      <p class="metas-aporte-meta" id="aporteMetaNombre"></p>
      <form id="aporteForm" class="metas-form">
        <label class="metas-flabel">Monto
          <div class="metas-monto"><span aria-hidden="true">S/</span>
            <input class="metas-input" id="aMonto" type="text" inputmode="decimal" placeholder="0.00" />
          </div>
        </label>
        <label class="metas-flabel">Fecha
          <input class="metas-input" id="aFecha" type="date" />
        </label>
        <label class="metas-flabel">Nota (opcional)
          <textarea class="metas-input" id="aNota" rows="2"></textarea>
        </label>
        <p class="metas-form-error" id="aporteError" role="alert" hidden></p>
        <div class="metas-modal-actions">
          <button type="button" class="btn btn-secondary" id="aporteCancelar">Cancelar</button>
          <button type="submit" class="btn btn-primary">Aportar</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Modal: confirmar borrado de meta -->
  <div class="metas-modal-overlay" id="delMetaModal" role="dialog" aria-modal="true" aria-labelledby="delMetaTitle" hidden>
    <div class="metas-modal metas-modal--confirm">
      <h2 class="metas-modal-title" id="delMetaTitle">Eliminar meta</h2>
      <p class="metas-confirm-body" id="delMetaBody"></p>
      <div class="metas-modal-actions">
        <button type="button" class="btn btn-secondary" id="delMetaCancelar">Cancelar</button>
        <button type="button" class="btn btn-danger" id="delMetaConfirmar">Eliminar</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Añadir CSS**

En el `<style>` de `views/metas.html`, antes de la media query `@media (prefers-reduced-motion: reduce)`, añadir:

```css
  .metas-aporte-meta { color: var(--text-secondary); font-size: var(--font-size-sm); margin: 0 0 var(--space-md); }
  .metas-modal--confirm { max-width: 420px; }
  .metas-confirm-body { color: var(--text-dark); font-size: var(--font-size-base); margin: 0 0 var(--space-lg); }

  .meta-card--lograda { border-left-color: var(--color-success); background: rgba(16,185,129,0.06); }
  .meta-felicita { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--space-sm); padding: var(--space-md) 0; }
  .meta-felicita-icono { font-size: 2.5rem; line-height: 1; }
  .meta-felicita-titulo { font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--color-success); margin: 0; }
  .meta-felicita-nombre { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); color: var(--text-dark); margin: 0; }
  .meta-felicita-monto { color: var(--text-secondary); font-size: var(--font-size-sm); margin: 0 0 var(--space-sm); }
  .meta-felicita .btn { min-width: 160px; }
```

(`--color-success` ya se usa en este archivo, ej. en la lista de completadas.)

- [ ] **Step 3: Verificar que el markup parsea y los nodos existen**

`preview_eval`:
```js
(async function(){
  var d=document.createElement('div');
  d.innerHTML=await (await fetch('views/metas.html')).text();
  return {
    aporteModal:!!d.querySelector('#aporteModal'),
    aMonto:!!d.querySelector('#aMonto'),
    aporteForm:!!d.querySelector('#aporteForm'),
    delModal:!!d.querySelector('#delMetaModal'),
    delConfirm:!!d.querySelector('#delMetaConfirmar'),
    delBody:!!d.querySelector('#delMetaBody')
  };
})()
```
Esperado: todos `true`.

- [ ] **Step 4: Commit**

```bash
git add views/metas.html
git commit -m "feat(metas): markup + styles for direct-contribution and delete-confirm modals"
```

---

### Task 4: metas.html — aporte directo (mini-modal en vez del modal global)

**Files:**
- Modify: `views/metas.html` (`<script>` IIFE: cache de metas, reescribir `registrarAporte`, wiring del form de aporte)

- [ ] **Step 1: Cachear las metas cargadas**

En la IIFE, localizar `async function cargar()`. Añadir una variable de módulo y guardar el resultado. Cambiar:

```js
    async function cargar() {
      var metas = await getMetas();
      var activas = (metas || []).filter(function (m) { return m.estado === 'en_curso' || m.estado === 'vencida'; });
      var completadas = (metas || []).filter(function (m) { return m.estado === 'lograda'; });
      renderActivas(activas);
      renderCompletadas(completadas);
    }
```
por:
```js
    var _metas = [];
    async function cargar() {
      var metas = await getMetas();
      _metas = metas || [];
      var activas = _metas.filter(function (m) { return m.estado === 'en_curso' || m.estado === 'vencida'; });
      var completadas = _metas.filter(function (m) { return m.estado === 'lograda'; });
      renderActivas(activas);
      renderCompletadas(completadas);
    }
    function _metaPorId(id) { return _metas.filter(function (m) { return String(m.id) === String(id); })[0]; }
```

- [ ] **Step 2: Reescribir `registrarAporte` para abrir el mini-modal**

Reemplazar la función actual:
```js
    function registrarAporte() {
      mostrarToast('Elige la categoría Ahorro para aportar.', null, null, 3500);
      if (typeof abrirModalTransaccion === 'function') abrirModalTransaccion();
      else window.location.hash = '#transaccion';
    }
```
por:
```js
    var aportePendiente = null;
    function registrarAporte(id) {
      var m = _metaPorId(id);
      if (!m) return;
      aportePendiente = id;
      $('aporteMetaNombre').textContent = 'Aporte a: ' + m.nombre;
      $('aporteError').hidden = true;
      $('aMonto').value = '';
      $('aNota').value = '';
      $('aFecha').value = _hoyISO();
      $('aporteModal').hidden = false;
      setTimeout(function () { $('aMonto').focus(); }, 50);
    }
```

(Nota: `registrarAporte` ahora recibe `id`; la delegación se ajusta en la Task 5.)

- [ ] **Step 3: Wiring del form de aporte y del botón Cancelar**

Añadir dentro de la IIFE (junto al resto de listeners, ej. tras el listener de `metaCancelar`):

```js
    $('aporteCancelar').addEventListener('click', function () { $('aporteModal').hidden = true; aportePendiente = null; });
    $('aporteModal').addEventListener('click', function (e) { if (e.target === e.currentTarget) { $('aporteModal').hidden = true; aportePendiente = null; } });
    $('aporteForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = $('aporteError');
      function _err(msg) { err.textContent = msg; err.hidden = false; }
      if (!aportePendiente) return;
      var monto = parseFloat(String($('aMonto').value).replace(',', '.'));
      if (!(monto > 0)) { return _err('El monto debe ser mayor que 0.'); }
      var fecha = $('aFecha').value || _hoyISO();
      var nota = $('aNota').value.trim() || null;
      try {
        await insertAporteDirecto(aportePendiente, monto, fecha, nota);
        $('aporteModal').hidden = true;
        aportePendiente = null;
        mostrarToast('Aporte registrado', null, null, 3000);
        cargar();
      } catch (e2) {
        _err('No se pudo registrar el aporte. Reintenta.');
      }
    });
```

- [ ] **Step 4: Verificar (harness integral en Task 7)** — placeholder; se valida en la verificación integral.

- [ ] **Step 5: Commit**

```bash
git add views/metas.html
git commit -m "feat(metas): direct contribution via dedicated mini-modal"
```

---

### Task 5: metas.html — panel de felicitación + confirmar lograda + quitar botón manual

**Files:**
- Modify: `views/metas.html` (`renderActivas`, delegación de acciones, `marcarLograda`→`confirmarLograda`)

- [ ] **Step 1: Añadir detección de meta alcanzada y panel en `renderActivas`**

En la IIFE, justo antes de `function renderActivas(activas) {`, añadir:

```js
    function metaAlcanzada(m) {
      var obj = Number(m.monto_objetivo) || 0;
      return m.estado === 'en_curso' && obj > 0 && Number(m.monto_actual) >= obj;
    }
```

Dentro de `renderActivas`, en el `.map(function (m) { ... })`, al inicio del callback (antes de `var dias = ...`), añadir el caso de meta alcanzada:

```js
        if (metaAlcanzada(m)) {
          return '<article class="meta-card meta-card--lograda" data-id="' + m.id + '">' +
            '<div class="meta-felicita">' +
              '<div class="meta-felicita-icono" aria-hidden="true">🎉</div>' +
              '<h2 class="meta-felicita-titulo">¡Meta cumplida!</h2>' +
              '<p class="meta-felicita-nombre">' + esc(m.nombre) + '</p>' +
              '<p class="meta-felicita-monto">' + formatMonto(Number(m.monto_actual) || 0) + '</p>' +
              '<button type="button" class="btn btn-primary" data-act="confirmar" data-id="' + m.id + '">Confirmar</button>' +
            '</div></article>';
        }
```

> Nota: el ícono 🎉 se mantiene aquí; su reemplazo por SVG forma parte del barrido de emojis app-wide (tarea posterior, fuera del alcance de este plan).

- [ ] **Step 2: Quitar el botón "Marcar como lograda" de la tarjeta normal**

En `renderActivas`, en el bloque `'<div class="meta-acciones">' + aporte + ...`, eliminar la línea del botón lograda:
```js
            '<button type="button" class="btn-small" data-act="lograda" data-id="' + m.id + '">Marcar como lograda</button>' +
```
Quedando solo el botón de aporte y el de eliminar.

- [ ] **Step 3: Ajustar la delegación de acciones**

Reemplazar el bloque actual:
```js
      if (act === 'aporte') registrarAporte();
      else if (act === 'lograda') marcarLograda(id);
      else if (act === 'eliminar') eliminarMeta(id, btn);
```
por:
```js
      if (act === 'aporte') registrarAporte(id);
      else if (act === 'confirmar') confirmarLograda(id);
      else if (act === 'eliminar') eliminarMeta(id);
```

- [ ] **Step 4: Reemplazar `marcarLograda` por `confirmarLograda`**

Reemplazar la función:
```js
    async function marcarLograda(id) {
      try {
        await updateMeta(id, { estado: 'lograda' });
        mostrarToast('Meta marcada como lograda 🎉', null, null, 3000);
        cargar();
      } catch (err) {
        mostrarToast('No se pudo actualizar. Reintenta.', null, null, 4000);
      }
    }
```
por:
```js
    async function confirmarLograda(id) {
      try {
        await updateMeta(id, { estado: 'lograda' });
        mostrarToast('¡Meta guardada en cumplidas!', null, null, 3000);
        cargar();
      } catch (err) {
        mostrarToast('No se pudo actualizar. Reintenta.', null, null, 4000);
      }
    }
```

- [ ] **Step 5: Verificar (harness integral en Task 7)** — placeholder.

- [ ] **Step 6: Commit**

```bash
git add views/metas.html
git commit -m "feat(metas): completion celebration panel with user confirmation; drop manual lograda button"
```

---

### Task 6: metas.html — borrado con modal de confirmación (reemplaza toast-undo)

**Files:**
- Modify: `views/metas.html` (`eliminarMeta`, quitar `borradoPendiente`/`_ejecutarBorrado`, wiring del modal)

- [ ] **Step 1: Reemplazar `eliminarMeta` y eliminar la lógica de undo**

Reemplazar el bloque completo:
```js
    function eliminarMeta(id, btn) {
      var card = btn.closest('.meta-card');
      if (card) card.style.display = 'none';
      if (borradoPendiente) { clearTimeout(borradoPendiente.timer); _ejecutarBorrado(borradoPendiente.id); }
      var timer = setTimeout(function () { _ejecutarBorrado(id); borradoPendiente = null; }, 5000);
      borradoPendiente = { id: id, timer: timer };
      mostrarToast('Meta eliminada', 'Deshacer', function () {
        clearTimeout(timer); borradoPendiente = null;
        if (card) card.style.display = '';
      }, 5000);
    }
    async function _ejecutarBorrado(id) {
      try { await deleteMeta(id); } catch (err) { mostrarToast('No se pudo eliminar. Reintenta.', null, null, 4000); cargar(); }
    }
```
por:
```js
    var delMetaPendiente = null;
    function eliminarMeta(id) {
      var m = _metaPorId(id);
      delMetaPendiente = id;
      $('delMetaBody').textContent = '¿Seguro que quieres eliminar «' + (m ? m.nombre : 'esta meta') + '»? Esta acción no se puede deshacer.';
      $('delMetaModal').hidden = false;
      setTimeout(function () { $('delMetaCancelar').focus(); }, 50);
    }
```

- [ ] **Step 2: Eliminar la declaración huérfana de `borradoPendiente`**

Cerca del inicio de la IIFE, eliminar la línea:
```js
    var borradoPendiente = null;
```

- [ ] **Step 3: Wiring del modal de confirmación**

Añadir junto al resto de listeners de la IIFE:

```js
    $('delMetaCancelar').addEventListener('click', function () { $('delMetaModal').hidden = true; delMetaPendiente = null; });
    $('delMetaModal').addEventListener('click', function (e) { if (e.target === e.currentTarget) { $('delMetaModal').hidden = true; delMetaPendiente = null; } });
    $('delMetaModal').addEventListener('keydown', function (e) { if (e.key === 'Escape') { $('delMetaModal').hidden = true; delMetaPendiente = null; } });
    $('delMetaConfirmar').addEventListener('click', async function () {
      if (!delMetaPendiente) return;
      var id = delMetaPendiente;
      try {
        await deleteMeta(id);
        $('delMetaModal').hidden = true;
        delMetaPendiente = null;
        mostrarToast('Meta eliminada', null, null, 3000);
        cargar();
      } catch (err) {
        $('delMetaModal').hidden = true;
        delMetaPendiente = null;
        mostrarToast('No se pudo eliminar. Reintenta.', null, null, 4000);
      }
    });
```

- [ ] **Step 4: Verificar (harness integral en Task 7)** — placeholder.

- [ ] **Step 5: Commit**

```bash
git add views/metas.html
git commit -m "feat(metas): delete via confirmation modal (replaces toast-undo)"
```

---

### Task 7: metas.html — verificación integral + móvil

**Files:**
- Verify only (ajustes inline si hace falta)

- [ ] **Step 1: Harness — alcanzada/confirmar, aporte, borrado**

`preview_start`, recargar. `preview_eval`:
```js
(async function(){
  var html = await (await fetch('views/metas.html')).text();
  var styleM=html.match(/<style>([\s\S]*?)<\/style>/), scriptM=html.match(/<script>([\s\S]*?)<\/script>/);
  try { new Function(scriptM[1]); } catch(e){ return {parse:'SyntaxError', message:String(e)}; }
  var markup=html.replace(/<style>[\s\S]*?<\/style>/,'').replace(/<script>[\s\S]*?<\/script>/,'');
  var host=document.getElementById('mh'); if(host) host.remove();
  host=document.createElement('div'); host.id='mh';
  var st=document.createElement('style'); st.textContent=styleM[1]; host.appendChild(st);
  var w=document.createElement('div'); w.innerHTML=markup; host.appendChild(w); document.body.appendChild(host);
  var P=function(v){return Promise.resolve(v);};
  var hoy=new Date(); function offset(d){ var x=new Date(hoy.getTime()+d*86400000); return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); }
  window.getMetas=function(){ return P([
    {id:'a',nombre:'Viaje',tipo:'ahorro',horizonte:'largo',ambito:'hogar',monto_objetivo:5000,monto_actual:2000,fecha_limite:offset(90),estado:'en_curso'},
    {id:'full',nombre:'Laptop',tipo:'ahorro',horizonte:'corto',ambito:'personal',monto_objetivo:1000,monto_actual:1000,fecha_limite:offset(20),estado:'en_curso'},
    {id:'d',nombre:'Lograda',tipo:'ahorro',horizonte:'mediano',ambito:'personal',monto_objetivo:500,monto_actual:500,fecha_limite:offset(-30),estado:'lograda'}
  ]); };
  window.insertMeta=function(){ return P({id:'new'}); };
  window.updateMeta=function(id,d){ window.__upd={id:id,d:d}; return P({}); };
  window.deleteMeta=function(id){ window.__del=id; return P(); };
  window.insertAporteDirecto=function(meta,monto){ window.__aporte={meta:meta,monto:monto}; return P('tx1'); };
  try { (0,eval)(scriptM[1]); } catch(e){ return {runError:String(e)}; }
  await new Promise(function(r){ setTimeout(r,400); });
  function q(s){ return document.querySelector('#mh '+s); }
  var out={};
  // 1) meta llena muestra panel de felicitación con botón Confirmar
  out.felicita = !!q('.meta-card--lograda[data-id="full"] [data-act="confirmar"]');
  out.noLogradaBtn = !document.querySelector('#mh [data-act="lograda"]');   // botón manual eliminado
  // 2) confirmar → updateMeta estado lograda
  var bConf=q('.meta-card--lograda[data-id="full"] [data-act="confirmar"]'); if(bConf) bConf.click();
  await new Promise(function(r){ setTimeout(r,150); });
  out.confirmOk = !!(window.__upd && window.__upd.id==='full' && window.__upd.d.estado==='lograda');
  // 3) aporte directo abre mini-modal y registra
  // (recargar render: getMetas vuelve a traer 'full' como lograda en real; aquí basta abrir el modal sobre 'a')
  var bAporte=q('.meta-card[data-id="a"] [data-act="aporte"]'); if(bAporte) bAporte.click();
  await new Promise(function(r){ setTimeout(r,100); });
  out.aporteModalAbre = !q('#aporteModal').hidden;
  q('#aMonto').value='150'; q('#aporteForm').dispatchEvent(new Event('submit',{cancelable:true}));
  await new Promise(function(r){ setTimeout(r,150); });
  out.aporteEnviado = !!(window.__aporte && window.__aporte.meta==='a' && window.__aporte.monto===150);
  // 4) eliminar abre modal de confirmación; confirmar borra
  var bDel=q('.meta-card[data-id="a"] [data-act="eliminar"]'); if(bDel) bDel.click();
  await new Promise(function(r){ setTimeout(r,100); });
  out.delModalAbre = !q('#delMetaModal').hidden;
  q('#delMetaConfirmar').click();
  await new Promise(function(r){ setTimeout(r,150); });
  out.delOk = (window.__del==='a');
  var h=document.getElementById('mh'); if(h) h.remove();
  return out;
})()
```
Esperado: `felicita:true`, `noLogradaBtn:true`, `confirmOk:true`, `aporteModalAbre:true`, `aporteEnviado:true`, `delModalAbre:true`, `delOk:true`. `preview_console_logs` (error) = cero.

- [ ] **Step 2: Verificar móvil**

`preview_resize` preset `mobile`. Re-inyectar harness. Confirmar sin overflow horizontal (`document.documentElement.scrollWidth <= clientWidth`), mini-modal y modal de confirmación usables (suben como hoja), tap targets ≥40px. `preview_screenshot`.

- [ ] **Step 3: Commit final (si hubo ajustes)**

```bash
git add views/metas.html
git commit -m "fix(metas): adjustments after full verification"
```

---

### Task 8: historial.html — aportes directos no editables (+ badge)

**Files:**
- Modify: `views/historial.html` (`_datosTx`, `cardTx`, `rowTx`, `abrirEdicion`)

- [ ] **Step 1: Exponer la marca en `_datosTx`**

En `_datosTx`, donde se arma el objeto retornado (junto a `aporte: !!t.aporte_id,`), añadir:
```js
        directo: !!t.es_aporte_directo,
```

- [ ] **Step 2: Ocultar "Editar" para aportes directos — tarjeta (móvil)**

En `cardTx`, cambiar:
```js
      var btnEditar = d.aporte ? '' :
        '<button type="button" class="btn btn-secondary btn-small" data-act="editar">Editar</button>';
```
por:
```js
      var btnEditar = (d.aporte || d.directo) ? '' :
        '<button type="button" class="btn btn-secondary btn-small" data-act="editar">Editar</button>';
      var directoBadge = d.directo ? '<span class="hist-badge hist-badge--aporte" title="Aporte directo a meta">→ meta</span>' : '';
```
Y en el `aria`/meta de la tarjeta, añadir `directoBadge` junto a `aporteBadge`:
```js
              '<span class="hist-tx-meta">' + fechaMeta + d.badge + aporteBadge + directoBadge + nota + '</span>' +
```

- [ ] **Step 3: Ocultar "Editar" para aportes directos — fila (desktop)**

En `rowTx`, cambiar:
```js
      var btnEditar = d.aporte ? '' :
        '<button type="button" class="hist-iconbtn" data-act="editar" aria-label="Editar ' + esc(d.cat) + '">✎</button>';
```
por:
```js
      var btnEditar = (d.aporte || d.directo) ? '' :
        '<button type="button" class="hist-iconbtn" data-act="editar" aria-label="Editar ' + esc(d.cat) + '">✎</button>';
```
Y junto a `aporteMark`, añadir una marca para el directo:
```js
      var directoMark = d.directo ? ' <span class="hist-badge hist-badge--aporte" title="Aporte directo a meta">→</span>' : '';
```
e incluirla en la celda de categoría:
```js
          '<td>' + esc(d.cat) + aporteMark + directoMark + '</td>' +
```

- [ ] **Step 4: Bloquear `abrirEdicion` para aportes directos**

En `abrirEdicion(id)` (≈línea 1088), cambiar:
```js
      if (!tx || tx.aporte_id) return; // aporte vinculado no editable
```
por:
```js
      if (!tx || tx.aporte_id || tx.es_aporte_directo) return; // aporte vinculado / directo no editable
```

- [ ] **Step 5: Verificar render y bloqueo**

`preview_start`, recargar. `preview_eval`:
```js
(async function(){
  var html = await (await fetch('views/historial.html')).text();
  var scriptM=html.match(/<script>([\s\S]*?)<\/script>/);
  try { new Function(scriptM[1]); } catch(e){ return {parse:'SyntaxError', message:String(e)}; }
  return {
    cardGuard: /\(d\.aporte \|\| d\.directo\)/.test(scriptM[1]),
    datosDirecto: /directo:\s*!!t\.es_aporte_directo/.test(scriptM[1]),
    editGuard: /tx\.aporte_id \|\| tx\.es_aporte_directo/.test(scriptM[1])
  };
})()
```
Esperado: `{ cardGuard:true, datosDirecto:true, editGuard:true }`, sin SyntaxError.

- [ ] **Step 6: Commit**

```bash
git add views/historial.html
git commit -m "feat(historial): direct-contribution transactions are non-editable (delete-only)"
```

---

## Self-Review

**Spec coverage:**
- Aporte directo 100% a meta, aparece como gasto en historial → Task 1 (RPC inserta gasto Ahorro `es_aporte_directo`) + Task 4 (UI mini-modal) ✅
- Excedente al fondo de emergencia del ámbito → Task 1 (lógica restante/overflow) ✅
- Quitar auto-lograda de las RPC → Task 1 (create or replace sin el bloque) ✅
- Sin botón "Marcar como lograda" → Task 5 Step 2 ✅
- Panel de felicitación + Confirmar mueve a cumplidas → Task 5 Steps 1,3,4 ✅
- Borrado con modal de confirmación → Task 3 (markup) + Task 6 (lógica) ✅
- Columna `es_aporte_directo` → Task 1 Step 1 ✅
- Historial: aporte directo no editable, sí borrable → Task 8 ✅
- Guard defensivo en `_distribuirSiAhorro` → Task 2 Step 2 ✅

**Placeholder scan:** sin TBD/TODO; los "placeholder" de verificación en Tasks 4-6 remiten explícitamente al harness integral de Task 7 (que contiene el código real).

**Type consistency:**
- `insertAporteDirecto(meta_id, monto, fecha, nota)` ⇄ RPC `aporte_directo_meta(p_meta_id, p_monto, p_fecha, p_nota)` — orden y nombres consistentes (Task 1 ⇄ Task 2 ⇄ Task 4).
- `data-act` ∈ {aporte, confirmar, eliminar} consistente entre render (Task 5 Step 1-2) y delegación (Task 5 Step 3). `lograda` eliminado en ambos lados.
- `_metaPorId` definido en Task 4 Step 1, usado en Task 4 (registrarAporte) y Task 6 (eliminarMeta).
- `registrarAporte(id)` y `eliminarMeta(id)` reciben `id` (no `btn`); coincide con la delegación de Task 5 Step 3.
- `metaAlcanzada(m)` definido y usado solo en `renderActivas` (Task 5 Step 1).
- `_metas` declarado en Task 4 Step 1; `borradoPendiente` eliminado en Task 6 Step 2.
- `d.directo`/`es_aporte_directo` consistente entre `_datosTx`, `cardTx`, `rowTx`, `abrirEdicion` (Task 8).

**Riesgo anotado:**
- Las líneas absolutas (ej. `abrirEdicion` ≈1088) pueden variar; localizar por identificador, no por número.
- Las RPC se re-crean COMPLETAS (create or replace exige cuerpo entero); el único cambio funcional vs. el original es la ausencia del bloque `update ... estado='lograda'`. Comparar contra `20260606_metas_automaticas.sql` si se duda.
- 🎉 en el panel de felicitación se mantiene intencionalmente; lo retira el barrido de emojis app-wide (plan posterior).
