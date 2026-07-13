# Quick-add como entrada principal + matcher de categoría por tokens (diseño)

Fecha: 2026-06-27
Estado: aprobado (brainstorming) → pendiente plan de implementación

## Objetivo

Hacer del registro por texto la entrada PRINCIPAL de transacciones, y mejorar la
inferencia de categoría para que acierte con categorías personalizadas y se adapte
al historial del usuario. Dos partes:

1. **FAB → quick-add primero, guardado directo.** El botón + (`#globalFab`) abre el
   modal en "modo rápido" (texto + chips + Agregar + link "Más opciones"). **Agregar
   parsea y guarda la transacción directamente** y muestra un **mensaje de
   confirmación** con monto, tipo y categoría resaltados, con acciones **Deshacer** y
   **Editar categoría**. El parser reconoce además **tipo** (gasto por defecto;
   `ingreso`/`ahorro` por keyword) y **ámbito** (personal por defecto; `hogar` por
   keyword). El form completo queda a un tap ("Más opciones").
2. **Matcher de categoría por tokens con scoring.** Reemplaza el matcher
   exacto/substring de `js/autocat.js` por uno que tokeniza la descripción y
   puntúa categorías combinando historial aprendido, nombre de categoría y
   diccionario semilla es-PE. Debe inferir incluso **sin historial** (capas +2/+1);
   el guardado directo solo cae al form cuando NO logra inferir (caso extremo).
   Offline, sin AI, testeable (TDD).

Todo offline-first sobre la base de Fase 1–3.

## Contexto actual

- FAB `#globalFab` en [index.html](../../../index.html): en dashboard/historial llama
  `abrirModalTransaccion()` que hace `fetch('views/transaccion.html')` y lo inyecta en
  el overlay `#transaccionModal`. En metas/prestamos llama otras acciones.
- Quick-add hoy: tarjeta `#qaForm` SOLO en el dashboard ([dashboard.html](../../../views/dashboard.html)),
  setea `window._quickAddPrefill` y abre el modal. **Se elimina** (el FAB la reemplaza).
- `views/transaccion.html` ya consume `_quickAddPrefill`, tiene chips de plantilla,
  split, foto, y un blur-handler de autocat sobre la nota.
- Matcher actual: `js/autocat.js` → `normalizeDesc`, `matchAutocat(descNorm, dict)`
  (igualdad exacta → substring), `KEYWORDS` (keyword→NOMBRE de categoría).
- Aprendizaje actual: `insertTransaccion` ([db.js](../../../js/db.js)) llama
  `autocatLearn(normalizeDesc(nota), categoria_id)`. Store IndexedDB `autocat`
  (keyPath `desc_norm`): `{desc_norm, categoria_id, count}`. `autocatDict()` → `{desc_norm: cat}`.
- `parse-quickadd.js` usa `autocat[descNorm]` (exacto) y luego `KEYWORDS` substring.

## Decisiones (brainstorming)

- Señales del matcher = **3 capas** (aprendido, nombre de categoría, dict semilla).
- **Sin** keywords manuales por categoría (YAGNI).
- Plural→singular **simple/conservador**.
- Umbral = 1; **empate → vacío** (el usuario elige → aprende).
- FAB abre **modo rápido** reusando el modal existente; quitar `#qaForm` del dashboard.
- **Agregar = guardar directo** (no preview). Confirmación con monto/tipo/categoría
  resaltados + acciones **Deshacer** (borra) y **Editar categoría** (desplegable inline).
- **Tipo** por keyword: gasto (default) / `ingreso` / `ahorro`. **Ámbito** por keyword:
  personal (default) / `hogar`. Keywords se quitan de la descripción.
- `ambito: 'hogar'` aquí = campo de la fila normal vía `insertTransaccion` (NO el
  "aporte al hogar" de 2 filas, que sigue siendo un checkbox aparte del form completo).
- Sin categoría inferida (gasto/ingreso) → abrir form prellenado (caso extremo). Ahorro
  guarda directo (sin categoría).
- `frontend-design` para el panel rápido **y el mensaje de confirmación**.

---

## PARTE A — Matcher de categoría por tokens

### A.1 Funciones puras (reescriben `js/autocat.js`)

`normalizeDesc(s)` — se conserva (lowercase, sin tildes, colapsa espacios).

`tokenize(desc)` → array de tokens:
- normaliza, separa por no-alfanumérico,
- descarta stopwords es-PE y tokens puramente numéricos (el monto ya se quitó antes, pero por seguridad),
- singular simple: si termina en `es` y `len>4` → quita `es`; si termina en `s` y `len>3` → quita `s` (irregulares como "luces" no se fuerzan).
- descarta tokens de `len<2`.

Stopwords es-PE (lista corta, ampliable):
`de, del, la, el, los, las, un, una, unos, unas, y, o, a, en, con, por, para, mi, mis, su, sus, lo, al`.

`scoreCategorias(tokens, { learned, categorias, seed })` → `{ [categoria_id]: score }`:
- `learned`: `{ token: { categoria_id: freq } }` (historial por token).
- `categorias`: `[{ id, nombre }]` (para matchear token ∈ nombre de categoría).
- `seed`: `{ token: NOMBRE_categoria }` (dict semilla es-PE; se resuelve a id por nombre).
- Por cada token, por cada categoría candidata, suma:
  - `+3 * freq` si `learned[token][cat]` existe,
  - `+2` si el token aparece en `normalizeDesc(categoria.nombre)` (tokenizado),
  - `+1` si `seed[token]` resuelve (por nombre) a esa categoría.

`matchCategoria(tokens, ctx, umbral = 1)` → `categoria_id | null`:
- calcula scores, toma el mayor; si `max >= umbral` y es **único** (sin empate al máximo) → ese id; si empate o `max < umbral` → `null`.

Todas puras, sin estado. `export {…}` + `window.*` (patrón share-parse). Determinista.

### A.2 Diccionario semilla
Reusar el contenido de `KEYWORDS` actual (token→NOMBRE categoría) como `seed`.
Se resuelve a `categoria_id` buscando por nombre en las categorías del usuario.

### A.3 Aprendizaje por token (IndexedDB v4)
- Nuevo store `autocat_tok` (keyPath `token`): `{ token, cats: { [categoria_id]: count } }`.
  - Razonó: un token puede mapear a varias categorías con distintas frecuencias;
    `cats` guarda el conteo por categoría → alimenta `+3*freq` y el empate.
- Bump `NESTRA_IDB_VERSION` 3 → 4; crear `autocat_tok` en `upgrade()` (idempotente).
- El store viejo `autocat` (desc→cat) queda sin uso; no se migra (dato local, poco valor). Se puede dejar o borrar en upgrade (preferible borrarlo para limpieza).
- Helpers nuevos en `nestra-db.js`:
  - `autocatLearnTokens(tokens, categoriaId)` — por cada token, `cats[catId] = (cats[catId]||0)+1`.
  - `autocatLearned()` → `{ token: { catId: freq } }` (lee todo `autocat_tok`).
- Eliminar/retirar `autocatLearn`/`autocatDict` (whole-desc) y sus usos.

### A.4 Parser: tipo, ámbito y categoría (`js/parse-quickadd.js`)
`parseQuickAdd(text, opts)` amplía su salida a:
`{ tipo, ambito, monto, descripcion, categoria_id, fecha }`. Pura; recibe `ctx` por `opts`.

Orden de extracción (cada token reconocido se quita de la descripción):
1. **Fecha** relativa (ya existe).
2. **Tipo**: si aparece token normalizado `ingreso` → `'ingreso'`; `ahorro` → `'ahorro'`;
   default `'gasto'`.
3. **Ámbito**: token `hogar` → `'hogar'`; `personal` → `'personal'`; default `'personal'`.
4. **Monto** (ya existe: S/ gana; si no, el mayor).
5. **Descripción** = resto tokenizable.
6. **Categoría**:
   - `tipo === 'ahorro'` → `categoria_id = null` (no lleva categoría).
   - si no → `matchCategoria(tokenize(descripcion), ctx)` con `ctx.categorias` **filtradas
     por el tipo** (gasto→categorías de gasto; ingreso→de ingreso). El UI pasa el set correcto.
- Se elimina `categoria_keyword` (el matcher resuelve a id). El UI ya no resuelve keyword→id.

Aprendizaje (`js/db.js` `insertTransaccion`): donde hoy llama
`autocatLearn(normalizeDesc(nota), cat)`, pasar a
`autocatLearnTokens(tokenize(nota), categoria_id)` (online + ambos offline), solo si hay
`categoria_id` (ahorro no aprende).

Blur-handler de autocat en `transaccion.html`: usar `matchCategoria(tokenize(nota), ctx)`
con categorías filtradas por el tipo activo.

### A.5 Tests (TDD, tablas)
`test/autocat.test.mjs` reescrito:
- `tokenize`: `"Llantas para bicicleta"` → `["llanta","bicicleta"]` (quita "para", singular).
- `tokenize`: monto ya fuera; numérico suelto descartado; `len<2` fuera.
- `scoreCategorias`: token ∈ nombre custom ("Partes de bicicleta") → +2.
- `scoreCategorias`: learned domina (freq 3 → +9 > seed +1).
- `matchCategoria`: empate → null; bajo umbral → null; único máximo → id.
- singular: `"meses"`→`"mes"`? (es>4 → quita es → "mes"); `"mes"` (len3, no toca).

`test/parse-quickadd.test.mjs` (ampliar):
- `"ahorro hogar 50"` → `{tipo:'ahorro', ambito:'hogar', monto:50, categoria_id:null, descripcion:null}`.
- `"ingreso trabajo 100"` → `{tipo:'ingreso', ambito:'personal', monto:100, descripcion:'trabajo'}`.
- default: `"uber 15"` → `tipo:'gasto', ambito:'personal'`.
- keyword de tipo/ámbito se quita de la descripción (no contamina categoría).
- categoría resuelta vía `ctx` (matcher) en vez de `categoria_keyword`.

---

## PARTE B — FAB abre quick-add (modo rápido)

### B.1 Panel rápido en `views/transaccion.html`
El modal carga `views/transaccion.html`. Añadir un **panel rápido** que es el estado
inicial visible; el formulario completo arranca oculto.

Markup (arriba del form):
```
#txQuickPanel
  input #txQuickInput  (texto grande, autofocus, placeholder "Uber 15 · almuerzo S/12.50 ayer")
  #txQuickChips        (chips de plantilla — 1 tap = crea directo)
  button #txQuickAdd   "Agregar"
  button/link #txQuickMas "Más opciones"
```
El form completo existente se envuelve para poder ocultarse (`#txFullForm`, `hidden` por defecto).

### B.2 Comportamiento (guardado directo)
- Modal abre con `#txQuickPanel` visible, `#txFullForm` oculto, foco en `#txQuickInput`.
- **Agregar** (o Enter): `parseQuickAdd(texto, {hoy, ctx})`. El UI carga `ctx`
  (learned vía `autocatLearned()`, `categorias` filtradas por el tipo parseado, `seed`).
  - **monto inválido** → error inline en el panel (no guarda).
  - **ahorro** → guarda directo (`insertTransaccion` con `categoria_id:null`).
  - **gasto/ingreso con `categoria_id`** → guarda directo (`insertTransaccion`).
  - **gasto/ingreso sin `categoria_id`** (caso extremo) → NO guarda: rellena `#txFullForm`
    (monto/tipo/ámbito/desc), lo muestra con el select de categoría resaltado
    (`tx-cat-needed`), oculta el panel. Usuario elige y guarda por el form.
- **Confirmación** (tras guardar directo): el panel se reemplaza por un mensaje
  (`#txQuickConfirm`) tipo: *"Registré un **gasto** por **S/100** en **Partes de
  bicicleta**"* — con **monto, tipo y categoría en color de acento** (frontend-design).
  Plantillas de mensaje por tipo:
  - gasto/ingreso: `Registré un {tipo} por {S/monto} en {categoría}` (+ `(hogar)` si aplica).
  - ahorro: `Registré un ahorro de {S/monto}` (+ `(hogar)` si aplica).
  Acciones en la confirmación:
  - **Deshacer** → `deleteTransaccion(id)` (red de seguridad para parseo malo).
  - **Editar categoría** → muestra SOLO un `<select>` de categorías (del tipo) inline;
    al elegir → `updateTransaccion(id,{categoria_id})` + `autocatLearnTokens(tokens, nuevaCat)`
    (la corrección alimenta el aprendizaje). No aplica a ahorro.
  - Tras unos segundos sin acción, autocierra el modal y refresca la vista.
- **Más opciones**: oculta panel, muestra form vacío (registro manual de siempre).
- **Chips de plantilla**: 1 tap → `insertTransaccion` directo → misma confirmación.
- Edición (`window._editTx`) y share-prefill: **saltan el panel**, abren el form completo
  directo (modo rápido solo para alta nueva).
- El FAB en metas/prestamos no cambia.

El estado del panel guarda los `tokens` de la descripción y el `id`/`tipo` de la tx recién
creada para alimentar Deshacer / Editar categoría.

### B.3 frontend-design
- `#txQuickPanel`: input prominente, chips táctiles (≥44px), botón primario claro,
  "Más opciones" secundario discreto. Mobile-first. Tokens CSS del proyecto.
- `#txQuickConfirm`: mensaje legible con **monto/tipo/categoría resaltados** (color de
  acento, peso fuerte) contra el resto en texto normal; iconito de check; acciones
  **Deshacer** y **Editar categoría** como botones secundarios; el `<select>` de edición
  aparece inline al tocar "Editar categoría". Accesible (roles/aria-live para el mensaje).

### B.4 Quitar duplicado
Eliminar la tarjeta `#qaForm` y su `initQuickAdd` de `views/dashboard.html` (el FAB la reemplaza).

---

## Orden de implementación (capas)
1. Matcher por tokens en `js/autocat.js` **TDD** (tokenize, scoreCategorias, matchCategoria) + reescribir `test/autocat.test.mjs`.
2. Parser tipo/ámbito + categoría vía matcher en `parse-quickadd.js` **TDD** (ampliar `test/parse-quickadd.test.mjs`); elimina `categoria_keyword`.
3. IndexedDB v4 (`autocat_tok`) + helpers `autocatLearnTokens`/`autocatLearned`; retirar `autocatLearn`/`autocatDict`.
4. Integrar aprendizaje por token en `insertTransaccion` (online + offline; solo si hay categoría).
5. Panel rápido + guardado directo + confirmación (Deshacer / Editar categoría) en `transaccion.html`; el UI arma `ctx` (learned/categorias-por-tipo/seed). Edición/share saltan el panel.
6. frontend-design del panel rápido y del mensaje de confirmación (resaltado monto/tipo/categoría).
7. Quitar `#qaForm` del dashboard.
8. Bump `SHELL_VERSION` (sw.js) → v12; verificar precache. Commit + push (deploy a Pages).

## Verificación
- Unit (node:test): tokenize/score/match + parse-quickadd (tipo/ámbito/ctx).
- Live: tras push, `nestra-8rl.pages.dev` — el + abre el panel; "Uber 15" → guarda directo +
  confirmación con monto/categoría resaltados; "ahorro hogar 50" → ahorro/hogar sin categoría;
  "ingreso trabajo 100" → ingreso; categoría custom ("Partes de bicicleta") reconocida sin
  historial; Deshacer borra; Editar categoría corrige y aprende; "Más opciones" → form completo.
  Cerrar/reabrir PWA por SW v12.

## Anti-duplicación
Reusar: `normalizeDesc`, `_normalizeNum`/`parseSharedMonto`, modal existente (`abrirModalTransaccion`/`#transaccionModal`), `_quickAddPrefill`, chips de plantilla ya construidos, `iconoCategoria`, outbox/mirror. El panel rápido NO crea un segundo modal — vive dentro de `transaccion.html`.
