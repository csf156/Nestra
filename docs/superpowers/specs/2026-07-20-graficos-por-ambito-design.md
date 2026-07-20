# Gráficos: cada uno respeta el ámbito seleccionado

Fecha: 2026-07-20
Estado: aprobado (brainstorming), pendiente de plan de implementación.

## Motivación

En `#graficos`, varios gráficos no reflejan el ámbito seleccionado (Personal /
Hogar): muestran datos del otro ámbito, datos mezclados, o series que no aplican
(p. ej. una línea de ingresos para el hogar, que no tiene ingresos propios desde
Fase 6.3). Cambio de **solo cliente** en `views/graficos.html` (+ una función pura
en `js/graficos-serie.js`, que tiene tests).

## Bug fundacional (raíz de varios síntomas)

En la carga inicial, la clase `.graf--personal` **nunca se aplica**. Solo la
togglea `setAmbito`, que además tiene un guard `if (nuevo === estado.ambito)
return;`. Como el ámbito por defecto es `personal`, al entrar a la vista la clase
no se pone, y el CSS `.graf--personal #card3, .graf--personal #card6 { display:
none; }` no oculta nada → las cards 3 (Aporte real vs. esperado) y 6 (Flujo de
caja) se ven **vacías** en personal (sus render no corren porque no están en
`visiblesPara('personal')`, pero la card sigue en el DOM).

**Fix:** en el init (antes del primer `recargarTodo()`), aplicar la clase de
ámbito y el estado activo del toggle según `estado.ambito`, en vez de depender de
un click. Esto por sí solo arregla "Aporte real vs. esperado aparece en personal".

## Cambios por gráfico

| # | Gráfico | Personal | Hogar |
|---|---|---|---|
| 1 | Evolución temporal | Gastos + Ingresos (sin cambio) | Gastos + **Ahorro** |
| 2 | Distribución por categoría | Gasto personal (sin cambio) | **Solo gasto de hogar** |
| 3 | Aporte real vs. esperado | **Oculto** (init fix) | Se muestra (sin cambio) |
| 6 | Flujo de caja | **Se muestra** (fórmula nueva) | **Oculto** |
| 7 | Comparativa mes a mes | Gasto personal | **Solo gasto de hogar** |
| 9 | Proyección de saldo | **Se muestra** | **Oculto** (personal-only) |
| 4,5,8 | — | Auditar que ya respetan el ámbito | idem |

### Chart 1 — Evolución temporal (hogar → Gastos + Ahorro)

Hoy `render1` siempre dibuja dos datasets: Gastos e Ingresos. Para el hogar la
línea de Ingresos es plana en 0 (sin sentido). Cambio:

- `js/graficos-serie.js` (`agruparSerie`) hoy solo trackea `gasto` e `ingreso`
  (ignora `ahorro`). Añadir `ahorro` a su salida: cada punto pasa a
  `{ label, gasto, ingreso, ahorro }`. Es una función pura con tests → añadir
  tests para el nuevo campo (mes/día que agrupa ahorro; que gasto/ingreso no
  cambian).
- `render1` elige los dos datasets según ámbito:
  - personal → `[Gastos, Ingresos]` (como hoy).
  - hogar → `[Gastos, Ahorro]` (Ahorro con `--color-info` o similar; Gastos con
    `--color-danger` como hoy).
- El texto de la descripción (`graf1Desc`) se ajusta al ámbito.

### Chart 2 — Distribución por categoría (hogar → solo gasto hogar)

Causa del bug reportado ("al pasar a hogar no cambia"): la rama hogar de
`cargarDatos` devuelve `resumen: getResumenMensual(...)`, y `getResumenMensual`
(js/db.js:1189) calcula `porCategoria` sobre **todos** los gastos visibles
(personal + hogar, sin filtrar ámbito — su comentario lo dice). En hogar, chart 2
muestra la mezcla dominada por lo personal → parece que no cambia.

**Fix:** en la rama hogar de `cargarDatos`, calcular `porCategoria` desde los
gastos de **hogar** (reusar `derivarPorCategoria` sobre `resHog[0]` = txMes de
hogar, como ya hace la rama personal con `derivarPorCategoria(txMesP)`), en vez de
tomar el `porCategoria` mezclado de `getResumenMensual`. `getResumenMensual` no se
toca (otros consumidores dependen de su forma actual); solo se sobrescribe el
`porCategoria` en el objeto `datos` que arma la rama hogar.

`derivarPorCategoria` (graficos.html:246) ya filtra a gasto — verificar y reusar.

### Chart 3 — Aporte real vs. esperado (hogar-only)

Es correcto que sea hogar-only. El init fix lo oculta en personal. Sin más cambios.

### Chart 6 — Flujo de caja (se invierte a personal-only)

Hoy es hogar-only y mezcla hogar+personal (ingresos personales + gastos
hogar+personal). El hogar no tiene ingresos → un flujo de caja no aplica al hogar.
El usuario lo quiere en **personal**, con esta fórmula:

- `ingresos` = ingresos personales del mes.
- `gastos` = gastos personales + **mi aporte real a los gastos del hogar** este
  mes = `aporteRealPorMiembro(txsHogar, currentUser.id, rango).gasto`
  (`js/hogar-aporte.js`, pura, con tests).
- `balance` = ingresos − gastos.

Implica:
- `render6` reescrito con la fórmula de arriba, leyendo del objeto `datos`.
- La rama **personal** de `cargarDatos` debe traer también los gastos de **hogar**
  del mes (hoy solo trae personales vía `soloPersonal`) para poder calcular "mi
  parte". Traer `txHogarMes` y pasarlo a `datos` (o precalcular
  `miAporteGastoHogar` en `cargarDatos`).
- `visiblesPara`: mover 6 (y 9, ver auditoría) a personal-only. Resultado final
  combinando 6 y 9: `personal = [1,2,4,5,6,7,8,9]`, `hogar = [1,2,3,4,5,7,8]`.
- CSS de ocultamiento: hoy `.graf--personal #card3, .graf--personal #card6
  { display:none }`. Pasa a ocultar el **3 en personal** y los **6 y 9 en hogar**.
  Enfoque recomendado por simetría: `.graf--personal #card3 { display:none }` +
  `.graf:not(.graf--personal) #card6, .graf:not(.graf--personal) #card9
  { display:none }`. Con el init fix, `.graf--personal` está siempre presente en
  personal, así que `.graf:not(.graf--personal)` = hogar de forma fiable.
- La descripción de la card 6 se actualiza a la semántica personal.

### Chart 7 — Comparativa mes a mes (acotar al ámbito)

Usa `datos.resumen.porCategoria` (actual) y `datos.resumenAnterior.porCategoria`
— hereda la misma mezcla que el 2 en la vista hogar. Aplicar el mismo arreglo: en
hogar, ambos `porCategoria` (actual y anterior) se calculan desde gastos de hogar.
La rama hogar de `cargarDatos` ya trae `resumenAnterior: resHog[2]`
(`getResumenMensual` del mes anterior) — sobrescribir su `porCategoria` con la
versión acotada a hogar (necesita los gastos de hogar del mes anterior; hoy
`cargarDatos` no los trae para hogar → añadir el fetch, o derivar de una consulta
de txs de hogar del mes anterior).

### Charts 4, 5, 8, 9 — Auditoría

Verificar uno por uno en la implementación que usan datos del ámbito seleccionado:
- 4 (Ahorro acumulado): personal usa `getBalancePersonal`; hogar usa
  `getAhorrosHogar`. Parece ya acotado — confirmar.
- 5 (Mapa de calor): usa `datos.txMes` (ya acotado por ámbito en `cargarDatos`).
  Confirmar.
- 8 (Proyección de metas): usa `datos.metas` (metas del ámbito). Confirmar.
- 9 (Proyección de saldo): **personal-only** (decisión del usuario — la proyección
  de saldo solo tiene sentido en lo personal). Igual que el chart 6: quitar 9 de
  `visiblesPara('hogar')` y ocultar `#card9` en hogar por CSS. Queda en
  `personal = [1,2,4,5,6,7,8,9]`, `hogar = [1,2,3,4,5,7,8]`.

Cualquier desajuste que aparezca en la auditoría se documenta y se corrige o se
deja anotado según su tamaño.

## Alcance / No-objetivos

- Solo cliente: `views/graficos.html` + `js/graficos-serie.js` (+ sus tests). Sin
  tocar la base de datos.
- No se toca `getResumenMensual` (otros consumidores dependen de su forma); se
  sobrescribe `porCategoria` en el `datos` de la rama que lo necesita.
- No se rediseña el layout ni el estilo de los gráficos — solo qué datos muestra
  cada uno según el ámbito.
- Subsistema A (% del fondo) es un trabajo aparte.

## Testing

- `js/graficos-serie.js`: `test/graficos-serie.test.mjs` (node:test). Añadir tests
  para el nuevo campo `ahorro` en la salida de `agruparSerie` (agrupa ahorro por
  día y por mes; gasto/ingreso intactos; sin ahorro → 0). Correr
  `node --test test/graficos-serie.test.mjs`.
- El resto es integración de UI: verificar en navegador (con cuenta/hogar de
  PRUEBA) que cada gráfico muestra lo correcto en cada ámbito, y que al alternar
  Personal↔Hogar todos cambian. Como la vista exige sesión, si no hay una
  disponible se documentan los pasos para que el usuario los corra.
- `SHELL_VERSION` bump (cambia el app shell: graficos.html + graficos-serie.js).
