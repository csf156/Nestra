# Quick-add como entrada principal + matcher de categoría por tokens (diseño)

Fecha: 2026-06-27
Estado: aprobado (brainstorming) → pendiente plan de implementación

## Objetivo

Hacer del registro por texto la entrada PRINCIPAL de transacciones, y mejorar la
inferencia de categoría para que acierte con categorías personalizadas y se adapte
al historial del usuario. Dos partes:

1. **FAB → quick-add primero.** El botón + (`#globalFab`) abre el modal en "modo
   rápido" (texto + chips de plantilla + Agregar + link "Más opciones"), no el
   formulario completo. El form detallado queda a un tap.
2. **Matcher de categoría por tokens con scoring.** Reemplaza el matcher
   exacto/substring de `js/autocat.js` por uno que tokeniza la descripción y
   puntúa categorías combinando historial aprendido, nombre de categoría y
   diccionario semilla es-PE. Offline, sin AI, testeable (TDD).

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
- `frontend-design` para el panel rápido.

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

### A.4 Integración
- `js/db.js` `insertTransaccion`: donde hoy llama `autocatLearn(normalizeDesc(nota), cat)`,
  pasar a `autocatLearnTokens(tokenize(nota), categoria_id)` (online + ambos offline).
- `js/parse-quickadd.js`: la sección de categoría pasa a usar `matchCategoria(tokens, ctx)`.
  Como `parseQuickAdd` es pura y no toca IndexedDB, recibe `ctx` (learned, categorias, seed)
  por `opts`. El llamador (UI) carga `learned`/`categorias` y pasa `opts`.
  - Salida: `categoria_id` directo (ya resuelto por el matcher); se elimina `categoria_keyword`
    (el matcher resuelve a id usando `categorias`). El UI ya no resuelve keyword→id.
- Blur-handler de autocat en `transaccion.html`: usar `matchCategoria(tokenize(nota), ctx)`.

### A.5 Tests (TDD, tablas)
`test/autocat.test.mjs` reescrito:
- `tokenize`: `"Llantas para bicicleta"` → `["llanta","bicicleta"]` (quita "para", singular).
- `tokenize`: monto ya fuera; numérico suelto descartado; `len<2` fuera.
- `scoreCategorias`: token ∈ nombre custom ("Partes de bicicleta") → +2.
- `scoreCategorias`: learned domina (freq 3 → +9 > seed +1).
- `matchCategoria`: empate → null; bajo umbral → null; único máximo → id.
- singular: `"meses"`→`"mes"`? (es>4 → quita es → "mes"); `"mes"` (len3, no toca).

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

### B.2 Comportamiento
- Modal abre con `#txQuickPanel` visible, `#txFullForm` oculto, foco en `#txQuickInput`.
- **Agregar** (o Enter): `parseQuickAdd(texto, {hoy, ctx})` →
  - rellena el form completo (monto/nota/fecha/categoria),
  - oculta `#txQuickPanel`, muestra `#txFullForm` como **preview editable** para confirmar/guardar.
  - Sin categoría → select resaltado (`tx-cat-needed`).
- **Más opciones**: oculta panel, muestra form vacío (registro manual de siempre).
- **Chips de plantilla**: 1 tap → `insertTransaccion` directo + éxito (sin pasar por el form).
- Edición de una transacción existente (`window._editTx`) y share-prefill: **saltan el panel** y abren el form completo directo (modo rápido solo para alta nueva).
- El FAB en metas/prestamos no cambia.

### B.3 frontend-design
Pulir `#txQuickPanel`: input prominente, chips táctiles (44px), botón primario claro,
"Más opciones" secundario discreto. Responsive/mobile-first. Reusar tokens CSS del proyecto.

### B.4 Quitar duplicado
Eliminar la tarjeta `#qaForm` y su `initQuickAdd` de `views/dashboard.html` (el FAB la reemplaza).

---

## Orden de implementación (capas)
1. Matcher por tokens en `js/autocat.js` **TDD** (tokenize, scoreCategorias, matchCategoria) + reescribir `test/autocat.test.mjs`.
2. IndexedDB v4 (`autocat_tok`) + helpers `autocatLearnTokens`/`autocatLearned`; retirar `autocatLearn`/`autocatDict`.
3. Integrar matcher: `insertTransaccion` (aprende por token), `parse-quickadd.js` (usa `matchCategoria`, elimina `categoria_keyword`), actualizar tests de parse-quickadd.
4. Panel rápido en `transaccion.html` (lógica) + ajustar consumidores del parser (pasar `ctx`).
5. frontend-design del panel rápido.
6. Quitar `#qaForm` del dashboard.
7. Bump `SHELL_VERSION` (sw.js) → v12; verificar precache. Commit + push (deploy a Pages).

## Verificación
- Unit (node:test): tokenize/score/match + parse-quickadd con ctx.
- Live: tras push, `nestra-8rl.pages.dev` — el + abre el panel rápido; "Uber 15" → preview; categoría custom ("Partes de bicicleta") reconocida tras aprenderla; chips 1-tap; "Más opciones" → form completo. Cerrar/reabrir PWA por SW v12.

## Anti-duplicación
Reusar: `normalizeDesc`, `_normalizeNum`/`parseSharedMonto`, modal existente (`abrirModalTransaccion`/`#transaccionModal`), `_quickAddPrefill`, chips de plantilla ya construidos, `iconoCategoria`, outbox/mirror. El panel rápido NO crea un segundo modal — vive dentro de `transaccion.html`.
