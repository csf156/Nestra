# Plan de implementación — Asignación automática de metas

> **Para workers agénticos:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan checkbox (`- [ ]`).

**Meta:** Reemplazar el `monto_actual` manual de las metas por progreso automático derivado de movimientos reales (gastos en "Ahorro" → metas personales; aportes al hogar → metas del hogar), con distribución ponderada, auditable y reversible. Un "Fondo de emergencia" permanente actúa como participante con peso propio y sumidero del excedente.

**Arquitectura:** Nueva tabla `aportes_meta` (movimientos) como verdad; `monto_actual` derivado vía vista `metas_con_progreso`. Distribución atómica en RPC PostgreSQL `SECURITY DEFINER` invocado desde db.js. Reversión automática vía FK `ON DELETE CASCADE`. Migración **aditiva** (no destructiva) → la app sigue funcionando en cada fase.

**Stack:** PostgreSQL/Supabase (PostgREST + RLS), JS vanilla global (sin import/export), Supabase JS SDK v2 CDN. Sin framework de tests: verificación por `node` (sintaxis + REST autenticado) y Live Server.

---

## Decisiones cerradas (brainstorming)

1. **Modelo:** auditable + reversible → tabla `aportes_meta`; `monto_actual` derivado por vista.
2. **Ubicación lógica:** RPC PostgreSQL `SECURITY DEFINER` invocado desde db.js (atómico, trazable, iterable).
3. **Fórmula de peso (metas normales):** `peso = importancia × f_horizonte × f_urgencia × f_rezago` — **sin** `f_restante` (evita que metas grandes acaparen; el tope-al-restante sigue evitando sobrefinanciar).
4. **Fondo de emergencia:** meta permanente, **imposible de borrar**, **sin objetivo** (solo acumula), flag `es_fondo_emergencia`. Existe **uno personal por usuario** (sumidero de ahorros personales) y **uno de hogar compartido** (sumidero de aportes). **Compite** en el reparto con peso propio = su `importancia` (sin horizonte/urgencia/rezago, porque no tiene fecha ni objetivo) **y además** recibe todo el sobrante del cap.
5. **Excedente:** siempre va al Fondo de emergencia del ámbito correspondiente → nunca queda dinero sin asignar.
6. **Sin metas normales:** no requiere alerta; el Fondo siempre es destino. (Se elimina la tarea opcional "ahorro sin metas".)

**Constantes de peso iniciales (ajustables, documentar como comentario en cada RPC):**
```
peso_meta_normal = importancia × f_horizonte × f_urgencia × f_rezago
  importancia : 1–5 (configurable por usuario; default 3)
  f_horizonte : corto=3, mediano=2, largo=1
  f_urgencia  : dias_hasta(fecha_limite) <7 ⇒ 3 ; <30 ⇒ 2 ; resto ⇒ 1
  f_rezago    : (1 − avance%) acotado a [0.2, 1]   (avance% = monto_actual/monto_objetivo)

peso_fondo = importancia_fondo   (default 2; sin horizonte/urgencia/rezago)

reparto: monto_i = total × peso_i / Σ(pesos)
         metas normales se topan a su restante; el sobrante acumulado del cap
         se suma íntegro al fondo (que nunca se topa).
```

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
| `supabase/migrations/20260606_metas_automaticas.sql` | Columnas, tabla, vista, RLS, fondo, RPCs | **Crear** |
| `supabase/schema.sql` | Documento canónico del esquema | Modificar (reflejar migración) |
| `js/db.js` | Capa de datos: lectura por vista, disparo de RPC, auditoría | Modificar |
| `views/transaccion.html` | Aviso post-guardado de reparto | Modificar |
| `views/dashboard.html` | Quitar aporte manual; progreso desde vista; fondo especial | Modificar |
| `views/metas.html` | Importancia + desglose + CRUD + fondo no-borrable | **Crear** |
| `js/alerts.js` | Saltar fondo en alertas de metas | Modificar |
| `views/graficos.html` | Gráficos de progreso y aportes | **Crear** |

Orden por dependencia: **schema → db.js → alerts.js → dashboard → transaccion → metas → graficos**.

---

## FASE 1 — schema.sql + migración (fundación DB)

**Branch:** `feat/metas-schema`
**Archivos:** Crear `supabase/migrations/20260606_metas_automaticas.sql`; Modificar `supabase/schema.sql`.

### Tarea 1.1 — Columnas nuevas en `metas`
- [ ] **Paso 1:** Añadir `importancia` int `default 3` `check (importancia between 1 and 5)`.
- [ ] **Paso 2:** Añadir `es_fondo_emergencia` boolean `not null default false`.
- [ ] **Paso 3:** Relajar restricciones para el fondo (que no tiene objetivo/fecha/horizonte): hacer `monto_objetivo`, `fecha_limite` y `horizonte` **nullable**, y añadir un `check` a nivel tabla: si `es_fondo_emergencia=false` entonces los tres deben ser NOT NULL y `monto_objetivo > 0`; si `true`, pueden ser NULL. (Reemplaza el `check (monto_objetivo > 0)` y los `not null` actuales.)
- [ ] **Paso 4:** Reflejar todo en `schema.sql` sección 1.5.

### Tarea 1.2 — Tabla `aportes_meta`
- [ ] **Paso 1:** `public.aportes_meta`: `id` uuid PK; `meta_id` uuid `not null references metas(id) on delete cascade`; `transaccion_id` uuid `not null references transacciones(id) on delete cascade`; `monto` numeric(10,2) `check (monto > 0)`; `peso_aplicado` numeric; `created_at` timestamptz default now().
- [ ] **Paso 2:** Índices sobre `meta_id` y `transaccion_id`.
- [ ] **Paso 3:** Reflejar en `schema.sql` (nueva sección, renumerar índices).

### Tarea 1.3 — Vista `metas_con_progreso`
- [ ] **Paso 1:** `metas LEFT JOIN aportes_meta` con `coalesce(sum(aportes_meta.monto),0) as monto_actual`, exponiendo todas las columnas de `metas` (incl. `importancia`, `es_fondo_emergencia`).
- [ ] **Paso 2:** `security_invoker = true` para que respete el RLS del usuario consultante.
- [ ] **Paso 3:** Reflejar en `schema.sql`.

### Tarea 1.4 — RLS de `aportes_meta` (hereda de la meta)
- [ ] **Paso 1:** `enable row level security`.
- [ ] **Paso 2:** Política `for all` con `EXISTS` sobre `metas` (patrón de `prestamos`, schema.sql:189-207): acceso si la meta es de hogar o `auth.uid() = metas.user_id`.
- [ ] **Paso 3:** Reflejar en `schema.sql`.

### Tarea 1.5 — Proteger el fondo contra borrado
- [ ] **Paso 1:** Modificar la política `metas_delete` (schema.sql:235-238): añadir `and es_fondo_emergencia = false` al `using`, de modo que ningún cliente pueda borrar un fondo vía API.
- [ ] **Paso 2:** Reflejar en `schema.sql`.

### Tarea 1.6 — Crear/convertir los Fondos de emergencia
- [ ] **Paso 1:** **Hogar:** convertir la meta semilla "Fondo de emergencia" (schema.sql:344) en el fondo oficial: `update metas set es_fondo_emergencia=true, monto_objetivo=null, fecha_limite=null, horizonte=null where nombre='Fondo de emergencia' and ambito='hogar'`. En `schema.sql`, ajustar la fila semilla para nacer ya como fondo.
- [ ] **Paso 2:** **Personal (usuarios existentes):** en la migración, insertar un fondo personal para cada usuario de `auth.users` que no tenga uno (`insert ... select` con `not exists`). Campos: nombre 'Fondo de emergencia', tipo 'ahorro', ambito 'personal', user_id = usuario, `es_fondo_emergencia=true`, objetivo/fecha/horizonte NULL, `importancia=2`, estado 'en_curso'.
- [ ] **Paso 3:** **Personal (usuarios nuevos):** extender `handle_new_user()` (schema.sql:278-293) para que, además del profile, inserte el fondo personal del nuevo usuario. Mantener `SECURITY DEFINER` y `search_path`.
- [ ] **Paso 4:** Reflejar la función y la semilla en `schema.sql`.

### Tarea 1.7 — RPC `distribuir_ahorro(p_transaccion_id uuid)`
- [ ] **Paso 1:** plpgsql `SECURITY DEFINER`, `set search_path = public`.
- [ ] **Paso 2:** Validar pertenencia: leer la transacción; exigir `auth.uid() = transaccion.user_id`; si no, `raise exception`.
- [ ] **Paso 3:** Candidatas normales: metas `ambito='personal'`, `user_id = transaccion.user_id`, `es_fondo_emergencia=false`, `estado='en_curso'`, `fecha_limite >= current_date`, restante (`monto_objetivo − progreso`) > 0.
- [ ] **Paso 4:** Fondo personal del usuario: la meta `es_fondo_emergencia=true`, `ambito='personal'`, `user_id = transaccion.user_id`.
- [ ] **Paso 5:** Pesos: normales = `importancia × f_horizonte × f_urgencia × f_rezago`; fondo = `importancia_fondo`. (Constantes de la sección Decisiones; documentar como comentario.)
- [ ] **Paso 6:** Reparto proporcional al peso; **topar cada normal a su restante**; acumular el sobrante del cap y sumarlo íntegro al fondo. El fondo nunca se topa.
- [ ] **Paso 7:** Insertar filas en `aportes_meta` (una por meta con asignación > 0) atómicamente, guardando `peso_aplicado`.
- [ ] **Paso 8:** Marcar `estado='lograda'` las normales que alcanzan el objetivo (el fondo nunca).
- [ ] **Paso 9:** `grant execute` a `authenticated`; revocar de `anon`/`public`.

### Tarea 1.8 — RPC `distribuir_aporte_hogar(p_aporte_id uuid)`
- [ ] **Paso 1:** Igual estructura; el monto a repartir es el de la mitad **ingreso-hogar** del aporte (transacción `ambito='hogar'`, `tipo='ingreso'`, ese `aporte_id`).
- [ ] **Paso 2:** Validar que existe el par con ese `aporte_id` y que la mitad personal es de `auth.uid()`.
- [ ] **Paso 3:** Candidatas normales: `ambito='hogar'`, `user_id is null`, `es_fondo_emergencia=false`, `en_curso`, no vencidas, restante > 0. Fondo: `es_fondo_emergencia=true`, `ambito='hogar'`.
- [ ] **Paso 4:** `aportes_meta.transaccion_id` apunta a la transacción **ingreso-hogar** (la cascade revierte; `deleteTransaccion` ya borra ambas mitades por `aporte_id`).
- [ ] **Paso 5:** Pesos, reparto, cap→fondo, marcar lograda, grants: idénticos a 1.7.

### Verificación FASE 1 (Supabase real, SQL Editor)
- [ ] Migración corre sin errores; usuarios existentes quedan con su fondo personal; hogar tiene su fondo (objetivo/fecha NULL).
- [ ] `select * from metas_con_progreso`: filas con `monto_actual=0`, `importancia` correcta, fondos con flag true.
- [ ] Ahorro de prueba + `select distribuir_ahorro('<id>')`: filas en `aportes_meta`; Σmontos = monto del ahorro (sin pérdida, gracias al fondo); ninguna normal supera su restante; el fondo recibió el sobrante.
- [ ] Caso "todas las normales llenas": el total va al fondo personal.
- [ ] Aporte hogar + `distribuir_aporte_hogar`: reparte entre metas de hogar + fondo de hogar; balances hogar/personal sin cambio.
- [ ] Borrar la transacción de prueba: `aportes_meta` se vacía (cascade); `monto_actual` vuelve a 0.
- [ ] Intentar borrar un fondo vía API → rechazado por RLS.
- [ ] **Regresión balances** sin cambios. Code review, fixes, commit, merge `--no-ff`, borrar branch y registros de prueba.

---

## FASE 2 — db.js (capa de datos)

**Branch:** `feat/metas-db`
**Archivos:** Modificar `js/db.js`.

### Tarea 2.1 — `getMetas` lee la vista
- [ ] **Paso 1:** Cambiar `getMetas` (db.js:432-447) a `.from('metas_con_progreso')`; mantener orden por `fecha_limite` (nullable: los fondos ordenan al final con `nullslast`) y filtro opcional `ambito`. Forma de fila inalterada + `importancia` + `es_fondo_emergencia`.
- [ ] **Paso 2:** Verificar sintaxis con `node` (`vm.compileFunction`).

### Tarea 2.2 — `insertTransaccion` dispara reparto de ahorro
- [ ] **Paso 1:** Tras el insert (db.js:108-114), si la transacción es gasto en categoría "Ahorro", llamar `await supabase.rpc('distribuir_ahorro', { p_transaccion_id: data.id })`. Resolver "Ahorro" por nombre vía `getCategorias('gasto')` (patrón de `insertAporteHogar`).
- [ ] **Paso 2:** Best-effort: si el RPC falla, la transacción ya existe (balance correcto) → loguear, **no** lanzar ni revertir. Documentar en comentario.
- [ ] **Paso 3:** Verificar sintaxis con `node`.

### Tarea 2.3 — `insertAporteHogar` dispara reparto al hogar
- [ ] **Paso 1:** Tras el insert atómico (db.js:210-215), llamar `await supabase.rpc('distribuir_aporte_hogar', { p_aporte_id: aporteId })`.
- [ ] **Paso 2:** Best-effort igual que 2.2.
- [ ] **Paso 3:** Verificar sintaxis con `node`.

### Tarea 2.4 — Retirar progreso manual; `importancia` en escritura
- [ ] **Paso 1:** Confirmar que nada en db.js escribe `monto_actual` (derivado). Documentar que `updateMeta` (db.js:478-492) ya no debe recibir `monto_actual`.
- [ ] **Paso 2:** `insertMeta`/`updateMeta` aceptan `importancia` (genéricos; solo documentar campo válido).

### Tarea 2.5 — `getAportesDeMeta(meta_id)` (auditoría)
- [ ] **Paso 1:** Nueva función global: `aportes_meta` filtrado por `meta_id`, embebiendo `transacciones(fecha, monto, nota)`; orden `created_at` desc; try/catch → `[]`.
- [ ] **Paso 2:** Verificar sintaxis con `node`.

### Verificación FASE 2 (script Node autenticado, método ya usado)
- [ ] `insertTransaccion` ahorro → `getMetas`: `monto_actual` sube; suma cuadra con el monto; el fondo personal recibió sobrante si aplica.
- [ ] `insertAporteHogar` → reparto en metas de hogar + fondo de hogar; balances sin cambio.
- [ ] `getAportesDeMeta` devuelve desglose con origen.
- [ ] Borrar transacciones de prueba → `monto_actual` revierte por cascade.
- [ ] Code review, fixes, commit, merge `--no-ff`, limpiar branch y datos de prueba.

---

## FASE 3 — alerts.js (saltar el fondo)

**Branch:** `feat/metas-alerts`
**Archivos:** Modificar `js/alerts.js`.

### Tarea 3.1 — Excluir fondos de las alertas de meta
- [ ] **Paso 1:** En `_alertasMetas` (alerts.js:122-160), saltar metas con `es_fondo_emergencia=true` (no tienen objetivo ni fecha → las comparaciones `monto_actual >= monto_objetivo` y `_diasHasta(fecha_limite)` con NULL darían falsos positivos/errores).
- [ ] **Paso 2:** Confirmar que las metas normales (con `monto_actual` derivado de la vista) siguen evaluándose igual.
- [ ] **Paso 3:** Verificación: script Node — meta normal forzada a `lograda` por aportes no se marca "vencida sin cumplir"; el fondo nunca genera alerta de meta.

### Verificación FASE 3
- [ ] `evaluarAlertas` corre sin error con datos reales (incluyendo fondos). Code review; commit; merge.

---

## FASE 4 — dashboard.html

**Branch:** `feat/metas-dashboard`
**Archivos:** Modificar `views/dashboard.html`.

### Tarea 4.1 — Quitar aporte manual
- [ ] **Paso 1:** Eliminar el mini-form "Aportar", el botón "+ Aportar", `data-aportar-form` y `_wireAportes` (progreso ahora automático). Confirmar que `renderMetas` no referencia funciones eliminadas.
- [ ] **Paso 2:** Verificar sintaxis del `<script>` con `node`.

### Tarea 4.2 — Render del fondo + barra desde vista
- [ ] **Paso 1:** Las metas normales mantienen barra leyendo `monto_actual` (derivado). El **fondo** se renderiza distinto: sin barra de %, solo monto acumulado (porque no tiene objetivo). Filtrar/identificar por `es_fondo_emergencia`.
- [ ] **Paso 2:** Línea de copy: "El progreso se actualiza solo con tus ahorros y aportes."
- [ ] **Paso 3:** Verificar en Live Server.

### Verificación FASE 4 (Live Server)
- [ ] Metas con progreso correcto; fondo mostrado como acumulado; sin form manual; sin errores en consola.
- [ ] Registrar un ahorro desde el FAB → al refrescar, el progreso subió automáticamente.
- [ ] Code review, fixes, commit, merge `--no-ff`.

---

## FASE 5 — transaccion.html (aviso de reparto)

**Branch:** `feat/metas-transaccion`
**Archivos:** Modificar `views/transaccion.html`; (si hace falta) `js/db.js`.

### Tarea 5.1 — Aviso post-guardado
- [ ] **Paso 1:** En `mostrarExito` (reusar patrón `txAlertaPost`), si fue ahorro o aporte al hogar, mostrar resumen no bloqueante: "Repartido entre N metas (incl. Fondo de emergencia)". Para el desglose, añadir helper `getAportesDeTransaccion(transaccion_id)` en db.js (consulta `aportes_meta` por `transaccion_id` embebiendo `metas(nombre)`); si se añade, hacerlo en branch corto que actualice también la doc de Fase 2.
- [ ] **Paso 2:** Verificar sintaxis con `node`; probar vista y modal en Live Server.

### Verificación FASE 5
- [ ] Guardar ahorro → pantalla de éxito muestra el reparto (incluyendo el fondo). Code review; commit; merge.

---

## FASE 6 — metas.html (vista nueva)

**Branch:** `feat/metas-vista`
**Archivos:** Crear `views/metas.html`. (Ruta `metas` ya existe en `router.js:115`.)

### Tarea 6.1 — Listado con progreso
- [ ] **Paso 1:** IIFE; `getMetas()`; separar personales/hogar; barra de progreso (estilos del dashboard); cifras, estado, fecha. El **fondo** se muestra aparte como acumulador (sin barra). Estados de carga y vacío. Mobile-first, tokens existentes.
- [ ] **Paso 2:** Verificar sintaxis con `node`.

### Tarea 6.2 — Control de importancia
- [ ] **Paso 1:** Control 1–5 por meta → `updateMeta(id, { importancia })`; feedback inline; recargar. Aplica también al fondo (su importancia define su peso competitivo).
- [ ] **Paso 2:** RLS: solo dueño edita personales; ambos editan hogar.

### Tarea 6.3 — Desglose de aportes
- [ ] **Paso 1:** Expandir meta → `getAportesDeMeta(id)` → tabla (fecha origen, monto, nota). Para el fondo, mostrar histórico acumulado.

### Tarea 6.4 — CRUD de metas
- [ ] **Paso 1:** Alta (`insertMeta`: nombre, tipo, horizonte, ambito, monto_objetivo, fecha_limite, importancia). Editar (`updateMeta`), borrar (`deleteMeta` con confirmación). **El fondo no muestra botón borrar** (y la RLS lo bloquea por si acaso).
- [ ] **Paso 2:** Validaciones inline (objetivo > 0, fecha futura, ámbito coherente con RLS).

### Verificación FASE 6 (Live Server)
- [ ] `#metas`: lista, progreso, fondo como acumulador no-borrable, importancia persiste, desglose correcto, CRUD funciona. Code review; commit; merge.

---

## FASE 7 — graficos.html (vista nueva)

**Branch:** `feat/metas-graficos`
**Archivos:** Crear `views/graficos.html`. (Ruta `graficos` ya existe en `router.js:114`.)

### Tarea 7.1 — Progreso de metas
- [ ] **Paso 1:** Elegir librería: reusar si ya existe; si no, Chart.js por CDN (patrón sin build). Documentar elección.
- [ ] **Paso 2:** Barra/donut `monto_actual` vs `monto_objetivo` por meta normal desde `getMetas`; el fondo se grafica como acumulado simple. Carga/vacío/error.

### Tarea 7.2 — Aportes en el tiempo
- [ ] **Paso 1:** Serie temporal desde `aportes_meta` (helper `getAportesPorPeriodo` en db.js si hace falta — branch corto que actualice doc de Fase 2). Agrupar por mes.
- [ ] **Paso 2:** Mobile-first; accesible (resumen textual del gráfico).

### Verificación FASE 7 (Live Server)
- [ ] `#graficos` renderiza ambos con datos reales; responsive; sin errores. Code review; commit; merge.

---

## FASE 8 — Limpieza final (opcional, tras estabilizar)

**Branch:** `chore/metas-cleanup`

### Tarea 8.1 — Retirar `metas.monto_actual` físico
- [ ] **Paso 1:** Solo cuando todas las lecturas pasen por la vista y ningún escritor toque la columna: migración que elimina `metas.monto_actual`. **Único paso destructivo; no antes.**
- [ ] **Paso 2:** Actualizar `schema.sql`; regresión completa (dashboard, metas, alertas, gráficos). Code review; merge.

---

## Auto-revisión del plan

- **Cobertura:** schema (F1), db.js (F2), alertas (F3), dashboard (F4), transaccion (F5), metas (F6), graficos (F7) — los 7 archivos pedidos tienen fase. Distribución ponderada sin f_restante (F1.7-1.8), fondo personal+hogar como participante+sumidero (F1.6-1.8), no-borrable (F1.5), auditabilidad (`aportes_meta`+`getAportesDeMeta`), reversibilidad (cascade), RLS heredada (F1.4), balances intactos (verif. F1/F2) — cubiertos.
- **Sin destructivo prematuro:** único `drop` aislado en F8. F1 aditiva (columnas nullable, no se rompe data existente).
- **Consistencia de nombres:** `aportes_meta`, `metas_con_progreso`, `es_fondo_emergencia`, `importancia`, `distribuir_ahorro(p_transaccion_id)`, `distribuir_aporte_hogar(p_aporte_id)`, `getAportesDeMeta(meta_id)`, `getAportesDeTransaccion(transaccion_id)` — consistentes en todas las fases.
- **Decisiones cerradas** incorporadas: excedente→fondo, sin alerta "ahorro sin metas", fórmula sin f_restante, fondo sin objetivo. No quedan puntos abiertos bloqueantes.
