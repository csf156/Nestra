# Ahorro como tipo puro (sin categoría) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el ahorro en un tipo de transacción puro (sin categoría) que se reparte automáticamente entre las metas del ámbito elegido (personal o hogar), y eliminar la categoría 'Ahorro'.

**Architecture:** La distribución a metas pasa a dispararse por `tipo='ahorro'` (no por "gasto en categoría Ahorro"). El RPC `distribuir_ahorro` se generaliza para repartir entre metas personales o del hogar según `tx.ambito`. `categoria_id` se vuelve nullable (las transacciones de ahorro no llevan categoría). El formulario oculta el selector de categoría para ahorro. Se borra la categoría 'Ahorro' y se limpian las referencias por nombre.

**Tech Stack:** Vanilla JS (IIFE, `var`, globales), Supabase (Postgres + RLS + plpgsql RPCs), IndexedDB (idb), preview MCP para verificación.

**Spec:** `docs/superpowers/specs/2026-06-23-ahorro-tipo-sin-categoria-design.md`

**Contexto v2:** 0 transacciones `tipo='ahorro'`, 0 en categoría 'Ahorro' (1 categoría 'Ahorro' sin uso). Migración limpia. v1 (producción) NO se toca.

---

## File Structure

- **Create** `supabase/migrations/20260623_ahorro_tipo.sql` — nullable `categoria_id` + CHECK, borrar categoría 'Ahorro', `distribuir_ahorro` generalizado por ámbito, `aporte_directo_meta` refactorizado.
- **Modify** `supabase/schema.sql` — reflejar nullable + CHECK + quitar 'Ahorro' del seed.
- **Modify** `js/db.js` — disparar distribución por `tipo==='ahorro'`; `_distribuirAhorroTx`/`_reDistribuirAhorro` por tipo.
- **Modify** `views/transaccion.html` — ocultar categoría para ahorro, submit con `categoria_id=null`, fix CSS botón.
- **Modify** `views/decisiones.html` — quitar ramas muertas de categoría 'Ahorro'.

---

## Task 1: Migración DB (esquema + RPCs)

**Files:**
- Create: `supabase/migrations/20260623_ahorro_tipo.sql`
- Modify: `supabase/schema.sql`

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/20260623_ahorro_tipo.sql` con este contenido exacto:

```sql
-- =====================================================================
-- Nestra — Ahorro como tipo puro (sin categoría)
-- ---------------------------------------------------------------------
-- 1. categoria_id NULLABLE + CHECK (ahorro sin categoría; gasto/ingreso con ella).
-- 2. Borrar la categoría 'Ahorro' (sin uso en v2).
-- 3. distribuir_ahorro: generalizado por ámbito (personal | hogar).
-- 4. aporte_directo_meta: crea tipo='ahorro' sin categoría (ya no gasto en 'Ahorro').
-- Idempotente. Ejecutar en SQL Editor / vía MCP apply_migration.
-- =====================================================================

-- 1. categoria_id nullable + CHECK por tipo.
alter table public.transacciones alter column categoria_id drop not null;
alter table public.transacciones drop constraint if exists transacciones_categoria_por_tipo;
alter table public.transacciones add constraint transacciones_categoria_por_tipo
  check (tipo = 'ahorro' or categoria_id is not null);

-- 2. Borrar la categoría 'Ahorro' (0 referencias en v2).
delete from public.categorias where nombre = 'Ahorro' and tipo = 'gasto';

-- 3. distribuir_ahorro(p_transaccion_id) — reparte por ÁMBITO.
--    personal → metas personales del usuario + fondo personal.
--    hogar    → metas del hogar + fondo del hogar.
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

  -- 2. Fondo del ámbito (siempre existe).
  if v_tx.ambito = 'hogar' then
    select id into v_fondo_id from public.metas
    where es_fondo_emergencia = true and ambito = 'hogar' limit 1;
  else
    select id into v_fondo_id from public.metas
    where es_fondo_emergencia = true and ambito = 'personal' and user_id = v_tx.user_id limit 1;
  end if;
  if v_fondo_id is null then
    raise exception 'No existe el fondo de emergencia del ámbito %', v_tx.ambito;
  end if;

  -- 3. Suma de pesos de las metas candidatas del ámbito.
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
        or (v_tx.ambito = 'hogar' and m.ambito = 'hogar' and m.user_id is null)
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

  -- Peso del fondo (solo importancia).
  select importancia into v_peso from public.metas where id = v_fondo_id;
  v_suma_pesos := v_suma_pesos + v_peso;

  if v_suma_pesos <= 0 then
    return;
  end if;

  -- 4. Repartir entre las metas normales (topeadas).
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
        or (v_tx.ambito = 'hogar' and m.ambito = 'hogar' and m.user_id is null)
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
      insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
      values (r.id, v_tx.id, v_asignado, v_peso);
      v_repartido := v_repartido + v_asignado;

      if (r.progreso + v_asignado) >= r.monto_objetivo then
        update public.metas set estado = 'lograda' where id = r.id;
      end if;
    end if;
  end loop;

  -- 5. El fondo recibe el resto (cuadra suma == v_total). Nunca se topea.
  v_aporte_fondo := v_total - v_repartido;
  if v_aporte_fondo > 0 then
    select importancia into v_peso from public.metas where id = v_fondo_id;
    insert into public.aportes_meta (meta_id, transaccion_id, monto, peso_aplicado)
    values (v_fondo_id, v_tx.id, v_aporte_fondo, v_peso);
  end if;
end;
$$;

grant  execute on function public.distribuir_ahorro(uuid) to authenticated;
revoke execute on function public.distribuir_ahorro(uuid) from anon, public;

-- 4. aporte_directo_meta — sin categoría 'Ahorro'; crea tipo='ahorro'.
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

  -- Transacción de ahorro (sin categoría), marcada como aporte directo.
  insert into public.transacciones
    (fecha, tipo, ambito, user_id, categoria_id, monto, nota, es_aporte_directo)
  values
    (coalesce(p_fecha, current_date), 'ahorro', 'personal', v_uid, null, p_monto, p_nota, true)
  returning id into v_tx_id;

  select coalesce(sum(a.monto), 0) into v_progreso
  from public.aportes_meta a where a.meta_id = p_meta_id;

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

- [ ] **Step 2: Aplicar la migración (Supabase MCP)**

Usar `mcp__supabase__apply_migration` (name `ahorro_tipo`) con el SQL de arriba.

- [ ] **Step 3: Verificar esquema y borrado de categoría**

Con `mcp__supabase__execute_sql`:
```sql
select
  (select is_nullable from information_schema.columns where table_name='transacciones' and column_name='categoria_id') as categoria_nullable,
  (select count(*) from pg_constraint where conname='transacciones_categoria_por_tipo') as tiene_check,
  (select count(*) from public.categorias where nombre='Ahorro') as cat_ahorro;
```
Esperado: `categoria_nullable='YES'`, `tiene_check=1`, `cat_ahorro=0`.

- [ ] **Step 4: Verificar distribuir_ahorro (personal y hogar) con datos temporales**

Ejecutar este bloque (crea metas temporales, inserta ahorros, llama el RPC, comprueba y limpia). Reemplazar `:UID` por el user_id de la cuenta de prueba (`2da98c7b-e56e-427e-be3e-787913a24477`). Como `execute_sql` corre con rol privilegiado, el RPC valida `auth.uid()` → en su lugar verificar la LÓGICA insertando aportes vía una meta real no es trivial sin sesión; por eso la verificación funcional definitiva del reparto se hace en preview (Task 5). Aquí solo se comprueba que el RPC existe y es invocable:
```sql
select proname, pronargs from pg_proc where proname='distribuir_ahorro';
```
Esperado: una fila `distribuir_ahorro | 1`.

(La verificación real del reparto personal/hogar se hace autenticado en preview — Task 5, pasos 1–2.)

- [ ] **Step 5: Reflejar en `supabase/schema.sql`**

Leer `supabase/schema.sql`. En la definición de `transacciones`:
- Cambiar `categoria_id uuid not null references ...` a `categoria_id uuid references public.categorias (id) on delete restrict` (quitar `not null`).
- Añadir el CHECK a la tabla (o como `alter` en la sección de constraints si el archivo usa ese estilo):
  ```sql
  constraint transacciones_categoria_por_tipo check (tipo = 'ahorro' or categoria_id is not null)
  ```
En el seed de categorías (`insert into public.categorias ...`), quitar la fila `'Ahorro'` (la de tipo gasto). Si el seed usa una sola sentencia con varias filas, eliminar solo el renglón de 'Ahorro'.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260623_ahorro_tipo.sql supabase/schema.sql
git commit -m "feat(ahorro): migración — categoria_id nullable, borrar categoría Ahorro, distribuir_ahorro por ámbito, aporte_directo sin categoría"
```
Terminar el mensaje con: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## Task 2: Disparar distribución por `tipo='ahorro'` en `js/db.js`

**Files:**
- Modify: `js/db.js` (función `insertTransaccion` ~línea 164; `_distribuirSiAhorro` ~179-193; `_reDistribuirAhorro` ~203-222)

- [ ] **Step 1: Reemplazar el disparo basado en categoría por uno basado en tipo**

En `js/db.js`, en `insertTransaccion`, localizar:
```js
    if (data.tipo === 'gasto') await _distribuirSiAhorro(data);
```
y reemplazar por:
```js
    if (data.tipo === 'ahorro') await _distribuirAhorroTx(data);
```

- [ ] **Step 2: Reescribir el helper de distribución (sin nombre de categoría)**

Reemplazar la función `_distribuirSiAhorro` completa (el bloque que empieza en `// _distribuirSiAhorro(tx) —` y termina en su `}`) por:
```js
// _distribuirAhorroTx(tx) — si la transacción es de tipo 'ahorro', invoca el
// RPC distribuir_ahorro (reparte entre metas del ámbito + fondo). Los aportes
// directos ya asignan su monto a mano; nunca se reparten. Best-effort (no lanza).
async function _distribuirAhorroTx(tx) {
  try {
    if (!tx || tx.tipo !== 'ahorro') return;
    if (tx.es_aporte_directo) return;
    const { error } = await supabase.rpc('distribuir_ahorro', { p_transaccion_id: tx.id });
    if (error) throw error;
  } catch (err) {
    console.error('Aviso: no se pudo repartir el ahorro entre metas:', err.message || err);
  }
}
```

- [ ] **Step 3: Re-clavar `_reDistribuirAhorro` en el tipo**

Reemplazar la función `_reDistribuirAhorro` completa por (nota: ahora recibe el **tipo** resultante, no la categoría):
```js
// _reDistribuirAhorro(txId, nuevoTipo) — re-reparte aportes_meta tras editar
// una transacción. Borra los aportes previos del tx y re-invoca distribuir_ahorro
// si el nuevo tipo sigue siendo 'ahorro'. Best-effort: no lanza, no revierte.
async function _reDistribuirAhorro(txId, nuevoTipo) {
  try {
    const { error: errDel } = await supabase
      .from('aportes_meta')
      .delete()
      .eq('transaccion_id', txId);
    if (errDel) throw errDel;

    if (nuevoTipo === 'ahorro') {
      const { error: errRpc } = await supabase.rpc('distribuir_ahorro', { p_transaccion_id: txId });
      if (errRpc) throw errRpc;
    }
  } catch (err) {
    console.error('Aviso: no se pudo re-distribuir el ahorro tras editar:', err.message || err);
  }
}
```

- [ ] **Step 4: Verificación estática**

Confirmar que ya no queda ninguna referencia a `_distribuirSiAhorro` ni a la cadena `'Ahorro'` por nombre de categoría en `js/db.js`:
Run (Grep): buscar `_distribuirSiAhorro` y `nombre === 'Ahorro'` en `js/db.js` → 0 coincidencias.
Confirmar que `_distribuirAhorroTx` y `_reDistribuirAhorro` existen y que `insertTransaccion` llama `_distribuirAhorroTx`.

- [ ] **Step 5: Commit**

```bash
git add js/db.js
git commit -m "feat(ahorro): db.js dispara distribución por tipo='ahorro' (no por categoría)"
```
Terminar con: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## Task 3: Formulario — ocultar categoría para ahorro + fix CSS

**Files:**
- Modify: `views/transaccion.html` (markup categoría ~67-74; CSS toggle ~241-262; JS `cargarCategorias` ~573-598, `_setTipo` ~524-534, `validar` ~670-694, submit ~748-790, edición ~773)

- [ ] **Step 1: Envolver el grupo de categoría con un id para ocultarlo**

En `views/transaccion.html`, localizar el grupo de categoría:
```html
      <!-- Categoría -->
      <div class="form-group">
        <label for="categoria">Categoría</label>
```
y añadir un id al `div`:
```html
      <!-- Categoría -->
      <div class="form-group" id="categoriaGroup">
        <label for="categoria">Categoría</label>
```

- [ ] **Step 2: Ocultar categoría y nueva-categoría cuando el tipo es ahorro**

En `_setTipo(val)` (cerca de la línea 524), tras las líneas que togglean las clases de los botones y antes de `cargarCategorias();`, insertar el control de visibilidad:
```js
      var esAhorro = (val === 'ahorro');
      document.getElementById('categoriaGroup').style.display = esAhorro ? 'none' : '';
      if (esAhorro) { _ocultarNuevaCat(); _ocultarPrestamo(); }
```
Y envolver la carga de categorías para no cargarlas en ahorro:
```js
      if (!esAhorro) cargarCategorias();
```
(reemplazando la llamada `cargarCategorias();` existente dentro de `_setTipo`).

- [ ] **Step 3: No exigir categoría en la validación cuando es ahorro**

En `validar()` (cerca de 677), reemplazar:
```js
      if (!categoriaEl.value) {
```
por:
```js
      if (tipoEl.value !== 'ahorro' && !categoriaEl.value) {
```

- [ ] **Step 4: Submit con `categoria_id` null para ahorro**

En el handler de submit, en la rama de alta normal (cerca de 780), reemplazar:
```js
          const tx = await insertTransaccion({
            tipo:         tipoEl.value,
            ambito:       ambitoEl.value,
            categoria_id: savedCatId,
            monto,
            fecha,
            nota,
          });
```
por:
```js
          const tx = await insertTransaccion({
            tipo:         tipoEl.value,
            ambito:       ambitoEl.value,
            categoria_id: tipoEl.value === 'ahorro' ? null : savedCatId,
            monto,
            fecha,
            nota,
          });
```
Y en la rama de edición (cerca de 763), reemplazar el objeto de `updateTransaccion` para usar la misma regla:
```js
          await updateTransaccion(editTx.id, {
            tipo:         tipoEl.value,
            ambito:       ambitoEl.value,
            categoria_id: tipoEl.value === 'ahorro' ? null : savedCatId,
            monto,
            fecha,
            nota,
          });
```
Y la llamada de re-distribución (línea ~773) ahora pasa el TIPO:
```js
          await _reDistribuirAhorro(editTx.id, tipoEl.value);
```

- [ ] **Step 5: `cargarCategorias` ya no necesita el caso ahorro**

En `cargarCategorias` (cerca de 580), reemplazar:
```js
        const catTipo = tipo === 'ahorro' ? 'gasto' : tipo;
        const cats = await getCategorias(catTipo);
```
por:
```js
        const cats = await getCategorias(tipo);
```
(Para ahorro ya no se llama `cargarCategorias` —Step 2—, así que `tipo` aquí siempre es 'gasto'|'ingreso'.)

- [ ] **Step 6: En edición de un ahorro, ocultar categoría al precargar**

En el bloque de precarga de edición (donde se togglean `btnTipoAhorro` para `editTx.tipo === 'ahorro'`, ~813), asegurar que se aplica la visibilidad llamando al control. Tras las líneas de toggle de botones de tipo en la precarga, añadir:
```js
      document.getElementById('categoriaGroup').style.display = (editTx.tipo === 'ahorro') ? 'none' : '';
```

- [ ] **Step 7: Fix CSS del botón "Ahorro" recortado en móvil**

En el bloque `<style>`, en `.tx-toggle-btn` (cerca de 241), reducir el padding horizontal en móvil para que "Ahorro" entre completo. Reemplazar:
```css
  .tx-toggle-btn {
    flex: 1;
    padding: var(--space-sm) var(--space-md);
```
por:
```css
  .tx-toggle-btn {
    flex: 1;
    min-width: 0;
    padding: var(--space-sm) var(--space-xs);
```
(El override de ≥480px ya fija `padding: var(--space-sm) var(--space-lg)`, así que el cambio solo afecta móvil.)

- [ ] **Step 8: Commit**

```bash
git add views/transaccion.html
git commit -m "feat(ahorro): formulario sin categoría para ahorro + botón de tipo completo en móvil"
```
Terminar con: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## Task 4: Limpieza del Oráculo (categoría 'Ahorro' muerta)

**Files:**
- Modify: `views/decisiones.html` (~216, ~334, ~355)

- [ ] **Step 1: Quitar el caso especial de la categoría 'Ahorro' en la evaluación**

En `views/decisiones.html`, localizar el bloque que trata `cat.nombre === 'Ahorro'` (cerca de 216) y eliminar la rama especial, dejando el flujo normal. Leer el bloque completo primero; la rama típicamente resuelve un veredicto 'ahorro' directo. Como la categoría ya no existe (no aparece en el selector), esta rama es inalcanzable. Eliminar la rama `if (cat.nombre === 'Ahorro') { ... }` y su lógica asociada.

- [ ] **Step 2: Quitar 'Ahorro' del atajo sin-consulta**

Cerca de 334, reemplazar:
```js
      if (cat.nombre === 'Ahorro' || cat.limite_mensual == null) {
```
por:
```js
      if (cat.limite_mensual == null) {
```

- [ ] **Step 3: Quitar el filtro de exclusión de 'Ahorro'**

Cerca de 355, reemplazar:
```js
      var conLimite = (cats || []).filter(function (c) { return c.limite_mensual != null && c.nombre !== 'Ahorro'; });
```
por:
```js
      var conLimite = (cats || []).filter(function (c) { return c.limite_mensual != null; });
```

- [ ] **Step 4: Verificación estática**

Run (Grep): buscar `'Ahorro'` en `views/decisiones.html` → 0 coincidencias relacionadas con `cat.nombre` (las menciones de texto como "Ahorro comprometido" pueden quedarse; confirmar que no hay comparaciones `cat.nombre === 'Ahorro'`).

- [ ] **Step 5: Commit**

```bash
git add views/decisiones.html
git commit -m "refactor(ahorro): quitar ramas muertas de la categoría Ahorro en el Oráculo"
```
Terminar con: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## Task 5: Verificación end-to-end + despliegue para el teléfono

**Files:** (ninguno — verificación en preview)

- [ ] **Step 1: Ahorro personal reparte a metas personales + fondo personal**

En preview (cuenta de prueba v2), iniciar sesión. Crear una meta **personal** con objetivo (p.ej. S/ 500, fecha límite futura, horizonte corto). Registrar una transacción tipo **Ahorro**, ámbito **Personal**, monto S/ 200:
- El formulario NO muestra selector de categoría.
- Tras guardar: la línea "Ahorros" del dashboard suma S/ 200; la meta personal y/o el fondo personal reciben aportes (verificar vía `getMetas()` o el dashboard de metas que el progreso subió).
Confirmar en consola: sin errores.

- [ ] **Step 2: Ahorro hogar reparte a metas del hogar + fondo del hogar**

Crear (o reusar) una meta **del hogar** con objetivo. Registrar Ahorro, ámbito **Hogar**, monto S/ 300. Verificar que el aporte fue a metas del hogar / fondo del hogar (no a las personales). Consola sin errores.

- [ ] **Step 3: La categoría 'Ahorro' ya no aparece**

En el formulario de transacción (tipo Gasto) y en el Oráculo, confirmar que 'Ahorro' no figura entre las categorías. En Configuración → Categorías, 'Ahorro' no está.

- [ ] **Step 4: Botón "Ahorro" completo en móvil**

Con viewport mobile (375px) y ~320px, abrir el modal de transacción: el tercer botón de tipo muestra "Ahorro" completo (texto no recortado). `preview_screenshot` como evidencia.

- [ ] **Step 5: Limpieza de datos de prueba**

Borrar las transacciones de ahorro y metas creadas para la verificación (Historial / Metas), para no dejar ruido en la cuenta de prueba.

- [ ] **Step 6: Push a `v2` (despliegue para el teléfono)**

```bash
git push origin v2
```
La migración ya está aplicada en la instancia v2; Cloudflare Pages reconstruye desde `v2` → el usuario verifica en su teléfono. **v1 (producción) no se toca.**

---

## Self-Review

**1. Cobertura del spec:**
- ✅ `categoria_id` nullable + CHECK → Task 1.
- ✅ Borrar categoría 'Ahorro' → Task 1.
- ✅ Distribución por `tipo='ahorro'`, ámbito personal/hogar → Task 1 (RPC) + Task 2 (disparo).
- ✅ `aporte_directo_meta` sin categoría → Task 1.
- ✅ Formulario oculta categoría para ahorro, submit `categoria_id=null`, ámbito decide → Task 3.
- ✅ Fix botón recortado → Task 3 Step 7.
- ✅ Limpieza referencias categoría 'Ahorro' (Oráculo) → Task 4.
- ✅ Verificación e2e personal + hogar + categoría ausente + móvil → Task 5.
- ✅ Despliegue al teléfono → Task 5 Step 6.

**2. Placeholder scan:** sin placeholders; todo el SQL y JS va completo.

**3. Consistencia de nombres:**
- `_distribuirAhorroTx(tx)` definido (Task 2 Step 2) y llamado en `insertTransaccion` (Task 2 Step 1). ✔
- `_reDistribuirAhorro(txId, nuevoTipo)` redefinido (Task 2 Step 3) y llamado con `tipoEl.value` (Task 3 Step 4). ✔
- `distribuir_ahorro(p_transaccion_id)` firma intacta (1 arg) — `db.js` la llama con `{ p_transaccion_id }`. ✔
- `id="categoriaGroup"` creado (Task 3 Step 1) y usado (Steps 2, 6). ✔
- CHECK `transacciones_categoria_por_tipo` consistente entre migración y schema.sql. ✔
