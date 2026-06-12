# Nestra v2 — Plan de ejecución por fases (revisión benchmark)

> Plan maestro para construir Nestra v2. Cada fase indica: **modelo de Claude** recomendado, **esfuerzo** estimado, **skills** a invocar, y un **prompt específico** listo para copiar/pegar en una sesión nueva de Claude Code.
>
> **Esta revisión** (2026-06-12) integra las 17 mejoras concretas surgidas del benchmark competitivo contra YNAB, Copilot, Monarch, PocketGuard, Fintonic, Finerio y Spendee. Supersede a `2026-06-11-nestra-v2-plan-fases.md`. La estructura pasa de 8 a 9 fases: se añade una fase nueva de **Captura sin fricción** (Fase 3) y se enriquecen las fases de PWA, Insights, Features de planeación y Rediseño visual.

**Enfoque elegido:** Intelligence-first (los insights son el diferenciador) sobre fundación multi-tenant.
**Usuario objetivo:** Individual primero, pareja como upgrade.
**Migración:** Limpia (opción A) — el usuario actual conserva todos sus datos vía asignación de `user_id`.

---

## Resumen de fases

| # | Fase | Modelo | Esfuerzo | Riesgo | Mejoras del benchmark integradas |
|---|------|--------|----------|--------|----------------------------------|
| S | Setup de aislamiento (rama v2 + proyecto Supabase v2) | Sonnet 4.6 | Bajo (1-2 días) | Bajo | — |
| 0 | Fundación: Auth + RLS multi-tenant + migración | Opus 4.8 | Alto (1-2 sem) | Crítico | — |
| 1 | PWA + Offline-first + integraciones nativas | Opus 4.8 | Alto (2 sem) | Alto | App shortcuts · Web Share Target · Biométrico WebAuthn |
| 2 | Insights Engine | Opus 4.8 | Alto (1-1.5 sem) | Medio | Safe-to-spend diario · Insight de préstamos |
| 3 | **Captura sin fricción** (fase nueva) | Opus 4.8 | Alto (1.5 sem) | Medio | Quick-add con parseo · Auto-categorización local · Plantillas 1-tap · Split multi-categoría · Undo en toast · Foto de recibo |
| 4 | Planeación: Presupuestos + Recurrentes + Flujo de caja | Opus 4.8 | Alto (1.5 sem) | Medio | Suscripciones/recurrentes · Calendario de flujo de caja |
| 5 | Rediseño visual editorial + onboarding | Opus 4.8 | Medio-Alto (1.5 sem) | Bajo | Empty states ilustrados · Skeleton loaders · Sparklines inline · Onboarding 3 pasos |
| 6 | Sistema de pareja / hogar v2 | Opus 4.8 | Alto (1-2 sem) | Alto | — |
| 7 | Notificaciones push + recordatorios | Sonnet 4.6 | Medio (4-5 días) | Medio | — |

**Orden obligatorio:** S → 0 → 1 antes que el resto. **Fase S es bloqueante:** sin ella, Fase 0 aplicaría RLS sobre producción.

**Dependencias entre fases enriquecidas:**
- Fase 3 (Captura) consume las categorías existentes y alimenta datos más limpios a Fase 2 (Insights). Si se construye Fase 2 antes, sus reglas mejoran cuando llega Fase 3 — no se bloquean mutuamente.
- Fase 4 (Presupuestos) alimenta las alertas de presupuesto de Fase 2. Construir Fase 2 primero deja el "hook" de alerta listo; Fase 4 lo activa.
- Fase 1 (PWA/SW) es prerrequisito de Web Share Target (Fase 1 misma), del modo offline de toda captura (Fase 3) y del push (Fase 7).

**Reordenamiento recomendado por valor de retención:** S → 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. Las Fases 2-3 entregan los tres mayores multiplicadores de retención del benchmark (safe-to-spend, quick-add, insight de préstamos) lo antes posible.

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

## Fase 1 — PWA + Offline-first + integraciones nativas

**Modelo:** Opus 4.8 — Service Worker + sync conflict resolution es lógica delicada; las integraciones nativas (Share Target, WebAuthn) tienen casos límite de seguridad.
**Esfuerzo:** Alto · 2 semanas (subió de 1-2 sem por las 3 integraciones nativas añadidas).
**Skills:** `superpowers:writing-plans` → `superpowers:subagent-driven-development` · `frontend-design` para el install prompt · `context7` para docs de Workbox/idb/Web Share Target/WebAuthn.

**Qué entrega (base PWA):**
- `manifest.json` (icons 192/512, `display:standalone`, `start_url:/#dashboard`) + meta tags iOS (`apple-touch-icon`, `apple-mobile-web-app-capable`).
- Service Worker (Workbox): app shell cache-first, API Supabase network-first.
- IndexedDB (idb) como espejo local de transacciones/categorías/metas/préstamos.
- Background Sync: crear offline → `status:'pending'` en IndexedDB → sync al reconectar → badge "pendiente de sync" desaparece.
- Banner offline + install prompt propio (no el del browser).

**Qué entrega (mejoras del benchmark — integraciones nativas):**
- **App shortcuts** (mejora #15): array `shortcuts` en el `manifest.json` → long-press al ícono ofrece "＋ Gasto" (abre `#transaccion`) y "Ver mes" (abre `#resumen`). Esfuerzo trivial, sensación nativa inmediata. *Líder de referencia: Copilot.*
- **Web Share Target API** (mejora #16): registrar la PWA como share target en el manifest + handler en el Service Worker. Compartir una captura de Yape/Plin o un monto desde cualquier app abre el formulario de transacción precargado. Reduce radicalmente la fricción de captura en el contexto peruano (Yape/Plin). *Sin equivalente directo en competidores — ventaja de contexto local.*
- **Desbloqueo biométrico WebAuthn** (mejora #17): Face ID / huella para abrir la app usando WebAuthn (`navigator.credentials`). Registro de credencial opt-in en configuración; al abrir la app con sesión válida, pide biométrico antes de mostrar datos. Datos financieros = expectativa de candado. *Líder de referencia: todas las apps nativas lo tienen; ninguna PWA LatAm.*

**Prompt para Claude:**
```
Nestra v2, Fase 1: convertir la app en una PWA instalable que funcione offline
como nativa iOS, MÁS tres integraciones nativas que reducen fricción y suben
confianza.

Base PWA:
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

Integraciones nativas (mejoras del benchmark):
6. App shortcuts: añade el array `shortcuts` al manifest con dos accesos —
   "＋ Gasto" (#transaccion) y "Ver mes" (#resumen). Verifica long-press del
   ícono en Android/iOS.
7. Web Share Target API: registra la PWA como share target en el manifest
   (method POST, enctype multipart/form-data, acepta texto e imágenes). El
   Service Worker recibe el share y abre el formulario de transacción precargado
   con el monto/imagen. Caso de uso: compartir una captura de Yape a Nestra.
8. Desbloqueo biométrico con WebAuthn: en configuración, opción opt-in para
   registrar una credencial biométrica (navigator.credentials.create). Al abrir
   la app con sesión válida y biométrico activado, pedir verificación
   (navigator.credentials.get) antes de renderizar datos. Fallback a la sesión
   normal si el dispositivo no soporta WebAuthn.

Usa context7 para confirmar la API actual de Workbox, idb, Web Share Target y
WebAuthn. Empieza con writing-plans. Define claramente la estrategia de resolución
de conflictos (last-write-wins por updated_at, salvo que sugieras algo mejor).
Prueba el flujo offline→online, el share target y el biométrico manualmente con el
preview antes de cerrar cada tarea. WebAuthn es seguridad — pruébalo con cuidado.
```

**Verificación:** crear transacción en modo avión, reconectar, confirmar sync. App instalable en home screen iOS/Android. Long-press al ícono muestra shortcuts. Compartir una imagen a Nestra abre el form precargado. Biométrico bloquea/desbloquea correctamente y degrada bien donde no hay soporte.

---

## Fase 2 — Insights Engine

**Modelo:** Opus 4.8 — el diferenciador del producto; la calidad de los insights define el valor.
**Esfuerzo:** Alto · 1-1.5 semanas (subió por safe-to-spend e insight de préstamos).
**Skills:** `superpowers:brainstorming` (qué insights generar y la fórmula de safe-to-spend) → `writing-plans` → `subagent-driven-development` · `superpowers:test-driven-development` para la lógica de detección.

**Qué entrega (motor base):**
- Motor client-side que lee historial de 90 días desde IndexedDB.
- Agrupa por categoría, semana, día-de-semana; detecta: gasto top, día más caro, tendencia (↑/↓ vs promedio), proyección de metas.
- Cards de insight priorizadas por impacto, con acción (ej. "Poner límite").
- Ejemplos: "Delivery subió 42% — S/ 340 vs promedio S/ 238", "Meta Vacaciones al 68%, la alcanzas en agosto", "Gastas 2× más los viernes".

**Qué entrega (mejoras del benchmark):**
- **Safe-to-spend diario** (mejora #12): número grande y único en el dashboard — cuánto puede gastar HOY el usuario sin romper presupuestos ni desviar metas. Fórmula: `(ingreso del periodo − gastos fijos comprometidos − aporte a metas − gasto variable acumulado) ÷ días restantes del periodo`. Es la razón por la que la gente abre PocketGuard a diario. *Líder de referencia: PocketGuard.*
- **Insight de préstamos** (mejora #13): convierte el feature único de Nestra (préstamos) en insight accionable — "Te deben S/450 · llevas 62 días sin cobrar a Juan." Detecta préstamos dados sin movimiento de cobro tras N días y los prioriza. Foso defensivo: ninguna app global trackea préstamos entre personas. *Sin competidor.*

**Prompt para Claude:**
```
Nestra v2, Fase 2: construir el Insights Engine, el diferenciador del producto.

Es un motor que corre en el cliente (sin backend adicional), lee el historial de
los últimos 90 días desde IndexedDB, y genera insights accionables.

Tipos de insight a detectar (mínimo):
- Categoría con mayor crecimiento vs su promedio histórico ("Delivery subió 42%").
- Día de la semana con gasto anómalo ("Gastas 2x más los viernes").
- Proyección de metas ("A este ritmo alcanzas Vacaciones en agosto").
- Alerta de presupuesto cerca/sobre el límite (el hook lo activa la Fase 4).

Mejoras del benchmark (prioritarias):
- Safe-to-spend diario: un número destacado en el dashboard que responde
  "¿cuánto puedo gastar hoy?". Fórmula base: (ingreso del periodo − gastos fijos
  comprometidos − aporte planificado a metas − gasto variable ya acumulado) /
  días restantes del periodo. Discute conmigo la fórmula en brainstorming antes de
  implementar — es el número más visible de la app y un error mata la confianza.
- Insight de préstamos: detecta préstamos dados (tabla prestamos) sin movimiento
  de cobro después de N días configurables y genera un insight tipo
  "Te deben S/X · llevas N días sin cobrar a [persona]". Hazlo simétrico para
  deudas que el usuario debe pagar.

Cada insight tiene: tipo (alert/warn/good/info), ícono, texto principal, subtexto,
y opcionalmente una acción. Se priorizan por impacto y se renderizan como cards
horizontales scrolleables en el dashboard. El safe-to-spend NO es una card — es un
elemento hero propio arriba del dashboard.

Empieza con superpowers:brainstorming para definir el catálogo completo de insights
y la fórmula exacta de safe-to-spend. Usa TDD: cada regla de detección es una
función pura testeable con datos sintéticos. Prioriza precisión — un insight
equivocado destruye la confianza más que la falta de uno.
```

**Verificación:** alimentar datos sintéticos (gasto delivery creciente) → confirmar el insight correcto. Safe-to-spend recalcula al registrar un gasto. Insight de préstamos aparece tras N días sin cobro. Sin falsos positivos en datos planos.

---

## Fase 3 — Captura sin fricción (fase nueva)

**Modelo:** Opus 4.8 — el parser de quick-add y la auto-categorización aprendida son lógica de precisión; un parser que adivina mal frustra más que ayuda.
**Esfuerzo:** Alto · 1.5 semanas.
**Skills:** `superpowers:brainstorming` (gramática del parser + reglas de auto-categorización) → `writing-plans` → `subagent-driven-development` · `superpowers:test-driven-development` para el parser y el matcher · `context7` para Supabase Storage.
**Requiere:** Fase 1 (la captura debe funcionar offline contra IndexedDB). Mejora los datos que consume Fase 2.

**Por qué es una fase propia:** el benchmark mostró que la fricción de entrada manual es el problema #1 de las apps sin bank sync. Nestra apuesta por privacidad (sin bank sync), así que la captura DEBE ser excepcional para compensar. Estas seis mejoras juntas convierten el registro de 5 taps a 1.

**Qué entrega:**
- **Quick-add con parseo de texto** (mejora #8): un solo input libre — "Uber 15" → categoría Transporte, S/15, hoy. Parser por reglas + diccionario de keywords (sin AI externa, sin costo, privado). El mayor multiplicador de retención del benchmark. *Sin competidor directo en LatAm.*
- **Auto-categorización aprendida local** (mejora #14): al escribir "Tottus" sugiere Mercado porque así se categorizó antes. Diccionario descripción→categoría construido del historial del usuario, guardado en IndexedDB. Alimenta al quick-add. *Líderes: Copilot/Monarch (con ML en la nube); Nestra lo hace local y privado.*
- **Plantillas de transacciones frecuentes** (mejora #9): chips de 1-tap ("Pasaje S/2", "Almuerzo S/12") en la pantalla de registro. Resuelve el 80% de gastos diarios repetitivos. Complementa categorías favoritas existentes.
- **Split de transacción multi-categoría** (mejora #3): una compra (mercado) dividida en comida + limpieza + mascota en un registro. Mejora la granularidad de los datos que alimentan Fase 2.
- **Undo en toast al borrar** (mejora #10): "Transacción borrada · Deshacer" por 5s. Quita el miedo a tocar.
- **Foto de recibo adjunta** (mejora #4): Supabase Storage + thumbnail en el detalle de transacción. Cierra el loop de confianza y sienta base futura para OCR.

**Prompt para Claude:**
```
Nestra v2, Fase 3: hacer la captura de transacciones excepcional. Nestra no tiene
bank sync (apuesta por privacidad), así que el registro manual debe ser tan rápido
que no duela. Seis mejoras que llevan el registro de ~5 taps a 1.

1. Quick-add con parseo: un input de texto libre en el dashboard. "Uber 15" se
   parsea a {descripcion:"Uber", monto:15, categoria:Transporte (inferida),
   fecha:hoy}. Parser por REGLAS + diccionario de keywords, SIN AI externa.
   Soporta: monto en cualquier posición, fecha relativa ("ayer"), categoría por
   keyword. Muestra un preview editable antes de guardar.
2. Auto-categorización aprendida (local): mantén en IndexedDB un diccionario
   descripcion->categoria construido del historial del usuario. Cuando escribe una
   descripción ya vista, prerellena la categoría. Aprende con cada guardado.
   Alimenta al quick-add del punto 1.
3. Plantillas frecuentes: chips de 1-tap configurables ("Pasaje S/2",
   "Almuerzo S/12") en la pantalla de registro. Un tap crea la transacción.
4. Split multi-categoría: permite dividir una transacción en varias líneas
   (categoria + monto cada una) que suman el total. Guárdalo de forma que Fase 2
   pueda leer cada línea por su categoría.
5. Undo en toast: al borrar una transacción, el toast muestra "Deshacer" por 5s.
   Si se toca, restaura. Si pasan los 5s, confirma el borrado.
6. Foto de recibo: adjuntar una imagen a la transacción (Supabase Storage, bucket
   por user_id con RLS). Muestra thumbnail en el detalle. Comprime client-side
   antes de subir.

Empieza con superpowers:brainstorming para definir la gramática del parser y las
reglas de auto-categorización (casos límite: montos con decimales "S/12.50",
descripciones ambiguas, multi-palabra). Usa TDD: el parser y el matcher son
funciones puras testeables con tablas de casos. context7 para Supabase Storage.
Todo debe funcionar offline contra IndexedDB (sobre la base de Fase 1).
```

**Verificación:** "Cena 45 ayer" se parsea correcto (monto, fecha, categoría inferida). Escribir una descripción ya usada prerellena su categoría. Chip de plantilla crea transacción en 1 tap. Split de 3 líneas suma el total y cada línea aparece en su categoría en gráficos. Undo restaura dentro de 5s. Foto sube, comprime y muestra thumbnail. Todo funciona offline.

---

## Fase 4 — Planeación: Presupuestos + Recurrentes + Flujo de caja

**Modelo:** Opus 4.8 — el calendario de flujo de caja (proyección día-a-día) es lógica de proyección delicada; subió de Sonnet por esa razón.
**Esfuerzo:** Alto · 1.5 semanas (era Medio 4-5 días solo presupuestos; +recurrentes +flujo de caja).
**Skills:** `superpowers:brainstorming` (lógica de proyección de saldo) → `writing-plans` → `subagent-driven-development` · `superpowers:test-driven-development` para la proyección · `frontend-design` para barras de progreso y el calendario.

**Qué entrega (presupuestos — base original):**
- Tabla `presupuestos` (user_id, categoria_id, monto_limite, periodo) con RLS `auth.uid()=user_id`.
- UI: límite por categoría con barra de progreso en tiempo real (verde <80% / ámbar 80-100% / rojo >100%), con ícono de categoría en chip tintado.
- Alimenta los insights de alerta de la Fase 2 (activa el hook de alerta de presupuesto).

**Qué entrega (mejoras del benchmark):**
- **Suscripciones y gastos recurrentes** (mejora #1): detecta transacciones repetidas (mismo monto + categoría + ~30 días) y propone marcarlas como recurrentes. Vista dedicada: total mensual comprometido en suscripciones. El #1 fuga de dinero; nadie en LatAm lo hace bien. *Parcial en Copilot/Monarch; hueco en LatAm.*
- **Calendario de flujo de caja** (mejora #2): proyección día-a-día del saldo considerando ingresos y gastos fijos/recurrentes futuros. Responde "¿llego a fin de mes?" ANTES de que pase. Complementa a Fase 2 (que mira el pasado) mirando hacia adelante. *Diferenciador — pocos competidores lo tienen visual.*

**Prompt para Claude:**
```
Nestra v2, Fase 4: herramientas de planeación — presupuestos por categoría,
gastos recurrentes, y un calendario de flujo de caja proyectado.

1. Presupuestos por categoría:
   - Nueva tabla `presupuestos` (user_id, categoria_id, monto_limite, periodo
     mensual) con RLS auth.uid()=user_id, siguiendo el patrón de las tablas
     existentes.
   - UI: límite mensual por categoría. El dashboard muestra cada presupuesto con
     ícono (chip 24x24 con fondo tintado), nombre, gastado/límite, y barra de
     progreso de 2px — verde <80%, ámbar 80-100%, rojo >100% (badge "superado").
   - El gasto actual se calcula sobre transacciones del mes en curso de esa
     categoría. Esto activa el hook de alerta de presupuesto de la Fase 2.

2. Suscripciones y gastos recurrentes (mejora del benchmark):
   - Detecta transacciones repetidas (mismo monto +- tolerancia, misma categoría,
     intervalo ~mensual) y propone al usuario marcarlas como recurrentes.
   - Tabla `recurrentes` (user_id, descripcion, monto, categoria_id, frecuencia,
     proximo_cargo). Vista dedicada con el total mensual comprometido.

3. Calendario de flujo de caja proyectado (mejora del benchmark):
   - Proyección día-a-día del saldo del mes considerando: saldo actual, ingresos
     fijos futuros, gastos recurrentes futuros (de la tabla recurrentes), y aportes
     a metas. Visualiza el saldo proyectado por día y marca el día (si lo hay) en
     que el saldo proyectado cae bajo cero.
   - Responde la pregunta "¿llego a fin de mes?".

Empieza con superpowers:brainstorming para la lógica de proyección del flujo de
caja (es la parte delicada). Usa TDD para la detección de recurrentes y la
proyección (funciones puras, datos sintéticos). frontend-design para las barras y
el calendario, siguiendo el estilo editorial oscuro (acento champagne #c9a84c,
barras finas, íconos Tabler en chips tintados). Sigue los patrones existentes
(IIFE, var, escHtml en contenido de usuario).
```

**Verificación:** crear presupuesto, registrar gasto, barra cambia de color al cruzar umbrales y dispara la alerta de Fase 2. La detección propone marcar como recurrente un gasto mensual repetido. El calendario proyecta el saldo y marca correctamente un día de saldo negativo con datos sintéticos.

---

## Fase 5 — Rediseño visual editorial + onboarding

**Modelo:** Opus 4.8 — criterio estético, cohesión de sistema de diseño.
**Esfuerzo:** Medio-Alto · 1.5 semanas (era Medio 1 sem; +empty states, skeletons, sparklines, onboarding).
**Skills:** `frontend-design` (driver principal) · `superpowers:brainstorming` para el flujo de onboarding · `superpowers:writing-plans` para secuenciar vista por vista · `accessibility` para contraste.

**Qué entrega (sistema visual — base original):**
- Sistema de diseño: Playfair Display (números signature) + Outfit (UI), acento champagne `#c9a84c`.
- Cards de insight con border-left de color semántico (no fondo lleno).
- Barras de presupuesto 2px, íconos en chips tintados.
- Aplicado a todas las vistas: dashboard, historial, gráficos, metas, préstamos, configuración.
- Dark mode refinado + transición a light mode coherente.

**Qué entrega (mejoras del benchmark):**
- **Empty states ilustrados con CTA** (mejora #5): cada vista sin datos (historial, metas, préstamos, presupuestos) con ilustración + acción clara, no una tabla en blanco. Primer momento que ve un usuario nuevo. *Líder: Copilot.*
- **Skeleton loaders** (mejora #6): reemplazan los spinners del spec original por skeletons del layout real. Bajan la fricción percibida y se ven premium. *Líder: Copilot.*
- **Sparklines inline por categoría** (mejora #7): mini-gráfico de tendencia 7-day al lado de cada categoría en el historial. Densidad de información tipo editorial financiero; complementa el waterfall existente.
- **Onboarding contextual de 3 pasos** (mejora #11): primer login → moneda/ingreso → 3 categorías iniciales → primera transacción de ejemplo. Valor inmediato, como Fintonic. Sube la activación. *Líder: Fintonic.*

**Prompt para Claude:**
```
Nestra v2, Fase 5: rediseño visual completo a "editorial luxury dark", MÁS pulido
de experiencia (empty states, skeletons, sparklines) y un onboarding de 3 pasos.

Sistema de diseño aprobado (ya validado en mockup):
- Tipografía: Playfair Display para números grandes, Outfit para toda la UI.
- Acento único: champagne gold #c9a84c (links, nav activo, avatar).
- Insight cards: border-left 2px de color semántico + fondo tintado sutil (4%),
  NO fondo lleno.
- Barras de progreso finas (2px). Íconos de categoría en chips redondeados 24x24
  con fondo tintado. Fondo base near-black #08080f.

Aplica el sistema a TODAS las vistas: dashboard, historial, gráficos, metas,
préstamos, presupuestos, configuración. Coherencia con light mode también.

Pulido de experiencia (mejoras del benchmark):
- Empty states ilustrados: cada vista sin datos muestra una ilustración + un CTA
  claro (ej. historial vacío -> "Registra tu primer gasto"). No tablas en blanco.
- Skeleton loaders: reemplaza TODOS los spinners por skeletons que imitan el
  layout real de cada vista mientras carga.
- Sparklines inline: mini-gráfico de tendencia de 7 días junto a cada categoría en
  el historial.
- Onboarding de 3 pasos (primer login): paso 1 moneda + ingreso mensual; paso 2
  elegir/crear 3 categorías; paso 3 registrar una transacción de ejemplo. Termina
  llevando al dashboard ya con algo de valor visible. Solo se muestra una vez.

Usa frontend-design como driver y brainstorming para el flujo de onboarding.
writing-plans para secuenciar vista por vista. Verifica contraste WCAG AA con la
skill accessibility. No rompas funcionalidad existente — capa visual + onboarding.
```

**Verificación:** todas las vistas coherentes, contraste AA, light/dark sin glitches. Cada vista vacía muestra empty state con CTA. Las cargas muestran skeletons, no spinners. Sparklines aparecen por categoría. Onboarding corre una sola vez en el primer login y deja al usuario en el dashboard con valor visible.

---

## Fase 6 — Sistema de pareja / hogar v2

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
Nestra v2, Fase 6: sistema de pareja/hogar compartido (la killer feature, opt-in).

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

## Fase 7 — Notificaciones push + recordatorios

**Modelo:** Sonnet 4.6 — integración sobre Web Push API estándar.
**Esfuerzo:** Medio · 4-5 días.
**Skills:** `superpowers:writing-plans` → `subagent-driven-development` · `context7` para Web Push API.
**Requiere:** Fase 1 (el Service Worker maneja el evento push).

**Qué entrega:**
- Web Push API + suscripción almacenada en Supabase.
- Alertas: límite de presupuesto cruzado, recordatorio de meta, préstamo pendiente, recordatorio de gasto recurrente próximo (de Fase 4).
- Edge Function de Supabase para disparar push (cron o evento).

**Prompt para Claude:**
```
Nestra v2, Fase 7: notificaciones push.

1. Web Push API: pedir permiso, guardar la suscripción en Supabase (tabla
   push_subscriptions con user_id).
2. Disparadores: presupuesto cruzó su límite, recordatorio de aporte a meta,
   préstamo pendiente de cobro/pago, y gasto recurrente próximo (tabla recurrentes
   de Fase 4).
3. Supabase Edge Function que envía las push (por cron diario y/o por evento).

Requiere que la PWA de la Fase 1 ya esté lista (el Service Worker maneja el evento
push). Usa context7 para la API actual de Web Push y VAPID keys. Usa writing-plans.
Pide permiso de notificación en un momento contextual, no al abrir la app.
```

**Verificación:** cruzar límite de presupuesto → push llega al dispositivo. Recordatorio de recurrente próximo llega el día previo.

---

## Trazabilidad — las 17 mejoras del benchmark

| # | Mejora | Dimensión | Fase | Modelo |
|---|--------|-----------|------|--------|
| 1 | Suscripciones / gastos recurrentes | Features | 4 | Opus 4.8 |
| 2 | Calendario de flujo de caja | Features | 4 | Opus 4.8 |
| 3 | Split de transacción multi-categoría | Features | 3 | Opus 4.8 |
| 4 | Foto de recibo adjunta | Features | 3 | Opus 4.8 |
| 5 | Empty states ilustrados | Diseño | 5 | Opus 4.8 |
| 6 | Skeleton loaders | Diseño | 5 | Opus 4.8 |
| 7 | Sparklines inline por categoría | Diseño | 5 | Opus 4.8 |
| 8 | Quick-add con parseo de texto | UX | 3 | Opus 4.8 |
| 9 | Plantillas de transacciones frecuentes | UX | 3 | Opus 4.8 |
| 10 | Undo en toast al borrar | UX | 3 | Opus 4.8 |
| 11 | Onboarding contextual de 3 pasos | UX | 5 | Opus 4.8 |
| 12 | Safe-to-spend diario | Insights | 2 | Opus 4.8 |
| 13 | Insight de préstamos | Insights | 2 | Opus 4.8 |
| 14 | Auto-categorización aprendida (local) | Insights | 3 | Opus 4.8 |
| 15 | App shortcuts (manifest) | Mobile | 1 | Opus 4.8 |
| 16 | Web Share Target API | Mobile | 1 | Opus 4.8 |
| 17 | Desbloqueo biométrico WebAuthn | Mobile | 1 | Opus 4.8 |

**Top 3 por impacto en retención** (priorizar si el tiempo es limitado): #8 Quick-add (Fase 3), #12 Safe-to-spend (Fase 2), #13 Insight de préstamos (Fase 2).

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
- Las migraciones destructivas (RLS de Fase 0, `hogar_id` de Fase 6) se aplican SOLO al proyecto v2.
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

- **Seguridad:** Fases 0 y 6 tocan políticas RLS; la Fase 1 añade WebAuthn. En todas, revisar el SQL/credenciales manualmente antes de aplicar a producción. Probar aislamiento entre usuarios con TDD siempre.
- **Deploy:** desarrollo en `master`, GitHub Pages sirve desde `main`. Push `master:main` para publicar (solo v1 hasta el cutover).
- **Convenciones de código:** IIFE, `var`, `escHtml()` en todo contenido de usuario, CSS custom properties, hash-routing. No romper patrones existentes.
- **Sin AI externa:** el quick-add (Fase 3) y la auto-categorización (Fase 3) usan reglas + diccionarios locales, no LLMs. Privacidad y costo cero son parte del posicionamiento de Nestra.
- **Cada fase** termina con su propio spec → plan → ejecución (ciclo superpowers completo). Este documento es el mapa maestro, no reemplaza los specs por fase.
