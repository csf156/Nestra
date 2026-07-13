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
