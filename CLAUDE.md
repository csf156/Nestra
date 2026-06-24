# Nestra v2 — reglas del proyecto

App PWA vanilla (sin build). Rama de trabajo/deploy: `v2`. Producción v1 vive en `main` — no tocarla.

## Preview en el teléfono del usuario

El usuario tiene un **túnel Cloudflare** que apunta a un server local en el **puerto 5050**.
Para que vea cambios en su teléfono: levantar el server en 5050 y el usuario abre su link Cloudflare.

- Usar `preview_start` con la config `nestra` de `.claude/launch.json` (`npx serve -l 5050 .`). Eso sirve a la vez tu verificación en navegador y el túnel del usuario.
- **No** usar `http://<LAN-IP>:puerto`: el service worker y la cámara (`<input capture>`) exigen HTTPS; solo el túnel lo da.
- **No** usar GitHub Pages para preview: sirve una sola rama por repo y apuntarlo a `v2` reemplazaría la URL de producción v1.
- Tras cambios de assets se bumpea `SHELL_VERSION` en `sw.js`; en el teléfono puede requerir cerrar/reabrir la PWA para tomar el shell nuevo.
