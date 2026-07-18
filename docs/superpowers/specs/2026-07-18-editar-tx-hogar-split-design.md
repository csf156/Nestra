# Repartir gasto al editarlo a ámbito hogar

Fecha: 2026-07-18
Estado: aprobado (brainstorming), pendiente de plan de implementación.

## Contexto

`views/transaccion.html` sirve tanto alta como edición de transacciones
(`window._editTx` distingue el modo). En alta, marcar ámbito=hogar + tipo=gasto
muestra el bloque de partes (`partesGroup`, Fase 6.3) para repartir el monto
entre los miembros del hogar, vía `registrarGastoHogar(fecha, categoria_id,
nota, partes)` (RPC `registrar_gasto_hogar`, crea una fila por pagador
enlazada por `grupo_id`).

En edición, `_mostrarPartes()` oculta el bloque **incondicionalmente**
(`views/transaccion.html:920`, comentario "En edición no se ofrece"), y el
submit de edición (líneas 1231-1246) solo llama `updateTransaccion` — nunca
crea un split. Resultado: no hay forma de repartir un gasto existente al
marcarlo hogar desde el editor.

Un gasto **ya dividido** (`grupo_id` no null) ni siquiera abre el editor —
`views/historial.html:1293` lo bloquea a propósito: `if (!tx || tx.grupo_id ||
tx.es_aporte_directo) return;`. Eso queda sin tocar.

## Objetivo

Al editar una transacción **sin dividir** (grupo_id null) y marcarla
ámbito=hogar + tipo=gasto, ofrecer el mismo bloque de partes que en alta, y
al guardar con 2+ pagadores, convertir la fila única en un split real.

## No-objetivos (YAGNI, por decisión del usuario)

- No se habilita editar el reparto de un gasto ya dividido (grupo_id). Sigue
  bloqueado en `historial.html:1293`, sin cambios.
- No se toca ingreso/ahorro (sin partes, regla existente).
- No se toca el flujo de alta (ya funciona).

## 1. Mostrar partes en edición

`_mostrarPartes()` (views/transaccion.html:919-924) deja de retornar
temprano cuando `editTx` existe. Misma condición que alta: `ambito=hogar &&
tipo=gasto && _miembrosHogar().length >= 2`.

**Bloqueo por préstamo**: si la categoría seleccionada es "Dinero que
prestamos" (`_esPrestamo()`, ya existe), el bloque de partes no se muestra
aunque se cumplan las demás condiciones — un gasto compartido no tiene
análogo de préstamo (el RPC `registrar_gasto_hogar` no lo contempla).

**Prefill**: 100% al usuario actual, igual que en alta — no al monto que la
fila ya tenía. Asumir que el resto es "0 para el otro" sería incorrecto: la
fila nunca tuvo reparto.

## 2. Guardar con reparto (conversión 1 fila → N)

En el submit de edición (views/transaccion.html:1231-1246), si el bloque de
partes está visible:

```
partes = _leerPartes().filter(p => p.monto > 0)
check = validarPartesGastoHogar(monto, partes)   // ya existe, mismo que alta
si !check.ok → mostrar error, no continuar
si partes.length === 1:
  → camino simple: updateTransaccion(editTx.id, {...}) como hoy, SIN crear grupo_id
si partes.length >= 2:
  → conversión (ver abajo)
```

**Orden de la conversión — crear antes de borrar**, para no perder datos si
algo falla a medias:

1. `filas = await registrarGastoHogar(fecha, categoria_id, nota, partes)`.
   Si falla (error real, no de red — `registrarGastoHogar` ya distingue y
   encola offline), la fila original queda intacta y se muestra el error.
2. Solo si (1) resolvió, `await deleteTransaccion(editTx.id)`.
3. Si `editTx.recibo_path` existe: migrar el recibo (ver §3). Best-effort —
   un fallo aquí NO revierte el split ya creado.
4. Éxito → `mostrarExito(...)`.

## 3. Migración del recibo (best-effort)

Si `editTx.recibo_path` no es null:

```
propia = filas.find(f => f.user_id === currentUser.id)
blob = await supabase.storage.from('recibos').download(editTx.recibo_path)
si blob y propia:
  await subirRecibo(propia.id, blob)   // ya existe, sube + updateTransaccion recibo_path
```

Si falla la descarga/subida (offline, error de red, o cualquier error): no
revertir el split. Mostrar aviso junto al éxito: "Split guardado; el recibo
no se pudo trasladar, adjúntalo de nuevo si quieres conservarlo." El archivo
original en Storage no se borra (borrar la transacción no borra el objeto de
Storage) — no hay pérdida irreversible, solo desvinculación.

## 4. Offline

`registrarGastoHogar` y `deleteTransaccion` ya son offline-first (outbox +
espejo optimista). La conversión reusa ambas tal cual: paso 1 se encola si
hace falta, paso 2 se encola después. La migración del recibo (paso 3)
requiere red para la descarga (`storage.download`) — si `!navigator.onLine`,
se salta directo sin intentarlo y se muestra el mismo aviso de "no se pudo
trasladar".

## 5. Qué NO cambia

- Editar un gasto ya dividido: sigue bloqueado (`historial.html:1293`).
- Ingreso/ahorro: sin partes.
- Ámbito hogar sin 2+ miembros: nunca muestra partes (regla existente).
- Camino de alta (crear transacción nueva): sin cambios.

## Verificación (en preview, cuenta throwaway + hogar de pruebas)

1. Editar una tx personal existente → marcar hogar+gasto → aparece bloque de
   partes, prefill 100% propio.
2. Repartir entre los 2 miembros, montos que suman el total → guardar →
   fila original desaparece, aparecen 2 filas nuevas con el mismo `grupo_id`,
   cada una con su monto.
3. Dejar todo en la fila propia (0 en la del otro) → guardar → NO crea
   split, solo `updateTransaccion` (verificar que no aparece `grupo_id`).
4. Categoría "Dinero que prestamos" + marcar hogar → partes no aparece.
5. Tx con recibo adjunto → split con 2 pagadores → recibo aparece en la fila
   propia del split tras guardar.
6. Offline (DevTools): repetir (2) → outbox encola ambos pasos → reconectar
   → replay aplica → estado final igual que online.
7. Gasto ya dividido (grupo_id): confirmar que el editor sigue sin abrirse
   desde historial (sin cambios, pero verificar que no se rompió).
8. Suma de partes no cuadra con el total → error de validación, no guarda
   (reusa `validarPartesGastoHogar`, ya probado en otros flujos).

## Archivos afectados

- `views/transaccion.html` — `_mostrarPartes()`, submit de edición
  (conversión 1→N + migración de recibo), bloqueo por préstamo.
- Ningún cambio en `js/db.js` — reusa `registrarGastoHogar`,
  `deleteTransaccion`, `subirRecibo`, `validarPartesGastoHogar` tal cual.
- Ningún cambio de esquema/migración.
