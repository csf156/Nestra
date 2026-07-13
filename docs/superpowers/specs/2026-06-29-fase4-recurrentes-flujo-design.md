# Fase 4 (partes faltantes) — Recurrentes + Flujo de caja proyectado — Design

> **Contexto:** la Fase 4 del plan maestro (`2026-06-12-nestra-v2-plan-fases.md`) tiene tres partes:
> (1) Presupuestos por categoría — **ya implementada** (tabla `presupuestos`+RLS, store IndexedDB,
> CRUD, sección en configuración, tarjeta en dashboard, `estadoPresupuesto`+tests, hook de alerta).
> (2) Suscripciones / gastos recurrentes — **faltante**.
> (3) Calendario de flujo de caja proyectado — **faltante** (el "Flujo de caja" actual en
> `views/graficos.html` `chart6` es histórico: Ingresos/Gastos/Balance del mes, no una proyección).
>
> Este spec cubre **solo las dos partes faltantes**. Presupuestos NO se toca.

## Decisiones aprobadas

1. **Saldo inicial de la proyección = neto acumulado del mes** (ingresos − gastos del mes en curso
   hasta hoy). Nestra no tiene saldo bancario; este valor ya lo calcula el resumen/dashboard.
2. **Recurrentes = detección automática + alta manual.** El detector propone candidatos del
   historial; el usuario también puede crear/editar/eliminar recurrentes a mano.
3. **Ubicación UI:** proyección de saldo como card nueva en `#graficos`; gestión de recurrentes
   como sección nueva en `#configuracion` (igual patrón que presupuestos).

## Convenciones (no romper)

IIFE, `var`, `escHtml()` en contenido de usuario, CSS custom properties (tokens existentes),
hash-routing SPA, PWA con Workbox vendorizado, sin build. Estilo editorial dark ya vigente
(acento champagne `#c9a84c`, barras finas, chips de categoría 24×24 tintados, números grandes
en Playfair vía `.signature-num`). Sin AI externa: detección por reglas, funciones puras.

---

## A. Capa de datos

### Migración `supabase/migrations/20260629_recurrentes.sql`

Misma forma que `20260622_presupuestos.sql` (idempotente, RLS por dueño, trigger `set_updated_at`
reutilizado).

```sql
create table if not exists public.recurrentes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  descripcion   text not null,
  monto         numeric(10,2) not null check (monto > 0),
  tipo          text not null default 'gasto' check (tipo in ('gasto','ingreso')),
  categoria_id  uuid references public.categorias (id) on delete set null,  -- nullable
  frecuencia    text not null default 'mensual'
                  check (frecuencia in ('mensual','quincenal','semanal')),
  dia_cargo     smallint check (dia_cargo between 1 and 31),
  proximo_cargo date,
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_recurrentes_user on public.recurrentes (user_id);

alter table public.recurrentes enable row level security;
drop policy if exists "recurrentes_acceso" on public.recurrentes;
create policy "recurrentes_acceso" on public.recurrentes for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop trigger if exists trg_recurrentes_updated_at on public.recurrentes;
create trigger trg_recurrentes_updated_at before update on public.recurrentes
  for each row execute function public.set_updated_at();
```

Un solo registro con `tipo` cubre **ingresos fijos** (sueldo, renta) y **gastos recurrentes**
(suscripciones), ambos consumidos por la proyección. `categoria_id` nullable: un ingreso fijo
puede no tener categoría.

**RLS:** estrictamente por dueño, igual a presupuestos. NO aplicar a producción (v1) — solo a la
instancia Supabase v2. Revisar SQL antes de aplicar.

### IndexedDB (`js/nestra-db.js`)

- Añadir `'recurrentes'` a `MIRROR_STORES`.
- Bump `NESTRA_IDB_VERSION` 4 → 5 (el `upgrade()` crea el store nuevo por el loop de `MIRROR_STORES`).

### CRUD (`js/db.js`)

Patrón espejado + offline (igual a préstamos):

- `getRecurrentes()` → `_mirroredRead('recurrentes', …)`; `select('*')` ordenado por `created_at`.
- `upsertRecurrente(fila)` → online: `supabase.from('recurrentes').upsert(...).select().single()`
  + `mirrorPut`; offline: `outboxAdd` + `mirrorPut({..._pending:true})` + `notifyPendingChanged()`.
  Genera `id` con `crypto.randomUUID()` y `updated_at` ISO si es alta (LWW).
- `deleteRecurrente(id)` → online: delete + `db.delete('recurrentes', id)`; offline: outbox
  `delete_recurrente` análogo a `delete_transaccion` (ver `js/sync.js`).

Sync (`js/sync.js`) procesa el outbox genéricamente (`entity → table`); solo requiere el handler
de delete si se usa el patrón delete-offline. Para `upsert` el flujo genérico ya sirve.

---

## B. Módulos puros (TDD)

### `js/recurrentes-detect.js` — `detectarRecurrentes(txs, existentes, hoy)`

- **Entrada:** `txs` (historial, p.ej. 120 días), `existentes` (recurrentes ya registrados),
  `hoy` (ISO inyectado para testabilidad).
- **Reglas:** agrupar transacciones por `(categoria_id, monto redondeado ± tolerancia)`.
  Tolerancia: `max(2, monto * 0.05)` (±5% o ±S/2, lo que sea mayor). Un grupo es candidato si
  tiene **≥2 ocurrencias** con separación media de **25–35 días** (mensual). (Quincenal/semanal:
  fuera del alcance del detector v1; soportados solo en alta manual.)
- **No duplicar:** descartar candidatos cuya `(categoria_id, monto±tol)` ya exista en `existentes`.
- **Salida:** array de candidatos
  `{ descripcion, monto, tipo, categoria_id, frecuencia:'mensual', proximo_cargo, ocurrencias }`.
  `proximo_cargo` = fecha de la última ocurrencia + ~1 mes; `descripcion` = la nota más frecuente
  del grupo (o nombre de categoría si vacío).
- Función pura → tabla de casos en `test/recurrentes-detect.test.mjs`.

### `js/flujo-proyeccion.js` — `proyectarFlujo({ saldoInicial, hoy, finMes, recurrentes, aportesMeta })`

- **Entrada:** `saldoInicial` (neto del mes hasta hoy), `hoy` y `finMes` (ISO), `recurrentes`
  (activos), `aportesMeta` (aportes planificados con fecha, derivados de metas — reusar la lógica
  de aporte planificado que ya usa `safe-to-spend.js` si aplica).
- **Lógica:** iterar día desde `hoy` hasta `finMes`. Para cada día:
  - sumar recurrentes `tipo:'ingreso'` cuyo cargo cae ese día (por `dia_cargo`/`proximo_cargo`),
  - restar recurrentes `tipo:'gasto'` que caen ese día,
  - restar aportes a metas programados ese día.
  - acumular en el saldo corriente.
- **Salida:** `{ dias: [{ fecha, saldo }], primerDiaNegativo: fecha|null, saldoFinal }`.
- Función pura → `test/flujo-proyeccion.test.mjs` (sin saldo negativo; con día negativo; sin
  recurrentes → línea plana).

`saldoInicial` y `aportesMeta` los arma el llamador (vista) con datos ya disponibles; los módulos
no tocan la red.

---

## C. UI

### `#configuracion` — sección "Gastos recurrentes"

- **Lista** de recurrentes activos: chip de categoría 24×24 tintado (`.cat-chip` con `--chip-color`),
  descripción (`escHtml`), monto, frecuencia, próximo cargo. Acciones editar / eliminar.
- **Total mensual comprometido** = suma de recurrentes `tipo:'gasto'` mensualizados, mostrado en
  Playfair (`.signature-num`).
- **Bloque "Detectados"**: candidatos de `detectarRecurrentes(...)` con botón "Marcar como
  recurrente" (alta 1-tap vía `upsertRecurrente`) o "Descartar".
- **Form alta manual**: descripción, monto, tipo (gasto/ingreso), categoría (selector buscable
  existente `searchable-select.js`), frecuencia, día de cargo.
- Empty state si no hay recurrentes ni candidatos.

### `#graficos` — card "Proyección de saldo" (`chart7`, línea)

- Línea día-a-día del saldo proyectado del mes (datos de `proyectarFlujo`).
- Marca visual en `primerDiaNegativo` (punto/anotación en `--color-danger`); línea en champagne.
- Ejes/labels leen tokens (`cssVar(...)`), patrón de los charts existentes.
- Empty/insufficient state si no hay recurrentes ni ingresos fijos (mensaje + CTA a configurar
  recurrentes).
- **No modifica** `chart6` (flujo histórico).

---

## D. Wiring

- `index.html`: cargar `js/recurrentes-detect.js` y `js/flujo-proyeccion.js` (y el módulo UI de
  recurrentes si se separa de la vista de config).
- `sw.js`: añadir los scripts nuevos al precache; bump `SHELL_VERSION`.
- `js/nestra-db.js`: store + version bump (sección A).

---

## E. Tests

- `test/recurrentes-detect.test.mjs` — node `--test`, tabla de casos: detecta mensual repetido;
  ignora una sola ocurrencia; respeta tolerancia; excluye ya-registrados; tipo ingreso vs gasto.
- `test/flujo-proyeccion.test.mjs` — proyección plana sin recurrentes; día negativo detectado;
  ingreso fijo levanta el saldo; aportes a metas restan en su día.

---

## Verificación

- Detección propone marcar como recurrente un gasto mensual repetido (datos de prueba).
- Alta manual crea recurrente y aparece en la lista con su total comprometido.
- La proyección dibuja el saldo del mes y marca correctamente un día de saldo negativo con datos
  sintéticos; línea plana sin recurrentes.
- Todo funciona offline (alta de recurrente en modo avión → outbox → sync al reconectar).
- Presupuestos y el flujo histórico (chart6) intactos.

## No-duplicación (guardas explícitas)

- Presupuestos: NO se toca (parte ya implementada).
- `chart6` flujo histórico: NO se toca; la proyección es un `chart7` separado.
- Detector excluye recurrentes ya registrados (no propone duplicados).
- Reusar primitivas existentes: `.cat-chip`, `.signature-num`, `.progress`, `searchable-select.js`,
  `_mirroredRead`/`outboxAdd`/`mirrorPut`, `set_updated_at()`.
