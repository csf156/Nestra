# Fondo de emergencia: % configurable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El fondo de emergencia (personal y hogar) recibe un % configurable de cada ahorro general (default 10, cap 0–50), en vez del sobrante; las metas se llevan el resto. Configurable desde la app.

**Architecture:** Migración DB (columna `metas.pct_fondo_emergencia` + recrear vista `metas_con_progreso` + reescribir `distribuir_ahorro` + nuevo RPC `set_pct_fondo`) + cliente (db.js `getPctFondo`/`setPctFondo` + UI en configuración). El `apply_migration` a producción lo ejecuta el ORQUESTADOR, no un subagente.

**Tech Stack:** Postgres/Supabase (RLS, plpgsql), JS vanilla sin build, MCP `apply_migration`/`execute_sql`.

**Spec:** `docs/superpowers/specs/2026-07-20-fondo-pct-configurable-design.md`

---

## Reglas críticas

- **Datos reales de 2 usuarios.** Cero mutaciones a producción salvo la migración (Task 4, orquestador). Verificaciones de reparto se hacen sobre el **hogar/cuenta de PRUEBA** (memoria `nestra-v2-test-account`), NUNCA el hogar real `5891e9b2-...`.
- **`apply_migration` (Task 4) SOLO lo ejecuta el orquestador** (hilo principal), no un subagente. Los subagentes: autoría de archivos, verificación de solo lectura, cliente.
- **Impersonación RLS** (para verificar RPC/reparto sin login): `set role authenticated; select set_config('request.jwt.claims', '{"sub":"<uuid>"}', false); <query>;` con el SELECT al final (el MCP devuelve solo el último resultado). Limpiar después: `reset role; select set_config('request.jwt.claims', NULL, false);`.
- **No aplicar por el SQL Editor** — solo `apply_migration` (queda registrada).

Datos de la cuenta/hogar de prueba: leer la memoria `nestra-v2-test-account` para los uuid y el hogar_id de PRUEBA antes de cualquier verificación de reparto.

---

## Task 1: Autoría de la migración (archivo en el repo, sin aplicar)

**Files:**
- Create: `supabase/migrations/20260720_fondo_pct_configurable.sql`

- [ ] **Step 1: Crear el archivo**

Contenido EXACTO:
```sql
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
```

- [ ] **Step 2: Commit**
```bash
git add supabase/migrations/20260720_fondo_pct_configurable.sql
git commit -m "feat(fondo): migración — % configurable del fondo de emergencia

Columna pct_fondo_emergencia (0-50, default 10) + recrea metas_con_progreso
con la columna + distribuir_ahorro reescrito (fondo recibe corte fijo off
the top, o 100% sin metas) + RPC set_pct_fondo (ambos miembros del hogar).

NO aplicada aún: la aplica el orquestador tras la verificación RED.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

## Restricciones duras
- NO uses `apply_migration` ni ejecutes este SQL contra la base. Solo escribes el archivo.

---

## Task 2: Contrato de esquema

**Files:**
- Modify: `supabase/tests/schema_contract_test.sql`

- [ ] **Step 1: Añadir `set_pct_fondo` a la lista de RPCs**

En el array `v_rpcs` (busca `'distribuir_ahorro','aporte_directo_meta',`), añade `'set_pct_fondo'`:
```sql
  v_rpcs text[] := array[
    'distribuir_ahorro','aporte_directo_meta','set_pct_fondo',
    'crear_hogar','generar_codigo','unirse_hogar','saldar_hogar',
    'disolver_hogar','set_aporte_esperado','renombrar_hogar'
  ];
```

- [ ] **Step 2: Añadir `metas.pct_fondo_emergencia` a las columnas frágiles**

En el array `v_cols` (busca `array['profiles','pct_ahorro_objetivo',...]`), añade una fila:
```sql
    array['metas','pct_fondo_emergencia','js/db.js getPctFondo + configuracion.html; si falta, el % del fondo cae a 10 en silencio y set_pct_fondo falla']
```

- [ ] **Step 3: Commit**
```bash
git add supabase/tests/schema_contract_test.sql
git commit -m "test(schema-contract): set_pct_fondo + metas.pct_fondo_emergencia

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

## Restricciones duras
- NO corras el test contra la base todavía (fallaría: la migración no está aplicada). Solo edita el archivo.

---

## Task 3: Verificación RED (solo lectura)

Establece el estado previo. Solo consultas MCP `execute_sql` de lectura.

- [ ] **Step 1: Confirmar que la columna NO existe aún**
```sql
select exists (
  select 1 from information_schema.columns
  where table_schema='public' and table_name='metas' and column_name='pct_fondo_emergencia'
) as columna_existe;
```
Esperado: `false`.

- [ ] **Step 2: Confirmar que `set_pct_fondo` NO existe aún**
```sql
select exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='set_pct_fondo') as rpc_existe;
```
Esperado: `false`.

- [ ] **Step 3: Reportar**
Confirma ambos `false` (estado pre-migración). Sin commit.

---

## Task 4: Aplicar la migración — SOLO ORQUESTADOR

**NO delegar a un subagente.**

- [ ] **Step 1:** Confirmar que la Task 3 reportó el estado pre-migración (columna y RPC ausentes).
- [ ] **Step 2:** Con `mcp__supabase__apply_migration`: `name = fondo_pct_configurable`, `query` = el contenido EXACTO del archivo `supabase/migrations/20260720_fondo_pct_configurable.sql`.
- [ ] **Step 3:** Confirmar post-aplicación:
```sql
select column_name, data_type, column_default from information_schema.columns
where table_schema='public' and table_name='metas' and column_name='pct_fondo_emergencia';
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('set_pct_fondo','distribuir_ahorro');
select 'security_invoker=true' = any(reloptions) as invoker_ok
from pg_class where oid='public.metas_con_progreso'::regclass;
```
Esperado: la columna existe (default 10); ambos RPCs existen; la vista sigue `security_invoker`.

---

## Task 5: Verificación GREEN del reparto (hogar/cuenta de PRUEBA)

**Solo el hogar/cuenta de PRUEBA. Lee la memoria `nestra-v2-test-account` para los uuid/hogar_id de prueba.** Este paso INSERTA un ahorro de prueba y sus aportes; se limpia al final.

- [ ] **Step 1: Estado de las metas del fondo (prueba) con su nuevo pct**
```sql
select id, nombre, ambito, es_fondo_emergencia, pct_fondo_emergencia
from public.metas
where es_fondo_emergencia = true
  and (user_id = '<UUID_TEST_USER>' or hogar_id = '<HOGAR_ID_TEST>');
```
Esperado: pct_fondo_emergencia = 10 (default recién aplicado) en el/los fondo(s) de prueba.

- [ ] **Step 2: Probar el reparto con ≥1 meta (impersonando al usuario de prueba)**

Registra un ahorro de prueba y dispara el reparto. Requiere que el hogar/usuario de prueba tenga al menos una meta en curso con fecha futura (la fixture la tiene: "ZZ Meta fixture"). Ejecuta (una sola llamada, ajusta los uuid a los de la fixture):
```sql
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"<UUID_TEST_USER>"}', false);
-- inserta un ahorro de prueba de 100 en el ámbito del fondo a probar
-- (usa el trigger sync_hogar_id para poblar hogar_id si ambito='hogar')
insert into public.transacciones (id, tipo, ambito, monto, fecha, user_id, updated_at)
values ('00000000-0000-0000-0000-0000000000aa', 'ahorro', 'hogar', 100, current_date, '<UUID_TEST_USER>', now());
select public.distribuir_ahorro('00000000-0000-0000-0000-0000000000aa');
select m.nombre, m.es_fondo_emergencia, a.monto
from public.aportes_meta a join public.metas m on m.id = a.meta_id
where a.transaccion_id = '00000000-0000-0000-0000-0000000000aa'
order by m.es_fondo_emergencia;
```
Esperado: el fondo recibe ~10 (10% de 100) + cualquier sobrante; la(s) meta(s) reciben el resto por peso; la suma de todos los aportes = 100 exacto.

- [ ] **Step 3: Limpiar el ahorro de prueba**
```sql
reset role; select set_config('request.jwt.claims', NULL, false);
delete from public.aportes_meta where transaccion_id = '00000000-0000-0000-0000-0000000000aa';
delete from public.transacciones where id = '00000000-0000-0000-0000-0000000000aa';
```
Confirma que se borraron (select count = 0 en ambas).

- [ ] **Step 4: Probar `set_pct_fondo` como cada miembro del hogar de prueba**

Impersona a cada uuid miembro del hogar de prueba y llama `set_pct_fondo('hogar', 20)`; confirma que el valor cambió; luego devuélvelo a 10:
```sql
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"<UUID_TEST_MIEMBRO>"}', false);
select public.set_pct_fondo('hogar', 20);
reset role; select set_config('request.jwt.claims', NULL, false);
select pct_fondo_emergencia from public.metas
where es_fondo_emergencia=true and ambito='hogar' and hogar_id='<HOGAR_ID_TEST>';
```
Esperado: 20 (y repite con el otro miembro para confirmar que ambos pueden). Al terminar, dejar el valor de prueba en 10 con otro `set_pct_fondo('hogar', 10)` impersonando a un miembro.

- [ ] **Step 5: Correr el contrato**
Ejecuta el contenido completo de `supabase/tests/schema_contract_test.sql` vía `execute_sql`. Esperado: `ALL TESTS PASSED`.

- [ ] **Step 6: Reportar** todos los números; confirmar `current_user = postgres` al final.

## Restricciones duras
- Solo el hogar/cuenta de PRUEBA. NUNCA el hogar real `5891e9b2-...`.
- Limpiar el ahorro de prueba (Step 3) y dejar el pct de prueba en 10 (Step 4).

---

## Task 6: Cliente — getPctFondo / setPctFondo (db.js)

**Files:**
- Modify: `js/db.js` (añadir dos funciones en la sección METAS, cerca de `getMetas`)

- [ ] **Step 1: Añadir las funciones**

Tras `getMetas` (js/db.js:696), añade:
```js
// getPctFondo(ambito) — % del ahorro que va al fondo del ámbito. Lee la fila del
// fondo desde metas_con_progreso (getMetas). Default 10 si falta. ambito:
// 'personal' | 'hogar'. Returns: número 0–50.
async function getPctFondo(ambito) {
  const metas = await getMetas(ambito);
  const fondo = (metas || []).find((m) => m.es_fondo_emergencia && m.ambito === ambito);
  const v = fondo && fondo.pct_fondo_emergencia;
  return (v == null || isNaN(Number(v))) ? 10 : Number(v);
}

// setPctFondo(ambito, pct) — persiste el % vía el RPC set_pct_fondo (SECURITY
// DEFINER; ambos miembros del hogar pueden el del hogar). Lanza en fallo.
async function setPctFondo(ambito, pct) {
  const { error } = await supabase.rpc('set_pct_fondo', { p_ambito: ambito, p_pct: pct });
  if (error) throw error;
}

if (typeof window !== 'undefined') {
  window.getPctFondo = getPctFondo;
  window.setPctFondo = setPctFondo;
}
```
Nota: verifica cómo `js/db.js` expone otras funciones a `window` (algunas al final del archivo, otras inline). Sigue el patrón dominante del archivo; si expone todo al final en un bloque `window.X = X`, añade estas dos ahí en vez del bloque inline de arriba.

- [ ] **Step 2: Verificar por lectura**

Confirma que `getMetas(ambito)` devuelve filas con `pct_fondo_emergencia` (viene de la vista recreada en Task 4). Confirma que no rompiste la sintaxis: `node --check js/db.js`.

- [ ] **Step 3: Commit**
```bash
git add js/db.js
git commit -m "feat(fondo): getPctFondo/setPctFondo en db.js

Lee el % del fondo de metas_con_progreso; lo persiste vía el RPC
set_pct_fondo. Preparan la UI de configuración.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Cliente — UI en configuración

**Files:**
- Modify: `views/configuracion.html` (sección Preferencias, tras el bloque `cfgPctAhorro`; y su bloque `<script>` de init)

- [ ] **Step 1: Añadir las filas de UI**

Tras el hint `cfgPctAhorroHint` (configuracion.html:164), añade:
```html
        <div class="cfg-pref-row" id="cfgPctFondoPersonalRow">
          <span class="cfg-pref-nombre">Aporte al fondo personal</span>
          <span class="cfg-pct-wrap">
            <input id="cfgPctFondoPersonal" class="cfg-input cfg-pct-input" type="number"
                   inputmode="numeric" min="0" max="50" step="1"
                   aria-describedby="cfgPctFondoHint">
            <span class="cfg-pct-signo" aria-hidden="true">%</span>
          </span>
        </div>
        <div class="cfg-pref-row" id="cfgPctFondoHogarRow" hidden>
          <span class="cfg-pref-nombre">Aporte al fondo del hogar</span>
          <span class="cfg-pct-wrap">
            <input id="cfgPctFondoHogar" class="cfg-input cfg-pct-input" type="number"
                   inputmode="numeric" min="0" max="50" step="1"
                   aria-describedby="cfgPctFondoHint">
            <span class="cfg-pct-signo" aria-hidden="true">%</span>
          </span>
        </div>
        <p class="cfg-pref-hint" id="cfgPctFondoHint">
          De cada ahorro general, cuánto va al fondo de emergencia. El resto se
          reparte entre tus metas. (Sin metas, el fondo recibe todo.)
        </p>
```

- [ ] **Step 2: Añadir el init**

En el `<script>` de configuración, junto a `initPctAhorro` (configuracion.html:1731), añade un `initPctFondo` y llámalo donde se llama `initPctAhorro`:
```js
    (function initPctFondo() {
      if (typeof getPctFondo !== 'function' || typeof setPctFondo !== 'function') {
        var pr = document.getElementById('cfgPctFondoPersonalRow');
        var hr = document.getElementById('cfgPctFondoHogarRow');
        var hint = document.getElementById('cfgPctFondoHint');
        if (pr) pr.hidden = true; if (hr) hr.hidden = true; if (hint) hint.hidden = true;
        return;
      }
      var inP = document.getElementById('cfgPctFondoPersonal');
      var inH = document.getElementById('cfgPctFondoHogar');
      var rowH = document.getElementById('cfgPctFondoHogarRow');
      var enHogar = (typeof tieneHogar === 'function') && tieneHogar();
      if (rowH) rowH.hidden = !enHogar;

      function cargar() {
        getPctFondo('personal').then(function (v) { inP.value = v; }).catch(function () {});
        if (enHogar) getPctFondo('hogar').then(function (v) { inH.value = v; }).catch(function () {});
      }
      cargar();

      function guardar(ambito, input) {
        return async function () {
          var n = Math.round(Number(input.value));
          if (!Number.isFinite(n) || n < 0 || n > 50) {
            getPctFondo(ambito).then(function (v) { input.value = v; }); // revertir
            return;
          }
          try { await setPctFondo(ambito, n); }
          catch (e) { getPctFondo(ambito).then(function (v) { input.value = v; }); }
        };
      }
      inP.addEventListener('change', guardar('personal', inP));
      if (enHogar) inH.addEventListener('change', guardar('hogar', inH));
    })();
```
Ojo: reusa las clases CSS existentes `cfg-pref-row`, `cfg-pct-wrap`, `cfg-input`, `cfg-pct-input`, `cfg-pct-signo` (ya definidas para `cfgPctAhorro`) — no crees CSS nuevo.

- [ ] **Step 3: Verificar en navegador (boot, sin sesión si no hay)**

`preview_start` `{ name: "nestra" }`. Sin sesión no se ve #configuración autenticado; al menos confirma en `read_console_messages` que no hay errores de sintaxis al cargar. Si hay sesión de prueba, confirma que las filas aparecen (hogar solo con hogar) y que el input respeta 0–50.

- [ ] **Step 4: Commit**
```bash
git add views/configuracion.html
git commit -m "feat(fondo): UI en configuración para el % del fondo (personal + hogar)

Dos filas en Preferencias, junto a 'Ahorro para metas'. La de hogar solo
aparece si perteneces a un hogar. Input 0-50, revierte al último válido.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Bump SHELL_VERSION + cierre

**Files:**
- Modify: `sw.js:15`

- [ ] **Step 1: Bump** `SHELL_VERSION` al siguiente valor respecto al real en `main` en el momento (verifica: `grep SHELL_VERSION sw.js`; probablemente `v38` → `v39`).
- [ ] **Step 2: Repaso** — `node --check js/db.js`; confirmar que el diff no tiene `console.log`/`debugger` nuevos (`git diff origin/main -- js/ views/ sw.js | grep -n "console.log\|debugger" || echo limpio`).
- [ ] **Step 3: Commit**
```bash
git add sw.js
git commit -m "chore(sw): SHELL_VERSION por el % configurable del fondo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Docs + PR

- [ ] **Step 1: Commit del spec y plan** (ya en el working tree):
```bash
git add docs/superpowers/specs/2026-07-20-fondo-pct-configurable-design.md docs/superpowers/plans/2026-07-20-fondo-pct-configurable.md
git commit -m "docs: spec y plan del % configurable del fondo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
(El spec quizá ya esté commiteado en un commit previo de esta rama — si `git status` no lo lista, commitea solo el plan.)

- [ ] **Step 2: Push + PR**
```bash
git push -u origin feat/fondo-pct-configurable
gh pr create --title "Fondo de emergencia: % configurable del ahorro" --body "..."
```
El cuerpo del PR debe dejar claro: la migración YA se aplicó a producción (Task 4, orquestador); esta rama es el registro en git + el cliente; verificado el reparto 10%/90% y el RPC de ambos miembros en el hogar de PRUEBA.

- [ ] **Step 3: (Orquestador) mergear** tras revisión (`gh pr merge <N> --merge`), y verificar el deploy con cache-buster.

## Nota post-merge
El usuario debe recargar la app online una vez para tomar el shell nuevo. El % afecta repartos FUTUROS, no redistribuye ahorros pasados.

## Self-review (cobertura del spec)
- Columna + CHECK + default → Task 1. ✔
- Vista recreada con la columna + security_invoker → Task 1 (paso 2). ✔
- distribuir_ahorro reescrito (corte fijo / 100% sin metas / suma exacta) → Task 1. ✔
- set_pct_fondo (ambos miembros) → Task 1 + verificado Task 5 Step 4. ✔
- Contrato (RPC + columna frágil) → Task 2, corrido Task 5 Step 5. ✔
- Cliente getPctFondo/setPctFondo → Task 6. ✔
- UI (dos filas, hogar condicional, 0–50) → Task 7. ✔
- Aplicar solo orquestador → Task 4 marcada. ✔
- Verificación en hogar de PRUEBA, no real → Task 5. ✔
- Bump + deploy → Task 8, 9. ✔
