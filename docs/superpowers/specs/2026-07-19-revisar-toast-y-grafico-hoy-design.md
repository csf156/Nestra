# Toast de #revisar que tapa la nav + gráfico diario que dibuja el futuro

Fecha: 2026-07-19
Estado: aprobado (brainstorming), pendiente de plan de implementación.

## Contexto

Dos bugs reportados por el usuario, independientes entre sí:

1. En `#revisar` (`views/revisar.html`), el botón "Deshacer" del toast de undo se
   ve permanentemente y tapa la barra de navegación inferior. Debería aparecer
   solo tras confirmar o descartar un pendiente.
2. En el gráfico de evolución temporal (`#graficos`, chart 1, granularidad
   "día"), la línea de gasto e ingreso se dibuja para **todos** los días del mes
   aunque hoy sea 19 de julio. Los días futuros no tienen sentido.

## Diagnóstico

### Bug 1 — toast: causa raíz es CSS, no lógica

El JS es correcto: el toast solo recibe la clase `.is-open` dentro de
`mostrarToastUndo`, que se llama desde `quitarCardConUndo` tras confirmar o
descartar (`views/revisar.html`, funciones `confirmar`/`descartar` →
`quitarCardConUndo` → `mostrarToastUndo`). No hay ningún camino que lo deje
abierto por defecto.

El bug está en cómo se oculta el estado cerrado. La regla:

```css
.rev-undo-toast { position: fixed; bottom: calc(var(--space-lg) + env(safe-area-inset-bottom, 0));
  transform: translateX(-50%) translateY(200%); z-index: 110; ... }
@media (max-width: 767px) {
  .rev-undo-toast { bottom: calc(60px + env(safe-area-inset-bottom, 0) + var(--space-md)); }
}
```

`translateY(200%)` desplaza el toast hacia abajo 2× su propia altura. Medido en
móvil (375×812, sin safe-area): el toast mide 42px, así que 200% = 84px. Pero el
`bottom` de móvil lo posiciona 76px por encima del fondo del viewport
(`60px + 0 + 16px`). Para despejarlo del todo haría falta desplazarlo
`76 + 42 = 118px`; con 84px se queda 34px corto.

**Medición real** (regla reproducida aislada, sin sesión): el toast cerrado
ocupa `y = 778 → 820` en un viewport de 812px de alto. La nav ocupa los últimos
60px (`752 → 812`). El toast se solapa 34px sobre la nav. Como el `<span>` del
mensaje está vacío cuando el toast está cerrado, lo único que asoma es el botón
"Deshacer" — exactamente el síntoma reportado.

El `z-index: 110` (por encima de la nav, 100) empeora el efecto: el botón no solo
se ve, además roba los clicks a los nav-links de debajo. Ese z-index está
puesto a propósito para cuando el toast SÍ está abierto (ver el comentario en
`views/revisar.html`) — no se toca; el problema es que el estado cerrado no está
realmente oculto.

### Bug 2 — gráfico diario: emite un punto por cada día del mes

En `js/graficos-serie.js`, `agruparSerie(..., 'dias', hasta)`:

```js
if (granularidad === 'dias') {
  var dias = new Date(Date.UTC(hasta.anio, hasta.mes, 0)).getUTCDate();  // 31 en julio
  var g = new Array(dias).fill(0), ing = new Array(dias).fill(0);
  ...
  return g.map(function (v, k) { return { label: String(k + 1), gasto: ..., ingreso: ... }; });
}
```

Devuelve un elemento por cada día del mes de `hasta`. Cuando la ventana es el mes
en curso, los días posteriores a hoy salen en 0 y la línea (con
`cubicInterpolationMode: 'monotone'`) se traza plana hacia el futuro.

El caller (`views/graficos.html`, `render1`) llama:
```js
agruparSerie(datos.txMes, 'dias', { mes: estado.mes, anio: estado.anio });
```
`estado.mes/anio` arrancan en el mes actual (`mesActual()`), pero el navegador de
meses (`cambiarMes`) permite retroceder a meses pasados. En un mes pasado el mes
entero es historia legítima y debe mostrarse completo. En un mes futuro no hay
datos → cae en el empty-state guard (`if (!datos.txMes.length) { setEstado(1,
'vacio'); return; }`), así que no dibuja línea al vacío. Por eso **solo el mes en
curso** sufre el bug.

## Objetivos

1. El toast de "Deshacer" solo se ve tras confirmar/descartar; cerrado, es
   invisible y no intercepta clicks.
2. El gráfico diario corta la línea en el día de hoy cuando la ventana es el mes
   en curso; los meses pasados siguen mostrando el mes completo.

## No-objetivos (YAGNI)

- No se toca el `z-index: 110` del toast ni la lógica de undo (timers, revert).
- No se cambia el comportamiento de granularidad "mes"/"trimestre": el último
  bucket (mes/trimestre en curso) es naturalmente parcial (acumulado a la fecha),
  que es lo esperado — no es una tira de días futuros en 0.
- No se añade un guard para impedir navegar a meses futuros en `#graficos`. El
  empty-state ya los cubre; añadir el guard es alcance aparte.
- No se toca el parser de ingesta, el schema, ni ninguna llamada a Supabase.

## 1. Toast: ocultar de verdad el estado cerrado

`visibility: hidden` en el estado base y `visibility: visible` en `.is-open`.
`visibility: hidden` hace el elemento invisible **y** no interactivo (no recibe
clicks), sin depender de que el `translateY` alcance a sacarlo del viewport.

Para no matar la animación de deslizamiento de salida, la transición de
`visibility` se retrasa hasta que termina la de `transform`:

```css
.rev-undo-toast { ...
  transform: translateX(-50%) translateY(200%);
  visibility: hidden;
  transition: transform .2s ease, visibility 0s linear .2s; }
.rev-undo-toast.is-open {
  transform: translateX(-50%) translateY(0);
  visibility: visible;
  transition: transform .2s ease, visibility 0s; }
```

Al abrir: `visibility` pasa a `visible` de inmediato (delay 0) y el `transform`
desliza hacia arriba. Al cerrar: el `transform` desliza hacia abajo durante
0.2s y `visibility` pasa a `hidden` recién a los 0.2s (cuando ya terminó el
deslizamiento). El `translateY(200%)` se conserva para que la animación siga
saliendo hacia abajo; ya no es la única defensa contra la visibilidad.

## 2. Gráfico diario: cortar en hoy

`agruparSerie` gana un parámetro opcional `hoy` (con día). Cuando la ventana
(`hasta`) es el mes/año de `hoy`, el número de días se recorta a `hoy.dia`:

```js
function agruparSerie(transacciones, granularidad, hasta, n, hoy) {
  if (granularidad === 'dias') {
    var dias = new Date(Date.UTC(hasta.anio, hasta.mes, 0)).getUTCDate();
    // Si la ventana es el mes en curso, corta en hoy: los días futuros no
    // tienen datos y trazaban una línea plana en 0 hacia adelante.
    if (hoy && hasta.anio === hoy.anio && hasta.mes === hoy.mes) {
      dias = Math.min(dias, hoy.dia);
    }
    ...
  }
  ...
}
```

- `hoy` es opcional: si se omite, se comporta como hoy (mes entero) — así los
  tests existentes que no lo pasan (`test/graficos-serie.test.mjs`, "respeta el
  largo del mes", "lista vacia o null no rompe") siguen verdes.
- La función se mantiene pura y determinista: `new Date()` vive en el caller,
  no aquí. Es el patrón del repo (inyectar `hoy` a las funciones puras — insights,
  safe-to-spend, brújula).
- El caller (`views/graficos.html`, `render1`) construye
  `hoy = { anio, mes, dia }` desde `new Date()` local y lo pasa como 5º
  argumento:
  ```js
  var d = new Date();
  var hoyDia = { anio: d.getFullYear(), mes: d.getMonth() + 1, dia: d.getDate() };
  serie = agruparSerie(datos.txMes, 'dias', { mes: estado.mes, anio: estado.anio }, null, hoyDia);
  ```

**Decisión sobre transacciones con fecha futura** (confirmada con el usuario): una
transacción fechada después de hoy dentro del mes en curso queda fuera del recorte
(su día `>= dias`, se descarta del chart diario) hasta que llegue ese día. Es
coherente con "la línea termina hoy"; una fecha futura pertenece a una proyección,
no a la línea de hechos. Se documenta con un test que lo fija como comportamiento
deliberado.

## Testing

- `js/graficos-serie.js` tiene suite en `test/graficos-serie.test.mjs`
  (node:test). Se corre por archivo: `node --test test/graficos-serie.test.mjs`
  (la forma glob `node --test test/` rompe por el path del worktree con puntos —
  ver `CLAUDE.md`). Se añaden tests para el recorte antes de implementar (TDD):
  mes en curso cortado en hoy, mes pasado completo, `hoy` omitido = mes entero
  (regresión), transacción de día futuro descartada.
- El toast es layout puro, sin lógica unitaria; se verifica en navegador midiendo
  el rect del toast cerrado (no debe solapar la franja de la nav) y confirmando
  que sigue apareciendo y siendo clickable al confirmar/descartar. En móvil y
  desktop, tema claro y oscuro.
- `SHELL_VERSION` se bumpea (v35 → v36) porque cambia el app shell.
