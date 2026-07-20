# RLS de aportes_meta: progreso de metas de hogar compartido — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el progreso de una meta de HOGAR sume los aportes de todos los miembros para cada miembro, partiendo la RLS de `aportes_meta` en policies por comando (SELECT ampliado a co-miembros del hogar; escritura sigue restringida al dueño).

**Architecture:** Cambio de solo base de datos. Una migración de RLS + una aserción en el test de contrato. Sin cambios de cliente, sin bump de `SHELL_VERSION`. El motor de reparto (`distribuir_ahorro`) NO se toca — ya reparte bien; el bug es de lectura.

**Tech Stack:** Postgres RLS (Supabase), MCP `apply_migration`/`execute_sql`, SQL de contrato en `supabase/tests/`.

**Spec:** `docs/superpowers/specs/2026-07-19-aportes-meta-rls-hogar-design.md`

---

## Reglas críticas — leer antes de empezar

**Datos reales de 2 usuarios en producción. Cero mutaciones a producción salvo la migración de RLS.**

- **El `apply_migration` a producción (Task 4) lo ejecuta el ORQUESTADOR (hilo principal), NO un subagente.** Un subagente ya ignoró una vez un "no hagas X" (memoria `feedback-subagent-push-verification`). Los subagentes de este plan hacen: verificación de solo lectura, autoría de archivos, y el PR. Ninguno llama `apply_migration` ni escribe en la base.
- **Nunca aplicar por el SQL Editor.** Solo `apply_migration` (queda registrada en el ledger).
- **Verificación por impersonación de RLS** (probada y funcionando): en una sola llamada a `execute_sql`, poner el SELECT AL FINAL (el MCP devuelve solo el resultado del último statement):
  ```sql
  set role authenticated;
  select set_config('request.jwt.claims', '{"sub":"<uuid>"}', false);
  select ... ;   -- este resultado es el que vuelve
  ```
  Tras verificar, limpiar en una llamada aparte: `reset role; select set_config('request.jwt.claims', NULL, false);`
- **No insertar/actualizar/borrar filas en producción para "probar".** La restricción de escritura se verifica de forma estática (policies en `pg_policy`), no con un INSERT real.

Datos del hogar real para las verificaciones:
- hogar_id: `5891e9b2-a935-447c-9f83-3ae3a857cd30`
- csf156 (usuario que reportó): `42c18981-e55f-4271-8f01-e89ab2975f44`
- pareja: `d83a9b58-f740-4c77-af01-d3ebf2669938`
- Totales reales: **Fondo de emergencia = 362.75**, **Alquiler 🏠 = 192.25**.

---

## Task 1: Verificación RED (reproducir el bug, solo lectura)

Establece la línea base: cada miembro ve solo su fracción. No modifica nada.

**Files:** ninguno (solo consultas MCP `execute_sql`).

- [ ] **Step 1: Impersonar a csf156 y leer el progreso**

Ejecuta (una sola llamada `execute_sql`):
```sql
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"42c18981-e55f-4271-8f01-e89ab2975f44"}', false);
select nombre, monto_actual from public.metas_con_progreso
where hogar_id='5891e9b2-a935-447c-9f83-3ae3a857cd30' and ambito='hogar'
order by nombre;
```
Esperado (bug presente): `Alquiler 🏠 = 42.25`, `Fondo de emergencia = 62.75`.

- [ ] **Step 2: Limpiar el estado de conexión**
```sql
reset role;
select set_config('request.jwt.claims', NULL, false);
```

- [ ] **Step 3: Impersonar a la pareja y leer**
```sql
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"d83a9b58-f740-4c77-af01-d3ebf2669938"}', false);
select nombre, monto_actual from public.metas_con_progreso
where hogar_id='5891e9b2-a935-447c-9f83-3ae3a857cd30' and ambito='hogar'
order by nombre;
```
Esperado (bug presente): `Alquiler 🏠 = 150.00`, `Fondo de emergencia = 300.00`.

- [ ] **Step 4: Limpiar**
```sql
reset role;
select set_config('request.jwt.claims', NULL, false);
```

- [ ] **Step 5: Reportar**

Confirma que ningún miembro ve el total real (192.25 / 362.75). Reporta los 4 números observados. NO hay commit (no hay archivos).

---

## Task 2: Autoría de la migración de RLS (archivo en el repo, sin aplicar)

Escribe el archivo de migración para el historial de git. **NO lo aplica a la base** (eso es Task 4, del orquestador).

**Files:**
- Create: `supabase/migrations/20260719_aportes_meta_rls_hogar.sql`

- [ ] **Step 1: Crear el archivo**

Contenido EXACTO:
```sql
-- El progreso de las metas de HOGAR solo mostraba los aportes del usuario que
-- consulta, no el total del hogar. Causa: metas_con_progreso es security_invoker
-- y la RLS de aportes_meta (aportes_meta_acceso, cmd ALL, auth.uid()=user_id)
-- filtra el LEFT JOIN a solo los aportes propios. Una meta de hogar acumula
-- aportes de 2 usuarios, así que cada miembro veía su fracción. Es un bug de
-- VISUALIZACIÓN; distribuir_ahorro reparte correcto y NO se toca aquí.
--
-- Fix: partir la policy única ALL en policies por comando. SELECT amplía a los
-- aportes de metas de hogar compartidas (espeja metas_select: propio OR del
-- hogar, vía auth_hogar_id()). INSERT/UPDATE/DELETE siguen restringidos al
-- dueño (auth.uid()=user_id): un usuario no puede crear/editar/borrar aportes
-- atribuidos a otro. auth_hogar_id() ya existe (STABLE SECURITY DEFINER).

drop policy if exists aportes_meta_acceso on public.aportes_meta;

create policy aportes_meta_select on public.aportes_meta
  for select using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.metas m
      where m.id = aportes_meta.meta_id
        and m.ambito = 'hogar'
        and m.hogar_id = public.auth_hogar_id()
    )
  );

create policy aportes_meta_insert on public.aportes_meta
  for insert with check ((select auth.uid()) = user_id);

create policy aportes_meta_update on public.aportes_meta
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy aportes_meta_delete on public.aportes_meta
  for delete using ((select auth.uid()) = user_id);
```

- [ ] **Step 2: Commit**
```bash
git add supabase/migrations/20260719_aportes_meta_rls_hogar.sql
git commit -m "fix(rls): aportes_meta — progreso de metas de hogar suma a todos los miembros

El progreso de una meta de hogar solo mostraba los aportes propios: la vista
metas_con_progreso es security_invoker y la RLS de aportes_meta restringía
SELECT a auth.uid()=user_id. Se parte la policy ALL en policies por comando;
SELECT amplía a los aportes de metas de hogar compartidas (espeja metas_select
via auth_hogar_id). Escritura sigue restringida al dueño.

Bug de visualización, no de reparto: distribuir_ahorro no se toca.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Aserción de contrato de la RLS

Vigila que la RLS de SELECT de `aportes_meta` siga incluyendo a los co-miembros del hogar, para que nadie reintroduzca el bug al recrear las policies.

**Files:**
- Modify: `supabase/tests/schema_contract_test.sql` (insertar un bloque `do $$ ... $$;` ANTES de la última línea `select 'ALL TESTS PASSED' as resultado;`)

- [ ] **Step 1: Insertar el bloque de aserción**

Justo antes de la línea final `select 'ALL TESTS PASSED' as resultado;`, inserta:
```sql
-- ── RLS de aportes_meta: lectura de hogar compartida ─────────────────
-- El progreso de metas de HOGAR se suma vía metas_con_progreso
-- (security_invoker). Si la RLS de aportes_meta vuelve a restringir SELECT a
-- solo auth.uid()=user_id, cada miembro ve solo SU fracción del progreso (bug
-- arreglado el 2026-07-19, migración 20260719_aportes_meta_rls_hogar.sql).
-- Este check vigila que la policy de SELECT siga ampliada a los co-miembros
-- del hogar (referencia auth_hogar_id). Las policies de escritura siguen
-- restringidas al dueño a propósito; no se verifican aquí.
do $$
declare
  v_select_qual text;
begin
  select pg_get_expr(pol.polqual, pol.polrelid) into v_select_qual
  from pg_policy pol
  where pol.polrelid = 'public.aportes_meta'::regclass
    and pol.polcmd in ('r','*')   -- SELECT o ALL
  limit 1;

  if v_select_qual is null then
    raise exception 'FALLO: aportes_meta no tiene policy de SELECT (ni ALL)';
  end if;

  if v_select_qual not like '%auth_hogar_id%' then
    raise exception 'FALLO: la RLS de SELECT de aportes_meta no incluye a los co-miembros del hogar (falta auth_hogar_id) — el progreso de metas de hogar volvería a mostrar solo los aportes propios';
  end if;
end $$;
```

- [ ] **Step 2: (No se puede correr aún contra la base)**

Este test PASARÁ recién cuando la migración esté aplicada (Task 4). En este punto, contra producción todavía-sin-migrar, el bloque nuevo FALLARÍA (la policy ALL vieja no tiene `auth_hogar_id`). No lo corras contra la base ahora; solo confirma que el SQL es sintácticamente válido revisándolo. Se ejecuta de verdad en la Task 5, post-migración.

- [ ] **Step 3: Commit**
```bash
git add supabase/tests/schema_contract_test.sql
git commit -m "test(schema-contract): la RLS de SELECT de aportes_meta incluye al hogar

Vigila que aportes_meta no vuelva a restringir SELECT a solo el dueño: eso
reintroduciría el bug donde el progreso de metas de hogar muestra solo los
aportes propios (metas_con_progreso es security_invoker).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Aplicar la migración a producción — SOLO ORQUESTADOR

**NO delegar a un subagente. NO lo ejecuta ningún subagente de este plan.**

**Files:** ninguno (mutación de base vía `apply_migration`).

- [ ] **Step 1: Confirmar RED**

Verifica que la Task 1 reportó el bug reproducido (fracciones por usuario). Si la Task 1 no confirmó el RED, DETENERSE — algo cambió.

- [ ] **Step 2: Aplicar**

Con `mcp__supabase__apply_migration`:
- `name`: `aportes_meta_rls_hogar`
- `query`: el contenido EXACTO del archivo `supabase/migrations/20260719_aportes_meta_rls_hogar.sql` (Task 2).

- [ ] **Step 3: Confirmar que las policies quedaron**
```sql
select policyname, cmd, pg_get_expr(polqual, polrelid) as using_qual
from pg_policies pp
join pg_policy pol on pol.polname = pp.policyname
where pp.schemaname='public' and pp.tablename='aportes_meta'
order by cmd;
```
(o más simple: `select policyname, cmd, qual from pg_policies where schemaname='public' and tablename='aportes_meta' order by cmd;`)
Esperado: 4 policies — `aportes_meta_select` (SELECT, con `auth_hogar_id`), `aportes_meta_insert` (INSERT), `aportes_meta_update` (UPDATE), `aportes_meta_delete` (DELETE). Ya NO existe `aportes_meta_acceso`.

---

## Task 5: Verificación GREEN + contrato (solo lectura)

**Files:** ninguno (consultas MCP).

- [ ] **Step 1: Impersonar a csf156 → total completo**
```sql
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"42c18981-e55f-4271-8f01-e89ab2975f44"}', false);
select nombre, monto_actual from public.metas_con_progreso
where hogar_id='5891e9b2-a935-447c-9f83-3ae3a857cd30' and ambito='hogar'
order by nombre;
```
Esperado (arreglado): `Alquiler 🏠 = 192.25`, `Fondo de emergencia = 362.75`.

- [ ] **Step 2: Limpiar** → `reset role; select set_config('request.jwt.claims', NULL, false);`

- [ ] **Step 3: Impersonar a la pareja → total completo**
```sql
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"d83a9b58-f740-4c77-af01-d3ebf2669938"}', false);
select nombre, monto_actual from public.metas_con_progreso
where hogar_id='5891e9b2-a935-447c-9f83-3ae3a857cd30' and ambito='hogar'
order by nombre;
```
Esperado: `Alquiler 🏠 = 192.25`, `Fondo de emergencia = 362.75`.

- [ ] **Step 4: Limpiar** → `reset role; select set_config('request.jwt.claims', NULL, false);`

- [ ] **Step 5: Personal intacto (no debe cambiar)**

Elige un usuario con al menos una meta personal (csf156 la tiene). Impersónalo y confirma que sus metas personales (`ambito='personal'`) muestran el mismo progreso que antes de la migración:
```sql
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"42c18981-e55f-4271-8f01-e89ab2975f44"}', false);
select nombre, monto_actual from public.metas_con_progreso
where ambito='personal' and user_id='42c18981-e55f-4271-8f01-e89ab2975f44'
order by nombre;
```
Compara contra el total real (SECURITY DEFINER, sin RLS):
```sql
reset role; select set_config('request.jwt.claims', NULL, false);
select m.nombre, coalesce(sum(a.monto),0) as total_real
from public.metas m left join public.aportes_meta a on a.meta_id=m.id
where m.ambito='personal' and m.user_id='42c18981-e55f-4271-8f01-e89ab2975f44'
group by m.nombre order by m.nombre;
```
Esperado: el progreso impersonado == total real para cada meta personal (el personal nunca estuvo roto y sigue igual).

- [ ] **Step 6: PostgREST ve la policy (descarta caché de esquema rancia)**

Con la clave anon pública y un JWT de usuario, un `curl` al REST de `metas_con_progreso` debe devolver el total completo. Si no tienes un JWT de usuario a mano, omite este paso y anótalo — la impersonación por SQL (Steps 1-4) ya prueba la RLS a nivel de base; PostgREST usa la misma RLS. Documenta cuál de las dos vías usaste.

- [ ] **Step 7: Correr el test de contrato**

Corre el contenido completo de `supabase/tests/schema_contract_test.sql` vía `execute_sql` (solo lectura). Esperado: última fila `ALL TESTS PASSED`, y el bloque nuevo de aportes_meta no lanza `FALLO`.

- [ ] **Step 8: Reportar**

Confirma: ambos miembros ven 192.25/362.75; personal sin cambios; contrato en verde. Sin commit (no hay archivos).

---

## Task 6: Commit de docs + PR

**Files:**
- Commit: `docs/superpowers/specs/2026-07-19-aportes-meta-rls-hogar-design.md`, `docs/superpowers/plans/2026-07-19-aportes-meta-rls-hogar.md` (ya en el working tree)

- [ ] **Step 1: Commit de spec y plan**
```bash
git add docs/superpowers/specs/2026-07-19-aportes-meta-rls-hogar-design.md docs/superpowers/plans/2026-07-19-aportes-meta-rls-hogar.md
git commit -m "docs: spec y plan del fix de RLS de aportes_meta (progreso de hogar)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 2: Push + PR**
```bash
git push -u origin fix/aportes-meta-rls-hogar
gh pr create --title "Fix RLS: el progreso de metas de hogar suma a todos los miembros" --body "..."
```
El cuerpo del PR debe dejar claro: (a) es un bug de visualización, el reparto ya funcionaba; (b) la migración YA se aplicó a producción vía apply_migration (esta rama es el registro en git); (c) verificado impersonando a ambos miembros (192.25/362.75), personal intacto, contrato en verde.

- [ ] **Step 3: (Orquestador) mergear** tras revisión, con `gh pr merge <N> --merge` (el usuario autorizó mergear PRs de mejora directo — memoria `nestra-migracion-v1-a-v2`).

---

## Nota post-merge

**No hace falta bump de `SHELL_VERSION` ni deploy de Pages** — el fix es de base de datos. El usuario solo debe **recargar la app online una vez** para que el espejo de IndexedDB de `metas` se refresque con los totales corregidos. Confirmar con el usuario que ya ve el progreso completo del hogar en `#metas` y en el dashboard.

## Self-review (cobertura del spec)

- Bug de visualización (RLS) → Tasks 2 (migración), 4 (aplicar). ✔
- Verificación RED/GREEN con ambos miembros → Tasks 1, 5. ✔
- Personal intacto → Task 5 Step 5. ✔
- Escritura sigue restringida al dueño → policies insert/update/delete en la migración (Task 2); el diseño no las amplía. ✔
- Contrato que vigila la regresión → Task 3, corrido en Task 5 Step 7. ✔
- No tocar distribuir_ahorro / no redistribuir → ninguna task lo toca. ✔
- apply a producción solo por el orquestador → Task 4 marcada explícitamente. ✔
- Sin cambio de cliente / sin SHELL_VERSION → nota post-merge. ✔
- Hueco offline = follow-up, fuera de alcance → declarado en el spec. ✔
