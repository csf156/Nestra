# Tanda 1 — Bugs y quick wins — Design

**Fecha:** 2026-07-16
**Estado:** Diseño aprobado, pendiente plan de implementación
**Rama:** `v2`

## Contexto

El usuario reportó 8 mejoras. Van desde una línea de CSS hasta un cambio del modelo de
aportes del hogar. Meterlas en un solo plan bloquearía los arreglos triviales detrás del
rediseño semántico, así que se dividieron en 3 tandas por riesgo. Este spec cubre la
**Tanda 1**: los bugs y quick wins, desplegables de inmediato y sin tocar el modelo de datos.

| # | Item | Sección |
|---|------|---------|
| 3b | El balance del hogar no aparece hasta visitar otra sección | 1 |
| 4 | La sección Hogar solo carga una vez por sesión | 1 |
| 3a | Letras ilegibles en la card "Puedes gastar hoy" | 2 |
| 8 | Opción de moneda duplicada en configuración | 2 |
| 5 | El ámbito hogar no debe ofrecer "ingreso" | 3 |
| 7 | La card de presupuestos necesita dos órdenes | 3 |

**Fuera de esta tanda:** #1 (separar aporte en gasto vs ahorro) y #2 (granularidad de
gráficos) + #6 (quick-add de metas) van en las Tandas 2 y 3, con sus propios specs.
`js/hogar-desequilibrio.js` y `js/hogar-aporte.js` **no se tocan aquí**.

---

## Sección 1 — Estado del hogar

### Diagnóstico (#3b)

`tieneHogar()` ([db.js:1475](../../../js/db.js)) lee el cache síncrono `window.hogarState`,
que solo se puebla cuando alguien llama `getEstadoHogar()`. En el arranque de sesión nadie
lo llama, así que el primer render de cualquier vista ve `hogarState === undefined` y
`tieneHogar()` devuelve `false`. Tres consumidores se apagan solos:

| Consumidor | Ubicación | Síntoma |
|-----------|-----------|---------|
| Card "Balance del hogar" | `views/dashboard.html:930` (`aplicarGatingHogar`) | `display:none` |
| Card de desequilibrio | `views/dashboard.html:943` (`cargarDesequilibrioHogar`) | early-return, nunca se muestra |
| Toggle de ámbito Hogar/Personal | `views/transaccion.html:846` (`gateAmbito`) | fila oculta, ámbito forzado a `personal` |

Visitar `#hogar` llama `getEstadoHogar()`, puebla el cache, y al volver al dashboard ya
aparece todo. Eso es exactamente lo que reportó el usuario. El tercer síntoma (el form)
no fue reportado pero es el mismo bug y se arregla gratis.

### Diseño (#3b)

Primar el estado del hogar **una sola vez al autenticar**, antes del primer render de vista.
`_refrescarHogarState()` ([db.js:1481](../../../js/db.js)) ya hace exactamente esto —
llama `getEstadoHogar()`, cachea, y emite `hogar:changed` — solo falta invocarlo en el
arranque de sesión.

Los tres consumidores ya escuchan `hogar:changed` y se re-aplican solos. **No se tocan.**
Un fix, tres síntomas.

Requisitos:

- El priming NO debe bloquear el render si la red falla. `_refrescarHogarState` ya atrapa
  y deja `hogarState = null` en error; el gating cae a "sin hogar", que es el estado seguro.
- Debe correr después de que la sesión exista y antes del primer `handleRouteChange`, o
  bien en paralelo confiando en el evento. Se prefiere **no bloquear**: disparar el priming
  sin `await` y dejar que `hogar:changed` corrija el UI cuando llegue.
- Un usuario sin hogar no debe ver parpadeo: el estado inicial ya es "oculto", y el evento
  solo lo prende si hay hogar. No hay flash.

### Diagnóstico (#4)

**No confirmado. La primera tarea del plan es reproducirlo.**

Al volver a `#hogar` por segunda vez sale "No se pudo cargar el hogar. Revisa tu conexión
e inténtalo de nuevo" ([hogar.html:615](../../../views/hogar.html)). No es la red: el resto
de la app sigue funcionando.

Ese mensaje sale de un `catch` que envuelve **todo** `render()`, así que cualquier throw
dentro de `getEstadoHogar()` o `renderConHogar()` lo produce. Hipótesis principal:

> El canal realtime se fuga. `channel` es una variable del closure del IIFE
> ([hogar.html:569](../../../views/hogar.html)). El router re-inyecta el HTML y re-ejecuta
> el script en cada visita, así que el IIFE nuevo arranca con `channel = null` y la limpieza
> `supabase.removeChannel(channel)` no encuentra nada que limpiar. El canal de la visita
> anterior sigue suscrito en el cliente de Supabase. `subscribeHogar()` ([db.js:1594](../../../js/db.js))
> hace `supabase.channel('hogar-' + hogarId).subscribe()` — un segundo join al mismo topic.

Hipótesis alternativas a descartar en el repro: colisión de IDs del DOM entre la vista vieja
y la nueva; el modal `hogarDisolverModal` montado fuera del contenedor de la vista.

### Diseño (#4)

Depende del repro. **No se escribe el arreglo antes de leer el error real en consola.**

Si se confirma la fuga del canal, la dirección es sacar el ownership del canal del closure
del IIFE y ponerlo donde sobreviva a la vista: registrar el canal en un módulo (p.ej. la
propia `subscribeHogar`, que puede desuscribir el canal previo del mismo topic antes de
crear uno nuevo). Eso lo hace idempotente sin importar cuántas veces se re-monte la vista.

El plan debe incluir una **regresión reproducible** (visitar `#hogar` → salir → volver)
verificada en rojo antes del fix y en verde después.

---

## Sección 2 — Contraste (#3a) y moneda (#8)

### Diagnóstico (#3a)

Dos bugs superpuestos.

**Bug A — el `<p>` global gana a la herencia.** `.dash-s2s-card` define `color: #fff`
([dashboard.html:134](../../../views/dashboard.html)), pero sus tres hijos son `<p>` y
`base.css:118` define `p { color: var(--text-secondary) }`. Una regla que matchea el
elemento le gana a un valor heredado, así que los tres salen plomo. **Rompe ambos temas.**

**Bug B — el gradiente del tema oscuro es demasiado claro.** Los temas tienen paletas
invertidas: en claro `--color-primary: #8a6d22` (oro profundo), en oscuro `#c9a84c` (oro
brillante). El gradiente usa el token, así que en tema oscuro el fondo es claro y ni el
blanco alcanza.

Ratios medidos (script en `Verificación`):

| Tema | Fondo | Plomo (hoy) | Blanco | Texto oscuro |
|------|-------|-------------|--------|--------------|
| Oscuro | `#c9a84c` | **1.11:1** | 2.29:1 ✗ | 7.76:1 ✓ |
| Oscuro | `#5ec98a` | **1.23:1** | 2.06:1 ✗ | 8.61:1 ✓ |
| Claro | `#8a6d22` | **1.18:1** | 4.89:1 ✓ | — |
| Claro | `#1a6b43` | **1.13:1** | 6.51:1 ✓ | — |

Dos conclusiones que cambian el arreglo ingenuo:

1. **El tema claro ya pasa AA con blanco.** "Oscurecer el gradiente" en realidad significa
   *que el tema oscuro use el mismo gradiente que el claro*.
2. **La card hermana `--excedido` tiene el mismo bug B** y no fue reportada: en tema oscuro
   es `#f08a8a`, que con blanco da **2.41:1 ✗**. Arreglar solo la card normal la deja rota.
   Su valor de tema claro (`#b3261e`) da 6.54:1 ✓ — mismo patrón, misma solución.

### Diseño (#3a)

Cuatro tokens nuevos, con los valores profundos **fijos en ambos temas**, y texto blanco
siempre. El hero deja de depender de la paleta invertida.

```css
:root {
  --s2s-from: #8a6d22;  --s2s-to: #1a6b43;   /* card normal   */
  --s2s-exc-from: #b3261e; --s2s-exc-to: #8a1c1c; /* card excedido */
}
```

- `.dash-s2s-card` y `.dash-s2s-card--excedido` consumen los tokens en vez de
  `--color-primary` / `--color-success` / `--color-danger`.
- `.dash-s2s-card p { color: inherit; }` neutraliza el `p{}` global (bug A). Se prefiere
  `inherit` sobre repetir `#fff` en tres clases: una regla, y sigue el `color:#fff` de la card.

Resultado: 4.89:1 / 6.51:1 (normal) y 6.54:1 / 9.28:1 (excedido), en ambos temas, con el
monto grande (2.6rem) muy por encima del 3:1 que le exige AA.

**Alternativa descartada:** texto oscuro sobre el gradiente brillante da 7.76:1 y conserva
el punch del tema oscuro, pero obligaría a invertir el color del texto por tema (blanco en
claro, oscuro en oscuro). Se descartó por coherencia: un hero que cambia de color de texto
según el tema es más frágil de mantener que un gradiente fijo.

### Diagnóstico y diseño (#8)

Configuración tiene dos filas de moneda:

- `configuracion.html:149` — "Moneda principal", valor dinámico vía `#cfgMonedaValor`,
  poblado por `initMoneda()` desde `getMonedaActiva()`.
- `configuracion.html:166` — "Moneda", con el valor **hardcodeado** `Soles (S/)`.

Se borra la segunda (líneas 166-169). No es solo duplicación: para cualquier usuario que
no use soles, esa fila **muestra un dato falso**. La que queda lee el valor real.

---

## Sección 3 — Reglas de ámbito (#5) y orden (#7)

### Diagnóstico (#5)

El ámbito `hogar` solo admite `gasto` y `ahorro`; `ingreso` no aplica. Hoy nada lo impide:
tipo y ámbito son controles independientes en el form
([transaccion.html:840-844](../../../views/transaccion.html)) y chips de grupos distintos
en historial ([historial.html:17-24](../../../views/historial.html)).

Estado real de la base (verificado por introspección, no por el ledger):

```
tipo=ingreso, ambito=hogar  →  0 filas
```

Nunca se creó ninguna. **No hay datos que migrar.** El CHECK se puede aplicar limpio.

### Diseño (#5)

La regla se aplica en tres capas. Las tres son necesarias: las dos primeras son UX, la
tercera es la que la hace verdad.

**Capa 1 — form (`views/transaccion.html`).** Regla acordada: **el ámbito gana**.
Al tocar "Hogar" con tipo `ingreso` activo, el tipo salta a `gasto` y el botón "Ingreso"
se oculta. El usuario acaba de expresar su intención ("esto es del hogar"), así que se
respeta y se corrige lo demás. Al volver a "Personal", "Ingreso" reaparece; el tipo NO
se revierte solo (`gasto` es un default sano y revertir sería sorpresivo).
Sin toast: la regla es evidente al ver desaparecer el botón, y un aviso en cada cambio de
ámbito sería ruido para quien ya la conoce.

**Capa 2 — historial (`views/historial.html`).** Activar el chip "Hogar" apaga el chip
"Ingresos" si estaba activo y lo deja `disabled` + `aria-disabled="true"`. Al soltar
"Hogar", "Ingresos" se re-habilita (no se re-activa solo).

**Capa 3 — base de datos.** CHECK constraint en `transacciones`:

```sql
alter table public.transacciones
  add constraint transacciones_hogar_sin_ingreso
  check (not (ambito = 'hogar' and tipo = 'ingreso'));
```

Sin esto la regla vive solo en el cliente y cualquier `insert` por API — incluido el Worker
de ingesta de correos — la puede violar en silencio. Se aplica con `apply_migration`
(nunca por el SQL Editor) y **el usuario revisa el SQL antes**, según las reglas del proyecto.

Nota: los chips de tipo de historial son solo "Gastos" e "Ingresos" — no hay chip de
"Ahorro" pese a que `tipo='ahorro'` existe y el hogar ya tiene 4 filas. Es un hueco real
pero **fuera del alcance de esta tanda**; se anota para backlog.

### Diseño (#7)

La card "Presupuestos del mes" ([dashboard.html:66](../../../views/dashboard.html)) hoy
renderiza en el orden que llegan las categorías, primero personales y luego las de hogar
(`rowsPersonal + rowsHogar`).

Dos órdenes:

- **`limite`** — cercanía al límite del periodo, descendente (`gastado / limite`). **Default.**
  Es el orden accionable: la categoría a punto de reventar importa más que la que gastó
  mucho pero tiene margen.
- **`gasto`** — monto gastado, descendente. El ranking de "en qué se me va la plata".

Control: `<select>` + botón de dirección, calcando el patrón `hist-sort`
([historial.html:68](../../../views/historial.html), CSS en `:281`), inline en el head de
la card. Es el único control de orden que la app ya conoce, y en móvil es más compacto que
un segmentado de 44px de alto dentro de una card ya densa.

Diferencia con historial: `hist-sort` se oculta en desktop (`:438`) porque ahí ordenan los
encabezados de columna. La card de presupuestos no tiene encabezados, así que **el control
se muestra siempre**, en móvil y en desktop.

La comparación va en una **función pura** exportada (patrón `safe-to-spend.js` /
`hogar-desequilibrio.js`: dual-export `window` + ESM), no inline en el render, para que
tenga tests:

```
ordenarPresupuestos(filas, criterio, direccion) -> filas ordenadas
  filas:     [{ id, nombre, gastado, limite, esHogar }]
  criterio:  'limite' | 'gasto'
  direccion: 'desc' | 'asc'
```

Casos que los tests deben fijar: `limite = 0` no debe dividir por cero (esas filas ya se
filtran con `> 0` antes de renderizar, pero la función pura no debe asumirlo); empates
estables; el agrupado personal-primero **se pierde** al ordenar (es intencional: el orden
elegido manda sobre el agrupado, y la fila de hogar ya se distingue por su badge).

El orden elegido **no se persiste** entre sesiones. YAGNI: es un dashboard que se mira de
pasada, no una tabla de trabajo. Si el usuario lo pide, se agrega después.

---

## Verificación

| Item | Cómo se prueba |
|------|----------------|
| #3a | Script de contraste WCAG sobre los tokens nuevos: toda combinación texto/fondo ≥ 4.89:1. Más inspección visual en ambos temas. |
| #3b | Navegador contra la base real: login → dashboard **sin pasar por #hogar** → la card de balance y la de desequilibrio deben aparecer. Además: el toggle de ámbito debe verse en el form. |
| #4 | Repro en rojo primero (visitar #hogar → salir → volver → error), fix, luego verde. Sin repro no se escribe el fix. |
| #5 | Manual en form e historial (ambos sentidos de la interacción) + el CHECK rechazando un insert `ingreso`+`hogar` por API. |
| #7 | Tests unitarios de `ordenarPresupuestos` (`node --test test/*.test.mjs`) + verificación visual del control en móvil. |
| #8 | Visual: una sola fila de moneda, con el valor real del perfil. |

Tras cualquier migración, correr `supabase/tests/schema_contract_test.sql` vía `execute_sql`
y confirmar `ALL TESTS PASSED`, según las reglas del proyecto.

**Deploy:** commit + push a `v2` → Cloudflare Pages reconstruye solo. Se bumpea
`SHELL_VERSION` en `sw.js` porque cambian assets precacheados (`css/base.css`,
`js/` nuevo módulo de orden). En el teléfono puede requerir cerrar y reabrir la PWA.

## Fuera de alcance (YAGNI)

- Persistir el orden de presupuestos entre sesiones.
- Chip de "Ahorro" en los filtros de historial (hueco real, anotado para backlog).
- Auditar el contraste del resto de la app. Esta tanda arregla las dos cards del hero
  (normal y excedido) porque comparten la causa raíz; una auditoría general es otro trabajo.
- Cualquier cambio a `hogar-desequilibrio.js` / `hogar-aporte.js` (Tanda 2).
