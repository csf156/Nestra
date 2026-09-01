# Nestra v2 — reglas del proyecto

App PWA vanilla (sin build). **Rama única de trabajo y deploy: `main`.**

**v1 retirada el 2026-07-01**, y **`v2` retirada el 2026-07-17.** Todo vive en `main`, sobre la base v2 (`ombnhxueclqfeyjzhroz`). `js/config.js` no tiene gate por hostname: todos los hosts usan la base v2.

**Un solo host vivo: `nestra-8rl.pages.dev`** (Cloudflare Pages, rama `main`). GitHub Pages (`csf156.github.io/Nestra/`) se retiró el 2026-07-17.

> **Por qué se consolidó, para no repetirlo:** durante ~3 días hubo dos ramas sirviendo dos hosts contra la MISMA base, y `main` se quedó 70 commits atrás sin que nada lo detectara (v21 vs v30) — el deploy diario solo tocaba `v2`. Código viejo contra esquema nuevo rompe de verdad: `main` tenía el toggle de ámbito hogar pero no el gate de "hogar sin ingresos", y la base ya tenía el CHECK. Una rama, un host, cero deriva posible.

## Deploy y preview en el teléfono del usuario

El sitio del usuario es **Cloudflare Pages**: `https://nestra-8rl.pages.dev/`.
Pages está conectado al repo `csf156/Nestra` y **reconstruye automáticamente al hacer `git push origin main`** (rama `main` = producción de ese proyecto Pages). Para que el usuario vea cambios en su teléfono o laptop: **commit + push a `main`**, esperar ~1-2 min el build, y recargar / cerrar-reabrir la PWA.

- **`main` está protegida:** el push directo se rechaza (`repository rule violations`). Hay que abrir PR (`gh pr create`) y mergearlo. No intentes forzar el push.
- **Hay dos worktrees del repo**: `C:/Users/csf93/Desktop/Nestra` y `C:/Users/csf93/Desktop/Nestra/..Nestra-v2` (de ahí el path con puntos). Solo uno puede tener `main` checkouteado a la vez; si `git checkout main` falla con *"already used by worktree"*, es eso. Trabajar en una rama aparte y abrir PR lo evita.
- NO es un túnel a un server local. El server local en 5050 (`preview_start` config `nestra` de `.claude/launch.json`, `npx serve -l 5050 .`) sirve SOLO para tu verificación en navegador; el usuario NO lo ve.
- Tras el merge, verificar el deploy live **con cache-buster** — la caché de borde de Pages devuelve el archivo viejo y da falsos negativos:
  `curl -sL "https://nestra-8rl.pages.dev/sw.js?cb=$RANDOM" | grep SHELL_VERSION`
- Las vistas (`views/*.html`) usan **NetworkFirst** en `sw.js`; los cambios se ven al recargar online. Tras cambios de assets se bumpea `SHELL_VERSION` en `sw.js`; en el teléfono puede requerir cerrar/reabrir la PWA para tomar el shell nuevo.
- El SW y la cámara (`<input capture>`) exigen HTTPS; Pages ya lo da.

## Migraciones de base de datos

**La tabla de migraciones de la base v2 miente: `list_migrations` NO registra las que se aplicaron a mano por el SQL Editor.** Varias del repo están realmente aplicadas sin figurar en el ledger, y las anteriores al 2026-06-19 son de la era v1 y están horneadas en `supabase/schema_v2_fresh.sql` (con él se creó la base v2 desde cero). Esta deriva ya causó un bug de 13 días en producción: la migración de Fase 6.2 nunca se aplicó, el código salió contra un esquema sin sus columnas, y las features fallaban en silencio (`|| '50_50'`, filtros `> 0` que descartan NULL).

- **Nunca afirmes que una migración está aplicada sin introspeccionar el esquema**: `information_schema.columns` para columnas, `pg_proc` para RPCs, `pg_policy` para RLS. Ni el ledger ni los docs ni la memoria valen como prueba.
- **Aplicar con `apply_migration`** (queda registrada), no con el SQL Editor.
- **Nunca apliques una migración sin que el usuario revise el SQL primero.** Hay datos reales de 2 usuarios.
- Tras añadir una columna que el cliente escribe, verificar la cadena completa: existe la columna → el grant es de tabla y no por columna (si fuera por columna, la nueva no queda concedida) → PostgREST la ve (`curl` al REST da 400 "column does not exist" si la caché de esquema está rancia) → la policy RLS la cubre.
- **Riesgo abierto:** por la deriva, un `supabase db push` con la CLI intentaría aplicar ~15 migraciones viejas ya horneadas en la base, y no consta que todas sean idempotentes. Decidir antes de usar la CLI contra esta base.
- **Correr `supabase/tests/schema_contract_test.sql` tras cada migración** (vía `execute_sql`, solo lectura). Verifica que toda tabla/RPC/bucket que el cliente invoca de verdad (grepeado de `js/*.js`) exista en el esquema — ataca la causa raíz de arriba sin depender del ledger. Debe imprimir `ALL TESTS PASSED`. Al añadir una tabla/RPC/columna frágil nueva a `js/`, sumarla al test en el mismo commit; si no se mantiene junto al código, deja de proteger nada. Ojo al re-grepear: `supabase.storage.from(...)` (bucket) no es `supabase.from(...)` (tabla) aunque el patrón `.from(` los confunda — ver comentario en el test.

## Rendimiento

**Medición de latencia de `enviar-notificaciones` (2026-07-15 a 2026-07-25, 10 muestras diarias vía tarea programada `nestra-push-latency-watch`):** min 3933ms, max 6492ms, promedio ~4795ms. 0 timeouts, 0 status_code≠200, 0 huecos (falta la muestra del 2026-07-16, el cron no dejó log ese día — no es un hueco de medición, es un día sin dato). `n_subscriptions` se mantuvo en 1 toda la ventana (no hay señal de correlación con volumen porque no hubo variación).

**Recomendación:** el timeout de 30000ms (migración `20260715_cron_notificaciones_timeout.sql`) tiene margen amplio — el máximo observado (6492ms) queda muy por debajo de 20000ms. Mantenerlo así; no hace falta subirlo. Ojo: la muestra es de una sola suscripción activa — si `push_subscriptions` crece, la función pasa a notificar a más destinatarios en el mismo invoke y la latencia real puede escalar con el volumen; si eso ocurre, medir de nuevo antes de asumir que el margen actual se sostiene. Datos crudos en `public._debug_push_latency_log` (tabla diagnóstica, no borrada — decisión de retenerla o limpiarla queda en el usuario).
