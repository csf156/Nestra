# Fase 6 — Hogar compartido — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el hogar compartido opt-in de pareja: dos usuarios se emparejan por código de 6 dígitos y comparten transacciones/metas marcadas `ambito='hogar'`, con RLS compartida, balance "quién debe qué", disolución por % de aporte y realtime.

**Architecture:** Se reusa la columna existente `ambito` (`'hogar'`=compartido) y se añade `hogar_id` para decir CUÁL hogar. La RLS compartida usa un helper `auth_hogar_id()` `SECURITY DEFINER` para evitar recursión. Toda mutación sensible (crear/unir/saldar/disolver) va por RPC `SECURITY DEFINER`. Un trigger fuerza el invariante `ambito ↔ hogar_id` e impide inyección cross-hogar.

**Tech Stack:** Postgres + Supabase (RLS, RPC, Realtime), JS vanilla ESM (node:test para lógica pura), PWA sin build.

**Spec:** `docs/superpowers/specs/2026-06-29-fase6-hogar-compartido-design.md`

**Regla de seguridad:** NINGUNA migración ni policy se aplica a producción. Todo va a la instancia Supabase v2 y el SQL se revisa manualmente antes de aplicar. Los tests de RLS de 3 usuarios deben pasar antes de cerrar la fase.

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `supabase/migrations/20260629_fase6_hogares.sql` | Crear | Tablas, columna `hogar_id`, trigger invariante, `auth_hogar_id()`, RLS, RPCs. |
| `supabase/tests/hogar_rls_test.sql` | Crear | Suite RLS 3 usuarios (A,B en hogar; C fuera) + RPCs edge cases. |
| `js/hogar-balance.js` | Crear | Lógica pura: balance 50/50 + reparto de disolución. Dual-export (window + ESM). |
| `test/hogar-balance.test.mjs` | Crear | Tests node:test de la lógica pura. |
| `js/db.js` | Modificar | Wrappers de los RPCs nuevos + helpers de estado de hogar + suscripción realtime. |
| `views/hogar.html` | Crear | Vista `#hogar`: crear/unir, miembros, código, balance, saldar, disolver. |
| `index.html` | Modificar | Registrar ruta `#hogar` + entrada de nav + card de balance en dashboard. |
| `sw.js` | Modificar | Precache `views/hogar.html` + `js/hogar-balance.js`; bump `SHELL_VERSION`. |

---

## Task 1: Migración SQL — esquema base (tablas + columna hogar_id)

**Files:**
- Create: `supabase/migrations/20260629_fase6_hogares.sql`

- [ ] **Step 1: Escribir la sección de tablas y columna**

Crear el archivo con este contenido inicial (se irá ampliando en Tasks 2-4):

```sql
-- supabase/migrations/20260629_fase6_hogares.sql
-- Fase 6 — Hogar compartido (pareja). Aplicar SOLO en la instancia v2.
-- Idempotente. NUNCA correr en producción sin revisión manual.

begin;

-- ── Tablas de hogar ──────────────────────────────────────────────────
create table if not exists public.hogares (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  creado_por  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.hogar_miembros (
  id        uuid primary key default gen_random_uuid(),
  hogar_id  uuid not null references public.hogares(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  rol       text not null check (rol in ('creador','miembro')),
  joined_at timestamptz not null default now(),
  unique (user_id),
  unique (hogar_id, user_id)
);
create index if not exists idx_hogar_miembros_hogar on public.hogar_miembros (hogar_id);

create table if not exists public.hogar_codigos (
  id         uuid primary key default gen_random_uuid(),
  hogar_id   uuid not null references public.hogares(id) on delete cascade,
  codigo     char(6) not null,
  expira_at  timestamptz not null,
  usado      boolean not null default false,
  created_at timestamptz not null default now()
);
-- Solo un código activo (no usado y no expirado) puede existir por valor:
create unique index if not exists idx_hogar_codigos_activo
  on public.hogar_codigos (codigo) where usado = false;

create table if not exists public.hogar_liquidaciones (
  id         uuid primary key default gen_random_uuid(),
  hogar_id   uuid not null references public.hogares(id) on delete cascade,
  de_user    uuid not null references auth.users(id),
  a_user     uuid not null references auth.users(id),
  monto      numeric(10,2) not null check (monto > 0),
  fecha      date not null default current_date,
  nota       text,
  created_at timestamptz not null default now()
);
create index if not exists idx_hogar_liquidaciones_hogar on public.hogar_liquidaciones (hogar_id);

-- ── Columna hogar_id en transacciones y metas ────────────────────────
alter table public.transacciones add column if not exists hogar_id uuid references public.hogares(id) on delete set null;
alter table public.metas         add column if not exists hogar_id uuid references public.hogares(id) on delete set null;
create index if not exists idx_transacciones_hogar_id on public.transacciones (hogar_id) where hogar_id is not null;
create index if not exists idx_metas_hogar_id          on public.metas (hogar_id) where hogar_id is not null;

-- ── Trigger de cap 2 miembros ────────────────────────────────────────
create or replace function public.hogar_check_cap()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.hogar_miembros where hogar_id = new.hogar_id) >= 2 then
    raise exception 'El hogar % ya tiene 2 miembros', new.hogar_id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_hogar_cap on public.hogar_miembros;
create trigger trg_hogar_cap before insert on public.hogar_miembros
  for each row execute function public.hogar_check_cap();

commit;
```

- [ ] **Step 2: Validar sintaxis SQL localmente**

Run: `cat supabase/migrations/20260629_fase6_hogares.sql | head -5`
Expected: imprime el header (verifica que el archivo existe; la ejecución real se hace en el SQL Editor de v2 tras revisión manual).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260629_fase6_hogares.sql
git commit -m "feat(fase6): tablas hogar + columna hogar_id (schema base)"
```

---

## Task 2: Migración SQL — helper auth_hogar_id() + trigger de invariante

**Files:**
- Modify: `supabase/migrations/20260629_fase6_hogares.sql` (añadir bloque al final, antes del fin del archivo)

- [ ] **Step 1: Añadir el helper SECURITY DEFINER y el trigger de invariante**

Agregar al final del archivo:

```sql
-- ── Helper: hogar del usuario actual (evita recursión de RLS) ─────────
begin;

create or replace function public.auth_hogar_id()
returns uuid language sql stable security definer set search_path = public as $$
  select hogar_id from public.hogar_miembros where user_id = (select auth.uid()) limit 1;
$$;
grant execute on function public.auth_hogar_id() to authenticated;

-- ── Trigger de invariante ambito ↔ hogar_id en transacciones/metas ────
-- ambito='hogar'    ⇒ hogar_id = hogar del que escribe (impide inyección).
-- ambito='personal' ⇒ hogar_id = NULL.
create or replace function public.sync_hogar_id()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_hogar uuid := public.auth_hogar_id();
begin
  if new.ambito = 'hogar' then
    if v_hogar is null then
      raise exception 'No puedes marcar ambito=hogar sin pertenecer a un hogar';
    end if;
    new.hogar_id := v_hogar;
  else
    new.hogar_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_hogar_id_tx on public.transacciones;
create trigger trg_sync_hogar_id_tx before insert or update on public.transacciones
  for each row execute function public.sync_hogar_id();

drop trigger if exists trg_sync_hogar_id_metas on public.metas;
create trigger trg_sync_hogar_id_metas before insert or update on public.metas
  for each row execute function public.sync_hogar_id();

commit;
```

- [ ] **Step 2: Verificar que el bloque quedó en el archivo**

Run: `grep -n "auth_hogar_id\|sync_hogar_id" supabase/migrations/20260629_fase6_hogares.sql`
Expected: muestra las definiciones de función y los triggers.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260629_fase6_hogares.sql
git commit -m "feat(fase6): helper auth_hogar_id() SECURITY DEFINER + trigger invariante ambito/hogar_id"
```

---

## Task 3: Migración SQL — RLS compartida

**Files:**
- Modify: `supabase/migrations/20260629_fase6_hogares.sql` (añadir bloque al final)

- [ ] **Step 1: Reescribir las policies SELECT de transacciones/metas y crear policies de las tablas de hogar**

Agregar al final del archivo:

```sql
-- ── RLS compartida ───────────────────────────────────────────────────
begin;

-- transacciones: ver propias O las del hogar (ambito='hogar').
drop policy if exists "transacciones_select" on public.transacciones;
create policy "transacciones_select" on public.transacciones for select
  to authenticated using (
    (select auth.uid()) = user_id
    or (hogar_id is not null and hogar_id = (select public.auth_hogar_id()))
  );
-- insert/update/delete siguen siendo solo-propias (el trigger fija hogar_id).
-- (Las policies de insert/update/delete de Fase 0 ya exigen auth.uid()=user_id;
--  no se tocan.)

-- metas: ver propias O las del hogar.
drop policy if exists "metas_select" on public.metas;
create policy "metas_select" on public.metas for select
  to authenticated using (
    (select auth.uid()) = user_id
    or (hogar_id is not null and hogar_id = (select public.auth_hogar_id()))
  );

-- hogares: visible si soy miembro.
alter table public.hogares enable row level security;
drop policy if exists "hogares_select" on public.hogares;
create policy "hogares_select" on public.hogares for select
  to authenticated using (id = (select public.auth_hogar_id()));

-- hogar_miembros: visibles los miembros de mi hogar.
alter table public.hogar_miembros enable row level security;
drop policy if exists "hogar_miembros_select" on public.hogar_miembros;
create policy "hogar_miembros_select" on public.hogar_miembros for select
  to authenticated using (hogar_id = (select public.auth_hogar_id()));

-- hogar_codigos: visibles solo a miembros (la validación de unión va por RPC).
alter table public.hogar_codigos enable row level security;
drop policy if exists "hogar_codigos_select" on public.hogar_codigos;
create policy "hogar_codigos_select" on public.hogar_codigos for select
  to authenticated using (hogar_id = (select public.auth_hogar_id()));

-- hogar_liquidaciones: visibles a miembros del hogar.
alter table public.hogar_liquidaciones enable row level security;
drop policy if exists "hogar_liquidaciones_select" on public.hogar_liquidaciones;
create policy "hogar_liquidaciones_select" on public.hogar_liquidaciones for select
  to authenticated using (hogar_id = (select public.auth_hogar_id()));

-- Sin policies de INSERT/UPDATE/DELETE directas en las tablas de hogar:
-- toda mutación pasa por los RPCs SECURITY DEFINER (Task 4).

commit;
```

- [ ] **Step 2: Verificar**

Run: `grep -n "create policy" supabase/migrations/20260629_fase6_hogares.sql`
Expected: lista las policies de transacciones_select, metas_select, y las 4 tablas de hogar.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260629_fase6_hogares.sql
git commit -m "feat(fase6): RLS compartida por hogar_id (select propio OR hogar)"
```

---

## Task 4: Migración SQL — RPCs (crear / generar_codigo / unirse / saldar / disolver)

**Files:**
- Modify: `supabase/migrations/20260629_fase6_hogares.sql` (añadir bloque al final)

- [ ] **Step 1: Añadir los 5 RPCs SECURITY DEFINER**

Agregar al final del archivo:

```sql
-- ── RPCs de hogar (SECURITY DEFINER) ─────────────────────────────────
begin;

-- Genera un código de 6 dígitos único entre los activos.
create or replace function public._gen_codigo_hogar(p_hogar_id uuid)
returns char(6) language plpgsql security definer set search_path = public as $$
declare v_cod char(6); v_try int := 0;
begin
  -- invalida códigos activos previos del hogar
  update public.hogar_codigos set usado = true
   where hogar_id = p_hogar_id and usado = false;
  loop
    v_cod := lpad((floor(random()*1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.hogar_codigos where codigo = v_cod and usado = false);
    v_try := v_try + 1;
    if v_try > 50 then raise exception 'No se pudo generar un código único'; end if;
  end loop;
  insert into public.hogar_codigos (hogar_id, codigo, expira_at)
  values (p_hogar_id, v_cod, now() + interval '24 hours');
  return v_cod;
end;
$$;

create or replace function public.crear_hogar(p_nombre text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := (select auth.uid()); v_hogar uuid; v_cod char(6);
begin
  if exists (select 1 from public.hogar_miembros where user_id = v_uid) then
    raise exception 'Ya perteneces a un hogar; sal primero';
  end if;
  insert into public.hogares (nombre, creado_por) values (coalesce(nullif(trim(p_nombre),''),'Hogar'), v_uid)
    returning id into v_hogar;
  insert into public.hogar_miembros (hogar_id, user_id, rol) values (v_hogar, v_uid, 'creador');
  v_cod := public._gen_codigo_hogar(v_hogar);
  return jsonb_build_object('hogar_id', v_hogar, 'codigo', v_cod);
end;
$$;

create or replace function public.generar_codigo()
returns char(6) language plpgsql security definer set search_path = public as $$
declare v_hogar uuid := public.auth_hogar_id();
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  return public._gen_codigo_hogar(v_hogar);
end;
$$;

create or replace function public.unirse_hogar(p_codigo char(6))
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := (select auth.uid()); v_row public.hogar_codigos%rowtype;
begin
  if exists (select 1 from public.hogar_miembros where user_id = v_uid) then
    raise exception 'Ya perteneces a un hogar; sal primero';
  end if;
  select * into v_row from public.hogar_codigos
   where codigo = p_codigo and usado = false and expira_at > now() limit 1;
  if not found then raise exception 'Código inválido o expirado'; end if;
  if (select count(*) from public.hogar_miembros where hogar_id = v_row.hogar_id) >= 2 then
    raise exception 'El hogar ya está completo';
  end if;
  insert into public.hogar_miembros (hogar_id, user_id, rol) values (v_row.hogar_id, v_uid, 'miembro');
  update public.hogar_codigos set usado = true where id = v_row.id;
  -- backfill: filas ambito='hogar' previas del que se une se asocian al hogar
  update public.transacciones set hogar_id = v_row.hogar_id where user_id = v_uid and ambito = 'hogar';
  update public.metas         set hogar_id = v_row.hogar_id where user_id = v_uid and ambito = 'hogar';
  return jsonb_build_object('hogar_id', v_row.hogar_id);
end;
$$;

-- Registra una liquidación en la dirección del neto que pasa el cliente.
create or replace function public.saldar_hogar(p_de uuid, p_a uuid, p_monto numeric, p_nota text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := (select auth.uid()); v_hogar uuid := public.auth_hogar_id(); v_id uuid;
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  if v_uid not in (p_de, p_a) then raise exception 'No autorizado'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'Monto inválido'; end if;
  insert into public.hogar_liquidaciones (hogar_id, de_user, a_user, monto, nota)
  values (v_hogar, p_de, p_a, round(p_monto,2), p_nota) returning id into v_id;
  return v_id;
end;
$$;

-- Disuelve el hogar: reparte el ahorro neto por % de aporte de ingresos,
-- reasigna metas/fondo de hogar al creador, registra liquidación final,
-- borra membresías y el hogar. Devuelve el statement.
create or replace function public.disolver_hogar()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_hogar uuid := public.auth_hogar_id();
  v_creador uuid; v_otro uuid;
  v_ing_creador numeric := 0; v_ing_otro numeric := 0; v_pct_creador numeric;
  v_ahorro numeric := 0; v_recibe_otro numeric;
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  select creado_por into v_creador from public.hogares where id = v_hogar;
  select user_id into v_otro from public.hogar_miembros where hogar_id = v_hogar and user_id <> v_creador limit 1;

  -- aportes históricos de ingresos hogar por miembro
  select coalesce(sum(monto),0) into v_ing_creador from public.transacciones
    where hogar_id = v_hogar and ambito='hogar' and tipo='ingreso' and user_id = v_creador;
  if v_otro is not null then
    select coalesce(sum(monto),0) into v_ing_otro from public.transacciones
      where hogar_id = v_hogar and ambito='hogar' and tipo='ingreso' and user_id = v_otro;
  end if;
  if (v_ing_creador + v_ing_otro) = 0 then v_pct_creador := 0.5;
  else v_pct_creador := v_ing_creador / (v_ing_creador + v_ing_otro); end if;

  -- ahorro neto del hogar = ingresos hogar - gastos hogar
  select coalesce(sum(case when tipo='ingreso' then monto else -monto end),0) into v_ahorro
    from public.transacciones where hogar_id = v_hogar and ambito='hogar';
  if v_ahorro < 0 then v_ahorro := 0; end if;
  v_recibe_otro := round(v_ahorro * (1 - v_pct_creador), 2);

  -- reasignar metas/fondo de hogar al creador como personales
  update public.metas set ambito='personal', hogar_id=null, user_id=v_creador
    where hogar_id = v_hogar and ambito='hogar';

  -- liquidación final: el creador (retiene metas) debe al otro su parte
  if v_otro is not null and v_recibe_otro > 0 then
    insert into public.hogar_liquidaciones (hogar_id, de_user, a_user, monto, nota)
    values (v_hogar, v_creador, v_otro, v_recibe_otro, 'Liquidación final de disolución');
  end if;

  -- borrar membresías (las transacciones conservan hogar_id como historial)
  delete from public.hogar_miembros where hogar_id = v_hogar;

  return jsonb_build_object(
    'pct_creador', round(v_pct_creador,4),
    'ahorro', v_ahorro,
    'recibe_creador', round(v_ahorro * v_pct_creador,2),
    'recibe_otro', v_recibe_otro
  );
end;
$$;

grant execute on function public.crear_hogar(text)                          to authenticated;
grant execute on function public.generar_codigo()                           to authenticated;
grant execute on function public.unirse_hogar(char)                         to authenticated;
grant execute on function public.saldar_hogar(uuid, uuid, numeric, text)    to authenticated;
grant execute on function public.disolver_hogar()                           to authenticated;

commit;
```

- [ ] **Step 2: Verificar**

Run: `grep -n "create or replace function public.\(crear_hogar\|unirse_hogar\|saldar_hogar\|disolver_hogar\|generar_codigo\)" supabase/migrations/20260629_fase6_hogares.sql`
Expected: las 5 funciones presentes.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260629_fase6_hogares.sql
git commit -m "feat(fase6): RPCs crear/generar_codigo/unirse/saldar/disolver hogar"
```

---

## Task 5: Tests SQL — aislamiento RLS de 3 usuarios

**Files:**
- Create: `supabase/tests/hogar_rls_test.sql`

> Espejo del patrón de `supabase/tests/rls_isolation_test.sql`: crea usuarios sintéticos, actúa como cada uno con `set_config('request.jwt.claims', …)` + `set local role authenticated`, y usa `raise exception` ante cualquier fallo, imprimiendo `ALL TESTS PASSED` al final. Se ejecuta en el SQL Editor de v2 DESPUÉS de aplicar la migración.

- [ ] **Step 1: Escribir la suite**

```sql
-- supabase/tests/hogar_rls_test.sql
-- Suite RLS de hogar — 3 usuarios. Correr en el SQL Editor de v2 tras la migración.
-- A = 11111111-...; B = 22222222-...; C = 33333333-...
-- A y B en el mismo hogar; C fuera. Imprime ALL TESTS PASSED si pasa.

-- ── Teardown ─────────────────────────────────────────────────────────
delete from public.transacciones where user_id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');
delete from public.hogar_miembros where user_id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');
delete from public.hogares where creado_por in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');

-- ── Setup usuarios ───────────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111','authenticated','authenticated','a@test.local',crypt('pw',gen_salt('bf')),now(),now(),now(),'{}','{"nombre":"A"}'),
  ('00000000-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222','authenticated','authenticated','b@test.local',crypt('pw',gen_salt('bf')),now(),now(),now(),'{}','{"nombre":"B"}'),
  ('00000000-0000-0000-0000-000000000000','33333333-3333-3333-3333-333333333333','authenticated','authenticated','c@test.local',crypt('pw',gen_salt('bf')),now(),now(),now(),'{}','{"nombre":"C"}');

-- ── Helper inline para actuar como un usuario ────────────────────────
-- perform set_config('request.jwt.claims', json_build_object('sub',<uuid>,'role','authenticated')::text, true);
-- set local role authenticated;

-- ── A crea hogar, B se une vía código ────────────────────────────────
do $$
declare v_cod char(6); v_res jsonb; v_cat uuid;
begin
  -- A actúa
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111111','role','authenticated')::text, true);
  set local role authenticated;
  v_res := public.crear_hogar('Casa AB');
  v_cod := v_res->>'codigo';
  -- A registra un gasto HOGAR y uno PERSONAL
  select id into v_cat from public.categorias where user_id is null limit 1;
  insert into public.transacciones (tipo,ambito,user_id,categoria_id,monto,nota)
    values ('gasto','hogar','11111111-1111-1111-1111-111111111111',v_cat,100,'A-hogar');
  insert into public.transacciones (tipo,ambito,user_id,categoria_id,monto,nota)
    values ('gasto','personal','11111111-1111-1111-1111-111111111111',v_cat,50,'A-personal');

  -- B actúa: se une
  perform set_config('request.jwt.claims', json_build_object('sub','22222222-2222-2222-2222-222222222222','role','authenticated')::text, true);
  set local role authenticated;
  perform public.unirse_hogar(v_cod);
  insert into public.transacciones (tipo,ambito,user_id,categoria_id,monto,nota)
    values ('gasto','hogar','22222222-2222-2222-2222-222222222222',v_cat,40,'B-hogar');
  insert into public.transacciones (tipo,ambito,user_id,categoria_id,monto,nota)
    values ('gasto','personal','22222222-2222-2222-2222-222222222222',v_cat,30,'B-personal');
end $$;

-- ── ASSERT 1: A ve el gasto HOGAR de B, NO el personal de B ───────────
do $$
declare v_hogar_b int; v_pers_b int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111111','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_hogar_b from public.transacciones where nota='B-hogar';
  select count(*) into v_pers_b  from public.transacciones where nota='B-personal';
  if v_hogar_b <> 1 then raise exception 'FALLO: A no ve el gasto hogar de B (esperaba 1, vio %)', v_hogar_b; end if;
  if v_pers_b  <> 0 then raise exception 'FALLO: A ve el gasto PERSONAL de B (debía ser 0, vio %)', v_pers_b; end if;
end $$;

-- ── ASSERT 2: C (fuera) no ve nada de A/B ────────────────────────────
do $$
declare v_n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','33333333-3333-3333-3333-333333333333','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.transacciones where nota in ('A-hogar','A-personal','B-hogar','B-personal');
  if v_n <> 0 then raise exception 'FALLO: C ve % filas de A/B (debía ser 0)', v_n; end if;
end $$;

-- ── ASSERT 3: ya-en-hogar bloquea unirse de nuevo ────────────────────
do $$
declare v_ok boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','22222222-2222-2222-2222-222222222222','role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.crear_hogar('Otro');
  exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FALLO: B pudo crear un 2º hogar estando ya en uno'; end if;
end $$;

select 'ALL TESTS PASSED' as resultado;
```

- [ ] **Step 2: Verificar que el archivo existe**

Run: `grep -c "raise exception 'FALLO" supabase/tests/hogar_rls_test.sql`
Expected: `3` (tres asserts).

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/hogar_rls_test.sql
git commit -m "test(fase6): suite RLS hogar 3 usuarios (aislamiento C, A ve hogar no personal de B, ya-en-hogar)"
```

> **Nota de ejecución:** tras revisar y aplicar la migración en v2, correr esta suite en el SQL Editor. Debe imprimir `ALL TESTS PASSED`. NO aplicar nada a producción.

---

## Task 6: Lógica pura de balance + disolución (JS) — TDD

**Files:**
- Create: `test/hogar-balance.test.mjs`
- Create: `js/hogar-balance.js`

- [ ] **Step 1: Escribir los tests primero**

```javascript
// test/hogar-balance.test.mjs
import assert from 'node:assert';
import { test } from 'node:test';
import { calcularBalanceHogar, repartoDisolucion } from '../js/hogar-balance.js';

const A = 'uidA', B = 'uidB';
function gas(user_id, monto) { return { tipo: 'gasto', ambito: 'hogar', user_id, monto }; }

test('sin gastos hogar → neto 0', () => {
  const r = calcularBalanceHogar([], [], A, B);
  assert.strictEqual(r.neto, 0);
});

test('A pagó más → B le debe la mitad de la diferencia', () => {
  // A pagó 100, B pagó 40 → (100-40)/2 = 30, B debe 30 a A
  const r = calcularBalanceHogar([gas(A,100), gas(B,40)], [], A, B);
  assert.strictEqual(r.neto, 30);
  assert.strictEqual(r.acreedor, A);
  assert.strictEqual(r.deudor, B);
});

test('liquidación previa de B→A reduce el neto', () => {
  const liq = [{ de_user: B, a_user: A, monto: 30 }];
  const r = calcularBalanceHogar([gas(A,100), gas(B,40)], liq, A, B);
  assert.strictEqual(r.neto, 0);
});

test('ignora transacciones personales y de ingreso', () => {
  const txs = [gas(A,100), { tipo:'ingreso', ambito:'hogar', user_id:A, monto:999 },
               { tipo:'gasto', ambito:'personal', user_id:A, monto:999 }];
  const r = calcularBalanceHogar(txs, [], A, B);
  assert.strictEqual(r.neto, 50); // (100-0)/2
});

test('reparto de disolución por % de aporte de ingresos', () => {
  // A aportó 600 de ingresos hogar, B 400 → A 60%. ahorro 1000.
  const r = repartoDisolucion(600, 400, 1000);
  assert.strictEqual(r.pctA, 0.6);
  assert.strictEqual(r.recibeA, 600);
  assert.strictEqual(r.recibeB, 400);
});

test('ambos sin ingresos → 50/50', () => {
  const r = repartoDisolucion(0, 0, 500);
  assert.strictEqual(r.pctA, 0.5);
  assert.strictEqual(r.recibeA, 250);
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `node --test test/hogar-balance.test.mjs`
Expected: FAIL — `Cannot find module '../js/hogar-balance.js'` o similar.

- [ ] **Step 3: Implementar el módulo**

```javascript
// ─────────────────────────────────────────────────────────────────
// Nestra — hogar-balance.js (Fase 6)
// Lógica pura del balance "quién debe qué" (50/50 de gastos hogar) y del
// reparto de disolución (% de aporte de ingresos). Determinista, testeable.
// Dual-export como safe-to-spend.js / insights.js.
// ─────────────────────────────────────────────────────────────────
'use strict';

// neto = (pagóA - pagóB)/2, ajustado por liquidaciones.
// liquidación de=X a=Y monto m  ⇒ X ya le pagó m a Y, baja la deuda de X hacia Y.
function calcularBalanceHogar(transacciones, liquidaciones, uidA, uidB) {
  var pagoA = 0, pagoB = 0;
  (transacciones || []).forEach(function (t) {
    if (t.ambito !== 'hogar' || t.tipo !== 'gasto') return;
    if (t.user_id === uidA) pagoA += Number(t.monto) || 0;
    else if (t.user_id === uidB) pagoB += Number(t.monto) || 0;
  });
  var neto = (pagoA - pagoB) / 2; // >0 ⇒ B le debe a A
  (liquidaciones || []).forEach(function (l) {
    var m = Number(l.monto) || 0;
    if (l.de_user === uidB && l.a_user === uidA) neto -= m;       // B pagó a A
    else if (l.de_user === uidA && l.a_user === uidB) neto += m;  // A pagó a B
  });
  neto = Math.round(neto * 100) / 100;
  return {
    neto: Math.abs(neto),
    acreedor: neto >= 0 ? uidA : uidB,
    deudor:   neto >= 0 ? uidB : uidA,
    pagoA: pagoA, pagoB: pagoB
  };
}

// reparto del ahorro neto por % de aporte histórico de ingresos.
function repartoDisolucion(ingresosA, ingresosB, ahorro) {
  var a = Number(ingresosA) || 0, b = Number(ingresosB) || 0, s = Number(ahorro) || 0;
  var pctA = (a + b) === 0 ? 0.5 : a / (a + b);
  var recibeA = Math.round(s * pctA * 100) / 100;
  return { pctA: pctA, recibeA: recibeA, recibeB: Math.round((s - recibeA) * 100) / 100 };
}

if (typeof window !== 'undefined') {
  window.calcularBalanceHogar = calcularBalanceHogar;
  window.repartoDisolucion = repartoDisolucion;
}

export { calcularBalanceHogar, repartoDisolucion };
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `node --test test/hogar-balance.test.mjs`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add test/hogar-balance.test.mjs js/hogar-balance.js
git commit -m "feat(fase6): logica pura balance hogar + reparto disolucion (TDD)"
```

---

## Task 7: Wrappers de db.js (RPCs + estado de hogar + realtime)

**Files:**
- Modify: `js/db.js` (añadir funciones nuevas; NO duplicar las existentes `getBalanceHogar`/`getAhorrosHogar`/`insertAporteHogar`, que se reutilizan)

- [ ] **Step 1: Añadir las funciones de hogar al final de db.js (antes de cualquier export/bloque window, siguiendo el patrón de funciones globales del archivo)**

```javascript
// ── Fase 6: hogar compartido ─────────────────────────────────────────
// Estado del hogar del usuario actual: { hogar, miembros[], codigo } o null.
async function getEstadoHogar() {
  const { data: miembro, error } = await supabase
    .from('hogar_miembros').select('hogar_id, rol').limit(1).maybeSingle();
  if (error || !miembro) return null;
  const { data: hogar } = await supabase
    .from('hogares').select('*').eq('id', miembro.hogar_id).maybeSingle();
  const { data: miembros } = await supabase
    .from('hogar_miembros').select('user_id, rol, joined_at').eq('hogar_id', miembro.hogar_id);
  const { data: codigo } = await supabase
    .from('hogar_codigos').select('codigo, expira_at')
    .eq('hogar_id', miembro.hogar_id).eq('usado', false)
    .gt('expira_at', new Date().toISOString()).order('created_at', { ascending: false })
    .limit(1).maybeSingle();
  return { hogar, miembros: miembros || [], codigo: codigo || null, rol: miembro.rol };
}

async function crearHogar(nombre) {
  const { data, error } = await supabase.rpc('crear_hogar', { p_nombre: nombre });
  if (error) throw error;
  return data;
}

async function generarCodigoHogar() {
  const { data, error } = await supabase.rpc('generar_codigo');
  if (error) throw error;
  return data;
}

async function unirseHogar(codigo) {
  const { data, error } = await supabase.rpc('unirse_hogar', { p_codigo: codigo });
  if (error) throw error;
  return data;
}

async function saldarHogar(deUser, aUser, monto, nota) {
  const { data, error } = await supabase.rpc('saldar_hogar', {
    p_de: deUser, p_a: aUser, p_monto: monto, p_nota: nota || null });
  if (error) throw error;
  return data;
}

async function disolverHogar() {
  const { data, error } = await supabase.rpc('disolver_hogar');
  if (error) throw error;
  return data;
}

// Liquidaciones del hogar (para el cálculo del balance en cliente).
async function getLiquidacionesHogar() {
  const { data, error } = await supabase
    .from('hogar_liquidaciones').select('de_user, a_user, monto, fecha');
  if (error) return [];
  return data || [];
}

// Suscripción realtime a cambios de transacciones/metas del hogar.
// onChange se llama en cada INSERT/UPDATE/DELETE. Devuelve el channel para unsubscribe.
function subscribeHogar(hogarId, onChange) {
  if (!hogarId) return null;
  const ch = supabase.channel('hogar-' + hogarId)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'transacciones', filter: 'hogar_id=eq.' + hogarId },
        onChange)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'metas', filter: 'hogar_id=eq.' + hogarId },
        onChange)
    .subscribe();
  return ch;
}

if (typeof window !== 'undefined') {
  window.getEstadoHogar = getEstadoHogar;
  window.crearHogar = crearHogar;
  window.generarCodigoHogar = generarCodigoHogar;
  window.unirseHogar = unirseHogar;
  window.saldarHogar = saldarHogar;
  window.disolverHogar = disolverHogar;
  window.getLiquidacionesHogar = getLiquidacionesHogar;
  window.subscribeHogar = subscribeHogar;
}
```

> Antes de pegar, abrir `js/db.js` y confirmar cómo expone sus funciones (globales directas vs `window.*`). Si el archivo NO usa un bloque `window.*` al final (las funciones ya son globales por ser top-level en un `<script>` no-módulo), omitir el bloque `if (typeof window...)` y dejar solo las `async function`. Verificar el patrón mirando el final del archivo.

- [ ] **Step 2: Verificar que no hay nombres duplicados**

Run: `grep -n "function getBalanceHogar\|function getEstadoHogar\|function crearHogar\|function getAhorrosHogar" js/db.js`
Expected: `getBalanceHogar`/`getAhorrosHogar` aparecen UNA vez (las preexistentes, intactas); `getEstadoHogar`/`crearHogar` aparecen UNA vez (las nuevas). Ningún nombre repetido.

- [ ] **Step 3: Commit**

```bash
git add js/db.js
git commit -m "feat(fase6): wrappers db.js para RPCs de hogar + estado + realtime"
```

---

## Task 8: Vista views/hogar.html

**Files:**
- Create: `views/hogar.html`
- Modify: `index.html` (registrar ruta `#hogar` + entrada de nav)

> Antes de escribir: abrir una vista existente (ej. `views/configuracion.html`) y copiar su esqueleto (IIFE, uso de `escHtml`, cómo se monta en el contenedor de la SPA, cómo lee `window.*` de db.js). Esta vista debe seguir EXACTAMENTE ese patrón. El código abajo es el contenido funcional a adaptar al esqueleto.

- [ ] **Step 1: Crear views/hogar.html siguiendo el esqueleto de configuracion.html**

Estructura mínima de la vista (adaptar al patrón de montaje de la SPA):

```html
<!-- views/hogar.html — Fase 6: hogar compartido -->
<section class="vista" id="vista-hogar">
  <h1>Hogar</h1>
  <div id="hogar-contenido"><!-- render dinámico --></div>
</section>
<script>
(function () {
  'use strict';
  var cont = document.getElementById('hogar-contenido');
  var channel = null;

  function esc(s){ return (window.escHtml ? window.escHtml(String(s==null?'':s)) : String(s)); }

  async function render() {
    var estado = await window.getEstadoHogar();
    if (!estado) return renderSinHogar();
    return renderConHogar(estado);
  }

  function renderSinHogar() {
    cont.innerHTML =
      '<p>Comparte gastos con tu pareja. Crea un hogar o únete con un código.</p>' +
      '<button id="btn-crear">Crear hogar</button>' +
      '<div><input id="inp-codigo" maxlength="6" inputmode="numeric" placeholder="Código de 6 dígitos">' +
      '<button id="btn-unir">Unirme</button></div>';
    document.getElementById('btn-crear').onclick = async function () {
      var nombre = prompt('Nombre del hogar:', 'Nuestro hogar');
      if (nombre === null) return;
      try { await window.crearHogar(nombre); render(); }
      catch (e) { alert(e.message || 'Error al crear hogar'); }
    };
    document.getElementById('btn-unir').onclick = async function () {
      var cod = (document.getElementById('inp-codigo').value || '').trim();
      if (cod.length !== 6) return alert('El código debe tener 6 dígitos');
      try { await window.unirseHogar(cod); render(); }
      catch (e) { alert(e.message || 'Código inválido o expirado'); }
    };
  }

  async function renderConHogar(estado) {
    var txs = await window.getTransacciones({});           // ya incluye filas del hogar por RLS
    var liqs = await window.getLiquidacionesHogar();
    var uidActual = (window.supabaseUserId || null);       // confirmar cómo se obtiene el uid actual
    var otro = (estado.miembros.find(function(m){ return m.user_id !== uidActual; }) || {}).user_id || null;
    var bal = (otro ? window.calcularBalanceHogar(txs, liqs, uidActual, otro) : { neto: 0 });

    var codHtml = estado.codigo
      ? 'Código activo: <strong>' + esc(estado.codigo.codigo) + '</strong>'
      : '<button id="btn-regen">Generar código para invitar</button>';

    var balHtml = bal.neto === 0
      ? 'Están a mano.'
      : (bal.acreedor === uidActual
          ? 'Te deben S/' + bal.neto
          : 'Le debes S/' + bal.neto) +
        ' <button id="btn-saldar">Saldar</button>';

    cont.innerHTML =
      '<h2>' + esc(estado.hogar.nombre) + '</h2>' +
      '<p>Miembros: ' + estado.miembros.length + '/2</p>' +
      '<p>' + codHtml + '</p>' +
      '<p>' + balHtml + '</p>' +
      '<button id="btn-disolver">Salir / disolver hogar</button>';

    if (document.getElementById('btn-regen'))
      document.getElementById('btn-regen').onclick = async function () {
        try { await window.generarCodigoHogar(); render(); } catch(e){ alert(e.message); }
      };
    if (document.getElementById('btn-saldar'))
      document.getElementById('btn-saldar').onclick = async function () {
        try { await window.saldarHogar(bal.deudor, bal.acreedor, bal.neto, null); render(); }
        catch(e){ alert(e.message); }
      };
    document.getElementById('btn-disolver').onclick = async function () {
      if (!confirm('Disolver el hogar reasigna las metas compartidas al creador y reparte el ahorro. ¿Continuar?')) return;
      try { var r = await window.disolverHogar();
        alert('Hogar disuelto. Reparto: creador S/' + r.recibe_creador + ', otro S/' + r.recibe_otro);
        render(); } catch(e){ alert(e.message); }
    };

    // realtime: refresca al cambiar algo del hogar
    if (channel) supabase.removeChannel(channel);
    channel = window.subscribeHogar(estado.hogar.id, function () { render(); });
  }

  render();
})();
</script>
```

> El plan deja marcado con comentario el único punto a confirmar contra el código real: cómo se obtiene el `uid` del usuario actual (`window.supabaseUserId` es un placeholder — buscar en `js/supabase.js`/`js/db.js` la variable/función real, p.ej. `supabase.auth.getUser()`).

- [ ] **Step 2: Registrar la ruta y el nav en index.html**

Abrir `index.html`, localizar el registro de rutas hash (buscar otra vista como `configuracion` o `resumen`) y añadir `hogar` siguiendo el mismo patrón. Añadir un enlace de nav `#hogar` junto a los existentes.

Run: `grep -n "configuracion" index.html`
Usar las líneas resultantes como plantilla para insertar `hogar` de forma análoga.

- [ ] **Step 3: Verificar en preview**

Levantar el preview (`preview_start` config `nestra`), navegar a `#hogar`, confirmar que renderiza el estado "sin hogar" sin errores en consola.

- [ ] **Step 4: Commit**

```bash
git add views/hogar.html index.html
git commit -m "feat(fase6): vista #hogar (crear/unir/codigo/balance/saldar/disolver) + nav + realtime"
```

---

## Task 9: Card de balance en dashboard + service worker

**Files:**
- Modify: `index.html` (o la vista del dashboard) — card de balance cuando hay hogar
- Modify: `sw.js` — precache de assets nuevos + bump `SHELL_VERSION`

- [ ] **Step 1: Añadir card de balance al dashboard cuando hay hogar**

En el render del dashboard, tras obtener `getEstadoHogar()`, si existe hogar, mostrar una card con el resultado de `calcularBalanceHogar`. Reusar el patrón de cards del dashboard existente. (Mostrar "Te deben S/X" / "Le debes S/X" / "Están a mano".)

- [ ] **Step 2: Actualizar sw.js**

Abrir `sw.js`, localizar la lista de assets precacheados y `SHELL_VERSION`. Añadir `views/hogar.html` y `js/hogar-balance.js` a la precache, e incrementar `SHELL_VERSION` (p.ej. de v17 a v18).

Run: `grep -n "SHELL_VERSION\|hogar-balance\|views/hogar" sw.js`
Expected: `SHELL_VERSION` incrementado; ambos assets presentes en la precache.

- [ ] **Step 3: Verificar en preview**

Recargar el preview, confirmar dashboard sin errores y (con cuenta sin hogar) que no aparece la card; navegar a `#hogar` y verificar el flujo.

- [ ] **Step 4: Commit**

```bash
git add index.html sw.js
git commit -m "feat(fase6): card balance hogar en dashboard + precache + bump SHELL_VERSION"
```

---

## Task 10: Verificación manual con 2 cuentas + deploy

**Files:** ninguno (verificación)

- [ ] **Step 1: Aplicar la migración en la instancia v2 (revisión manual primero)**

Revisar manualmente `supabase/migrations/20260629_fase6_hogares.sql` línea por línea. Aplicarlo en el SQL Editor de la instancia **v2**. NO en producción.

- [ ] **Step 2: Correr la suite RLS**

Ejecutar `supabase/tests/hogar_rls_test.sql` en el SQL Editor de v2.
Expected: imprime `ALL TESTS PASSED`. Si falla, NO continuar; corregir policies/trigger.

- [ ] **Step 3: Correr todos los tests JS**

Run: `node --test test/`
Expected: toda la suite (incluida `hogar-balance.test.mjs`) en verde.

- [ ] **Step 4: Prueba de 2 cuentas en preview/teléfono**

Con dos cuentas de prueba: A crea hogar → código → B se une → A registra un gasto hogar → aparece en el dashboard de B en vivo (realtime) → balance correcto → saldar → disolver con statement correcto.

- [ ] **Step 5: Deploy**

```bash
git push origin v2
```
Esperar ~1-2 min el build de Cloudflare Pages, verificar:
Run: `curl -sL https://nestra-8rl.pages.dev/sw.js | grep SHELL_VERSION`
Expected: la versión bumpeada. Cerrar/reabrir la PWA en el teléfono para tomar el shell nuevo.

---

## Self-Review (cobertura del spec)

- **Modelo de datos (spec §1):** Task 1. ✓
- **RLS helper + policies (spec §2):** Tasks 2, 3. ✓
- **RPCs (spec §3):** Task 4. ✓
- **Balance día a día (spec §4):** Task 6 (lógica) + Task 8/9 (UI). ✓
- **Disolución (spec §5):** Task 4 (`disolver_hogar`) + Task 6 (`repartoDisolucion`). ✓
- **UI + Realtime (spec §6):** Tasks 8, 9, 7 (`subscribeHogar`). ✓
- **Testing (spec §7):** Tasks 5 (SQL 3 usuarios) y 6 (JS puro). ✓
- **Orden (spec §8):** Tasks 1-10 siguen el orden. ✓
- **No-duplicación:** Task 7 Step 2 verifica explícitamente que no se redefinen `getBalanceHogar`/`getAhorrosHogar` existentes. ✓

**Placeholders pendientes a resolver en ejecución (marcados en el plan, no son fallos del plan sino puntos a confirmar contra el código real):**
- Patrón de montaje exacto de las vistas (Task 8 Step 1) — confirmar contra `views/configuracion.html`.
- Cómo se obtiene el `uid` del usuario actual (Task 8 Step 1) — confirmar contra `js/supabase.js`.
- Patrón de registro de rutas/nav en `index.html` (Task 8 Step 2).
- Patrón de export de `js/db.js` (Task 7 Step 1).
```
