# Fase 6 — Sistema de pareja / hogar compartido (diseño)

> Spec de la killer feature opt-in de Nestra v2. Define el modelo de datos,
> la RLS compartida (el punto de seguridad más delicado de v2), el flujo de
> emparejamiento, el balance "quién debe qué", la disolución, la UI y el
> testing. Supersede cualquier suposición previa: en el desarrollo se construyó
> la Fase 7 (push) saltando esta fase, así que el hogar compartido NO existe
> todavía en el código.

**Fecha:** 2026-06-29
**Modelo recomendado:** Opus 4.8 (RLS compartida = seguridad crítica).
**Skills:** brainstorming (hecho) → writing-plans → subagent-driven-development · test-driven-development.
**Ámbito de aplicación:** SOLO instancia Supabase v2. NO aplicar policies a producción sin revisión manual del SQL.

---

## Contexto del código existente (hallazgos del brainstorming)

- El schema ya tiene columna `ambito` (`'personal' | 'hogar'`) en `transacciones` y `metas`.
- La UI mantiene viva el toggle personal/hogar (`btnAmbitoPersonal` / `btnAmbitoHogar` en `views/transaccion.html`).
- Existe lógica **dormida** de hogar: `distribuir_aporte_hogar(uuid)`, fondo de emergencia `ambito='hogar'`, metas `ambito='hogar'`. En v1 el hogar estaba hard-coded (una sola pareja). La Fase 0 (`20260618_fase0_multitenant_up.sql`) volvió todo owner-scoped por `user_id`, así que `ambito='hogar'` quedó dormido: una fila `ambito='hogar'` pertenece a un solo `user_id` y la RLS solo la muestra a ese dueño.
- Patrón RLS existente: `using ((select auth.uid()) = user_id)`, con `auth.uid()` envuelto en `(select ...)` por optimización de initplan (`20260605_optimize_rls_initplan.sql`).
- El `categorias_editables_hogar` (`20260622`) NO es esta feature: es categorías semilla compartidas (`user_id IS NULL`).

**Decisión:** reusar `ambito` como flag de "compartido" y añadir `hogar_id` para decir CUÁL hogar. Aprovecha UI y lógica de fondo/metas de hogar ya existentes; menos reconstrucción.

---

## Decisiones de diseño (cerradas en brainstorming)

1. **Modelo de compartido:** reusar `ambito` (`'hogar'` = compartido) + nueva columna `hogar_id` que apunta al hogar.
2. **Tamaño:** exactamente 2 miembros (pareja). Cap duro.
3. **Balance día a día ("quién debe qué"):** 50/50 sobre gastos hogar + botón "saldar" que registra una liquidación y resetea el neto.
4. **Disolución:** el ahorro neto del hogar (lo acumulado en metas + fondo de hogar) se reparte por % de aporte histórico de ingresos. Convive con el 50/50 diario.
5. **Código de emparejamiento:** 6 dígitos, expira 24h, un solo uso, regenerable.
6. **Ya en un hogar:** un usuario pertenece a máximo un hogar; crear/unirse estando en uno se bloquea con error claro (debe salir/disolver primero).

---

## 1. Modelo de datos

Migración nueva `supabase/migrations/20260629_fase6_hogares.sql` (idempotente, solo v2).

```
hogares
  id          uuid pk default gen_random_uuid()
  nombre      text not null
  creado_por  uuid not null references auth.users(id) on delete cascade
  created_at  timestamptz not null default now()

hogar_miembros
  id        uuid pk default gen_random_uuid()
  hogar_id  uuid not null references hogares(id) on delete cascade
  user_id   uuid not null references auth.users(id) on delete cascade
  rol       text not null check (rol in ('creador','miembro'))
  joined_at timestamptz not null default now()
  unique (user_id)              -- invariante: 1 hogar por usuario
  unique (hogar_id, user_id)
  -- cap 2 por trigger: rechaza insert si ya hay 2 miembros en el hogar

hogar_codigos
  id         uuid pk default gen_random_uuid()
  hogar_id   uuid not null references hogares(id) on delete cascade
  codigo     char(6) not null
  expira_at  timestamptz not null
  usado      boolean not null default false
  created_at timestamptz not null default now()
  -- index unique parcial sobre codigo where usado=false and expira_at>now()

hogar_liquidaciones
  id        uuid pk default gen_random_uuid()
  hogar_id  uuid not null references hogares(id) on delete cascade
  de_user   uuid not null references auth.users(id)
  a_user    uuid not null references auth.users(id)
  monto     numeric(10,2) not null check (monto > 0)
  fecha     date not null default current_date
  nota      text
  created_at timestamptz not null default now()
```

Columna nueva en `transacciones` y `metas`:

```
alter table public.transacciones add column if not exists hogar_id uuid references public.hogares(id) on delete set null;
alter table public.metas         add column if not exists hogar_id uuid references public.hogares(id) on delete set null;
create index if not exists idx_transacciones_hogar_id on public.transacciones (hogar_id) where hogar_id is not null;
create index if not exists idx_metas_hogar_id          on public.metas (hogar_id) where hogar_id is not null;
```

**Invariante de consistencia** (trigger BEFORE INSERT/UPDATE en `transacciones` y `metas`):
- `ambito='hogar'` ⇒ `hogar_id = auth_hogar_id()` del que escribe. Si el usuario no tiene hogar, rechazar (no puede marcar hogar sin pertenecer a uno).
- `ambito='personal'` ⇒ `hogar_id = NULL`.

Esto impide inyección de `hogar_id` ajeno y garantiza que `hogar_id` siempre cuadre con `ambito`.

---

## 2. RLS compartida (enfoque A — helper SECURITY DEFINER)

Función helper, evita recursión de RLS y unifica la fuente:

```sql
create or replace function public.auth_hogar_id()
returns uuid language sql stable security definer set search_path = public as $$
  select hogar_id from public.hogar_miembros where user_id = (select auth.uid()) limit 1;
$$;
```

Policies sobre `transacciones` y `metas` (SELECT):

```sql
using (
  (select auth.uid()) = user_id
  or (hogar_id is not null and hogar_id = (select public.auth_hogar_id()))
)
```

- INSERT/UPDATE `with check`: `user_id = (select auth.uid())` (solo escribes filas tuyas). El trigger ya fuerza el `hogar_id` correcto, así que un usuario no puede crear filas en hogar ajeno aunque su `user_id` sea suyo.
- DELETE: solo filas propias (`user_id = (select auth.uid())`); metas conservan la excepción de fondo de emergencia no borrable.
- `hogares`, `hogar_miembros`, `hogar_codigos`, `hogar_liquidaciones`: visibles solo a miembros del hogar (vía `auth_hogar_id()` o `user_id` propio para miembros). Los códigos NUNCA se exponen a no-miembros; la validación de un código entrante va por RPC, no por SELECT directo.

**Resultado de aislamiento esperado** (test 3 usuarios A, B en hogar H; C fuera):
- C no lee ni escribe nada de A ni de B.
- A ve las filas `ambito='hogar'` de B, pero NO las `ambito='personal'` de B.
- B no puede insertar una fila con `hogar_id` distinto al suyo.

---

## 3. RPCs (SECURITY DEFINER) — toda mutación sensible vía función

- `crear_hogar(p_nombre text) returns uuid` — crea hogar, membresía `rol='creador'`, y primer código (24h). Falla si el llamante ya tiene hogar.
- `generar_codigo() returns char(6)` — invalida el código activo anterior, genera uno nuevo de 6 dígitos (colisión verificada contra códigos activos), `expira_at = now()+24h`. Solo miembro del hogar.
- `unirse_hogar(p_codigo char(6)) returns uuid` — valida: código existe, `usado=false`, `expira_at>now()`, hogar con <2 miembros, llamante sin hogar. Crea membresía `rol='miembro'`, marca código `usado=true`. **Backfill:** asocia las filas `ambito='hogar'` previas del que se une (`update transacciones/metas set hogar_id = <hogar> where user_id = caller and ambito='hogar'`). Devuelve `hogar_id`.
- `saldar_hogar(p_monto numeric, p_nota text) returns uuid` — registra una `hogar_liquidaciones` en la dirección del neto actual; resetea el balance pendiente. Solo miembro.
- `disolver_hogar() returns jsonb` — ver sección 5.

Todas: `grant execute ... to authenticated`.

---

## 4. Balance "quién debe qué" (día a día)

Sobre `tipo='gasto'`, `ambito='hogar'`, del hogar:
- `pagóA` = Σ gastos hogar con `user_id=A`; `pagóB` análogo.
- `neto_A = (pagóA − pagóB) / 2 − Σ liquidaciones(de=B→a=A) + Σ liquidaciones(de=A→a=B)`.
- Si `neto_A > 0` ⇒ "B te debe S/ neto_A"; si <0, al revés.

Implementación: función JS pura `calcularBalanceHogar(gastos, liquidaciones, uidA, uidB)` en `js/hogar-balance.js`, testeable con `test/hogar-balance.test.mjs`. Botón "Saldar" llama `saldar_hogar`. Card de balance en dashboard cuando hay hogar.

Ingresos y aportes a metas NO entran a este balance (son del ahorro del hogar, sección 5).

---

## 5. Disolución

`disolver_hogar()`:
1. `ingHog_A` = Σ `tipo='ingreso', ambito='hogar', user_id=A`; `ingHog_B` análogo. `pct_A = ingHog_A / (ingHog_A + ingHog_B)` (si ambos 0 ⇒ 50/50).
2. `ahorro_hogar` = Σ saldo de metas hogar + fondo de emergencia hogar (= Σ ingresos hogar − Σ gastos hogar).
3. **Efecto físico (aprobado):**
   - Las metas y el fondo de emergencia de hogar se reasignan como **personales al creador** (`ambito='personal'`, `hogar_id=NULL`, `user_id=creador`).
   - La parte que le toca al miembro saliente (`pct_saliente · ahorro_hogar`) se registra como **liquidación final**: deuda del creador (que retiene las metas) hacia el saliente.
   - Las transacciones históricas conservan su `hogar_id` (quedan visibles para quien las creó; el otro las pierde al borrarse su membresía, salvo las suyas propias por `user_id`). Futuras transacciones de ambos son personales.
   - Se borran las membresías (cascade borra códigos; el hogar puede quedar como tombstone o borrarse — decisión de implementación: borrar el hogar tras reasignar).
4. Devuelve un `jsonb` con el statement final: `{ pct_a, pct_b, ahorro, recibe_a, recibe_b, liquidacion_final }` para que la UI lo muestre.

Salir = disolver (con 2 miembros, que uno salga disuelve el hogar). Confirmación explícita en UI antes de disolver.

---

## 6. UI y Realtime

Nueva vista `views/hogar.html` (hash-route `#hogar`), siguiendo patrones existentes (IIFE, `var`, `escHtml`, estilo editorial dark champagne `#c9a84c`):
- **Sin hogar:** dos acciones — "Crear hogar" (pide nombre) y "Unirme con código" (input 6 dígitos).
- **Con hogar:** lista de miembros, código activo (copiar / regenerar, con countdown de expiración), card de balance "quién debe qué" + botón "Saldar", botón "Salir / disolver hogar" (con confirmación y preview del reparto).
- Entrada al menú/nav hacia `#hogar`. Card de balance también en dashboard cuando hay hogar.

**Realtime:** suscripción Supabase a cambios de `transacciones` y `metas` filtrados por `hogar_id` del usuario → refresca dashboard/historial en vivo cuando el otro miembro registra algo. Verificar que `20260605_enable_realtime.sql` cubra estas tablas; si no, añadirlas a la publicación.

---

## 7. Testing (TDD — el punto más delicado)

**SQL (pgTAP en `supabase/tests/`)** con 3 usuarios A, B (hogar H), C (fuera):
- C no ve ninguna fila de A/B (personal ni hogar).
- A ve gastos `ambito='hogar'` de B; A NO ve gastos `ambito='personal'` de B.
- B no puede insertar fila con `hogar_id` ≠ su hogar (trigger rechaza).
- `unirse_hogar` con código expirado → error; con código usado → error; estando ya en hogar → error.
- hogar lleno (2) → `unirse_hogar` rechaza.
- `disolver_hogar` reparte el ahorro por `pct` correcto y genera la liquidación final.

**JS puro (`test/*.test.mjs`)** con datos sintéticos:
- `calcularBalanceHogar` — casos: A pagó más, B pagó más, con liquidaciones, empate.
- cálculo de `pct` y reparto de disolución.

---

## 8. Orden de implementación (para writing-plans)

1. Migración SQL: tablas + columna `hogar_id` + trigger de invariante + `auth_hogar_id()` + RLS + RPCs. (NO aplicar a prod; revisión manual del SQL.)
2. Tests SQL pgTAP (TDD: escribir antes/junto con las policies).
3. JS puro de balance + tests.
4. RPCs wiring en `js/db.js`.
5. Vista `views/hogar.html` + nav + card dashboard.
6. Realtime.
7. Verificación manual en preview con 2 cuentas; bump `SHELL_VERSION` en `sw.js`; push a `v2`.

---

## Riesgos / notas

- **Seguridad:** la RLS compartida es irreversible si se hace mal. NO aplicar a producción sin revisar el SQL manualmente. Probar aislamiento con TDD de 3 usuarios antes de cerrar.
- **Backfill al unirse:** asociar filas `ambito='hogar'` previas al hogar nuevo puede exponer historial viejo al otro miembro. Es el comportamiento deseado (esas filas ya eran "de hogar"), pero documentarlo en la UI de unión.
- **Disolución destructiva:** reasigna metas al creador. Confirmación explícita obligatoria.
- **Convenciones:** IIFE, `var`, `escHtml()`, hash-routing, no romper patrones existentes.
