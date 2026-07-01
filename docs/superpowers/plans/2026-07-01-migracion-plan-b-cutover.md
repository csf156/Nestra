# Migración v1→v2 — Plan B: Cutover de código a `main`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que `main` sirva el código v2 apuntando a la base v2, retirando v1, mediante un PR (branch protection) que trae el árbol de v2 + el cutover de `config.js`.

**Architecture:** `config.js` deja de enrutar por hostname y apunta siempre a la base v2. Se crea un branch desde `v2` con ese cambio y se mergea a `main` vía PR (push directo a main está bloqueado). GitHub Pages reconstruye `main` → `csf156.github.io` sirve v2 sobre la base v2. El `sw.js` de v2 reemplaza el kill-switch actual de `main`.

**Tech Stack:** git, `gh` CLI (PRs), GitHub Pages, Cloudflare Pages (sin cambios), Supabase v2.

**PRERREQUISITO ABSOLUTO:** Plan A completado y **verificado** (datos reales de los 2 usuarios en la base v2, validados en `nestra-8rl.pages.dev`). Si Plan A no está OK, NO ejecutar Plan B — `csf156.github.io` mostraría v2 sin los datos correctos.

---

### Task 1: Cutover de `config.js`

**Files:**
- Modify: `js/config.js` (en un branch nuevo desde `v2`)

- [ ] **Step 1: Crear el branch de cutover desde v2**

```bash
git checkout v2
git pull origin v2
git checkout -b cutover/v2-to-main
```

- [ ] **Step 2: Reemplazar el gate por hostname por conexión directa a v2**

Contenido nuevo completo de `js/config.js` (v1 retirado → sin condicional; siempre v2):
```javascript
// Supabase Configuration — Nestra v2 (producción única)
// v1 fue retirada el 2026-07-01; todos los datos viven en la base v2 (ombnhxueclqfeyjzhroz).
// Todos los hosts (csf156.github.io, *.pages.dev, localhost) usan la base v2.

const SUPABASE_URL = 'https://ombnhxueclqfeyjzhroz.supabase.co';

const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tYm5oeHVlY2xxZmV5anpocm96Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyOTc5NDksImV4cCI6MjA5Njg3Mzk0OX0.Ep0jXU4r3010tSAY846sYXFWUD7NRSJrykCzPdHUBM0';

// VAPID public key (NO secreta) para suscripción Web Push. La privada vive como secret
// de la Edge Function `enviar-notificaciones`, nunca en el cliente ni en git.
const VAPID_PUBLIC_KEY = 'BEy0lcrgND9vnAirt9FyytTvFeAcVE3pcZVEQRMk2eRP84fhLgGaEYx3tnRT5xQrFzh-o8ocDfjsgGccg3uP4PA';
```

- [ ] **Step 3: Verificar que no quedan referencias a la base v1**

```bash
grep -rn "rblxwqdphhmpglxxtgtv\|csf156.github.io" js/ sw.js || echo "sin referencias a v1/gate"
```
Expected: sin coincidencias (el hostname gate y la URL v1 desaparecieron). Si `sw.js` u otro archivo aún referencia v1, revisarlo.

- [ ] **Step 4: Verificar en preview local que la app carga contra v2**

`npx serve -l 5050 .`, cargar en el navegador, confirmar en consola que `SUPABASE_URL` es la v2 y que el login funciona (usar la cuenta de test v2). Sin errores.

- [ ] **Step 5: Commit**

```bash
git add js/config.js
git commit -m "feat(cutover): config.js apunta siempre a la base v2; retira gate v1"
```

---

### Task 2: Confirmar el service worker de v2 (no el kill-switch)

**Files:**
- Inspect: `sw.js`

- [ ] **Step 1: Verificar que el `sw.js` del branch es el real de v2**

```bash
grep -n "SHELL_VERSION\|killswitch\|unregister" sw.js | head
```
Expected: `SHELL_VERSION` presente (v21+), SIN lógica de kill-switch/auto-unregister. Este `sw.js` (de v2) reemplazará al kill-switch que hoy vive en `main` cuando el PR se mergee. No se requiere edición; solo confirmar.

- [ ] **Step 2: (Sin commit)** — solo verificación.

---

### Task 3: PR de cutover a `main`

**Files:** ninguno (operación git/GitHub).

- [ ] **Step 1: Push del branch**

```bash
git push -u origin cutover/v2-to-main
```

- [ ] **Step 2: Abrir el PR hacia main**

```bash
gh pr create --base main --head cutover/v2-to-main \
  --title "Cutover: promover v2 a producción en main (base v2)" \
  --body "$(cat <<'EOF'
Promueve Nestra v2 a producción sobre `main`.

- `main` pasa a servir el código v2 apuntando a la **base v2** (v1 retirada).
- `js/config.js` deja de enrutar por hostname → siempre base v2.
- El `sw.js` de v2 reemplaza el kill-switch actual de main.
- Datos reales de los 2 usuarios ya migrados y verificados en la base v2 (Plan A).

Prerrequisito cumplido: Plan A verificado en nestra-8rl.pages.dev.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Resolver conflictos a favor del árbol de v2**

`main` tiene commits divergentes (revert del merge viejo + kill-switch + fixes de config). Si el PR reporta conflictos (probable en `js/config.js` y `sw.js`), resolverlos tomando la versión del branch `cutover/v2-to-main` (que es v2 + el cutover de config). Localmente si hace falta:
```bash
git checkout cutover/v2-to-main
git merge origin/main -X ours   # conserva nuestro árbol (v2+cutover) en conflictos
git push origin cutover/v2-to-main
```
Verificar tras el merge que `js/config.js` y `sw.js` siguen siendo los del cutover (grep como en Task 1 Step 3 y Task 2 Step 1).

- [ ] **Step 4: Mergear el PR**

Con las verificaciones del PR en verde:
```bash
gh pr merge cutover/v2-to-main --merge
```
(No `--squash` para preservar el historial de v2. Si branch protection exige revisión, el usuario aprueba el PR en GitHub primero.)

---

### Task 4: Verificación del cutover en producción

**Files:** ninguno.

- [ ] **Step 1: Esperar el build de GitHub Pages y confirmar el asset**

Tras ~1-3 min:
```bash
curl -sL https://csf156.github.io/js/config.js | grep -o "ombnhxueclqfeyjzhroz\|rblxwqdphhmpglxxtgtv"
```
Expected: `ombnhxueclqfeyjzhroz` (base v2), NO `rblxwqdphhmpglxxtgtv`. También:
```bash
curl -sL https://csf156.github.io/sw.js | grep SHELL_VERSION
```
Expected: la versión de v2 (v21+).

- [ ] **Step 2: Prueba crítica — escribir una transacción en csf156.github.io**

En el navegador real, entrar a `https://csf156.github.io`:
- Login csf156 → ve sus datos reales (los migrados en Plan A).
- **Crear una transacción de prueba** y guardar. Debe persistir SIN el error `could not find the 'updated_at' column` (el fallo que rompió v1 antes). Esto confirma que el código v2 corre contra el esquema v2.
- Borrar la transacción de prueba tras confirmar.
- Login mezareyes (contraseña temporal) → ve sus datos y el hogar.
- Consola sin errores.

- [ ] **Step 3: Confirmar que pages.dev sigue operativo**

`https://nestra-8rl.pages.dev` sigue sirviendo v2 sobre la misma base v2 (mismo código, sin regresión). Login smoke rápido.

- [ ] **Step 4: Rollback listo (documentar, no ejecutar salvo fallo)**

Si `csf156.github.io` falla tras el cutover: revertir el PR (`gh pr revert` o `git revert -m 1 <merge_sha>` vía nuevo PR a main, como el PR #3 histórico). Los datos en la base v2 no se ven afectados por un rollback de código.

- [ ] **Step 5: Registrar cierre**

Anotar en `scratchpad/MIGRACION_LOG.md`: SHA del merge, resultado de la prueba crítica, hosts verificados. Migración completa.

---

## Self-Review

**Cobertura del spec (Fase B):**
- B1 cutover config.js → Task 1. ✓
- B2 service worker v2 reemplaza kill-switch → Task 2 (verificación) + llega con el merge (Task 3). ✓
- B3 PR a main resolviendo a favor de v2 → Task 3. ✓
- B4 verificación (config live v2, prueba crítica de escritura, pages.dev, rollback) → Task 4. ✓

**Placeholders:** el `<merge_sha>` en el rollback es un valor en tiempo de ejecución. El resto (contenido de config.js, comandos gh/git, greps) está completo.

**Consistencia:** la URL/anon key de v2 en el nuevo `config.js` coincide con las de la base v2 (`ombnhxueclqfeyjzhroz`) usadas en Plan A y en el `config.js` actual de la rama v2. El `VAPID_PUBLIC_KEY` se conserva idéntico.

**Dependencia explícita:** el prerrequisito (Plan A verificado) está marcado como bloqueante al inicio y en la prueba crítica de Task 4 (que depende de los datos migrados).
