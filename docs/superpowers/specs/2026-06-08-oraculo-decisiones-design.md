# Design: Oráculo Financiero Consultivo (decisiones.html)

**Date:** 2026-06-08
**Status:** Approved (pending spec review)
**Scope:** Vista `views/decisiones.html` — un asistente que responde "¿puedo gastar S/ X en [categoría]?" con un veredicto razonado, más un estado general de salud financiera. No incluye `metas.html` (CRUD estándar, spec aparte).

---

## Context

Sesión 7 = Metas y Decisiones. La ruta `decisiones` ya existe en `js/router.js`. El proyecto es vanilla JS; las vistas consumen `js/db.js` (nunca Supabase directo). Esquema relevante: `categorias.limite_mensual` (NULL = sin presupuesto), `metas_con_progreso` (monto_objetivo, monto_actual, fecha_limite, ambito, es_fondo_emergencia), `transacciones` (fecha, monto, tipo, categoria_id, ambito). La categoría de ahorro se identifica por `nombre === 'Ahorro'` (igual que `_distribuirSiAhorro` en db.js).

---

## Goal

Un "oráculo" que ante la pregunta *"¿puedo gastar S/ X en [categoría]?"* devuelve **Recomendable / Con cautela / No recomendable**, explica el porqué, ofrece un **monto alternativo sugerido**, y muestra el impacto en presupuesto y metas. Además, un **estado general del hogar** sin consulta puntual.

---

## Decisiones de diseño (confirmadas)

1. **Doble modo:** consulta puntual por categoría **+** estado general del hogar.
2. **Semana = lunes a domingo**, anclada a hora local Perú (UTC-5), consistente con `getAporteMetaMes`.
3. **Sin presupuesto → bloqueo suave:** si la categoría tiene `limite_mensual NULL`, el veredicto es "Fija un presupuesto primero" (CTA a configuración), no un cálculo. **Excepción:** categoría **Ahorro**.
4. **Ámbito personal y hogar:** el oráculo opera en ambos; el colchón de metas usa `getMetas(ambito)` correspondiente.
5. **Excepción Ahorro (opción A):** gastar en la categoría `Ahorro` se trata como **aporte/positivo** — nunca pide presupuesto y el veredicto siempre favorece (estás ahorrando, no consumiendo).

---

## Modos

### Modo 1 — Consulta puntual

Inputs del usuario: **monto** (X), **categoría**, **ámbito** (personal/hogar).
Output: tarjeta de veredicto + desglose.

### Modo 2 — Estado general del hogar

Sin inputs. Agrega señales del mes: categorías sobre/cerca del límite, ritmo semanal, metas en riesgo → un veredicto de salud global (**Sano / Ajustado / En riesgo**) con los 2-3 focos principales.

---

## Capa de datos

Funciones existentes de db.js + helpers nuevos.

| Dato | Fuente | Nota |
|---|---|---|
| Presupuesto de categoría | `getCategorias('gasto')` → `limite_mensual` | NULL → bloqueo suave (salvo Ahorro) |
| Gasto real del mes (categoría) | `getTransacciones({ categoria_id, ambito, tipo:'gasto', fecha_desde:<1er día mes>, fecha_hasta:<hoy> })` → suma | acumulado mes-a-la-fecha |
| Gasto de la semana (categoría) | mismo query con `fecha_desde:<lunes>` | requiere `_rangoSemana()` |
| Ingreso/gasto del mes | `getBalanceHogar(mes,anio)` o `getBalancePersonal(mes,anio)` según ámbito | base del colchón |
| Metas pendientes | `getMetas(ambito)` filtrado `monto_actual < monto_objetivo` | compromiso de ahorro |
| Identificar Ahorro | categoría con `nombre === 'Ahorro'` | excepción |

### Helpers nuevos en db.js

```
_rangoSemana(hoy?) → { desde, hasta }
  Lunes 00:00 de la semana actual → hoy (o domingo). Formato 'YYYY-MM-DD'.
  Ancla a hora local; semana ISO (lunes primer día).

getGastoCategoria(categoria_id, ambito, fecha_desde, fecha_hasta) → number
  Suma de gastos de una categoría en el rango. (Envuelve getTransacciones + suma;
  evita repetir la lógica en la vista.)
```

> Alternativa considerada: derivar la suma en la vista con `getTransacciones`. Se prefiere un helper en db.js para mantener la vista libre de lógica de agregación y reutilizable por el estado general (que suma varias categorías).

---

## Algoritmo — "Gasto Máximo Sugerido" (JS, en la vista)

Para una consulta (monto X, categoría, ámbito). Toma el límite **más conservador**.

1. **Excepción Ahorro:** si categoría es `Ahorro` → veredicto **Recomendable** ("Estás ahorrando"), fin.
2. **Bloqueo suave:** si `limite_mensual` es NULL → veredicto **Fija-presupuesto** (CTA), fin.
3. **Margen categoría** = `limite_mensual − gasto_real_mes`.
4. **Días restantes del mes** = `días_del_mes − día_hoy + 1`. **Ritmo diario permitido** = `margen_categoria / días_restantes`.
5. **Ritmo semanal real** = `gasto_semana / días_transcurridos_semana` (lunes→hoy). **Objetivo semanal** = `limite_mensual × 7 / días_del_mes`. Señal de aceleración = `ritmo_semanal × 7 > objetivo_semanal`.
6. **Colchón de metas** = Σ por meta pendiente del ámbito: `faltante / max(meses_hasta_fecha_limite, 1)`. (metas sin fecha → se omiten del colchón duro.) = ahorro mensual comprometido.
7. **Disponible libre** = `ingresos_mes − gastos_mes − colchón_metas` (del ámbito).
8. **Sugerido** = `max(0, min(margen_categoria, disponible_libre))`. El ritmo NO es tope duro — informa la banda "Con cautela".

### Veredicto

| Condición | Veredicto |
|---|---|
| categoría = Ahorro | **Recomendable** (aporte) |
| `limite_mensual` NULL (no Ahorro) | **Fija un presupuesto primero** |
| `X > margen_categoria` **o** `X` invade el colchón de metas (`gastos_mes + X > ingresos_mes − colchón_metas`) | **No recomendable** (nombra la meta/límite afectado) |
| `X ≤ sugerido` **y** la compra dispara la señal de aceleración semanal | **Con cautela** (cabe, pero vas rápido esta semana) |
| `X ≤ sugerido` | **Recomendable** |

> Orden de evaluación: Ahorro → sin-presupuesto → No recomendable → Con cautela → Recomendable. El primero que aplica gana.

`monto alternativo` mostrado = `sugerido` (redondeado a la baja).

### Estado general (Modo 2)

Por cada categoría con `limite_mensual`: calcular `% usado` del mes. Señales:
- categorías `> 100%` → en rojo; `80–100%` → ámbar.
- ritmo semanal del hogar vs `1/4` del presupuesto total.
- metas con `meses_hasta_fecha_limite` insuficientes para el faltante al ritmo actual → "en riesgo".

Salud global = peor señal dominante: **Sano** (todo verde), **Ajustado** (alguna ámbar), **En riesgo** (alguna roja o meta en riesgo). Mostrar los 2-3 focos.

---

## UI móvil (mobile-first)

Estructura: formulario de consulta arriba (monto, categoría, ámbito) → al consultar, **tarjeta de veredicto** grande (color de fondo = semáforo) → **desglose colapsable**. Aparte, una sección/tab para el **estado general**.

### Reacción por veredicto

- **Recomendable** 🟢: fondo verde suave, ✓, mensaje afirmativo ("Adelante. Te quedan S/ N este mes en [cat]."). Desglose opcional.
- **Con cautela** 🟡: ámbar, "Cabe, pero vas rápido esta semana." Muestra ritmo semanal + monto sugerido.
- **No recomendable** 🔴: rojo, ⚠, causa concreta ("supera tu presupuesto de [cat] por S/ N" / "retrasaría tu meta [X]"), **monto alternativo** sugerido, y opción "esperar N días". Botón secundario **"registrar igual"** (informa, no bloquea — abre el modal de transacción).
- **Fija-presupuesto** ⚙️: neutro, "Define un presupuesto para [cat] y te puedo aconsejar." CTA a configuración de categorías.

Mobile-first: una columna, tarjeta de veredicto a ancho completo, tap targets ≥44px, desglose en `<details>` o acordeón. Respeta `prefers-reduced-motion`. Modo oscuro/claro vía custom properties.

### Patrones UI/UX (guía de diseño aplicada)

> La skill `ui-ux-pro-max` está en modo catálogo (sin librería de patrones instalada); se aplica guía de diseño por defecto.

1. **Jerarquía del veredicto** (la tarjeta es el elemento héroe). Peso visual descendente: (1) palabra de veredicto + ícono — lo más grande; (2) razón en lenguaje plano, una línea; (3) el número clave (margen restante o sugerido); (4) desglose colapsable. Lidera con la respuesta humana, no con cifras.
2. **Microcopy de confianza.** Segunda persona, tono asesor. Sentence case, **nunca MAYÚSCULAS** (evita sensación de alarma). "Te alcanza" en vez de "APROBADO". Causa concreta y cuantificada ("usarías el 95% de tu presupuesto de Comida").
3. **Feedback emocional sin alarmismo.** No recomendable **nunca culpa**: encuadre protector ("esto retrasaría tu meta [X]") + siempre una salida (monto alternativo / esperar N días). Ícono ⚠ a tamaño moderado, rojo apagado (tinte, no saturado pleno). Con cautela = "aviso", no "advertencia".
4. **Accesibilidad del color.** El veredicto **nunca se comunica solo por color**: siempre ícono + etiqueta de texto. Fondo = tinte sutil del color semáforo con texto de alto contraste (≥4.5:1). Región del veredicto con `aria-live="polite"` para que lectores de pantalla anuncien el resultado.
5. **Form UX.** Monto con prefijo `S/` e `inputmode="decimal"` (teclado numérico en móvil). Categoría = `<select>` nativo. Ámbito = el mismo toggle segmentado de `graficos.html` (consistencia entre vistas). Al consultar, el resultado hace scroll-into-view y recibe foco.
6. **Estado general** = banner compacto (tratamiento visual distinto a la tarjeta de consulta para no confundir los dos modos), con los 2-3 focos como lista breve.
7. **"Registrar igual"** = botón fantasma (bajo énfasis), ubicado después del monto alternativo, para que el camino recomendado quede primario.

---

## Manejo de errores

| Escenario | Comportamiento |
|---|---|
| db.js devuelve [] / ceros (fallo de red) | El cálculo trata como sin datos → veredicto neutro "No hay datos suficientes este mes" |
| Categoría sin gastos previos | margen = límite completo; cálculo normal |
| Meta sin `fecha_limite` | se excluye del colchón duro (o ritmo histórico); documentado |
| Mes sin ingresos registrados | `disponible_libre` puede ser ≤ 0 → empuja a "Con cautela/No recomendable"; mensaje lo explica |

---

## Out of Scope

- `metas.html` (CRUD de metas) — spec/companion aparte en la misma sesión.
- Persistir histórico de consultas al oráculo.
- Aprendizaje/predicción (ML); el oráculo es determinista por reglas.
- Notificaciones push de alertas de presupuesto.

---

## Verificación (navegador, sin framework de tests)

- [ ] Consulta con categoría con presupuesto → veredicto correcto según monto (3 niveles)
- [ ] Categoría sin `limite_mensual` → "Fija un presupuesto primero" + CTA
- [ ] Categoría Ahorro → siempre Recomendable, sin pedir presupuesto
- [ ] Colchón de metas reduce el sugerido cuando hay metas hogar/personal pendientes
- [ ] Estado general clasifica Sano/Ajustado/En riesgo según presupuestos del mes
- [ ] `_rangoSemana` devuelve lunes→hoy correctamente (incluido cruce de mes)
- [ ] Móvil: tarjeta de veredicto a ancho completo, colores por veredicto, "registrar igual" abre modal
- [ ] Personal y hogar producen colchones distintos según `getMetas(ambito)`
