# Design: Metas — Aportes directos, felicitación y confirmación de borrado (Sesión 8)

**Date:** 2026-06-08
**Status:** Draft (pending user review)
**Scope:** `views/metas.html`, `js/db.js`, `views/historial.html`, nueva migración SQL. Ajustes a la vista de Metas antes de cerrar la Sesión 8.

---

## Context

La vista de Metas (`views/metas.html`) ya existe (Sesión 7). Hoy el progreso de una meta solo crece por el reparto automático: un gasto en categoría **Ahorro** dispara la RPC `distribuir_ahorro`, que reparte el monto entre las metas personales por peso y vuelca el sobrante al fondo de emergencia. "Registrar aporte" abre el modal global de transacción y depende de que el reparto toque la meta deseada — **no garantiza que el aporte vaya a esa meta**.

Esquema relevante (verificado en `supabase/schema.sql` y `supabase/migrations/20260606_metas_automaticas.sql`):

- `aportes_meta` (fuente de verdad del progreso): `{ id, meta_id, transaccion_id NOT NULL, monto > 0, peso_aplicado, created_at }`. Cascade-delete al borrar meta o transacción. RLS: hereda acceso de la meta (hogar la ven ambos; personal solo el dueño).
- Vista `metas_con_progreso`: `monto_actual = COALESCE(SUM(aportes_meta.monto), 0)` — progreso derivado.
- `transacciones`: `{ id, fecha, tipo, ambito, user_id NOT NULL, categoria_id NOT NULL, monto > 0, nota, aporte_id, created_at }`.
- Categoría **Ahorro**: categoría compartida de tipo `gasto`, identificada por `nombre = 'Ahorro'`.
- Fondo de emergencia: meta permanente `es_fondo_emergencia = true`, uno personal por usuario y uno del hogar. Nunca topeado, absorbe el sobrante.
- `distribuir_ahorro` / `distribuir_aporte_hogar`: reparten por peso, topean cada meta en su restante, vuelcan sobrante al fondo, y **auto-marcan `estado='lograda'`** al alcanzar el objetivo.

db.js: `getMetas`, `insertMeta`, `updateMeta`, `deleteMeta`, `getCategorias`, `insertTransaccion` (que llama `_distribuirSiAhorro` para gastos en Ahorro), `_reDistribuirAhorro` (re-reparte al editar una transacción).

---

## Goal

Tres ajustes a Metas:

1. **Aporte directo:** registrar un aporte que va **100%** a una meta concreta (no se reparte). Aparece como gasto en el historial. El excedente sobre el objetivo va al fondo de emergencia.
2. **Sin marcado manual de lograda + felicitación:** eliminar el botón "Marcar como lograda". Una meta que alcanza su objetivo (por aportes automáticos y/o directos) muestra un panel de felicitación en toda la tarjeta con un botón **Confirmar**; solo al confirmar pasa a la sección de cumplidas.
3. **Confirmación de borrado:** "Eliminar" pide confirmación en modal (patrón de `historial.html`), reemplazando el toast-undo.

---

## Cambio 1 — Aporte directo

### Decisión clave: la meta NO se auto-marca lograda en las RPC

Se **elimina** el bloque `update ... set estado='lograda'` de `distribuir_ahorro` (líneas 404-407) y `distribuir_aporte_hogar` (líneas 562-564). Justificación: la felicitación (Cambio 2) requiere que la meta llena siga `en_curso` hasta que el usuario confirme. Es seguro: el filtro `(monto_objetivo - progreso) > 0` ya excluye del reparto a las metas llenas, así que no reciben sobre-financiación aunque sigan `en_curso`.

### Nueva RPC `aporte_directo_meta`

Atómica (SECURITY DEFINER). Firma: `aporte_directo_meta(p_meta_id uuid, p_monto numeric, p_fecha date, p_nota text) returns uuid` (devuelve el id de la transacción creada).

Lógica:
1. Validar que la meta existe y es accesible al usuario (personal propia o de hogar). Si no, `raise exception`.
2. Validar `p_monto > 0`.
3. Resolver la categoría **Ahorro** (`select id from categorias where nombre='Ahorro' and tipo='gasto'`).
4. Insertar la transacción: `tipo='gasto'`, `ambito='personal'`, `user_id = auth.uid()`, `categoria_id = Ahorro`, `monto = p_monto`, `fecha = p_fecha`, `nota = p_nota`, **`es_aporte_directo = true`**.
5. Calcular el restante de la meta: `restante = monto_objetivo - progreso_actual` (para el fondo, sin tope: todo va a la meta).
6. Repartir:
   - Si la meta es un fondo, o `p_monto <= restante`: un único `aportes_meta` con `monto = p_monto` a la meta.
   - Si `p_monto > restante` (meta normal): un `aportes_meta` con `monto = restante` a la meta, y otro con `monto = p_monto - restante` al **fondo de emergencia del ámbito de la meta** (personal del usuario si la meta es personal; del hogar si la meta es hogar). Ambos `aportes_meta` apuntan a la misma transacción.
   - Si `restante <= 0` (meta ya llena): todo el `p_monto` va al fondo del ámbito.
7. `peso_aplicado` queda `NULL` en los aportes directos (marca de "no repartido por peso").
8. **No** se marca `estado='lograda'` (lo hará el usuario al confirmar la felicitación).

Nota de ámbito: la transacción es siempre `personal` (es el gasto del usuario que aporta). Para una meta de hogar, el `aportes_meta` apunta a la meta de hogar (RLS lo permite porque la meta de hogar es accesible) y el excedente va al **fondo de hogar**.

### db.js

`insertAporteDirecto(meta_id, monto, fecha, nota)`: llama `supabase.rpc('aporte_directo_meta', {...})`. Lanza en error.

### UI (`metas.html`)

"Registrar aporte" (solo metas `tipo='ahorro'` no llenas) abre un **mini-modal de aporte** nuevo (no el modal global):
- Campos: **monto** (requerido, > 0), **fecha** (default hoy), **nota** (opcional).
- Guardar → `insertAporteDirecto` → cerrar + `cargar()` + toast "Aporte registrado".
- Validación cliente: monto > 0.

Metas no-ahorro siguen mostrando la nota informativa (sin cambios).

---

## Cambio 2 — Sin marcado manual + felicitación

### Detección de meta alcanzada

Meta **alcanzada** ⇔ `estado === 'en_curso'` y `Number(monto_actual) >= Number(monto_objetivo)` y `monto_objetivo > 0`.

### UI

- Se **elimina** el botón "Marcar como lograda" y la función `marcarLograda` deja de invocarse desde un botón normal.
- La tarjeta de una meta alcanzada **reemplaza su contenido** por un panel de felicitación a todo el espacio: ícono 🎉, título "¡Meta cumplida!", el nombre de la meta y el monto logrado, y un botón **Confirmar**.
- Al pulsar Confirmar: `updateMeta(id, { estado: 'lograda' })` → `cargar()` → la meta pasa a la sección de completadas.
- El panel de felicitación tiene prioridad visual sobre los estados urgente/vencida (una meta llena no se pinta vencida — `estadoVisual` ya lo contempla vía la variable `completa`).
- Las metas alcanzadas no muestran botones de aporte ni eliminar dentro del panel; solo Confirmar. (Eliminar sigue disponible para metas normales no alcanzadas.)

Las metas que ya estén `estado='lograda'` (por datos previos auto-marcados) siguen apareciendo en la sección de completadas sin cambios.

---

## Cambio 3 — Confirmación de borrado

Reemplazar el toast-undo de `eliminarMeta` por un **modal de confirmación**, consistente con `historial.html`:
- Markup: overlay con título "Eliminar meta", cuerpo "¿Seguro que quieres eliminar «{nombre}»? Esta acción no se puede deshacer.", botones **Cancelar** y **Eliminar** (rojo).
- Confirmar → `deleteMeta(id)` → cerrar modal + `cargar()` + toast "Meta eliminada".
- Error → toast "No se pudo eliminar. Reintenta."
- Se elimina la lógica de `borradoPendiente`/timer/undo.

El fondo de emergencia no es borrable (RLS lo bloquea); su tarjeta no muestra botón Eliminar.

---

## Cambio transversal — Historial: aportes directos no editables

Nueva columna `transacciones.es_aporte_directo boolean not null default false`. La RPC `aporte_directo_meta` la pone `true`.

En `historial.html`:
- Una transacción con `es_aporte_directo = true` **no se puede editar** (ocultar/deshabilitar la acción de editar). Se puede **eliminar** (el cascade borra sus `aportes_meta` y revierte el progreso).
- Evita el problema de `_reDistribuirAhorro`: al no permitir edición, nunca se re-reparte un aporte directo.

`getTransacciones` (o la consulta del historial) debe incluir `es_aporte_directo` en el `select` para que la UI pueda decidir.

Guard adicional en db.js: `_distribuirSiAhorro` debe **omitir** transacciones con `es_aporte_directo = true` (no repartir un aporte directo aunque sea un gasto en Ahorro). Comprobación por el campo de la transacción ya insertada.

---

## Arquitectura

```
Nueva migración SQL (supabase/migrations/20260608_aportes_directos.sql)
├── alter table transacciones add column es_aporte_directo boolean not null default false
├── create or replace function aporte_directo_meta(...)  -- atómica, overflow→fondo
├── create or replace function distribuir_ahorro(...)     -- sin auto-lograda
└── create or replace function distribuir_aporte_hogar(...) -- sin auto-lograda

js/db.js
├── insertAporteDirecto(meta_id, monto, fecha, nota)      -- rpc aporte_directo_meta
├── _distribuirSiAhorro: omitir es_aporte_directo
└── getTransacciones: incluir es_aporte_directo en select

views/metas.html
├── mini-modal de aporte directo (monto, fecha, nota)
├── registrarAporte() → abre mini-modal (no el global)
├── renderActivas: panel de felicitación si meta alcanzada; sin botón "lograda"
├── confirmarLograda(id) → updateMeta estado=lograda
├── modal de confirmación de borrado (reemplaza toast-undo)
└── eliminarMeta(id) → abre modal de confirmación

views/historial.html
└── filas con es_aporte_directo: editar oculto/deshabilitado; eliminar permitido
```

---

## Manejo de errores

| Escenario | Comportamiento |
|---|---|
| `aporte_directo_meta` falla (RPC) | toast "No se pudo registrar el aporte"; mini-modal permanece abierto |
| monto ≤ 0 en mini-modal | resaltar campo + mensaje inline; no llama a la BD |
| `updateMeta` (confirmar lograda) falla | toast "No se pudo actualizar. Reintenta." |
| `deleteMeta` falla | toast "No se pudo eliminar. Reintenta." |
| Categoría Ahorro inexistente | RPC `raise exception`; toast de error en UI |

---

## Out of Scope

- Edición de aportes directos (deshabilitada por diseño; solo borrado).
- Edición de metas existentes (sigue fuera del alcance de Sesión 7/8).
- Cap/aviso al usuario antes de aportar de más (el excedente va al fondo silenciosamente, con toast informativo opcional "El excedente fue al fondo de emergencia").
- Retirar la columna física `metas.monto_actual` (fase futura, ya anotada en la migración original).

---

## Verificación (navegador, sin framework de tests)

- [ ] Aporte directo a meta personal: aparece gasto en historial (categoría Ahorro), progreso sube por el monto completo, no se reparte a otras metas.
- [ ] Aporte directo que supera el objetivo: la meta llega a 100%, el excedente aparece como aporte al fondo de emergencia del mismo ámbito.
- [ ] Meta alcanzada (por aporte directo o automático) muestra panel de felicitación con botón Confirmar; sigue `en_curso` hasta confirmar.
- [ ] Confirmar mueve la meta a completadas (`estado='lograda'`).
- [ ] No existe botón "Marcar como lograda".
- [ ] "Eliminar" abre modal de confirmación; Cancelar no borra; Eliminar borra y recarga.
- [ ] El reparto automático ya no auto-marca lograda (la meta llena queda en_curso esperando confirmación).
- [ ] En historial, una transacción de aporte directo no ofrece editar; sí permite eliminar; al eliminar, el progreso de la meta baja.
- [ ] Móvil: mini-modal y modal de confirmación usables, sin overflow horizontal.
