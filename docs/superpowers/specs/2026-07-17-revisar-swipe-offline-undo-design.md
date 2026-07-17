# Rediseño de #revisar — swipe + offline + undo

Fecha: 2026-07-17
Estado: aprobado (brainstorming), pendiente de plan de implementación.

## Contexto

La feature "Pendientes de confirmar" **ya existe** como `views/revisar.html` (#revisar,
v23, "email ingest COMPLETO E2E 2026-07-15"), respaldada por la tabla
`ingest_pendientes` (NO `gastos_pendientes` — ese nombre no existe en el repo). El motor
de sugerencia de categoría vive en `js/autocat.js` + IndexedDB por dispositivo (NO una
tabla `comercio_categoria`), y así es **a propósito**: el Worker de ingesta no puede
inferir categoría porque el mapa aprendido es per-device, inalcanzable para él (ver
comentario en `supabase/migrations/20260714_ingest_pendientes.sql`).

Este trabajo **mejora** esa vista; no crea una nueva ni un sistema paralelo.

Estado actual de la card (`cardHTML` en `views/revisar.html`): todos los campos
(monto/fecha/tipo/ámbito/categoría + partes de hogar) expandidos siempre, con botones
Descartar/Confirmar. `esc()` ya escapa el texto de correo no confiable.

## Objetivos

1. Triage rápido tipo bandeja: card compacta, gesto de swipe, edición inline de categoría.
2. Deshacer (undo) confirmar y descartar.
3. **Funciona offline de verdad** — hoy no: la lista, el badge y confirmar/descartar
   pegan a supabase directo, sin espejo ni outbox.

## No-objetivos (YAGNI)

- No se toca el Worker/parser de ingesta ni el schema de campos parseados.
- No se migra el aprendizaje de categoría a una tabla server-side (rompe el diseño
  per-device de autocat).
- No se rediseña el bloque de partes de hogar (se reusa tal cual, solo se muestra al
  expandir).

## 1. UX / interacción

- **Card compacta por defecto:** `[badge banco] comercio · monto` en una línea;
  `[chip categoría sugerida]` + fecha debajo. Sin inputs a la vista.
- **Chip de categoría** → toca → **bottom-sheet** solo de categorías (lista scrolleable,
  la sugerida marcada). Elegir cierra el sheet y actualiza el chip. Swipe/Confirmar usan
  la categoría que muestre el chip. El chip NO expande la card.
- **Expandir** (toca la card fuera del chip) → despliega monto/fecha/tipo/ámbito +
  (si tipo=gasto y ámbito=hogar) el bloque de partes existente. Se edita ahí, como hoy.
- **Swipe:** derecha = Confirmar, izquierda = Descartar. Umbral ~40% del ancho + snap-back
  si no llega. Botones Confirmar/Descartar se mantienen (fallback desktop / accesibilidad /
  no-touch).
- **Swipe-confirm en card incompleta** → **expande y enfoca lo que falta**, NO confirma.
  "Completa" = monto>0 AND fecha AND tipo AND (tipo=ahorro OR categoría) AND
  (NO (hogar y gasto) OR partes válidas). Casos que nunca son one-swipe: `revisar-manual`
  (sin campos), conversión de divisa fallida (`tasa_cambio` null con `moneda_original`),
  hogar-gasto sin repartir.
- **Undo:** toast "Confirmado · Deshacer" / "Descartado · Deshacer" ~5s. La card sale con
  animación; el undo la re-inserta en su posición.

## 2. Offline (endurecimiento — el bloque grande)

- **Espejo (mirror):** añadir `ingest_pendientes` a `MIRROR_STORES` en `js/nestra-db.js`
  → subir `NESTRA_IDB_VERSION` de 5 a **6** (el upgrade crea el store nuevo; los demás son
  idempotentes). `getIngestPendientes()` y `contarIngestPendientes()` pasan a usar
  `_mirroredRead(store, fetcher)` (online refresca el espejo con el set completo; offline
  lee del espejo). Así la lista y el badge cargan sin conexión.
- **Nuevo op de outbox `ingest_estado`** con payload
  `{ id, estado, transaccion_id, tipo, monto, fecha, updated_at }`. Confirmar / descartar /
  revertir: escritura optimista al espejo (cambia `estado` local) + `outboxAdd('ingest_estado', …)`.
  Replay en `js/sync.js` = UPDATE de `ingest_pendientes` con **guardia LWW por `updated_at`**
  (lee la fila del servidor; si el servidor es más nuevo, gana el servidor y solo re-espeja).
  Mismo contrato de retorno que los otros ops (`done`/`retry`/`skip`).
- **Migración de base:** `ingest_pendientes` no tiene `updated_at`, y LWW lo exige.
  Añadir `updated_at timestamptz not null default now()`, poblar las filas existentes, y
  fijarlo en cada UPDATE del cliente. **El usuario revisa el SQL antes** de aplicarlo con
  `apply_migration` (regla CLAUDE.md; hay datos reales de 2 usuarios). Tras aplicar,
  verificar la cadena completa: columna existe → grant es de tabla (no por columna) →
  PostgREST la ve (curl al REST) → RLS la cubre. Sumar la columna al
  `supabase/tests/schema_contract_test.sql` en el mismo commit.
- `confirmarIngestPendiente()` / `descartarIngestPendiente()` se reescriben offline-first
  (patrón de `insertTransaccion`: online directo; offline o net-error → espejo + outbox).
  Ambos fijan `updated_at` = ahora en el payload.

## 3. Undo — reversión

- **Descartar-undo:** `estado` → `pendiente`, `resolved_at` → null (vía op `ingest_estado`).
- **Confirmar-undo:** borrar la(s) transacción(es) creada(s) + revertir el pendiente.
  - Personal / ahorro: `deleteTransaccion(txId)` (ya es offline-first).
  - Hogar-split: capturar **todas** las filas devueltas por `registrarGastoHogar` (comparten
    `grupo_id`) y borrar cada una; luego `estado` → `pendiente`.
- La ventana de undo (~5s) se maneja en memoria en la vista: la fila queda "saliendo"; al
  expirar ya está aplicada en base (la acción se aplicó de inmediato) y el undo la revierte.
  Offline: el undo encola la reversión igual.

## 4. Seguridad de render

- `comercio`, `raw_subject`, `contraparte` vienen de correo no confiable. Mantener `esc()`
  (ya existe) en toda interpolación; chip y card por `textContent`/escaping, nunca
  `innerHTML` crudo con datos del correo. Auditar cada interpolación nueva del rediseño.

## 5. Deploy

- Bump `SHELL_VERSION` en `sw.js` (v31 → v32). Se mantiene NetworkFirst para las vistas.
- Rama de trabajo aparte + PR a `main` (protegida; push directo rechazado). Tras merge,
  verificar el deploy live con cache-buster.

## 6. Verificación (antes de declarar "listo")

Preview local en :5050 (config `nestra`). Sembrar fila(s) `ingest_pendientes` de prueba en
la **cuenta throwaway** (nunca el hogar real). Probar:

1. Swipe-confirmar una card simple y completa → tx en `transacciones`, pendiente `confirmado`.
2. Swipe-confirm en card incompleta (manual / divisa fallida / hogar sin repartir) → expande
   y enfoca, no confirma.
3. Chip → bottom-sheet → cambiar categoría → confirmar aplica la elegida; autocat aprende.
4. Descartar + Deshacer → vuelve a `pendiente`.
5. Confirmar + Deshacer (personal) → tx borrada, pendiente `pendiente`.
6. Confirmar + Deshacer (hogar-split) → todas las filas del grupo borradas, pendiente vuelve.
7. Offline (DevTools): lista y badge cargan del espejo; confirmar/descartar encolan;
   reconectar → replay vacía la outbox; estados correctos en base.
8. Render: comercio con `<script>`/`&`/comillas se muestra escapado, no ejecuta.

Evidencia: screenshots del preview + consultas de estado en base (no solo "debería funcionar").

## Archivos afectados

- `views/revisar.html` — rediseño de card, swipe, chip+bottom-sheet, undo, gate de completitud.
- `js/nestra-db.js` — `MIRROR_STORES` += `ingest_pendientes`; `NESTRA_IDB_VERSION` 5→6.
- `js/db.js` — `getIngestPendientes`/`contarIngestPendientes` vía `_mirroredRead`;
  `confirmar/descartarIngestPendiente` offline-first; helper de revertir; capturar filas de grupo.
- `js/sync.js` — nuevo op `ingest_estado` con guardia LWW.
- `sw.js` — bump `SHELL_VERSION`.
- `supabase/migrations/<fecha>_ingest_updated_at.sql` — columna `updated_at` (revisada por el usuario).
- `supabase/tests/schema_contract_test.sql` — cubrir `ingest_pendientes.updated_at`.
