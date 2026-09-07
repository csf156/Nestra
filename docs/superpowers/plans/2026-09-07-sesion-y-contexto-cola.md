# Arreglo de sesión y contexto en la cola de revisión

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para ejecutar este plan task por task. Los pasos usan checkbox (`- [ ]`).

**Goal:** (A) Que la app deje de pedir contraseña en cada arranque — hoy pasa **siempre** en el iPhone. (B) Que la cola de revisión diga de qué movimiento se trata sin depender del nombre del banco: hora, historial de la contraparte y agrupación por día.

**Architecture:** A corrige una carrera de arranque en `js/router.js`, que hoy decide si hay sesión mirando una variable que aún no se ha rellenado. B añade una columna `hora` a `ingest_pendientes` —parseada del cuerpo del correo, con relleno retroactivo— y usa datos que ya existen para dar contexto en cada fila.

**Tech Stack:** PWA vanilla sin build, Worker de ingesta, Supabase, `node:test`.

---

# ETAPA A — La sesión se cae en cada arranque

## Síntoma y confirmación

El usuario reportó: *"aún me sucede que tengo que iniciar sesión cada vez que entro al acceso directo de la app en mi iPhone"*. Confirmado con dos preguntas: le muestra el login **de inmediato** (no ve el dashboard y luego salta), y pasa **también si cierra y reabre a los 5 segundos**.

La Etapa D del plan anterior (`v47`) no atacó esto: aquello trataba un tropiezo ocasional de red, no un fallo determinista de arranque.

## Causa raíz

`js/router.js:273`:

```js
async function initRouter() {
  await new Promise((resolve) => setTimeout(resolve, 100));   // buffer fijo
  await handleRouteChange();
}
```

`handleRouteChange` consulta `isAuthenticated()`, que es (`js/auth.js:25`):

```js
function isAuthenticated() {
  return window.currentUser !== null;
}
```

Una variable en memoria que rellena `initAuth()`, corriendo en paralelo. Y `initAuth` hace, antes de rellenarla: leer `localStorage` → **`getUser()` contra el servidor** → `loadProfile()` → `setupRealtimeProfiles()`. Varias idas y vueltas de red.

**El router apuesta 100 milisegundos.** En un portátil con buena conexión a veces alcanzan; **en un iPhone arrancando la PWA en frío, nunca**. Por eso al usuario le pasa siempre y en la verificación no salía.

Y cuando `initAuth` termina y sí rellena `currentUser`, **nadie vuelve a evaluar la ruta**: el usuario ya está mirando el login.

### Evidencia en la base

Sesiones reales del usuario. La vieja seguía viva y se refrescó al abrir la app:

```
creada 09-06 12:02 → último uso 09-07 00:44:24   (duró 12 h 42)
                     sesión nueva 09-07 00:44:26  ← 2 segundos después
                     sesión nueva 09-07 00:44:42
```

Supabase-js rehidrató y refrescó bien. **El token nunca fue el problema.** Y cada login crea 2-3 sesiones en segundos, coherente con el redirect de OAuth resolviéndose mientras la carrera ocurre.

---

### Task A1: Señal de "auth lista" (lógica pura)

**Files:**
- Create: `js/auth-listo.js`
- Test: `test/auth-listo.test.mjs`

- [ ] **Step 1: Escribir el test que falla**

```js
// test/auth-listo.test.mjs
// Promesa de "auth ya decidió". Pura: sin DOM, sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearGateAuth } from '../js/auth-listo.js';

test('espera hasta que se marque listo, no un tiempo fijo', async () => {
  const g = crearGateAuth();
  let resuelto = false;
  g.cuandoListo().then(() => { resuelto = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(resuelto, false, 'no debe resolver antes de marcarse');
  g.marcarListo();
  await g.cuandoListo();
  assert.equal(resuelto, true);
});

test('marcar listo dos veces no rompe ni re-resuelve', () => {
  const g = crearGateAuth();
  g.marcarListo();
  g.marcarListo();
  assert.equal(g.estaListo(), true);
});

test('si ya está listo, cuandoListo resuelve de inmediato', async () => {
  const g = crearGateAuth();
  g.marcarListo();
  const t0 = Date.now();
  await g.cuandoListo();
  assert.ok(Date.now() - t0 < 50);
});

test('estaListo arranca en false', () => {
  assert.equal(crearGateAuth().estaListo(), false);
});

test('el timeout de seguridad resuelve aunque nadie marque', async () => {
  // Si initAuth muriera sin marcar, la app no puede quedarse en blanco para
  // siempre: se sigue adelante y el router decidirá con lo que haya.
  const g = crearGateAuth({ timeoutMs: 30 });
  const t0 = Date.now();
  await g.cuandoListo();
  assert.ok(Date.now() - t0 >= 25);
  assert.equal(g.estaListo(), true);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test test/auth-listo.test.mjs`
Expected: FAIL — `Cannot find module`.

- [ ] **Step 3: Implementar**

```js
// js/auth-listo.js — puerta de "la autenticación ya decidió".
// Existe porque el router esperaba 100 ms fijos y luego preguntaba por una
// variable que initAuth aún no había rellenado: en un iPhone arrancando en
// frío nunca alcanzaban, y el usuario acababa en el login teniendo sesión
// válida. Esperar a un HECHO en vez de a un reloj.
function crearGateAuth(opts) {
  var listo = false;
  var resolver;
  var promesa = new Promise(function (res) { resolver = res; });

  // Red de seguridad: si initAuth muriera sin marcar, la app no puede quedar
  // colgada. Se sigue adelante y el router decide con lo que haya.
  var ms = (opts && opts.timeoutMs) || 8000;
  var t = setTimeout(function () { marcarListo(); }, ms);
  if (t && typeof t.unref === 'function') t.unref();   // no retener el proceso en Node

  function marcarListo() {
    if (listo) return;
    listo = true;
    clearTimeout(t);
    resolver();
  }
  return {
    marcarListo: marcarListo,
    estaListo: function () { return listo; },
    cuandoListo: function () { return promesa; },
  };
}

if (typeof window !== 'undefined') {
  window.crearGateAuth = crearGateAuth;
  window.authGate = crearGateAuth();
}
export { crearGateAuth };
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node --test test/auth-listo.test.mjs`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add js/auth-listo.js test/auth-listo.test.mjs
git commit -m "feat(auth): puerta de 'auth lista' en vez de un temporizador"
```

---

### Task A2: El router espera el hecho, y reevalúa

**Files:**
- Modify: `js/auth.js`, `js/router.js`, `index.html`, `sw.js`

- [ ] **Step 1: `initAuth` marca la puerta en TODAS sus salidas**

En `js/auth.js`, `initAuth()` tiene varias rutas de salida: sin token, usuario inválido, éxito, y el `catch`. **Todas** deben marcar listo, o la app se queda esperando hasta el timeout.

La forma segura es un `finally`:

```js
  } catch (err) {
    console.error('Unexpected error in initAuth():', err);
    window.currentUser = null;
    window.currentProfile = null;
    window.hogarState = null;
  } finally {
    // Pase lo que pase, el router puede seguir: ya sabemos si hay sesión.
    if (window.authGate) window.authGate.marcarListo();
  }
```

> Verifica que ninguna salida anterior haga `return` esquivando el `finally` — un `finally` los cubre todos, pero **léelo** antes de darlo por hecho.

- [ ] **Step 2: El router espera el hecho, no el reloj**

En `js/router.js`, reemplazar el `setTimeout` de `initRouter`:

```js
async function initRouter() {
  try {
    // Antes: setTimeout de 100 ms. En un iPhone arrancando la PWA en frío no
    // alcanzaban nunca, y handleRouteChange preguntaba isAuthenticated() con
    // currentUser todavía en null → login con sesión válida.
    if (window.authGate) await window.authGate.cuandoListo();

    console.log('Router initialized');
    await handleRouteChange();
  } catch (err) {
    console.error('Error initializing router:', err.message);
  }
}
```

- [ ] **Step 3: Reevaluar la ruta cuando la sesión aparezca tarde**

Aunque la puerta cubre el arranque, `INITIAL_SESSION` o una recuperación pueden rellenar `currentUser` después. Hoy nadie vuelve a mirar. En `setupAuthStateListener`, tras rehidratar en `SIGNED_IN`, ya se redirige. Añadir el caso que falta:

```js
    // La sesión apareció DESPUÉS de que el router decidiera (rehidratación
    // tardía). Sin esto el usuario se queda en el login con sesión válida.
    if (event === 'INITIAL_SESSION' && session && session.user) {
      window.currentUser = session.user;
      try { await loadProfile(session.user.id); } catch (e) { /* el trigger crea el perfil */ }
      if (typeof updateUserChip === 'function') updateUserChip();
      if (window.authGate) window.authGate.marcarListo();
      if (window.location.hash === '#login' || window.location.hash === '') {
        window.location.hash = '#dashboard';
      }
      return;
    }
```

> Colócalo **antes** del bloque que trata `SIGNED_OUT`/sesión perdida, y comprueba con `grep -n "INITIAL_SESSION" js/auth.js` que hoy no se maneja (debe dar 0 antes del cambio).

- [ ] **Step 4: Cargar el módulo ANTES que el router**

En `index.html`, `js/auth-listo.js` debe cargarse antes de `js/auth.js` y de `js/router.js` — si no, `window.authGate` no existe cuando `initAuth` intenta marcarlo.

```html
    <script type="module" src="js/auth-listo.js"></script>
```

Y en `sw.js`: `{ url: 'js/auth-listo.js', revision: SHELL_VERSION },`

- [ ] **Step 5: Verificar — y este es el punto que importa**

1. **Con red lenta simulada** (DevTools → Network → Slow 3G), recargar con sesión activa: **debe entrar al dashboard, no al login.** Este es el escenario del usuario; sin throttling el bug no se reproduce.
2. Recargar sin sesión → login, como siempre.
3. Cerrar sesión a mano → login. El camino terminal no se rompe.
4. Con red lenta, comprobar que no se queda en blanco más de un par de segundos.

- [ ] **Step 6: Suite, bump y commit**

`sw.js`: `SHELL_VERSION` a `v51`.

Run: `for f in test/*.test.mjs; do node --test "$f" || echo "FAIL $f"; done`

```bash
git add js/auth.js js/router.js index.html sw.js
git commit -m "fix(sesion): el router espera a que auth decida, no a 100 ms"
```

---

# ETAPA B — Contexto en la cola de revisión

## Por qué esto y no la ubicación

El usuario pidió guardar la ubicación del teléfono al capturar un pago, para reconocer a quién le pagó — *"con solo los nombres es un poco confuso"*.

El problema es real y está medido: **183 movimientos con contraparte, 117 nombres distintos**. Pero al medir el reparto:

| | |
|---|---|
| 33 nombres repetidos | cubren **99 movimientos (54%)** — el alias ya los resuelve |
| 84 nombres únicos | **46%** — el alias no ayuda |
| 28 filas | sin comercio ni contraparte: ciegas |

**La objeción que decidió el rumbo:** la ubicación informa justo donde el nombre ya es claro —una compra en un local, que además ya trae comercio legible (278 de 306 filas)— y calla justo donde confunde: una transferencia a una persona se hace desde el sofá o el bus, y el sitio no dice a quién le pagaste.

Estas tres mejoras atacan lo mismo sin permisos nuevos ni datos sensibles, y cuestan menos que la mitad.

### El dato que deja la puerta abierta

Se midió el retardo real entre el pago y la ingesta, sobre 277 filas con hora recuperable:

```
mediana 5,5 min · p90 9,5 min · máximo 10,5 min · 277/277 dentro de 15 min
```

Acotado por el trigger de 10 minutos del Apps Script. **Eso mantiene viva la idea de la ubicación** para más adelante: si el usuario toca el push pronto, sigue en el sitio. Y con la hora parseada (Task B1) el desfase pasa a ser calculable, que era la salvaguarda que antes no se podía construir.

**Revisar en 3-4 semanas**, con una métrica real: cuántos pendientes se confirman sin que el usuario reconozca el nombre.

---

### Task B1: Columna `hora` + relleno retroactivo — REQUIERE REVISIÓN DEL USUARIO

`ingest_pendientes.fecha` es de tipo `date`: **no hay hora en ninguna columna**. Pero está en `raw_body` en el 97% de las filas.

**Files:**
- Create: `supabase/migrations/20260907_ingest_hora.sql`

- [ ] **Step 1: Escribir la migración y PARAR**

```sql
-- Hora del movimiento. `fecha` es date y pierde la hora, que sí viene en el
-- cuerpo del correo. Sin ella la cola no puede ordenar ni agrupar por momento
-- del día, que es como el usuario recuerda sus gastos.
alter table public.ingest_pendientes add column if not exists hora time;

-- Relleno retroactivo. Tres formatos observados en los correos reales:
--   BBVA consumo:  "Fecha y hora: 3 de agosto, 2026 14:04"
--   BBVA QR:       "Hora:\n\n14:49:05"
--   Yape saliente: "Fecha y Hora de la operacion 30 agosto 2026 - 11:39"
update public.ingest_pendientes set hora = sub.hhmm::time
from (
  select id,
    coalesce(
      (regexp_match(raw_body, 'Fecha y hora:[^0-9]*[0-9]{1,2}[^0-9]+[a-zA-Zé]+,?\s*[0-9]{4}\s+([0-9]{1,2}:[0-9]{2})'))[1],
      (regexp_match(raw_body, 'Hora:\s*[\r\n]+\s*([0-9]{1,2}:[0-9]{2})'))[1],
      (regexp_match(raw_body, 'Fecha y Hora de la operacion[^0-9]*[0-9]{1,2}[^0-9]+[a-zA-Z]+\s+[0-9]{4}\s*-\s*([0-9]{1,2}:[0-9]{2})'))[1]
    ) hhmm
  from public.ingest_pendientes
) sub
where sub.id = public.ingest_pendientes.id
  and sub.hhmm is not null
  and public.ingest_pendientes.hora is null;
```

> **PARAR.** `CLAUDE.md`: *"Nunca apliques una migración sin que el usuario revise el SQL primero. Hay datos reales de 2 usuarios."*
>
> Nota para esa revisión: **añade una columna y rellena solo filas donde `hora` es null**. No modifica ninguna columna existente ni borra nada. El `UPDATE` es idempotente: correrlo dos veces no cambia nada la segunda.
>
> Cobertura medida con estos mismos tres patrones: **277 de 306 (90,5%)**. Las 29 restantes quedan con `hora` null y la UI debe tolerarlo.

- [ ] **Step 2: Aplicar con `apply_migration` (solo tras el visto bueno)**

- [ ] **Step 3: Verificar por introspección, no por el ledger**

```sql
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='ingest_pendientes' and column_name='hora';

select count(*) total, count(hora) con_hora,
       round(100.0*count(hora)/count(*),1) pct
from public.ingest_pendientes;
```

Expected: la columna existe, `pct` ≈ 90.

- [ ] **Step 4: Sumarla al contract test y commitear**

Añadir `hora` a la sección de columnas frágiles de `supabase/tests/schema_contract_test.sql` — **esta sí lo es**: si desapareciera, la UI degradaría en silencio mostrando filas sin hora, sin error visible. Correr hasta `ALL TESTS PASSED`.

```bash
git add supabase/migrations/20260907_ingest_hora.sql supabase/tests/schema_contract_test.sql
git commit -m "feat(ingest): columna hora con relleno retroactivo"
```

---

### Task B2: El Worker guarda la hora de los correos nuevos

Sin esto, el relleno retroactivo envejece: los correos nuevos entrarían sin hora.

**Files:**
- Modify: `workers/ingest/parsers/utils.js`, `bbva.js`, `yape.js`, `bcp.js`
- Modify: `workers/ingest/src/index.js`
- Modify: `test/ingest-parsers.test.mjs`

- [ ] **Step 1: Escribir el test que falla**

Reutilizando los fixtures verbatim que ya existen en el archivo:

```js
test('parseHora: saca HH:MM de los tres formatos reales', () => {
  assert.equal(parseHora('Fecha y hora: 3 de agosto, 2026 14:04'), '14:04');
  assert.equal(parseHora('Hora:\n\n14:49:05'), '14:49');
  assert.equal(parseHora('Fecha y Hora de la operacion 30 agosto 2026 - 11:39 a. m.'), '11:39');
});

test('parseHora: sin hora reconocible → null, nunca inventa', () => {
  assert.equal(parseHora('sin nada'), null);
  assert.equal(parseHora(''), null);
  assert.equal(parseHora(null), null);
});

test('bbva: el consumo trae hora en la propuesta', () => {
  // Usa el fixture BBVA de consumo que ya existe en este archivo.
  const p = parse('bbva', { subject: 'Has realizado un consumo con tu tarjeta BBVA',
                            body: BBVA_CONSUMO, date: '2026-07-14T18:00:00Z' });
  assert.match(p.hora, /^\d{2}:\d{2}$/);
});
```

> **Lee los fixtures existentes antes de escribir el tercer test** y usa el nombre real de la constante. No inventes cuerpos: el archivo advierte explícitamente contra eso.

- [ ] **Step 2: Correr, verificar que falla, implementar**

`parseHora(txt)` en `utils.js`, exportada por `parsers/index.js`. Cada parser añade `hora` a la propuesta que devuelve. `src/index.js` la incluye en la fila que inserta.

- [ ] **Step 3: Suite y commit**

```bash
git add workers/ingest test/ingest-parsers.test.mjs
git commit -m "feat(parsers): la propuesta incluye la hora del movimiento"
```

> El deploy del Worker (`npx wrangler deploy`) **no se ejecuta sin autorización del usuario**, igual que en la Etapa B anterior. Y recuerda: mergear a `main` NO actualiza el Worker.

---

### Task B3: Hora, contexto de contraparte y agrupación por día

**Files:**
- Modify: `js/db.js` (traer `hora` en el select), `js/revisar-lote.js` (lógica pura), `views/revisar.html`
- Modify: `test/revisar-lote.test.mjs`

- [ ] **Step 1: Escribir los tests que fallan**

```js
test('contextoContraparte: cuenta las veces y da la última', () => {
  const previos = [
    { comercio: null, contraparte: 'KAREN R GAGO O', fecha: '2026-08-12', monto: 50 },
    { comercio: null, contraparte: 'karen r gago o', fecha: '2026-07-03', monto: 50 },
  ];
  const c = contextoContraparte({ contraparte: 'Karen R Gago O' }, previos);
  assert.equal(c.veces, 3);              // las 2 previas + esta
  assert.equal(c.ultimaFecha, '2026-08-12');
  assert.equal(c.montoTipico, 50);
});

test('contextoContraparte: primera vez se declara como tal', () => {
  const c = contextoContraparte({ contraparte: 'ALGUIEN NUEVO' }, []);
  assert.equal(c.veces, 1);
  assert.equal(c.primeraVez, true);
});

test('contextoContraparte: sin contraparte ni comercio devuelve null', () => {
  assert.equal(contextoContraparte({ contraparte: null, comercio: null }, []), null);
});

test('agruparPorDia: agrupa y ordena de más reciente a más antiguo', () => {
  const filas = [
    { id: 'a', fecha: '2026-09-01', hora: '14:00' },
    { id: 'b', fecha: '2026-09-02', hora: '09:00' },
    { id: 'c', fecha: '2026-09-01', hora: '08:00' },
  ];
  const g = agruparPorDia(filas);
  assert.deepEqual(g.map((x) => x.fecha), ['2026-09-02', '2026-09-01']);
  // Dentro del día, la más reciente primero.
  assert.deepEqual(g[1].filas.map((f) => f.id), ['a', 'c']);
});

test('agruparPorDia: las filas sin hora no se pierden ni rompen el orden', () => {
  const g = agruparPorDia([
    { id: 'a', fecha: '2026-09-01', hora: null },
    { id: 'b', fecha: '2026-09-01', hora: '10:00' },
  ]);
  assert.equal(g[0].filas.length, 2);
});
```

- [ ] **Step 2: Correr, verificar que fallan, implementar en `js/revisar-lote.js`**

`contextoContraparte(fila, previos)` normaliza con `normalizarContraparte` (ya existe) para que las variantes cuenten como la misma persona. `agruparPorDia(filas)` devuelve `[{ fecha, filas }]`, más reciente primero, y **tolera `hora` null** — el 10% de las filas no la tendrá.

- [ ] **Step 3: `getIngestPendientes` trae la hora**

Añadir `hora` al `select` de `js/db.js`. Sin esto la UI no la ve, y es un fallo silencioso: la fila se pinta igual, solo que sin hora.

- [ ] **Step 4: Pintar las tres cosas en la cola**

- **Hora** junto a la fecha del movimiento: `mar 2 sep · 14:49`. Si `hora` es null, solo la fecha.
- **Contexto** bajo el nombre: `3.ª vez · última el 12/8 · S/50`, o `primera vez`. Nada si `contextoContraparte` devuelve null.
- **Agrupación por día** con un encabezado por fecha.

> El modo lote y el popover de categoría ya viven en esta vista. **La agrupación cambia el orden del DOM**, así que revisa que `_filas[i]` siga correspondiendo a la card correcta — los índices se usan en `data-rev-check`, `data-rev-alias` y `data-rev-chip`. Es el error probable de esta task.

- [ ] **Step 5: Verificar en navegador**

1. Las filas muestran hora donde la hay; las que no, solo fecha, sin hueco raro.
2. El contexto aparece y es correcto contra una consulta manual.
3. Agrupadas por día, más reciente arriba.
4. **Modo lote sigue funcionando tras la agrupación**: marcar, "Marcar sugeridas", confirmar en bloque.
5. El botón de alias y el popover de categoría siguen abriendo la fila correcta.

- [ ] **Step 6: Suite, bump y commit**

`sw.js`: `SHELL_VERSION` a `v52`.

```bash
git add js/db.js js/revisar-lote.js views/revisar.html test/revisar-lote.test.mjs sw.js
git commit -m "feat(revisar): hora, contexto de contraparte y agrupación por día"
```

---

## Fuera de alcance

**La ubicación.** Se revisa en 3-4 semanas con una métrica real, no con una intuición. La medición del retardo (mediana 5,5 min, máximo 10,5) deja la puerta abierta: si se construye, la salvaguarda del desfase ya será calculable gracias a la Task B1.

Si el usuario decide construirla, las condiciones son innegociables: tabla aparte sin ninguna ruta por `hogar_id`, coordenadas redondeadas a 3 decimales, retención de 90 días con purga, fuera del export por defecto, el permiso pedido desde Configuración en frío —nunca al tocar un push—, y el mapa como enlace que el usuario abre, **nunca un iframe**: un embebido filtra las coordenadas al proveedor cada vez que se pinta la cola.
