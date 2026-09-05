# Sesión persistente, dos cifras y alias de contrapartes — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tres cosas que el usuario pidió el 2026-09-05: que la sesión no se caiga en el celular (D), que "puedes gastar hoy" muestre también lo que hay registrado de verdad (E), y poder ponerle alias a las contrapartes de PLIN (F).

**Architecture:** Tres etapas independientes, cada una con su PR. D corrige un defecto de robustez en `js/auth.js` y pide almacenamiento persistente al navegador. E añade una segunda cifra al desglose que ya calcula `js/safe-to-spend.js`. F añade una tabla de alias con RLS y los aplica en la cola de revisión y en la nota de la transacción — y con eso la memoria de categoría sale gratis, porque `autocat` ya aprende de la nota.

**Tech Stack:** PWA vanilla sin build, `node:test` para lógica pura, Supabase Auth + PostgREST, IndexedDB.

---

## Orden y por qué

1. **D — sesión.** Es un defecto, no una función que falte, y te deja fuera de la app cuando ocurre. La más barata.
2. **E — dos cifras.** Un número que lees a diario y en el que necesitas confiar.
3. **F — alias.** La de mayor superficie: tabla nueva, migración sobre datos reales, y UI.

## Decisiones tomadas con el usuario (2026-09-05)

- **"Puedes gastar hoy" muestra las dos cifras**: el disponible estimado arriba, y debajo el balance realmente registrado del mes. No se cambia la base del cálculo.
- **El alias llega hasta la memoria de categoría**, pero **no** al push. El Worker seguirá notificando con el nombre del banco: consultar alias antes de notificar le añadiría una query en el camino crítico, y el usuario no lo pidió.

---

# ETAPA D — Que la sesión no se caiga

## Diagnóstico

El usuario abre Nestra **siempre desde el ícono de la pantalla de inicio** (PWA instalada). Eso descarta la purga de 7 días de Safari, que no aplica a las apps instaladas.

Y la sesión **ya está configurada para persistir**: `js/supabase.js` llama a `createClient(SUPABASE_URL, SUPABASE_ANON_KEY)` sin opciones, o sea con los valores por defecto `persistSession: true` y `autoRefreshToken: true`. **No hay un interruptor apagado que encender, y añadir uno sería teatro.**

Los datos lo confirman — sesiones reales del usuario en `auth.sessions`:

| Creada | Último uso | Duró |
|---|---|---|
| 16-ago | 25-ago | 9 días |
| 25-ago | 27-ago | 2 días |
| 27-ago | 01-sep | 4 días |
| 01-sep | 04-sep | 3 días |

Todas con `not_after` en NULL: **el servidor no las caduca nunca**. Hay 66 sesiones acumuladas, muchas con duración `00:00:00` — el rastro de entrar, ser expulsado y volver a entrar.

**Causa raíz:** `js/auth.js:239` trata cualquier pérdida de sesión como terminal:

```js
if (event === 'SIGNED_OUT' || ((event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && !session)) {
  handleSessionExpired();   // limpia estado y manda a #login
}
```

`handleSessionExpired()` no intenta recuperar nada: borra el estado y redirige. Un fallo de red al refrescar el token —justo lo que pasa cuando el teléfono despierta con conectividad dudosa— es indistinguible de un token revocado, y el usuario acaba en la pantalla de login con una sesión que el servidor sigue considerando válida.

**El arreglo tiene dos mitades:**
1. No expulsar ante un fallo recuperable; reintentar el refresco y solo rendirse ante un error de autenticación de verdad.
2. Pedirle al navegador **almacenamiento persistente** (`navigator.storage.persist()`), que es lo más parecido a "mantener la sesión iniciada" que existe como API real. Protege además el espejo offline en IndexedDB.

---

### Task D1: Clasificar la pérdida de sesión (lógica pura)

**Files:**
- Create: `js/sesion-recuperar.js`
- Test: `test/sesion-recuperar.test.mjs`

- [ ] **Step 1: Escribir el test que falla**

Crear `test/sesion-recuperar.test.mjs`:

```js
// test/sesion-recuperar.test.mjs
// Decide si una pérdida de sesión es recuperable. Puro: el estado de red y el
// evento entran como argumentos, nada se lee del entorno.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clasificarPerdidaSesion } from '../js/sesion-recuperar.js';

test('con sesión viva no hay nada que hacer', () => {
  assert.equal(clasificarPerdidaSesion({ event: 'TOKEN_REFRESHED', session: { access_token: 'x' } }), 'ok');
});

test('SIGNED_OUT es terminal: el usuario cerró sesión a propósito', () => {
  assert.equal(clasificarPerdidaSesion({ event: 'SIGNED_OUT', session: null, online: true }), 'terminal');
});

test('sin red es recuperable, nunca terminal', () => {
  // El caso del teléfono que despierta: el token no se pudo refrescar porque
  // no había conexión, no porque la sesión muriera.
  assert.equal(clasificarPerdidaSesion({ event: 'TOKEN_REFRESHED', session: null, online: false }), 'reintentar');
});

test('refresh token inválido es terminal', () => {
  const r = clasificarPerdidaSesion({
    event: 'TOKEN_REFRESHED', session: null, online: true,
    error: { message: 'Invalid Refresh Token: Refresh Token Not Found' },
  });
  assert.equal(r, 'terminal');
});

test('error de red con conexión aparente es recuperable', () => {
  const r = clasificarPerdidaSesion({
    event: 'TOKEN_REFRESHED', session: null, online: true,
    error: { message: 'Failed to fetch' },
  });
  assert.equal(r, 'reintentar');
});

test('error desconocido NO expulsa', () => {
  // Regla de sesgo: equivocarse hacia "reintentar" cuesta un intento fallido;
  // equivocarse hacia "terminal" saca al usuario de una sesión válida.
  const r = clasificarPerdidaSesion({
    event: 'TOKEN_REFRESHED', session: null, online: true,
    error: { message: 'algo rarísimo' },
  });
  assert.equal(r, 'reintentar');
});

test('sin error ni sesión, con red: recuperable', () => {
  assert.equal(clasificarPerdidaSesion({ event: 'USER_UPDATED', session: null, online: true }), 'reintentar');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/sesion-recuperar.test.mjs`
Expected: FAIL — `Cannot find module '../js/sesion-recuperar.js'`

- [ ] **Step 3: Implementar**

Crear `js/sesion-recuperar.js`:

```js
// js/sesion-recuperar.js — ¿esta pérdida de sesión es recuperable?
// Puro: el evento, la sesión, el error y el estado de red entran como
// argumentos. Carga doble: <script type="module"> (window.*) y ESM en node:test.

// clasificarPerdidaSesion({event, session, error, online}) → 'ok' | 'reintentar' | 'terminal'
//
// Existe porque js/auth.js trataba TODA pérdida de sesión como terminal y
// mandaba a #login. Un fallo de red al refrescar —lo normal cuando el teléfono
// despierta— era indistinguible de un token revocado, y el usuario acababa
// fuera con una sesión que el servidor seguía dando por buena (sus sesiones
// tienen not_after NULL: no caducan).
//
// Sesgo deliberado hacia 'reintentar': equivocarse ahí cuesta un intento
// fallido; equivocarse hacia 'terminal' expulsa a alguien con sesión válida.
function clasificarPerdidaSesion(ctx) {
  const c = ctx || {};
  if (c.session) return 'ok';
  // Cierre explícito del usuario: no hay nada que recuperar.
  if (c.event === 'SIGNED_OUT') return 'terminal';
  if (c.online === false) return 'reintentar';

  const msg = String((c.error && c.error.message) || '').toLowerCase();
  // Solo estos dicen "la credencial ya no sirve". Todo lo demás se reintenta.
  if (msg.includes('refresh token') || msg.includes('invalid token') ||
      msg.includes('jwt expired') || msg.includes('not found')) {
    return 'terminal';
  }
  return 'reintentar';
}

if (typeof window !== 'undefined') {
  window.clasificarPerdidaSesion = clasificarPerdidaSesion;
}
export { clasificarPerdidaSesion };
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test test/sesion-recuperar.test.mjs`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add js/sesion-recuperar.js test/sesion-recuperar.test.mjs
git commit -m "feat(sesion): clasificar si una pérdida de sesión es recuperable"
```

---

### Task D2: Reintentar antes de expulsar

**Files:**
- Modify: `js/auth.js`
- Modify: `index.html`
- Modify: `sw.js`

- [ ] **Step 1: Cargar el módulo**

En `index.html`, junto a los otros `<script type="module">`:

```html
    <script type="module" src="js/sesion-recuperar.js"></script>
```

En `sw.js`, al precache:

```js
  { url: 'js/sesion-recuperar.js', revision: SHELL_VERSION },
```

- [ ] **Step 2: Añadir la recuperación en `js/auth.js`**

Junto a `handleSessionExpired`:

```js
// intentarRecuperarSesion() — un refresco explícito antes de rendirse.
// autoRefreshToken corre con un temporizador que NO tickea mientras la PWA
// está congelada en segundo plano; al volver, el token puede estar vencido
// aunque el refresh token siga siendo válido. Un refresco a mano lo resuelve.
// Returns: true si hay sesión después de intentarlo.
async function intentarRecuperarSesion() {
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (data && data.session) return true;
    if (error) console.warn('refreshSession falló:', error.message);
  } catch (e) {
    console.warn('refreshSession lanzó:', e && e.message);
  }
  try {
    const { data } = await supabase.auth.getSession();
    return !!(data && data.session);
  } catch (_) { return false; }
}

// _reintentoPendiente — evita encolar N reintentos si llegan varios eventos.
var _reintentoPendiente = false;

// programarReintentoSesion() — vuelve a intentarlo cuando haya señales de que
// puede funcionar: al recuperar red, o al volver la app a primer plano.
function programarReintentoSesion() {
  if (_reintentoPendiente) return;
  _reintentoPendiente = true;

  async function intento() {
    if (document.visibilityState === 'hidden') return;
    const ok = await intentarRecuperarSesion();
    if (!ok) return;                 // sigue escuchando: puede que aún no haya red
    _reintentoPendiente = false;
    window.removeEventListener('online', intento);
    document.removeEventListener('visibilitychange', intento);
    console.info('sesión recuperada sin expulsar al usuario');
  }

  window.addEventListener('online', intento);
  document.addEventListener('visibilitychange', intento);
  intento();
}
```

- [ ] **Step 3: Cambiar el gate que expulsa**

En `setupAuthStateListener`, reemplazar la condición de la línea ~239:

```js
    if (event === 'SIGNED_OUT' || ((event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && !session)) {
```

por una que consulte al clasificador:

```js
    if (event === 'SIGNED_OUT' || ((event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && !session)) {
      var veredicto = (typeof clasificarPerdidaSesion === 'function')
        ? clasificarPerdidaSesion({ event: event, session: session, online: navigator.onLine })
        : 'terminal';   // sin el módulo, el comportamiento de antes
      if (veredicto === 'reintentar') {
        // No limpiar estado ni redirigir: la sesión puede seguir viva en el
        // servidor y el usuario no tiene por qué volver a entrar.
        console.warn('Pérdida de sesión recuperable — reintentando en segundo plano');
        programarReintentoSesion();
        return;
      }
      handleSessionExpired();
      return;
    }
```

> Conserva el resto del cuerpo del `if` original tal como esté (puede hacer más cosas antes de `handleSessionExpired`). Léelo antes de reescribirlo y no pierdas nada.

- [ ] **Step 4: Verificar en navegador**

Con el preview levantado y sesión iniciada en una cuenta de prueba:

1. Poner el navegador en modo offline (DevTools) y forzar `supabase.auth.refreshSession()` desde consola. **La app NO debe redirigir a `#login`.**
2. Volver a online → debe verse `sesión recuperada sin expulsar al usuario` en consola y la app seguir operativa.
3. Cerrar sesión con el botón de verdad → **sí** debe ir a `#login` (el camino terminal no se rompió).

- [ ] **Step 5: Commit**

```bash
git add js/auth.js index.html sw.js
git commit -m "fix(sesion): reintentar el refresco antes de mandar al login"
```

---

### Task D3: Pedir almacenamiento persistente

Lo más cercano a "mantener la sesión iniciada" que existe como API. Sin esto, el navegador puede desalojar `localStorage` (donde vive el token) y también IndexedDB (el espejo offline) cuando le falta espacio.

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Pedirlo en el arranque**

Junto al bloque que ya llama a `pushReconciliar()` en el `load`:

```html
    <script type="module">
      // Almacenamiento persistente: sin esto el navegador puede desalojar
      // localStorage (donde vive el token de sesión) e IndexedDB (el espejo
      // offline) bajo presión de espacio. No hay prompt en iOS: se concede o
      // no según heurísticas (app instalada, uso frecuente). Silencioso.
      window.addEventListener('load', function () {
        if (!navigator.storage || !navigator.storage.persist) return;
        navigator.storage.persisted().then(function (ya) {
          if (ya) return;
          return navigator.storage.persist().then(function (concedido) {
            console.info('almacenamiento persistente:', concedido ? 'concedido' : 'denegado');
          });
        }).catch(function (e) { console.warn('storage.persist:', e); });
      });
    </script>
```

- [ ] **Step 2: Verificar**

En consola del preview: `await navigator.storage.persisted()` → debería dar `true` tras recargar (en escritorio; en iOS puede denegarse, y eso no es un fallo del código).

- [ ] **Step 3: Suite, bump y commit**

`sw.js`: `SHELL_VERSION` a `v47`.

Run: `for f in test/*.test.mjs; do node --test "$f" || echo "FAIL $f"; done`
Expected: sin líneas `FAIL`.

```bash
git add index.html sw.js
git commit -m "feat(sesion): pedir almacenamiento persistente al navegador"
```

---

### Task D4: Limpiar las sesiones acumuladas — REQUIERE AL USUARIO

Hay **66 sesiones activas** en `auth.sessions` para el usuario, casi todas muertas del ciclo expulsión→re-login. No hacen daño, pero ensucian cualquier diagnóstico futuro.

- [ ] **Step 1: Proponer el SQL y NO ejecutarlo**

`CLAUDE.md` es explícito: *"Nunca apliques una migración sin que el usuario revise el SQL primero. Hay datos reales de 2 usuarios."* Esto además toca autenticación.

Mostrar al usuario, para que decida:

```sql
-- Cierra las sesiones sin usar en más de 30 días. La actual NO se toca.
delete from auth.sessions
where updated_at < now() - interval '30 days';
```

> **No ejecutar sin su visto bueno explícito.** Y si lo aprueba, hacerlo cuando él pueda volver a entrar sin molestia: un borrado de sesiones cierra la sesión en los dispositivos afectados.

---

# ETAPA E — Las dos cifras en "puedes gastar hoy"

## Qué cambia y qué no

**La base del cálculo NO cambia.** `js/safe-to-spend.js:62` seguirá usando:

```js
ingresoEstimado = Math.max(ingresoMes, baselineIngreso(personales, ymActual))
```

donde `baselineIngreso` promedia los **3 meses cerrados anteriores** (línea 146-157). Eso es lo que ya protege a la tarjeta del registro por lotes: si aún no anotaste los ingresos del mes, no cae a cero.

**Lo que se añade** es una segunda cifra que dice la verdad cruda: cuánto llevas registrado este mes, ingresos menos gastos. Cuando registras por lotes será negativa un rato, y **eso es correcto** — es justo la información que hoy falta.

Las dos variables ya existen dentro de la función (`ingresoMes` en la línea 60, `gastoAcumulado` en la 68); solo hay que exponer la resta.

---

### Task E1: Exponer el balance registrado

**Files:**
- Modify: `js/safe-to-spend.js`
- Test: `test/safe-to-spend.test.mjs`

- [ ] **Step 1: Escribir el test que falla**

Añadir en `test/safe-to-spend.test.mjs`, usando los helpers que el archivo ya define (`HOY` = 24 de junio de 2026, más `ing()` y `gas()`, que ya ponen `ambito` y `hogar_id`). **No construyas los objetos a mano:** la función filtra por `hogar_id == null`, no por `ambito`, y un objeto sin `hogar_id` pasa por accidente.

```js
test('desglose: balanceRegistrado = ingresos − gastos del mes, ya anotados', () => {
  const r = calcularSafeToSpend([ing(2100, '2026-06-05'), gas(700, '2026-06-10')], [], { hoy: HOY });
  assert.strictEqual(r.desglose.ingresoRegistrado, 2100);
  assert.strictEqual(r.desglose.balanceRegistrado, 1400);
});

test('desglose: sin ingresos registrados el balance sale negativo', () => {
  // El caso del registro por lotes: gastos de junio anotados, ingresos de
  // junio todavía no. El disponible se apoya en el promedio de meses cerrados
  // y NO colapsa; el balance registrado sí refleja la realidad cruda.
  const r = calcularSafeToSpend(
    [ing(1800, '2026-05-05'), ing(1800, '2026-04-05'), gas(200, '2026-06-02')],
    [], { hoy: HOY });
  assert.strictEqual(r.desglose.ingresoRegistrado, 0);
  assert.strictEqual(r.desglose.balanceRegistrado, -200);
  assert.ok(r.desglose.disponible > 0, 'el disponible NO colapsa: usa el promedio');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/safe-to-spend.test.mjs`
Expected: FAIL — `balanceRegistrado` es `undefined`.

- [ ] **Step 3: Implementar**

En `js/safe-to-spend.js`, en el objeto `desglose` que se arma alrededor de la línea 122, añadir dos campos:

```js
    // Cifra cruda, sin estimaciones: lo que de verdad hay anotado este mes.
    // Puede salir negativa mientras los ingresos no estén registrados —y debe
    // salir así: es la información que la tarjeta no daba.
    ingresoRegistrado: Math.round(ingresoMes),
    balanceRegistrado: Math.round(ingresoMes - gastoAcumulado),
```

> Ojo con el redondeo: el comentario de la línea 96 avisa de que el desglose se redondea a partir de los mismos valores que se muestran, para que la resta cuadre en pantalla. Estos dos campos son independientes de esa suma, así que redondearlos por separado no la rompe — pero **no los metas dentro de la identidad `disponible − yaGastado`**.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test test/safe-to-spend.test.mjs`
Expected: PASS, y el resto de tests del archivo intactos.

- [ ] **Step 5: Commit**

```bash
git add js/safe-to-spend.js test/safe-to-spend.test.mjs
git commit -m "feat(s2s): exponer el balance realmente registrado del mes"
```

---

### Task E2: Pintar la segunda cifra

**Files:**
- Modify: `views/dashboard.html`

- [ ] **Step 1: Añadir la línea al hero**

En el bloque que pinta la tarjeta normal (línea ~764), después del `<p class="dash-s2s-sub">` existente:

```js
      cont.innerHTML = `
        <div class="dash-s2s-card">
          <p class="dash-s2s-label">Puedes gastar hoy</p>
          <p class="dash-s2s-monto">${esc(montoHero(res.diario))}</p>
          <p class="dash-s2s-sub">Te quedan ${esc(formatMonto(res.restanteMes))} para ${dias}.</p>
          ${balanceHTML(res)}
          ${desgloseHTML(res, 'Te queda para el mes', res.restanteMes)}
        </div>`;
```

Y la función, junto a `desgloseHTML`:

```js
    // balanceHTML(res) — la cifra cruda bajo el estimado. El hero dice cuánto
    // PUEDES gastar según tu patrón de ingresos; esto dice cuánto llevas
    // anotado de verdad. Cuando el usuario registra ingresos por lotes, sale
    // negativa un rato — y ese es justo el dato que faltaba.
    function balanceHTML(res) {
      var d = res && res.desglose;
      if (!d || d.balanceRegistrado === undefined) return '';   // cálculo viejo: no pinta
      var negativo = d.balanceRegistrado < 0;
      var nota = d.ingresoRegistrado === 0
        ? 'aún no registras ingresos este mes'
        : 'ingresos menos gastos ya anotados';
      return '<p class="dash-s2s-balance' + (negativo ? ' dash-s2s-balance--neg' : '') + '">' +
        'Registrado: ' + esc(formatMonto(d.balanceRegistrado)) +
        ' <span class="dash-s2s-balance-nota">· ' + esc(nota) + '</span></p>';
    }
```

> El guard `=== undefined` sigue el mismo patrón que `desgloseHTML` ya usa para no romper con una versión vieja del cálculo cacheada por el service worker.

- [ ] **Step 2: Estilo**

Junto a `.dash-s2s-sub` (línea ~174):

```css
  .dash-s2s-balance {
    margin: var(--space-xs) 0 0;
    font-size: var(--font-size-sm);
    opacity: 0.92;
    font-variant-numeric: tabular-nums;
  }
  .dash-s2s-balance-nota { opacity: 0.8; }
```

> **No inventes un color para el negativo.** El hero va sobre un degradado y su contraste está validado por `test/contraste-s2s.test.mjs`; meter un rojo ahí puede romper ese test. Deja `.dash-s2s-balance--neg` sin color propio de momento y, si el usuario quiere distinguirlo, se decide después con el test delante.

- [ ] **Step 3: Verificar en navegador**

1. Con ingresos registrados este mes: la línea muestra un balance positivo.
2. Sin ingresos registrados: muestra el negativo y la nota "aún no registras ingresos este mes".
3. El hero de arriba **no cambia de valor** en ninguno de los dos casos.
4. Correr `node --test test/contraste-s2s.test.mjs` → `# fail 0`.

- [ ] **Step 4: Bump, suite y commit**

`sw.js`: `SHELL_VERSION` a `v48`.

Run: `for f in test/*.test.mjs; do node --test "$f" || echo "FAIL $f"; done`
Expected: sin líneas `FAIL`.

```bash
git add views/dashboard.html sw.js
git commit -m "feat(s2s): mostrar el balance registrado bajo el disponible"
```

---

# ETAPA F — Alias de contrapartes

## Alcance

177 movimientos traen contraparte, con **117 nombres distintos** (`RODOLFO MARTIN ANDERSON HUARCAYA`, `Karen R Gago O`, …).

**Dónde se aplica el alias:** en la cola de revisión, y en la nota de la transacción al confirmar. Como `#historial` muestra la nota, queda cubierto sin tocarlo.

**La memoria de categoría sale gratis.** `insertTransaccion` ya llama a `autocatLearnTokens(tokenize(fila.nota), fila.categoria_id)` (`js/db.js:158`). Si la nota lleva el alias, autocat aprende sobre el alias — que es corto y estable — en vez de sobre un nombre completo que nunca se repite. **No hay que tocar autocat.**

**Fuera de alcance, decidido:**
- **El push.** El Worker seguiría notificando con el nombre del banco. Consultar alias antes de notificar añade una query en el camino crítico del Worker, y el usuario no lo pidió.
- **Reescribir notas de transacciones ya guardadas.** `transacciones` no tiene columna `contraparte` (verificado en `information_schema`): la nota es texto congelado. Los alias aplican de aquí en adelante. Reescribir el pasado sería una migración de datos sobre movimientos reales, y no compensa.

---

### Task F1: Migración — REQUIERE REVISIÓN DEL USUARIO

**Files:**
- Create: `supabase/migrations/20260905_contraparte_alias.sql`

- [ ] **Step 1: Escribir la migración y PARAR**

```sql
-- Alias de contrapartes: el banco manda nombres completos ("RODOLFO MARTIN
-- ANDERSON HUARCAYA") que el usuario no reconoce de un vistazo. El alias se
-- guarda por nombre NORMALIZADO (minúsculas, sin tildes, espacios colapsados)
-- para que variantes del mismo nombre caigan en la misma fila.
create table if not exists public.contraparte_alias (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  nombre_norm text        not null,
  alias       text        not null check (length(trim(alias)) between 1 and 60),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, nombre_norm)
);

alter table public.contraparte_alias enable row level security;

create policy "alias propios" on public.contraparte_alias
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.contraparte_alias to authenticated;

create trigger trg_contraparte_alias_updated_at
  before update on public.contraparte_alias
  for each row execute function public.set_updated_at();
```

> **PARAR AQUÍ.** `CLAUDE.md`: *"Nunca apliques una migración sin que el usuario revise el SQL primero. Hay datos reales de 2 usuarios."* Enseñársela y esperar su visto bueno.
>
> Notas para esa revisión: el grant es **de tabla, no por columna** (CLAUDE.md avisa de que un grant por columna deja fuera las nuevas). `set_updated_at` ya existe y la usan otras tablas. La clave primaria compuesta hace que el alias sea por usuario: los dos miembros del hogar pueden ponerle nombres distintos a la misma persona.

- [ ] **Step 2: Aplicar con `apply_migration` (solo tras el visto bueno)**

No con el SQL Editor: `apply_migration` sí queda registrada en el ledger.

- [ ] **Step 3: Verificar por introspección, no por el ledger**

`CLAUDE.md` es tajante: *"Nunca afirmes que una migración está aplicada sin introspeccionar el esquema."*

```sql
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='contraparte_alias' order by ordinal_position;

select polname, polcmd from pg_policy
where polrelid = 'public.contraparte_alias'::regclass;
```

- [ ] **Step 4: Sumarla al contract test**

Añadir `contraparte_alias` a `supabase/tests/schema_contract_test.sql`, en el mismo commit — el propio test dice que si no se mantiene junto al código deja de proteger nada. Correrlo vía `execute_sql`: debe imprimir `ALL TESTS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260905_contraparte_alias.sql supabase/tests/schema_contract_test.sql
git commit -m "feat(alias): tabla contraparte_alias con RLS"
```

---

### Task F2: Resolver alias (lógica pura) y leerlos de la base

**Files:**
- Modify: `js/revisar-lote.js`
- Modify: `js/db.js`
- Test: `test/revisar-lote.test.mjs`

- [ ] **Step 1: Escribir el test que falla**

Añadir en `test/revisar-lote.test.mjs`, e importar `aliasDe` y la versión nueva de `notaDePendiente`:

```js
test('aliasDe: encuentra el alias normalizando el nombre', () => {
  const mapa = { 'rodolfo martin anderson huarcaya': 'Rodolfo (gimnasio)' };
  assert.equal(aliasDe('RODOLFO MARTIN ANDERSON HUARCAYA', mapa), 'Rodolfo (gimnasio)');
  assert.equal(aliasDe('  Rodolfo Martin Anderson Huarcaya  ', mapa), 'Rodolfo (gimnasio)');
});

test('aliasDe: sin alias devuelve null, no el nombre crudo', () => {
  assert.equal(aliasDe('ALGUIEN NUEVO', {}), null);
  assert.equal(aliasDe(null, {}), null);
  assert.equal(aliasDe('X', null), null);
});

test('notaDePendiente: el alias gana al nombre del banco', () => {
  const fila = { comercio: null, contraparte: 'KAREN R GAGO O', banco: 'bbva', raw_subject: 'x' };
  const mapa = { 'karen r gago o': 'Karen' };
  assert.equal(notaDePendiente(fila, { bbva: 'BBVA' }, mapa), 'Karen');
});

test('notaDePendiente: sin mapa se comporta igual que antes', () => {
  // Compatibilidad: los llamadores que no pasen alias no cambian de conducta.
  const fila = { comercio: 'LA PANERA CAFE', contraparte: null, banco: 'bbva', raw_subject: 'x' };
  assert.equal(notaDePendiente(fila, { bbva: 'BBVA' }), 'LA PANERA CAFE');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/revisar-lote.test.mjs`
Expected: FAIL — `aliasDe is not a function`.

- [ ] **Step 3: Implementar en `js/revisar-lote.js`**

```js
// normalizarContraparte(s) — clave estable para buscar el alias. Reutiliza la
// misma normalización que autocat (minúsculas, sin tildes, espacios
// colapsados) para que las variantes del banco caigan en la misma entrada.
function normalizarContraparte(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

// aliasDe(nombre, mapa) → alias | null. mapa: { nombre_norm: alias }.
function aliasDe(nombre, mapa) {
  if (!nombre || !mapa) return null;
  return mapa[normalizarContraparte(nombre)] || null;
}
```

Y `notaDePendiente` pasa a aceptar el mapa como tercer argumento:

```js
// notaDePendiente(fila, bancoLabel, aliases) — texto base de la transacción.
// El alias gana: es lo que el usuario reconoce, y además es sobre lo que
// autocat aprende (insertTransaccion tokeniza la nota), así que un alias corto
// y estable enseña mucho mejor que un nombre completo que nunca se repite.
function notaDePendiente(fila, bancoLabel, aliases) {
  if (!fila) return '';
  const labels = bancoLabel || {};
  const ali = aliasDe(fila.comercio, aliases) || aliasDe(fila.contraparte, aliases);
  if (ali) return ali;
  return fila.comercio || fila.contraparte || fila.raw_subject ||
    ('Correo ' + (labels[fila.banco] || fila.banco));
}
```

Añadir `normalizarContraparte` y `aliasDe` al bloque `window.*` y al `export`.

- [ ] **Step 4: Lectura y escritura en `js/db.js`**

```js
// getAliasContrapartes() — { nombre_norm: alias } del usuario. {} ante error:
// el alias es una comodidad, nunca debe romper la cola de revisión.
async function getAliasContrapartes() {
  try {
    const userId = _requireUserId();
    const { data, error } = await supabase
      .from('contraparte_alias')
      .select('nombre_norm, alias')
      .eq('user_id', userId);
    if (error) throw error;
    const mapa = {};
    (data || []).forEach((r) => { mapa[r.nombre_norm] = r.alias; });
    return mapa;
  } catch (err) {
    console.error('getAliasContrapartes():', err.message || err);
    return {};
  }
}

// setAliasContraparte(nombreRaw, alias) — alta o cambio. Alias vacío = borrar.
async function setAliasContraparte(nombreRaw, alias) {
  const userId = _requireUserId();
  const norm = normalizarContraparte(nombreRaw);
  if (!norm) throw new Error('nombre vacío');
  const limpio = String(alias || '').trim();
  if (!limpio) {
    const { error } = await supabase.from('contraparte_alias')
      .delete().eq('user_id', userId).eq('nombre_norm', norm);
    if (error) throw error;
    return null;
  }
  const { error } = await supabase.from('contraparte_alias')
    .upsert({ user_id: userId, nombre_norm: norm, alias: limpio, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,nombre_norm' });
  if (error) throw error;
  return limpio;
}
```

- [ ] **Step 5: Correr el test y la suite**

Run: `node --test test/revisar-lote.test.mjs`
Expected: PASS.

Run: `for f in test/*.test.mjs; do node --test "$f" || echo "FAIL $f"; done`
Expected: sin líneas `FAIL`.

- [ ] **Step 6: Commit**

```bash
git add js/revisar-lote.js js/db.js test/revisar-lote.test.mjs
git commit -m "feat(alias): resolver alias de contraparte y persistirlo"
```

---

### Task F3: Ponerle alias desde la cola de revisión

**Files:**
- Modify: `views/revisar.html`
- Modify: `index.html`
- Modify: `sw.js`

- [ ] **Step 1: Cargar el mapa en `init()`**

En `views/revisar.html`, junto a donde se carga `_learned`:

```js
      var _aliases = {};
      if (typeof getAliasContrapartes === 'function') _aliases = await getAliasContrapartes();
```

Declarar `_aliases` con las otras variables de módulo de la vista (junto a `_learned`), no dentro de `init`.

- [ ] **Step 2: Mostrar el alias en la card**

En `cardHTML`, donde hoy se calcula el texto visible:

```js
    var textoCrudo = p.comercio || p.contraparte || '';
    var ali = (typeof aliasDe === 'function') ? aliasDe(textoCrudo, _aliases) : null;
    var texto = ali || textoCrudo;
```

Y añadir un botón para editarlo, junto al nombre — solo si hay nombre crudo que aliasar:

```js
    var btnAlias = textoCrudo
      ? '<button type="button" class="rev-alias-btn" data-rev-alias="' + i + '" ' +
        'aria-label="Ponerle un nombre a ' + esc(textoCrudo) + '">✎</button>'
      : '';
```

Insertar `btnAlias` junto al `<p class="rev-comercio">`. Estilo mínimo:

```css
  .rev-alias-btn { background: none; border: none; cursor: pointer;
    color: var(--text-secondary); font-size: .9rem; padding: 0 .25rem; }
```

- [ ] **Step 3: Cablear la edición**

En el listener de clicks de la lista, **antes** del handler de expandir (mismo motivo que el checkbox: el nombre vive dentro del área que expande la card):

```js
        var aliasBtn = ev.target.closest('[data-rev-alias]');
        if (aliasBtn) {
          ev.stopPropagation();
          editarAlias(Number(aliasBtn.getAttribute('data-rev-alias')));
          return;
        }
```

Y la función:

```js
  // editarAlias(i) — nombre propio para la contraparte de la fila i.
  // Se guarda por nombre normalizado, así que aplica a todos los movimientos
  // de esa misma persona, pasados y futuros, en la cola.
  async function editarAlias(i) {
    var p = _filas[i];
    if (!p) return;
    var crudo = p.comercio || p.contraparte || '';
    if (!crudo) return;
    var actual = aliasDe(crudo, _aliases) || '';
    var nuevo = window.prompt('Nombre para "' + crudo + '" (vacío para quitarlo):', actual);
    if (nuevo === null) return;            // canceló
    try {
      var guardado = await setAliasContraparte(crudo, nuevo);
      var clave = normalizarContraparte(crudo);
      if (guardado) _aliases[clave] = guardado; else delete _aliases[clave];
      await init();                        // repinta la lista con el alias nuevo
    } catch (e) {
      console.error('setAliasContraparte falló:', e);
      mostrarError(i, 'No se pudo guardar el nombre. Reintenta.');
    }
  }
```

> Confirma con `grep -n "function init\|function mostrarError" views/revisar.html` que esos nombres son los reales antes de escribir esto, y que llamar a `init()` de nuevo es seguro (que no duplique listeners — el de la lista se engancha una vez sobre `listaEl`, que sobrevive al repintado).

- [ ] **Step 4: Que el alias llegue a la nota**

Los dos sitios que construyen la nota tienen que pasar el mapa:

En `confirmar(i, btn)`:
```js
    var base = notaDePendiente(p, BANCO_LABEL, _aliases);
```

En `confirmarLote`:
```js
      items.push({ fila: f, categoria_id: cat, nota: notaDePendiente(f, BANCO_LABEL, _aliases) });
```

> Con esto la memoria de categoría queda hecha: `insertTransaccion` tokeniza la nota para `autocatLearnTokens`, así que a partir de ahora aprende sobre el alias.

- [ ] **Step 5: Que la sugerencia de categoría use el alias**

En `cardHTML`, la llamada a `sugerirCategoria` debe recibir el texto ya aliasado (la variable `texto` del Step 2), no el crudo. Verifica que así sea tras el cambio.

- [ ] **Step 6: Añadir al guard de dependencias**

En la lista `faltan` de la IIFE: `'getAliasContrapartes'`, `'setAliasContraparte'`, `'aliasDe'`, `'normalizarContraparte'`.

- [ ] **Step 7: Verificar en navegador**

1. Tocar ✎ en una fila con contraparte → prompt con el nombre crudo.
2. Guardar "Karen" → la card muestra "Karen", y **todas** las filas de esa misma persona también.
3. Confirmar esa fila → en `#historial` la transacción aparece con "Karen".
4. Un segundo movimiento de la misma persona debe llegar con categoría sugerida tras haber confirmado el primero.
5. Vaciar el alias → vuelve el nombre del banco.

- [ ] **Step 8: Bump, suite y commit**

`sw.js`: `SHELL_VERSION` a `v49`.

Run: `for f in test/*.test.mjs; do node --test "$f" || echo "FAIL $f"; done`
Expected: sin líneas `FAIL`.

```bash
git add views/revisar.html index.html sw.js
git commit -m "feat(alias): ponerle nombre a una contraparte desde la cola"
```

---

## Cierre

- [ ] Un PR por etapa, en orden D → E → F. Sin push hasta revisión.
- [ ] `SHELL_VERSION` encadenado: D → `v47`, E → `v48`, F → `v49`. Si alguna etapa se salta o se reordena, ajustar para que no se repita una versión ya publicada (la última en producción es `v46`).
- [ ] La migración de F1 y el borrado de sesiones de D4 **no se ejecutan sin el visto bueno del usuario**.
