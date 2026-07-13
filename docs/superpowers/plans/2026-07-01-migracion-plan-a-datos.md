# Migración v1→v2 — Plan A: Datos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar los datos reales de los 2 usuarios de la base v1 (`rblxwqdphhmpglxxtgtv`) a la base v2 (`ombnhxueclqfeyjzhroz`), reconstruyendo el hogar compartido y rellenando las columnas nuevas de v2.

**Architecture:** Patrón ETL. Se **extrae** v1 vía Management API (token `sbp_`), se **stagea** en un esquema temporal `mig` dentro de v2, y se **carga** a las tablas reales con SQL `INSERT…SELECT` que remapea `user_id`/`categoria_id` uniéndose a tablas de mapeo. Todo el load corre vía MCP `execute_sql` (rol postgres, bypassa RLS). Mapeo de categorías por `(nombre, tipo)` — sin hardcodear ids.

**Tech Stack:** Supabase (2 proyectos), Management API (`POST /v1/projects/<ref>/database/query`), Auth Admin API, MCP `execute_sql`/`apply_migration`. SQL Postgres.

**Credenciales:** token `sbp_` de cuenta (lectura v1). **service_role key de v2** (crear usuario mezareyes) — solicitar al inicio, no commitear. Refs: v1 `rblxwqdphhmpglxxtgtv`, v2 `ombnhxueclqfeyjzhroz`. Ids: csf156 v1 `aa5a03e9-12fe-4e9f-8900-ced28359db90` / v2 `42c18981-e55f-4271-8f01-e89ab2975f44`; mezareyes v1 `6cb374ae-4450-4f19-bc8c-f2e7f4842982` / v2 = nuevo.

**Convención:** "API v1" = `curl -s -X POST https://api.supabase.com/v1/projects/rblxwqdphhmpglxxtgtv/database/query -H "Authorization: Bearer $SBP" -H "Content-Type: application/json" -d '{"query":"<SQL>"}'`. "MCP v2" = tool `mcp__supabase__execute_sql` sobre el proyecto v2. Scratchpad = el directorio de scratch de la sesión.

---

### Task 1: Backups (v1 export + v2 snapshot)

**Files:** solo scratchpad (sin cambios en repo).

- [ ] **Step 1: Exportar v1 completo a scratchpad**

Para cada tabla con datos, API v1 con `select row_to_json(t) from public.<tabla> t;` y guardar el JSON en `scratchpad/v1_<tabla>.json`:
`profiles`, `categorias`, `categorias_favoritas`, `metas`, `aportes_meta`, `transacciones`.

- [ ] **Step 2: Snapshot de v2 (tablas afectadas) a scratchpad**

MCP v2, guardar cada resultado en `scratchpad/v2_pre_<tabla>.json`:
```sql
select json_agg(t) from public.profiles t;
select json_agg(t) from public.categorias t;
select json_agg(t) from public.categorias_favoritas t;
select json_agg(t) from public.metas t;
select json_agg(t) from public.aportes_meta t;
select json_agg(t) from public.transacciones t;
select json_agg(t) from public.hogares t;
select json_agg(t) from public.hogar_miembros t;
```

- [ ] **Step 3: Verificar los exports**

Confirmar conteos esperados en los archivos: v1 profiles=2, categorias=34, categorias_favoritas=5, metas=5, aportes_meta=2, transacciones=117. Si algún archivo está vacío o el conteo no cuadra, detenerse y re-exportar.

- [ ] **Step 4: Commit (registro del punto de partida)**

No se commitean datos de usuario. Solo registrar en un archivo de bitácora `scratchpad/MIGRACION_LOG.md` la fecha, conteos y refs. (Sin git.)

---

### Task 2: Staging de v1 dentro de v2

**Files:** esquema temporal `mig` en la base v2 (se elimina en Task 12).

- [ ] **Step 1: Crear el esquema y las tablas de staging (espejo exacto de columnas v1)**

MCP v2 (`apply_migration` name `mig_staging` o `execute_sql`):
```sql
create schema if not exists mig;

create table mig.v1_profiles (
  id uuid, user_id uuid, nombre text, aporte_mensual_esperado numeric);

create table mig.v1_categorias (
  id uuid, nombre text, tipo text, limite_mensual numeric,
  color text, estado text, icono text);

create table mig.v1_categorias_favoritas (
  id uuid, user_id uuid, categoria_id uuid, created_at timestamptz);

create table mig.v1_metas (
  id uuid, nombre text, tipo text, horizonte text, ambito text, user_id uuid,
  monto_objetivo numeric, monto_actual numeric, fecha_inicio date, fecha_limite date,
  estado text, nota text, importancia int, es_fondo_emergencia boolean, categoria_id uuid);

create table mig.v1_aportes_meta (
  id uuid, meta_id uuid, transaccion_id uuid, monto numeric,
  peso_aplicado numeric, created_at timestamptz);

create table mig.v1_transacciones (
  id uuid, fecha date, tipo text, ambito text, user_id uuid, categoria_id uuid,
  monto numeric, nota text, aporte_id uuid, created_at timestamptz, es_aporte_directo boolean);
```

- [ ] **Step 2: Cargar cada JSON de v1 en su tabla de staging**

Para cada tabla, tomar el JSON de `scratchpad/v1_<tabla>.json` (un array) y MCP v2:
```sql
insert into mig.v1_transacciones
select * from json_populate_recordset(null::mig.v1_transacciones, '<contenido de v1_transacciones.json>'::json);
```
Repetir para las 6 tablas con su JSON respectivo. (Si un JSON es grande, dividir en 2 inserts.)

- [ ] **Step 3: Verificar conteos de staging**

MCP v2:
```sql
select 'profiles' t, count(*) from mig.v1_profiles
union all select 'categorias', count(*) from mig.v1_categorias
union all select 'favoritas', count(*) from mig.v1_categorias_favoritas
union all select 'metas', count(*) from mig.v1_metas
union all select 'aportes', count(*) from mig.v1_aportes_meta
union all select 'transacciones', count(*) from mig.v1_transacciones;
```
Expected: 2, 34, 5, 2 (aportes), 117 (tx), 5 (metas). Si no cuadra, recargar.

---

### Task 3: Crear usuario mezareyes + mapa de usuarios

**Files:** base v2 (auth + `mig`).

- [ ] **Step 1: Crear el usuario en v2 (Auth Admin API)**

```bash
curl -s -X POST "https://ombnhxueclqfeyjzhroz.supabase.co/auth/v1/admin/users" \
  -H "apikey: $V2_SERVICE_ROLE" -H "Authorization: Bearer $V2_SERVICE_ROLE" \
  -H "Content-Type: application/json" \
  -d '{"email":"mezareyesdarling@gmail.com","password":"<TEMP_PASSWORD>","email_confirm":true}'
```
Capturar el `id` devuelto → es `MEZA_V2`. Comunicar `<TEMP_PASSWORD>` al usuario por canal seguro.

- [ ] **Step 2: Limpiar filas auto-sembradas por el trigger `handle_new_user`**

Crear el usuario pudo disparar `handle_new_user` (ver `supabase/migrations/20260605_harden_handle_new_user.sql`). MCP v2, inspeccionar y limpiar lo auto-creado para `MEZA_V2`:
```sql
select 'profiles' t, count(*) from public.profiles where user_id = '<MEZA_V2>'
union all select 'categorias', count(*) from public.categorias where user_id = '<MEZA_V2>'
union all select 'favoritas', count(*) from public.categorias_favoritas where user_id = '<MEZA_V2>';
delete from public.categorias_favoritas where user_id = '<MEZA_V2>';
delete from public.categorias where user_id = '<MEZA_V2>';
delete from public.profiles where user_id = '<MEZA_V2>';
```

- [ ] **Step 3: Construir la tabla de mapeo de usuarios**

MCP v2:
```sql
create table mig.user_map (v1_id uuid primary key, v2_id uuid not null);
insert into mig.user_map values
  ('aa5a03e9-12fe-4e9f-8900-ced28359db90','42c18981-e55f-4271-8f01-e89ab2975f44'),
  ('6cb374ae-4450-4f19-bc8c-f2e7f4842982','<MEZA_V2>');
```

- [ ] **Step 4: Verificar**

MCP v2: `select * from mig.user_map;` → 2 filas, `MEZA_V2` es un uuid válido presente en `auth.users`.

---

### Task 4: Borrar datos de prueba de csf156 en v2

**Files:** base v2.

- [ ] **Step 1: Borrar (orden inverso a FKs) las filas de csf156 de prueba**

MCP v2 (`C = 42c18981-e55f-4271-8f01-e89ab2975f44`):
```sql
delete from public.aportes_meta where user_id = '42c18981-e55f-4271-8f01-e89ab2975f44';
delete from public.transacciones where user_id = '42c18981-e55f-4271-8f01-e89ab2975f44';
delete from public.categorias_favoritas where user_id = '42c18981-e55f-4271-8f01-e89ab2975f44';
delete from public.metas where user_id = '42c18981-e55f-4271-8f01-e89ab2975f44';
delete from public.categorias where user_id = '42c18981-e55f-4271-8f01-e89ab2975f44';
delete from public.profiles where user_id = '42c18981-e55f-4271-8f01-e89ab2975f44';
```
(No tocar categorías globales `user_id is null` ni el usuario `nestra.pwa.test`.)

- [ ] **Step 2: Verificar limpieza**

MCP v2:
```sql
select 'tx' t, count(*) from public.transacciones where user_id='42c18981-e55f-4271-8f01-e89ab2975f44'
union all select 'metas', count(*) from public.metas where user_id='42c18981-e55f-4271-8f01-e89ab2975f44'
union all select 'cats', count(*) from public.categorias where user_id='42c18981-e55f-4271-8f01-e89ab2975f44'
union all select 'prof', count(*) from public.profiles where user_id='42c18981-e55f-4271-8f01-e89ab2975f44';
```
Expected: 0, 0, 0, 0. Categorías globales intactas: `select count(*) from public.categorias where user_id is null;` → 26.

---

### Task 5: Reconstruir el hogar

**Files:** base v2 (`hogares`, `hogar_miembros`, `mig`).

- [ ] **Step 1: Crear el hogar y registrar su id en mig**

MCP v2:
```sql
create table mig.hogar (id uuid);
with h as (
  insert into public.hogares (nombre, creado_por)
  values ('Nuestro hogar','42c18981-e55f-4271-8f01-e89ab2975f44')
  returning id)
insert into mig.hogar select id from h;
```

- [ ] **Step 2: Añadir los 2 miembros**

MCP v2:
```sql
insert into public.hogar_miembros (hogar_id, user_id, rol)
select (select id from mig.hogar), '42c18981-e55f-4271-8f01-e89ab2975f44', 'creador';
insert into public.hogar_miembros (hogar_id, user_id, rol)
select (select id from mig.hogar), v2_id, 'miembro'
from mig.user_map where v1_id = '6cb374ae-4450-4f19-bc8c-f2e7f4842982';
```

- [ ] **Step 3: Verificar**

MCP v2: `select count(*) from public.hogar_miembros where hogar_id = (select id from mig.hogar);` → 2. `select id from mig.hogar;` → 1 uuid.

---

### Task 6: Mapa de categorías (globales + copias per-usuario)

**Files:** base v2 (`categorias`, `mig`).

- [ ] **Step 1: Mapear las 26 categorías v1 que coinciden con globales v2**

MCP v2 (mapa `(v1_cat_id) → v2_global_id` por nombre+tipo):
```sql
create table mig.cat_global (v1_id uuid primary key, v2_id uuid not null);
insert into mig.cat_global
select s.id, g.id
from mig.v1_categorias s
join public.categorias g
  on g.user_id is null and lower(g.nombre)=lower(s.nombre) and g.tipo=s.tipo;
```
Verificar: `select count(*) from mig.cat_global;` → 26.

- [ ] **Step 2: Determinar qué categorías custom necesita cada usuario**

Custom = categorías v1 sin match global. Para cada custom, un dueño por cada usuario que la referencia en transacciones ∪ metas ∪ favoritas. "Bicicleta" (0 referencias) se excluye naturalmente. MCP v2:
```sql
create table mig.cat_custom_needed (v1_cat_id uuid, v1_user_id uuid, nombre text, tipo text);
insert into mig.cat_custom_needed
select distinct c.id, u.uid, c.nombre, c.tipo
from mig.v1_categorias c
join lateral (
  select t.user_id uid from mig.v1_transacciones t where t.categoria_id=c.id
  union select m.user_id from mig.v1_metas m where m.categoria_id=c.id and m.user_id is not null
  union select f.user_id from mig.v1_categorias_favoritas f where f.categoria_id=c.id
) u on true
where c.id not in (select v1_id from mig.cat_global);
```
Nota: la meta de hogar con `user_id null` que usa "Ahorro" se resuelve aparte (dueño csf156) en Step 3.

- [ ] **Step 3: Añadir la necesidad de csf156 para la meta de hogar que usa "Ahorro"**

La meta hogar "Alquiler 🏠" (v1 user_id null, categoría Ahorro) tendrá dueño csf156 → csf156 necesita su copia de Ahorro. MCP v2:
```sql
insert into mig.cat_custom_needed
select c.id, '42c18981-e55f-4271-8f01-e89ab2975f44', c.nombre, c.tipo
from mig.v1_categorias c
where lower(c.nombre)='ahorro'
  and not exists (
    select 1 from mig.cat_custom_needed n
    where n.v1_cat_id=c.id and n.v1_user_id='42c18981-e55f-4271-8f01-e89ab2975f44');
```
(Idempotente; si csf156 ya usa Ahorro en tx, no duplica.)

- [ ] **Step 4: Crear las copias per-usuario y construir el mapa custom**

MCP v2 (crea una categoría real por (custom, usuario-v2) y registra el mapeo `(v1_cat_id, v2_user_id) → nueva_id`):
```sql
create table mig.cat_custom (v1_cat_id uuid, v2_user_id uuid, v2_id uuid);
with ins as (
  insert into public.categorias (nombre, tipo, estado, user_id, esencial)
  select n.nombre, n.tipo, 'activa', um.v2_id, true
  from mig.cat_custom_needed n
  join mig.user_map um on um.v1_id = n.v1_user_id
  returning id, nombre, tipo, user_id)
insert into mig.cat_custom (v1_cat_id, v2_user_id, v2_id)
select n.v1_cat_id, um.v2_id, i.id
from mig.cat_custom_needed n
join mig.user_map um on um.v1_id = n.v1_user_id
join ins i on i.user_id=um.v2_id and lower(i.nombre)=lower(n.nombre) and i.tipo=n.tipo;
```
Verificar: csf156 tiene {Ahorro, Chucherias}; mezareyes tiene {Ahorro, Chucherias, Telefonia, Aporte Mutuo, Clases de Bici, Grooming Home, Veterinaria}:
```sql
select um.v1_id, c.nombre, c.tipo from public.categorias c
join mig.user_map um on um.v2_id=c.user_id
where c.id in (select v2_id from mig.cat_custom) order by um.v1_id, c.nombre;
```

- [ ] **Step 5: Función de resolución de categoría (helper de mapeo)**

Crear una vista de mapeo unificada `(v1_cat_id, v2_user_id) → v2_cat_id` que prioriza global y cae a la copia per-usuario. MCP v2:
```sql
create or replace view mig.cat_resolve as
select cg.v1_id as v1_cat_id, um.v2_id as v2_user_id, cg.v2_id as v2_cat_id
from mig.cat_global cg cross join mig.user_map um
union all
select cc.v1_cat_id, cc.v2_user_id, cc.v2_id from mig.cat_custom cc;
```
(Para una fila v1 con `categoria_id=X` y dueño-v2=U, el v2_cat_id = `select v2_cat_id from mig.cat_resolve where v1_cat_id=X and v2_user_id=U`.)

---

### Task 7: Migrar profiles

**Files:** base v2 (`profiles`).

- [ ] **Step 1: Insertar los 2 profiles remapeados con columnas nuevas**

MCP v2:
```sql
insert into public.profiles (user_id, nombre, aporte_mensual_esperado, moneda, onboarding_completado)
select um.v2_id, p.nombre, p.aporte_mensual_esperado, 'PEN', true
from mig.v1_profiles p join mig.user_map um on um.v1_id=p.user_id;
```

- [ ] **Step 2: Verificar**

MCP v2: `select user_id, nombre, moneda, onboarding_completado from public.profiles order by nombre;` → 2 filas, moneda PEN, onboarding true, user_id = ids v2.

---

### Task 8: Migrar metas

**Files:** base v2 (`metas`).

- [ ] **Step 1: Migrar las 2 metas de hogar (v1 user_id null)**

Dueño csf156, `hogar_id` = hogar, `ambito='hogar'`. Categoría resuelta contra csf156. MCP v2 (preserva id original):
```sql
insert into public.metas
  (id, nombre, tipo, horizonte, ambito, user_id, monto_objetivo, monto_actual,
   fecha_inicio, fecha_limite, estado, nota, importancia, es_fondo_emergencia,
   categoria_id, hogar_id, updated_at)
select m.id, m.nombre, m.tipo, m.horizonte, 'hogar',
  '42c18981-e55f-4271-8f01-e89ab2975f44', m.monto_objetivo, m.monto_actual,
  m.fecha_inicio, m.fecha_limite, m.estado, m.nota, m.importancia, m.es_fondo_emergencia,
  (select r.v2_cat_id from mig.cat_resolve r
     where r.v1_cat_id=m.categoria_id and r.v2_user_id='42c18981-e55f-4271-8f01-e89ab2975f44'),
  (select id from mig.hogar), now()
from mig.v1_metas m
where m.user_id is null;
```

- [ ] **Step 2: Migrar las 3 metas personales**

MCP v2:
```sql
insert into public.metas
  (id, nombre, tipo, horizonte, ambito, user_id, monto_objetivo, monto_actual,
   fecha_inicio, fecha_limite, estado, nota, importancia, es_fondo_emergencia,
   categoria_id, hogar_id, updated_at)
select m.id, m.nombre, m.tipo, m.horizonte, m.ambito, um.v2_id,
  m.monto_objetivo, m.monto_actual, m.fecha_inicio, m.fecha_limite, m.estado, m.nota,
  m.importancia, m.es_fondo_emergencia,
  (select r.v2_cat_id from mig.cat_resolve r
     where r.v1_cat_id=m.categoria_id and r.v2_user_id=um.v2_id),
  null, now()
from mig.v1_metas m join mig.user_map um on um.v1_id=m.user_id;
```

- [ ] **Step 2b: Ajustar `ambito` de metas hogar si el CHECK lo requiere**

`metas.ambito` CHECK v2 = `('personal','hogar')`; las hogar usan 'hogar' (ya seteado). `metas.tipo` CHECK v2 = `('ahorro','reduccion_gasto','aporte_hogar')`; los valores v1 son `ahorro` (válido). Si alguna fila v1 trae un tipo fuera del CHECK, el insert fallará — en ese caso revisar el valor y mapear (`aporte_hogar` si es meta de hogar de tipo aporte). Verificar primero: `select distinct tipo from mig.v1_metas;` esperado solo `ahorro`.

- [ ] **Step 3: Verificar**

MCP v2:
```sql
select ambito, count(*) from public.metas
where user_id in (select v2_id from mig.user_map) or hogar_id=(select id from mig.hogar)
group by ambito;
```
Expected: hogar 2, personal 3. Total 5.

---

### Task 9: Migrar transacciones

**Files:** base v2 (`transacciones`).

- [ ] **Step 1: Insertar las 117 tx remapeadas (user_id, categoria_id, hogar_id)**

`hogar_id` = hogar para ambito hogar, null si personal. Categoría resuelta contra el autor. `updated_at = created_at`. MCP v2 (preserva id):
```sql
insert into public.transacciones
  (id, fecha, tipo, ambito, user_id, categoria_id, monto, nota, aporte_id,
   es_aporte_directo, created_at, updated_at, hogar_id)
select t.id, t.fecha, t.tipo, t.ambito, um.v2_id,
  (select r.v2_cat_id from mig.cat_resolve r
     where r.v1_cat_id=t.categoria_id and r.v2_user_id=um.v2_id),
  t.monto, t.nota, t.aporte_id, t.es_aporte_directo, t.created_at, t.created_at,
  case when t.ambito='hogar' then (select id from mig.hogar) else null end
from mig.v1_transacciones t join mig.user_map um on um.v1_id=t.user_id;
```

- [ ] **Step 2: Verificar conteos y sumas por usuario**

MCP v2:
```sql
select um.v1_id, count(*) tx, sum(t.monto) total
from public.transacciones t join mig.user_map um on um.v2_id=t.user_id
group by um.v1_id;
```
Comparar contra v1 (API v1): `select user_id, count(*), sum(monto) from public.transacciones group by user_id;`. csf156 17 tx, mezareyes 100 tx; las sumas deben coincidir. Además: 0 categoria_id nulos inesperados (`select count(*) from public.transacciones t join mig.user_map um on um.v2_id=t.user_id where t.categoria_id is null;` debe ser 0 salvo tx v1 que ya tuvieran categoria null — verificar contra v1).

---

### Task 10: Migrar aportes_meta y favoritas

**Files:** base v2 (`aportes_meta`, `categorias_favoritas`).

- [ ] **Step 1: Migrar aportes_meta (user_id = autor de la transacción asociada)**

MCP v2 (preserva id; user_id derivado de la tx ya migrada):
```sql
insert into public.aportes_meta (id, meta_id, transaccion_id, monto, peso_aplicado, created_at, user_id)
select a.id, a.meta_id, a.transaccion_id, a.monto, a.peso_aplicado, a.created_at, tx.user_id
from mig.v1_aportes_meta a
join public.transacciones tx on tx.id = a.transaccion_id;
```
(Las 2 tx asociadas ya se migraron en Task 9 con su user_id v2; se hereda de ahí.)

- [ ] **Step 2: Migrar categorias_favoritas (remapear user_id + categoria_id)**

MCP v2:
```sql
insert into public.categorias_favoritas (user_id, categoria_id)
select um.v2_id,
  (select r.v2_cat_id from mig.cat_resolve r
     where r.v1_cat_id=f.categoria_id and r.v2_user_id=um.v2_id)
from mig.v1_categorias_favoritas f join mig.user_map um on um.v1_id=f.user_id;
```

- [ ] **Step 3: Verificar**

MCP v2:
```sql
select 'aportes' t, count(*) from public.aportes_meta where user_id in (select v2_id from mig.user_map)
union all select 'favoritas', count(*) from public.categorias_favoritas where user_id in (select v2_id from mig.user_map);
```
Expected: aportes 2, favoritas 5. Sin categoria_id null en favoritas: `select count(*) from public.categorias_favoritas f join mig.user_map um on um.v2_id=f.user_id where f.categoria_id is null;` → 0.

---

### Task 11: Verificación integral + smoke en pages.dev

**Files:** ninguno (solo aserciones).

- [ ] **Step 1: Aserciones de integridad FK (ninguna referencia colgando)**

MCP v2 — todo debe dar 0:
```sql
select count(*) from public.transacciones t where t.categoria_id is not null and not exists (select 1 from public.categorias c where c.id=t.categoria_id);
select count(*) from public.metas m where m.categoria_id is not null and not exists (select 1 from public.categorias c where c.id=m.categoria_id);
select count(*) from public.metas m where m.hogar_id is not null and not exists (select 1 from public.hogares h where h.id=m.hogar_id);
select count(*) from public.transacciones t where t.hogar_id is not null and not exists (select 1 from public.hogares h where h.id=t.hogar_id);
select count(*) from public.aportes_meta a where not exists (select 1 from public.metas m where m.id=a.meta_id) or not exists (select 1 from public.transacciones tt where tt.id=a.transaccion_id);
```

- [ ] **Step 2: Aserciones de conteo global vs v1**

MCP v2 (para los 2 usuarios migrados): transacciones=117, metas=5, aportes=2, favoritas=5, profiles=2, hogar_miembros=2. Sumas de monto por usuario coinciden con v1 (comparar con API v1).

- [ ] **Step 3: Chequeo de RLS por usuario**

MCP v2, simular cada usuario y confirmar visibilidad correcta:
```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"42c18981-e55f-4271-8f01-e89ab2975f44","role":"authenticated"}';
select count(*) from public.transacciones; -- csf156: 17 (sus personales+hogar visibles según RLS)
reset role;
```
Repetir con `MEZA_V2`. Confirmar que cada uno ve sus transacciones y no las del otro (salvo las de hogar según la política). Documentar los conteos observados en `MIGRACION_LOG.md`.

- [ ] **Step 4: Smoke en el navegador (pages.dev = v2)**

Con `preview`/navegador real, entrar a `https://nestra-8rl.pages.dev`:
- Login csf156 (su contraseña v2 actual) → ve sus 17 tx, sus metas, el hogar "Nuestro hogar", la meta "Alquiler 🏠".
- Login mezareyes (contraseña temporal) → ve sus 100 tx, sus metas, el mismo hogar.
- Sin errores en consola. **Punto de aprobación del usuario antes de Fase B (Plan B).**

- [ ] **Step 5: Registrar resultado**

Anotar en `scratchpad/MIGRACION_LOG.md`: conteos finales, resultado del smoke, y "LISTO PARA PLAN B" o los problemas encontrados.

---

### Task 12: Limpieza del staging

**Files:** base v2 (elimina esquema `mig`).

- [ ] **Step 1: Confirmar que Task 11 pasó y hay backup**

Verificar que `scratchpad/v2_pre_*.json` existen (rollback disponible) y que Task 11 dio OK. Si hay dudas, NO limpiar todavía.

- [ ] **Step 2: Eliminar el esquema de staging**

MCP v2: `drop schema if exists mig cascade;`

- [ ] **Step 3: Verificar**

MCP v2: `select count(*) from information_schema.schemata where schema_name='mig';` → 0. Los datos reales en `public.*` intactos (re-verificar transacciones=117 para los 2 usuarios).

---

## Self-Review

**Cobertura del spec (Fase A):**
- A0 backup → Task 1. ✓
- A1 crear mezareyes + caveat trigger → Task 3 (Steps 1-2). ✓
- A2 borrar prueba csf156 → Task 4. ✓
- A3 reconstruir hogar → Task 5. ✓
- A4 mapa categorías (26 global + custom per-usuario, Bicicleta omitida) → Task 6. ✓
- A5 migrar filas (profiles/metas/transacciones/aportes/favoritas + columnas nuevas) → Tasks 7-10. ✓
- A6 verificación (conteos/FK/RLS/smoke) → Task 11. ✓
- Staging + limpieza → Tasks 2, 12. ✓

**Placeholders:** los `<MEZA_V2>`, `<TEMP_PASSWORD>`, `<contenido de …json>`, `$SBP`, `$V2_SERVICE_ROLE` son valores en tiempo de ejecución (ids/credenciales/datos), no placeholders de lógica. Todo el SQL de transformación está completo.

**Consistencia de nombres/tipos:** `mig.user_map(v1_id,v2_id)`, `mig.cat_global(v1_id,v2_id)`, `mig.cat_custom(v1_cat_id,v2_user_id,v2_id)`, `mig.cat_resolve(v1_cat_id,v2_user_id,v2_cat_id)`, `mig.hogar(id)` usados consistentemente en Tasks 6-10. Ids de usuario (csf156 v2 `42c18981…`) idénticos en todas las tasks. Preservación de ids originales en metas/tx/aportes mantiene las cadenas FK (`aportes_meta.transaccion_id`→`transacciones.id`, `.meta_id`→`metas.id`).

**Riesgo anotado:** el CHECK de `metas.tipo` (Step 8.2b) y posibles filas v1 con categoría null se verifican explícitamente antes de asumir éxito.
