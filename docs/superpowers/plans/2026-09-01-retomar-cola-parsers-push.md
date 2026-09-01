# Retomar Nestra: cola de revisión, parsers y push — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir tres defectos de UX reportados en vivo (0), vaciar la cola de 100 pendientes en minutos (A), dejar de generar `revisar-manual` por formatos de Yape y BBVA-QR que hoy no se parsean (B), y hacer que la suscripción push se auto-repare en vez de morir en silencio (C).

**Architecture:** Cuatro etapas independientes, cada una con su PR y su deploy. La etapa A añade un modo de selección múltiple a `#revisar` con la lógica pura extraída a `js/revisar-lote.js` (testeable en Node) y una función de lote en `js/db.js` que reutiliza el camino de confirmación existente fila por fila — sin semántica nueva de base de datos. La etapa B corrige los parsers del Worker de ingesta (funciones puras, ya cubiertas por `test/ingest-parsers.test.mjs`) contra cuerpos de correo reales capturados el 2026-09-01. La etapa C añade reconciliación de suscripción push en el arranque, porque hoy el cliente cree estar suscrito mirando el navegador mientras la fila de la base ya fue borrada por la Edge Function.

**Tech Stack:** PWA vanilla sin build (ES5-ish en las vistas, ESM en `js/*.js` y en el Worker), `node:test` para tests puros, Cloudflare Worker (`workers/ingest`) desplegado con wrangler, Supabase Postgres + Edge Functions, Cloudflare Pages para el sitio.

---

## Contexto: por qué estas tres cosas y en este orden

Estado medido el 2026-09-01:

- `ingest_pendientes`: 100 en `pendiente` (todas BBVA/gasto), 17 en `revisar-manual` (11 Yape, 6 BBVA-QR), 136 confirmadas, 10 descartadas.
- De las 100 pendientes: **78 comercios distintos**, 84 por debajo de S/50. Solo 28 tienen un comercio ya visto antes y 25 con categoría unánime. **Auto-confirmar por regla aprendida cubriría ~25%** — no vacía la cola. El resto es cola larga de nombres de persona (pagos QR P2P) que nunca se repetirán lo suficiente.
- `push_subscriptions`: **0 filas**. El cron `enviar-notificaciones-diario` corre a las 08:00 contra cero destinatarios.
- Última transacción registrada: 2026-08-23. La ingesta nunca paró (~40 correos/semana).

El orden es 0 → A → B → C por dependencia práctica:

1. **0 primero** porque son tres defectos baratos que el usuario ya está viendo, y uno de ellos (la Brújula sin margen) le está dando un número **falso** cada inicio de mes.
2. **A después** porque el dolor grande es la cola de 100 y es un drenaje de una sola vez.
3. **B** porque evita que sigan cayendo correos a `revisar-manual`, pero no ayuda a las 100 que ya están parseadas.
4. **C al final** porque volver a encender los avisos antes de que la cola sea drenable convierte la notificación en ruido.

**Fuera de alcance (decidido a propósito):**

- Re-parsear las 17 filas que ya están en `revisar-manual`. El `raw_body` está guardado y sería posible, pero son 17 filas que se resuelven a mano y un script de re-proceso necesita credenciales de servicio contra datos reales de 2 usuarios. No vale el riesgo.
- Auto-confirmación sin intervención (confirmar solo por regla aprendida, sin que el usuario mire). Con 25% de cobertura no resuelve nada y arriesga transacciones mal categorizadas de forma invisible.
- Limpieza de las tablas `_backup_fase63_*` y `_debug_push_latency_log`, y el advisor de *leaked password protection*. Es deuda real pero no bloquea nada; va en su propia sesión.

---

## Estructura de archivos

**Etapa 0:**
- Modificar: `js/format.js` — separador no-rompible en `formatMonto()`.
- Modificar: `views/dashboard.html` — el hero pinta símbolo y monto pegados.
- Crear: `js/metas-plazo.js` — lógica pura del aliento y la nueva fecha sugerida para metas vencidas.
- Crear: `test/metas-plazo.test.mjs`.
- Modificar: `views/metas.html` — mensaje de aliento y acción "Darme más tiempo".
- Modificar: `js/brujula.js` — nivel `sin-datos` y razón distinta cuando el ingreso es estimado.
- Modificar: `test/brujula.test.mjs`.
- Modificar: `views/brujula.html` — ingreso de referencia con respaldo del mes anterior.
- Modificar: `index.html` y `sw.js` — alta de `js/metas-plazo.js`, `SHELL_VERSION` a `v42`.

**Etapa A:**
- Crear: `js/revisar-lote.js` — lógica pura de selección en lote (qué fila es confirmable sin abrir la card, cómo se arma la nota, resumen de la selección). Sin DOM, sin red.
- Crear: `test/revisar-lote.test.mjs` — tests de esas funciones puras.
- Modificar: `js/db.js` — añadir `confirmarLoteIngest()`.
- Modificar: `views/revisar.html` — modo selección: checkbox por card, barra de acciones, y reemplazo de la construcción de nota inline por `notaDePendiente()`.
- Modificar: `index.html` — cargar `js/revisar-lote.js`.
- Modificar: `sw.js` — `SHELL_VERSION` a `v43` y alta del archivo nuevo en el precache.

**Etapa B:**
- Modificar: `workers/ingest/parsers/utils.js` — `lineasPlanas()` y meses abreviados en `parseFechaLarga()`.
- Modificar: `workers/ingest/parsers/yape.js` — arreglo del yapeo saliente, comercio del beneficiario, formato de recarga.
- Modificar: `workers/ingest/parsers/bbva.js` — formato "Constancia de pago a comercios con QR".
- Modificar: `test/ingest-parsers.test.mjs` — fixtures verbatim de los correos del 2026-09-01.

**Etapa C:**
- Modificar: `js/push.js` — `pushEstadoServidor()` y `pushReconciliar()`.
- Modificar: `index.html` — llamar a `pushReconciliar()` tras autenticar.
- Modificar: `views/configuracion.html` — el toggle refleja el estado del servidor, no solo el del navegador.
- Modificar: `sw.js` — `SHELL_VERSION` a `v44`.

---

# ETAPA 0 — Tres defectos reportados en vivo

Los tres se verificaron el 2026-09-01 contra el código y los datos reales.

---

### Task 0.1: El símbolo de moneda no se separa del monto

**Síntoma:** en el hero "Puedes gastar hoy" del dashboard, el `S/` aparece en una línea y el monto en la de abajo.

**Causa raíz:** `js/format.js:19` concatena con un espacio normal — `sym + " " + num...` — y `.dash-s2s-monto` rinde a `2.6rem`, así que el navegador parte la línea justo en ese espacio. El comentario de cabecera del propio archivo dice "Símbolo y monto en la misma línea (sin saltos)": el código nunca cumplió lo que documenta.

Dos cambios, uno global y uno del hero:

- **Global:** el separador pasa a espacio no-rompible (`\u00A0`). Arregla el salto en los 72 sitios que llaman `formatMonto()`, sin cambiar la firma, el espaciado visual ni ningún test (ninguno afirma sobre su salida).
- **Hero:** además pega símbolo y monto, que es lo pedido para esa tarjeta en concreto.

> `js/format.js` se carga como `<script src>` plano, **no** como módulo (`index.html:176`). No se le puede añadir `export` sin romper la carga, así que esta task no lleva test unitario: se verifica en el navegador.

**Files:**
- Modify: `js/format.js:19`
- Modify: `views/dashboard.html`

- [ ] **Step 1: Separador no-rompible en `formatMonto()`**

En `js/format.js`, el separador pasa a espacio no-rompible. **Escribirlo como escape `\u00A0`, nunca como carácter literal**: un NBSP literal es indistinguible de un espacio normal en el diff y el próximo que pase por el archivo lo "limpia" sin saber que era el arreglo.

Línea ~19, antes:

```js
  return sym + " " + num.toLocaleString(loc, { minimumFractionDigits: dec, maximumFractionDigits: dec });
```

después:

```js
  // Espacio NO-ROMPIBLE: con un espacio normal el navegador parte la línea
  // entre el símbolo y la cifra en los tamaños grandes (hero del dashboard a
  // 2.6rem). Esto es lo que la cabecera de este archivo siempre prometió.
  return sym + "\u00A0" + num.toLocaleString(loc, { minimumFractionDigits: dec, maximumFractionDigits: dec });
```

El `return` del caso nulo, unas líneas más arriba. Antes:

```js
    return sym + " 0" + (dec ? "." + "0".repeat(dec) : "");
```

después:

```js
    return sym + "\u00A00" + (dec ? "." + "0".repeat(dec) : "");
```

- [ ] **Step 2: El hero pinta símbolo y monto pegados**

En `views/dashboard.html`, junto a las demás funciones auxiliares de la vista:

```js
  // El hero va sin separación entre símbolo y cifra: a 2.6rem el espacio se
  // lee como un hueco, no como parte del número. El resto de la app conserva
  // el espacio no-rompible de formatMonto().
  function montoHero(n) {
    return formatMonto(n).replace(/\u00A0/g, '');
  }
```

y usarla en las dos líneas que pintan la cifra grande (líneas ~750 y ~759):

```js
            <p class="dash-s2s-monto">${esc(montoHero(res.exceso))}</p>
```

```js
          <p class="dash-s2s-monto">${esc(montoHero(res.diario))}</p>
```

- [ ] **Step 3: Cinturón de seguridad en CSS**

En el bloque `.dash-s2s-monto` de `views/dashboard.html` (línea ~166), añadir:

```css
    white-space: nowrap;
```

- [ ] **Step 4: Verificar en el navegador**

Levantar el preview y mirar el dashboard: la tarjeta debe decir `S/1,234.56` en una sola línea. Comprobar también con `resize_window` en preset `mobile` (375px), que es donde el salto aparecía.

- [ ] **Step 5: Commit**

```bash
git add js/format.js views/dashboard.html
git commit -m "fix(dashboard): el símbolo de moneda ya no salta de línea en el hero"
```

---

### Task 0.2: Una meta vencida no ofrece salida

**Síntoma:** cuando una meta pasa su `fecha_limite`, la card se pinta en rojo y dice "Vencida hace N días", y ahí se acaba. No hay aliento ni forma de mover la fecha.

**Verificado:** hay 2 metas vencidas reales (*Máquina de afeitar*, límite 2026-07-11; *Laptop nueva*, límite 2026-08-17). `views/metas.html:336` calcula `plazoCls`, y el bloque `meta-acciones` solo ofrece "Registrar aporte" y "Eliminar". `updateMeta(id, datos)` ya existe en `js/db.js:834` y acepta cualquier campo, así que no hace falta nada nuevo en la base.

**Files:**
- Create: `js/metas-plazo.js`
- Test: `test/metas-plazo.test.mjs`
- Modify: `views/metas.html`
- Modify: `index.html`

- [ ] **Step 1: Escribir el test que falla**

Crear `test/metas-plazo.test.mjs`:

```js
// test/metas-plazo.test.mjs
// Lógica pura del rescate de metas vencidas. `hoy` se inyecta siempre: nada
// acá puede depender del reloj del proceso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mensajeAliento, nuevaFechaSugerida } from '../js/metas-plazo.js';

test('mensajeAliento: con avance, reconoce lo logrado', () => {
  const m = mensajeAliento({ monto_actual: 400, monto_objetivo: 650 });
  assert.match(m, /62%/);
  assert.match(m, /S\/ ?250|250/);
});

test('mensajeAliento: sin avance, no felicita en falso', () => {
  const m = mensajeAliento({ monto_actual: 0, monto_objetivo: 650 });
  assert.doesNotMatch(m, /0%/);
  assert.ok(m.length > 0);
});

test('mensajeAliento: sin objetivo, mensaje genérico sin NaN ni Infinity', () => {
  const m = mensajeAliento({ monto_actual: 100, monto_objetivo: null });
  assert.doesNotMatch(m, /NaN|Infinity/);
  assert.ok(m.length > 0);
});

test('nuevaFechaSugerida: un mes desde hoy, no desde el límite viejo', () => {
  // La meta venció hace rato: reprogramar sobre la fecha vieja daría otra
  // fecha ya pasada.
  assert.equal(nuevaFechaSugerida('2026-07-11', '2026-09-01'), '2026-10-01');
});

test('nuevaFechaSugerida: cruce de año', () => {
  assert.equal(nuevaFechaSugerida('2026-11-30', '2026-12-15'), '2027-01-15');
});

test('nuevaFechaSugerida: día 31 en un mes que no lo tiene → último día real', () => {
  assert.equal(nuevaFechaSugerida('2026-01-31', '2026-01-31'), '2026-02-28');
});

test('nuevaFechaSugerida: sin fecha de hoy válida → null', () => {
  assert.equal(nuevaFechaSugerida('2026-07-11', ''), null);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/metas-plazo.test.mjs`
Expected: FAIL — `Cannot find module '../js/metas-plazo.js'`

- [ ] **Step 3: Escribir la implementación**

Crear `js/metas-plazo.js`:

```js
// js/metas-plazo.js — rescate de metas vencidas: qué decirle al usuario y qué
// fecha proponerle. Puro: sin DOM, sin red, y `hoy` se inyecta siempre.
// Carga doble: <script type="module"> (window.*) y ESM en node:test.

// mensajeAliento(meta) — texto de aliento para una meta vencida.
// Con avance real reconoce lo logrado y nombra lo que falta; sin avance no
// felicita en falso. Nunca devuelve NaN/Infinity aunque falte el objetivo.
function mensajeAliento(meta) {
  const act = Number(meta && meta.monto_actual) || 0;
  const obj = Number(meta && meta.monto_objetivo) || 0;
  if (obj <= 0) {
    return 'La fecha pasó, pero lo que juntaste sigue siendo tuyo. Ponle un plazo nuevo y sigue.';
  }
  const falta = Math.max(0, Math.round(obj - act));
  const pct = Math.round(act / obj * 100);
  if (pct <= 0) {
    return 'Esta no arrancó, y no pasa nada. Dale un plazo realista y empieza con un aporte chico.';
  }
  return 'Ya llevas ' + pct + '% y te faltan ' + falta + '. La fecha se venció, no la meta: date un plazo nuevo.';
}

// nuevaFechaSugerida(fechaLimite, hoyISO) — "YYYY-MM-DD" un mes DESPUÉS DE HOY.
// Sobre hoy y no sobre el límite viejo: una meta vencida hace dos meses
// reprogramada sobre su propia fecha nacería vencida otra vez.
// Un día que no existe en el mes destino (31 → febrero) cae al último día real.
function nuevaFechaSugerida(fechaLimite, hoyISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(hoyISO || ''));
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);       // 1-based
  const dia = Number(m[3]);
  const anioDest = mes === 12 ? anio + 1 : anio;
  const mesDest = mes === 12 ? 1 : mes + 1;
  // Día 0 del mes siguiente = último día del mes destino.
  const ultimo = new Date(anioDest, mesDest, 0).getDate();
  const diaDest = Math.min(dia, ultimo);
  const p = (n) => String(n).padStart(2, '0');
  return anioDest + '-' + p(mesDest) + '-' + p(diaDest);
}

if (typeof window !== 'undefined') {
  window.mensajeAliento = mensajeAliento;
  window.nuevaFechaSugerida = nuevaFechaSugerida;
}
export { mensajeAliento, nuevaFechaSugerida };
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test test/metas-plazo.test.mjs`
Expected: PASS — `# fail 0`

- [ ] **Step 5: Cargar el módulo**

En `index.html`, junto a los otros `<script type="module">`:

```html
    <script type="module" src="js/metas-plazo.js"></script>
```

En `sw.js`, añadir al precache:

```js
  { url: 'js/metas-plazo.js', revision: SHELL_VERSION },
```

- [ ] **Step 6: Pintar el aliento y la acción en la card vencida**

En `views/metas.html`, dentro de la función que arma la card, después de calcular `vis`:

```js
        var rescate = vis !== 'vencida' ? '' :
          '<p class="meta-aliento">' + esc(mensajeAliento(m)) + '</p>';
        var btnPlazo = vis !== 'vencida' ? '' :
          '<button type="button" class="btn-small btn-small--primary" ' +
          'data-act="replazo" data-id="' + m.id + '">Darme más tiempo</button>';
```

Insertar `rescate` justo después del `<p class="meta-plazo...">` en el `return`, y `btnPlazo` como primer elemento de `<div class="meta-acciones">`, antes de `aporte`.

Estilo, junto a las demás reglas `.meta-*`:

```css
  .meta-aliento { margin: var(--space-xs) 0 0; font-size: var(--font-size-sm);
    color: var(--color-text-muted); }
```

- [ ] **Step 7: Cablear la acción**

En el manejador de clicks de la vista, junto a los casos `aporte` / `eliminar` / `confirmar`:

```js
      if (act === 'replazo') {
        var meta = _metas.find(function (x) { return x.id === id; });
        if (!meta) return;
        var hoyISO = new Date().toISOString().slice(0, 10);
        var sugerida = nuevaFechaSugerida(meta.fecha_limite, hoyISO);
        var elegida = window.prompt(
          'Nueva fecha límite para "' + meta.nombre + '" (YYYY-MM-DD):', sugerida || '');
        if (!elegida) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(elegida)) { mostrarToast('Formato de fecha inválido.'); return; }
        if (elegida <= hoyISO) { mostrarToast('La fecha nueva tiene que ser futura.'); return; }
        try {
          // updateMeta acepta cualquier campo (js/db.js:834). El estado vuelve a
          // 'en_curso': si la fila quedó marcada 'vencida' en la base, moverle la
          // fecha sin resetear el estado la dejaría roja con una fecha futura.
          await updateMeta(id, { fecha_limite: elegida, estado: 'en_curso' });
          await cargar();
          mostrarToast('Nuevo plazo: ' + elegida);
        } catch (e) {
          console.error('replazo falló:', e);
          mostrarToast('No se pudo cambiar la fecha. Reintenta.');
        }
        return;
      }
```

> Antes de escribir esto, confirmar con `grep -n "mostrarToast\|async function cargar" views/metas.html` los nombres reales del toast y del recargador de la vista, y usar esos. Si el manejador de clicks no es `async`, hacerlo `async` o envolver el bloque en una función `async` autoinvocada.

- [ ] **Step 8: Verificar en el navegador**

Con las metas vencidas reales (*Máquina de afeitar*, *Laptop nueva*):

1. La card muestra el aliento y el botón "Darme más tiempo".
2. El prompt viene con la fecha sugerida (un mes desde hoy).
3. Aceptar → la card sale del rojo y muestra el plazo nuevo.
4. Una meta no vencida no muestra ni el aliento ni el botón.

- [ ] **Step 9: Commit**

```bash
git add js/metas-plazo.js test/metas-plazo.test.mjs views/metas.html index.html sw.js
git commit -m "feat(metas): una meta vencida ofrece aliento y un plazo nuevo"
```

---

### Task 0.3: La Brújula dice "sin margen" el día 1 del mes

**Síntoma:** el 2026-09-01, siendo el primer día del mes, la Brújula responde que no queda margen en **ninguna** categoría favorita.

**Causa raíz (verificada con datos reales):** en `js/brujula.js:10`,

```js
var liquidez = Math.max(0, m.ingresos - m.gastos - m.recurrentesPendientes - m.colchonMetas);
```

y `views/brujula.html:192` alimenta `m.ingresos` con `getBalancePersonal(hoy.mes, hoy.anio)` — **solo el mes en curso**. En septiembre hay S/0.00 de ingresos registrados (agosto cerró con S/1,277.98). Entonces `liquidez = max(0, 0 − 0 − recurrentes − colchón) = 0`, `tope = min(margenCat, 0) = 0`, y `calcularRango` cae en la rama `tope <= 0` → `sin-margen` para toda categoría. **Se repite cada inicio de mes hasta que caiga el primer ingreso.**

**Arreglo:** un ingreso de referencia con respaldo del mes anterior, y copy que no mienta sobre de dónde sale el número.

- Si el mes en curso ya tiene ingresos → se usan, como hoy.
- Si no → se usa el ingreso del mes anterior y se marca como estimado, para que la razón lo diga.
- Si tampoco hay mes anterior (usuario nuevo) → nivel nuevo `sin-datos`, que **no** es lo mismo que "te lo gastaste".

> **Alternativa considerada y descartada:** promediar los últimos 3 meses. Con ingresos tan irregulares como los reales (julio S/3,406.26 en 28 movimientos, agosto S/1,277.98 en 6) el promedio inflaría el margen justo cuando viene un mes flojo, y sobreestimar el margen es el error caro. El mes anterior es más conservador y más fácil de explicar en la UI. Si prefieres el promedio, el cambio es de una línea en `views/brujula.html`.

**Files:**
- Modify: `js/brujula.js`
- Modify: `test/brujula.test.mjs`
- Modify: `views/brujula.html`

- [ ] **Step 1: Escribir el test que falla**

Añadir en `test/brujula.test.mjs`:

```js
test('sin ingresos registrados y sin respaldo → sin-datos, no sin-margen', () => {
  const r = calcularRango(50, metricas({ ingresos: 0, gastos: 0 }), CAT);
  assert.equal(r.nivel, 'sin-datos');
  assert.match(r.razon, /ingreso/i);
});

test('ingreso estimado del mes anterior → la razón lo declara', () => {
  const m = metricas({ ingresos: 1200, gastos: 0, ingresoEstimado: true });
  const r = calcularRango(50, m, CAT);
  assert.notEqual(r.nivel, 'sin-datos');
  assert.match(r.razon, /estimad/i);
});

test('gastarse el margen sigue dando sin-margen, no sin-datos', () => {
  // Hay ingreso real: el margen se agotó de verdad.
  const r = calcularRango(50, metricas({ ingresos: 900 }), CAT); // 900-800-200-100 < 0
  assert.equal(r.nivel, 'sin-margen');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/brujula.test.mjs`
Expected: FAIL — el primer test da `sin-margen` en vez de `sin-datos`.

- [ ] **Step 3: Implementar**

En `js/brujula.js`, dentro de `calcularRango`, reemplazar el bloque de `tope <= 0`:

```js
  if (tope <= 0) {
    // Distinguir "no hay dato" de "te lo gastaste". Sin ingreso registrado ni
    // respaldo del mes anterior, la liquidez sale 0 por falta de información,
    // no por exceso de gasto: decirle "no te queda margen" el día 1 del mes es
    // un número falso (bug reportado el 2026-09-01).
    if (!(m.ingresos > 0)) {
      return { nivel: 'sin-datos', comodo: 0, tope: 0, sugerido: 0,
        razon: 'Todavía no registras ingresos este mes, así que no puedo calcular tu margen. Anota tu ingreso y vuelve a preguntar.' };
    }
    return { nivel: 'sin-margen', comodo: 0, tope: 0, sugerido: 0,
      razon: 'Este mes no te queda margen en ' + categoria.nombre + '. Revisa tus gastos o espera al próximo ciclo.' };
  }
```

y añadir el sufijo de estimación a las razones que citan cifras. Justo antes de los `return` de `consulta` / `recomendable` / `cautela` / `no`, calcular una vez:

```js
  // Cuando el margen se apoya en el ingreso del mes pasado (aún no hay ingreso
  // este mes), decirlo: el número es utilizable pero no es un hecho.
  var nota = m.ingresoEstimado ? ' Es un estimado con tu ingreso del mes pasado.' : '';
```

y concatenar `nota` al final de cada una de esas cuatro `razon`. Ejemplo para `consulta`:

```js
  if (!(monto > 0)) {
    return { nivel: 'consulta', comodo: comodo, tope: tope, sugerido: tope,
      razon: 'Puedes gastar tranquilo hasta ' + comodo + '; tu tope este mes es ' + tope + '.' + nota };
  }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test test/brujula.test.mjs`
Expected: PASS — incluidos los tests viejos, que no cambian de nivel.

- [ ] **Step 5: Alimentar el ingreso de referencia desde la vista**

En `views/brujula.html`, dentro de `recolectarMetricas` (línea ~184), añadir el mes anterior al `Promise.all`:

```js
      var mesAnt = hoy.mes === 1 ? 12 : hoy.mes - 1;
      var anioAnt = hoy.mes === 1 ? hoy.anio - 1 : hoy.anio;

      var res = await Promise.all([
        getGastoCategoria(cat.id, ambito, rMes.desde, rMes.hasta),
        getGastoCategoria(cat.id, ambito, rSem.desde, rSem.hasta),
        getBalancePersonal(hoy.mes, hoy.anio), // Fase 6.3: liquidez siempre contra el bolsillo del que pregunta, sea cual sea el ámbito de la categoría
        getMetas(ambito),
        getRecurrentes(),
        getBalancePersonal(mesAnt, anioAnt),   // respaldo: el mes en curso puede no tener ingresos aún
      ]);
      var gastoMes = res[0], gastoSemana = res[1], balance = res[2];
      var balanceAnt = res[5];
```

y en el objeto `metricas` que devuelve, reemplazar `ingresos: balance.ingresos` por:

```js
          ingresos: balance.ingresos > 0 ? balance.ingresos : (balanceAnt.ingresos || 0),
          ingresoEstimado: !(balance.ingresos > 0) && (balanceAnt.ingresos || 0) > 0,
```

- [ ] **Step 6: Manejar el nivel nuevo en la UI**

Buscar dónde la vista mapea `nivel` a estilos o textos:

Run: `grep -n "sin-margen" views/brujula.html`

Añadir `sin-datos` a cada mapa que encuentre, reutilizando el tratamiento visual de `sin-margen` (es el mismo tono de "no puedo recomendarte gastar"). Si el mapa es un objeto, añadir la clave; si es un `if`, añadir la condición. Un `nivel` sin entrada dejaría la respuesta sin estilo.

- [ ] **Step 7: Verificar en el navegador**

Estando en el primer día del mes sin ingresos registrados:

1. La Brújula ya **no** dice "no te queda margen" en todas las categorías.
2. Dice que se apoya en el ingreso del mes pasado, con un tope calculado sobre S/1,277.98 (agosto) menos gastos, recurrentes por venir y colchón de metas.
3. Registrar un ingreso de septiembre y volver a preguntar: el sufijo "estimado" desaparece y el tope se recalcula sobre el ingreso real.

- [ ] **Step 8: Correr toda la suite y cerrar la etapa**

Run: `for f in test/*.test.mjs; do node --test "$f" || echo "FAIL $f"; done`
Expected: sin líneas `FAIL`.

- [ ] **Step 9: Bumpear el shell, commit y PR**

En `sw.js`: `const SHELL_VERSION = 'v42';`

```bash
git add js/brujula.js test/brujula.test.mjs views/brujula.html sw.js
git commit -m "fix(brujula): el margen ya no sale en cero el primer día del mes"
git push -u origin fix/ux-reportados
gh pr create --title "fix: moneda que salta de línea, metas vencidas sin salida, brújula sin margen" --body "Tres defectos reportados. El de la brújula daba un número falso cada inicio de mes: la liquidez se calculaba solo con el ingreso del mes en curso, que el día 1 es cero."
```

---

# ETAPA A — Vaciar la cola sin abrir 100 cards

**Resultado esperado:** el usuario entra a `#revisar`, activa "Seleccionar", marca las filas que ya traen categoría sugerida correcta, y confirma 20-30 de una vez. Las que necesitan atención siguen abriéndose una por una como hoy.

**Reglas de diseño (fijadas ahora para que no se decidan a mitad de implementación):**

- Solo entra al lote una fila con `estado === 'pendiente'`, con `tipo` `gasto` o `ingreso`, `monto > 0`, `fecha` presente, sin moneda extranjera, y con una categoría resuelta (sugerida por autocat o elegida a mano en la card).
- Las filas `revisar-manual` **nunca** entran al lote: les falta tipo/monto/fecha por definición.
- El lote confirma siempre con `ambito: 'personal'`. Un gasto de hogar necesita reparto por miembro; eso exige abrir la card.
- El lote es secuencial, no paralelo: respeta el orden de la outbox offline igual que las confirmaciones de a una.

---

### Task A1: Lógica pura del lote (`js/revisar-lote.js`)

**Files:**
- Create: `js/revisar-lote.js`
- Test: `test/revisar-lote.test.mjs`

- [ ] **Step 1: Escribir el test que falla**

Crear `test/revisar-lote.test.mjs`:

```js
// test/revisar-lote.test.mjs
// Lógica pura del modo lote de #revisar. Sin DOM: las funciones reciben las
// filas de ingest_pendientes tal como las devuelve getIngestPendientes().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loteable, resumenLote, notaDePendiente } from '../js/revisar-lote.js';

const BANCO_LABEL = { bbva: 'BBVA', bcp: 'BCP', yape: 'Yape' };

function fila(over) {
  return {
    id: 'x', estado: 'pendiente', banco: 'bbva', tipo: 'gasto',
    monto: 12.5, fecha: '2026-08-20', comercio: 'LA PANERA CAFE',
    contraparte: null, moneda_original: null, raw_subject: 'BBVA - consumo',
    ...over,
  };
}

test('loteable: fila completa con categoría → true', () => {
  assert.equal(loteable(fila(), 'cat-1'), true);
});

test('loteable: sin categoría resuelta → false', () => {
  assert.equal(loteable(fila(), null), false);
  assert.equal(loteable(fila(), ''), false);
});

test('loteable: revisar-manual nunca entra al lote', () => {
  assert.equal(loteable(fila({ estado: 'revisar-manual' }), 'cat-1'), false);
});

test('loteable: monto ausente, cero o negativo → false', () => {
  assert.equal(loteable(fila({ monto: null }), 'cat-1'), false);
  assert.equal(loteable(fila({ monto: 0 }), 'cat-1'), false);
  assert.equal(loteable(fila({ monto: -5 }), 'cat-1'), false);
});

test('loteable: sin fecha → false', () => {
  assert.equal(loteable(fila({ fecha: null }), 'cat-1'), false);
});

test('loteable: tipo ahorro exige abrir la card → false', () => {
  assert.equal(loteable(fila({ tipo: 'ahorro' }), 'cat-1'), false);
});

test('loteable: moneda extranjera exige revisión → false', () => {
  assert.equal(loteable(fila({ moneda_original: 'USD' }), 'cat-1'), false);
  // PEN explícito no estorba.
  assert.equal(loteable(fila({ moneda_original: 'PEN' }), 'cat-1'), true);
});

test('resumenLote: cuenta y suma los montos', () => {
  const r = resumenLote([fila({ monto: 10 }), fila({ monto: 2.5 })]);
  assert.equal(r.n, 2);
  assert.equal(r.total, 12.5);
});

test('resumenLote: lista vacía → cero, no NaN', () => {
  assert.deepEqual(resumenLote([]), { n: 0, total: 0 });
});

test('notaDePendiente: prefiere comercio', () => {
  assert.equal(notaDePendiente(fila(), BANCO_LABEL), 'LA PANERA CAFE');
});

test('notaDePendiente: sin comercio cae a contraparte, luego al asunto', () => {
  assert.equal(
    notaDePendiente(fila({ comercio: null, contraparte: 'EDUARDO DIAZ' }), BANCO_LABEL),
    'EDUARDO DIAZ');
  assert.equal(
    notaDePendiente(fila({ comercio: null, contraparte: null }), BANCO_LABEL),
    'BBVA - consumo');
});

test('notaDePendiente: sin nada usable, etiqueta el banco', () => {
  const f = fila({ comercio: null, contraparte: null, raw_subject: null });
  assert.equal(notaDePendiente(f, BANCO_LABEL), 'Correo BBVA');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/revisar-lote.test.mjs`
Expected: FAIL — `Cannot find module '../js/revisar-lote.js'`

> Nota: correr los tests **por archivo**. La forma con glob rompe por el path del worktree con puntos (`..Nestra-v2`).

- [ ] **Step 3: Escribir la implementación mínima**

Crear `js/revisar-lote.js`:

```js
// js/revisar-lote.js — lógica pura del modo lote de #revisar.
// Sin DOM ni red: qué fila se puede confirmar sin abrirla, cómo se parte la
// lista, y cómo se arma la nota de la transacción. Carga doble:
// <script type="module"> (window.*) en la PWA y ESM en node:test.

// loteable(fila, catId) — true si la fila se puede confirmar sin abrir la card.
// Reglas fijadas en el plan 2026-09-01: solo 'pendiente', gasto/ingreso, con
// monto>0, fecha, moneda local y categoría ya resuelta. 'revisar-manual' llega
// sin tipo/monto/fecha por definición: siempre a mano.
function loteable(fila, catId) {
  if (!fila) return false;
  if (fila.estado !== 'pendiente') return false;
  if (fila.tipo !== 'gasto' && fila.tipo !== 'ingreso') return false;
  if (!(Number(fila.monto) > 0)) return false;
  if (!fila.fecha) return false;
  if (fila.moneda_original && String(fila.moneda_original).toUpperCase() !== 'PEN') return false;
  return !!catId;
}

// resumenLote(filas) → { n, total } para la barra de acciones.
function resumenLote(filas) {
  const ls = filas || [];
  let total = 0;
  ls.forEach(function (f) { total += Number(f.monto) || 0; });
  return { n: ls.length, total: Math.round(total * 100) / 100 };
}

// notaDePendiente(fila, bancoLabel) — texto base de la transacción.
// Misma regla que usaba confirmar() en views/revisar.html: se extrae acá para
// que la confirmación de a una y la de lote no puedan divergir.
function notaDePendiente(fila, bancoLabel) {
  if (!fila) return '';
  const labels = bancoLabel || {};
  return fila.comercio || fila.contraparte || fila.raw_subject ||
    ('Correo ' + (labels[fila.banco] || fila.banco));
}

if (typeof window !== 'undefined') {
  window.loteable = loteable;
  window.resumenLote = resumenLote;
  window.notaDePendiente = notaDePendiente;
}
export { loteable, resumenLote, notaDePendiente };
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test test/revisar-lote.test.mjs`
Expected: PASS — `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add js/revisar-lote.js test/revisar-lote.test.mjs
git commit -m "feat(revisar-lote): lógica pura de selección en lote"
```

---

### Task A2: `confirmarLoteIngest()` en `js/db.js`

Confirma N filas reutilizando el camino existente (`insertTransaccion` + `confirmarIngestPendiente`), secuencialmente, y devuelve el resultado por fila para que la UI pueda reportar fallos parciales sin perder los aciertos.

**Files:**
- Modify: `js/db.js` (al final del bloque "INGESTA DE CORREOS BANCARIOS", después de `confirmarIngestPendiente`)

- [ ] **Step 1: Leer el bloque para ubicar el punto de inserción**

Run: `grep -n "confirmarIngestPendiente\|descartarIngestPendiente" js/db.js`
Expected: se ven las definiciones de ambas; insertar la nueva función justo después de la definición de `confirmarIngestPendiente`.

- [ ] **Step 2: Escribir la implementación**

Añadir en `js/db.js`, tras `confirmarIngestPendiente`:

```js
// confirmarLoteIngest(items) — confirma N pendientes de una pasada.
// items: [{ fila, categoria_id, nota }]. Siempre ambito 'personal' y sin
// reparto de hogar: un gasto compartido necesita partes por miembro y eso
// exige abrir la card (ver plan 2026-09-01, Etapa A).
// SECUENCIAL a propósito: las acciones offline van a la outbox y el orden
// importa. Nunca lanza por una fila: devuelve el resultado de cada una para
// que la UI quite las que sí entraron y deje visibles las que fallaron.
// Returns: [{ id, ok, transaccionId?, error? }]
async function confirmarLoteIngest(items) {
  const out = [];
  for (const it of (items || [])) {
    const f = it.fila;
    try {
      const tx = await insertTransaccion({
        tipo: f.tipo,
        ambito: 'personal',
        categoria_id: it.categoria_id,
        monto: Number(f.monto),
        fecha: f.fecha,
        nota: it.nota,
      });
      await confirmarIngestPendiente(f.id, tx.id, {
        tipo: f.tipo, monto: Number(f.monto), fecha: f.fecha,
      });
      out.push({ id: f.id, ok: true, transaccionId: tx.id });
    } catch (err) {
      console.error('confirmarLoteIngest() falló en ' + f.id + ':', err.message || err);
      out.push({ id: f.id, ok: false, error: err.message || String(err) });
    }
  }
  return out;
}
```

- [ ] **Step 3: Verificar que no rompió la carga del módulo**

Run: `node --check js/db.js`
Expected: sin salida (sintaxis válida).

- [ ] **Step 4: Commit**

```bash
git add js/db.js
git commit -m "feat(revisar-lote): confirmarLoteIngest en db.js"
```

---

### Task A3: Modo selección en `views/revisar.html`

**Files:**
- Modify: `views/revisar.html`
- Modify: `index.html`

- [ ] **Step 1: Cargar el módulo nuevo en `index.html`**

Buscar la línea que carga `js/autocat.js` y añadir debajo:

```html
<script type="module" src="js/revisar-lote.js"></script>
```

Run: `grep -n "revisar-lote\|autocat" index.html`
Expected: las dos líneas, `autocat.js` primero.

- [ ] **Step 2: Añadir el archivo al guard de dependencias de la vista**

En `views/revisar.html`, la IIFE de la línea ~159 valida que existan las funciones globales que la vista usa. Añadir las nuevas a la lista `faltan`:

```js
  var faltan = ['getIngestPendientes', 'confirmarIngestPendiente', 'descartarIngestPendiente',
                'confirmarLoteIngest', 'loteable', 'resumenLote', 'notaDePendiente',
```

(mantener el resto de la lista tal como está, incluida `validarPartesGastoHogar`)

- [ ] **Step 3: Usar `notaDePendiente()` en `confirmar()` en vez de armar la nota inline**

En `views/revisar.html`, dentro de `confirmar(i, btn)`, reemplazar:

```js
    var base = p.comercio || p.contraparte || p.raw_subject || 'Correo ' + (BANCO_LABEL[p.banco] || p.banco);
```

por:

```js
    var base = notaDePendiente(p, BANCO_LABEL);
```

Esto es DRY, no un cambio de comportamiento: la función replica exactamente esa expresión y está cubierta por los tests de la Task A1.

- [ ] **Step 4: Añadir el estilo de la barra de lote**

En el `<style>` de `views/revisar.html`, junto a las reglas `.rev-*`:

```css
  .rev-lote-bar { position: sticky; bottom: 0; z-index: 5;
    display: flex; gap: .5rem; align-items: center; justify-content: space-between;
    padding: .75rem 1rem; background: var(--color-surface);
    border-top: 1px solid var(--color-border); }
  .rev-lote-bar[hidden] { display: none; }
  .rev-lote-resumen { font-size: .9rem; }
  .rev-check { margin-right: .5rem; }
```

- [ ] **Step 5: Añadir el checkbox por card y la barra de acciones**

En `cardHTML(p, i)`, declarar el checkbox junto a las otras variables locales (después de `var sinCat = !sugerida;`). Las filas `revisar-manual` no lo llevan: nunca entran al lote.

```js
    var checkHTML = manual ? '' :
      '<input type="checkbox" class="rev-check" data-rev-check="' + i + '" ' +
      'aria-label="Seleccionar para confirmar en lote">';
```

Insertarlo como primer hijo del `<div class="rev-meta">` del `return` (línea ~268), delante del `<span class="rev-banco">`:

```js
          '<div class="rev-meta">' +
            checkHTML +
            '<span class="rev-banco">' + esc(BANCO_LABEL[p.banco] || p.banco) + '</span>' +
```

> `.rev-meta` vive dentro de `.rev-compact`, que es el `[data-rev-expandir]`. Por eso el handler del checkbox tiene que ir **antes** del de expandir y cortar la propagación (Step 6). El swipe no estorba: `swipeStart()` ya sale temprano ante un `input`.

Añadir la barra en el HTML estático de la vista, justo después de `<ul class="rev-lista" id="revLista" ...></ul>` (línea ~149) y antes de `<div id="revVacio">`:

```html
<div class="rev-lote-bar" id="revLoteBar" hidden>
  <span class="rev-lote-resumen" id="revLoteResumen">0 seleccionadas</span>
  <span>
    <button type="button" class="btn btn-ghost" id="revLoteTodas">Marcar sugeridas</button>
    <button type="button" class="btn btn-primary" id="revLoteConfirmar" disabled>Confirmar</button>
  </span>
</div>
```

- [ ] **Step 6: Cablear la lógica de selección**

Dentro de la IIFE de la vista, junto a las demás funciones:

```js
  // Categoría resuelta de la fila i: la que el usuario dejó en el select
  // (que ya viene prefilleado con la sugerencia de autocat).
  function catDeFila(i) {
    var el = document.getElementById('revCat' + i);
    return el ? (el.value || null) : null;
  }

  function indicesSeleccionados() {
    var out = [];
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-rev-check]:checked'),
      function (el) { out.push(Number(el.getAttribute('data-rev-check'))); });
    return out;
  }

  // La barra se muestra si hay al menos una card seleccionable. Sin esto el
  // botón "Marcar sugeridas" quedaría dentro de un contenedor oculto y sería
  // inalcanzable: el usuario no tendría cómo hacer la primera selección.
  function pintarBarraLote() {
    var bar = document.getElementById('revLoteBar');
    if (!bar) return;
    if (!document.querySelector('[data-rev-check]')) { bar.hidden = true; return; }
    var idx = indicesSeleccionados();
    var filas = idx.map(function (i) { return _filas[i]; }).filter(Boolean);
    var r = resumenLote(filas);
    document.getElementById('revLoteResumen').textContent =
      r.n === 0 ? '0 seleccionadas' : (r.n + ' seleccionadas · ' + fmt(r.total));
    document.getElementById('revLoteConfirmar').disabled = r.n === 0;
    bar.hidden = false;
  }

  // "Marcar sugeridas": marca todas las filas que loteable() acepta con la
  // categoría que hoy tiene su select.
  function marcarSugeridas() {
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-rev-check]'),
      function (el) {
        var i = Number(el.getAttribute('data-rev-check'));
        el.checked = loteable(_filas[i], catDeFila(i));
      });
    pintarBarraLote();
  }

  async function confirmarLote(btn) {
    var idx = indicesSeleccionados();
    var items = [];
    idx.forEach(function (i) {
      var f = _filas[i];
      var cat = catDeFila(i);
      if (!loteable(f, cat)) return;   // defensa: no confiar solo en el checkbox
      items.push({ fila: f, categoria_id: cat, nota: notaDePendiente(f, BANCO_LABEL) });
    });
    if (!items.length) return;
    btn.disabled = true;
    try {
      var res = await confirmarLoteIngest(items);
      var okIds = {};
      res.forEach(function (r) { if (r.ok) okIds[r.id] = true; });
      // Quitar de la lista solo las que entraron; las fallidas quedan visibles.
      for (var i = _filas.length - 1; i >= 0; i--) {
        if (_filas[i] && okIds[_filas[i].id]) quitarCard(i);
      }
      // Repintar ANTES del aviso: pintarBarraLote escribe en el mismo elemento
      // y borraría el resultado si corriera después.
      pintarBarraLote();
      var fallidas = res.length - Object.keys(okIds).length;
      mostrarToastLote(Object.keys(okIds).length, fallidas);
    } finally {
      btn.disabled = false;
    }
  }

  function mostrarToastLote(ok, fallidas) {
    var el = document.getElementById('revLoteResumen');
    if (!el) return;
    el.textContent = fallidas
      ? (ok + ' confirmadas · ' + fallidas + ' fallaron, reintenta')
      : (ok + ' confirmadas');
  }
```

Cablear los eventos en dos lugares distintos, porque la barra **no** está dentro de `#revLista` y sus clicks nunca llegarían al delegado de la lista:

1. En el `listaEl.addEventListener('click', ...)` (línea ~711), como **primer** bloque, antes del de `[data-rev-chip]`:

```js
        var chk = ev.target.closest('[data-rev-check]');
        if (chk) {
          // Marcar no debe expandir la card: .rev-meta vive dentro del
          // [data-rev-expandir], así que hay que cortar acá.
          ev.stopPropagation();
          pintarBarraLote();
          return;
        }
```

2. Junto al listener del botón de undo (línea ~748), listeners propios para la barra:

```js
      document.getElementById('revLoteTodas').addEventListener('click', marcarSugeridas);
      document.getElementById('revLoteConfirmar').addEventListener('click', function (ev) {
        confirmarLote(ev.currentTarget);
      });
```

3. En `init()`, tras `listaEl.style.display = '';` (línea ~690), pintar la barra por primera vez:

```js
      pintarBarraLote();
```

> El lote **no** pasa por `quitarCardConUndo()`. El undo de 7s está diseñado para una fila; encolar 25 undos simultáneos vuelve el toast inservible. Confirmar en lote es explícito (marcar + tocar Confirmar), y una confirmación equivocada se corrige editando la transacción.

- [ ] **Step 7: Bumpear el shell y precachear el archivo nuevo**

En `sw.js`: cambiar `const SHELL_VERSION = 'v42';` por `'v43'`, y añadir a la lista de precache:

```js
  { url: 'js/revisar-lote.js', revision: SHELL_VERSION },
```

- [ ] **Step 8: Verificar en el navegador**

Levantar el preview (`preview_start`, config `nestra` de `.claude/launch.json`), ir a `#revisar`, y comprobar:

1. La barra aparece con "0 seleccionadas" y el botón Confirmar deshabilitado.
2. "Marcar sugeridas" marca solo filas con categoría; ninguna `revisar-manual`.
3. Confirmar quita las filas confirmadas y el badge del nav baja en la misma cantidad.
4. Consola sin errores (`read_console_messages`).

> Recordar: el SW cachea los `.js`. Si el cambio no aparece, recargar con el SW actualizado o vaciar el cache del shell.

- [ ] **Step 9: Correr toda la suite**

Run: `for f in test/*.test.mjs; do node --test "$f" || echo "FAIL $f"; done`
Expected: sin líneas `FAIL`.

- [ ] **Step 10: Commit y PR**

```bash
git add views/revisar.html index.html sw.js
git commit -m "feat(revisar): modo de selección para confirmar pendientes en lote"
git push -u origin feat/revisar-lote
gh pr create --title "feat(revisar): confirmar pendientes en lote" --body "Vacía la cola de 100 pendientes sin abrir cada card. Lógica pura en js/revisar-lote.js con tests; confirmarLoteIngest reutiliza el camino de confirmación de a una."
```

> `main` está protegida: no intentar push directo. Tras el merge, verificar el deploy con cache-buster:
> `curl -sL "https://nestra-8rl.pages.dev/sw.js?cb=$RANDOM" | grep SHELL_VERSION` → debe decir `v43`.

---

# ETAPA B — Cerrar los huecos de parser

**Causa raíz verificada** contra cuerpos reales del 2026-08-30 y 2026-09-01 (los tres formatos que hoy caen a `revisar-manual`):

1. **Yapeo saliente** — el parser *sí* detecta `/Acabas de yapear/` pero después falla al leer el monto. El cuerpo trae la etiqueta con asteriscos de negrita y el valor dos líneas abajo:

   ```
   *Monto de yapeo**
   (línea vacía)
   S/ 13.50
   ```

   `campoTrasEtiqueta(ls, 'Monto de yapeo*')` ancla con `^Monto de yapeo\*` y la línea **empieza con `*`** → no matchea → `monto === null` → `FormatoNoReconocidoError`. Los 11 correos de Yape en `revisar-manual` y los 0 confirmados de Yape salen de acá.

2. **Recarga de Yape** — formato nunca verificado. El monto está en la primera línea (`*S/* 7`), la operadora bajo `Operadora:` y la fecha con **mes abreviado** (`30 ago. 2026`), que `parseFechaLarga()` no reconoce porque su mapa `MESES` solo tiene nombres completos.

3. **BBVA "Constancia de pago a comercios con QR"** — asunto no contemplado. El cuerpo es el formato estándar de BBVA (etiqueta en una línea, valor dos abajo) y `campoTrasEtiqueta()` ya lo maneja tal cual.

---

### Task B1: Meses abreviados en `parseFechaLarga()`

**Files:**
- Modify: `workers/ingest/parsers/utils.js`
- Test: `test/ingest-parsers.test.mjs`

- [ ] **Step 1: Escribir el test que falla**

Añadir en `test/ingest-parsers.test.mjs`, junto al test existente de `parseFechaLarga`:

```js
test('parseFechaLarga: meses abreviados (recarga Yape, 2026-08-30)', () => {
  assert.equal(parseFechaLarga('30 ago. 2026 - 10:29 a. m.'), '2026-08-30');
  assert.equal(parseFechaLarga('1 set. 2026'), '2026-09-01');
  assert.equal(parseFechaLarga('15 dic. 2026'), '2026-12-15');
  // Los nombres completos siguen funcionando.
  assert.equal(parseFechaLarga('30 agosto 2026 - 11:39 a. m.'), '2026-08-30');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/ingest-parsers.test.mjs`
Expected: FAIL — el primer assert da `null` en vez de `'2026-08-30'`.

- [ ] **Step 3: Implementar**

En `workers/ingest/parsers/utils.js`, ampliar el mapa `MESES` con las abreviaturas es-PE:

```js
const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
  // Abreviaturas: Yape las usa en las recargas ("30 ago. 2026").
  ene: 1, feb: 2, mar: 3, abr: 4, jun: 6, jul: 7,
  ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
};
```

> `mayo` no tiene abreviatura distinta y ya está en el mapa; `mar` (marzo) y `abr` no colisionan con nada. El regex de `parseFechaLarga` captura `([a-z]+)` y el punto queda fuera del grupo, así que `ago.` llega como `ago`.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test test/ingest-parsers.test.mjs`
Expected: PASS — `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add workers/ingest/parsers/utils.js test/ingest-parsers.test.mjs
git commit -m "fix(parsers): parseFechaLarga acepta meses abreviados"
```

---

### Task B2: `lineasPlanas()` — líneas sin asteriscos de negrita

**Files:**
- Modify: `workers/ingest/parsers/utils.js`
- Modify: `workers/ingest/parsers/index.js` (re-export para los tests)
- Test: `test/ingest-parsers.test.mjs`

- [ ] **Step 1: Escribir el test que falla**

```js
test('lineasPlanas: quita los asteriscos de negrita del texto plano de Yape', () => {
  const body = '*Monto de yapeo**\n\nS/ 13.50\n';
  assert.deepEqual(lineasPlanas(body), ['Monto de yapeo', '', 'S/ 13.50', '']);
});

test('lineasPlanas: no toca los asteriscos internos de un comercio BBVA', () => {
  // "IZI*GLASE" es el nombre real del comercio: solo se limpian los de los
  // extremos, que son marcado de negrita.
  assert.deepEqual(lineasPlanas('IZI*GLASE'), ['IZI*GLASE']);
});
```

Añadir `lineasPlanas` al import del archivo de test.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/ingest-parsers.test.mjs`
Expected: FAIL — `lineasPlanas is not a function`

- [ ] **Step 3: Implementar**

En `workers/ingest/parsers/utils.js`, después de `lineas()`:

```js
// Igual que lineas(), pero quitando los asteriscos de negrita que Yape mete
// alrededor de las etiquetas ("*Monto de yapeo**"). Solo los de los extremos:
// un asterisco interno puede ser parte del nombre real del comercio
// ("IZI*GLASE" en BBVA), y perderlo cambiaría el dato.
function lineasPlanas(body) {
  return lineas(body).map((l) => l.replace(/^\*+/, '').replace(/\*+$/, '').trim());
}
```

y añadirla al `export { ... }` del final del archivo.

En `workers/ingest/parsers/index.js`, añadir `lineasPlanas` tanto al import desde `./utils.js` como al bloque de re-exports (el que dice "helpers puros re-exportados para los tests").

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test test/ingest-parsers.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workers/ingest/parsers/utils.js workers/ingest/parsers/index.js test/ingest-parsers.test.mjs
git commit -m "feat(parsers): lineasPlanas para cuerpos con negritas de Yape"
```

---

### Task B3: Arreglar el yapeo saliente y sacarle el comercio

**Files:**
- Modify: `workers/ingest/parsers/yape.js`
- Test: `test/ingest-parsers.test.mjs`

El cuerpo real trae varios campos aplastados en una sola línea:

```
Yapero DARLING GABRIELA MEZA R. Tu número de celular XXXXXXXXX153 Fecha y Hora de la operación 30 agosto 2026 - 11:39 a. m. Celular del Beneficiario  Nombre del Beneficiario SERVICIOS GENERALES CARAMBA S. Nº de operación 4064627
```

El comentario viejo del parser decía que `Nombre del Beneficiario` no era confiable porque en los dos correos de julio traía a la dueña de la cuenta. En este correo trae un comercio real. La regla que resuelve ambos casos: **usarlo como comercio solo si difiere del `Yapero`** (que es siempre el titular).

- [ ] **Step 1: Escribir el test que falla**

```js
// Fragmento VERBATIM del correo real del 2026-08-30 (bandeja de Darling).
const YAPE_SALIENTE_2026_08 = `*¡Hola, DARLING GABRIELA MEZA R.!*

*¡Acabas de yapear exitosamente!*

*Monto de yapeo**

S/ 13.50

Yapero DARLING GABRIELA MEZA R. Tu número de celular XXXXXXXXX153 Fecha y Hora de la operación 30 agosto 2026 - 11:39 a. m. Celular del Beneficiario  Nombre del Beneficiario SERVICIOS GENERALES CARAMBA S. Nº de operación 4064627
`;

test('yape: yapeo saliente con etiqueta en negrita → gasto con monto', () => {
  const p = parse('yape', {
    subject: 'Por tu seguridad, te notificaremos por cada yapeo que realices',
    body: YAPE_SALIENTE_2026_08,
    date: '2026-08-30T16:39:00Z',
  });
  assert.equal(p.tipo, 'gasto');
  assert.equal(p.monto, 13.5);
  assert.equal(p.moneda, 'PEN');
  assert.equal(p.fecha, '2026-08-30');
  assert.equal(p.p2p, true);
});

test('yape: el beneficiario distinto del yapero sí es comercio', () => {
  const p = parse('yape', {
    subject: 'Por tu seguridad, te notificaremos por cada yapeo que realices',
    body: YAPE_SALIENTE_2026_08,
    date: '2026-08-30T16:39:00Z',
  });
  assert.equal(p.comercio, 'SERVICIOS GENERALES CARAMBA S.');
});

test('yape: beneficiario igual al yapero → comercio null (no es contraparte real)', () => {
  const body = YAPE_SALIENTE_2026_08.replace(
    'Nombre del Beneficiario SERVICIOS GENERALES CARAMBA S.',
    'Nombre del Beneficiario DARLING GABRIELA MEZA R.');
  const p = parse('yape', {
    subject: 'Por tu seguridad, te notificaremos por cada yapeo que realices',
    body: body,
    date: '2026-08-30T16:39:00Z',
  });
  assert.equal(p.comercio, null);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/ingest-parsers.test.mjs`
Expected: FAIL — `FormatoNoReconocidoError: yapeo saliente sin monto/fecha`

- [ ] **Step 3: Implementar**

En `workers/ingest/parsers/yape.js`, cambiar el import para traer `lineasPlanas` (y dejar de usar `lineas` si queda sin uso), y reemplazar el bloque del yapeo saliente:

```js
  // Yapeo SALIENTE → gasto.
  if (/Acabas de yapear/i.test(nbody)) {
    // Yape marca las etiquetas con asteriscos de negrita ("*Monto de yapeo**")
    // y manda el valor dos líneas abajo. Sin limpiar los asteriscos, el ancla
    // de campoTrasEtiqueta no matchea y el monto sale null: eso mandó los 11
    // correos de Yape a 'revisar-manual' entre agosto y setiembre de 2026.
    const monto = parseMonto(campoTrasEtiqueta(ls, 'Monto de yapeo'));
    // Varios campos vienen aplastados en un solo renglón: se leen del cuerpo
    // plano acotando cada valor con la etiqueta siguiente.
    const plano = nbody.replace(/\s+/g, ' ');
    const mFecha = plano.match(/Fecha y Hora de la operacion\s+(.+?)\s+Celular del Beneficiario/i);
    const fecha = parseFechaLarga(mFecha ? mFecha[1] : '') || fechaEnLima(date);
    if (!monto || !fecha) throw new FormatoNoReconocidoError(slug, 'yapeo saliente sin monto/fecha');

    // "Nombre del Beneficiario" solo sirve como comercio si NO es el titular:
    // en los correos de julio de 2026 traía a la dueña de la cuenta (igual que
    // "Yapero"), y en los de agosto trae el comercio real. Comparar contra el
    // yapero resuelve los dos casos sin adivinar.
    const mBenef = plano.match(/Nombre del Beneficiario\s+(.+?)\s+N.? de operacion/i);
    const mYapero = plano.match(/Yapero\s+(.+?)\s+Tu numero de celular/i);
    const benef = mBenef ? mBenef[1].trim() : null;
    const yapero = mYapero ? mYapero[1].trim() : null;
    const comercio = (benef && benef !== yapero) ? benef : null;

    const mOp = plano.match(/N.? de operacion\s+(\d+)/i);
    return {
      banco: slug, tipo: 'gasto', monto, moneda: 'PEN',
      comercio, fecha, contraparte: comercio,
      operacion: mOp ? mOp[1] : null,
      p2p: true, ultimos4: null,
    };
  }
```

y arriba, en la construcción de `ls`:

```js
  const ls = lineasPlanas(body);
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test test/ingest-parsers.test.mjs`
Expected: PASS — incluidos los tests viejos de Yape del 2026-07-14, que no deben romperse.

- [ ] **Step 5: Commit**

```bash
git add workers/ingest/parsers/yape.js test/ingest-parsers.test.mjs
git commit -m "fix(parsers): el yapeo saliente vuelve a parsear monto y comercio"
```

---

### Task B4: Recarga de Yape → gasto

**Files:**
- Modify: `workers/ingest/parsers/yape.js`
- Test: `test/ingest-parsers.test.mjs`

- [ ] **Step 1: Escribir el test que falla**

```js
// Fragmento VERBATIM del correo real del 2026-08-30.
const YAPE_RECARGA_2026_08 = `*S/* 7

Número recargado:

910 735 153 

Yapero:

Darling Gabriela Meza Reyes

Número de yapero:

*** *** 153

Fecha:

30 ago. 2026 - 10:29 a. m.

Operadora:

Bitel

Nº de operación Yape:

00629341
`;

test('yape: recarga de celular → gasto con la operadora como comercio', () => {
  const p = parse('yape', {
    subject: 'Tu recarga en Yape ha sido confirmada',
    body: YAPE_RECARGA_2026_08,
    date: '2026-08-30T15:29:00Z',
  });
  assert.equal(p.tipo, 'gasto');
  assert.equal(p.monto, 7);
  assert.equal(p.moneda, 'PEN');
  assert.equal(p.fecha, '2026-08-30');
  assert.equal(p.comercio, 'Recarga Bitel');
  assert.equal(p.p2p, false);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/ingest-parsers.test.mjs`
Expected: FAIL — `FormatoNoReconocidoError: formato no reconocido: tu recarga en yape ha sido confirmada`

- [ ] **Step 3: Implementar**

En `workers/ingest/parsers/yape.js`, añadir la rama **antes** del `throw` final:

```js
  // Recarga de celular → gasto. El monto va en la primera línea ("*S/* 7"),
  // ya sin asteriscos por lineasPlanas; la operadora y la fecha van bajo sus
  // etiquetas, con el valor dos líneas abajo.
  if (/recarga en yape/.test(subj)) {
    const primera = ls.find((l) => /^S\/\s*[\d.,]+$/.test(l));
    const monto = parseMonto(primera);
    const operadora = campoTrasEtiqueta(ls, 'Operadora:');
    const fecha = parseFechaLarga(campoTrasEtiqueta(ls, 'Fecha:') || '') || fechaEnLima(date);
    if (!monto || !fecha) throw new FormatoNoReconocidoError(slug, 'recarga sin monto/fecha');
    return {
      banco: slug, tipo: 'gasto', monto, moneda: 'PEN',
      comercio: operadora ? ('Recarga ' + operadora) : 'Recarga',
      fecha, contraparte: null,
      operacion: campoTrasEtiqueta(ls, 'N. de operacion Yape:'),
      // Una recarga es consumo de un servicio, no una transferencia entre
      // personas: p2p false para que no entre en la lógica de contrapartes.
      p2p: false, ultimos4: null,
    };
  }
```

> El comercio queda como `Recarga Bitel`: el token `recarga` ya está en el diccionario semilla de `js/autocat.js` mapeado a **Servicios**, así que la sugerencia de categoría sale sola.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test test/ingest-parsers.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workers/ingest/parsers/yape.js test/ingest-parsers.test.mjs
git commit -m "feat(parsers): recargas de Yape se parsean como gasto"
```

---

### Task B5: BBVA — "Constancia de pago a comercios con QR"

**Files:**
- Modify: `workers/ingest/parsers/bbva.js`
- Test: `test/ingest-parsers.test.mjs`

- [ ] **Step 1: Escribir el test que falla**

```js
// Fragmento VERBATIM del correo real del 2026-09-01 (bandeja de Christian).
const BBVA_QR_2026_09 = `BBVA

Hola, CHRISTIAN

Has realizado con éxito la operación: 

Pagar con QR

Importe pagado 

S/ 2.00

<#>
DETALLES DE LA OPERACIÓN 

Titular de la tarjeta 

CHRISTIAN SANCHEZ

Titular de la cuenta 

Tipo de operación 

Pagar con QR

Fecha de la operación 

1 de septiembre, 2026

Comercio 

IZI*GLASE

Forma de pago 

VISA COMPRAS

Número de tarjeta 

• 1902
`;

test('bbva: pago con QR a comercio → gasto', () => {
  const p = parse('bbva', {
    subject: 'BBVA - Constancia de pago a comercios con QR',
    body: BBVA_QR_2026_09,
    date: '2026-09-01T14:00:00Z',
  });
  assert.equal(p.tipo, 'gasto');
  assert.equal(p.monto, 2);
  assert.equal(p.moneda, 'PEN');
  assert.equal(p.fecha, '2026-09-01');
  assert.equal(p.comercio, 'IZI*GLASE');
  assert.equal(p.ultimos4, '1902');
  assert.equal(p.p2p, false);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/ingest-parsers.test.mjs`
Expected: FAIL — `FormatoNoReconocidoError: asunto no reconocido: bbva - constancia de pago a comercios con qr`

- [ ] **Step 3: Implementar**

En `workers/ingest/parsers/bbva.js`, añadir la rama después de la de PLIN y antes del `throw` final:

```js
  // Pago con QR a comercio. Mismo layout que el resto de BBVA: etiqueta en una
  // línea, valor dos líneas abajo — campoTrasEtiqueta ya lo resuelve.
  // OJO: es distinto de "transferencia PLIN con QR" (P2P): acá hay comercio y
  // tarjeta, no una persona destino.
  if (/pago a comercios con qr/.test(subj)) {
    const monto = parseMonto(campoTrasEtiqueta(ls, 'Importe pagado'));
    const fecha = parseFechaLarga(campoTrasEtiqueta(ls, 'Fecha de la operacion') || '')
      || fechaEnLima(date);
    if (!monto || !fecha) throw new FormatoNoReconocidoError(slug, 'QR sin monto/fecha');
    const comercio = campoTrasEtiqueta(ls, 'Comercio');
    return {
      banco: slug, tipo: 'gasto', monto, moneda: 'PEN',
      comercio: comercio || null, fecha, contraparte: null,
      operacion: campoTrasEtiqueta(ls, 'ID de compra'),
      p2p: false,
      ultimos4: ultimos4De(campoTrasEtiqueta(ls, 'Numero de tarjeta')),
    };
  }
```

> `normalizar()` quita las tildes, por eso las etiquetas van sin ellas (`Fecha de la operacion`, `Numero de tarjeta`).

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test test/ingest-parsers.test.mjs`
Expected: PASS

- [ ] **Step 5: Correr toda la suite**

Run: `for f in test/*.test.mjs; do node --test "$f" || echo "FAIL $f"; done`
Expected: sin líneas `FAIL`.

- [ ] **Step 6: Commit**

```bash
git add workers/ingest/parsers/bbva.js test/ingest-parsers.test.mjs
git commit -m "feat(parsers): BBVA pago con QR a comercios se parsea como gasto"
```

---

### Task B6: Desplegar el Worker de ingesta

**Files:**
- No modifica archivos: es despliegue.

- [ ] **Step 1: Verificar que la suite está verde antes de desplegar**

Run: `node --test test/ingest-parsers.test.mjs`
Expected: `# fail 0`

- [ ] **Step 2: Desplegar**

```bash
cd workers/ingest && npx wrangler deploy
```

Expected: la salida termina con la URL del Worker y un `Current Version ID`.

- [ ] **Step 3: Verificar contra correos reales**

Esperar a que entre un correo nuevo de cada tipo y consultar (vía `mcp__supabase__execute_sql`, solo lectura):

```sql
select estado, banco, tipo, monto, comercio, fecha, left(raw_subject, 60) asunto
from public.ingest_pendientes
where created_at > now() - interval '2 days'
order by created_at desc limit 20;
```

Expected: los correos de Yape nuevos entran con `estado = 'pendiente'` y `monto` no nulo, no como `revisar-manual`.

- [ ] **Step 4: PR de la etapa**

```bash
git push -u origin fix/parsers-yape-bbva-qr
gh pr create --title "fix(parsers): Yape saliente/recarga y BBVA pago QR" --body "Cierra los tres formatos que hoy caen a revisar-manual. Causa raíz del yapeo saliente: la etiqueta viene con asteriscos de negrita y el ancla de campoTrasEtiqueta no matcheaba. Fixtures verbatim del 2026-08-30 y 2026-09-01."
```

> El Worker se despliega aparte de Pages: mergear el PR no lo actualiza. El deploy del Step 2 es el que cuenta.

---

# ETAPA C — Que la suscripción push se repare sola

**Causa raíz verificada:** `supabase/functions/enviar-notificaciones/index.ts:147-148` borra la fila de `push_subscriptions` cuando el servicio de push responde 410 o 404 — comportamiento correcto para no acumular endpoints muertos. Pero **nada del lado del cliente vuelve a crear la fila**, y el toggle de configuración pinta su estado con `pushIsSubscribed()`, que consulta `pushManager.getSubscription()` **del navegador**, no la base. Resultado: el navegador puede seguir devolviendo un objeto de suscripción mientras la fila ya no existe, el toggle muestra "activo", y el cron notifica a cero destinatarios sin que nada lo delate. Eso es lo que hay hoy: `push_subscriptions` con 0 filas y push aparentemente encendido.

El arreglo es reconciliar las dos fuentes en cada arranque.

---

### Task C1: `pushEstadoServidor()` y `pushReconciliar()`

**Files:**
- Modify: `js/push.js`

- [ ] **Step 1: Implementar las dos funciones**

Añadir al final de `js/push.js`, antes de nada que dependa de ellas:

```js
// pushEstadoServidor() — ¿existe la fila de ESTE navegador en la base?
// Distinto de pushIsSubscribed(), que solo mira el navegador. La Edge Function
// borra la fila ante un 410/404 del servicio de push (endpoint expirado), y sin
// esta consulta el cliente no se entera: el toggle sigue en "activo" y el cron
// notifica a nadie. Returns: true | false | null (null = no se pudo saber).
async function pushEstadoServidor() {
  if (!pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return false;
    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('endpoint')
      .eq('endpoint', sub.endpoint)
      .maybeSingle();
    if (error) return null;
    return !!data;
  } catch (e) {
    console.error('pushEstadoServidor:', e);
    return null;
  }
}

// pushReconciliar() — arregla la deriva entre navegador y base, en silencio.
// Se llama en cada arranque con sesión activa. NUNCA pide permiso: si el
// usuario nunca lo concedió, no hay nada que reparar y no se le molesta.
// Returns: 'sin-permiso' | 'ok' | 'reparado' | 'fallo'.
async function pushReconciliar() {
  if (!pushSupported()) return 'sin-permiso';
  if (Notification.permission !== 'granted') return 'sin-permiso';
  const userId = await _currentUserId();
  if (!userId) return 'sin-permiso';

  const enServidor = await pushEstadoServidor();
  if (enServidor === true) return 'ok';
  if (enServidor === null) return 'fallo';   // sin red o error: no tocar nada

  // El permiso está concedido pero la fila no está. Puede faltar la
  // suscripción del navegador (endpoint expirado) o solo la fila. pushSubscribe
  // resuelve los dos casos: reutiliza la suscripción viva si la hay, crea una
  // nueva si no, y hace upsert por endpoint.
  const res = await pushSubscribe();
  return res.ok ? 'reparado' : 'fallo';
}

if (typeof window !== 'undefined') {
  window.pushEstadoServidor = pushEstadoServidor;
  window.pushReconciliar = pushReconciliar;
}
```

> `pushSubscribe()` ya llama a `Notification.requestPermission()`, pero con el permiso en `granted` esa llamada resuelve de inmediato sin mostrar nada al usuario. Por eso el gate de `granted` en `pushReconciliar()` es lo que garantiza que la reparación sea silenciosa.

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check js/push.js`
Expected: sin salida.

- [ ] **Step 3: Commit**

```bash
git add js/push.js
git commit -m "feat(push): reconciliar la suscripción del navegador con la base"
```

---

### Task C2: Llamar a `pushReconciliar()` en el arranque

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Ubicar el punto donde la app ya tiene sesión**

Run: `grep -n "onAuthStateChange\|getSession\|SIGNED_IN" index.html js/auth.js`
Expected: el punto donde la app confirma sesión y arranca el router.

- [ ] **Step 2: Añadir la llamada**

Justo después de que la sesión quede confirmada (y después de que el service worker esté registrado):

```html
    <script type="module">
      // Reparar la suscripción push si el permiso está concedido pero la fila
      // de la base desapareció (la Edge Function la borra ante un 410 del
      // servicio de push). Silencioso y sin bloquear el arranque.
      window.addEventListener('load', function () {
        if (typeof pushReconciliar !== 'function') return;
        pushReconciliar().then(function (r) {
          if (r === 'reparado') console.info('push: suscripción restaurada');
        }).catch(function (e) { console.error('pushReconciliar:', e); });
      });
    </script>
```

> Va colgado de `load` y con `.catch()`: la reconciliación no debe retrasar ni romper el primer render.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(push): reconciliar la suscripción en cada arranque"
```

---

### Task C3: El toggle de configuración refleja el servidor

**Files:**
- Modify: `views/configuracion.html`

- [ ] **Step 1: Cambiar la fuente de verdad del toggle**

En `views/configuracion.html`, dentro de `initPushToggle()`, reemplazar:

```js
      paintPush(await pushIsSubscribed());
```

por:

```js
      // El navegador puede tener una suscripción viva cuya fila la Edge
      // Function ya borró (410). Lo que decide si las notificaciones llegan de
      // verdad es la fila en la base, así que el toggle pinta eso.
      // null (sin red) → caer al estado del navegador, que es mejor que mentir
      // con "apagado" cuando probablemente esté bien.
      var srv = await pushEstadoServidor();
      paintPush(srv === null ? await pushIsSubscribed() : srv);
```

Hacer el mismo reemplazo en la línea que repinta después de activar o desactivar (`paintPush(await pushIsSubscribed());` al final del handler del toggle).

- [ ] **Step 2: Bumpear el shell**

En `sw.js`: `const SHELL_VERSION = 'v44';`

- [ ] **Step 3: Verificar en el navegador**

Levantar el preview, entrar a `#configuracion`:

1. Con push apagado, el toggle está en off.
2. Activarlo → conceder permiso → el toggle queda en on.
3. Confirmar la fila en la base (`mcp__supabase__execute_sql`, solo lectura):

```sql
select endpoint, left(user_agent, 40) ua, created_at
from public.push_subscriptions order by created_at desc;
```

Expected: 1 fila.

4. Borrar la fila a mano para simular el 410, recargar la app, y comprobar que `pushReconciliar()` la vuelve a crear (misma consulta → 1 fila otra vez, y `push: suscripción restaurada` en consola).

- [ ] **Step 4: Verificar que la notificación llega de punta a punta**

Invocar la Edge Function una vez y confirmar que llega el aviso al teléfono:

```bash
curl -s -X POST "https://ombnhxueclqfeyjzhroz.supabase.co/functions/v1/enviar-notificaciones" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

Expected: HTTP 200 y una notificación en el dispositivo suscrito.

> Requiere `SUPABASE_ANON_KEY` en el entorno. No pegar la clave en el repo ni en el historial de comandos compartido.

- [ ] **Step 5: Correr toda la suite**

Run: `for f in test/*.test.mjs; do node --test "$f" || echo "FAIL $f"; done`
Expected: sin líneas `FAIL`.

- [ ] **Step 6: Commit y PR**

```bash
git add views/configuracion.html sw.js
git commit -m "fix(push): el toggle refleja la suscripción real, no la del navegador"
git push -u origin fix/push-reconciliar
gh pr create --title "fix(push): la suscripción se repara sola" --body "push_subscriptions estaba en 0 filas: la Edge Function borra la fila ante un 410 y nada del cliente la recreaba. Añade reconciliación en el arranque y hace que el toggle mire la base, no el navegador."
```

- [ ] **Step 7: Verificar el deploy live**

```bash
curl -sL "https://nestra-8rl.pages.dev/sw.js?cb=$RANDOM" | grep SHELL_VERSION
```

Expected: `const SHELL_VERSION = 'v44';`

> En el teléfono puede hacer falta cerrar y reabrir la PWA para que tome el shell nuevo.

---

## Higiene previa (antes de empezar la Etapa A)

- [ ] **Poner el worktree al día y commitear las notas sueltas**

El branch local está un commit detrás de `origin/main` (falta el merge commit del PR #27), y `CLAUDE.md` tiene las notas de latencia de push sin commitear.

```bash
git add CLAUDE.md
git commit -m "docs: medición de latencia de enviar-notificaciones"
git fetch origin && git rebase origin/main
```

- [ ] **Verificar el punto de partida**

Run: `for f in test/*.test.mjs; do node --test "$f" || echo "FAIL $f"; done`
Expected: sin líneas `FAIL` (verificado el 2026-09-01: 29 archivos, 0 fallos).
