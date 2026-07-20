# El ahorro registrado offline se reparte al reconectar

Fecha: 2026-07-19
Estado: aprobado (diagnóstico + diseño), pendiente de plan de implementación.

## Reporte / objetivo

Hoy, un ahorro registrado **sin conexión** se encola (queda pendiente) y se
sincroniza al reconectar, pero **nunca se reparte** entre metas y fondo de
emergencia. El reparto solo ocurre en el camino online. Comportamiento deseado
(palabras del usuario): "si registro un ahorro offline debería quedar como un
pendiente; al restablecer la conexión se realiza la repartición entre metas."

## Diagnóstico (verificado en el código)

- `insertTransaccion` (`js/db.js:138`) tiene dos caminos:
  - **Online** (`js/db.js:164-173`): inserta la tx y, si es ahorro, llama a
    `_distribuirAhorroTx(data)` → RPC `distribuir_ahorro`. ✔
  - **Offline** (`js/db.js:154-162`): `outboxAdd('transacciones', fila)` +
    `mirrorPut(..., _pending:true)`, y **retorna sin repartir**. La parte de
    "queda como pendiente" YA funciona; falta el reparto.
- El motor de sync (`js/sync.js`) procesa la outbox al reconectar
  (`window.addEventListener('online', syncOutbox)` y afines). El camino genérico
  (`js/sync.js:130-148`) hace `upsert` de la tx al servidor y `mirrorPut`, pero
  **no llama a `distribuir_ahorro`**. Ahí está el hueco.
- `_distribuirAhorroTx` es una función global (js/db.js es script clásico), así
  que `js/sync.js` puede invocarla.
- Un ahorro offline es **siempre** reparto normal: el aporte directo
  (`aporte_directo_meta`) es online-only (lanza si `!navigator.onLine` — ver
  comentario en `views/transaccion.html:1492`), porque calcular el excedente
  exige leer el estado de la meta en el servidor.

Esto no afectó los datos actuales (los 5 ahorros de hogar están repartidos), pero
es un hueco real: cualquier ahorro creado offline quedaría sin asignar.

## Diseño del fix

Enganchar el reparto en el sync, con guarda de idempotencia. No se toca la base
de datos (ni RPC ni triggers) — es cambio de cliente.

### 1. Predicado puro (nuevo módulo `js/reparto-sync.js`)

Dual-export (window + ESM), como `js/sync-lww.js`:

```js
function esAhorroRepartible(tx) {
  return !!tx && tx.tipo === 'ahorro' && !tx.es_aporte_directo;
}
```
Es la regla de "¿esta transacción debe pasar por `distribuir_ahorro`?". Se
unit-testea.

### 2. `_distribuirAhorroTx` idempotente y con estado de retorno (`js/db.js`)

Refactor para: (a) usar `esAhorroRepartible`; (b) **guarda de idempotencia** —
si la tx ya tiene aportes en `aportes_meta` (p.ej. el sync reintenta un op cuyo
`upsert` ya había disparado el reparto), NO reparte de nuevo; (c) devolver un
estado `'done' | 'retry' | 'skip'`:
- no repartible, o ya repartido → `'done'`
- error de red (RPC o la consulta de conteo) → `'retry'`
- error real → log + `'skip'`
- éxito → `'done'`

El camino online lo sigue llamando (ignorando el retorno, best-effort como hoy);
el camino de sync usa el retorno para decidir si reintentar.

### 3. Enganche en el sync (`js/sync.js`, camino genérico)

Tras el `upsert` + `mirrorPut` exitoso de una op de `transacciones`:
```js
if (entity === 'transacciones') {
  const rep = await _distribuirAhorroTx(data);
  if (rep === 'retry') return 'retry';   // op sigue pendiente, reintenta al próximo disparo
}
return 'done';
```
Un `'skip'` (error real de reparto) NO bloquea la tx: cae a `'done'`, la tx queda
guardada y el fallo se loguea (mismo espíritu best-effort de hoy).

### 4. Registrar el nuevo script

- `index.html`: `<script type="module" src="js/reparto-sync.js"></script>` junto a
  `sync-lww.js` (antes de que db.js/sync.js lo usen en runtime).
- `sw.js`: añadir `{ url: 'js/reparto-sync.js', revision: SHELL_VERSION }` al
  precache y bumpear `SHELL_VERSION` (v36 → v37).

## Idempotencia (la parte crítica)

El único riesgo de doble reparto es que el sync reintente el MISMO op después de
que su `upsert` ya haya corrido: el `upsert` es idempotente (`onConflict:'id'`),
pero un segundo `distribuir_ahorro` duplicaría los aportes. La guarda de conteo
(`select count from aportes_meta where transaccion_id = tx.id`; si > 0, no
repartir) lo cubre. El camino online no reintenta el mismo insert, así que la
guarda ahí solo suma robustez (conteo 0 en un insert fresco).

`distribuir_ahorro` es atómico (una función plpgsql, todo-o-nada), así que tras un
`'retry'` los aportes existen (→ `'done'` la próxima) o no existen (→ se reintenta
el RPC). Nunca a medias.

## Alcance / No-objetivos

- **No se toca la base de datos.** Sin migración, sin trigger, sin cambio de RPC.
- **No se toca el comportamiento del camino online** (solo se simplifica el
  llamador para delegar la regla tipo/es_aporte_directo a la función).
- **Edición offline de una tx** que la convierta en/desde ahorro queda fuera de
  alcance. El enganche cubre el caso de INSERT (el reportado). Una tx ya con
  aportes que se edita offline no se re-reparte por este cambio (hueco de
  edición-offline preexistente, separado).

## Por qué no un trigger en la base (considerado y descartado)

Un `AFTER INSERT` trigger en `transacciones` que dispare `distribuir_ahorro`
haría el reparto agnóstico al camino (online/offline) y sería idempotente por
INSERT. Pero: (a) cambia los modos de fallo del camino online que hoy funciona —
un fallo de reparto dentro del trigger abortaría el INSERT de la tx salvo que se
tragen los errores con cuidado; (b) es una migración a producción sobre datos
reales justo después de otra; (c) el flujo que pide el usuario es exactamente el
del sync. El enganche en sync es localizado, testeable y no altera el camino
online. Si en el futuro aparecen más caminos de creación de ahorro, reconsiderar
el trigger.

## Testing

- **Pura**: `test/reparto-sync.test.mjs` (node:test) para `esAhorroRepartible`:
  ahorro→true, aporte_directo→false, gasto→false, ingreso→false, null→false.
  Correr `node --test test/reparto-sync.test.mjs`.
- **Integración (manual, en navegador con sesión)**: registrar un ahorro con el
  navegador offline (DevTools → Network → Offline, o `navigator.onLine` mockeado);
  verificar que queda pendiente (badge/outbox) y NO tiene aportes; volver online;
  disparar sync; verificar que se crearon los aportes correctos y el pendiente se
  fue. Repetir el disparo de sync para confirmar que NO se duplican los aportes
  (idempotencia). Usar la cuenta/hogar de prueba, nunca el hogar real.
- El reparto en sí ya está cubierto por la lógica de `distribuir_ahorro` (no se
  toca).
