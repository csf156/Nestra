# Teclado numérico en campos de monto

Fecha: 2026-07-18
Estado: aprobado (brainstorming). Cambio mecánico, sin plan aparte.

## Problema

En el teléfono, tocar un campo de monto abre el teclado completo (con letras) en
vez del pad numérico. Fricción en cada captura de gasto.

Causa: 9 inputs numéricos declaran `type="number"` pero no `inputmode`. iOS y
Android usan `inputmode` para decidir qué teclado mostrar; sin él, `type="number"`
por sí solo no garantiza el pad numérico limpio.

La app ya usa el patrón correcto en otros sitios (`views/transaccion.html:143-144`
para el monto principal, `views/onboarding.html`, `views/metas.html`,
`views/brujula.html`, `views/prestamos.html`) — estos 9 quedaron fuera.

## Solución

Añadir `inputmode` a los 9 inputs. **No** se cambia `type="number"`: mantiene la
validación nativa (`min`, `step`) y replica exactamente el patrón que la app ya
usa en el campo de monto principal.

| Archivo | Campo | inputmode |
|---|---|---|
| `views/configuracion.html:54` | Límite de categoría (`cfgCatLimite`) | `decimal` |
| `views/configuracion.html:102` | Monto recurrente (`recMonto`) | `decimal` |
| `views/configuracion.html:106` | Día del mes 1-31 (`recDia`) | `numeric` |
| `views/configuracion.html:289` | Editar límite (`cfgEditLimite`) | `decimal` |
| `views/configuracion.html:1846` | Aporte hogar (`.cfg-hogar-aporte`) | `decimal` |
| `views/configuracion.html:1863` | Límite hogar (`.cfg-hogar-limite`) | `decimal` |
| `views/revisar.html:211` | Monto del pendiente (`revMonto{i}`) | `decimal` |
| `views/revisar.html:327` | Partes de hogar (`.rev-partes-monto`) | `decimal` |
| `views/transaccion.html:894` | Partes del split (`.partes-monto`) | `decimal` |

`recDia` lleva `numeric` y no `decimal` a propósito: es un día del mes (entero),
no admite decimales.

## No-objetivos

- No se migra a `type="text" inputmode="decimal"` (patrón usado en `metas.html` y
  `brujula.html`). Sería más robusto ante rarezas de `type="number"` (rueda del
  ratón cambiando el valor, separador decimal por locale), pero perdería la
  validación nativa y es un cambio de comportamiento mayor que lo que este
  problema pide. Si esas rarezas molestan, es otra tarea.
- No se tocan estilos, lógica ni validación.

## Verificación

En preview, viewport móvil: confirmar por DOM que cada uno de los 9 inputs
reporta el `inputmode` esperado. El teclado en sí lo dibuja el sistema operativo
—no es observable en el navegador de escritorio—, así que se verifica el atributo,
que es lo que lo dispara.

Además, confirmar que no queda ningún `type="number"` sin `inputmode` en
`views/` ni `js/` tras el cambio (salvo falsos positivos por atributo en la
línea siguiente, como `transaccion.html:143`).

## Riesgo

Mínimo. Solo añade un atributo declarativo; no altera validación, envío de
formularios ni estilos.
