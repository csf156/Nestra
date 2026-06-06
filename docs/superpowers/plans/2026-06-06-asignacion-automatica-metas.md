# Plan de implementación — Asignación automática de metas

> **Para workers agénticos:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan checkbox (`- [ ]`).

**Meta:** Reemplazar el `monto_actual` manual de las metas por progreso automático derivado de movimientos reales (gastos en "Ahorro" → metas personales; aportes al hogar → metas del hogar), con distribución ponderada, auditable y reversible.

**Arquitectura:** Nueva tabla `aportes_meta` (movimientos) como verdad; `monto_actual` derivado vía vista `metas_con_progreso`. Distribución atómica en RPC PostgreSQL `SECURITY DEFINER` invocado desde db.js. Reversión automática vía FK `ON DELETE CASCADE`. Migración **aditiva** (no destructiva) → la app sigue funcionando en cada fase.

**Stack:** PostgreSQL/Supabase (PostgREST + RLS), JS vanilla global (sin import/export), Supabase JS SDK v2 CDN. Sin framework de tests: verificación por `node` (sintaxis + REST autenticado) y Live Server.

---

## Principios de minimización de riesgo

1. **Migración aditiva:** No se elimina `metas.monto_actual` hasta la fase final. Durante la transición, columna y vista coexisten. Rollback = ignorar la vista.
2. **Una fase = un merge:** Cada fase deja la app funcional. Branch por fase, code review, merge `--no-ff`.
3. **DB antes que cliente:** Schema y RPC primero (verificados en Supabase real) antes de tocar db.js.
4. **Cliente antes que UI:** db.js verificado con scripts Node antes de cablear vistas.
5. **Sin tocar balances:** Ninguna tarea modifica `getBalanceHogar`/`getBalancePersonal` ni la semántica de `aporte_id`. Verificación explícita de regresión en cada fase relevante.

---

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `supabase/migrations/20260606_metas_automaticas.sql` | Tabla, columna, vista, RLS, RPCs | **Crear** |
| `supabase/schema.sql` | Documento canónico del esquema | Modificar (reflejar migración) |
| `js/db.js` | Capa de datos: lectura por vista, disparo de RPC, auditoría | Modificar |
| `views/transaccion.html` | Aviso post-guardado de reparto (opcional) | Modificar |
| `views/dashboard.html` | Quitar aporte manual; progreso desde vista | Modificar |
| `views/metas.html` | Control de importancia + desglose de aportes | **Crear** |
| `js/alerts.js` | Compatibilidad con progreso derivado | Verificar (probable cero cambios) |
| `views/graficos.html` | Gráficos de progreso y aportes | **Crear** |

Orden de ejecución por dependencia: **schema → db.js → alerts.js → dashboard → transaccion → metas → graficos**.

---

## FASE 1 — schema.sql + migración (fundación DB)

**Branch:** `feat/metas-schema`
**Archivos:** Crear `supabase/migrations/20260606_metas_automaticas.sql`; Modificar `supabase/schema.sql`.

### Tarea 1.1 — Columna `metas.importancia`
- [ ] **Paso 1:** En la migración, añadir columna `importancia` a `public.metas`: entero, `default 3`, `check (importancia between 1 and 5)`. Aditiva, no rompe filas existentes (toman default 3).
- [ ] **Paso 2:** Reflejar la misma columna en `supabase/schema.sql` (sección 1.5 metas) para mantener el doc canónico sincronizado.

### Tarea 1.2 — Tabla `aportes_meta`
- [ ] **Paso 1:** Definir tabla `public.aportes_meta` con columnas: `id` uuid PK; `meta_id` uuid `not null references metas(id) on delete cascade`; `transaccion_id` uuid `not null references transacciones(id) on delete cascade`; `monto` numeric(10,2) `check (monto > 0)`; `peso_aplicado` numeric; `created_at` timestamptz default now().
- [ ] **Paso 2:** Índices sobre `meta_id` y `transaccion_id` (PostgREST/joins + reversión por cascade eficiente).
- [ ] **Paso 3:** Reflejar en `schema.sql` (nueva sección 1.7, renumerar índices).

### Tarea 1.3 — Vista `metas_con_progreso`
- [ ] **Paso 1:** Definir vista que haga `metas LEFT JOIN aportes_meta` agregando `coalesce(sum(aportes_meta.monto), 0) as monto_actual`, exponiendo todas las columnas de `metas` (incluida `importancia`) + el `monto_actual` derivado. La vista hereda RLS de las tablas base (Postgres aplica las políticas de `metas` y `aportes_meta` al consultar la vista con `security_invoker`).
- [ ] **Paso 2:** Marcar la vista con `security_invoker = true` (Postgres 15+/Supabase) para que respete el RLS del usuario que consulta, no del creador.
- [ ] **Paso 3:** Reflejar en `schema.sql`.

### Tarea 1.4 — RLS de `aportes_meta`
- [ ] **Paso 1:** `enable row level security` en `aportes_meta`.
- [ ] **Paso 2:** Política de acceso que **hereda de la meta** vía `EXISTS` (mismo patrón que `prestamos` hereda de `transacciones`, schema.sql:189-207): un usuario ve/escribe una fila de `aportes_meta` solo si la meta asociada es de hogar o suya (`metas.ambito='hogar' or auth.uid()=metas.user_id`).
- [ ] **Paso 3:** Reflejar en `schema.sql` (sección RLS).

### Tarea 1.5 — RPC `distribuir_ahorro(p_transaccion_id uuid)`
- [ ] **Paso 1:** Función plpgsql `SECURITY DEFINER`, `set search_path = public`. Entrada: id de la transacción de ahorro recién creada.
- [ ] **Paso 2:** Validación de pertenencia: leer la transacción; confirmar que `auth.uid() = transaccion.user_id` (evita que el RPC reparta ahorros ajenos pese a ser DEFINER). Si no coincide, `raise exception`.
- [ ] **Paso 3:** Seleccionar metas candidatas: `ambito='personal'`, `user_id = transaccion.user_id`, `estado='en_curso'`, no vencidas (`fecha_limite >= current_date`), con restante > 0 (`monto_objetivo - progreso_actual`).
- [ ] **Paso 4:** Calcular `peso_final` por meta según fórmula (Tarea 1.7). Si Σpesos = 0 o no hay metas → no insertar nada (excedente sin asignar); retornar.
- [ ] **Paso 5:** Repartir `transaccion.monto` proporcional al peso, **topado al restante** de cada meta; redistribuir sobrante entre metas no saturadas en una segunda pasada; el remanente final queda sin asignar.
- [ ] **Paso 6:** Insertar filas en `aportes_meta` (una por meta con asignación > 0) dentro de la misma transacción de función (atómico).
- [ ] **Paso 7:** Marcar metas que alcanzan el objetivo como `estado='lograda'` (`update metas`).
- [ ] **Paso 8:** `grant execute` a `authenticated`; revocar de `anon`/`public`.

### Tarea 1.6 — RPC `distribuir_aporte_hogar(p_aporte_id uuid)`
- [ ] **Paso 1:** Misma estructura que 1.5 pero el monto a repartir es el de la **mitad ingreso-hogar** del aporte (buscar la transacción `ambito='hogar'`, `tipo='ingreso'` con ese `aporte_id`).
- [ ] **Paso 2:** Validación de pertenencia: confirmar que existe el par de transacciones con ese `aporte_id` y que la mitad personal es del `auth.uid()`.
- [ ] **Paso 3:** Metas candidatas: `ambito='hogar'`, `user_id is null`, `estado='en_curso'`, no vencidas, restante > 0.
- [ ] **Paso 4:** `aportes_meta.transaccion_id` apunta a la transacción **ingreso-hogar** (así, si se borra el aporte, la cascade revierte; `deleteTransaccion` ya borra ambas mitades por `aporte_id`).
- [ ] **Paso 5:** Reparto + cap + redistribución + marcar `lograda`, idéntico a 1.5.
- [ ] **Paso 6:** Grants iguales a 1.5.

### Tarea 1.7 — Constantes de la fórmula de peso (documentar en la migración como comentario)
- [ ] **Paso 1:** Fijar curvas iniciales (ajustables): `f_horizonte`: corto=3, mediano=2, largo=1. `f_urgencia`: por días restantes → `<7d`=3, `<30d`=2, resto=1. `f_rezago`: `(1 - avance%)` acotado a [0.2, 1] (metas atrasadas pesan más sin anular a las casi completas). `f_restante`: `min(restante / monto_objetivo, 1)`. `importancia`: 1–5 directo.
- [ ] **Paso 2:** `peso_final = importancia × f_horizonte × f_urgencia × f_rezago × f_restante`. Documentar como bloque de comentario al inicio de cada RPC.

### Verificación FASE 1 (en Supabase real, SQL Editor)
- [ ] Ejecutar la migración completa sin errores.
- [ ] `select * from metas_con_progreso` devuelve filas con `monto_actual = 0` (aún sin aportes) e `importancia = 3`.
- [ ] Insertar manualmente un ahorro de prueba y llamar `select distribuir_ahorro('<id>')`; verificar filas en `aportes_meta` y que Σmontos ≤ monto del ahorro y ningún reparto supera el restante de su meta.
- [ ] Borrar la transacción de prueba; confirmar que `aportes_meta` queda vacía (cascade) y `metas_con_progreso.monto_actual` vuelve a 0.
- [ ] **Regresión balances:** `getBalanceHogar`/`getBalancePersonal` (vía SQL equivalente) dan los mismos totales que antes de la migración.
- [ ] Code review de la migración (`code-review`), aplicar fixes, commit, merge `--no-ff`, borrar branch. Borrar registros de prueba.

---

## FASE 2 — db.js (capa de datos)

**Branch:** `feat/metas-db`
**Archivos:** Modificar `js/db.js`.

### Tarea 2.1 — `getMetas` lee la vista
- [ ] **Paso 1:** Cambiar la consulta de `getMetas` (db.js:432-447) de `.from('metas')` a `.from('metas_con_progreso')`. Mantener orden por `fecha_limite` y filtro opcional `ambito`. La forma de la fila no cambia (incluye `monto_actual` derivado + `importancia`).
- [ ] **Paso 2:** Verificar sintaxis: `node -e` con `vm.compileFunction` sobre el cuerpo de db.js (igual método ya usado en el proyecto).

### Tarea 2.2 — `insertTransaccion` dispara reparto de ahorro
- [ ] **Paso 1:** Tras el insert exitoso (db.js:108-114), si la categoría de la transacción es "Ahorro" y `tipo='gasto'`, llamar `await supabase.rpc('distribuir_ahorro', { p_transaccion_id: data.id })`. Resolver el nombre/id de "Ahorro" igual que el patrón de `insertAporteHogar` (buscar por nombre vía `getCategorias('gasto')`), o comparar contra el nombre recibido si la vista lo expone.
- [ ] **Paso 2:** El reparto es **best-effort no bloqueante para el balance**: si el RPC falla, la transacción ya existe (balance correcto); loguear el error pero **no** revertir la transacción ni lanzar. Documentar esta decisión en comentario.
- [ ] **Paso 3:** Verificar sintaxis con `node`.

### Tarea 2.3 — `insertAporteHogar` dispara reparto al hogar
- [ ] **Paso 1:** Tras el insert atómico de las 2 filas (db.js:210-215), llamar `await supabase.rpc('distribuir_aporte_hogar', { p_aporte_id: aporteId })`.
- [ ] **Paso 2:** Mismo criterio best-effort que 2.2 (el aporte y su `aporte_id` ya existen; el reparto no debe tumbarlos).
- [ ] **Paso 3:** Verificar sintaxis con `node`.

### Tarea 2.4 — Retirar progreso manual; `updateMeta` admite `importancia`
- [ ] **Paso 1:** Confirmar que ningún flujo de db.js escribe `monto_actual` (ahora es derivado). `updateMeta` (db.js:478-492) sigue genérico; documentar que `monto_actual` ya no debe pasarse.
- [ ] **Paso 2:** `insertMeta`/`updateMeta` aceptan `importancia` en `datos` (ya son genéricos; solo documentar el campo válido).

### Tarea 2.5 — `getAportesDeMeta(meta_id)` (auditoría)
- [ ] **Paso 1:** Nueva función global: lee `aportes_meta` filtrando por `meta_id`, embebiendo `transacciones(fecha, monto, nota)` para mostrar origen. Ordenar por `created_at` desc. Try/catch → `[]` en error (patrón db.js).
- [ ] **Paso 2:** Verificar sintaxis con `node`.

### Verificación FASE 2 (script Node autenticado contra Supabase, método ya usado)
- [ ] Script: login con cuenta de prueba → `insertTransaccion` ahorro → leer `getMetas` → confirmar `monto_actual` subió y suma = monto repartido.
- [ ] Script: `insertAporteHogar` → confirmar reparto en metas de hogar + balances hogar/personal sin cambio.
- [ ] Script: `getAportesDeMeta` devuelve el desglose con origen.
- [ ] Script: borrar las transacciones de prueba → `getMetas.monto_actual` vuelve a su valor previo (reversión por cascade).
- [ ] Code review, fixes, commit, merge `--no-ff`, borrar branch y registros de prueba.

---

## FASE 3 — alerts.js (compatibilidad)

**Branch:** `feat/metas-alerts` (puede combinarse con Fase 4 si el cambio es nulo).
**Archivos:** Verificar/Modificar `js/alerts.js`.

### Tarea 3.1 — Verificar lectura de progreso derivado
- [ ] **Paso 1:** `_alertasMetas` (alerts.js:122-160) usa `meta.monto_actual` y `meta.monto_objetivo`. Como `getMetas` ahora viene de la vista, `monto_actual` llega derivado correctamente → **sin cambios funcionales esperados**. Confirmar leyendo el código.
- [ ] **Paso 2:** Verificación: script Node que fuerza una meta a `lograda` vía aportes y confirma que `evaluarAlertas` no la marca "vencida sin cumplir".

### Tarea 3.2 — (Opcional) Alerta "ahorro sin metas"
- [ ] **Paso 1:** Decisión de producto pendiente del spec: si un ahorro no se repartió (sin metas activas), ¿emitir alerta suave? Si se aprueba, añadir evaluador `_alertasAhorroSinDestino` consultando ahorros del mes sin filas en `aportes_meta`. Si no se aprueba, omitir esta tarea.
- [ ] **Paso 2:** Si se implementa: verificar con script Node; si no, marcar la tarea como descartada.

### Verificación FASE 3
- [ ] `evaluarAlertas` corre sin error con datos reales. Code review si hubo cambios; commit; merge.

---

## FASE 4 — dashboard.html

**Branch:** `feat/metas-dashboard`
**Archivos:** Modificar `views/dashboard.html`.

### Tarea 4.1 — Quitar aporte manual a metas
- [ ] **Paso 1:** Eliminar el mini-form inline "Aportar" y su lógica `_wireAportes` (el progreso ahora es automático). Quitar el botón "+ Aportar", el `data-aportar-form` y el handler que llamaba `updateMeta(actual+monto)`.
- [ ] **Paso 2:** La barra de progreso sigue leyendo `monto_actual` (ahora derivado de la vista) — el render no cambia. Verificar que `renderMetas` ya no referencia funciones eliminadas.
- [ ] **Paso 3:** Verificar sintaxis del `<script>` con `node` (extraer bloque + `vm.compileFunction`, método ya usado).

### Tarea 4.2 — (Opcional) Indicador de "automático"
- [ ] **Paso 1:** Pequeño texto/ícono que comunique "el progreso se actualiza solo con tus ahorros y aportes" para que el usuario no busque el botón eliminado. Una línea de copy, sin lógica.

### Verificación FASE 4 (Live Server)
- [ ] Cargar dashboard: metas muestran progreso correcto desde la vista; ya no aparece el form de aporte manual; sin errores en consola.
- [ ] Registrar un ahorro desde el FAB → al refrescar, el progreso de metas subió automáticamente.
- [ ] Code review, fixes, commit, merge `--no-ff`, borrar branch.

---

## FASE 5 — transaccion.html (aviso de reparto)

**Branch:** `feat/metas-transaccion`
**Archivos:** Modificar `views/transaccion.html`.

### Tarea 5.1 — Aviso post-guardado de reparto
- [ ] **Paso 1:** En la pantalla de éxito ya existente (`mostrarExito`, reutilizar el patrón de `txAlertaPost`), si la transacción fue ahorro o aporte al hogar, mostrar un resumen no bloqueante: "Repartido entre N metas". Obtener el desglose llamando `getAportesDeMeta` por las metas afectadas, o un nuevo helper `getAportesDeTransaccion(id)` si resulta más simple (decidir en implementación; si se añade, reflejarlo en db.js Fase 2 retroactivamente vía branch corto).
- [ ] **Paso 2:** Si no hubo reparto (sin metas activas), no mostrar nada extra.
- [ ] **Paso 3:** Verificar sintaxis con `node`; probar en Live Server (vista y modal).

### Verificación FASE 5
- [ ] Guardar ahorro con metas activas → pantalla de éxito muestra el reparto. Guardar sin metas → sin aviso extra. Code review; commit; merge.

---

## FASE 6 — metas.html (vista nueva)

**Branch:** `feat/metas-vista`
**Archivos:** Crear `views/metas.html`. (Ruta `metas` ya existe en `router.js:115`.)

### Tarea 6.1 — Listado de metas con progreso
- [ ] **Paso 1:** IIFE (patrón de las otras vistas). Cargar `getMetas()`; separar personales/hogar; render con barra de progreso (reusar estilos del dashboard), cifras `monto_actual`/`monto_objetivo`, estado, fecha límite. Estado de carga (skeleton) y vacío.
- [ ] **Paso 2:** Mobile-first, tokens CSS existentes. Verificar sintaxis con `node`.

### Tarea 6.2 — Control de importancia
- [ ] **Paso 1:** Por meta, control 1–5 (estrellas o selector) que llama `updateMeta(id, { importancia })`. Feedback inline; recargar al guardar.
- [ ] **Paso 2:** Respeta RLS: solo el dueño edita personales; ambos editan las de hogar (la política ya lo permite).

### Tarea 6.3 — Desglose de aportes por meta
- [ ] **Paso 1:** Expandir una meta → `getAportesDeMeta(id)` → tabla de aportes (fecha origen, monto, nota de la transacción). Indicar excedente si la meta está `lograda`.

### Tarea 6.4 — Crear/editar/eliminar meta (si no existía)
- [ ] **Paso 1:** Form de alta (`insertMeta`: nombre, tipo, horizonte, ambito, monto_objetivo, fecha_limite, importancia). Editar (`updateMeta`) y borrar (`deleteMeta`, con confirmación).
- [ ] **Paso 2:** Validaciones inline (objetivo > 0, fecha futura, ámbito coherente con RLS).

### Verificación FASE 6 (Live Server)
- [ ] Navegar a `#metas`: lista, progreso, edición de importancia persiste, desglose correcto, alta/edición/borrado funcionan. Code review; commit; merge.

---

## FASE 7 — graficos.html (vista nueva)

**Branch:** `feat/metas-graficos`
**Archivos:** Crear `views/graficos.html`. (Ruta `graficos` ya existe en `router.js:114`.)

### Tarea 7.1 — Gráfico de progreso de metas
- [ ] **Paso 1:** Decidir librería: si ya hay una en el proyecto, reusar; si no, Chart.js por CDN (consistente con el patrón "sin build"). Documentar la elección.
- [ ] **Paso 2:** Barra/donut de `monto_actual` vs `monto_objetivo` por meta, desde `getMetas`. Carga + vacío + error.

### Tarea 7.2 — Aportes a lo largo del tiempo
- [ ] **Paso 1:** Serie temporal de `aportes_meta` (nuevo helper `getAportesPorPeriodo` en db.js si hace falta — branch corto que actualiza Fase 2). Agrupar por mes.
- [ ] **Paso 2:** Mobile-first, accesible (alt/resumen textual del gráfico).

### Verificación FASE 7 (Live Server)
- [ ] `#graficos` renderiza ambos gráficos con datos reales; responsive; sin errores. Code review; commit; merge.

---

## FASE 8 — Limpieza final (opcional, tras estabilizar)

**Branch:** `chore/metas-cleanup`

### Tarea 8.1 — Retirar `metas.monto_actual` físico
- [ ] **Paso 1:** Solo cuando todas las lecturas pasen por la vista y no quede ningún escritor de la columna: migración que elimina `metas.monto_actual` (o lo deja como respaldo histórico). **No ejecutar antes** — es el único paso destructivo.
- [ ] **Paso 2:** Actualizar `schema.sql`. Verificación completa de regresión (dashboard, metas, alertas, gráficos). Code review; merge.

---

## Auto-revisión del plan

- **Cobertura del spec:** schema (F1), db.js (F2), alertas (F3), dashboard (F4), transaccion (F5), metas (F6), graficos (F7) — los 7 archivos pedidos tienen fase. Distribución ponderada (F1.5–1.7), auditabilidad (`aportes_meta`+`getAportesDeMeta`), reversibilidad (cascade), RLS personal/hogar (F1.4), balances intactos (verif. F1/F2) — todos cubiertos.
- **Sin destructivo prematuro:** el único `drop` está aislado en F8, tras estabilizar. Migración aditiva en F1.
- **Consistencia de nombres:** `aportes_meta`, `metas_con_progreso`, `distribuir_ahorro(p_transaccion_id)`, `distribuir_aporte_hogar(p_aporte_id)`, `getAportesDeMeta(meta_id)`, `importancia` — usados consistentes en todas las fases.
- **Puntos abiertos heredados del spec** (resolver antes de F1.7/F3.2/F5.1): curvas exactas de pesos, manejo de excedente, alerta "ahorro sin metas", helper `getAportesDeTransaccion`. No bloquean el orden de fases.
