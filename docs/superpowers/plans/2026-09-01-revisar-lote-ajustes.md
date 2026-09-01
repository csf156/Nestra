# Ajustes al modo lote de #revisar — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los cuatro puntos que el usuario levantó al probar el PR #29 en local: que "Marcar sugeridas" funcione en cualquier navegador, que confirmar en lote se pueda deshacer, que los checkboxes se vean como el resto de la app, y que el chip "Sin categoría" abra un buscador flotante en vez de expandir la card entera.

**Architecture:** Cuatro tasks sobre la rama `feat/revisar-lote` (PR #29 abierto, sin mergear). La sugerencia deja de depender solo de IndexedDB: se añade un mapa construido desde el servidor que se fusiona en el mismo `_learned` que ya consume `matchCategoria`, así el scoring no cambia. El undo del lote reutiliza la cola de undo existente generalizando su item de una fila a N. El buscador flotante reutiliza `searchableSelect()`, que ya existe y ya usan `#transaccion` y `#configuracion`; sus estilos se mueven a `css/components.css` para que sean compartidos.

**Tech Stack:** PWA vanilla sin build, `node:test` para lógica pura, Supabase PostgREST (embedding por FK), IndexedDB vía `js/nestra-db.js`.

---

## Contexto: qué se probó y qué salió

El usuario probó el PR #29 en `http://localhost:5050` contra sus 92 pendientes reales. Resultados:

| Reporte | Veredicto |
|---|---|
| "Marcar sugeridas no marca nada" | **No es bug de esta rama** — ver diagnóstico abajo. Pero destapa una fragilidad real que sí se arregla acá (Task A4). |
| "Marcar a mano suma correctamente" | Funciona. |
| "Tras confirmar debería aparecer el deshacer flotante" | Cambio de decisión del usuario. Se implementa (Task A5). |
| "Formato desconocido no tiene checkbox" | Correcto por diseño. No se toca. |
| "Los checkboxes no guardan correlación con el diseño" | Cierto: son checkboxes nativos en una app que no usa controles nativos (Task A6). |
| "El chip Sin categoría abre todo el modal; debería abrir el combo flotante con buscador" | Se implementa (Task A7). |

### Diagnóstico de "Marcar sugeridas no marca nada"

El mapa aprendido (`comercio → categoría`) vive **solo en IndexedDB**, store `autocat_tok` (`js/nestra-db.js:36`). `autocatLearnTokens()` (`js/nestra-db.js:117`) escribe únicamente en local y **no hay espejo en el servidor** — se verificó: `autocat` no aparece en `js/db.js` salvo como llamada de escritura, ni en `sync.js`, ni en ninguna migración.

IndexedDB está aislado por origen. `http://localhost:5050` ≠ `https://nestra-8rl.pages.dev`, así que en local `_learned` está vacío y solo quedan el diccionario semilla de `js/autocat.js` y los nombres de categoría. Los comercios reales del usuario (`EVELIN M GARCES L`, `DLC*RAPPI PERU`, `IZI*GLASE`) no tokenizan a ninguna semilla → cero sugerencias → cero marcadas.

En producción, sobre su navegador de siempre, marcaría unas 25. **La fragilidad real:** en un navegador nuevo, en otro dispositivo, o tras limpiar datos del sitio, la función marca cero y parece rota. Para algo cuyo propósito es el lote, es una trampa. Por eso se añade el mapa desde servidor.

**Fuera de alcance:** sincronizar `autocat_tok` completo al servidor. Eso es un subsistema de sincronización propio (LWW, conflictos, volumen) y no hace falta: reconstruir el mapa desde los pendientes ya confirmados da el mismo resultado práctico con una query.

---

## Estructura de archivos

- Modificar: `js/db.js` — `getMapaComercioCategoria()`.
- Modificar: `js/autocat.js` — `mergeLearned()`, función pura.
- Modificar: `test/autocat.test.mjs` — tests de `mergeLearned`.
- Modificar: `views/revisar.html` — fusión del mapa, undo del lote, estilo de checkbox, chip → buscador.
- Modificar: `views/transaccion.html` — se le quitan los estilos `.ss-*` (se mueven).
- Modificar: `css/components.css` — recibe los estilos `.ss-*` compartidos.
- Modificar: `supabase/tests/schema_contract_test.sql` — alta de la query nueva si aplica.
- Modificar: `sw.js` — `SHELL_VERSION` a `v44`.

---

### Task A4: La sugerencia deja de depender del navegador

**Files:**
- Modify: `js/db.js`
- Modify: `js/autocat.js`
- Test: `test/autocat.test.mjs`
- Modify: `views/revisar.html`

- [ ] **Step 1: Escribir el test que falla**

Añadir en `test/autocat.test.mjs` (importar `mergeLearned` en la cabecera junto a lo que ya se importe de `../js/autocat.js`):

```js
test('mergeLearned: suma entradas nuevas al mapa vacío', () => {
  const out = mergeLearned({}, [{ texto: 'LA PANERA CAFE', categoria_id: 'cat-comida', peso: 2 }]);
  // "la"/"cafe"/"panera" → tokens; "la" es stopword y se cae.
  assert.equal(out.panera['cat-comida'], 2);
  assert.equal(out.cafe['cat-comida'], 2);
  assert.equal(out.la, undefined);
});

test('mergeLearned: acumula sobre lo ya aprendido, no lo pisa', () => {
  const previo = { panera: { 'cat-comida': 5 } };
  const out = mergeLearned(previo, [{ texto: 'PANERA', categoria_id: 'cat-comida', peso: 2 }]);
  assert.equal(out.panera['cat-comida'], 7);
});

test('mergeLearned: lo aprendido en el navegador pesa más que lo del servidor', () => {
  // El mapa local viene de confirmaciones explícitas del usuario en ESTE
  // navegador; el del servidor es reconstruido. Ante empate manda el local.
  const previo = { rappi: { 'cat-a': 3 } };
  const out = mergeLearned(previo, [{ texto: 'RAPPI', categoria_id: 'cat-b', peso: 1 }]);
  assert.ok(out.rappi['cat-a'] > out.rappi['cat-b']);
});

test('mergeLearned: entradas inservibles se ignoran sin romper', () => {
  const out = mergeLearned({}, [
    { texto: '', categoria_id: 'cat-a', peso: 1 },
    { texto: 'ALGO', categoria_id: null, peso: 1 },
    null,
  ]);
  assert.deepEqual(out, {});
});

test('mergeLearned: no muta el mapa recibido', () => {
  const previo = { panera: { 'cat-comida': 5 } };
  mergeLearned(previo, [{ texto: 'PANERA', categoria_id: 'cat-comida', peso: 2 }]);
  assert.equal(previo.panera['cat-comida'], 5);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/autocat.test.mjs`
Expected: FAIL — `mergeLearned is not a function`

- [ ] **Step 3: Implementar `mergeLearned` en `js/autocat.js`**

Añadir después de `scoreCategorias`:

```js
// mergeLearned(learned, entradas) → mapa nuevo token → { catId: freq }.
// Fusiona sin mutar. `entradas`: [{ texto, categoria_id, peso }].
// Existe porque el mapa aprendido vive solo en IndexedDB y por tanto es por
// navegador y por origen: en un dispositivo nuevo está vacío y las sugerencias
// desaparecen. Reconstruyendo desde los pendientes ya confirmados en el
// servidor, la sugerencia deja de depender de dónde estés.
function mergeLearned(learned, entradas) {
  var out = {};
  for (var tok in (learned || {})) out[tok] = Object.assign({}, learned[tok]);
  (entradas || []).forEach(function (e) {
    if (!e || !e.texto || !e.categoria_id) return;
    var peso = Number(e.peso) > 0 ? Number(e.peso) : 1;
    tokenize(e.texto).forEach(function (tok) {
      if (!out[tok]) out[tok] = {};
      out[tok][e.categoria_id] = (out[tok][e.categoria_id] || 0) + peso;
    });
  });
  return out;
}
```

Añadirla al bloque `window.*` y al `export` del final del archivo.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test test/autocat.test.mjs`
Expected: PASS

> Si el tercer test falla, revisa el peso que le das al servidor en el Step 6: tiene que ser menor que el que `autocatLearnTokens` usa para lo aprendido en el navegador.

- [ ] **Step 5: `getMapaComercioCategoria()` en `js/db.js`**

`ingest_pendientes.transaccion_id` tiene FK a `transacciones.id` (constraint `ingest_pendientes_transaccion_id_fkey`, verificado el 2026-09-01), así que PostgREST puede embeber. Añadir junto a las demás funciones de ingesta:

```js
// getMapaComercioCategoria() — reconstruye comercio → categoría desde los
// pendientes YA confirmados y la categoría de la transacción que generaron.
// El mapa de autocat vive solo en IndexedDB (por navegador y por origen): en
// un dispositivo nuevo está vacío y "Marcar sugeridas" no marca nada. Esto lo
// reconstruye desde el servidor. Devuelve [] ante cualquier error: la
// sugerencia es una ayuda, nunca debe romper la vista.
async function getMapaComercioCategoria() {
  try {
    const userId = _requireUserId();
    const { data, error } = await supabase
      .from('ingest_pendientes')
      .select('comercio, contraparte, transacciones(categoria_id)')
      .eq('user_id', userId)
      .eq('estado', 'confirmado')
      .not('transaccion_id', 'is', null)
      .limit(500);
    if (error) throw error;
    return (data || [])
      .map((r) => ({
        texto: r.comercio || r.contraparte || '',
        categoria_id: r.transacciones && r.transacciones.categoria_id,
      }))
      .filter((r) => r.texto && r.categoria_id);
  } catch (err) {
    console.error('getMapaComercioCategoria():', err.message || err);
    return [];
  }
}
```

- [ ] **Step 6: Fusionar el mapa en `init()` de `views/revisar.html`**

En `init()`, donde hoy dice `if (typeof autocatLearned === 'function') _learned = await autocatLearned();`, dejar:

```js
      if (typeof autocatLearned === 'function') _learned = await autocatLearned();
      // El mapa local es por navegador y por origen: en un dispositivo nuevo
      // está vacío. Se completa con lo reconstruido desde el servidor, con
      // peso 1 para que NUNCA le gane a lo aprendido acá (autocatLearnTokens
      // acumula de a 1 por confirmación, así que un comercio confirmado dos
      // veces en este navegador pesa más que el eco del servidor).
      if (typeof getMapaComercioCategoria === 'function' && typeof mergeLearned === 'function') {
        try {
          var delServidor = await getMapaComercioCategoria();
          _learned = mergeLearned(_learned, delServidor.map(function (e) {
            return { texto: e.texto, categoria_id: e.categoria_id, peso: 1 };
          }));
        } catch (e) { console.error('mapa de servidor:', e); }
      }
```

- [ ] **Step 7: Añadir la función al guard de dependencias**

En la lista `faltan` de la IIFE, añadir `'getMapaComercioCategoria'` y `'mergeLearned'`.

- [ ] **Step 8: Verificar en navegador**

Con el preview en `localhost:5050` (origen sin mapa local, que es justo el caso que se quiere arreglar):

1. Entrar a `#revisar` y tocar "Marcar sugeridas".
2. Debe marcar filas cuyo comercio ya fue confirmado antes (`LA PANERA CAFE`, `DLC*RAPPI PERU` y similares).
3. Consola sin errores.

> Este es el criterio de aceptación de la task: antes marcaba **cero** en localhost. Si sigue marcando cero, el mapa no se está fusionando — revisa el Step 6 antes de seguir.

- [ ] **Step 9: Commit**

```bash
git add js/db.js js/autocat.js test/autocat.test.mjs views/revisar.html
git commit -m "feat(revisar-lote): la sugerencia ya no depende del navegador"
```

---

### Task A5: Deshacer el lote con un solo toast

El undo actual (`_undoQueue`, `quitarCardConUndo`, `deshacer`, `finalizarItem`, `renderToast`) maneja **una fila por item**. Para el lote se generaliza el item a N filas, en vez de encolar N items — 25 toasts encolados serían inservibles, que es la razón por la que el lote salió sin undo en el plan original.

**Files:**
- Modify: `views/revisar.html`

- [ ] **Step 1: Generalizar el item de la cola**

El item pasa de `{ i, ctx, timerId }` a `{ is: [i...], ctx, timerId }`, y `ctx` de un pendiente a varios. Reemplazar `quitarCardConUndo` por una versión que acepta ambos casos:

```js
  // quitarCardsConUndo(indices, ctx) — oculta N cards y encola UN solo item de
  // undo para todas. El camino de a una pasa un array de largo 1: así hay una
  // sola ruta de código y el lote no puede divergir del gesto individual.
  // ctx: { accion, pendientes: [{ pendienteId, estadoOriginal }], txIds: [] }
  function quitarCardsConUndo(indices, ctx) {
    indices.forEach(function (i) {
      var card = document.getElementById('revCard' + i);
      if (card) card.style.display = 'none';
    });
    if (typeof actualizarIngestBadge === 'function') actualizarIngestBadge();
    var item = { is: indices.slice(), ctx: ctx, timerId: null };
    item.timerId = setTimeout(function () { finalizarItem(item); }, 7000);
    _undoQueue.push(item);
    renderToast();
  }
```

- [ ] **Step 2: Adaptar los dos llamadores de a una**

En `confirmar(i, btn)`, reemplazar la llamada actual por:

```js
      quitarCardsConUndo([i], {
        accion: 'confirmar',
        pendientes: [{ pendienteId: p.id, estadoOriginal: p.estado }],
        txIds: txIds,
      });
```

En `descartar(i, btn)`:

```js
      quitarCardsConUndo([i], {
        accion: 'descartar',
        pendientes: [{ pendienteId: _filas[i].id, estadoOriginal: _filas[i].estado }],
        txIds: [],
      });
```

- [ ] **Step 3: Adaptar `deshacer()`**

```js
  async function deshacer() {
    var item = _undoQueue.pop();
    if (!item) return;
    clearTimeout(item.timerId);
    var ctx = item.ctx;
    try {
      if (ctx.accion === 'confirmar') {
        for (var k = 0; k < (ctx.txIds || []).length; k++) {
          if (ctx.txIds[k]) await deleteTransaccion(ctx.txIds[k]);
        }
      }
      for (var j = 0; j < ctx.pendientes.length; j++) {
        await revertirIngestPendiente(ctx.pendientes[j].pendienteId, ctx.pendientes[j].estadoOriginal);
      }
      item.is.forEach(function (i) {
        var card = document.getElementById('revCard' + i);
        if (card) card.style.display = '';
      });
      if (typeof actualizarIngestBadge === 'function') actualizarIngestBadge();
      pintarBarraLote();
      renderToast();
    } catch (e) {
      console.error('deshacer falló:', e);
      errGlobal.textContent = 'No se pudo deshacer. Revisa #historial.';
      errGlobal.style.display = 'block';
    }
  }
```

- [ ] **Step 4: Adaptar `finalizarItem()`**

```js
  function finalizarItem(item) {
    var idx = _undoQueue.indexOf(item);
    if (idx !== -1) _undoQueue.splice(idx, 1);
    item.is.forEach(function (i) {
      var card = document.getElementById('revCard' + i);
      if (card) card.remove();
      _filas[i] = null;
    });
    if (!_filas.some(Boolean)) renderVacio();
    pintarBarraLote();
    renderToast();
  }
```

> Confirma cómo termina el `finalizarItem` actual antes de reescribirlo (puede llamar a `renderVacio()` u otras cosas al final) y conserva ese comportamiento.

- [ ] **Step 5: Adaptar `renderToast()` para el caso lote**

```js
  function renderToast() {
    var t = document.getElementById('revUndoToast');
    var n = _undoQueue.length;
    if (n === 0) { t.classList.remove('is-open'); return; }
    var msg = t.querySelector('.rev-undo-msg');
    if (n === 1) {
      var c = _undoQueue[0];
      var cuantos = c.is.length;
      msg.textContent = cuantos > 1
        ? (cuantos + ' confirmadas')
        : (c.ctx.accion === 'confirmar' ? 'Confirmado' : 'Descartado');
    } else {
      msg.textContent = n + ' movimientos revisados';
    }
    t.classList.add('is-open');
  }
```

- [ ] **Step 6: `confirmarLote` usa el undo en vez de quitar las cards a secas**

En `confirmarLote`, reemplazar el bloque que hoy hace `quitarCard(i)` en bucle y llama a `mostrarToastLote`, por:

```js
      var okIds = {}, txIds = [], pendientes = [], indices = [];
      res.forEach(function (r) {
        if (!r.ok) return;
        okIds[r.id] = true;
        if (r.transaccionId) txIds.push(r.transaccionId);
      });
      for (var i = 0; i < _filas.length; i++) {
        if (_filas[i] && okIds[_filas[i].id]) {
          indices.push(i);
          pendientes.push({ pendienteId: _filas[i].id, estadoOriginal: _filas[i].estado });
        }
      }
      var fallidas = res.length - indices.length;
      if (indices.length) {
        quitarCardsConUndo(indices, { accion: 'confirmar', pendientes: pendientes, txIds: txIds });
      }
      pintarBarraLote();
      if (fallidas) mostrarToastLote(indices.length, fallidas);
```

`mostrarToastLote` se conserva **solo** para el caso de fallos parciales: el éxito ya lo comunica el toast de undo.

- [ ] **Step 7: Verificar en navegador — incluida la NO regresión del gesto de a una**

Esta task toca el camino que ya estaba en producción, y la vista no tiene tests. Verificar los cuatro casos:

1. **Lote:** marcar 3, Confirmar → toast "3 confirmadas · Deshacer" → Deshacer → las 3 cards vuelven, el badge sube de nuevo, y las 3 transacciones desaparecen de `#historial`.
2. **Lote sin deshacer:** confirmar y dejar pasar los 7s → las cards se van definitivamente.
3. **De a una, confirmar:** swipe a la derecha → toast "Confirmado" → Deshacer → la card vuelve.
4. **De a una, descartar:** swipe a la izquierda → toast "Descartado" → Deshacer → la card vuelve.

- [ ] **Step 8: Commit**

```bash
git add views/revisar.html
git commit -m "feat(revisar-lote): deshacer el lote completo con un solo toast"
```

---

### Task A6: Checkboxes con el lenguaje visual de la app

Los checkboxes son nativos del navegador. La app no usa controles nativos en ningún otro lado (ver `.cfg-toggle` en `views/configuracion.html`).

**Files:**
- Modify: `views/revisar.html`

- [ ] **Step 1: Estilar el input sin perder accesibilidad**

Se conserva el `<input type="checkbox">` real — foco por teclado, `aria-label`, y el `:checked` que la lógica ya consulta — y se le quita la apariencia nativa. Añadir junto a las reglas `.rev-*`:

```css
  /* Checkbox de selección: se conserva el input real (foco por teclado y
     :checked, del que depende indicesSeleccionados) y solo se le quita la
     apariencia nativa. La paleta sale de los tokens de la app. */
  .rev-check {
    appearance: none; -webkit-appearance: none;
    width: 1.15rem; height: 1.15rem; flex: 0 0 auto;
    margin: 0 .5rem 0 0;
    border: 1.5px solid var(--border-light);
    border-radius: 5px;
    background: var(--bg-light-secondary);
    cursor: pointer;
    display: inline-grid; place-content: center;
    transition: background-color .12s ease, border-color .12s ease;
  }
  .rev-check::before {
    content: ''; width: .6rem; height: .6rem;
    transform: scale(0); transition: transform .12s ease;
    box-shadow: inset 1rem 1rem var(--bg-light-secondary);
    clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%);
  }
  .rev-check:checked { background: var(--color-primary); border-color: var(--color-primary); }
  .rev-check:checked::before { transform: scale(1); }
  .rev-check:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
```

> **Los tres tokens de este snippet están verificados** contra `css/base.css` el 2026-09-01: `--color-primary` (#c9a84c en oscuro, #8a6d22 en claro), `--bg-light-secondary` y `--border-light` existen los tres. Se dice explícitamente porque ya van tres veces que un plan de esta serie citó variables inexistentes (`--color-text-muted`, `--color-surface`, `--color-border`) y hubo que sustituirlas durante la implementación.
>
> El check se dibuja con `box-shadow` del color de fondo sobre el primario: en oscuro queda azul-noche sobre oro, en claro blanco sobre oliva. Ambos contrastan — pero míralo en los dos temas en el Step 2, no lo des por hecho.

- [ ] **Step 2: Verificar en navegador**

1. El checkbox se ve como parte de la app, no como un control del sistema.
2. Marcado y desmarcado se distinguen claramente.
3. Tab lo enfoca y Espacio lo activa; el foco se ve.
4. Comprobar en claro y en oscuro (`resize_window` con `colorScheme`).

- [ ] **Step 3: Commit**

```bash
git add views/revisar.html
git commit -m "fix(revisar-lote): los checkboxes siguen el lenguaje visual de la app"
```

---

### Task A7: El chip "Sin categoría" abre un buscador flotante

Hoy el chip expande la card entera y enfoca el `<select>` (comportamiento que quedó del rediseño de julio, que eliminó el bottom-sheet). Debe abrir solo un combo flotante con lista de categorías y barra de búsqueda.

**No hay que construirlo:** `js/searchable-select.js` ya existe, es idempotente, y ya lo usan `#transaccion` y `#configuracion`. **Pero sus estilos `.ss-*` viven únicamente dentro de `views/transaccion.html` (línea ~673)**, así que usarlo en `#revisar` lo renderizaría sin estilo. Primero se comparten.

**Files:**
- Modify: `css/components.css`
- Modify: `views/transaccion.html`
- Modify: `views/revisar.html`

- [ ] **Step 1: Mover los estilos `.ss-*` a `css/components.css`**

Cortar de `views/transaccion.html` el bloque de reglas `.ss-wrap`, `.ss-input`, `.ss-input::placeholder`, `.ss-input:focus`, `.ss-list`, `.ss-item`, `.ss-item:hover, .ss-item.ss-active` (líneas ~673-713) y pegarlo tal cual al final de `css/components.css`, bajo un comentario:

```css
/* ── searchable-select (js/searchable-select.js) ──────────────────
   Compartido: lo usan #transaccion, #configuracion y #revisar. Vivía dentro
   de views/transaccion.html, lo que dejaba el componente sin estilo en
   cualquier otra vista que lo usara. */
```

`css/components.css` ya lo carga `index.html` (línea 47), así que no hace falta tocar el HTML.

- [ ] **Step 2: Verificar que `#transaccion` no se rompió**

Antes de seguir: abrir `#transaccion` en el preview y confirmar que el buscador de categoría se ve exactamente igual que antes. Si algo cambió, una regla se quedó atrás en el corte.

- [ ] **Step 3: El chip abre el buscador en vez de expandir la card**

En el listener de clicks de `views/revisar.html`, el bloque `[data-rev-chip]` hoy expande la card y enfoca el select. Reemplazar su cuerpo por:

```js
        if (chipBtn) {
          ev.stopPropagation();
          var i = Number(chipBtn.getAttribute('data-rev-chip'));
          abrirBuscadorCategoria(i);
          return;
        }
```

Y añadir la función junto a las demás de la vista:

```js
  // abrirBuscadorCategoria(i) — combo flotante con buscador sobre el <select>
  // de categoría de la fila i. searchableSelect es idempotente, así que se
  // aplica la primera vez y en las siguientes solo se reabre: por eso NO se
  // aplica a las 92 filas al renderizar, sino a la que el usuario toca.
  function abrirBuscadorCategoria(i) {
    var sel = document.getElementById('revCat' + i);
    if (!sel || typeof searchableSelect !== 'function') return;
    searchableSelect(sel, { placeholder: 'Buscar categoría…' });
    if (sel._ssSync) sel._ssSync();
    var wrap = sel.closest('.rev-card') && sel.closest('.rev-card').querySelector('.ss-wrap');
    var input = wrap && wrap.querySelector('.ss-input');
    if (input) { input.focus(); input.click(); }
  }
```

> Lee `js/searchable-select.js` antes de escribir esto para confirmar cómo se abre la lista: si expone un método propio o si basta con enfocar el input. Ajusta las dos últimas líneas a lo que el componente realmente haga; no adivines.

- [ ] **Step 4: Que elegir categoría actualice el chip y la barra**

El `change` del `<select>` ya está manejado (repinta el chip y le quita el estado `--sugerida`). Confirmar que sigue disparándose con el componente puesto — `searchable-select.js` documenta que "el `<select>` sigue siendo la fuente de verdad (value + evento change)". Si el chip no se actualiza al elegir, añadir `pintarBarraLote()` al handler de `change` para que la barra refleje que la fila pasó a ser loteable.

- [ ] **Step 5: Verificar en navegador**

1. Tocar el chip "Sin categoría" abre el buscador flotante, **no** expande la card.
2. Escribir filtra la lista.
3. Elegir una categoría actualiza el chip y la fila pasa a marcable en el lote.
4. `#transaccion` y `#configuracion` siguen funcionando igual (el componente es compartido).

- [ ] **Step 6: Bumpear el shell y commitear**

En `sw.js`: `const SHELL_VERSION = 'v44';`

```bash
git add css/components.css views/transaccion.html views/revisar.html sw.js
git commit -m "feat(revisar-lote): el chip de categoría abre el buscador flotante"
```

---

## Cierre

- [ ] **Suite completa**

Run: `for f in test/*.test.mjs; do node --test "$f" || echo "FAIL $f"; done`
Expected: sin líneas `FAIL`.

- [ ] **Actualizar el PR #29**

Los commits van sobre `feat/revisar-lote`, que ya tiene el PR abierto: al pushear se actualiza solo. **No pushear sin revisión previa** — el flujo acordado es que NESTRA BRAIN revisa y el usuario decide.
