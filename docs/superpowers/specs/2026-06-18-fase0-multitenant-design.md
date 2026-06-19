# Nestra v2 — Fase 0: Fundación Multi-tenant (Auth + RLS + migración)

> Diseño validado. Convierte la app de single-tenant (modelo compartido por
> `ambito`) a multi-tenant estricto (`auth.uid() = user_id`), integra Google
> OAuth, y entrega una migración idempotente y reversible.
>
> **Fecha:** 2026-06-18 · **Modelo:** Opus 4.8 · **Riesgo:** Crítico (RLS).
> **Aplica solo a:** instancia Supabase v2 (`ombnhxueclqfeyjzhroz`). NUNCA a
> producción (`rblxwqdphhmpglxxtgtv`) sin revisión manual del SQL.

---

## Contexto y problema

La app v1 está construida sobre un modelo **compartido por `ambito`**
(`personal` / `hogar`):

- `transacciones`, `metas`, `desafios` con `ambito='hogar'` se comparten entre
  **todos** los usuarios autenticados vía RLS `using (ambito='hogar' or
  auth.uid() = user_id)`.
- `categorias` son **globales** (`using (true)` — todos ven todas).
- `profiles` se leen entre todos (`using (true)`).
- Subsistemas dependientes: `insertAporteHogar`, RPC `distribuir_aporte_hogar`,
  `getAportesPorMiembro`, gráfico "aporte real vs esperado".

**Producción tiene 2 usuarios reales** (una pareja):

| Usuario | user_id | tx total | personal | hogar | aporte esperado |
|---------|---------|----------|----------|-------|-----------------|
| Christian | `aa5a03e9-…db90` | 16 | 15 | 1 | 500 |
| Darling | `6cb374ae-…2982` | 54 | 53 | 1 | 0 |

**El problema crítico:** Fase 0 introduce Google OAuth = nuevos signups. En el
momento en que un usuario desconocido entra con Google, la regla
`using (ambito='hogar' …)` **filtra las filas compartidas de Christian+Darling a
ese extraño**. Cerrar ese hueco es el objetivo central de esta fase.

---

## Decisiones de diseño (locked)

1. **Tenancy Fase 0 = 100% personal.** Todo es owner-scoped
   (`auth.uid() = user_id`). El sharing de hogar se difiere a Fase 5.
2. **Columnas `ambito` se conservan pero quedan dormantes** (forward-compat
   para Fase 5). Ninguna policy las lee.
3. **`categorias` = sistema + personal.** Las semillas quedan con `user_id`
   NULL (sistema, legibles por todos, no editables por usuarios). Las custom
   llevan `user_id` (solo el dueño). Las **categorías de hogar compartidas con
   `hogar_id` son Fase 5.**
4. **OAuth: Google + email/password**, vinculados por email coincidente.
5. **Migración: cada quien conserva sus datos.** Las filas hogar con `user_id`
   NULL (2 metas semilla) se asignan a un **dueño designado: Christian**.
6. **`categorias_favoritas` se incorpora al schema v2** (hoy falta en
   `schema_v2_fresh.sql` aunque existe en prod y la usa `db.js`).

---

## 1. Cambios de schema

Cada tabla de dominio tiene un `user_id` no-nulo, dueño de exactamente un
usuario auth. `ambito` permanece pero dormante.

| Tabla | `user_id` hoy | Cambio |
|-------|---------------|--------|
| `transacciones` | NOT NULL ✅ | ninguno (ya tiene dueño, incl. filas hogar) |
| `metas` | nullable (NULL en hogar) | backfill → dueño designado · `set not null` |
| `desafios` | nullable (NULL en hogar) | backfill → dueño designado · `set not null` |
| `prestamos` | ❌ (derivado vía tx) | **añadir** `user_id` · backfill desde `transacciones.user_id` · `set not null` |
| `aportes_meta` | ❌ (derivado vía meta) | **añadir** `user_id` · backfill desde la transacción de origen · `set not null` |
| `categorias` | ❌ global | **añadir** `user_id` nullable: NULL = sistema (read-only, compartida); set = custom personal |
| `categorias_favoritas` | tiene `user_id` | **incorporar al schema v2** (estructura: `id`, `user_id`, `categoria_id`, unique `(user_id, categoria_id)`) |
| `profiles` | tiene `user_id` | sin cambio de columna; sí cambia RLS |

Notas:
- Las semillas de `categorias` quedan con `user_id` NULL para no romper los FK
  `transacciones.categoria_id` ya existentes (FK `on delete restrict`).
- `metas_con_progreso` (vista `security_invoker`) hereda la RLS de `metas`
  automáticamente — no se modifica salvo que cambie su set de columnas.

---

## 2. Reescritura de RLS

Se eliminan **todas** las policies que comparten por `ambito='hogar'`. Se
reemplazan por reglas estrictas por tabla. Todas usan `(select auth.uid())`
(optimización initplan ya presente en v1).

**transacciones / metas / desafios / prestamos / aportes_meta** — patrón uniforme:

```sql
-- ejemplo: transacciones
drop policy if exists "transacciones_select" on public.transacciones;
drop policy if exists "transacciones_insert" on public.transacciones;
drop policy if exists "transacciones_update" on public.transacciones;
drop policy if exists "transacciones_delete" on public.transacciones;

create policy "transacciones_select" on public.transacciones for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "transacciones_insert" on public.transacciones for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "transacciones_update" on public.transacciones for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "transacciones_delete" on public.transacciones for delete
  to authenticated using ((select auth.uid()) = user_id);
```

`prestamos` y `aportes_meta` dejan de usar el patrón `EXISTS` sobre la tabla
padre y pasan a `(select auth.uid()) = user_id` directo (más simple y rápido).

**categorias** — sistema legible por todos, custom solo del dueño:

```sql
drop policy if exists "categorias_todo_autenticados" on public.categorias;

create policy "categorias_select" on public.categorias for select
  to authenticated
  using (user_id is null or (select auth.uid()) = user_id);
create policy "categorias_insert" on public.categorias for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "categorias_update" on public.categorias for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "categorias_delete" on public.categorias for delete
  to authenticated using ((select auth.uid()) = user_id);
```

**profiles** — solo la fila propia (mata `using (true)`):

```sql
drop policy if exists "profiles_select_autenticados" on public.profiles;
create policy "profiles_select_propio" on public.profiles for select
  to authenticated using ((select auth.uid()) = user_id);
-- insert/update propios ya existen; se conservan.
```

**RPCs:** `distribuir_aporte_hogar` e `insertAporteHogar` quedan **dormantes**
(se conservan, sin uso). `distribuir_ahorro` y `aporte_directo_meta`
(personales) se mantienen activos.

**Realtime:** sin cambios de tablas; la RLS aplica también al canal realtime.

---

## 3. Google OAuth

- **Dashboard v2 (pasos manuales del usuario):** habilitar provider Google en
  Authentication → Providers; crear OAuth client en Google Cloud Console;
  registrar redirect URL de Supabase. Claude entrega los clicks exactos; el
  usuario ejecuta lo que requiere su cuenta Google.
- **Email/password se conserva.** Supabase vincula por email coincidente — los
  emails de Google de Christian/Darling deben igualar sus cuentas actuales
  (verificar en cutover).
- **`js/auth.js`:**
  - `signInWithGoogle()` → `supabase.auth.signInWithOAuth({ provider: 'google',
    options: { redirectTo: <url de la app> } })`.
  - Manejar el callback del redirect en `initAuth()` (Supabase procesa el hash
    de la URL automáticamente; validar sesión resultante).
  - Lógica de sesión/perfil/realtime existente sin cambios.
- **Vista login:** botón "Continuar con Google".

---

## 4. Migración (idempotente + reversible)

Dos archivos en `supabase/migrations/`, aplicados **solo a v2**, revisados por
el usuario antes de cualquier corrida en prod.

**`<fecha>_fase0_multitenant_up.sql`** — orden:

1. `alter table … add column if not exists user_id uuid …` (prestamos,
   aportes_meta, categorias).
2. Backfill (todos guardados, idempotentes):
   - `prestamos.user_id` ← `transacciones.user_id` vía `transaccion_id`.
   - `aportes_meta.user_id` ← `user_id` de la transacción de origen.
   - `metas`/`desafios` con `user_id is null` (hogar) ← dueño designado
     (Christian).
   - `categorias` semilla: `user_id` permanece NULL (sistema).
3. `set not null` en las columnas que ya no deben tener NULL
   (`metas.user_id`, `desafios.user_id`, `prestamos.user_id`,
   `aportes_meta.user_id`).
4. `drop policy if exists` de todas las policies viejas (ambito).
5. `create policy` del nuevo set estricto (sección 2).

Idempotencia: `add column if not exists`, `drop policy if exists`, backfills
con `where user_id is null`, `create policy` precedido de su `drop`.

**`<fecha>_fase0_multitenant_down.sql`** — reversa:

1. `drop policy` del set estricto.
2. Recrear las policies viejas basadas en `ambito` (texto literal del
   `schema_v2_fresh.sql` original).
3. Re-nulificar `user_id` en filas hogar (`metas`/`desafios` donde
   correspondía).
4. `drop column if exists user_id` en prestamos, aportes_meta, categorias.

**Cutover (fase posterior, NO en este trabajo):** copiar datos reales
v1→v2 y correr la migración sobre datos reales es un paso separado. Esta fase
**solo escribe y prueba** el script contra datos sintéticos en v2.

---

## 5. TDD de las policies

Sigue `superpowers:test-driven-development`. Tests a nivel SQL con 2 usuarios
sintéticos (A, B), corridos vía `execute_sql` **solo en v2**, usando claims JWT
(`set local request.jwt.claims` + `set local role authenticated`).

Casos (RED primero, luego la policy los pone GREEN):

1. A inserta tx / meta / prestamo / aporte_meta / categoría custom →
   el `select` de B devuelve **cero** filas de A.
2. B no puede `update` ni `delete` filas de A (rowcount 0).
3. B **sí** lee categorías de sistema (`user_id is null`).
4. A no puede insertar una fila con `user_id = B` (viola `with check`).
5. A no puede `update` una categoría de sistema (`user_id is null`).
6. `profiles`: B no ve la fila de A.

Sin pérdida de datos: tras backfill, los counts por usuario coinciden con los
previos (cada quien conserva lo suyo).

---

## 6. Fuera de alcance (→ Fase 5)

- Categorías de hogar compartidas con `hogar_id`.
- Tabla `hogares`, columna `hogar_id`, emparejamiento, códigos de invitación.
- Reactivar el sharing por `ambito`.
- Gráficos multi-miembro (`getAportesPorMiembro`, aporte real vs esperado).

Columnas (`ambito`) y funciones (`distribuir_aporte_hogar`, `insertAporteHogar`)
se conservan dormantes para que Fase 5 construya sobre ellas.

---

## Verificación de salida

- Usuario A no puede leer ni escribir filas de usuario B (tests RLS GREEN).
- Login con Google funciona; email/password sigue funcionando.
- Counts por usuario intactos tras la migración (cero pérdida).
- `down` revierte limpio a un estado equivalente al `schema_v2_fresh.sql`.
- Ninguna migración corrió sobre producción.
