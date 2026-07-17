# Tanda 2 — Desequilibrio de aportes en gasto y en ahorro — Design

**Fecha:** 2026-07-16
**Estado:** Diseño aprobado, pendiente plan de implementación
**Rama:** `v2`
**Revierte parcialmente:** decisión 1 de `2026-07-14-fase6-3-economia-hogar-design.md`

## Contexto

Item #1 de las 8 mejoras que pidió el usuario el 2026-07-16, aislado en su propia tanda
porque es un cambio semántico, no un arreglo. Pedido literal:

> Creo que en la sección Hogar deberíamos separar el aporte de cada miembro en gasto del
> hogar y el aporte de cada miembro en ahorro del hogar, cada uno con su diferencia
> histórica correspondiente. Esta misma formula debe aplicarse en el dashboard en la
> tarjeta de desequilibrio de aportes: se debe mostrar el desequilibrio de aportes en
> gasto, el desequilibrio de aportes en ahorro y el desequilibrio general.

**El "desequilibrio general" se descartó durante el diseño.** El resto se implementa.

## Por qué no hay "general"

La Fase 6.3 dejó el ahorro fuera del desequilibrio a propósito (decisión 1: *"Evita el
doble conteo"*) y decidió que al disolver se reporten *"ambos por separado, sin
mezclarlos"* (decisión 8). La razón es una identidad del reparto del bote:

> `pot × (ahorroA / (ahorroA + ahorroB)) = ahorroA` — cada miembro recupera exactamente
> lo que ahorró.

Eso hace que gasto y ahorro **no sean la misma moneda**:

| Flujo | Qué pasa con el dinero |
|-------|------------------------|
| Gasto del hogar | Se gastó. No vuelve. Si pusiste de más, estás abajo de verdad. |
| Ahorro al hogar | Está aparcado. Vuelve a quien lo puso al disolver. No estás abajo. |

Sumarlos no solo dobla el conteo: **premia ahorrar sobre gastar** (ahorrar "aporta" igual
pero te lo devuelven) y deja cerrar un desequilibrio de gasto real con dinero que vuelve.

**Verificado con los datos reales del hogar (2026-07-16):**

| | gasto hogar | ahorro hogar |
|---|---|---|
| César (creador) | 125.54 | 55.00 |
| Darling (miembro) | 50.00 | 450.00 |

| Cifra | Resultado |
|-------|-----------|
| Gasto (lo que se muestra hoy) | Darling debería aportar más — **S/37.77** |
| Ahorro (nuevo) | César debería ahorrar más — **S/197.50** |
| General, si se sumaran | César debería aportar más — **S/159.73** |

Las dos apuntan en **direcciones opuestas**. El general habría invertido la conclusión,
apoyándose en S/450 que Darling recupera entera al disolver. Con un general en pantalla,
César habría compensado de su bolsillo un déficit inexistente.

**Decisión: dos cifras separadas, cada una en su moneda, y una línea que explique por qué
no se suman.** Es lo que ya había decidido la Fase 6.3; este spec solo añade la segunda
cifra, que antes no se mostraba.

## Decisiones tomadas

| # | Pregunta | Decisión |
|---|----------|----------|
| 1 | ¿Qué es el "desequilibrio general"? | **No existe.** Ver arriba. Se muestran gasto y ahorro por separado con una línea que explica que no se suman. |
| 2 | ¿El pago en efectivo (`saldar_hogar`) resta al desequilibrio de ahorro? | **No, solo al de gasto.** Un desequilibrio de ahorro se cierra ahorrando: si B le yapea S/100 a A, el bote no cambia — B sigue teniendo S/450 dentro y los recupera igual. Restarlo haría que la cifra mienta sobre lo que hay en el bote. |
| 3 | ¿Cómo se impide que alguien reste liquidaciones del ahorro? | **Por la forma del código**, no por convención: `desequilibrioAhorroHogar` no recibe el argumento `ajustes`. Un parámetro `tipo` en una sola función sí permitiría expresarlo. |
| 4 | ¿El `objetivo` (50/50 vs proporcional) aplica a ambos? | **Sí, el mismo.** La fórmula lo usa como ratio (`eA/(eA+eB)`), no como monto, así que no hay doble uso de `aporte_esperado`. |
| 5 | ¿Se muestran los montos crudos por miembro? | **Sí**, en la card del hogar. Hoy solo se ve la brecha ("S/37.77 más") sin saber de dónde sale. En el dashboard no: es un vistazo. |
| 6 | ¿Qué pasa con la card "Aporte del mes"? | **Se parte en gasto y ahorro.** Ver §4. |
| 7 | ¿Cambia la disolución? | **No.** Al disolver, el desequilibrio de ahorro es irrelevante: cada quien recupera lo suyo, que es justo lo que el preview ya muestra. El preview sigue avisando solo del de gasto. |
| 8 | ¿Cambia la base de datos? | **No.** Todo se calcula en el cliente desde `transacciones`, que ya tiene `tipo`, `ambito`, `user_id` y `monto`. |

## Componentes

### 1. `js/hogar-desequilibrio.js` — dos funciones, no un parámetro

Hoy: `calcularDesequilibrioHogar(transacciones, ajustes, uidA, uidB, objetivo)`, que
filtra `t.tipo !== 'gasto'` por dentro ([hogar-desequilibrio.js:23](../../../js/hogar-desequilibrio.js)).

Se reemplaza por:

```
desequilibrioGastoHogar(transacciones, ajustes, uidA, uidB, objetivo)
desequilibrioAhorroHogar(transacciones, uidA, uidB, objetivo)
```

- Ambas devuelven la misma forma que hoy: `{ brecha, debeAportarMas, yaAportoDeMas, pagoA, pagoB }`.
- `desequilibrioAhorroHogar` **no acepta `ajustes`** (decisión 3). Es el punto del diseño:
  hace estructuralmente imposible restar un pago en efectivo del ahorro.
- El cálculo interno se comparte en un helper privado. No se duplica la fórmula.
- **No se conserva `calcularDesequilibrioHogar` como alias.** Un nombre que ya no dice qué
  mide (¿gasto? ¿ambos?) es peor que un rename: los 3 callers se actualizan en el mismo
  commit y el compilador de tests los caza si falta uno.

Nombres de los campos: `pagoA`/`pagoB` se mantienen aunque en la de ahorro signifiquen
"ahorró A"/"ahorró B". Renombrarlos a algo neutro (`montoA`) obligaría a tocar los 9 tests
existentes por cosmética. Se documenta en el JSDoc de cada función.

### 2. `views/hogar.html` — la card en dos bloques

Reemplaza el bloque único de [hogar.html:442-469](../../../views/hogar.html).

```
Desequilibrio de aportes

  Gastos compartidos          Tú S/125.54 · Pareja S/50.00
  Tu pareja debería aportar S/37.77 más
  En los próximos gastos compartidos. No es una deuda: se corrige gastando.
  · Registrar pago en efectivo

  Ahorro al hogar             Tú S/55.00 · Pareja S/450.00
  Deberías ahorrar S/197.50 más
  Para igualar el aporte al bote común.

  No se suman: el ahorro vuelve a quien lo puso al disolver.
```

- El link **"Registrar pago en efectivo" va solo en el bloque de gastos** (decisión 2).
- Los estados actuales se conservan **por bloque**: sin pareja → el prompt de invitación
  (una vez, no dos); brecha 0 → "Van igual" con su sub correspondiente.
- La línea final es la defensa contra que los propios usuarios sumen mentalmente. No es
  decorativa: sin ella, dos cifras juntas invitan a restarlas.

### 3. `views/dashboard.html` — dos filas

Reemplaza el cuerpo de `dashDeudaCard` ([dashboard.html:1044-1053](../../../views/dashboard.html)).
Misma estructura, comprimida: dos filas en vez de una, sin montos crudos y sin el link
(decisión 5). Si ambas brechas son 0, "Van igual" una sola vez.

`cargarDesequilibrioHogar` ya se arregló en la Tanda 1 (`3b14633`) para escuchar
`hogar:changed` de forma idempotente. No se vuelve a tocar esa parte.

### 4. `js/hogar-aporte.js` + card "Aporte del mes"

`aporteRealPorMiembro(transacciones, userId, rango)` devuelve hoy un número (gasto+ahorro
sumados). Con `aporte_esperado = 0` en ambos miembros — su estado real — la card degenera
en "Tú S/180.54 · Pareja S/500.00": el mismo general engañoso, por miembro.

Pasa a devolver `{ gasto, ahorro, total }`. La card queda:

```
Tú
S/180.54 de S/300 (60%)          ← el total, contra TU meta
125.54 en gastos · 55.00 en ahorro
```

**El total sí se puede sumar aquí, y no contradice el rechazo del general:** acá cada
miembro se compara contra **su propia meta mensual** (`aporte_esperado` = "cuánto acordamos
poner al hogar al mes"), no contra el otro. Esa suma responde "¿cumplí lo que acordé?", que
no tiene el problema del doble conteo — nadie le debe nada a nadie por no llegar a su meta.
El desglose debajo es lo que evita que dos cifras lado a lado se lean como una carrera.

Con `aporte_esperado = 0`: `S/180.54 (sin meta de aporte) · 125.54 en gastos · 55.00 en ahorro`.

## Pruebas

- **Unitarias (`test/hogar-desequilibrio.test.mjs`):** los 9 tests actuales se re-apuntan a
  `desequilibrioGastoHogar` — mismo comportamiento, nombre nuevo; si alguno cambia de
  resultado, el rename rompió algo. Se suman los de ahorro: brecha simétrica, ignorar
  gastos, ignorar ámbito personal, modo proporcional, y **que `desequilibrioAhorroHogar` no
  acepte `ajustes`** (llamarla con 4 args no debe restar nada).
- **Regresión con datos reales:** un test que fije que, con los montos del hogar real
  (125.54/50.00 y 55.00/450.00), las dos brechas apuntan a **miembros distintos**. Es lo que
  impide que alguien "simplifique" sumándolas en el futuro.
- **Unitarias (`test/hogar-aporte.test.mjs`):** los 5 actuales pasan de comparar un número a
  comparar `.total`, y se suman los de `.gasto` / `.ahorro` por separado.
- **Manual en navegador:** contra la base real, con la cuenta de test en un hogar de prueba
  de 2 miembros (crear, verificar, disolver y borrar la fila huérfana — ver
  `nestra-v2-tanda1-bugs`). Confirmar las dos brechas en `#hogar` y en `#dashboard`, y que
  el pago en efectivo solo mueve la de gasto.

## Fuera de alcance (YAGNI)

- Cualquier cambio a la base o a `disolver_hogar` (decisiones 7 y 8).
- Un "general = gasto + ahorro no devuelto": sería la única suma honesta, pero hoy nada
  distingue ahorro consumido (meta del hogar cumplida) de ahorro parado. Exigiría rastrear
  el destino de cada meta del hogar. Es otra tanda entera y nadie la ha pedido.
- Desequilibrios por periodo (mes en curso). Los dos son históricos completos, igual que
  hoy: es la única variante donde "se autocorrige aportando" converge (Fase 6.3, decisión 6).
- Tocar `graficos.html`. Su chart "Aporte real vs. esperado" sale de una query aparte, no de
  `aporteRealPorMiembro`. Tiene el mismo defecto de sumar gasto+ahorro, pero es otra tanda.
