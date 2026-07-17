# Tanda 1 — Bugs y quick wins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arreglar 6 bugs/quick wins reportados por el usuario (#3a, #3b, #4, #5, #7, #8) sin tocar el modelo de aportes del hogar.

**Architecture:** Tres frentes independientes. (1) `window.hogarState` nunca se prima al iniciar sesión → se agrega `primeHogarState()` idempotente en `js/db.js`, llamado desde el router; los tres consumidores ya escuchan `hogar:changed` y no se tocan. (2) Contraste: cuatro tokens CSS nuevos de gradiente fijo + una regla `color: inherit`, con un test de contraste WCAG que corre en CI. (3) Regla "hogar no tiene ingresos" en tres capas (form, historial, CHECK en DB) y orden de presupuestos en una función pura con tests.

**Tech Stack:** JS vanilla sin build, CSS custom properties, tests con `node --test test/*.test.mjs`, migración vía MCP `apply_migration`, deploy por push a `v2` (Cloudflare Pages).

**Spec:** `docs/superpowers/specs/2026-07-16-tanda1-bugs-quickwins-design.md`

---

## File Structure

| Archivo | Responsabilidad | Tareas |
|---------|-----------------|--------|
| `views/configuracion.html` | Borrar la fila de moneda hardcodeada | 1 |
| `css/base.css` | Tokens `--s2s-*` (gradiente hero, fijos en ambos temas) | 2 |
| `views/dashboard.html` | Consumir tokens, `color: inherit`, wiring del orden | 2, 8 |
| `test/contraste-s2s.test.mjs` | **Crear.** Regresión WCAG de los tokens del hero | 2 |
| `js/db.js` | `primeHogarState()` / `resetHogarPrime()` idempotentes | 3 |
| `js/router.js` | Llamar al priming en rutas protegidas | 3 |
| `js/auth.js` | Resetear el priming al cerrar sesión | 3 |
| `views/hogar.html` o `js/db.js` | Fix de #4 — **el archivo depende del repro** | 4 |
| `views/transaccion.html` | Ámbito hogar oculta el tipo Ingreso | 5 |
| `views/historial.html` | Chip Hogar deshabilita el chip Ingresos | 6 |
| `supabase/migrations/` | **Crear.** CHECK `not (ambito='hogar' and tipo='ingreso')` | 7 |
| `js/presupuestos-orden.js` | **Crear.** `ordenarPresupuestos()` pura, dual-export | 8 |
| `test/presupuestos-orden.test.mjs` | **Crear.** Tests de la función pura | 8 |
| `index.html`, `sw.js` | Cargar y precachear el módulo nuevo; bump `SHELL_VERSION` | 8, 10 |

**Estado actual verificado:** `SHELL_VERSION = 'v26'` (`sw.js:15`). Los módulos puros se cargan como `<script type="module">` en `index.html` (~línea 223) y se precachean en `sw.js` (~líneas 35-37).

---

### Task 1: Borrar la fila de moneda duplicada (#8)

**Files:**
- Modify: `views/configuracion.html:166-169`

Contexto: hay dos filas de moneda. La de `:149` ("Moneda principal") lee el valor real vía
`initMoneda()` → `getMonedaActiva()`. La de `:166` ("Moneda") tiene `Soles (S/)` hardcodeado,
o sea que **muestra un dato falso** para cualquier usuario que no use soles. Se borra esa.

- [ ] **Step 1: Borrar el bloque**

En `views/configuracion.html`, borrar exactamente estas 4 líneas (166-169):

```html
        <div class="cfg-pref-row cfg-pref-row--readonly">
          <span class="cfg-pref-nombre">Moneda</span>
          <span class="cfg-pref-valor">Soles (S/)</span>
        </div>
```

NO tocar la fila de `:149` (`Moneda principal` / `id="cfgMonedaValor"`) ni la de Idioma que
viene justo después.

- [ ] **Step 2: Verificar que no quedó nada huérfano**

Run: `grep -n "Soles (S/)" views/configuracion.html`
Expected: sin resultados (exit 1).

Run: `grep -c "cfg-pref-nombre\">Moneda" views/configuracion.html`
Expected: `1` (solo queda "Moneda principal").

- [ ] **Step 3: Commit**

```bash
git add views/configuracion.html
git commit -m "fix(config): quita la fila de moneda duplicada y hardcodeada

La fila mostraba 'Soles (S/)' fijo, mintiendo para cualquier usuario con
otra moneda. La fila 'Moneda principal' que queda lee el valor real del
perfil vía getMonedaActiva()."
```

---

### Task 2: Contraste del hero safe-to-spend (#3a)

**Files:**
- Create: `test/contraste-s2s.test.mjs`
- Modify: `css/base.css` (bloques `:root` y `html.light`)
- Modify: `views/dashboard.html:130-139`

Contexto: dos bugs superpuestos. (A) `base.css:119` define `p { color: var(--text-secondary) }`,
que le gana por especificidad al `color:#fff` heredado de `.dash-s2s-card` → los tres `<p>`
salen plomo (1.11:1). (B) El gradiente usa `--color-primary`/`--color-success`/`--color-danger`,
que en tema oscuro son claros (`#c9a84c`, `#5ec98a`, `#f08a8a`) → ni el blanco alcanza.
En tema claro ya pasa. La card `--excedido` tiene el mismo bug B.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/contraste-s2s.test.mjs`:

```javascript
import assert from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Contraste WCAG 2.x del hero "Puedes gastar hoy". Los tokens --s2s-* son
// fijos (mismos valores en ambos temas) a propósito: la paleta de Nestra se
// invierte entre temas y el hero no puede depender de eso. Este test lee el
// CSS real, no una copia, para que cambiar el token rompa el test.

const css = readFileSync(new URL('../css/base.css', import.meta.url), 'utf8');

function token(nombre) {
  const m = css.match(new RegExp('--' + nombre + ':\\s*(#[0-9a-fA-F]{6})'));
  assert.ok(m, 'token --' + nombre + ' no encontrado en css/base.css');
  return m[1];
}

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
function luminancia(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contraste(a, b) {
  const l1 = Math.max(luminancia(a), luminancia(b)), l2 = Math.min(luminancia(a), luminancia(b));
  return (l1 + 0.05) / (l2 + 0.05);
}

const BLANCO = '#ffffff';
const AA_NORMAL = 4.5; // WCAG AA texto normal

test('contraste: sanity del calculador (negro sobre blanco = 21:1)', () => {
  assert.ok(Math.abs(contraste('#000000', '#ffffff') - 21) < 0.01);
});

test('card normal: blanco sobre ambos extremos del gradiente cumple AA', () => {
  for (const t of ['s2s-from', 's2s-to']) {
    const bg = token(t);
    const r = contraste(BLANCO, bg);
    assert.ok(r >= AA_NORMAL, `--${t} (${bg}) da ${r.toFixed(2)}:1, se necesita >= ${AA_NORMAL}:1`);
  }
});

test('card excedido: blanco sobre ambos extremos del gradiente cumple AA', () => {
  for (const t of ['s2s-exc-from', 's2s-exc-to']) {
    const bg = token(t);
    const r = contraste(BLANCO, bg);
    assert.ok(r >= AA_NORMAL, `--${t} (${bg}) da ${r.toFixed(2)}:1, se necesita >= ${AA_NORMAL}:1`);
  }
});

test('los tokens del hero NO se redefinen en el tema claro (deben ser fijos)', () => {
  // Si alguien los mete en html.light, el hero vuelve a depender del tema y
  // este test lo caza. Buscamos el bloque html.light y verificamos que no
  // contenga ningún --s2s-.
  const m = css.match(/html\.light\s*\{([\s\S]*?)\}/);
  assert.ok(m, 'bloque html.light no encontrado');
  assert.ok(!/--s2s-/.test(m[1]), 'los tokens --s2s-* no deben redefinirse en html.light');
});
```

- [ ] **Step 2: Verificar que falla**

Run: `node --test test/contraste-s2s.test.mjs`
Expected: FAIL — `token --s2s-from no encontrado en css/base.css` (los tokens aún no existen).

- [ ] **Step 3: Agregar los tokens**

En `css/base.css`, dentro del bloque `:root` (después de la línea `--color-info:    #6ea8e8;`,
antes de la línea en blanco que precede a `--font-family`), agregar:

```css

  /* ── Hero safe-to-spend ──────────────────────────────────────
     Fijos en AMBOS temas a propósito. La paleta se invierte entre temas
     (en oscuro --color-primary es #c9a84c, un oro claro), así que un hero
     que consuma los tokens de marca queda ilegible en oscuro: blanco sobre
     #c9a84c da 2.29:1 y AA pide 4.5:1. Estos valores dan 4.89:1 y 6.51:1.
     Verificado por test/contraste-s2s.test.mjs — no cambiar sin correrlo. */
  --s2s-from: #8a6d22;
  --s2s-to: #1a6b43;
  --s2s-exc-from: #b3261e;
  --s2s-exc-to: #8a1c1c;
```

NO agregarlos al bloque `html.light` ni al `@media (prefers-color-scheme: light)`. El cuarto
test falla si alguien lo hace.

- [ ] **Step 4: Verificar que el test pasa**

Run: `node --test test/contraste-s2s.test.mjs`
Expected: PASS — 4/4 tests.

- [ ] **Step 5: Consumir los tokens y arreglar la herencia**

En `views/dashboard.html`, reemplazar el bloque de las líneas 130-139:

```css
  .dash-s2s-card {
    padding: var(--space-lg);
    border-radius: var(--radius-md);
    background: linear-gradient(135deg, var(--color-primary), var(--color-success));
    color: #fff;
    box-shadow: var(--shadow-md);
  }
  .dash-s2s-card--excedido {
    background: linear-gradient(135deg, var(--color-danger), #8a1c1c);
  }
```

por:

```css
  .dash-s2s-card {
    padding: var(--space-lg);
    border-radius: var(--radius-md);
    background: linear-gradient(135deg, var(--s2s-from), var(--s2s-to));
    color: #fff;
    box-shadow: var(--shadow-md);
  }
  /* base.css define `p { color: var(--text-secondary) }`, y esa regla le gana
     por especificidad al color heredado de la card: sin esto los tres <p> del
     hero salen plomo sobre el gradiente (1.11:1, ilegible). */
  .dash-s2s-card p { color: inherit; }
  .dash-s2s-card--excedido {
    background: linear-gradient(135deg, var(--s2s-exc-from), var(--s2s-exc-to));
  }
```

- [ ] **Step 6: Verificar que no quedan referencias viejas**

Run: `grep -n "var(--color-primary), var(--color-success)\|var(--color-danger), #8a1c1c" views/dashboard.html`
Expected: sin resultados (exit 1).

- [ ] **Step 7: Commit**

```bash
git add css/base.css views/dashboard.html test/contraste-s2s.test.mjs
git commit -m "fix(dashboard): hero safe-to-spend legible en ambos temas

Dos bugs superpuestos:

- base.css define `p { color: var(--text-secondary) }`, que le gana por
  especificidad al color:#fff heredado de la card. Los tres <p> del hero
  salían plomo sobre el gradiente: 1.11:1, muy por debajo del 4.5:1 de AA.
- El gradiente consumía --color-primary/--color-success/--color-danger, y
  la paleta se invierte entre temas: en oscuro esos tokens son claros, así
  que ni el blanco alcanzaba (2.29:1). En claro ya pasaba.

Se agregan tokens --s2s-* fijos en ambos temas (4.89:1 a 9.28:1) y una
regla color:inherit. Incluye la card --excedido, que tenía el mismo bug
del gradiente sin haber sido reportada (2.41:1).

test/contraste-s2s.test.mjs lee los tokens del CSS real y falla si alguien
los baja de AA o los redefine por tema."
```

---

### Task 3: Primar el estado del hogar al iniciar sesión (#3b)

**Files:**
- Modify: `js/db.js` (después de `_refrescarHogarState`, ~línea 1487)
- Modify: `js/router.js:212` (dentro de `handleRouteChange`)
- Modify: `js/auth.js` (en `handleSessionExpired` y `logout`)

Contexto: `tieneHogar()` lee el cache síncrono `window.hogarState`, que solo puebla
`getEstadoHogar()`. En el arranque nadie lo llama, así que el primer render ve `undefined`
y apaga tres cosas: la card de balance (`dashboard.html:930`), la de desequilibrio
(`dashboard.html:943`) y el toggle de ámbito del form (`transaccion.html:846`).

Hay **tres** caminos hacia una sesión activa: reload con sesión guardada, login por
formulario (`auth.js:51`), y retorno de OAuth (`auth.js:228`). Por eso el priming va en
`handleRouteChange` (por donde pasan los tres) con guarda de idempotencia, no en un handler
de auth puntual.

- [ ] **Step 1: Agregar el priming a `js/db.js`**

Justo después de la función `_refrescarHogarState` (termina en la línea ~1487, antes del
comentario `// crearHogar(nombre)`), agregar:

```javascript
// _hogarPrimed — guarda de idempotencia del priming inicial. window.hogarState
// solo lo puebla getEstadoHogar(), y hasta Fase 7 nadie lo llamaba al iniciar
// sesión: el primer render veía hogarState undefined, tieneHogar() daba false y
// el UI del hogar se apagaba solo hasta que visitaras #hogar.
let _hogarPrimed = false;

// primeHogarState() — puebla window.hogarState una vez por sesión.
// NO bloquea: se dispara sin await y los consumidores se corrigen solos al
// recibir 'hogar:changed'. Si la red falla, _refrescarHogarState deja
// hogarState en null y el gating cae a "sin hogar", que es el estado seguro.
function primeHogarState() {
  if (_hogarPrimed) return;
  _hogarPrimed = true;
  _refrescarHogarState();
}

// resetHogarPrime() — al cerrar sesión. Sin esto, el siguiente usuario que
// entre en la misma pestaña hereda el hogarState del anterior.
function resetHogarPrime() {
  _hogarPrimed = false;
  if (typeof window !== 'undefined') window.hogarState = null;
}

if (typeof window !== 'undefined') {
  window.primeHogarState = primeHogarState;
  window.resetHogarPrime = resetHogarPrime;
}
```

Nota: `js/db.js` se carga como script clásico (`<script src="js/db.js">`, sin `type="module"`),
así que no lleva `export`. Se expone por `window`, igual que el resto del archivo.

- [ ] **Step 2: Llamarlo desde el router**

En `js/router.js`, dentro de `handleRouteChange`, justo ANTES del bloque de onboarding
(la línea `if (!isPublic) {` que precede a `const ob = await mostrarOnboardingSiHaceFalta();`,
~línea 212), insertar:

```javascript
    // Primar el estado del hogar una vez por sesión. Va acá y no en un handler
    // de auth porque hay tres caminos a una sesión activa (reload, login por
    // form, retorno de OAuth) y los tres pasan por este punto. Sin await: el
    // UI se corrige solo con el evento 'hogar:changed'.
    if (!isPublic && typeof primeHogarState === 'function') primeHogarState();

```

- [ ] **Step 3: Resetear al cerrar sesión**

En `js/auth.js`, en la función `handleSessionExpired()` y en `logout()`, agregar esta línea
junto a donde ya hacen `window.currentUser = null;` (líneas ~99 y ~198):

```javascript
  if (typeof resetHogarPrime === 'function') resetHogarPrime();
```

- [ ] **Step 4: Verificar en el navegador contra la base real**

Levantar el preview (config `nestra` de `.claude/launch.json`, `npx serve -l 5050 .`) y:

1. Cerrar sesión si hay una activa.
2. Entrar con la cuenta de test (ver memoria `nestra-v2-test-account`). Esa cuenta debe
   pertenecer a un hogar; si no, el test no prueba nada — usar una que sí.
3. Caer en `#dashboard` **sin pasar por `#hogar`**.

Expected: la card "Balance del hogar" y la de desequilibrio se ven **en el primer render**,
sin navegar a otra sección y volver. Ir a `#transaccion`: el toggle Hogar/Personal también
debe verse.

Expected en consola: sin errores.

- [ ] **Step 5: Verificar el reseteo entre usuarios**

Cerrar sesión desde la app. Confirmar en la consola del navegador:

Run (en la consola del navegador): `window.hogarState`
Expected: `null`.

- [ ] **Step 6: Commit**

```bash
git add js/db.js js/router.js js/auth.js
git commit -m "fix(hogar): prima window.hogarState al iniciar sesión

tieneHogar() lee un cache síncrono que solo poblaba getEstadoHogar(), y
nadie lo llamaba al arrancar. El primer render veía hogarState undefined
y apagaba tres consumidores: la card de balance del hogar, la de
desequilibrio y el toggle de ámbito del form de transacción. Visitar
#hogar poblaba el cache, y por eso 'vuelvo al dashboard y ya aparece'.

primeHogarState() es idempotente y no bloquea el render: los tres
consumidores ya escuchaban 'hogar:changed' y no se tocan. Va en el router
porque hay tres caminos a una sesión activa (reload, login por form,
retorno de OAuth) y los tres pasan por handleRouteChange.

resetHogarPrime() al cerrar sesión evita que el siguiente usuario de la
misma pestaña herede el hogar del anterior."
```

---

### Task 4: Reproducir y arreglar la sección Hogar en la segunda visita (#4)

**Files:**
- Modify: `views/hogar.html` o `js/db.js` — **depende del repro. No escribir código antes del Step 2.**

Contexto: al volver a `#hogar` por segunda vez sale "No se pudo cargar el hogar. Revisa tu
conexión e inténtalo de nuevo" (`hogar.html:615`). No es la red. Ese mensaje sale de un
`catch` que envuelve **todo** `render()`, así que cualquier throw dentro de `getEstadoHogar()`
o `renderConHogar()` lo produce.

**Hipótesis principal (sin confirmar):** el canal realtime se fuga. `channel` es una variable
del closure del IIFE (`hogar.html:569`). El router re-inyecta el HTML y re-ejecuta el script
en cada visita (`executeScripts`), así que el IIFE nuevo arranca con `channel = null` y la
limpieza `supabase.removeChannel(channel)` no encuentra nada. El canal de la visita anterior
sigue suscrito. `subscribeHogar()` (`db.js:1594`) hace `supabase.channel('hogar-' + hogarId)
.subscribe()` → segundo join al mismo topic.

**Hipótesis alternativas a descartar:** colisión de IDs del DOM entre la vista vieja y la
nueva; el modal `hogarDisolverModal` montado fuera del contenedor de la vista.

- [ ] **Step 1: Reproducir**

Levantar el preview, entrar con una cuenta **que pertenezca a un hogar**, y:

1. Ir a `#hogar`. Confirmar que carga bien.
2. Ir a `#dashboard`.
3. Volver a `#hogar`.

Expected: aparece el mensaje de error. Si NO aparece, **parar** y reportar al usuario: el
bug puede depender de un estado que no se está reproduciendo (p. ej. solo con 2 miembros,
o solo tras cierta acción). No seguir a ciegas.

- [ ] **Step 2: Leer el error real**

`views/hogar.html:614` ya hace `console.error('hogar render:', e && e.message)`. Abrir la
consola del navegador y leer el mensaje y el stack completos.

**Anotar aquí el error exacto antes de seguir.** El arreglo depende de qué diga.

- [ ] **Step 3: Escribir el arreglo según el error**

Si el error confirma la fuga del canal (mensajes tipo `tried to subscribe multiple times`,
`already joined topic`, o un error de realtime), el arreglo va en `js/db.js:1594`: hacer
`subscribeHogar` idempotente por topic, quitando cualquier canal previo del mismo topic
antes de crear uno nuevo. Así deja de importar cuántas veces se re-monte la vista:

```javascript
function subscribeHogar(hogarId, onChange) {
  if (!hogarId) return null;
  const topic = 'hogar-' + hogarId;
  // La vista se re-monta en cada visita (el router re-ejecuta su script), y su
  // variable `channel` vive en el closure del IIFE: la limpieza de la visita
  // anterior nunca corre. Sin esto, cada visita deja un canal suscrito de más
  // sobre el mismo topic.
  //
  // API verificada contra supabase-js 2.108.0 (la que carga index.html:189):
  // client.getChannels() → realtime.getChannels() → this.channels, y
  // client.channel(x) guarda this.topic = `realtime:${x}`. El segundo término
  // del filtro es defensa por si ese prefijo cambia entre versiones.
  supabase.getChannels()
    .filter((c) => c.topic === 'realtime:' + topic || c.topic === topic)
    .forEach((c) => supabase.removeChannel(c));
  const ch = supabase.channel(topic)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'transacciones', filter: 'hogar_id=eq.' + hogarId },
        onChange)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'metas', filter: 'hogar_id=eq.' + hogarId },
        onChange)
    .subscribe();
  return ch;
}
```

Si el error apunta a otra causa (p. ej. un `$()` que devuelve null por IDs duplicados), el
arreglo es otro. **Escribirlo según el error real, no forzar esta hipótesis.**

- [ ] **Step 4: Verificar en verde**

Repetir el repro del Step 1 exactamente: `#hogar` → `#dashboard` → `#hogar` → `#dashboard`
→ `#hogar` (tres visitas, para descartar que solo arregle la segunda).

Expected: el hogar carga bien las tres veces. Consola sin errores.

- [ ] **Step 5: Verificar que el realtime sigue vivo**

El arreglo no debe romper la función del canal. Con `#hogar` abierto, insertar una
transacción de hogar desde otra pestaña (o desde el SQL Editor) y confirmar que la vista se
refresca sola.

Expected: la vista se actualiza sin recargar.

- [ ] **Step 6: Commit**

```bash
git add views/hogar.html js/db.js
git commit -m "fix(hogar): la sección carga en cada visita, no solo la primera

<<Reemplazar por la causa real encontrada en el Step 2.>>"
```

---

### Task 5: El ámbito hogar no ofrece Ingreso en el form (#5, capa 1)

**Files:**
- Modify: `views/transaccion.html:818-838` (`_setTipo` / `_setAmbito`)

Contexto: tipo y ámbito son controles independientes, así que se puede llegar a
`ingreso`+`hogar`. Regla acordada: **el ámbito gana**. Al tocar "Hogar" con tipo Ingreso,
el tipo salta a Gasto y el botón Ingreso se oculta. Al volver a Personal, Ingreso reaparece
y el tipo NO se revierte (revertir sería sorpresivo; `gasto` es un default sano). Sin toast.

- [ ] **Step 1: Agregar el gate de tipo por ámbito**

En `views/transaccion.html`, reemplazar la función `_setAmbito` (líneas 831-838):

```javascript
    function _setAmbito(val) {
      ambitoEl.value = val;
      btnAmbitoPersonal.classList.toggle('tx-active', val === 'personal');
      btnAmbitoPersonal.setAttribute('aria-pressed', String(val === 'personal'));
      btnAmbitoHogar.classList.toggle('tx-active', val === 'hogar');
      btnAmbitoHogar.setAttribute('aria-pressed', String(val === 'hogar'));
      _mostrarPartes();
    }
```

por:

```javascript
    // El hogar solo registra gasto y ahorro: un ingreso es siempre personal
    // (entra a tu bolsillo, no al hogar). La regla se aplica también en
    // historial y con un CHECK en la base.
    function _gateTipoPorAmbito(ambito) {
      var esHogar = (ambito === 'hogar');
      btnTipoIngreso.hidden = esHogar;
      // El ámbito gana: el usuario acaba de decir "esto es del hogar", así que
      // se respeta y se corrige el tipo. Al volver a personal NO se revierte.
      if (esHogar && tipoEl.value === 'ingreso') _setTipo('gasto');
    }

    function _setAmbito(val) {
      ambitoEl.value = val;
      btnAmbitoPersonal.classList.toggle('tx-active', val === 'personal');
      btnAmbitoPersonal.setAttribute('aria-pressed', String(val === 'personal'));
      btnAmbitoHogar.classList.toggle('tx-active', val === 'hogar');
      btnAmbitoHogar.setAttribute('aria-pressed', String(val === 'hogar'));
      _gateTipoPorAmbito(val);
      _mostrarPartes();
    }
```

Nota: `_setTipo` ya llama `_mostrarPartes()`, así que el orden (`_gateTipoPorAmbito` antes de
`_mostrarPartes`) es correcto y no duplica trabajo relevante.

- [ ] **Step 2: Verificar que el estado inicial es coherente**

`_setAmbito` se llama en el arranque desde `gateAmbito()` (línea ~853) y al editar
(`editTx.ambito`, línea ~1295). Confirmar que la edición de una transacción de hogar existente
pasa por `_setAmbito` y no solo asigna `ambitoEl.value` directo.

Run: `grep -n "ambitoEl.value = " views/transaccion.html`
Expected: las asignaciones directas están dentro de `_setAmbito` o son de lectura. Si hay una
asignación directa que se salta `_setAmbito` (p. ej. en la rama de edición ~1295), cambiarla
por `_setAmbito(editTx.ambito)` para que el gate se aplique.

- [ ] **Step 3: Verificar en el navegador**

En el preview, con una cuenta que tenga hogar, ir a `#transaccion` y probar los dos sentidos:

1. Tipo = Ingreso → tocar Hogar. Expected: el tipo salta a Gasto y el botón Ingreso
   desaparece.
2. Estando en Hogar → tocar Personal. Expected: Ingreso reaparece; el tipo sigue en Gasto.
3. Tipo = Ahorro → tocar Hogar. Expected: el tipo se queda en Ahorro (es válido en hogar) y
   solo desaparece Ingreso.

- [ ] **Step 4: Commit**

```bash
git add views/transaccion.html
git commit -m "fix(transaccion): el ámbito hogar no ofrece el tipo Ingreso

El hogar solo registra gasto y ahorro. Tipo y ámbito eran controles
independientes, así que se podía guardar ingreso+hogar. Al tocar Hogar el
botón Ingreso se oculta y, si estaba activo, el tipo salta a Gasto: el
usuario acaba de expresar que es del hogar, así que gana el ámbito."
```

---

### Task 6: El chip Hogar deshabilita el chip Ingresos en historial (#5, capa 2)

**Files:**
- Modify: `views/historial.html:17-24` (chips) y su handler

Contexto: los chips son dos grupos independientes (`data-grupo="tipo"` con Gastos/Ingresos y
`data-grupo="ambito"` con Hogar/Personal). Filtrar por Hogar + Ingresos siempre da vacío.

- [ ] **Step 1: Localizar el handler de chips**

Run: `grep -n "hist-chip" views/historial.html`

Anotar la línea del listener que maneja los clicks de `.hist-chip` y cómo guarda el estado
del filtro (probablemente un objeto tipo `{ tipo, ambito }`).

- [ ] **Step 2: Agregar la sincronización**

Agregar esta función junto al handler de chips y llamarla al final de cada click de chip
(después de que el estado del filtro ya se actualizó y antes de re-renderizar la lista):

```javascript
  // El hogar solo registra gasto y ahorro: filtrar Hogar+Ingresos siempre da
  // vacío. Al activar Hogar se apaga y deshabilita Ingresos; al soltarlo se
  // re-habilita, pero NO se re-activa solo.
  function _sincronizarChipsHogarIngreso() {
    var chipHogar = document.querySelector('.hist-chip[data-grupo="ambito"][data-valor="hogar"]');
    var chipIngreso = document.querySelector('.hist-chip[data-grupo="tipo"][data-valor="ingreso"]');
    if (!chipHogar || !chipIngreso) return;
    var hogarActivo = chipHogar.getAttribute('aria-pressed') === 'true';
    chipIngreso.disabled = hogarActivo;
    chipIngreso.setAttribute('aria-disabled', String(hogarActivo));
    if (hogarActivo && chipIngreso.getAttribute('aria-pressed') === 'true') {
      chipIngreso.click(); // apaga el filtro de ingresos por la vía normal
    }
  }
```

**Cuidado:** si el handler de chips no es idempotente, `chipIngreso.click()` puede recursar.
Si al probar se cuelga, reemplazar esa línea por la desactivación directa que use el mismo
código que el handler (apagar `aria-pressed`, quitar `hist-chip--active` y limpiar el valor
del filtro en el objeto de estado), sin disparar un click sintético.

- [ ] **Step 3: Agregar el estilo de deshabilitado**

En el bloque `<style>` de `views/historial.html`, junto a las reglas de `.hist-chip`:

```css
  .hist-chip:disabled { opacity: 0.4; cursor: not-allowed; }
```

- [ ] **Step 4: Verificar en el navegador**

En `#historial`:

1. Activar Ingresos, luego activar Hogar. Expected: Ingresos se apaga y queda atenuado y
   no clickeable; la lista muestra los movimientos de hogar.
2. Soltar Hogar. Expected: Ingresos vuelve a ser clickeable, pero sigue apagado.
3. Confirmar que no hay bucle infinito en consola.

- [ ] **Step 5: Commit**

```bash
git add views/historial.html
git commit -m "fix(historial): el filtro Hogar deshabilita el filtro Ingresos

El hogar solo registra gasto y ahorro, así que Hogar+Ingresos siempre daba
una lista vacía sin explicar por qué. Al activar Hogar, Ingresos se apaga y
queda deshabilitado; al soltarlo se re-habilita sin re-activarse."
```

---

### Task 7: CHECK en la base — hogar sin ingresos (#5, capa 3)

**Files:**
- Create: `supabase/migrations/20260716_transacciones_hogar_sin_ingreso.sql`

Contexto: sin esto la regla vive solo en el cliente y cualquier `insert` por API — incluido
el Worker de ingesta de correos — la puede violar en silencio. Verificado por introspección:
**0 filas** con `ambito='hogar'` y `tipo='ingreso'`, así que la constraint entra limpia.

- [ ] **Step 1: Re-verificar que sigue habiendo 0 filas**

El conteo se hizo durante el diseño; entre medio pudo entrar una fila (el Worker de correos
está vivo). Correr vía MCP `execute_sql`:

```sql
select count(*) as violaciones
from public.transacciones
where ambito = 'hogar' and tipo = 'ingreso';
```

Expected: `violaciones = 0`. **Si es > 0, parar** y consultar al usuario qué hacer con esas
filas: la migración va a fallar y hay que decidir si se corrigen a mano o se cambia el diseño.

- [ ] **Step 2: Escribir la migración**

Crear `supabase/migrations/20260716_transacciones_hogar_sin_ingreso.sql`:

```sql
-- Tanda 1 (#5): el ámbito hogar solo registra gasto y ahorro.
-- Un ingreso es siempre personal: entra al bolsillo de una persona, no al
-- hogar. El cliente ya lo impide en el form y en los filtros de historial,
-- pero sin esta constraint cualquier insert por API puede violarlo — incluido
-- el Worker de ingesta de correos bancarios, que escribe con service-role.
--
-- Verificado antes de aplicar: 0 filas en ese estado, no hay nada que migrar.
alter table public.transacciones
  add constraint transacciones_hogar_sin_ingreso
  check (not (ambito = 'hogar' and tipo = 'ingreso'));
```

- [ ] **Step 3: Que el usuario revise el SQL**

**Regla del proyecto: nunca aplicar una migración sin que el usuario revise el SQL primero.**
Hay datos reales de 2 usuarios. Mostrarle el archivo y esperar su OK explícito.

- [ ] **Step 4: Aplicar con `apply_migration`**

Aplicar vía MCP `apply_migration` (NO por el SQL Editor: las del SQL Editor no quedan en el
ledger y ese es el origen de la deriva documentada en CLAUDE.md).

- [ ] **Step 5: Verificar por introspección que existe**

El ledger miente; verificar contra el catálogo real vía `execute_sql`:

```sql
select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.transacciones'::regclass
  and conname = 'transacciones_hogar_sin_ingreso';
```

Expected: 1 fila, con `definicion` = `CHECK ((NOT ((ambito = 'hogar'::text) AND (tipo = 'ingreso'::text))))`.

- [ ] **Step 6: Verificar que rechaza de verdad**

```sql
-- Debe FALLAR con: new row violates check constraint "transacciones_hogar_sin_ingreso"
insert into public.transacciones (user_id, tipo, ambito, monto, fecha)
values ('42c18981-e55f-4271-8f01-e89ab2975f44', 'ingreso', 'hogar', 1, current_date);
```

Expected: error de violación de constraint. Si el insert **pasa**, la constraint no está
haciendo nada — investigar antes de seguir.

- [ ] **Step 7: Correr el contract test**

Run (vía MCP `execute_sql`, solo lectura): el contenido de `supabase/tests/schema_contract_test.sql`
Expected: `ALL TESTS PASSED`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260716_transacciones_hogar_sin_ingreso.sql
git commit -m "feat(db): CHECK que impide ingreso en el ámbito hogar

El hogar solo registra gasto y ahorro. El cliente ya lo impide en el form y
en historial, pero sin la constraint cualquier insert por API la viola en
silencio — incluido el Worker de ingesta de correos, que usa service-role.

Verificado antes de aplicar: 0 filas en ese estado."
```

---

### Task 8: Orden de la card de presupuestos (#7)

**Files:**
- Create: `js/presupuestos-orden.js`
- Create: `test/presupuestos-orden.test.mjs`
- Modify: `views/dashboard.html` (markup del head de la card, CSS, `renderPresupuestos`)
- Modify: `index.html` (~línea 223, cargar el módulo)
- Modify: `sw.js` (~línea 37, precachear el módulo)

Contexto: hoy la card renderiza en el orden que llegan las categorías (`rowsPersonal + rowsHogar`).
Se piden dos órdenes: por gasto y por cercanía al límite. Default: cercanía al límite (es el
accionable). El control calca `hist-sort` (`historial.html:68`, CSS `:281`), que es el único
patrón de orden que la app conoce. Diferencia: `hist-sort` se oculta en desktop porque ahí
ordenan los encabezados; la card de presupuestos no tiene encabezados, así que se muestra siempre.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/presupuestos-orden.test.mjs`:

```javascript
import assert from 'node:assert';
import { test } from 'node:test';
import { ordenarPresupuestos } from '../js/presupuestos-orden.js';

const fila = (id, gastado, limite, esHogar = false) => ({ id, nombre: id, gastado, limite, esHogar });

// gastado/limite: comida 0.9, transporte 0.25, ocio 0.5
const FILAS = [
  fila('comida', 90, 100),
  fila('transporte', 50, 200),
  fila('ocio', 25, 50),
];

test('criterio limite, desc: primero el más cerca de reventar', () => {
  const out = ordenarPresupuestos(FILAS, 'limite', 'desc');
  assert.deepStrictEqual(out.map((f) => f.id), ['comida', 'ocio', 'transporte']);
});

test('criterio limite, asc: invierte', () => {
  const out = ordenarPresupuestos(FILAS, 'limite', 'asc');
  assert.deepStrictEqual(out.map((f) => f.id), ['transporte', 'ocio', 'comida']);
});

test('criterio gasto, desc: primero el que más gastó en monto', () => {
  const out = ordenarPresupuestos(FILAS, 'gasto', 'desc');
  assert.deepStrictEqual(out.map((f) => f.id), ['comida', 'transporte', 'ocio']);
});

test('criterio gasto, asc: invierte', () => {
  const out = ordenarPresupuestos(FILAS, 'gasto', 'asc');
  assert.deepStrictEqual(out.map((f) => f.id), ['ocio', 'transporte', 'comida']);
});

test('los dos criterios NO dan el mismo orden (transporte gastó más que ocio pero está más lejos del límite)', () => {
  const porLimite = ordenarPresupuestos(FILAS, 'limite', 'desc').map((f) => f.id);
  const porGasto = ordenarPresupuestos(FILAS, 'gasto', 'desc').map((f) => f.id);
  assert.notDeepStrictEqual(porLimite, porGasto);
});

test('no muta el array de entrada', () => {
  const original = FILAS.map((f) => f.id);
  ordenarPresupuestos(FILAS, 'gasto', 'desc');
  assert.deepStrictEqual(FILAS.map((f) => f.id), original);
});

test('limite 0 no rompe ni produce NaN (no debe asumir el filtro > 0 del llamador)', () => {
  const out = ordenarPresupuestos([fila('cero', 10, 0), fila('comida', 90, 100)], 'limite', 'desc');
  assert.strictEqual(out.length, 2);
  assert.ok(out.every((f) => f.id));
});

test('limite 0 con gasto se trata como excedido: va antes que uno al 90%', () => {
  const out = ordenarPresupuestos([fila('comida', 90, 100), fila('cero', 10, 0)], 'limite', 'desc');
  assert.strictEqual(out[0].id, 'cero');
});

test('limite 0 sin gasto no es excedido: va al final', () => {
  const out = ordenarPresupuestos([fila('comida', 90, 100), fila('cero', 0, 0)], 'limite', 'desc');
  assert.strictEqual(out[0].id, 'comida');
});

test('empate: mantiene el orden relativo de entrada (estable)', () => {
  const out = ordenarPresupuestos([fila('a', 50, 100), fila('b', 50, 100)], 'limite', 'desc');
  assert.deepStrictEqual(out.map((f) => f.id), ['a', 'b']);
});

test('mezcla personal y hogar: el orden manda, no el agrupado', () => {
  const out = ordenarPresupuestos(
    [fila('personal-bajo', 10, 100), fila('hogar-alto', 95, 100, true)], 'limite', 'desc');
  assert.deepStrictEqual(out.map((f) => f.id), ['hogar-alto', 'personal-bajo']);
});

test('criterio desconocido cae a limite/desc', () => {
  const out = ordenarPresupuestos(FILAS, 'inventado', 'desc');
  assert.deepStrictEqual(out.map((f) => f.id), ['comida', 'ocio', 'transporte']);
});

test('lista vacía → lista vacía', () => {
  assert.deepStrictEqual(ordenarPresupuestos([], 'limite', 'desc'), []);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `node --test test/presupuestos-orden.test.mjs`
Expected: FAIL — no existe `../js/presupuestos-orden.js` (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: Implementar el módulo**

Crear `js/presupuestos-orden.js`:

```javascript
// ─────────────────────────────────────────────────────────────────
// Nestra — presupuestos-orden.js (Tanda 1, #7)
// Orden de la card "Presupuestos del mes" del dashboard. Puro y determinista.
// Dual-export como safe-to-spend.js / hogar-desequilibrio.js.
// ─────────────────────────────────────────────────────────────────
'use strict';

// _consumo(fila) — fracción del límite ya gastada. Un límite en 0 no puede
// dividirse: con gasto encima cuenta como excedido (Infinity), sin gasto no es
// urgente (0). El llamador ya filtra limite > 0, pero la función no lo asume.
function _consumo(fila) {
  var limite = Number(fila.limite) || 0;
  var gastado = Number(fila.gastado) || 0;
  if (limite <= 0) return gastado > 0 ? Infinity : 0;
  return gastado / limite;
}

// ordenarPresupuestos(filas, criterio, direccion) → filas ordenadas (copia).
//   filas:     [{ id, nombre, gastado, limite, esHogar }]
//   criterio:  'limite' (cercanía al límite) | 'gasto' (monto gastado).
//              Cualquier otro valor cae a 'limite'.
//   direccion: 'asc' | 'desc' (default). 
// No muta la entrada. El orden es estable: en empate manda el orden de entrada.
// El agrupado personal-primero se pierde a propósito: el orden elegido manda y
// las filas de hogar ya se distinguen por su badge.
function ordenarPresupuestos(filas, criterio, direccion) {
  var valor = criterio === 'gasto'
    ? function (f) { return Number(f.gastado) || 0; }
    : _consumo;
  var signo = direccion === 'asc' ? 1 : -1;
  return (filas || [])
    .map(function (f, i) { return { f: f, i: i }; })
    .sort(function (a, b) {
      var va = valor(a.f), vb = valor(b.f);
      if (va === vb) return a.i - b.i;   // estable
      return va < vb ? signo : -signo;   // Infinity se compara bien acá
    })
    .map(function (x) { return x.f; });
}

if (typeof window !== 'undefined') {
  window.ordenarPresupuestos = ordenarPresupuestos;
}

export { ordenarPresupuestos };
```

- [ ] **Step 4: Verificar que pasa**

Run: `node --test test/presupuestos-orden.test.mjs`
Expected: PASS — 13/13 tests.

- [ ] **Step 5: Correr toda la suite (no romper nada)**

Run: `node --test test/*.test.mjs`
Expected: `# pass 228`, `# fail 0`. El baseline antes de esta tanda es **211** (verificado
el 2026-07-16); +4 del Task 2 y +13 del Task 8 dan 228.

Nota: usar `test/*.test.mjs`, no `node --test test/` — el path del repo empieza con puntos
(`..Nestra-v2`) y la segunda forma falla con `MODULE_NOT_FOUND`.

- [ ] **Step 6: Cargar y precachear el módulo**

En `index.html`, junto a los otros módulos puros (~línea 223, después de
`<script type="module" src="js/presupuestos.js"></script>`):

```html
    <script type="module" src="js/presupuestos-orden.js"></script>
```

En `sw.js`, en la lista de precache junto a los otros `js/` (~línea 37):

```javascript
  { url: 'js/presupuestos-orden.js', revision: SHELL_VERSION },
```

- [ ] **Step 7: Agregar el control al markup**

En `views/dashboard.html`, reemplazar la línea 67:

```html
    <h2 class="dash-card-title" id="presupTitle">Presupuestos del mes</h2>
```

por:

```html
    <div class="dash-presup-head-row">
      <h2 class="dash-card-title" id="presupTitle">Presupuestos del mes</h2>
      <!-- Mismo patrón que hist-sort (historial.html:68). A diferencia de allá,
           acá se muestra también en desktop: la card no tiene encabezados de
           columna que puedan ordenar. -->
      <div class="dash-presup-sort" role="group" aria-label="Ordenar presupuestos">
        <label for="presupSortCampo">Ordenar</label>
        <select id="presupSortCampo">
          <option value="limite">Cerca del límite</option>
          <option value="gasto">Más gasto</option>
        </select>
        <button type="button" class="dash-presup-sort-dir" id="presupSortDir"
                aria-label="Cambiar dirección">▼</button>
      </div>
    </div>
```

- [ ] **Step 8: Agregar el CSS**

En el `<style>` de `views/dashboard.html`, junto a las reglas `.dash-presup*` (~línea 430):

```css
  .dash-presup-head-row {
    display: flex; align-items: center; justify-content: space-between;
    gap: var(--space-sm); flex-wrap: wrap;
  }
  .dash-presup-sort { display: flex; align-items: center; gap: var(--space-xs); }
  .dash-presup-sort label {
    font-size: var(--font-size-xs); color: var(--text-secondary);
  }
  .dash-presup-sort select {
    min-height: 44px; background: var(--bg-light-secondary); color: var(--text-dark);
    border: 1px solid var(--border-light); border-radius: var(--radius-sm);
    font-size: var(--font-size-sm); padding: 0 var(--space-xs);
  }
  .dash-presup-sort-dir {
    min-width: 44px; min-height: 44px; background: transparent;
    border: 1px solid var(--border-light); border-radius: var(--radius-sm);
    color: var(--text-secondary); cursor: pointer;
  }
  .dash-presup-sort-dir:focus-visible, .dash-presup-sort select:focus-visible {
    outline: 2px solid var(--color-primary); outline-offset: 2px;
  }
```

- [ ] **Step 9: Wirear el orden en `renderPresupuestos`**

En `views/dashboard.html`, en `renderPresupuestos` (~línea 701), reemplazar el bloque final:

```javascript
      const rowsPersonal = lista.map((cat) =>
        fila(cat, Number(cat.limite_mensual) || 0, Number((gastoPorCat || {})[cat.id] || 0), false)).join('');
      const rowsHogar = listaHogar.map((cat) =>
        fila(cat, Number(cat.limite_mensual_hogar) || 0, Number((gastoHogarPorCat || {})[cat.id] || 0), true)).join('');

      body.innerHTML = rowsPersonal + rowsHogar;
      card.style.display = 'block';
    }
```

por:

```javascript
      // Se normaliza a una sola lista para que el orden elegido mande sobre el
      // agrupado personal-primero. La fila de hogar ya se distingue por su badge.
      const todas = [
        ...lista.map((cat) => ({
          cat, limite: Number(cat.limite_mensual) || 0,
          gastado: Number((gastoPorCat || {})[cat.id] || 0), esHogar: false,
        })),
        ...listaHogar.map((cat) => ({
          cat, limite: Number(cat.limite_mensual_hogar) || 0,
          gastado: Number((gastoHogarPorCat || {})[cat.id] || 0), esHogar: true,
        })),
      ];
      const ordenadas = (typeof ordenarPresupuestos === 'function')
        ? ordenarPresupuestos(todas, _presupOrden.criterio, _presupOrden.direccion)
        : todas;

      body.innerHTML = ordenadas
        .map((f) => fila(f.cat, f.limite, f.gastado, f.esHogar)).join('');
      card.style.display = 'block';
    }

    // Estado del orden de la card. No se persiste entre sesiones a propósito
    // (YAGNI): es un dashboard que se mira de pasada, no una tabla de trabajo.
    var _presupOrden = { criterio: 'limite', direccion: 'desc' };
    var _presupUltimo = null; // últimos args de renderPresupuestos, para re-render

    (function initPresupOrden() {
      var sel = document.getElementById('presupSortCampo');
      var dir = document.getElementById('presupSortDir');
      if (!sel || !dir) return;
      function rerender() {
        if (!_presupUltimo) return;
        renderPresupuestos.apply(null, _presupUltimo);
      }
      sel.addEventListener('change', function () {
        _presupOrden.criterio = sel.value;
        rerender();
      });
      dir.addEventListener('click', function () {
        _presupOrden.direccion = (_presupOrden.direccion === 'desc') ? 'asc' : 'desc';
        dir.textContent = (_presupOrden.direccion === 'desc') ? '▼' : '▲';
        dir.setAttribute('aria-label',
          _presupOrden.direccion === 'desc' ? 'Orden descendente, cambiar a ascendente'
                                            : 'Orden ascendente, cambiar a descendente');
        rerender();
      });
    })();
```

Y al INICIO de `renderPresupuestos` (justo después de la línea
`function renderPresupuestos(categorias, gastoPorCat, gastoHogarPorCat) {`), agregar:

```javascript
      _presupUltimo = [categorias, gastoPorCat, gastoHogarPorCat];
```

**Cuidado con el orden de declaración:** `_presupOrden` y `_presupUltimo` usan `var`, así que
hoistean y `renderPresupuestos` puede referenciarlos aunque se declaren después. El IIFE
`initPresupOrden` corre en cuanto se ejecuta el script, y para entonces el markup del Step 7
ya está en el DOM (el router inyecta el HTML antes de ejecutar sus scripts).

- [ ] **Step 10: Verificar en el navegador**

En el preview, en `#dashboard`, con al menos 2 categorías con `limite_mensual > 0` y consumos
distintos:

1. Al cargar: orden por cercanía al límite, descendente. La categoría más cerca de reventar
   arriba.
2. Cambiar el select a "Más gasto": el orden cambia al ranking por monto.
3. Tocar el botón de dirección: se invierte y la flecha pasa a ▲.
4. En móvil (DevTools, 375px): el control entra en el head sin romper el layout, y los
   targets son de 44px.

Expected: sin errores en consola.

- [ ] **Step 11: Commit**

```bash
git add js/presupuestos-orden.js test/presupuestos-orden.test.mjs views/dashboard.html index.html sw.js
git commit -m "feat(dashboard): dos órdenes para la card de presupuestos

Por cercanía al límite (default, es el accionable: la categoría a punto de
reventar importa más que la que gastó mucho pero tiene margen) o por monto
gastado. Control calcado de hist-sort, el único patrón de orden que la app
ya tenía; a diferencia de historial se muestra también en desktop, porque
la card no tiene encabezados de columna que ordenen.

La comparación va en una función pura con tests. El agrupado
personal-primero se pierde a propósito: manda el orden elegido y la fila de
hogar ya se distingue por su badge."
```

---

### Task 9: Bump de SHELL_VERSION y deploy

**Files:**
- Modify: `sw.js:15`

Contexto: cambiaron assets precacheados (`css/base.css`, `views/*.html`, `index.html`, y el
módulo nuevo `js/presupuestos-orden.js`). Sin bump, los dispositivos con la PWA instalada
siguen con el shell viejo.

- [ ] **Step 1: Bump**

En `sw.js:15`, cambiar:

```javascript
const SHELL_VERSION = 'v26';
```

por:

```javascript
const SHELL_VERSION = 'v27';
```

- [ ] **Step 2: Correr toda la suite antes de desplegar**

Run: `node --test test/*.test.mjs`
Expected: PASS, 0 fallos. **Si algo falla, parar.** No se despliega en rojo.

- [ ] **Step 3: Commit y push**

```bash
git add sw.js
git commit -m "chore(tanda1): bump SHELL_VERSION a v27

Cambiaron assets precacheados: css/base.css (tokens --s2s-*), dashboard,
transaccion, historial, configuracion, index.html y el módulo nuevo
js/presupuestos-orden.js."
git push origin v2
```

- [ ] **Step 4: Verificar el deploy live**

Esperar ~1-2 min el build de Cloudflare Pages, luego:

Run: `curl -sL https://nestra-8rl.pages.dev/sw.js | grep SHELL_VERSION`
Expected: `const SHELL_VERSION = 'v27';`

Run: `curl -sL https://nestra-8rl.pages.dev/js/presupuestos-orden.js | head -5`
Expected: la cabecera del módulo (confirma que el archivo nuevo se sirve).

- [ ] **Step 5: Avisar al usuario**

Decirle que recargue o cierre y reabra la PWA para tomar el shell nuevo, y qué debería ver:
el hero legible, el balance del hogar en el primer render, el orden en presupuestos, y el
hogar cargando en cada visita.

---

## Self-Review

**Spec coverage:**

| Requisito del spec | Tarea |
|---|---|
| §1 #3b — priming de `hogarState` + no bloquear + reset entre usuarios | Task 3 |
| §1 #4 — repro primero, fix según error real, regresión en rojo→verde | Task 4 |
| §2 #3a — tokens fijos, `color: inherit`, card `--excedido` incluida | Task 2 |
| §2 #8 — borrar fila hardcodeada | Task 1 |
| §3 #5 capa 1 (form, ámbito gana, sin toast) | Task 5 |
| §3 #5 capa 2 (historial, deshabilita sin re-activar) | Task 6 |
| §3 #5 capa 3 (CHECK, revisión del usuario, `apply_migration`, contract test) | Task 7 |
| §3 #7 — función pura + tests, `<select>` estilo `hist-sort`, default `limite`, sin persistir | Task 8 |
| Verificación — bump `SHELL_VERSION`, deploy, curl | Task 9 |

Sin huecos.

**Placeholder scan:** el único marcador intencional es el mensaje de commit del Task 4
(`<<Reemplazar por la causa real>>`) y el archivo a modificar de esa tarea. Es deliberado y
está justificado en el spec: el arreglo depende de un error que todavía no se leyó, y el
Step 1 corta la ejecución si el bug no reproduce. Todo lo demás lleva código completo.

**Type consistency:**
- `ordenarPresupuestos(filas, criterio, direccion)` — misma firma en el test (Step 1), la
  implementación (Step 3) y el llamador (Step 9). Las filas llevan `{ id, nombre, gastado,
  limite, esHogar }` en el test; el llamador pasa `{ cat, limite, gastado, esHogar }` — la
  función solo lee `gastado` y `limite`, así que ambas formas sirven. Verificado.
- `primeHogarState()` / `resetHogarPrime()` — mismos nombres en db.js (Step 1), router.js
  (Step 2) y auth.js (Step 3).
- Tokens `--s2s-from` / `--s2s-to` / `--s2s-exc-from` / `--s2s-exc-to` — mismos nombres en el
  test (Task 2 Step 1), el CSS (Step 3) y el consumidor (Step 5).
- `_presupOrden` / `_presupUltimo` / `renderPresupuestos` — consistentes dentro del Task 8.
