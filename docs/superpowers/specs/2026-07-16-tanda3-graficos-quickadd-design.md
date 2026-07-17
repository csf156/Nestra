# Tanda 3 — Granularidad en gráficos y quick-add de metas — Design

**Fecha:** 2026-07-16
**Estado:** Diseño aprobado, pendiente plan de implementación
**Rama:** `v2`

## Contexto

Items #2 y #6 de las 8 mejoras del 2026-07-16, la última tanda. Son independientes entre sí
(archivos y dominios distintos); comparten spec solo porque el usuario los pidió juntos y
ambos son pequeños. Cada uno tiene su sección y sus tareas.

> **#2:** los gráficos de evolución temporal del gasto (personal y de hogar) no debería
> mostrar el acumulado por día si no el gasto del día, así se puede ver a simple vista cuales
> fueron los periodos de mayor gasto. De igual manera deberían tener un toogle para marcar si
> queremos ver el gráfico por días, por meses o por trimestres (analiza en qué otros gráficos
> valdría la pena realizar este cambio).

> **#6:** La función de agregar rápidamente una transacción no reconoce aporte a metas. Si
> coloco "aporte meta alquiler S/5" o "ahorro hogar S/100" el sistema debe poder diferenciar
> que se trata de un ahorro […] también debe poder diferenciar si se esta aportando al ahorro
> (o a una meta específica) del hogar o del ámbito personal.

**#6 es mucho más pequeño de lo que el pedido sugiere.** Verificado con `parseQuickAdd` el
2026-07-16:

| Entrada | Hoy | |
|---|---|---|
| `ahorro hogar 100` / `ahorro hogar S/100` | `tipo=ahorro, ambito=hogar` → `insertTransaccion` ya llama a `distribuir_ahorro` (`db.js:192`), que reparte entre fondo y metas del hogar | ✅ **ya funciona** |
| `ahorro 50` | `tipo=ahorro, ambito=personal` | ✅ ya funciona |
| `aporte meta alquiler S/5` | `tipo=gasto, ambito=personal` | ❌ **lo único roto** |

Y la fontanería para arreglarlo ya existe: `insertAporteDirecto(meta_id, monto, fecha, nota)`
(`db.js:870`) → RPC `aporte_directo_meta`. Solo falta que el parser resuelva `meta <nombre>`.

---

## Sección 1 — Granularidad en gráficos (#2)

### Qué charts cambian, y por qué solo uno

El usuario pidió analizar dónde más aplicaba. Revisados los 7:

| Chart | Veredicto |
|-------|-----------|
| **1. Evolución temporal** | El cumsum (`graficos.html:319`) aplana los picos: es exactamente la queja. **Quitar el cumsum + añadir el toggle.** |
| 2. Distribución por categoría | Donut. La granularidad no aplica; solo cambiaría la ventana, que es otro concepto. |
| 3. Aporte real vs. esperado | Suma gasto+ahorro (mismo defecto que la Tanda 2 arregló en `#hogar`). Otro problema, otra tanda. |
| **4. Ahorro acumulado** | Acumula, **y ahí es el punto**: mide cómo crece el bote a 6 meses. Se deja intacto. |
| **5. Mapa de calor** | Ya es por día y no acumula. Un toggle mes/trimestre no aplica a un heatmap de días del mes. |
| 6. Flujo de caja | Ya es mensual por diseño. |
| 7. Comparativa mes a mes | Ya es mes vs mes por diseño. |

**Solo el 1.** Los charts 4 y 5 parecen candidatos y no lo son, por razones opuestas: el 4
acumula a propósito, el 5 ya está bien.

### El cumsum

`graficos.html:319` hace `for (var i=1;i<dias;i++){ gastos[i]+=gastos[i-1]; ingresos[i]+=ingresos[i-1]; }`.
Se borra. La descripción de la card (`:23`, "acumulados por día") deja de ser cierta y se
actualiza.

### El toggle

Segmentado `graf-seg` (el patrón que la vista ya usa para el ámbito), con Días / Meses /
Trimestres, junto al de ámbito. Afecta **solo al chart 1**.

Ventanas (decisión del usuario):

| Granularidad | Ventana | Eje X |
|---|---|---|
| **Días** (default) | El mes elegido con el navegador | 1..N del mes |
| **Meses** | Los **12** que terminan en el mes elegido | `ene`, `feb`, … |
| **Trimestres** | Los **8** que terminan en el trimestre del mes elegido | `T1 26`, `T2 26`, … |

El navegador de mes sigue mandando: mueve el **final** de la ventana. No cambia de
significado según el toggle — eso se descartó por confuso.

Consecuencia aceptada: con ~2 meses de datos reales, "Trimestres" se verá casi vacío al
principio y se llenará con el tiempo.

### La lógica

Un módulo puro nuevo, `js/graficos-serie.js`, dual-export como el resto:

```
agruparSerie(transacciones, granularidad, hasta, n) -> [{ label, gasto, ingreso }]
  transacciones: filas con { tipo, fecha, monto }. Solo cuentan tipo 'gasto' e 'ingreso'.
  granularidad:  'dias' | 'meses' | 'trimestres'
  hasta:         { mes, anio } — el último periodo de la ventana (el del navegador)
  n:             cuántos periodos (12 meses, 8 trimestres; ignorado en 'dias')
```

Va en un módulo con tests porque es **aritmética de fechas**, que es donde se cometen los
errores: límites de trimestre, meses de 28/30/31 días, cruces de año. Un bug ahí es
silencioso — el gráfico se ve plausible pero miente.

### La capa de datos

`cargarDatos(ambito)` (`graficos.html:237`) hoy trae el mes con
`getTransacciones({fecha_desde: r.desde, fecha_hasta: r.hasta})`.

Cambio: **solo cuando `granularidad !== 'dias'`**, trae además la ventana ancha (hasta 24
meses para los 8 trimestres) y la deja en `datos.serieAmplia`. En "días" no se paga ese coste.

El toggle llama a `recargarTodo()`, igual que `cambiarMes` y `setAmbito`. Es el patrón que la
vista ya tiene, con su guarda de carrera (`cargaToken`) ya resuelta. Recarga de más (todos los
charts por un toggle que afecta a uno), pero coherente y sin inventar un camino nuevo.

---

## Sección 2 — Quick-add de aportes a meta (#6)

### El parser

`parseQuickAdd` (`js/parse-quickadd.js`) gana el reconocimiento de `meta <nombre>`:

```
"aporte meta alquiler S/5" -> { tipo:'ahorro', meta_id:'<id de Alquiler 🏠>', monto:5, ... }
```

- Detectar `meta` seguido del nombre fuerza `tipo = 'ahorro'` (un aporte a meta siempre lo es).
- El nombre se resuelve con **`tokenize`** de `autocat.js`, que `parse-quickadd` ya importa y
  que ya normaliza lo que hace falta. Verificado contra las metas reales:

  | Nombre real | `tokenize` |
  |---|---|
  | `Alquiler 🏠` | `["alquiler"]` — el emoji cae |
  | `Máquina de afeitar` | `["maquina","afeitar"]` — la tilde y el "de" caen |

  Así `meta alquiler` casa con `Alquiler 🏠` sin código de normalización nuevo.
- Las metas candidatas llegan por `opts.ctx.metas`. El parser sigue **puro**: no consulta la
  base. `quickAgregar` ya hace dos pasadas (parsea → carga ctx según el tipo → re-parsea),
  así que el hueco existe.

### El ámbito lo decide la meta

`aporte meta alquiler S/5` va al hogar porque **"Alquiler 🏠" es una meta del hogar**, no
porque el usuario lo escriba. Es lo que pedía ("debe poder diferenciar si se está aportando a
una meta específica del hogar o del ámbito personal") resuelto sin sintaxis extra: el ámbito
ya vive en la meta y `aporte_directo_meta` lo respeta.

Si el usuario escribe un ámbito **y** una meta (`meta alquiler personal`), manda la meta. Se
ignora el ámbito escrito sin avisar: la meta es lo específico y lo que el usuario nombró.

### Sin match, o con varias

**Error claro y no guarda nada.** El usuario nombró una meta concreta; guardar otra cosa en
su lugar es peor que no guardar — y es justo la clase de silencio que causó el bug del
reparto entre hogares (ver `nestra-v2-metas-ahorro`).

- 0 candidatas → `No encontré una meta que se llame "alquiler".`
- 2+ candidatas → las lista para que el usuario precise.

Mismo patrón que el error que la vista ya tiene (`No detecté un monto. Ej: "Uber 15".`).

La resolución vive en el módulo puro (`resolverMeta(nombre, metas)` → `{ meta_id }` |
`{ error, candidatas }`), no en la vista, para que tenga tests.

### El insert

`quickAgregar` (`views/transaccion.html:1409`): si el parseo trajo `meta_id`, llama
`insertAporteDirecto(meta_id, monto, fecha, nota)` en vez de `insertTransaccion`. Ese RPC
asigna el 100% a la meta, marca `es_aporte_directo` (que hace que `distribuir_ahorro` la
salte) y manda el excedente al fondo del ámbito de la meta.

**`insertAporteDirecto` es online-only** (lanza `Esta acción requiere conexión`). El
quick-add normal sí funciona offline vía outbox. Es una degradación aceptada y preexistente
del RPC: un aporte directo necesita leer el estado de la meta para calcular el excedente, y
no hay forma de resolverlo en el cliente. El error se muestra tal cual, sin encolar.

---

## Pruebas

- **`test/graficos-serie.test.mjs` (nuevo):** `agruparSerie` en las tres granularidades.
  Casos que deben quedar fijados: que **NO acumula** (el bug original: dos días con 10 dan
  `[10,10]`, no `[10,20]`); límites de trimestre (T1=ene-mar … T4=oct-dic); cruce de año hacia
  atrás (12 meses desde ene 2026 llegan a feb 2025); meses de 28/30/31 días; periodos sin
  datos que salen en 0 y no se saltan; ingresos y gastos por separado; filas de otros tipos
  (`ahorro`) ignoradas; lista vacía.
- **`test/parse-quickadd.test.mjs` (amplía):** `meta <nombre>` fuerza `tipo=ahorro` y resuelve
  el id; casa con acentos y emoji (`meta alquiler` → `Alquiler 🏠`, `meta maquina` →
  `Máquina de afeitar`); sin match devuelve error y NO monto suelto; varias candidatas
  devuelven la lista; la meta gana al ámbito escrito; sin la palabra `meta` nada cambia
  (regresión de los 15 tests actuales).
- **Manual en navegador:** con el hogar de pruebas (`nestra-v2-test-account`), que ya tiene
  "ZZ Meta fixture". Verificar el toggle en las tres granularidades, que la card ya no acumule,
  el layout móvil, y el quick-add con `meta zz` → aporte directo, y con un nombre inexistente
  → error sin guardar.

## Fuera de alcance (YAGNI)

- Los charts 2, 3, 4, 5, 6 y 7. Ver la tabla de la §1.
- La fuga de listener de `gateAmbitoGraf` (`graficos.html:830`): cada visita a `#graficos`
  añade un listener de `hogar:changed` a `window`, que sobrevive al cambio de vista. Es el
  mismo patrón que la Tanda 1 arregló en el dashboard. Preexistente y sin síntoma reportado;
  se anota para backlog.
- El chart 3 (`Aporte real vs. esperado`, vía `getAportesPorMiembro`) sigue sumando
  gasto+ahorro, el defecto que la Tanda 2 corrigió en `#hogar`. Otra tanda.
- Aportes directos offline: el RPC no lo permite y resolverlo exige lógica de excedente en el
  cliente.
- Sintaxis de meta más rica (`meta "nombre con espacios"`, aportes múltiples). Se resuelve por
  tokens; si choca en la práctica, se revisa entonces.
