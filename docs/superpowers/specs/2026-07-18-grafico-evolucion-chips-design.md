# Gráfico de evolución: línea suave y chips propios

Fecha: 2026-07-18
Estado: aprobado (brainstorming).

## Contexto

`views/graficos.html` renderiza 9 gráficos. El chart 1 ("Evolución temporal")
es una línea de gastos e ingresos. Sobre la reja hay dos toggles globales:
ámbito (Personal/Hogar) y granularidad (Días/Meses/Trimestres).

Dos problemas observados por el usuario:

1. **Picos muy pronunciados.** La línea usa `tension: 0.25`, que apenas curva.
2. **Los chips de granularidad parecen actualizar todos los gráficos.** Y es
   cierto visualmente: `setGranularidad()` llama a `recargarTodo()`, que
   recarga los 9. El propio comentario del código lo admite como deuda
   («Recarga de más (todos los charts por un toggle que afecta a uno)»).
   El dato de granularidad solo lo consumen `cargarDatos` (para decidir si pide
   la ventana ancha) y `render1`.

## Objetivo

Que el chart 1 se lea mejor y que sus controles vivan en su propia card,
afectando solo a ese gráfico.

## 1. Línea suavizada — `monotone`, no más `tension`

Subir `tension` curva más, pero la interpolación bezier de Chart.js
**sobrepasa los datos**: entre dos puntos positivos puede dibujar la curva por
debajo de cero, mostrando un valor que no existe. En una serie de dinero eso
es engañoso.

Se usa `cubicInterpolationMode: 'monotone'` en ambos datasets del chart 1.
Suaviza igual, pero garantiza que la curva nunca sale del rango de los datos
reales: no inventa caídas ni picos fantasma.

`tension` se retira de esos dos datasets (`monotone` la ignora; dejarla
confunde a quien lea el código después).

**Alcance:** solo el chart 1. Los demás gráficos con `tension` (charts 4, 6, 8,
9) no se tocan — no es lo que el usuario reportó, y el 4 acumula a propósito.

## 2. Chips dentro de la card, etiquetas D / M / T

- El bloque `.graf-toggle--gran` sale de la barra global y entra en la card
  del chart 1, alineado a la derecha del título.
- Etiquetas cortas: **D**, **M**, **T** (Días, Meses, Trimestres). Se mantiene
  Trimestres — no se cambia a Años (decisión del usuario).
- Cada botón lleva `aria-label` completo ("Por días", "Por meses",
  "Por trimestres") para que un lector de pantalla no lea letras sueltas.
  El texto visible es la letra; el accesible, la palabra.
- Estilo: variante reducida de `.graf-seg` ya existente, sin `flex: 1` (no
  deben estirarse a todo el ancho como los del toggle global).

## 3. El chip solo recarga su gráfico

Se cachea el último `datos` devuelto por `cargarDatos`, junto con el ámbito con
el que se pidió. `setGranularidad()` deja de llamar a `recargarTodo()` y llama
a `recargarChart1()`:

- **D** → re-renderiza el chart 1 con `datos.txMes`, ya en memoria: **cero
  peticiones de red**.
- **M / T** → pide solo la ventana ancha de transacciones (12 meses u 8
  trimestres), la adosa al caché como `serieAmplia` y re-renderiza el chart 1.
  Los otros 8 gráficos no se tocan ni parpadean.

Guarda de carrera propia (token incremental, mismo patrón que `cargaToken` en
`recargarTodo`): si el usuario toca D→M→T rápido, solo pinta la última.

Si no hay caché todavía (el usuario toca un chip antes de que termine la carga
inicial), cae a `recargarTodo()` — camino seguro, sin inventar estado.

El caché se reemplaza en cada `recargarTodo()`, que es lo que corre al cambiar
mes o ámbito. Así un chip pulsado después de cambiar de mes opera sobre los
datos correctos.

## 4. Qué NO cambia

- Los otros 8 gráficos: ni datos, ni estilos, ni cuándo se recargan.
- El toggle de ámbito (Personal/Hogar) sigue global y sigue recargando todo:
  sí afecta a todos los gráficos.
- La lógica de `agruparSerie` y de la ventana ancha (12 meses / 8 trimestres).
- El gating de Fase 6.1 (sin hogar, no se ofrece el ámbito).

## Verificación (preview, cuenta throwaway + hogar de pruebas)

1. Los 3 chips cambian **solo** el chart 1: los otros 8 no muestran estado de
   carga ni pierden sus datos (comprobar que sus instancias de Chart.js no se
   destruyen).
2. D no dispara ninguna petición de red; M y T disparan exactamente una.
3. La línea del chart 1 no baja de 0 entre dos puntos positivos (comprobar
   contra el rango real de los datos, no a ojo).
4. Cambiar de mes con M o T activo mantiene la granularidad y muestra datos
   coherentes con el mes nuevo.
5. Cambiar de ámbito con M o T activo idem.
6. Pulsar un chip repetidamente y rápido no deja el gráfico en un estado
   intermedio (guarda de carrera).
7. Sin movimientos, el estado vacío del chart 1 sigue apareciendo.
8. Los `aria-label` de los 3 chips leen la palabra completa.

## Archivos afectados

- `views/graficos.html` — único archivo. Markup de los chips, CSS de la
  variante reducida, `render1` (monotone), caché de datos, `recargarChart1`,
  `setGranularidad`.

Sin cambios de esquema, de `js/` ni de `sw.js` (las vistas son NetworkFirst; no
requiere bump de `SHELL_VERSION`).
