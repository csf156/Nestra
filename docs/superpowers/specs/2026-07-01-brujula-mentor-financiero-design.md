# Brújula — mentor financiero (rediseño del Oráculo)

**Fecha:** 2026-07-01
**Estado:** diseño aprobado, pendiente plan de implementación
**Reemplaza:** el apartado "Oráculo" (`views/decisiones.html`)

## Problema

El Oráculo actual es un *validador reactivo*: el usuario trae un monto y una categoría,
y responde "cabe / no cabe" contra el presupuesto de esa categoría (`categorias.limite_mensual`).

Dos debilidades:
1. **Exige saber el monto de antemano.** El usuario a menudo solo tiene una *intención*
   ("quiero una pieza nueva para la bici") sin monto exacto — hay variedad de precios en el mercado.
2. **Mira solo el margen de la categoría**, casi lo mismo que ya muestra el dashboard. Poco valor añadido.

## Concepto

Convertir el apartado de *validador* a *mentor*: se llama **Brújula**. El usuario trae una
intención (categoría, con monto opcional) y la Brújula lo orienta, considerando la imagen
financiera completa y ofreciendo acciones, no solo veredictos.

Cambio de nombre: "oráculo" *predice*; un mentor *aconseja y acompaña*. "Brújula" comunica
dirección/guía y encaja con la identidad de Nestra (hogar, rumbo).

## Capacidades (las 4 aprobadas)

1. **¿Cuánto puedo gastar?** — eliges categoría sin monto → rango **cómodo→tope**.
2. **Simular compra grande** — si tu compra supera el tope → convertir en meta con aporte/mes sugerido.
3. **Freno anti-impulso** — en categorías no esenciales, añade costo de oportunidad + espera 48h.
4. **Micro-ahorro hacia meta** — proactivo (dashboard): "aparta S/X y llegas antes" + acción de 1 toque.

## Presencia

Reactivo **+** proactivo:
- **Reactivo:** su propia pestaña (Brújula), donde consultas antes de gastar.
- **Proactivo:** tarjeta de micro-ahorro en el dashboard cuando hay una meta en curso y liquidez disponible.

## Flujo principal (reactivo)

Una sola pantalla que se adapta al input:

1. Usuario elige **categoría** (chips de favoritas, como hoy) + **ámbito** (hogar/personal).
2. Campo de **monto opcional**. Placeholder: "Monto (opcional — no sé cuánto)".
3. Al consultar, la Brújula responde según lo que se dio:

| Input | Respuesta |
|---|---|
| **Sin monto** | Rango cómodo→tope de la categoría. "Puedes gastar tranquilo hasta S/{cómodo}; tu tope este mes es S/{tope}." |
| **Monto ≤ cómodo** | "Adelante" (nivel recomendable). |
| **cómodo < Monto ≤ tope** | "Cabe, con cautela" + razón (ritmo o metas). |
| **Monto > tope** | "No cabe este mes" → plan: convertir en meta (botón). |

## Cálculo del rango cómodo→tope

Lógica pura en `js/brujula.js`, función `calcularRango(monto, metricas, categoria)`.

Métricas de entrada (recolectadas por la vista, mismas fuentes que hoy + recurrentes):
- `limite` = `categoria.limite_mensual` (puede ser null)
- `gastoMes` = gasto de la categoría en el mes (ámbito dado)
- `ingresos`, `gastos` = balance del mes (ámbito)
- `recurrentesPendientes` = suma de `recurrentes.monto` activos con `proximo_cargo` en lo que resta del mes
- `colchonMetas` = suma prorrateada de faltantes de metas en curso (misma fórmula que el Oráculo actual)
- `gastoSemana`, `diasSemana`, `diasMes`, `diaHoy` = para el factor de ritmo

Definiciones:

```
margenCategoria = max(0, limite - gastoMes)          // solo si limite != null
liquidezMes     = max(0, ingresos - gastos - recurrentesPendientes - colchonMetas)

tope   = (limite != null) ? min(margenCategoria, liquidezMes) : liquidezMes
ritmoRapido = (gastoSemana / max(diasSemana,1)) * 7 > (limite * 7 / diasMes)   // solo si limite != null
comodo = ritmoRapido ? round(tope * 0.7) : tope
```

Notas:
- **Sin presupuesto de categoría** (`limite == null`): ya NO bloquea. Cae a `tope = liquidezMes`,
  `comodo = tope` (sin factor de ritmo por categoría). La tarjeta lo indica y ofrece fijar presupuesto como mejora opcional.
- Si `tope == 0` (sin liquidez): veredicto "sin margen este mes" + sugerencia de esperar / revisar recurrentes.
- Todos los montos que se muestran pasan por `formatMonto`.

## Simular compra grande (convertir en meta)

Cuando `monto > tope`: la Brújula calcula un plan de ahorro y ofrece crear una meta.

```
faltante  = monto - tope           // lo que no cubre este mes
mesesPlan = 3                       // horizonte por defecto (ajustable en el futuro)
aporteMes = ceil(monto / mesesPlan)
fechaMeta = primer día del mes actual + mesesPlan meses
```

Botón "Crear meta" → `insertMeta({ nombre: categoria.nombre, monto_objetivo: monto,
fecha_limite: fechaMeta, ambito, ... })`. Requiere conexión (ver Offline).

## Freno anti-impulso

Aplica cuando `categoria.esencial === false` y el veredicto es cautela o no-cabe:
- Añade una línea de costo de oportunidad: "Esto equivale a {n} aporte(s) a {metaCrítica}."
  donde `n = round(monto / aporteTípico)` y `aporteTípico` = aporte mensual sugerido de la meta más cercana.
- Añade invitación textual: "¿Es necesario ahora? Dale 48 h."
- No bloquea; es un empujón.

**Modelo de datos:** nuevo campo `categorias.esencial boolean not null default true`. Toggle
en Configuración (sección Categorías). Categorías globales (`user_id null`) comparten el flag.

## Micro-ahorro (proactivo, dashboard)

Componente independiente (`js/brujula.js` expone `sugerirMicroahorro(metas, liquidez, hoy)`):
- Se muestra si hay ≥1 meta en curso y `liquidezMes > 0`.
- Elige la meta más cercana a su fecha límite. Sugiere un micro-aporte
  `sugerido = min(round(liquidezMes * 0.1), faltanteMeta)` (tope 10% de la liquidez, sin pasarse del faltante).
- Copy: "Aparta S/{sugerido} y llegas a {meta} {X} antes." donde X se estima con la fórmula de aceleración.
- Botón de 1 toque → `insertAporteDirecto(meta_id, sugerido)`. Requiere conexión.

La tarjeta vive en el dashboard (`views/dashboard.html` o donde se renderiza el home), no en la pestaña Brújula.

## Offline

`insertMeta` e `insertAporteDirecto` usan RPC y exigen conexión. Cuando `!navigator.onLine`:
- Los botones "Crear meta" y "Aparta S/X" se muestran **deshabilitados** con texto de ayuda
  "Necesitas conexión para esto." Sin encolar en outbox (coherente con cómo Nestra ya trata estos RPC).
- El resto de la Brújula (consulta de rango, veredictos) funciona offline: usa `getGastoCategoria`,
  `getBalance*`, `getMetas` que ya son espejados/offline-safe.

## Arquitectura de código

**Separación lógica/UI.** Hoy toda la lógica del Oráculo vive inline en `decisiones.html`
(difícil de testear). El rediseño la extrae:

- **`js/brujula.js` (nuevo)** — funciones puras, sin DOM ni red, testeables con node:
  - `calcularRango(monto, metricas, categoria)` → `{ nivel, comodo, tope, razon, sugerido }`
  - `planMeta(monto, tope, hoy)` → `{ faltante, aporteMes, fechaMeta }`
  - `costoOportunidad(monto, metaCritica)` → `{ n, texto }` (o null si categoría esencial)
  - `sugerirMicroahorro(metas, liquidezMes, hoy)` → `{ meta, sugerido, texto }` o null
- **`views/brujula.html`** — refactor de `decisiones.html`: recolección de métricas (DOM + db.js),
  render de veredicto/rango/plan, wiring de botones. Importa `js/brujula.js`.
- **`js/db.js`** — reusar `getGastoCategoria`, `getBalanceHogar/Personal`, `getMetas`,
  `getCategoriasFavoritas`, `insertMeta`, `insertAporteDirecto`. Añadir lectura de recurrentes
  pendientes del mes si no existe un helper (evaluar `getRecurrentes` + filtro en cliente).
- **`js/router.js` + nav** — renombrar ruta/label `decisiones` → `brujula` (mantener redirección
  del hash viejo si aplica). Actualizar precache en `sw.js` y bump `SHELL_VERSION`.
- **Migración** — `categorias.esencial boolean not null default true` + toggle en `configuracion.html`.

## Testing

- `js/brujula.test.*` (node, mismo patrón que `detectors.test.ts` / recurrentes): tabla de casos
  para `calcularRango` (sin monto, ≤cómodo, banda cautela, >tope, sin presupuesto, sin liquidez,
  ritmo rápido), `planMeta`, `costoOportunidad` (esencial vs no), `sugerirMicroahorro` (con/sin meta,
  tope 10%, sin pasar faltante).
- Verificación en preview: consultar con y sin monto, provocar el estado "convertir en meta",
  confirmar que los botones se deshabilitan offline.

## Fuera de alcance (por ahora)

- Horizonte de plan de meta configurable (fijo en 3 meses).
- Reto de micro-ahorro con racha/seguimiento (se eligió la variante de 1 toque, no la gamificada).
- Encolar aportes/metas en outbox offline (se eligió deshabilitar + avisar).
- Historial de consultas a la Brújula.
