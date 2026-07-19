# Pulido visual de #revisar — layout, jerarquía de card y affordance del swipe

Fecha: 2026-07-18
Estado: aprobado (brainstorming), pendiente de plan de implementación.

## Contexto

`views/revisar.html` ya está completa a nivel funcional: swipe con gate de completitud,
undo con toast, bottom-sheet de categoría, partes de gasto de hogar, sugerencia vía
`autocat.js`. Ver el spec previo `2026-07-17-revisar-swipe-offline-undo-design.md`.

Este trabajo es **solo una pasada visual y de accesibilidad**. No cambia ninguna
regla de negocio, ninguna llamada a la base, ni el flujo de confirmar/descartar.

El disparador fue una observación del usuario: "el texto se muestra con márgenes muy
ajustados". Al investigar resultó ser un bug de layout real, más una deriva de esta
vista respecto al sistema visual del resto de la app.

## Diagnóstico

Cinco desviaciones verificadas contra el resto del repo:

1. **`.rev` no tiene padding.** `views/revisar.html:2` es
   `.rev { max-width: 640px; margin: 0 auto; }`. Toda otra vista sí lo trae:
   `.dash` (`views/dashboard.html:113`) usa `padding: var(--space-md)` +
   `padding-bottom: calc(var(--space-xl) + 72px)`; `.metas`
   (`views/metas.html:129`) usa el mismo patrón. Resultado: el texto pega a los
   bordes de la pantalla en móvil, y la última card queda tapada por el FAB / nav.

2. **`.app-container` es una clase muerta.** `index.html:145` la aplica al `<main>`
   pero no está definida en ningún CSS. Por eso no hay padding heredado que salve
   a `.rev`. **Fuera de alcance de este trabajo** — ver "No-objetivos".

3. **El `h1` no usa la fuente de display ni el peso real de los títulos de
   página.** `.rev-title` es Outfit con `--font-size-xl`. `css/base.css:116` pone
   la familia base (`h1, h2 { font-family: var(--font-display); font-weight: 400 }`),
   pero **todo título de página real la pisa a `--font-weight-bold`** (600):
   `.dash-saludo` (`views/dashboard.html:133-140`), `.hist-title`
   (`views/historial.html:164-166`), `.metas-title` (`views/metas.html:131`),
   `.graf-title` (`views/graficos.html:118`). El 400 de la regla base solo se ve
   en la práctica en `h1` sin override explícito (p. ej. el `h1.sr-only` invisible
   de `login.html:3`, que no cuenta como referencia visual) — no en ningún título
   de página visible del repo. La paridad real con el resto de vistas es
   `--font-weight-bold`, no el 400 heredado.

4. **El monto no usa `tabular-nums`.** dashboard, historial y configuración sí
   (`font-variant-numeric: tabular-nums`). Sin esto los montos no alinean al
   escanear la lista en columna.

5. **`--font-weight-bold` es 600, igual que `--font-weight-semibold`**
   (`css/base.css:44-45`). La card usa `bold` para el monto y `semibold` para el
   comercio esperando contraste que no existe: son el mismo peso. El contraste
   tiene que venir de tamaño y familia, no de peso.

## Objetivos

1. Arreglar el padding de `.rev` (el bug reportado).
2. Devolver la card compacta a una jerarquía legible de un vistazo.
3. Hacer descubrible el swipe, que hoy es invisible hasta que ya lo estás haciendo.
4. Cerrar dos huecos de accesibilidad concretos.

## No-objetivos (YAGNI)

- **No se toca la paleta ni las familias tipográficas.** La identidad existente
  (Playfair Display + Outfit, oro `#c9a84c` sobre crema/negro cálido) es fuerte y
  no genérica. Este trabajo la aplica; no la reemplaza.
- **No se define `.app-container`.** Darle padding ahora duplicaría el que ya
  aplican `.dash`, `.metas` y las demás vistas. Queda como deuda separada.
- No se rediseña el vacío (`renderEmptyState` ya está bien), el skeleton, ni el
  bloque de partes de hogar.
- No se toca la lógica del toast de undo. Su `z-index: 110` está deliberado y
  documentado (`views/revisar.html:41-45`) — el comentario explica que el botón
  "Deshacer" recibía los clicks de la nav. No re-litigar.
- No se toca el gate de completitud del swipe (`pendienteCompleto`), ni el gate
  de tipo-por-ámbito (`gateTipoPorAmbito`). Ambos tienen comentarios explicando
  bugs reales que previenen.

## 1. Layout

`.rev` recibe, copiado literal del patrón de `.dash`:

```css
.rev {
  max-width: 640px;
  margin: 0 auto;
  padding: var(--space-md);
  padding-bottom: calc(var(--space-xl) + 72px);
}
@media (min-width: 600px) {
  .rev { padding: var(--space-lg); padding-bottom: calc(var(--space-xl) + 72px); }
}
```

El `padding-bottom` sobredimensionado es para el FAB global, igual que en dashboard.

## 2. Jerarquía de la card compacta

**Concepto: la card se lee como un comprobante pendiente de sello.** Encaja con el
sujeto real — son consumos detectados en correos del banco, esperando tu OK.

Orden vertical dentro de `.rev-swipe-surface`:

1. **Línea de metadatos** — banco + fecha del correo, `--font-size-xs`,
   `--text-secondary`, en una sola fila. Tipo cabecera de recibo.
   - El badge del banco **deja de ser `.badge badge-neutral`**. Un banco no es un
     estado; en el resto de la app `.badge` significa estado. Pasa a ser texto
     `--font-size-xs` en mayúsculas con `letter-spacing`.
   - `Formato no reconocido` **sí se queda como `.badge badge-warning`**. Eso sí es
     estado, y es el único caso en que la card debe llamar la atención.
2. **Comercio** — el título real de la card. Mantiene `--font-weight-semibold` y
   `overflow-wrap: anywhere` (viene de texto de correo no confiable, ya escapado
   por `esc()`).
3. **Monto** — el ancla visual. `--font-display` (Playfair), `--font-size-2xl`,
   `font-variant-numeric: tabular-nums`, alineado a la derecha, con aire propio.
   Único elemento grande de la card.
4. **Chip de categoría** — la única cosa accionable en estado compacto. Sigue
   siendo el mismo `<button>` con el mismo `data-rev-chip`. Gana rol visual de
   "campo por llenar": el estado *sugerido* debe distinguirse del *confirmado* a
   un metro de distancia. Hoy la única diferencia es `border-style: dashed`, que
   en una pantalla de teléfono no se ve. Usar además color/fondo, no solo el borde.

**Riesgo aceptado:** subir el monto a Playfair 2xl hace la card más alta y se
scrollea más con muchos pendientes. Se acepta: esta vista se usa con 2-5 items,
y la calidad de cada decisión importa más que la densidad.

**Restricción dura:** todos los `id` (`revChip{i}`, `revMonto{i}`, `revCat{i}`,
`revCard{i}`, …) y todos los `data-rev-*` se conservan **exactamente**. El JS de la
vista los busca por `getElementById` y por delegación de eventos sobre esos
atributos. Cambiar uno rompe la vista en silencio.

## 3. Affordance del swipe

Hoy `.rev-swipe-hint` arranca en `opacity: 0` y solo se revela *durante* el arrastre
(`swipeMove`). Quien no lo descubre por accidente nunca sabe que el gesto existe.

Solución mínima: en la **primera card de la lista solamente**, una animación de
arranque única al cargar — desplaza la superficie ~12px a la derecha y la devuelve,
revelando un instante el borde verde de "Confirmar". Una sola vez por carga de la
vista. No se repite en las demás cards.

- Respeta `prefers-reduced-motion: reduce` (se anula por completo).
- No debe interferir con `swipeStart` / el `transform` inline que maneja el drag:
  la animación tiene que terminar y dejar el `transform` limpio antes de que el
  usuario pueda arrastrar, o usar una propiedad que no colisione.
- **No se añade texto tipo "desliza para confirmar".** Ocupa sitio permanente para
  enseñar algo que se aprende una sola vez.

## 4. Accesibilidad

Dos huecos concretos. El foco global **ya está resuelto** en `css/components.css:162`
(`:where(a, button, input, select, textarea, [tabindex]):focus-visible` → outline
oro), así que el chip, los botones y los inputs ya lo tienen. No hace falta añadir
nada para ellos.

1. **Expandir la card no es alcanzable por teclado.** El disparador es
   `<div class="rev-compact" data-rev-expandir="{i}">` — sin `tabindex`, sin rol,
   sin manejo de tecla. Un usuario de teclado no puede abrir la card para editar
   monto o fecha. Darle rol de botón, `tabindex`, `aria-expanded` reflejando
   `.is-expanded`, y activación con Enter/Espacio.
   - Ojo: el chip es un `<button>` **anidado dentro** de `.rev-compact`. El HTML
     no permite botón dentro de botón, así que la solución no puede ser envolver
     todo en un `<button>`. Usar `role="button"` + `tabindex` en el div, y
     conservar el `ev.stopPropagation()` que ya existe para el chip.
2. **El bottom-sheet no cierra con Escape.** Hoy solo cierra tocando el backdrop
   (`revSheetBackdrop`). En desktop con teclado es una trampa. Añadir Escape →
   `cerrarSheet()`.

## Verificación

- Servidor local (`preview_start`, config `nestra` de `.claude/launch.json`),
  vista `#revisar`, a 375px y a 1280px.
- Comprobar en **ambos temas** (claro y oscuro): los tokens cambian de valor entre
  `html.light` y el default oscuro (`css/base.css:13-83`).
- Confirmar que el flujo sigue vivo tras los cambios de marcado: expandir card,
  abrir sheet y elegir categoría, cambiar tipo, cambiar ámbito a hogar (con la
  cuenta de prueba, nunca el hogar real), swipe a ambos lados, undo.
- Con `prefers-reduced-motion: reduce` activo, la animación de arranque no corre.
