# Nestra v2 — Plan de ejecución por fases

> Plan maestro para construir Nestra v2. Cada fase indica: **modelo de Claude** recomendado, **esfuerzo** estimado, **skills** a invocar, y un **prompt específico** listo para copiar/pegar en una sesión nueva de Claude Code.

**Enfoque elegido:** Intelligence-first (los insights son el diferenciador) sobre fundación multi-tenant.
**Usuario objetivo:** Individual primero, pareja como upgrade.
**Migración:** Limpia (opción A) — el usuario actual conserva todos sus datos vía asignación de `user_id`.

---

## Resumen de fases

| # | Fase | Modelo | Esfuerzo | Riesgo |
|---|------|--------|----------|--------|
| S | Setup de aislamiento (rama v2 + proyecto Supabase v2) | Sonnet 4.6 | Bajo (1-2 días) | Bajo |
| 0 | Fundación: Auth + RLS multi-tenant + migración | Opus 4.8 | Alto (1-2 sem) | Crítico |
| 1 | PWA + Offline-first (IndexedDB + Service Worker) | Opus 4.8 | Alto (1-2 sem) | Alto |
| 2 | Insights Engine | Opus 4.8 | Medio-Alto (1 sem) | Medio |
| 3 | Presupuestos por categoría | Sonnet 4.6 | Medio (4-5 días) | Bajo |
| 4 | Rediseño visual editorial (dark premium) | Opus 4.8 | Medio (1 sem) | Bajo |
| 5 | Sistema de pareja / hogar v2 | Opus 4.8 | Alto (1-2 sem) | Alto |
| 6 | Notificaciones push + recordatorios | Sonnet 4.6 | Medio (4-5 días) | Medio |

**Orden obligatorio:** S → 0 → 1 antes que el resto. Fases 2-6 pueden reordenarse según prioridad de negocio. **Fase S es bloqueante: sin ella, Fase 0 aplicaría RLS sobre producción.**

---

## Fase S — Setup de aislamiento

**Modelo:** Sonnet 4.6 — tareas de configuración mecánicas, sin decisiones de arquitectura.
**Esfuerzo:** Bajo · 1-2 días.
**Skills:** ninguna skill pesada — trabajo de setup. `context7` si hay dudas sobre branching de Supabase.

**Por qué va primero:** Fase 0 reescribe RLS y corre migraciones. Si no existe un entorno aislado, esos cambios caerían sobre la base de datos de producción y romperían v1. Esta fase crea el sandbox donde v2 se construye sin riesgo.

**Qué entrega:**
- Rama `v2` creada desde `master`, marcada como rama larga de desarrollo.
- Proyecto Supabase v2 separado (o Supabase branch si el plan lo permite) — instancia propia, sin datos de producción aún.
- Schema base de v1 replicado en la instancia v2 (estructura de tablas, sin los datos reales todavía).
- Variables de entorno / config de v2 apuntando a la instancia nueva (la URL y anon key de v1 quedan intactas).
- README corto en la rama `v2` documentando: qué instancia usa, cómo se hará el cutover, qué NO tocar de producción.

**Prompt para Claude:**
```
Nestra v2, Fase S (setup de aislamiento). Objetivo: crear un entorno donde
desarrollar v2 sin tocar la app v1 en producción.

Contexto: v1 está vivo en GitHub Pages (deploy master:main) y usa un proyecto
Supabase de producción. v2 reescribirá RLS y schema, así que NO puede compartir
ni la rama ni la base de datos con v1.

Tareas:
1. Crear la rama `v2` desde master. Será la rama larga de v2; master/main siguen
   siendo v1 intacto.
2. Guiarme para crear un proyecto Supabase v2 separado (o un Supabase branch si mi
   plan lo soporta). Yo haré los pasos del dashboard que requieran mi cuenta; tú me
   dices exactamente qué clickear.
3. Replicar el schema actual de v1 en la instancia v2 (solo estructura de tablas,
   SIN copiar datos reales todavía — eso es el cutover de Fase 0).
4. Configurar la app en la rama v2 para apuntar a la instancia v2 (nueva URL +
   anon key). Las credenciales de v1 NO se tocan.
5. Escribir un README en la rama v2 documentando: qué instancia Supabase usa v2,
   el plan de cutover, y la lista de "qué NO tocar en producción".

NO apliques ninguna migración ni cambio al proyecto Supabase de producción. Este
es trabajo de setup mecánico — no necesitas brainstorming. Usa context7 si tienes
dudas sobre Supabase branching.
```

**Verificación de salida:** rama `v2` existe · instancia Supabase v2 responde · app en rama `v2` levanta apuntando a v2 · producción (v1) sigue intacta y desplegada.

---

## Fase 0 — Fundación: Auth + RLS multi-tenant + migración

**Modelo:** Opus 4.8 — decisiones de arquitectura de seguridad, RLS irreversible si se hace mal.
**Esfuerzo:** Alto · 1-2 semanas.
**Skills:** `superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:subagent-driven-development` · `superpowers:test-driven-development` para las policies.
**Requiere:** Fase S completa — corre en la rama `v2` y la instancia Supabase v2. Todas las migraciones de esta fase se aplican SOLO a v2, nunca a producción.

**Qué entrega:**
- Google OAuth vía Supabase Auth (reemplaza auth actual).
- Todas las tablas (`transacciones`, `metas`, `prestamos`, `categorias` custom) con columna `user_id` poblada y RLS `auth.uid() = user_id`.
- Script de migración que asigna el `user_id` real del usuario existente a todos sus registros históricos — cero pérdida de datos.
- Onboarding individual desde el día 1.

**Prompt para Claude:**
```
Estoy construyendo Nestra v2, una app de finanzas personales (vanilla JS + Supabase,
hash-routing SPA). Fase 0: convertir la app de single-tenant a multi-tenant.

Objetivos:
1. Integrar Google OAuth usando Supabase Auth (hoy la auth es básica).
2. Añadir/poblar columna user_id en todas las tablas: transacciones, metas,
   prestamos, y categorias custom. Reescribir TODAS las políticas RLS a
   `auth.uid() = user_id`.
3. Escribir una migración que asigne el user_id real del usuario existente
   a todos sus registros históricos (migración limpia, sin pérdida de datos).

Empieza con superpowers:brainstorming para validar el diseño de las políticas RLS
y el plan de migración antes de tocar código. Usa TDD para las policies (probar
que usuario A no ve datos de usuario B). La migración debe ser idempotente y
reversible. NO apliques migraciones a producción sin que yo revise el SQL primero.
```

**Verificación de salida:** usuario A no puede leer ni escribir filas de usuario B (test RLS). Login Google funciona. Datos históricos del usuario actual intactos tras migración.

---

## Fase 1 — PWA + Offline-first

**Modelo:** Opus 4.8 — Service Worker + sync conflict resolution es lógica delicada.
**Esfuerzo:** Alto · 1-2 semanas.
**Skills:** `superpowers:writing-plans` → `superpowers:subagent-driven-development` · `frontend-design` para el install prompt · `context7` para docs de Workbox/idb.

**Qué entrega:**
- `manifest.json` (icons 192/512, `display:standalone`, `start_url:/#dashboard`) + meta tags iOS (`apple-touch-icon`, `apple-mobile-web-app-capable`).
- Service Worker (Workbox): app shell cache-first, API Supabase network-first.
- IndexedDB (idb) como espejo local de transacciones/categorías/metas/préstamos.
- Background Sync: crear offline → `status:'pending'` en IndexedDB → sync al reconectar → badge "pendiente de sync" desaparece.
- Banner offline + install prompt propio (no el del browser).

**Prompt para Claude:**
```
Nestra v2, Fase 1: convertir la app en una PWA instalable que funcione offline
como si fuera nativa iOS.

Requisitos:
1. manifest.json con icons 192/512px, display:standalone, start_url:/#dashboard,
   y meta tags iOS (apple-touch-icon, apple-mobile-web-app-capable).
2. Service Worker con Workbox: app shell (HTML/CSS/JS/fonts) cache-first;
   llamadas a Supabase network-first con fallback a cache.
3. IndexedDB (librería idb) como espejo local de transacciones, categorias,
   metas y prestamos.
4. Background Sync: si el usuario crea una transacción sin red, se guarda en
   IndexedDB con status:'pending' y la UI muestra un badge. Al volver la conexión,
   el SW sincroniza a Supabase automáticamente y el badge desaparece.
5. Banner offline propio + prompt de instalación custom (no el del browser).

Usa context7 para confirmar la API actual de Workbox e idb. Empieza con
writing-plans. Define claramente la estrategia de resolución de conflictos
(last-write-wins por updated_at, salvo que sugieras algo mejor). Prueba el flujo
offline→online manualmente con el preview antes de cerrar cada tarea.
```

**Verificación:** crear transacción en avión mode, reconectar, confirmar sync. App instalable en home screen iOS/Android.

---

## Fase 2 — Insights Engine

**Modelo:** Opus 4.8 — el diferenciador del producto; la calidad de los insights define el valor.
**Esfuerzo:** Medio-Alto · 1 semana.
**Skills:** `superpowers:brainstorming` (qué insights generar) → `writing-plans` → `subagent-driven-development` · `superpowers:test-driven-development` para la lógica de detección.

**Qué entrega:**
- Motor client-side que lee historial de 90 días desde IndexedDB.
- Agrupa por categoría, semana, día-de-semana; detecta: gasto top, día más caro, tendencia (↑/↓ vs promedio), proyección de metas.
- Cards de insight priorizadas por impacto, con acción (ej. "Poner límite").
- Ejemplos: "Delivery subió 42% — S/ 340 vs promedio S/ 238", "Meta Vacaciones al 68%, la alcanzas en agosto", "Gastas 2× más los viernes".

**Prompt para Claude:**
```
Nestra v2, Fase 2: construir el Insights Engine, el diferenciador del producto.

Es un motor que corre en el cliente (sin backend adicional), lee el historial de
los últimos 90 días desde IndexedDB, y genera insights accionables.

Tipos de insight a detectar (mínimo):
- Categoría con mayor crecimiento vs su promedio histórico ("Delivery subió 42%").
- Día de la semana con gasto anómalo ("Gastas 2x más los viernes").
- Proyección de metas ("A este ritmo alcanzas Vacaciones en agosto").
- Alerta de presupuesto cerca/sobre el límite.

Cada insight tiene: tipo (alert/warn/good/info), ícono, texto principal, subtexto,
y opcionalmente una acción. Se priorizan por impacto y se renderizan como cards
horizontales scrolleables en el dashboard.

Empieza con superpowers:brainstorming para definir el catálogo completo de insights
y las reglas de detección. Usa TDD: cada regla de detección es una función pura
testeable con datos sintéticos. Prioriza precisión — un insight equivocado destruye
la confianza más que la falta de uno.
```

**Verificación:** alimentar datos sintéticos (gasto delivery creciente) → confirmar que genera el insight correcto. Sin falsos positivos en datos planos.

---

## Fase 3 — Presupuestos por categoría

**Modelo:** Sonnet 4.6 — CRUD bien acotado sobre patrones existentes.
**Esfuerzo:** Medio · 4-5 días.
**Skills:** `superpowers:writing-plans` → `subagent-driven-development` · `frontend-design` para las barras de progreso.

**Qué entrega:**
- Tabla `presupuestos` (user_id, categoria_id, monto_limite, periodo).
- UI: límite por categoría con barra de progreso en tiempo real (verde <80% / ámbar 80-100% / rojo >100%), con ícono de categoría.
- Alimenta los insights de alerta de la Fase 2.

**Prompt para Claude:**
```
Nestra v2, Fase 3: presupuestos por categoría.

1. Nueva tabla `presupuestos` (user_id, categoria_id, monto_limite, periodo
   mensual) con RLS auth.uid()=user_id, siguiendo el patrón de las tablas existentes.
2. UI: el usuario define un límite mensual por categoría. El dashboard muestra
   cada presupuesto con: ícono de la categoría (chip 24x24 con fondo tintado),
   nombre, gastado/límite, y una barra de progreso de 2px que cambia de color —
   verde <80%, ámbar 80-100%, rojo >100% (con badge "superado").
3. El cálculo de gasto actual se hace sobre transacciones del mes en curso de esa
   categoría.

Sigue los patrones existentes (IIFE, var, escHtml en contenido de usuario). Usa
writing-plans. El diseño visual debe seguir el estilo editorial oscuro ya aprobado
(acento champagne #c9a84c, barras finas, íconos Tabler en chips tintados).
```

**Verificación:** crear presupuesto, registrar gasto, barra actualiza color al cruzar umbrales.

---

## Fase 4 — Rediseño visual editorial (dark premium)

**Modelo:** Opus 4.8 — criterio estético, cohesión de sistema de diseño.
**Esfuerzo:** Medio · 1 semana.
**Skills:** `frontend-design` (driver principal) · `superpowers:writing-plans` para secuenciar vista por vista · `accessibility` para contraste.

**Qué entrega:**
- Sistema de diseño: Playfair Display (números signature) + Outfit (UI), acento champagne `#c9a84c`.
- Cards de insight con border-left de color semántico (no fondo lleno).
- Barras de presupuesto 2px, íconos en chips tintados.
- Aplicado a todas las vistas: dashboard, historial, gráficos, metas, préstamos, configuración.
- Dark mode refinado + transición a light mode coherente.

**Prompt para Claude:**
```
Nestra v2, Fase 4: rediseño visual completo a un estilo "editorial luxury dark".

Sistema de diseño aprobado (ya validado en mockup):
- Tipografía: Playfair Display para números grandes (balance), Outfit para toda la
  UI. Dos pesos máximo.
- Acento único: champagne gold #c9a84c (links, nav activo, avatar).
- Insight cards: border-left 2px de color semántico + fondo tintado sutil (4% alpha),
  NO fondo lleno.
- Barras de progreso finas (2px). Íconos de categoría en chips redondeados 24x24
  con fondo tintado del color.
- Fondo base near-black #08080f.

Aplica este sistema a TODAS las vistas: dashboard, historial, gráficos, metas,
préstamos, configuración. Mantén coherencia con light mode también.

Usa frontend-design como driver y writing-plans para secuenciar vista por vista.
Verifica contraste WCAG AA con la skill accessibility. No rompas funcionalidad
existente — esto es solo capa visual.
```

**Verificación:** todas las vistas coherentes, contraste AA, light/dark sin glitches.

---

## Fase 5 — Sistema de pareja / hogar v2

**Modelo:** Opus 4.8 — RLS compartida por `hogar_id` es la parte de seguridad más delicada de todo v2.
**Esfuerzo:** Alto · 1-2 semanas.
**Skills:** `superpowers:brainstorming` (flujo de emparejamiento) → `writing-plans` → `subagent-driven-development` · `test-driven-development` para RLS compartida.

**Qué entrega:**
- Tabla `hogares` + `hogar_id` opcional en transacciones/metas.
- Emparejamiento: usuario A crea hogar → código 6 dígitos → usuario B lo ingresa → se une.
- RLS: ambos ven gastos del hogar compartido + sus gastos personales; nadie más.
- Realtime de Supabase: cambios del otro usuario aparecen en vivo.
- "Quién debe qué" — balance entre los dos miembros.

**Prompt para Claude:**
```
Nestra v2, Fase 5: sistema de pareja/hogar compartido (la killer feature, opt-in).

Flujo:
1. Usuario A crea un hogar y recibe un código de 6 dígitos.
2. Usuario B ingresa el código y se une al hogar.
3. Ambos ven las transacciones marcadas como "hogar" + sus transacciones
   personales. Nadie fuera del hogar ve nada.

Implementación:
- Tabla `hogares` + columna hogar_id opcional en transacciones y metas.
- RLS compartida: una fila es visible si user_id = auth.uid() O
  hogar_id IN (hogares del usuario actual). Este es el punto más delicado de
  seguridad de todo v2 — pruébalo exhaustivamente con TDD (3 usuarios: A y B en
  el mismo hogar, C afuera; C no ve nada de A/B; A ve lo compartido de B pero no
  lo personal de B).
- Realtime de Supabase para que los cambios del otro miembro aparezcan en vivo.
- Vista "quién debe qué": balance neto entre los dos miembros del hogar.

Empieza con superpowers:brainstorming para el flujo de emparejamiento y los casos
límite (código expirado, usuario ya en otro hogar, salir del hogar). NO apliques
las policies a producción sin revisión manual del SQL.
```

**Verificación:** test 3 usuarios (A+B mismo hogar, C afuera) — aislamiento correcto. Realtime propaga cambios.

---

## Fase 6 — Notificaciones push + recordatorios

**Modelo:** Sonnet 4.6 — integración sobre Web Push API estándar.
**Esfuerzo:** Medio · 4-5 días.
**Skills:** `superpowers:writing-plans` → `subagent-driven-development` · `context7` para Web Push API.

**Qué entrega:**
- Web Push API + suscripción almacenada en Supabase.
- Alertas: límite de presupuesto cruzado, recordatorio de meta, préstamo pendiente.
- Edge Function de Supabase para disparar push (cron o evento).

**Prompt para Claude:**
```
Nestra v2, Fase 6: notificaciones push.

1. Web Push API: pedir permiso, guardar la suscripción en Supabase (tabla
   push_subscriptions con user_id).
2. Disparadores: presupuesto cruzó su límite, recordatorio de aporte a meta,
   préstamo pendiente de cobro/pago.
3. Supabase Edge Function que envía las push (por cron diario y/o por evento).

Requiere que la PWA de la Fase 1 ya esté lista (el Service Worker maneja el evento
push). Usa context7 para la API actual de Web Push y VAPID keys. Usa writing-plans.
Pide permiso de notificación en un momento contextual, no al abrir la app.
```

**Verificación:** cruzar límite de presupuesto → push llega al dispositivo.

---

## Aislamiento de v1 (NO romper producción)

**Regla absoluta:** la app v1 en https://csf156.github.io/Nestra debe seguir funcionando intacta durante todo el desarrollo de v2.

**1. Aislamiento de código (git):**
- Todo v2 vive en rama `v2` (rama larga), nunca en `master`/`main` hasta el cutover final.
- `master:main` sigue siendo el deploy de v1. No tocar.
- v2 se prueba en local (preview) o en un GitHub Pages branch separado (`gh-pages-v2`) si se quiere demo online.

**2. Aislamiento de base de datos (lo más peligroso):**
- v1 y v2 NO comparten el mismo proyecto Supabase mientras se desarrolla.
- **Opción recomendada:** crear un proyecto Supabase v2 separado (o branch de Supabase si está disponible en el plan). v2 apunta a esa instancia. v1 sigue en la actual sin tocar.
- Las migraciones destructivas (RLS de Fase 0, `hogar_id` de Fase 5) se aplican SOLO al proyecto v2.
- El script de migración limpia (Fase 0) corre una sola vez en el cutover, copiando datos de la instancia v1 → v2.

**3. Cutover final (cuando v2 esté lista):**
1. Congelar escrituras en v1 (mantenimiento breve).
2. Correr migración limpia de datos v1 → v2.
3. Apuntar el dominio/deploy a v2 (`v2` → `main`).
4. v1 queda archivado como rollback.

**Qué NO hacer nunca durante el desarrollo:**
- Aplicar migraciones RLS de Fase 0 al proyecto Supabase de producción.
- Mergear `v2` a `main` antes del cutover.
- Cambiar el schema de las tablas que v1 usa en vivo.

---

## Notas transversales

- **Seguridad RLS:** Fases 0 y 5 tocan políticas RLS. En ambas, revisar el SQL manualmente antes de aplicar a producción. Probar aislamiento entre usuarios con TDD siempre.
- **Deploy:** desarrollo en `master`, GitHub Pages sirve desde `main`. Push `master:main` para publicar.
- **Convenciones de código:** IIFE, `var`, `escHtml()` en todo contenido de usuario, CSS custom properties, hash-routing. No romper patrones existentes.
- **Cada fase** termina con su propio spec → plan → ejecución (ciclo superpowers completo). Este documento es el mapa maestro, no reemplaza los specs por fase.
