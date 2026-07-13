# Migración v1 → v2 y cutover a `main` — diseño

**Fecha:** 2026-07-01
**Estado:** diseño, pendiente aprobación del usuario
**Objetivo de negocio:** Promover Nestra v2 a producción sobre `main`, preservando los datos reales de los 2 usuarios de v1.

## Contexto y riesgo

`main` = producción v1, servida por GitHub Pages en `csf156.github.io`. `js/config.js` enruta por hostname: `csf156.github.io` → base **v1** (`rblxwqdphhmpglxxtgtv`); cualquier otro host → base **v2** (`ombnhxueclqfeyjzhroz`). El historial de `main` ya contiene un merge de v2 **revertido** (rompió v1 el 2026-06-22 por columnas de esquema faltantes) + un **kill-switch del service worker**.

Mergear v2 → main tal cual rompería v1 otra vez (v2 asume 27 migraciones que la base v1 no tiene). Por eso el objetivo se ejecuta como **cutover**: `main` pasará a servir el código v2 **apuntando a la base v2**, retirando v1; y los datos reales de v1 se **migran a la base v2** antes del cutover.

## Decisiones tomadas

- **Cutover, no merge sobre v1**: `main` sirve código v2 sobre base v2. v1 se retira.
- **Preservar datos** de los 2 usuarios v1 (csf156@gmail.com, mezareyesdarling@gmail.com).
- **Colisión csf156**: v2 ya tiene csf156 con datos de PRUEBA (9 tx, 3 metas). Se **borran** y se cargan los reales de v1.
- **Cuenta mezareyes**: no existe en v2 → crear vía **Admin API** (service_role key de v2) con contraseña temporal.
- **Categorías custom**: no globales → **copias por-usuario**.
- **Hogar compartido**: **reconstruir** en v2 (csf156 creador, mezareyes miembro, nombre "Nuestro hogar").
- **Fase A (datos) se completa y verifica ANTES de Fase B (código)**. Entre ambas, el usuario valida los datos en `nestra-8rl.pages.dev` (ya sirve v2) antes de tocar `main`.

## Mapa de identidades

| Usuario | id v1 | id v2 |
|---|---|---|
| csf156@gmail.com | `aa5a03e9-12fe-4e9f-8900-ced28359db90` | `42c18981-e55f-4271-8f01-e89ab2975f44` (existente) |
| mezareyesdarling@gmail.com | `6cb374ae-4450-4f19-bc8c-f2e7f4842982` | **nuevo** (Admin API) |

## Datos en v1 a migrar

Tablas con datos (el resto de v1 vacías): profiles (2), categorias (34), categorias_favoritas (5), metas (5), aportes_meta (2), transacciones (117). `prestamos`, `desafios` vacías. v1 no tiene plantillas/presupuestos/recurrentes/hogares.

Reparto tx: personal → mezareyes 98, csf156 16; hogar → mezareyes 2, csf156 1 (117 total).

## Credenciales necesarias

- **Token `sbp_` de cuenta** (Management API, lectura v1) — ya disponible.
- **service_role key de v2** — para crear el usuario mezareyes (Auth Admin API). A solicitar en implementación; no se commitea.
- Los inserts de datos en v2 corren vía **MCP `execute_sql`** (rol postgres, bypassa RLS). Orden de inserción respeta FKs.

---

## Fase A — Migración de datos (base v1 → base v2)

### A0. Backup / rollback
Antes de cualquier escritura: exportar a scratchpad (a) filas actuales de v2 de las tablas afectadas (para csf156 y globales), (b) volcado completo de las tablas de datos de v1. Rollback = restaurar el snapshot v2. La base v1 no se toca (solo lectura).

### A1. Crear usuario mezareyes en v2
Auth Admin API de v2 (`POST /auth/v1/admin/users`, header `Authorization: Bearer <service_role>`, `apikey: <service_role>`): email `mezareyesdarling@gmail.com`, `email_confirm: true`, `password` temporal (comunicar al usuario). Capturar el `id` v2 generado → `MEZA_V2`.

**Caveat trigger:** crear el usuario dispara `handle_new_user` (ver migración `20260605_harden_handle_new_user.sql`), que probablemente auto-crea una fila en `profiles` y/o siembra datos para `MEZA_V2`. Antes de A5, **limpiar** cualquier fila auto-creada de `MEZA_V2` (profiles, categorias propias, favoritas) para que los inserts de v1 no colisionen con el UNIQUE de `profiles.user_id` ni dupliquen. Verificar qué siembra el trigger justo tras A1 y reconciliar (borrar auto-creadas, o usar UPSERT en A5).

### A2. Borrar datos de prueba de csf156 en v2
Borrar en v2 (orden inverso a FKs) las filas de csf156 (`42c18981…`): aportes_meta, transacciones, categorias_favoritas, metas, categorias propias (`user_id = 42c18981…`), profiles de csf156. Conservar: categorías globales (`user_id is null`), y el usuario de test `nestra.pwa.test` intacto. (El usuario de test puede quedar o borrarse; se deja.)

### A3. Reconstruir el hogar en v2
1. `hogares`: 1 fila, `nombre='Nuestro hogar'`, `creado_por = 42c18981…` (csf156). Capturar id → `HOGAR`.
2. `hogar_miembros`: csf156 (`rol='creador'`), mezareyes `MEZA_V2` (`rol='miembro'`).

### A4. Mapa de categorías v1 → v2
- **26 categorías v1** coinciden por (nombre, tipo) con las **globales** de v2 → remapear a la id global existente. Sin insertar.
- **Custom (7, "Bicicleta" se omite por 0 usos)** → crear **copias por-usuario** en v2, `esencial=true`, `user_id`=dueño, tipo correcto. Regla: para cada categoría custom, crear una copia por **cada usuario que la referencia** en transacciones ∪ metas ∪ favoritas:
  - **csf156**: `Ahorro` (gasto), `Chucherias` (gasto).
  - **mezareyes**: `Ahorro` (gasto), `Chucherias` (gasto), `Telefonia` (gasto), `Aporte Mutuo` (ingreso), `Clases de Bici` (ingreso), `Grooming Home` (ingreso), `Veterinaria` (ingreso).
- Construir tabla de remapeo `(v1_cat_id, user_id) → v2_cat_id`: globales ignoran user_id; custom usan la copia del usuario dueño de la fila que se migra.

### A5. Migrar filas (remapeo user_id + categoria_id + columnas nuevas)
Orden por FKs: profiles → metas → transacciones → aportes_meta → categorias_favoritas. Preservar los **ids originales** de v1 (mantiene cadenas FK: `aportes_meta.transaccion_id/meta_id`, `transacciones.aporte_id`).

- **profiles** (2): remapear user_id; `moneda='PEN'`; `onboarding_completado=true` (usuarios existentes, no ven el wizard); `nombre`/`aporte_mensual_esperado` de v1.
- **metas** (5):
  - 2 metas de hogar (v1 user_id null, ambito hogar): `user_id = 42c18981…` (csf156, creador), `hogar_id = HOGAR`, `ambito='hogar'`. "Alquiler 🏠" con categoría → copia Ahorro de csf156.
  - 3 metas personales: remapear user_id; `hogar_id=null`; `categoria_id` remapeado si aplica.
  - `tipo` v1 (`ahorro`) es válido en el CHECK v2. `updated_at=now()`.
- **transacciones** (117): remapear user_id + categoria_id (por dueño para custom); `updated_at = created_at` (fidelidad LWW); `hogar_id = HOGAR` para las 3 de ambito hogar, `null` para personales; `split_id/recibo_path=null`. Conservar `fecha, tipo, ambito, monto, nota, aporte_id, es_aporte_directo, created_at`.
- **aportes_meta** (2): remapear; `user_id` = autor de la transacción asociada (mezareyes 250, csf156 50); `peso_aplicado=null`. Ambos apuntan a la meta hogar "Fondo de emergencia".
- **categorias_favoritas** (5): remapear user_id + categoria_id (favorita Chucherias de csf156 → su copia).

### A6. Verificación de datos
SQL de aserción tras la migración:
- Conteos por usuario: transacciones (csf156 17, mezareyes 100), metas, aportes coinciden con v1.
- Integridad FK: 0 `categoria_id`/`meta_id`/`transaccion_id`/`hogar_id` colgando.
- RLS: simular cada usuario (`set request.jwt.claims`) y confirmar que ve solo lo suyo + globales + hogar.
- Sumas: total gastos/ingresos por usuario igual a v1.
- Smoke en `nestra-8rl.pages.dev`: login csf156 y mezareyes; ver sus datos reales, el hogar y sus metas. **El usuario valida aquí antes de Fase B.**

---

## Fase B — Cutover de código (`main` → v2)

### B1. Cutover de `config.js`
v1 se retira → eliminar el gate por hostname; `SUPABASE_URL`/`SUPABASE_ANON_KEY` apuntan **siempre** a v2. Mantener `VAPID_PUBLIC_KEY`. Así cualquier host (incluido `csf156.github.io`) usa la base v2.

### B2. Service worker
El `sw.js` real de v2 reemplaza el kill-switch actual de `main` (llega con el árbol de v2 en el merge). Sin acción extra salvo confirmar que el `sw.js` resultante en `main` es el de v2.

### B3. Merge a `main` (branch protection exige PR)
Crear branch `cutover/v2-to-main` desde `v2`, aplicar el cambio de `config.js` (B1), abrir **PR a `main`** resolviendo conflictos a favor del árbol de v2 (net: `main` == `v2` + cutover config). Merge por PR (no push directo).

### B4. Verificación del cutover
Tras el build de GitHub Pages:
- `csf156.github.io` sirve v2 sobre base v2.
- **Prueba crítica**: login de ambos usuarios y **escribir una transacción** en `csf156.github.io` (ejerce el esquema `updated_at` que rompió v1 antes). Debe funcionar.
- `nestra-8rl.pages.dev` sigue operativo (mismo código, misma base).
- Rollback: revert del PR (como el PR #3 anterior) si algo falla.

## Alcance / decomposición

Dos planes de implementación secuenciados bajo este spec:
1. **Plan A — Migración de datos** (Fases A0–A6). Entregable verificable por sí solo (datos reales correctos en v2, validados en pages.dev).
2. **Plan B — Cutover de código** (Fases B1–B4). Se ejecuta solo tras aprobar el resultado de A.

## Fuera de alcance
- Migrar tablas vacías de v1 (prestamos, desafios).
- Migrar features que v1 no tenía (recurrentes, presupuestos, plantillas, push): nada que migrar.
- Retirar el host `nestra-8rl.pages.dev` o `csf156.github.io` (ambos quedan sirviendo v2; consolidar hosts es decisión posterior).
- Cambiar contraseñas de csf156 (usa su contraseña actual de v2).
