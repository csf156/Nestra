# % de ahorro configurable y transparencia del peso de metas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el usuario defina en Preferencias qué % de su dinero disponible se reserva para metas (hoy fijo en 50%), que ese valor sea insumo explícito del cálculo, y que el reparto del ahorro entre metas deje de ser una caja negra — explicándolo en `#metas` sin tocar la fórmula.

**Architecture:** PWA vanilla sin build. Una columna nueva en `profiles` con default 50 (= comportamiento actual, cero cambio al desplegar). El % se cachea en localStorage y se persiste con `updateProfile`, siguiendo el patrón ya existente de `js/moneda.js`. `calcularSafeToSpend` lo recibe como opción (`{ hoy, pctAhorro }`) manteniéndose pura. `distribuir_ahorro` (el RPC de reparto) **no se toca**.

**Tech Stack:** JS vanilla (globals, sin módulos en vistas), Supabase/PostgREST, `node --test` para las funciones puras.

**Testing:** `js/safe-to-spend.js` sí tiene runner real (`node --test "test/*.test.mjs"`, 280 tests hoy) → TDD de verdad en la Task 3. Las vistas no tienen harness: se verifican en preview con la **cuenta throwaway** (memoria `nestra-v2-test-account`), nunca la cuenta ni el hogar reales.

---

## Contexto imprescindible (leer antes de empezar)

La fórmula de reparto (`distribuir_ahorro`, introspeccionada, NO se modifica):

```
peso = importancia × f_horizonte × f_urgencia × f_rezago
  importancia  1–5, DEFAULT 3, no expuesta en la UI
  f_horizonte  corto=3, mediano=2, largo=1
  f_urgencia   (fecha_limite − hoy) <7d → 3;  <30d → 2;  resto → 1
  f_rezago     max(0.2, min(1, 1 − progreso/objetivo))
```

`metas.categoria_id` **existe y la UI la pide, pero el reparto la ignora**. Los
pesos no se "recalculan": se computan de cero en cada aporte y el reparto es
relativo (`asignado = total × peso / suma_pesos`). El fondo de emergencia pesa
solo `importancia` y recibe el **residuo** (`total − repartido`).

---

## File Structure

- `supabase/migrations/20260718_pct_ahorro_objetivo.sql` — **crear**: columna + CHECK.
- `supabase/tests/schema_contract_test.sql` — **modificar**: cubrir la columna.
- `js/ahorro-pct.js` — **crear**: preferencia (cache + set + cacheDesdePerfil), clon del patrón de `js/moneda.js`. Archivo propio en vez de meterlo en `db.js`: una responsabilidad, y el precache del SW ya lista los `js/*` uno a uno.
- `js/safe-to-spend.js` — **modificar**: `pctAhorro` como insumo; techo parametrizado.
- `test/safe-to-spend.test.mjs` — **modificar**: tests del techo configurable.
- `js/router.js` — **modificar**: cachear el % desde el perfil en boot (junto a la moneda).
- `sw.js` — **modificar**: precache del js nuevo + bump `SHELL_VERSION`.
- `index.html` — **modificar**: `<script>` del js nuevo.
- `views/configuracion.html` — **modificar**: control en Preferencias.
- `views/dashboard.html` — **modificar**: nombrar el tope en el desglose.
- `views/metas.html` — **modificar**: desplegable explicativo del reparto.

---

## Task 1: Migración — `profiles.pct_ahorro_objetivo`

**Files:**
- Create: `supabase/migrations/20260718_pct_ahorro_objetivo.sql`
- Modify: `supabase/tests/schema_contract_test.sql`

- [ ] **Step 1: Escribir el SQL**

```sql
-- =====================================================================
-- Nestra — Migración: pct_ahorro_objetivo en profiles
-- ---------------------------------------------------------------------
-- Qué % del dinero disponible (ingreso estimado − gastos fijos) se reserva
-- para metas en el hero del dashboard. Hasta ahora estaba hardcodeado en 50
-- (js/safe-to-spend.js). DEFAULT 50 a propósito: ningún usuario existente
-- cambia de comportamiento al desplegar.
--
-- Rango 0–80: el 0 es válido (no reservar nada). El tope de 80 no es una
-- regla financiera sino una guarda de usabilidad — evita dejar el disponible
-- en casi cero por un dedazo.
--
-- NO se reutiliza profiles.aporte_mensual_esperado: existe pero no se usa en
-- ningún sitio (verificado por grep en js/ y views/), y es un MONTO, no un
-- porcentaje; reaprovecharlo dejaría un nombre que miente.
--
-- Idempotente.
-- =====================================================================

alter table public.profiles
  add column if not exists pct_ahorro_objetivo integer not null default 50;

alter table public.profiles
  drop constraint if exists profiles_pct_ahorro_objetivo_rango;

alter table public.profiles
  add constraint profiles_pct_ahorro_objetivo_rango
  check (pct_ahorro_objetivo >= 0 and pct_ahorro_objetivo <= 80);
```

- [ ] **Step 2: Que el usuario revise el SQL antes de aplicar**

Regla de CLAUDE.md: nunca aplicar una migración sin revisión previa; hay datos
reales de 2 usuarios. Mostrar el SQL y esperar OK explícito. NO aplicar por
iniciativa propia.

- [ ] **Step 3: Aplicar con `apply_migration`**

Tool `mcp__supabase__apply_migration` (queda registrada), NO el SQL Editor.
Nombre: `pct_ahorro_objetivo`.

- [ ] **Step 4: Verificar por introspección (no confiar en el ledger)**

```sql
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema='public' and table_name='profiles' and column_name='pct_ahorro_objetivo';

select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid='public.profiles'::regclass and conname='profiles_pct_ahorro_objetivo_rango';

select grantee, privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name='profiles' and grantee='authenticated'
  and privilege_type in ('SELECT','UPDATE');
```
Esperado: columna `integer`, default `50`, `NOT NULL`; el CHECK con el rango
0–80; grants SELECT y UPDATE **a nivel tabla** (si fueran por columna, la nueva
no quedaría concedida).

- [ ] **Step 5: Verificar que PostgREST la ve**

```bash
curl -sS "https://ombnhxueclqfeyjzhroz.supabase.co/rest/v1/profiles?select=pct_ahorro_objetivo&limit=1" \
  -H "apikey: sb_publishable_l-TcpyiU3t3JZD_0_tOHkQ_Ovx0Z70c" \
  -H "Authorization: Bearer sb_publishable_l-TcpyiU3t3JZD_0_tOHkQ_Ovx0Z70c"
```
Esperado: JSON (o `[]` por RLS con anon). Un `400 column ... does not exist`
significa caché de esquema rancia → reintentar a los pocos segundos.

- [ ] **Step 6: Sumar la columna al contract test**

En `supabase/tests/schema_contract_test.sql`, en el bloque de columnas frágiles
(el array `v_cols`), añadir una fila siguiendo el formato exacto de las que ya
están:

```sql
    array['profiles','pct_ahorro_objetivo','js/ahorro-pct.js + safe-to-spend (techo de reserva); si falta, el techo cae a 50 en silencio']
```

- [ ] **Step 7: Correr el contract test completo**

Pegar el contenido de `supabase/tests/schema_contract_test.sql` en
`mcp__supabase__execute_sql` (es solo lectura). Esperado: `ALL TESTS PASSED`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260718_pct_ahorro_objetivo.sql supabase/tests/schema_contract_test.sql
git commit -m "feat(db): pct_ahorro_objetivo en profiles (default 50)"
```

---

## Task 2: Módulo de preferencia `js/ahorro-pct.js`

**Files:**
- Create: `js/ahorro-pct.js`
- Modify: `index.html`, `sw.js`, `js/router.js`

- [ ] **Step 1: Crear el módulo**

Clon deliberado del patrón de `js/moneda.js` (cache localStorage + persistencia
en perfil + evento). Crear `js/ahorro-pct.js`:

```javascript
// ahorro-pct.js — % del disponible que se reserva para metas. Script global
// clásico (como moneda.js). Resolución sync desde cache localStorage; default
// 50 (= el valor que estuvo hardcodeado en safe-to-spend.js hasta 2026-07-18,
// así nadie cambia de comportamiento al desplegar).
(function () {
  var KEY = 'nestra-pct-ahorro';
  var DEFAULT = 50;
  var MIN = 0, MAX = 80;   // mismo rango que el CHECK de la base

  // normalizarPct(v) → entero 0–80, o null si no es utilizable. Se usa tanto al
  // leer del cache (que puede traer basura) como al validar lo que teclea el
  // usuario, para no duplicar la regla.
  function normalizarPct(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return null;
    n = Math.round(n);
    if (n < MIN || n > MAX) return null;
    return n;
  }

  function getPctAhorro() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    var n = normalizarPct(raw);
    return n == null ? DEFAULT : n;
  }

  // setPctAhorro(pct) → persiste cache + perfil + evento para re-render.
  // Devuelve el valor aplicado, o null si el input no era válido (el llamador
  // decide qué mensaje mostrar; aquí no se inventa un valor).
  async function setPctAhorro(pct) {
    var n = normalizarPct(pct);
    if (n == null) return null;
    try { localStorage.setItem(KEY, String(n)); } catch (e) {}
    if (typeof updateProfile === 'function') {
      try { await updateProfile({ pct_ahorro_objetivo: n }); } catch (e) {}
    }
    window.dispatchEvent(new CustomEvent('nestra:pct-ahorro-cambiado', { detail: { pct: n } }));
    return n;
  }

  // cachePctAhorroDesdePerfil(perfil) → sincroniza cache desde el perfil del boot.
  function cachePctAhorroDesdePerfil(perfil) {
    if (!perfil) return;
    var n = normalizarPct(perfil.pct_ahorro_objetivo);
    if (n == null) return;
    try { localStorage.setItem(KEY, String(n)); } catch (e) {}
  }

  window.PCT_AHORRO_MIN = MIN;
  window.PCT_AHORRO_MAX = MAX;
  window.PCT_AHORRO_DEFAULT = DEFAULT;
  window.normalizarPctAhorro = normalizarPct;
  window.getPctAhorro = getPctAhorro;
  window.setPctAhorro = setPctAhorro;
  window.cachePctAhorroDesdePerfil = cachePctAhorroDesdePerfil;
})();
```

- [ ] **Step 2: Cargar el script**

En `index.html`, junto a los otros `js/*` del shell (buscar la línea de
`js/moneda.js` y añadir justo después, para que quede al lado de su gemelo):

```html
    <script src="js/ahorro-pct.js"></script>
```

- [ ] **Step 3: Precachear en el SW y bumpear la versión**

En `sw.js`, añadir en el array de `precacheAndRoute`, junto a `js/moneda.js`:

```javascript
  { url: 'js/ahorro-pct.js', revision: SHELL_VERSION },
```

Y subir `SHELL_VERSION` a la siguiente (leer el valor actual del archivo y
subirlo en uno; a fecha de este plan está en `v33`). El bump es **obligatorio**:
se añade un archivo al precache.

- [ ] **Step 4: Cachear desde el perfil en el boot**

En `js/router.js`, junto a la línea que ya hace lo mismo con la moneda
(`if (typeof cacheMonedaDesdePerfil === 'function') cacheMonedaDesdePerfil(perfil);`),
añadir inmediatamente después:

```javascript
  if (typeof cachePctAhorroDesdePerfil === 'function') cachePctAhorroDesdePerfil(perfil);
```

- [ ] **Step 5: Verificar en preview**

Preview `nestra` :5050, sesión de la cuenta throwaway. En consola:
```javascript
getPctAhorro()                    // 50 (default, aún sin tocar nada)
await setPctAhorro(30)            // 30
getPctAhorro()                    // 30
await setPctAhorro(999)           // null (fuera de rango, no persiste)
getPctAhorro()                    // 30 (sin cambios)
```
Y confirmar en base que el perfil de la cuenta throwaway quedó en 30.

- [ ] **Step 6: Commit**

```bash
git add js/ahorro-pct.js index.html sw.js js/router.js
git commit -m "feat(ahorro): módulo de preferencia del % de ahorro"
```

---

## Task 3: `pctAhorro` como insumo del cálculo (TDD)

**Files:**
- Modify: `test/safe-to-spend.test.mjs` (primero), `js/safe-to-spend.js`

Aquí sí hay runner real: **escribir los tests antes y verlos fallar**.

- [ ] **Step 1: Añadir los tests (deben fallar)**

Añadir al final de `test/safe-to-spend.test.mjs`. Usa los helpers ya existentes
en ese archivo (`ing`, `gas`, `meta`, `HOY`):

```javascript

// ── Techo de reserva configurable (pctAhorro) ────────────────────────────
// Antes estaba hardcodeado en 50%. Ahora entra como insumo explícito, igual
// que el ingreso: la función sigue siendo pura y el % vive en el perfil.

test('pctAhorro explícito cambia el techo de la reserva', () => {
  // Meta que exige mucho más de lo que cabe, para que el techo mande siempre.
  const metas = [meta({ monto_objetivo: 100000, fecha_limite: '2026-07-10' })];
  const txs = [ing(1000, '2026-06-03')];

  const con20 = calcularSafeToSpend(txs, metas, { hoy: HOY, pctAhorro: 20 });
  const con50 = calcularSafeToSpend(txs, metas, { hoy: HOY, pctAhorro: 50 });

  assert.strictEqual(con20.desglose.ahorroMetas, 200); // 20% de 1000
  assert.strictEqual(con50.desglose.ahorroMetas, 500); // 50% de 1000
});

test('pctAhorro = 0 → no se reserva nada para metas (caso límite válido)', () => {
  const metas = [meta({ monto_objetivo: 100000, fecha_limite: '2026-07-10' })];
  const out = calcularSafeToSpend([ing(1000, '2026-06-03')], metas, { hoy: HOY, pctAhorro: 0 });
  assert.strictEqual(out.desglose.ahorroMetas, 0);
  assert.strictEqual(out.desglose.disponible, 1000); // ingreso − fijos(0) − metas(0)
});

test('pctAhorro ausente o inválido cae a 50 (comportamiento previo)', () => {
  const metas = [meta({ monto_objetivo: 100000, fecha_limite: '2026-07-10' })];
  const txs = [ing(1000, '2026-06-03')];
  const esperado = 500; // 50% de 1000

  for (const opts of [
    { hoy: HOY },                      // ausente
    { hoy: HOY, pctAhorro: null },
    { hoy: HOY, pctAhorro: 'treinta' },
    { hoy: HOY, pctAhorro: -10 },      // fuera de rango
    { hoy: HOY, pctAhorro: 150 },      // fuera de rango
  ]) {
    const out = calcularSafeToSpend(txs, metas, opts);
    assert.strictEqual(out.desglose.ahorroMetas, esperado,
      'falló con opts=' + JSON.stringify(opts));
  }
});

test('pctAhorro no altera una meta holgada que ya cabía bajo el techo', () => {
  // La meta por defecto exige poco; con 2100 de ingreso cabe con cualquier pct
  // razonable, así que bajar el techo al 20% no debe recortarla.
  const out = calcularSafeToSpend([ing(2100, '2026-06-03')], [meta()], { hoy: HOY, pctAhorro: 20 });
  assert.strictEqual(out.estado, 'ok');
  assert.strictEqual(out.diario, 294);          // idéntico al test original
  assert.strictEqual(out.desglose.metasFueraDeRitmo.length, 0);
});
```

- [ ] **Step 2: Correr y confirmar que fallan (rojo)**

```bash
node --test test/safe-to-spend.test.mjs
```
Esperado: los 26 existentes pasan, los 4 nuevos fallan. Si alguno de los nuevos
pasara ya, el test no está probando nada — revisar antes de seguir.

- [ ] **Step 3: Implementar**

En `js/safe-to-spend.js`, dentro de `calcularSafeToSpend`, sustituir la línea
del techo fijo (hoy `const techoMetas = Math.max(0, ingresoEstimado - fijosComprometidos) * 0.5;`)
por:

```javascript
  // El % lo define el usuario en Preferencias (profiles.pct_ahorro_objetivo).
  // Entra como insumo explícito para que la función siga siendo pura. Ausente o
  // inválido → 50, que es el valor que estuvo hardcodeado aquí hasta 2026-07-18.
  const PCT_DEFAULT = 50;
  let pct = Number(opts && opts.pctAhorro);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) pct = PCT_DEFAULT;
  const techoMetas = Math.max(0, ingresoEstimado - fijosComprometidos) * (pct / 100);
```

Nota sobre el rango: aquí se acepta hasta 100 (no 80) a propósito. El 80 es la
guarda de *usabilidad* del formulario y del CHECK; esta función es pura y debe
tolerar cualquier valor sensato que le llegue sin inventar comportamiento. Solo
rechaza lo que no es un porcentaje.

Actualizar también el comentario de cabecera de la función para mencionar
`pctAhorro` entre las opciones.

- [ ] **Step 4: Correr los tests (verde)**

```bash
node --test test/safe-to-spend.test.mjs
```
Esperado: 30 pass, 0 fail.

- [ ] **Step 5: Suite completa (sin regresiones)**

```bash
node --test "test/*.test.mjs"
```
Esperado: 284 pass, 0 fail. (Hoy son 280; +4 nuevos.) Ojo al comando: usar el
glob entre comillas — `node --test test/` falla con MODULE_NOT_FOUND en Windows.

- [ ] **Step 6: Conectar la parte impura**

En la misma `js/safe-to-spend.js`, en `cargarSafeToSpend()` (la única función
impura del módulo), pasar el % leído de la preferencia:

```javascript
    const pctAhorro = (typeof window !== 'undefined' && typeof window.getPctAhorro === 'function')
      ? window.getPctAhorro() : undefined;
    return calcularSafeToSpend(transacciones || [], metas || [], { hoy, pctAhorro });
```

- [ ] **Step 7: Commit**

```bash
git add js/safe-to-spend.js test/safe-to-spend.test.mjs
git commit -m "feat(ahorro): el techo de reserva usa el % del perfil"
```

---

## Task 4: Control en Preferencias

**Files:**
- Modify: `views/configuracion.html`

- [ ] **Step 1: Markup de la fila**

En la sección **S3: Preferencias**, dentro de `.cfg-pref-lista`, añadir una fila
tras la de "Moneda principal" (leer el bloque primero; las filas existentes usan
`.cfg-pref-row` / `.cfg-pref-nombre`):

```html
        <div class="cfg-pref-row">
          <span class="cfg-pref-nombre">Ahorro para metas</span>
          <span class="cfg-pct-wrap">
            <input id="cfgPctAhorro" class="cfg-input cfg-pct-input" type="number"
                   inputmode="numeric" min="0" max="80" step="1"
                   aria-describedby="cfgPctAhorroHint">
            <span class="cfg-pct-signo" aria-hidden="true">%</span>
          </span>
        </div>
        <p class="cfg-pref-hint" id="cfgPctAhorroHint">
          Del dinero que te queda cada mes tras los gastos fijos, cuánto se
          reserva para tus metas. Afecta al número de «Puedes gastar hoy».
        </p>
```

`inputmode="numeric"` (no `decimal`): es un entero. Coherente con `recDia`.

- [ ] **Step 2: CSS**

Añadir junto a los estilos `.cfg-pref-*` existentes:

```css
    .cfg-pct-wrap { display: inline-flex; align-items: center; gap: 4px; }
    .cfg-pct-input { width: 72px; text-align: right; }
    .cfg-pct-signo { color: var(--text-secondary); }
    .cfg-pref-hint { color: var(--text-secondary); font-size: var(--font-size-xs);
      margin: 0 0 var(--space-sm); }
```

- [ ] **Step 3: Wiring**

Añadir un IIFE junto a los otros inicializadores de la vista (p. ej. cerca de
donde se inicializa el toggle de push). Guarda de versión incluida: si el SW
sirve un `js/` viejo sin el módulo, la fila se oculta en vez de romper.

```javascript
    (function initPctAhorro() {
      var input = document.getElementById('cfgPctAhorro');
      var hint = document.getElementById('cfgPctAhorroHint');
      if (!input) return;
      // Shell viejo sin js/ahorro-pct.js → ocultar en vez de mostrar un control muerto.
      if (typeof getPctAhorro !== 'function' || typeof setPctAhorro !== 'function') {
        var row = input.closest('.cfg-pref-row');
        if (row) row.style.display = 'none';
        if (hint) hint.style.display = 'none';
        return;
      }
      input.value = getPctAhorro();

      // Se guarda en 'change' (no en 'input'): en 'input' cada tecla dispararía
      // un update y un valor a medio teclear ("3" camino de "30") se persistiría.
      input.addEventListener('change', async function () {
        var aplicado = await setPctAhorro(input.value);
        if (aplicado == null) {
          input.value = getPctAhorro();   // revertir al último válido
          if (typeof mostrarToast === 'function') {
            mostrarToast('Usa un número entre ' + window.PCT_AHORRO_MIN + ' y ' + window.PCT_AHORRO_MAX + '.', 3500);
          }
          return;
        }
        input.value = aplicado;
        if (typeof mostrarToast === 'function') mostrarToast('Ahorro para metas: ' + aplicado + '%', 2500);
      });
    })();
```

- [ ] **Step 4: Verificar en preview**

Cuenta throwaway, `#configuracion` → Preferencias:
1. El campo muestra el valor actual (50 al principio).
2. Cambiar a 30 → toast de confirmación; recargar → sigue en 30; en base, el
   perfil de la cuenta throwaway tiene `pct_ahorro_objetivo = 30`.
3. Escribir 999 → revierte al último válido y avisa; la base no cambia.
4. Escribir 0 → se acepta (es válido).

- [ ] **Step 5: Commit**

```bash
git add views/configuracion.html
git commit -m "feat(config): ajuste del % de ahorro en Preferencias"
```

---

## Task 5: Nombrar el tope en el desglose del dashboard

**Files:**
- Modify: `views/dashboard.html`

- [ ] **Step 1: Mostrar el % aplicado en la fila de metas**

En `desgloseHTML()`, la fila de metas se genera hoy con
`${fila('− Ahorro para tus metas', d.ahorroMetas)}`. Cambiarla para que nombre
el tope vigente, leyéndolo de la preferencia (no hardcodear 50):

```javascript
      const pct = (typeof getPctAhorro === 'function') ? getPctAhorro() : 50;
```
(declararlo al inicio de `desgloseHTML`, junto a `const d = res.desglose;`)

y sustituir esa fila por:

```javascript
            ${fila('− Ahorro para tus metas (tope ' + pct + '%)', d.ahorroMetas)}
```

- [ ] **Step 2: Actualizar la nota al pie**

En el `<p class="dash-s2s-nota">` final, la frase sobre el ahorro dice hoy «El
ahorro para tus metas nunca supera la mitad de lo que te queda». Ya no es «la
mitad» fija — sustituirla por:

```javascript
            El <strong>ahorro para tus metas</strong> nunca supera el ${pct}% de lo que te
            queda; lo ajustas en Configuración → Preferencias.
```

- [ ] **Step 3: Verificar en preview**

Con el % en 30 (de la Task 4) y datos que fuercen el tope (misma receta que en
el PR anterior: ingreso modesto + meta grande con fecha cercana, en la cuenta
throwaway): el desglose debe decir «− Ahorro para tus metas (tope 30%)», el
importe debe ser el 30% de (ingreso − fijos), y la nota debe mencionar 30%.
Cambiar el % en Preferencias y volver al dashboard → el desglose refleja el
valor nuevo.

- [ ] **Step 4: Commit**

```bash
git add views/dashboard.html
git commit -m "feat(dashboard): el desglose nombra el tope de ahorro vigente"
```

---

## Task 6: Explicar el reparto en #metas

**Files:**
- Modify: `views/metas.html`

- [ ] **Step 1: Markup del desplegable**

Colocarlo bajo la cabecera de la vista, antes de la lista de metas (leer la
estructura primero). Cerrado por defecto, mismo patrón que el desglose del
dashboard:

```html
  <details class="metas-explica">
    <summary>¿Cómo se reparte mi ahorro?</summary>
    <div class="metas-explica-body">
      <p>Cuando registras un ahorro, se reparte entre tus metas en curso. Cada
         meta recibe una parte según su <strong>peso</strong>, y el peso sube cuando:</p>
      <ul>
        <li>el <strong>horizonte</strong> es corto (corto pesa más que mediano, y mediano más que largo);</li>
        <li>la <strong>fecha límite</strong> está cerca (menos de 30 días pesa más; menos de 7, todavía más);</li>
        <li>la meta va <strong>atrasada</strong> respecto a su objetivo.</li>
      </ul>
      <p>Si a una meta le falta menos de lo que le tocaría, solo recibe lo que le
         falta. Lo que sobra va a tu <strong>fondo de emergencia</strong>, que
         también participa del reparto.</p>
      <p class="metas-explica-nota">La <strong>categoría</strong> de la meta no
         afecta el reparto: es solo una etiqueta para organizarte.</p>
    </div>
  </details>
```

Ese último párrafo es el motivo de esta tarea: la UI pide una categoría al
crear la meta, lo que induce a creer que influye en el reparto. No decirlo
mantendría el malentendido.

- [ ] **Step 2: CSS**

Usar los tokens reales del tema (`--bg-light-secondary`, `--text-dark`,
`--text-secondary`, `--border-light`, `--space-*`, `--radius-*`). NO inventar
tokens: `--bg-surface`, `--text-primary`, `--bg-subtle` y `--font-size-md` **no
existen** en este proyecto y caen a fallbacks blancos que rompen el tema oscuro.

```css
  .metas-explica { margin: 0 0 var(--space-lg); border: 1px solid var(--border-light);
    border-radius: var(--radius-md); background: var(--bg-light-secondary); }
  .metas-explica > summary { cursor: pointer; padding: var(--space-sm) var(--space-md);
    color: var(--text-dark); font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold); min-height: 44px;
    display: flex; align-items: center; }
  .metas-explica-body { padding: 0 var(--space-md) var(--space-md);
    color: var(--text-secondary); font-size: var(--font-size-sm); }
  .metas-explica-body p { margin: 0 0 var(--space-sm); }
  .metas-explica-body ul { margin: 0 0 var(--space-sm); padding-left: var(--space-lg); }
  .metas-explica-body li { margin-bottom: 4px; }
  .metas-explica-nota { color: var(--text-dark); }
```

- [ ] **Step 3: Verificar en preview**

Viewport móvil (375×812) y escritorio:
1. Aparece cerrado; abre y cierra al tocar.
2. El texto se lee (contraste correcto sobre el tema oscuro; comprobar que
   ningún fondo sale blanco).
3. El área táctil del summary llega a 44px de alto.

- [ ] **Step 4: Commit**

```bash
git add views/metas.html
git commit -m "docs(metas): explica cómo se reparte el ahorro entre metas"
```

---

## Task 7: Verificación integrada y PR

**Files:** ninguno (verificación).

- [ ] **Step 1: Recorrido completo en preview**

Cuenta throwaway, datos sembrados en esa cuenta (nunca la real ni el hogar real):
1. Preferencias: fijar 30% → persiste tras recargar.
2. Dashboard: el desglose dice «tope 30%» y el importe es el 30% de
   (ingreso − fijos).
3. Cambiar a 0% → el desglose muestra 0 de ahorro y el disponible sube en
   consecuencia (caso límite válido, no un error).
4. Volver a 50% → el comportamiento coincide con el de antes de este cambio.
5. `#metas`: el desplegable abre, se lee y menciona explícitamente que la
   categoría no influye.

- [ ] **Step 2: Confirmar que el reparto real no cambió**

Este trabajo **no toca `distribuir_ahorro`**. Verificarlo de verdad, no
asumirlo: en la cuenta throwaway, registrar un ahorro con 2 metas en curso y
comprobar en `aportes_meta` que se crean las filas con sus `peso_aplicado`
como siempre. Comparar contra el comportamiento previo al cambio.

- [ ] **Step 3: Limpiar datos de prueba**

Borrar transacciones/metas sembradas para la verificación (`nota like 'TEST-%'`
o equivalente). Dejar intacto el hogar de pruebas permanente documentado en la
memoria `nestra-v2-test-account`.

- [ ] **Step 4: Suite de tests final**

```bash
node --test "test/*.test.mjs"
```
Esperado: 284 pass, 0 fail.

- [ ] **Step 5: `verification-before-completion`**

Invocar la skill y adjuntar **evidencia real** (salidas de consulta, estado del
DOM, resultados de tests). No afirmar nada que no se haya observado. En
particular, verificar lo *visible en móvil* con `elementFromPoint` si se toca
algo posicionado — el toast de undo enseñó que comprobar clases CSS no basta.

- [ ] **Step 6: PR a `main`**

`main` está protegida (push directo rechazado). `gh pr create`. Tras el merge,
verificar el deploy con cache-buster:
```bash
curl -sL "https://nestra-8rl.pages.dev/sw.js?cb=$RANDOM" | grep SHELL_VERSION
curl -sL "https://nestra-8rl.pages.dev/js/ahorro-pct.js?cb=$RANDOM" | head -5
```
Esperado: la `SHELL_VERSION` nueva y el módulo servido.

---

## Self-Review (contra el spec)

- **Columna con default 50 (sin cambio de comportamiento), rango 0–80, no reutilizar `aporte_mensual_esperado`** → Task 1. ✓
- **Preferencia con patrón de `moneda.js` (cache + updateProfile + evento)** → Task 2. ✓
- **`pctAhorro` como insumo explícito; fallback a 50 si falta o es inválido** → Task 3, con TDD (tests antes, rojo verificado). ✓
- **Control en la sección Preferencias** → Task 4. ✓
- **El desglose nombra el tope aplicado (uso «objetivo visible»)** → Task 5. ✓
- **Explicar el reparto en #metas, diciendo que la categoría no influye** → Task 6. ✓
- **No tocar `distribuir_ahorro` ni el esquema de metas** → ninguna task lo hace; se verifica explícitamente en Task 7 Step 2. ✓
- **Verificación en base por introspección + contract test** → Task 1 Steps 4-7. ✓

Consistencia de nombres: `pct_ahorro_objetivo` (columna), `getPctAhorro` /
`setPctAhorro` / `cachePctAhorroDesdePerfil` / `normalizarPctAhorro` (globals),
`pctAhorro` (opción de `calcularSafeToSpend`), `nestra-pct-ahorro` (clave de
localStorage), `nestra:pct-ahorro-cambiado` (evento) — usados igual en todas
las tasks.
