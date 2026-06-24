# Fase 3 — Captura de transacciones excepcional (diseño)

Fecha: 2026-06-24
Estado: aprobado (brainstorming) → pendiente plan de implementación

## Objetivo

Llevar el registro manual de una transacción de ~5 taps a 1. Nestra no tiene
bank sync (privacidad); la captura manual debe ser tan rápida que no duela.
Seis features. Todo funciona **offline** contra IndexedDB sobre la base de Fase 1.

## Estado actual (análisis de brecha)

| # | Feature | Estado |
|---|---------|--------|
| 1 | Quick-add con parseo | ❌ falta (solo existe extractor de monto en `share-parse.js`) |
| 2 | Auto-categorización aprendida | ❌ falta |
| 3 | Plantillas frecuentes (chips 1-tap) | ❌ falta |
| 4 | Split multi-categoría | ❌ falta |
| 5 | Undo en toast | ⚠️ parcial: toast soporta acción pero el delete usa modal-confirm sin undo |
| 6 | Foto de recibo | ❌ falta (`txSharePreview` muestra imagen compartida pero no persiste) |

Reutilizables (NO duplicar):
- `parseSharedMonto` / `_normalizeNum` en [share-parse.js](../../../js/share-parse.js) → base del parser de monto.
- `mostrarToast(msg, label, onAccion, ms)` en [historial.html](../../../views/historial.html) → ya soporta undo, falta cablearlo.
- patrón `aporte_id` (transacciones vinculadas) → modelo para `split_id`.
- outbox/mirror/LWW: [nestra-db.js](../../../js/nestra-db.js), [sync.js](../../../js/sync.js).
- `iconoCategoria()`, modal de transacción existente (reuso para el preview del quick-add).

## Decisiones (brainstorming)

1. **Split** = N transacciones reales compartiendo `split_id` (patrón `aporte_id`).
   Fase 2 (safe-to-spend, presupuestos, insights) las lee por `categoria_id` **sin cambios**.
2. **Quick-add sin categoría inferida** → preview con select vacío resaltado; obliga elegir. Nunca adivina mal.
3. **Matcher auto-cat** = normalizado exacto + substring de keyword conocida. Determinista, sin fuzzy.
4. **Alcance** = un solo spec, plan por capas ordenado por dependencia.
5. **Foto offline** = comprime → blob en IndexedDB + outbox; upload diferido al recuperar red.
6. **Plantillas** = tabla Supabase sincronizada (RLS por user_id).
7. **Foto** se guarda como **path** (`recibo_path`), no URL: bucket privado, URL firmada on-demand y expira.

## A. Modelo de datos

Migración `supabase/migrations/20260624_fase3_captura.sql`:

- `transacciones`:
  - `+ split_id uuid` (null) — agrupa líneas de un split.
  - `+ recibo_path text` (null) — ruta del objeto en Storage `{user_id}/{transaccion_id}.webp`.
  - `+ create index idx_transacciones_split_id on transacciones (split_id)`.
- Tabla `plantillas`:
  ```sql
  create table public.plantillas (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references auth.users (id) on delete cascade,
    nombre       text not null,
    monto        numeric(10,2) not null check (monto > 0),
    categoria_id uuid references public.categorias (id) on delete cascade,
    tipo         text not null default 'gasto' check (tipo in ('gasto','ingreso','ahorro')),
    ambito       text not null default 'personal' check (ambito in ('personal','hogar')),
    orden        int not null default 0,
    updated_at   timestamptz not null default now()
  );
  ```
  RLS: select/insert/update/delete `using (user_id = auth.uid())` (copiar patrón `categorias_favoritas`).
  Trigger `updated_at` (reusar `trg_*_updated_at`). Agregar a `supabase_realtime` (opcional, consistencia).
- Storage: bucket privado `recibos`. Policies en `storage.objects`:
  ```sql
  create policy "recibos_insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'recibos' and (storage.foldername(name))[1] = auth.uid()::text);
  create policy "recibos_select" on storage.objects for select to authenticated
    using (bucket_id = 'recibos' and (storage.foldername(name))[1] = auth.uid()::text);
  create policy "recibos_delete" on storage.objects for delete to authenticated
    using (bucket_id = 'recibos' and (storage.foldername(name))[1] = auth.uid()::text);
  ```

## B. IndexedDB (`nestra-db.js` → version 3)

- `MIRROR_STORES` += `'plantillas'`.
- Nuevo store `autocat` (keyPath `desc_norm`): `{desc_norm, categoria_id, count, updated_at}`.
- Nuevo store `recibos_pendientes` (keyPath `transaccion_id`): `{transaccion_id, blob, user_id, created_at}`.
- `upgrade()` crea los nuevos stores condicionalmente (idempotente; respeta v2 existente).

Sync (`sync.js`):
- `plantillas` se sincroniza genérico (upsert de tabla) sin cambios en `_replayOp`.
- Foto = branch nuevo en `_replayOp`: si `entity === 'recibo'` → lee blob de `recibos_pendientes`,
  `supabase.storage.from('recibos').uploadBinary(path, blob, {contentType:'image/webp', upsert:true})`,
  luego `update transacciones set recibo_path` (vía upsert LWW normal), borra `recibos_pendientes`.
  Errores de red → `'retry'`; error real → `'skip'` (consistente con el motor actual).

## C. Funciones puras (TDD — tablas de casos)

### `js/parse-quickadd.js` → `parseQuickAdd(text, opts)`
`opts = { hoy: 'YYYY-MM-DD', keywords: {kw: categoriaNombre}, autocat: {descNorm: categoria_id} }`.
Salida: `{ descripcion, monto, categoria_id|null, categoria_keyword|null, fecha }`. **Nunca lanza.**
`monto === null` ⇒ parse fallido (UI cae a form manual).

Gramática:
- **Monto**: reusa `parseSharedMonto`/`_normalizeNum`. Regla de selección cuando hay varios números:
  si aparece `S/` → el número junto a `S/`; si no → el **mayor** número plausible (heurística para
  `"cine 2 entradas 40"` → 40, no 2). Soporta decimales `12.50` y `12,50`, miles.
- **Fecha relativa**: `hoy`(default) / `ayer` / `anteayer` / `mañana` → date desde `opts.hoy`.
  El token de fecha se elimina de la descripción.
- **Categoría**: primero `opts.autocat[normalizeDesc(desc)]`; si no, busca `opts.keywords` como
  substring sobre el texto normalizado. Si nada coincide → `categoria_id:null`.
- **Descripción**: texto restante tras quitar monto, `S/`, token de fecha; trim + colapsa espacios. Vacío→null.

### `js/autocat.js`
- `normalizeDesc(s)` → lowercase, sin tildes (NFD + strip diacríticos), colapsa espacios, trim.
- `matchAutocat(descNorm, dict)` → igualdad exacta en `dict`; si no, busca una clave del dict que
  sea substring de `descNorm` (o viceversa para keyword conocida). Sin fuzzy/Levenshtein.

Casos límite en tablas de test (mínimo):
`"S/12.50 almuerzo"`, `"uber eats 23"`, `"15 taxi ayer"`, `"recarga"` (sin monto→fallo),
`"cine 2 entradas 40"`, `"almuerzo"` (autocat hit), `"  café   con   leche 8 "` (multi-palabra + espacios),
`"taxi S/ 7,50 anteayer"`.

Diccionario keyword es-PE inicial (ampliable): transporte (uber, taxi, pasaje, combi, metro,
gasolina), comida (almuerzo, cena, desayuno, café, menú, restaurante), mercado (mercado, super,
verdura), servicios (luz, agua, internet, recarga, celular), salud (farmacia, clínica), ocio (cine, bar).

## D. UI por capa

1. **Quick-add** (dashboard): input free-text + botón enviar. `parseQuickAdd` → **preview editable**
   (reusa el modal/campos del form de transacción): desc / monto / categoría (select vacío resaltado si
   null) / fecha. Confirmar → `insertTransaccion` + aprende en `autocat`. Parse fallido → abre form normal prellenado.
2. **Auto-cat**: tras cada `insertTransaccion` con nota+categoría, escribe/incrementa `autocat`
   (`desc_norm → categoria_id`, `count++`). Quick-add y form normal prellenan categoría al detectar
   desc ya vista (en `input`/`blur` de nota/descripción).
3. **Plantillas**: chips 1-tap en `transaccion.html` (y zona quick-add del dashboard). Tap → inserta
   directo (`insertTransaccion` con datos de la plantilla) + toast. Gestión CRUD + reordenar en
   `configuracion.html`. Persistencia vía `db.js` (insert/update/delete) + outbox + mirror.
4. **Split**: toggle "Dividir" en el form. UI de líneas (categoría + monto), valida `suma === total`.
   Guardar → genera `split_id` y N `insertTransaccion` con ese `split_id` (misma fecha/tipo/ámbito,
   categoría+monto por línea). Historial agrupa por `split_id`: muestra cabecera (total) + líneas.
   Borrar cualquier línea borra el grupo completo (modal lo advierte).
5. **Undo toast**: nuevo flujo de borrado para tx normal en `historial.html`. Borrar → quita optimista
   de la UI + `mostrarToast('Movimiento eliminado','Deshacer', restaurar, 5000)`. La llamada real a
   `deleteTransaccion` se **difiere 5s**; si tap Deshacer antes → cancela timer + re-render (no se borró).
   Al expirar → `deleteTransaccion`. Salir de la vista con timer pendiente → ejecuta el borrado.
   **Aporte vinculado mantiene el modal** (irreversible: toca dos filas + metas).
6. **Foto**: `<input type="file" accept="image/*" capture="environment">` en el form. Comprime
   client-side (canvas → `toBlob('image/webp', ~0.7)`, lado máx ~1280px). Online: `uploadBinary` +
   set `recibo_path`. Offline: blob en `recibos_pendientes` + outbox `recibo`. Detalle/historial:
   thumbnail vía `createSignedUrl(path, ttl)` (cache en memoria por sesión); offline usa blob local.

## E. Orden de implementación (capas)

1. Migración SQL + bucket/RLS Storage.
2. `parse-quickadd.js` + `autocat.js` **con tests TDD** (rojo → verde) — funciones puras.
3. IndexedDB v3 + helpers `db.js` (plantillas CRUD, autocat learn/lookup, recibo queue) + branch sync.
4. Quick-add UI + preview.
5. Plantillas UI (chips + gestión).
6. Split UI + historial agrupado.
7. Undo toast.
8. Foto: compresión + upload + thumbnail firmado.

Cada capa es verificable de forma aislada; las puras (capa 2) primero por TDD.

## F. Verificación en teléfono

SW y cámara exigen contexto seguro (HTTPS); LAN `http://ip` no registra SW.
El usuario tiene un **túnel Cloudflare** existente hacia su server local.
Verificación: levantar server estático local en el puerto del túnel → abrir el link Cloudflare en el
teléfono → probar quick-add, plantilla 1-tap, split, undo, foto (con cámara) y modo offline.
NO se toca GitHub Pages (prod v1 intacto).

## G. Testing

- Unit (Node, `test/*.test.mjs`, patrón existente): `parse-quickadd`, `autocat` con tablas de casos.
- Manual en teléfono vía túnel (sección F): cada feature + offline + sync al reconectar.
- Regresión: Fase 2 sigue leyendo splits por `categoria_id` sin cambios.

## Anti-duplicación (resumen)

Reusar: `_normalizeNum`/`parseSharedMonto`, `mostrarToast(onAccion)`, patrón `aporte_id`→`split_id`,
outbox/mirror/LWW, `iconoCategoria`, modal de transacción para el preview, trigger `updated_at`,
patrón RLS de `categorias_favoritas`.
