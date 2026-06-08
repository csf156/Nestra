# Design: Vista de Metas (metas.html)

**Date:** 2026-06-08
**Status:** Approved (pending spec review)
**Scope:** `views/metas.html` — gestión de metas: activas, completadas, alta vía modal, y acciones (registrar aporte, marcar lograda, eliminar). Cierra la Sesión 7 junto con el Oráculo.

---

## Context

La ruta `metas` ya existe en `js/router.js`. Esquema real (verificado en la BD viva):

- Tabla `metas` (constraints): `tipo` ∈ `{ahorro, reduccion_gasto, aporte_hogar}`; `horizonte` ∈ `{corto, mediano, largo}`; `ambito` ∈ `{personal, hogar}`; `estado` ∈ `{en_curso, lograda, vencida}`; `importancia` 1-5; `es_fondo_emergencia` bool. Constraint `metas_fondo_o_completa_check`: si **no** es fondo de emergencia, exige `monto_objetivo > 0` **y** `fecha_limite` **y** `horizonte`.
- Vista `metas_con_progreso`: expone todas las columnas + `monto_actual = COALESCE(SUM(aportes_meta.monto), 0)` — **el progreso es derivado de aportes, no editable directo**.
- `aportes_meta.transaccion_id` es **NOT NULL**: cada aporte exige una transacción. El progreso entra solo al gastar en categoría **Ahorro** (RPC `distribuir_ahorro` reparte entre metas personales por peso).

db.js: `getMetas(ambito?)` (lee la vista), `insertMeta(datos)`, `updateMeta(id, datos)`, `deleteMeta(id)`. RLS: metas personales solo las ve su dueño; metas hogar las ven ambos miembros.

---

## Decisión clave (confirmada): "Actualizar progreso" = Opción A

El progreso **no se inyecta manualmente** (la vista lo deriva de aportes). El botón "Actualizar progreso" se reencuadra como **"Registrar aporte"**: abre el modal de transacción preconfigurado en categoría **Ahorro**, cuyo gasto dispara el reparto automático. Cero migración, coherente con el motor de Ahorro existente.

- Solo las metas **tipo `ahorro`** reciben progreso por este mecanismo. Para metas `reduccion_gasto` / `aporte_hogar`, el botón se reemplaza por una nota informativa ("El progreso se actualiza con tus movimientos del mes.") — no se inyecta progreso falso.

---

## Goal

Vista mobile-first, en español, que liste metas activas con progreso visual, permita crear metas válidas, registrar aportes (vía Ahorro), marcar logradas y eliminar; y muestre las completadas en una sección colapsada.

---

## Componentes

### Sección 1 — Metas activas (`estado === 'en_curso'`)

Una tarjeta por meta. Contenido:
- **nombre**
- **badges:** tipo (Ahorro / Reducción de gasto / Aporte al hogar), horizonte (Corto / Mediano / Largo plazo), ámbito (Personal / Hogar)
- **barra de progreso:** `monto_actual / monto_objetivo` en % (tope visual 100%)
- **cifras:** `monto_actual` vs `monto_objetivo` en S/ (usar `formatMonto`)
- **fecha límite + días restantes** (calculado en JS desde hoy)
- **resaltado:**
  - quedan `< 7` días y `en_curso` → tarjeta en ámbar
  - **vencida** (`fecha_limite < hoy` y no lograda, o `estado === 'vencida'`) → tarjeta en rojo
- **acciones:**
  - **Registrar aporte** (solo metas tipo `ahorro`) → abre modal de transacción en categoría Ahorro; metas no-ahorro muestran la nota informativa en su lugar
  - **Marcar como lograda** → `updateMeta(id, { estado: 'lograda' })` + recargar
  - **Eliminar** → confirmación + `deleteMeta(id)` + recargar

Orden: por `fecha_limite` ascendente (los fondos sin fecha al final — ya lo hace `getMetas`).

### Sección 2 — Metas completadas (`estado === 'lograda'`), colapsada por defecto

`<details>` cerrado. Lista compacta: nombre, fecha límite, monto logrado (`monto_actual`).

### Formulario — FAB "+" abre modal

Campos:
- **nombre** (texto, requerido)
- **tipo** (select: ahorro / reduccion_gasto / aporte_hogar)
- **horizonte** (select: corto / mediano / largo)
- **ámbito** (toggle segmentado Personal / Hogar, consistente con otras vistas)
- **monto objetivo** (número, > 0)
- **fecha inicio** (date, default hoy)
- **fecha límite** (date)
- **nota** (textarea, opcional)

**Validación (cliente, antes de `insertMeta`):**
- nombre no vacío
- `monto_objetivo > 0`
- `fecha_limite > fecha_inicio`
- horizonte y fecha_limite presentes (constraint de la BD para metas normales)

Al guardar: `insertMeta({ nombre, tipo, horizonte, ambito, monto_objetivo, fecha_inicio, fecha_limite, nota })` (db.js fuerza `user_id` según ámbito) → cerrar modal + recargar. Errores de la BD → toast.

---

## Arquitectura

Todo en `views/metas.html` (IIFE), salvo la reutilización del modal de transacción global para "Registrar aporte".

```
metas.html
├── markup: sección activas (contenedor), sección completadas (<details>), FAB, modal de meta
├── <style>: tarjetas, badges, barra de progreso, estados ámbar/rojo, modal, mobile-first
└── <script> IIFE
    ├── cargar(): getMetas() → separar en_curso / lograda → render
    ├── renderActiva(meta): tarjeta con badges, barra, días restantes, acciones
    ├── renderCompletadas(metas): lista compacta
    ├── diasRestantes(fecha_limite), estadoVisual(meta) → 'normal'|'urgente'|'vencida'
    ├── abrirModalMeta() / guardarMeta(): validación + insertMeta
    ├── registrarAporte(meta): abre modal de transacción (categoría Ahorro)
    ├── marcarLograda(id), eliminarMeta(id)
    └── arranque: cargar()
```

`getMetas()` sin argumento trae hogar + personales propias (RLS). La vista separa por `estado`. No se filtra por ámbito en la carga (se muestran ambos; el badge indica cuál).

---

## UI / Mobile-first

- Una columna; tarjetas a ancho completo; FAB fijo abajo-derecha.
- Badges: pills pequeñas con color por dimensión (tipo, horizonte, ámbito) usando tokens existentes.
- Barra de progreso: relleno `--color-primary`; en vencida, relleno `--color-danger`.
- Estados de tarjeta: `--color-warning` (borde/fondo tenue) si urgente; `--color-danger` si vencida.
- Modal: overlay full-screen en móvil, centrado en desktop; tap targets ≥44px; `inputmode` apropiado en monto.
- Modo oscuro/claro vía custom properties. `prefers-reduced-motion` respetado.
- Acciones destructivas (Eliminar) con confirmación (reusar patrón de toast-undo o modal de confirmación existente).

### Patrones UI/UX (guía de diseño aplicada)

> La skill `ui-ux-pro-max` está en modo catálogo (sin librería de patrones instalada); se aplica guía de diseño por defecto.

1. **La barra de progreso es el héroe de la tarjeta.** Grande, con el % visible y el par `S/ actual → S/ objetivo` debajo. Es lo primero que el ojo busca en una meta.
2. **Días restantes en lenguaje humano**, no un número crudo: "Faltan 5 días", "Vence hoy", "Vencida hace 3 días". El texto comunica la urgencia además del color (no solo color → a11y).
3. **Urgencia sin alarmismo.** Ámbar = empujón suave (borde + fondo tenue). Rojo = claro pero no agresivo (sin relleno rojo pleno; borde + tinte). El relleno rojo solo en la barra de la meta vencida.
4. **Badges sobrios y jerarquizados.** Pills pequeñas; el badge de **ámbito** (Personal/Hogar) es el más prominente porque cambia quién la ve; tipo y horizonte, secundarios.
5. **Estado vacío amable con CTA.** "Aún no tienes metas. Crea la primera." junto al FAB, no una pantalla en blanco.
6. **FAB alcanzable con el pulgar** (abajo-derecha, 56px) — patrón ya usado en historial.
7. **Modal como hoja en móvil.** Pantalla completa que sube desde abajo en móvil; centrado en desktop. Primario "Guardar" prominente, secundario "Cancelar" sobrio.
8. **Eliminar = toast-undo** (consistente con historial), más suave que un modal de confirmación seco; 5s para deshacer antes del `deleteMeta`.
9. **Completadas con cierre celebratorio.** Sección apagada, colapsada, con ✓ por ítem — sensación de logro sin ruido.
10. **Accesibilidad.** Barra con `role="progressbar"` + `aria-valuenow/min/max`; badges con texto; la urgencia nunca depende solo del color (también el texto de días).

---

## Manejo de errores

| Escenario | Comportamiento |
|---|---|
| `getMetas` falla | db.js devuelve [] → estado vacío "Aún no tienes metas" |
| Sin metas activas | mensaje + FAB visible |
| `insertMeta` rechaza (constraint) | toast con mensaje claro; modal permanece abierto |
| Validación cliente falla | resaltar campo + mensaje inline; no llama a la BD |
| Meta no-ahorro pulsa progreso | nota informativa (no abre modal de aporte) |

---

## Out of Scope

- Edición de metas existentes (nombre/objetivo/fecha) — solo alta, marcar lograda, eliminar. (Editar puede ser fase posterior.)
- Inyección manual de progreso (rechazada — Opción A).
- Auto-marcado de `vencida` por job (la vista muestra el `estado` almacenado; el resaltado rojo se computa en UI).
- Gráficos de metas (ya viven en `graficos.html`, gráfico 8).

---

## Verificación (navegador, sin framework de tests)

- [ ] Metas `en_curso` se listan como tarjetas con badges, barra y días restantes
- [ ] Meta a < 7 días → ámbar; meta con fecha pasada sin lograr → rojo
- [ ] Sección completadas colapsada, lista compacta de `lograda`
- [ ] FAB abre modal; validación bloquea monto ≤ 0 y fecha_limite ≤ inicio
- [ ] Guardar llama `insertMeta` con los campos correctos y recarga
- [ ] "Marcar como lograda" mueve la meta a completadas (`updateMeta` estado)
- [ ] "Eliminar" pide confirmación y quita la meta
- [ ] "Registrar aporte" (meta ahorro) abre el modal de transacción en Ahorro; meta no-ahorro muestra nota
- [ ] Móvil: una columna, FAB accesible, modal usable, sin overflow horizontal
