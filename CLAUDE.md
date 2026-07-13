# Nestra v2 — reglas del proyecto

App PWA vanilla (sin build). Rama de trabajo/deploy: `v2`. Producción v1 vive en `main` — no tocarla.

## Deploy y preview en el teléfono del usuario

El sitio del usuario es **Cloudflare Pages**: `https://nestra-8rl.pages.dev/`.
Pages está conectado al repo `csf156/Nestra` y **reconstruye automáticamente al hacer `git push origin v2`** (rama `v2` = producción de ese proyecto Pages; NO toca v1/main). Para que el usuario vea cambios en su teléfono o laptop: **commit + push a `v2`**, esperar ~1-2 min el build, y recargar / cerrar-reabrir la PWA.

- NO es un túnel a un server local. El server local en 5050 (`preview_start` config `nestra` de `.claude/launch.json`, `npx serve -l 5050 .`) sirve SOLO para tu verificación en navegador; el usuario NO lo ve.
- Tras `push`, verificar el deploy live con `curl -sL https://nestra-8rl.pages.dev/sw.js | grep SHELL_VERSION`.
- Las vistas (`views/*.html`) usan **NetworkFirst** en `sw.js`; los cambios se ven al recargar online. Tras cambios de assets se bumpea `SHELL_VERSION` en `sw.js`; en el teléfono puede requerir cerrar/reabrir la PWA para tomar el shell nuevo.
- El SW y la cámara (`<input capture>`) exigen HTTPS; Pages ya lo da.
