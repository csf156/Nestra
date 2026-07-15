# Nestra v2 — reglas del proyecto

App PWA vanilla (sin build). Rama de trabajo/deploy: `v2`.

**v1 retirada el 2026-07-01.** `main` ahora sirve el código v2 sobre la base v2 (`ombnhxueclqfeyjzhroz`) — se hizo cutover (PR #5) tras migrar los datos reales de los 2 usuarios de la base v1 a la v2. `js/config.js` ya NO tiene gate por hostname: todos los hosts usan la base v2. Ambas ramas (`v2` y `main`) llevan la misma config. Hosts vivos: `nestra-8rl.pages.dev` (Cloudflare Pages, rama v2) y `csf156.github.io/Nestra/` (GitHub Pages, rama main) — ambos = mismo código v2, misma base v2.

## Deploy y preview en el teléfono del usuario

El sitio del usuario es **Cloudflare Pages**: `https://nestra-8rl.pages.dev/`.
Pages está conectado al repo `csf156/Nestra` y **reconstruye automáticamente al hacer `git push origin v2`** (rama `v2` = producción de ese proyecto Pages; NO toca v1/main). Para que el usuario vea cambios en su teléfono o laptop: **commit + push a `v2`**, esperar ~1-2 min el build, y recargar / cerrar-reabrir la PWA.

- NO es un túnel a un server local. El server local en 5050 (`preview_start` config `nestra` de `.claude/launch.json`, `npx serve -l 5050 .`) sirve SOLO para tu verificación en navegador; el usuario NO lo ve.
- Tras `push`, verificar el deploy live con `curl -sL https://nestra-8rl.pages.dev/sw.js | grep SHELL_VERSION`.
- Las vistas (`views/*.html`) usan **NetworkFirst** en `sw.js`; los cambios se ven al recargar online. Tras cambios de assets se bumpea `SHELL_VERSION` en `sw.js`; en el teléfono puede requerir cerrar/reabrir la PWA para tomar el shell nuevo.
- El SW y la cámara (`<input capture>`) exigen HTTPS; Pages ya lo da.

## Migraciones de base de datos

**La tabla de migraciones de la base v2 miente: `list_migrations` NO registra las que se aplicaron a mano por el SQL Editor.** Varias del repo están realmente aplicadas sin figurar en el ledger, y las anteriores al 2026-06-19 son de la era v1 y están horneadas en `supabase/schema_v2_fresh.sql` (con él se creó la base v2 desde cero). Esta deriva ya causó un bug de 13 días en producción: la migración de Fase 6.2 nunca se aplicó, el código salió contra un esquema sin sus columnas, y las features fallaban en silencio (`|| '50_50'`, filtros `> 0` que descartan NULL).

- **Nunca afirmes que una migración está aplicada sin introspeccionar el esquema**: `information_schema.columns` para columnas, `pg_proc` para RPCs, `pg_policy` para RLS. Ni el ledger ni los docs ni la memoria valen como prueba.
- **Aplicar con `apply_migration`** (queda registrada), no con el SQL Editor.
- **Nunca apliques una migración sin que el usuario revise el SQL primero.** Hay datos reales de 2 usuarios.
- Tras añadir una columna que el cliente escribe, verificar la cadena completa: existe la columna → el grant es de tabla y no por columna (si fuera por columna, la nueva no queda concedida) → PostgREST la ve (`curl` al REST da 400 "column does not exist" si la caché de esquema está rancia) → la policy RLS la cubre.
- **Riesgo abierto:** por la deriva, un `supabase db push` con la CLI intentaría aplicar ~15 migraciones viejas ya horneadas en la base, y no consta que todas sean idempotentes. Decidir antes de usar la CLI contra esta base.
