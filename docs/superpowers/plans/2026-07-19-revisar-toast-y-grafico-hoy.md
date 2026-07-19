# Toast de #revisar + gráfico diario hasta hoy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ocultar de verdad el toast de "Deshacer" de #revisar cuando está cerrado (hoy tapa la nav), y cortar la línea del gráfico diario en el día de hoy cuando la ventana es el mes en curso.

**Architecture:** Dos fixes independientes. (A) CSS-only en `views/revisar.html`. (B) `js/graficos-serie.js` (función pura, con test node existente → TDD) + su caller en `views/graficos.html`. Más un bump de `SHELL_VERSION` en `sw.js`.

**Tech Stack:** HTML/CSS/JS vanilla sin build. Tests con `node:test` en `test/*.test.mjs`. Service Worker con Workbox vendorizado.

**Spec:** `docs/superpowers/specs/2026-07-19-revisar-toast-y-grafico-hoy-design.md`

---

## Nota sobre verificación — leer antes de empezar

**Este repo SÍ tiene tests** (`test/*.test.mjs`, `node:test`), a diferencia de lo que digan notas viejas. Se corren **por archivo**:

```
node --test test/graficos-serie.test.mjs
```

La forma glob `node --test test/` **rompe** por el path del worktree con puntos iniciales (`..Nestra-v2`) — ver `CLAUDE.md`. No la uses; pasa el archivo explícito.

Para verificación en navegador: `preview_start` con `{ name: "nestra" }` (sirve `npx serve -l 5050 .`). **`#revisar` y `#graficos` exigen sesión** — redirigen a `#login` sin ella. NO ingreses credenciales tú mismo. Usa la cuenta de prueba throwaway del proyecto si hay credenciales documentadas y accesibles; si no, verifica lo que se pueda sin sesión (por ejemplo, midiendo el rect del toast con la regla CSS reproducida aislada, técnica descrita en el spec) y dilo explícitamente.

**El toast es UI pura, sin test unitario.** El gráfico SÍ tiene lógica pura testeable — ahí va TDD de verdad.

**Restricción dura (toast):** NO toques el `z-index: 110` ni la lógica de undo (`mostrarToastUndo`, `finalizarUndo`, `deshacer`, los timers). El z-index está puesto a propósito y documentado. El fix es solo del estado cerrado.

**Restricción dura (gráfico):** `agruparSerie` debe seguir **pura** (nada de `new Date()` dentro) y el parámetro `hoy` debe ser **opcional** — los tests existentes que no lo pasan tienen que seguir verdes.

---

## Task 1: El toast cerrado se oculta de verdad (CSS)

**Files:**
- Modify: `views/revisar.html` (reglas `.rev-undo-toast` y `.rev-undo-toast.is-open`, ~líneas 81-90)

- [ ] **Step 1: Ver el bug (si hay sesión) o medirlo aislado**

Con el server levantado y viewport móvil (`resize_window` preset `mobile`):
- Con sesión en `#revisar`: confirma que el botón "Deshacer" asoma sobre la nav inferior sin haber confirmado/descartado nada.
- Sin sesión: reproduce la regla aislada para medir. Pega en la consola del navegador (en cualquier página del server):

```js
(() => {
  document.getElementById('__probe_css')?.remove();
  document.getElementById('__probe_toast')?.remove();
  const css = document.createElement('style'); css.id='__probe_css';
  css.textContent = `#__probe_toast{position:fixed;left:50%;bottom:calc(60px + env(safe-area-inset-bottom,0) + 1rem);
    transform:translateX(-50%) translateY(200%);z-index:110;background:#101019;color:#fff;
    border:1px solid rgba(255,255,255,.08);padding:.5rem 1rem;border-radius:999px;display:flex;
    align-items:center;gap:1rem;}`;
  document.head.appendChild(css);
  const t=document.createElement('div'); t.id='__probe_toast';
  t.innerHTML='<span></span><button>Deshacer</button>'; document.body.appendChild(t);
  const r=t.getBoundingClientRect(), vh=window.innerHeight;
  const res={top:Math.round(r.top),bottom:Math.round(r.bottom),vh,solapaNav:r.top<vh};
  t.remove(); css.remove(); return JSON.stringify(res);
})()
```
Esperado (bug presente): `solapaNav: true`, con `top` dentro de los últimos 60px del viewport (ej. `top:778, vh:812`).

- [ ] **Step 2: Aplicar el fix**

En `views/revisar.html`, la regla base de `.rev-undo-toast` termina así (línea ~86):
```css
    display: flex; align-items: center; gap: var(--space-md); transition: transform .2s ease; box-shadow: var(--shadow-lg); }
```
Cámbiala a (añade `visibility: hidden;` y amplía la `transition`):
```css
    display: flex; align-items: center; gap: var(--space-md);
    visibility: hidden;
    transition: transform .2s ease, visibility 0s linear .2s; box-shadow: var(--shadow-lg); }
```

Y la regla `.rev-undo-toast.is-open` (línea ~90):
```css
  .rev-undo-toast.is-open { transform: translateX(-50%) translateY(0); }
```
Cámbiala a:
```css
  .rev-undo-toast.is-open { transform: translateX(-50%) translateY(0);
    visibility: visible; transition: transform .2s ease, visibility 0s; }
```

Por qué: `visibility: hidden` hace el toast invisible Y no interactivo sin depender de que el `translateY` lo saque del viewport (en móvil no lo saca — se queda 34px corto). El `visibility 0s linear .2s` retrasa el ocultado hasta que termina el deslizamiento de salida; al abrir, `visibility 0s` lo muestra de inmediato. El `translateY(200%)` se conserva para la animación.

- [ ] **Step 3: Verificar cerrado (aislado o con sesión)**

Repite la medición del Step 1 pero con la regla real. Con sesión: en `#revisar` sin confirmar nada, el toast NO debe solaparse con la nav — `document.getElementById('revUndoToast')` con `getComputedStyle(...).visibility === 'hidden'` y `elementFromPoint` en el centro de donde estaría el botón debe devolver un nav-link o la card, no `revUndoBtn`.

Sin sesión: añade `visibility:hidden` + la transition a la regla del probe del Step 1 y confirma que `getComputedStyle(probe).visibility === 'hidden'`.

- [ ] **Step 4: Verificar que sigue apareciendo al confirmar/descartar (requiere sesión)**

Si tienes sesión con pendientes (o el stub `window.getIngestPendientes` descrito en planes previos de #revisar): confirma o descarta una card. Esperado: el toast se desliza hacia arriba, se ve el mensaje "Confirmado"/"Descartado" y el botón "Deshacer", y "Deshacer" recibe el click de verdad:
```js
(() => { const b=document.getElementById('revUndoBtn'); const r=b.getBoundingClientRect();
  const el=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
  return el===b || b.contains(el); })()
```
Esperado: `true`. Tras 7s (o al pulsar Deshacer) el toast se oculta y vuelve a NO tapar la nav.

Si no puedes iniciar sesión, dilo explícitamente y deja este paso como verificado-por-lectura: el JS que añade/quita `.is-open` (`mostrarToastUndo`/`finalizarUndo`/`deshacer`) no cambió, así que el toast sigue abriéndose igual; lo único que cambió es que el estado cerrado ahora sí se oculta.

- [ ] **Step 5: Commit**

```bash
git add views/revisar.html
git commit -m "fix(revisar): el toast de Deshacer cerrado ya no tapa la nav

El JS solo abría el toast al confirmar/descartar, pero el estado cerrado
se ocultaba con translateY(200%): en móvil eso desplaza 84px (2x los 42px
de alto), y el bottom lo sube 76px, así que quedaba 34px corto y el botón
Deshacer asomaba sobre la nav (y con z-index 110 le robaba los clicks).

Se oculta con visibility:hidden en cerrado y visible en is-open, con la
transición de visibility retrasada hasta que termina el deslizamiento de
salida. Robusto ante cualquier altura/offset; no depende del translateY.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Tests del recorte diario (TDD, falla primero)

**Files:**
- Modify: `test/graficos-serie.test.mjs`

- [ ] **Step 1: Añadir los tests del recorte**

En `test/graficos-serie.test.mjs`, después del test `dias: respeta el largo del mes` (~línea 20), añade:

```js
test('dias: corta en hoy cuando la ventana es el mes en curso', () => {
  // Hoy = 19 jul 2026; julio tiene 31 días pero la serie debe llegar solo a 19.
  const hoy = { anio: 2026, mes: 7, dia: 19 };
  const r = agruparSerie([], 'dias', { mes: 7, anio: 2026 }, null, hoy);
  assert.strictEqual(r.length, 19, 'la serie del mes en curso termina hoy');
  assert.strictEqual(r[18].label, '19', 'el último punto es el día 19');
});

test('dias: un mes pasado se muestra completo aunque se pase hoy', () => {
  // Viendo junio (mes pasado) con hoy en julio: junio entero, 30 días.
  const hoy = { anio: 2026, mes: 7, dia: 19 };
  const r = agruparSerie([], 'dias', { mes: 6, anio: 2026 }, null, hoy);
  assert.strictEqual(r.length, 30, 'un mes pasado no se recorta');
});

test('dias: sin hoy, mes entero (regresión — no rompe a los callers viejos)', () => {
  const r = agruparSerie([], 'dias', { mes: 7, anio: 2026 });
  assert.strictEqual(r.length, 31, 'sin hoy sigue siendo el mes completo');
});

test('dias: una tx de fecha futura en el mes en curso queda fuera del recorte', () => {
  // Decisión deliberada (ver spec): la línea termina hoy; una fecha futura
  // pertenece a una proyección, no a la línea de hechos.
  const hoy = { anio: 2026, mes: 7, dia: 19 };
  const r = agruparSerie(
    [{ tipo: 'gasto', fecha: '2026-07-25', monto: 500 }], 'dias', { mes: 7, anio: 2026 }, null, hoy);
  assert.strictEqual(r.length, 19, 'no se extiende hasta el día 25');
  assert.strictEqual(r.reduce((a, x) => a + x.gasto, 0), 0, 'el gasto del día 25 no aparece');
});
```

- [ ] **Step 2: Correr los tests — deben FALLAR**

```
node --test test/graficos-serie.test.mjs
```
Esperado: los 4 tests nuevos FALLAN (la implementación aún ignora `hoy`, así que `dias: corta en hoy...` da length 31 en vez de 19, etc.). Los 10 tests viejos siguen PASANDO. Si algún test viejo falla, algo se rompió al editar — revísalo antes de seguir.

- [ ] **Step 3: Commit de los tests**

```bash
git add test/graficos-serie.test.mjs
git commit -m "test(graficos-serie): recorte del chart diario en el día de hoy

Tests que fijan: mes en curso cortado en hoy, mes pasado completo, hoy
omitido = mes entero (regresión), y una tx de fecha futura descartada del
recorte. Fallan a propósito hasta implementar el recorte en la Task 3.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Implementar el recorte en `agruparSerie`

**Files:**
- Modify: `js/graficos-serie.js` (firma y rama `'dias'` de `agruparSerie`, ~líneas 59-75)

- [ ] **Step 1: Añadir el parámetro `hoy` y el recorte**

En `js/graficos-serie.js`, la firma actual (línea ~59):
```js
function agruparSerie(transacciones, granularidad, hasta, n) {
  if (granularidad === 'dias') {
    var dias = new Date(Date.UTC(hasta.anio, hasta.mes, 0)).getUTCDate();
```
Cámbiala a:
```js
function agruparSerie(transacciones, granularidad, hasta, n, hoy) {
  if (granularidad === 'dias') {
    var dias = new Date(Date.UTC(hasta.anio, hasta.mes, 0)).getUTCDate();
    // Si la ventana es el mes en curso, corta en hoy: los días futuros no
    // tienen datos y trazaban una línea plana en 0 hacia adelante, sin
    // sentido. Un mes pasado no entra acá (hasta.mes != hoy.mes) → completo.
    // hoy es opcional: sin él, mes entero (compat con callers/tests viejos).
    if (hoy && hasta.anio === hoy.anio && hasta.mes === hoy.mes) {
      dias = Math.min(dias, hoy.dia);
    }
```
El resto de la rama `'dias'` (el `new Array(dias)`, el forEach con `if (d < 0 || d >= dias) return;`, el `g.map`) no cambia: al reducir `dias`, tanto la longitud de la serie como el descarte de días fuera de rango (incluidas las tx de fecha futura, cuyo `d >= dias`) se ajustan solos.

Comprueba que la función se mantiene pura: NO añadas `new Date()` para derivar `hoy` — `hoy` llega como argumento.

- [ ] **Step 2: Correr los tests — deben PASAR todos**

```
node --test test/graficos-serie.test.mjs
```
Esperado: los 14 tests PASAN (10 viejos + 4 nuevos). Si alguno falla, lee el mensaje y corrige.

- [ ] **Step 3: Commit**

```bash
git add js/graficos-serie.js
git commit -m "feat(graficos-serie): el chart diario corta en el día de hoy

agruparSerie gana un parámetro opcional hoy (con día). Cuando la ventana
es el mes en curso, la serie diaria se recorta al día de hoy en vez de
emitir un punto por cada día del mes — los días futuros salían en 0 y
dibujaban una línea plana hacia adelante.

Opcional y sin new Date() interno: la función sigue pura (el reloj vive en
el caller), y omitir hoy mantiene el mes entero para no romper nada.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Pasar `hoy` desde el caller del gráfico

**Files:**
- Modify: `views/graficos.html` (función `render1`, la llamada a `agruparSerie` con `'dias'`, ~línea 378)

- [ ] **Step 1: Construir `hoy` con día y pasarlo**

En `views/graficos.html`, dentro de `render1`, la rama de `'dias'` (~líneas 376-378):
```js
      if (gran === 'dias') {
        if (!datos.txMes.length) { setEstado(1, 'vacio'); return; }
        serie = agruparSerie(datos.txMes, 'dias', { mes: estado.mes, anio: estado.anio });
      } else {
```
Cámbiala a:
```js
      if (gran === 'dias') {
        if (!datos.txMes.length) { setEstado(1, 'vacio'); return; }
        var _d = new Date();
        var hoyDia = { anio: _d.getFullYear(), mes: _d.getMonth() + 1, dia: _d.getDate() };
        serie = agruparSerie(datos.txMes, 'dias', { mes: estado.mes, anio: estado.anio }, null, hoyDia);
      } else {
```
El `null` es el parámetro `n` (que `'dias'` ignora); `hoyDia` es el 5º argumento.

- [ ] **Step 2: Verificar en navegador (requiere sesión)**

Con el server, en `#graficos` con granularidad "día" (chip por defecto) y el mes en curso:
- Esperado: la línea de gasto/ingreso termina en el día de hoy; el eje X no llega hasta el día 31 si hoy es antes de fin de mes. Cuenta las etiquetas del eje o inspecciona `charts.chart1.data.labels.length` en consola — debe ser el día de hoy (ej. 19), no los días del mes (31).
- Retrocede un mes (botón `grafMesPrev`): el mes pasado debe mostrarse **completo** (30/31 etiquetas).

Si no puedes iniciar sesión, dilo, y apóyate en que la Task 3 ya cubre la lógica con tests; este paso solo confirma el cableado del caller. Puedes además verificar por lectura que `hoyDia` se construye y pasa correctamente.

- [ ] **Step 3: Commit**

```bash
git add views/graficos.html
git commit -m "fix(graficos): el chart diario del mes en curso termina en hoy

render1 construye hoy (con día) desde el reloj local y lo pasa a
agruparSerie. Antes la línea diaria del mes en curso se dibujaba hasta el
último día del mes, con una tira plana en 0 desde hoy hasta fin de mes.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Bump de SHELL_VERSION y verificación integral

**Files:**
- Modify: `sw.js:15`

- [ ] **Step 1: Bump**

En `sw.js` línea 15, `const SHELL_VERSION = 'v35';` → `'v36'`. Verifica antes que siga en `v35`; si otro trabajo ya lo subió, usa el siguiente número respecto al valor real.

- [ ] **Step 2: Correr toda la suite tocada**

```
node --test test/graficos-serie.test.mjs
```
Esperado: 14/14 PASS.

- [ ] **Step 3: Repaso funcional (si hay sesión)**

- `#revisar`: el toast no tapa la nav cuando está cerrado; sigue apareciendo al confirmar/descartar y "Deshacer" funciona. Móvil y desktop, tema claro y oscuro.
- `#graficos` chart 1, granularidad "día": mes en curso termina hoy; mes pasado completo. Cambiar a "mes"/"trimestre" sigue igual que antes (no se tocó esa rama).

- [ ] **Step 4: Confirmar que no se coló código de prueba**

```bash
git diff origin/main -- views/revisar.html views/graficos.html | grep -n "__probe\|getIngestPendientes = \|console.log" || echo "limpio"
```
Esperado: `limpio`.

- [ ] **Step 5: Commit**

```bash
git add sw.js
git commit -m "chore(sw): SHELL_VERSION v36 por el fix del toast y el chart diario

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Cierre

`main` está protegida (push directo rechazado). Abrir PR y mergear:

```bash
git push -u origin fix/revisar-toast-y-grafico-hoy
gh pr create --title "Fix: toast de #revisar que tapa la nav + chart diario hasta hoy" --body "..."
gh pr merge <N> --merge
```

(El usuario autorizó mergear PRs de mejora directo — ver memoria `nestra-migracion-v1-a-v2`.)

Tras el merge, verificar el deploy con cache-buster:
```bash
curl -sL "https://nestra-8rl.pages.dev/sw.js?cb=$RANDOM" | grep SHELL_VERSION
```
Esperado: `v36`.

## Self-review (cobertura del spec)

- Bug 1 (toast) → Task 1. ✔
- Bug 2 (gráfico diario) → Tasks 2 (test), 3 (lógica), 4 (caller). ✔
- `hoy` opcional / función pura → Task 3, verificado por el test de regresión de la Task 2. ✔
- Mes pasado completo → test en Task 2, caller en Task 4. ✔
- Fecha futura descartada → test en Task 2. ✔
- No-objetivos (z-index, undo, granularidad mes/trim, guard de mes futuro, schema) → ninguna task los toca. ✔
- Bump de shell → Task 5. ✔
