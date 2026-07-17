# Fase 6.3 (correctiva) — Economía del hogar sin ingresos propios

Fecha: 2026-07-14
Rama: `v2`
Estado: diseño aprobado, pendiente de plan de implementación

## Por qué existe esta fase

El modelo de las Fases 6, 6.1 y 6.2 le da al hogar **ingresos propios**. Es una
ficción: el hogar no genera dinero. Los ingresos son de los miembros; el hogar solo
recibe aportes. Toda la economía del hogar (balance, "quién debe qué", disolución,
reparto proporcional) se apoya en esa ficción, así que esta fase **reemplaza**
supuestos ya en producción. No es aditiva.

### La ficción, medida en producción

Introspección directa de la base v2 (`ombnhxueclqfeyjzhroz`) el 2026-07-14:

| Métrica | Valor |
|---|---|
| hogares / miembros | 1 / 2 |
| `hogar_liquidaciones` | **0 filas, siempre** |
| gastos con `ambito='hogar'` | **0, siempre** |
| ahorros con `ambito='hogar'` | 0 |
| ingresos con `ambito='hogar'` | 3 |
| pares `aporte_id` | 2 (4 filas) |
| metas del hogar | 2 |

Lecturas que esto obliga:

- La maquinaria "quién debe qué" **nunca tuvo datos**. Cero gastos compartidos en
  toda la vida del hogar. No se está reemplazando algo que funcione.
- `hogar_liquidaciones` nunca se usó, y su único otro escritor (`disolver_hogar`)
  inserta una fila que **nadie puede leer jamás**: tras disolver, `auth_hogar_id()`
  devuelve null para ambos y la fila queda fuera de RLS. Es basura write-only.
- De los 3 ingresos-hogar, **uno es huérfano**: S/200 del 22-jun, sin pata de gasto
  personal (nunca salió del bolsillo de su dueño) y sin `aportes_meta` (nunca llegó a
  una meta). El usuario lo registró a mano como "2do aporte" porque el modelo se lo
  permitía. Es la falla conceptual materializada en datos reales.

### Deriva de esquema detectada (bug en vivo, independiente) — RESUELTA

La **Fase 6.2 estaba desplegada en código** (SHELL_VERSION v21) pero **su migración
nunca se aplicó**: en producción no existían `hogares.reparto`,
`categorias.limite_mensual_hogar` ni el RPC `set_reparto_hogar`. Consecuencias
mientras duró:

- El toggle de reparto en Configuración se veía; al usarlo, error.
- El presupuesto del hogar por categoría, sus barras en dashboard y su alerta in-app:
  muertos.
- `dashboard.html:958` y `hogar.html:425` degradaban en silencio vía `|| '50_50'`.

**Cerrada el 2026-07-14 por la tarea paralela (commit c9bddb8).** La migración de 6.2
se recortó a solo `categorias.limite_mensual_hogar` —aplicada y verificada en
producción (columna → grant de tabla → caché de PostgREST → policy
`categorias_update`)— y el selector de reparto se retiró de Configuración hasta esta
fase. Estado que hereda 6.3:

- `categorias.limite_mensual_hogar` **existe** en producción. Fuera de alcance aquí.
- `hogares.reparto` y `set_reparto_hogar` **siguen sin existir**, y ya **nadie más los
  crea**: la 6.2 recortada no los toca. Esta fase es su única dueña, sin carrera con
  ninguna otra migración. Los crea, no los hereda.
- Sobreviven, sin uso, el wrapper `setRepartoHogar` (`js/db.js`) y el parámetro `modo`
  de `calcularBalanceHogar`, conservados para que 6.3 los reutilice. `hogar-balance.js`
  se borra igualmente (ver Arquitectura); el wrapper de `db.js` se re-apunta.

`supabase_migrations.schema_migrations` **no es fiable** en este proyecto (las Fases 6
y 6.1 no figuran pero sí están aplicadas; el fix `20260702` tampoco figura y está
vivo). El esquema introspeccionado es la única verdad. Regla ya documentada en
`CLAUDE.md`.

## Modelo objetivo

### Invariante central

**El dinero vive en los miembros. `ambito` es una etiqueta de propósito, no una
cartera.**

En toda fila de `transacciones`: `user_id` = el miembro de cuyo bolsillo salió (o
entró) el dinero, y `monto` = lo que **ese** miembro puso de verdad.

Corolario: `ambito='hogar' AND tipo='ingreso'` pasa a ser un **estado ilegal**,
blindado con un CHECK para que ninguna vía futura (ingesta de correos, recurrentes,
quick-add, import) resucite la ficción por accidente.

### Los dos flujos de aporte

**1. Gasto compartido.** N filas hermanas, una por miembro que puso dinero, ligadas
por `grupo_id`. `tipo='gasto'`, `ambito='hogar'`. Las partes suman el total.

**2. Ahorro al hogar.** Una fila `tipo='ahorro'`, `ambito='hogar'`, `user_id` =
aportante. `distribuir_ahorro` ya trata ese caso con los pesos actuales
(`importancia × horizonte × urgencia × rezago`, misma selección de metas, mismo fondo
del hogar).

`distribuir_aporte_hogar` era una copia especializada en la pata-ingreso ficticia. Al
morir la ficción, **la función sobra**: se borra, junto con `insertAporteHogar`. Los
pesos de reparto se conservan sin tocarlos, por reutilización.

### El bug de `aporte_directo_meta` no está en `aporte_directo_meta`

Tras el fix `20260702` (aplicado y vivo) ya inserta `ambito` = el de la meta. Lo que
hace que aportar a una meta del hogar no descuente del miembro es el filtro
`.is('hogar_id', null)` en `getSaldoAcumuladoPersonal`, que excluye las filas de hogar
del bolsillo personal. Lo arregla el modelo de filas hermanas (sección Balances), no
un parche a esa RPC.

## Decisiones tomadas

| # | Pregunta | Decisión |
|---|---|---|
| 1 | ¿Qué cuenta como aporte para el desequilibrio? | **Solo gastos compartidos.** El ahorro al hogar queda fuera y se acredita en la disolución por ahorro real aportado. Evita el doble conteo de acreditar al que ahorra tanto en el desequilibrio como en el reparto del bote. |
| 2 | `hogar_liquidaciones` / `saldar_hogar` / botón "Saldar" | **Escape hatch degradado.** Sobreviven, renombrados a "Registrar pago en efectivo" y movidos a un sitio discreto. Restan al desequilibrio. Cubren el caso que "autocorregir gastando" no cubre: zanjar por Yape tras meses desiguales. |
| 3 | ¿Dónde vive el split? | **Filas hermanas por miembro**, ligadas por `grupo_id`. Cada fila dice literalmente lo que ese miembro pagó ⇒ los balances personales salen de sumar filas, sin joins ni casos especiales. |
| 4 | ¿Cómo se escribe la fila de B? | **RPC `security definer`.** La policy de INSERT no se toca. El invariante "las partes suman el total" solo el servidor puede garantizarlo entre filas. |
| 5 | ¿Cuándo se pide el split? | **Siempre visible, prefill 100% al registrante.** Hace el modelo transparente desde el primer gasto. Prefillear con el objetivo (50/50) se **rechazó**: grabaría dinero de B que no se movió y aplanaría el desequilibrio a cero para siempre. |
| 6 | ¿Periodo del desequilibrio? | **Histórico completo, sin reset.** Es la única variante donde "se autocorrige gastando" converge: lo que A puso de más en enero cuenta hasta que B lo iguale. |
| 7 | Base del modo 'proporcional' | **`hogar_miembros.aporte_esperado`** (existe y está aplicado; visible a ambos por RLS; acordado). Fallback 50/50 si ambos son 0, que es el estado actual. |
| 8 | Disolución con desequilibrio abierto | **Reportar ambos por separado**, sin mezclarlos: el bote se reparte por ahorro real, y el desequilibrio de gastos se informa aparte para que lo zanjen fuera. |
| 9 | Fila huérfana de S/200 | **Aporte real**: convertir a ahorro-hogar y repartir a metas. |
| 10 | Brújula en ámbito hogar | **Evaluar contra el bolsillo personal** del que pregunta. |

### Paredes de RLS verificadas (no asumidas)

```
transacciones_insert  with_check: auth.uid() = user_id
transacciones_update  using/with_check: auth.uid() = user_id
transacciones_delete  using: auth.uid() = user_id
profiles_select_propio using: auth.uid() = user_id
hogar_miembros_select using: hogar_id = auth_hogar_id()
```

Tres consecuencias que dirigen el diseño:

1. **A no puede insertar una fila a nombre de B** ⇒ el split necesita RPC
   `security definer`.
2. **A no puede borrar la fila de B** ⇒ borrar un grupo necesita RPC. Sin él, borrar
   una cena dejaría la mitad de B huérfana y las partes dejarían de sumar el total.
3. **El ingreso personal del socio es invisible** ⇒ 'proporcional' no puede pesarse
   por ingresos sin romper el aislamiento owner-scoped. `aporte_esperado` es la única
   base que no requiere romper nada.

## Arquitectura

### Balances (`js/db.js`)

```
saldo personal de A = Σ(ingresos de A) − Σ(gastos de A) − Σ(ahorros de A)
```

Sin filtro de `hogar_id` en ninguna parte: los ingresos ya solo pueden ser personales
(por el CHECK), y los gastos/ahorros cuentan sea cual sea el ámbito, porque el dinero
salió de A. Esto elimina el `.is('hogar_id', null)` que hoy causa el bug del ahorro a
metas del hogar.

```
ahorro del hogar = Σ(transacciones tipo='ahorro' ambito='hogar')
```

Se usa la suma de transacciones, **no** `aportes_meta`: si el hogar no tiene fondo de
emergencia, `distribuir_ahorro` deja el excedente sin asignar (Fase 5) y el bote se
subestimaría.

`getBalanceHogar` (ingresos − gastos) se parte en `getGastosHogar(mes)` y
`getAhorroHogar()`.

### `js/hogar-desequilibrio.js` (nuevo, puro, dual-export)

Reemplaza a `js/hogar-balance.js`, que se borra (su nombre encarna el modelo viejo).

```
calcularDesequilibrioHogar(transacciones, ajustes, uidA, uidB, objetivo)

  pagoA, pagoB = Σ gastos hogar de cada uno (histórico completo)
  objetivoA    = '50_50'        → 0.5
                 'proporcional' → espA / (espA + espB), fallback 0.5 si la suma es 0
  brechaA      = pagoA − objetivoA × (pagoA + pagoB)
  ajuste en efectivo de B→A por m ⇒ brechaA −= m   (B ya compensó m)

  ⇒ { aportaMas, aportaMenos, brecha, pagoA, pagoB, objetivoA }
```

`brecha > 0` para A se lee: **"B debería aportar S/brecha más en los próximos gastos
del hogar"**. Es un objetivo prospectivo, no una deuda a pagar.

`objetivo` recibe los `aporte_esperado` de ambos miembros; la función permanece pura y
determinista (sin lecturas de red), como `safe-to-spend.js` e `insights.js`.

### `repartoDisolucion` se borra

Repartir el bote por % de ahorro real es **la identidad**:
`pot × (ahorroA / (ahorroA + ahorroB)) = ahorroA`. Cada miembro recupera exactamente
lo que puso. No hace falta función.

### `aporteRealPorMiembro` (`js/hogar-aporte.js`)

Se re-basa en **gastos hogar + ahorro hogar** del miembro, aunque el desequilibrio sea
solo-gastos. No es incoherencia: son dos métricas con dos trabajos distintos.
`aporte_esperado` significa "cuánto acordamos poner al hogar al mes" — si un miembro
pone 300 en despensa compartida y 200 en la meta del hogar, puso 500 y cumplió. El
desequilibrio, en cambio, compara solo consumo.

### RPCs nuevos

```sql
registrar_gasto_hogar(p_grupo_id uuid, p_fecha date, p_categoria_id uuid,
                      p_nota text, p_partes jsonb)  -- [{user_id, monto}, ...]
```

Valida: el llamante pertenece a un hogar; **todos** los `user_id` de las partes son
miembros de ese hogar; cada `monto > 0`; la suma de partes es el total. Idempotente
por `p_grupo_id` (el cliente lo genera) ⇒ el replay de la outbox es seguro.

```sql
borrar_gasto_hogar(p_grupo_id uuid)
```

Borra todas las filas hermanas del grupo. Valida que el llamante sea miembro del hogar
del grupo. Necesario porque la policy de DELETE impide que A borre la mitad de B.

### Camino rápido: un solo pagador

Si el editor de partes queda con todo asignado al registrante, se inserta **una fila
con `grupo_id` null** por la vía normal (`insertTransaccion`): offline-first y
editable, como cualquier gasto. Solo los splits reales de ≥2 partes pasan por el RPC.

Las filas con `grupo_id` no son editables desde el historial, y se borran por grupo vía
modal. Es exactamente el precedente que hoy rige para `aporte_id`
(`historial.html:1258`, `historial.html:1146`).

### Offline-first

Entity nueva `gasto_hogar` en la outbox, que replica el RPC. Hay precedente: el
despachador de `js/sync.js` ya tiene tres casos especiales (`recibo`,
`delete_transaccion`, `delete_recurrente`) sobre un upsert por defecto. La
idempotencia por `grupo_id` hace el replay seguro.

## Migración de datos

Afecta a **5 filas**. Reversible. **No se aplica sin revisión manual del SQL por parte
del usuario.**

```sql
-- 0. Respaldo (rollback)
create table _backup_fase63_transacciones as
  select * from transacciones where ambito='hogar' or aporte_id is not null;
create table _backup_fase63_aportes_meta as
  select * from aportes_meta where transaccion_id in (select id from _backup_fase63_transacciones);

-- 1. Pares aporte_id → colapsar en la fila de ahorro.
--    Conserva el id de la pata-ingreso ⇒ aportes_meta.transaccion_id sigue válido
--    y el reparto a metas no se toca.
update transacciones set tipo='ahorro', categoria_id=null, aporte_id=null
 where aporte_id is not null and ambito='hogar' and tipo='ingreso';
delete from transacciones
 where aporte_id is not null and ambito='personal' and tipo='gasto';

-- 2. Fila huérfana (S/200, 22-jun) → ahorro real + repartir a metas
update transacciones set tipo='ahorro', categoria_id=null
 where id = 'a6fe851a-ac7e-4d2f-bd02-8e6ad0ee046d';
select distribuir_ahorro('a6fe851a-ac7e-4d2f-bd02-8e6ad0ee046d');

-- 3. aporte_id queda libre (0 filas lo usan) → se reutiliza como grupo_id
alter table transacciones rename column aporte_id to grupo_id;

-- 4. Blindar la ficción
alter table transacciones add constraint tx_hogar_sin_ingreso
  check (not (ambito = 'hogar' and tipo = 'ingreso'));

-- 5. Columna reparto (no existe en prod: la 6.2 se recortó y ya no la crea;
--    esta fase es su única dueña). Falta aquí el SQL de set_reparto_hogar,
--    de registrar_gasto_hogar / borrar_gasto_hogar y del drop de
--    distribuir_aporte_hogar: los define el plan de implementación.
alter table hogares add column if not exists reparto text not null default '50_50'
  check (reparto in ('50_50','proporcional'));
```

`transacciones_categoria_por_tipo` es `CHECK (tipo='ahorro' OR categoria_id IS NOT
NULL)`: convertir a `ahorro` con `categoria_id=null` es legal. Se anula por convención
(`db.js` ya hace `categoria_id: tipo === 'ahorro' ? null : catId`).

### Efecto visible tras migrar

- Ahorro del hogar: 300 → **500** (entra la huérfana).
- Saldo personal de `d83a...`: **−200**, corrigiendo dinero contado como disponible
  desde junio sin estarlo.
- Ningún otro saldo se mueve: los pares colapsados dan el mismo neto (antes −250 vía
  el gasto personal; después −250 vía el ahorro, que el saldo personal nuevo sí cuenta).

### Rollback

1. `delete from aportes_meta where transaccion_id in (select id from _backup_fase63_transacciones);`
2. `delete from transacciones where id in (select id from _backup_fase63_transacciones);`
3. Reinsertar desde ambas tablas de respaldo.
4. `alter table transacciones drop constraint tx_hogar_sin_ingreso;`
5. `alter table transacciones rename column grupo_id to aporte_id;`

Verificado en local contra una copia de los datos **antes** de tocar producción.

## Ondas expansivas

| Superficie | Cambio |
|---|---|
| `dashboard.html` | Card "Balance del hogar" → **Ahorro del hogar**. Card "quién debe qué" → **Desequilibrio de aportes** (prospectivo). |
| `hogar.html` | Desequilibrio en vez de deuda. "Saldar" → "Registrar pago en efectivo", discreto. Preview de disolución re-basado en ahorro real. |
| `graficos.html` | "Balance del hogar 6m" → gastos del hogar 6m. "Aporte por miembro" re-basado en el split real + ahorro. |
| `resumen.html` | KPI "Aporte al hogar" = mis gastos hogar + mi ahorro hogar. |
| `brujula.html` | Ámbito hogar evalúa contra el bolsillo personal del que pregunta. El ámbito sigue filtrando el historial de la categoría y las metas del colchón. |
| `transaccion.html` | Muere el checkbox "aporte al hogar". Nace el editor de partes (siempre visible, prefill 100% registrante). El aporte de ahorro al hogar pasa a ser `tipo='ahorro'` + `ambito='hogar'`. |
| `configuracion.html` | Crear `hogares.reparto` + `set_reparto_hogar`. **Reponer el selector de reparto**, que la tarea paralela retiró el 2026-07-14 (commit c9bddb8) por apuntar a un RPC inexistente. Texto nuevo: el toggle ya no infiere deuda, define **qué significa igualar**. |
| `disolver_hogar` | Reparte por ahorro real; informa el desequilibrio aparte; deja de insertar la liquidación fantasma que nadie podía leer. |
| `js/db.js` | Borrar `insertAporteHogar`. Re-definir `getBalanceHogar`. Quitar `.is('hogar_id', null)` de los saldos personales. `_serverDeleteTransaccion` pasa a `grupo_id` + RPC. |
| SQL | Borrar `distribuir_aporte_hogar`. Nuevos `registrar_gasto_hogar`, `borrar_gasto_hogar`. Nuevo CHECK. |

### Brújula: por qué se rompía en silencio

`js/brujula.js:10` calcula
`liquidez = max(0, ingresos − gastos − recurrentesPendientes − colchonMetas)`. En
ámbito hogar, `ingresos` sale de `getBalanceHogar`. Al eliminar los ingresos del hogar
eso pasa a ser 0 siempre ⇒ `liquidez = 0` ⇒ la Brújula respondería "no puedes gastar" a
todo, para siempre. Esta onda expansiva **no estaba en el encargo original** y es la
más grave: rompería en silencio una feature en vivo (v21).

Contrapartida aceptada: el colchón de las metas del hogar se descuenta entero de la
liquidez del que pregunta, aunque la meta sea de los dos. Es conservador — dirá "no"
antes de tiempo. Ponderarlo por el objetivo de reparto acoplaría la Brújula al
subsistema de reparto, que hoy no conoce; se descarta por ahora.

## TDD

Tests con datos sintéticos **antes** de escribir implementación.

`tests/hogar-desequilibrio.test.mjs` (nuevo):
- 50/50, uno paga todo → brecha = mitad del total.
- 50/50, pagos iguales → brecha 0.
- Proporcional con `aporte_esperado` dispares.
- Proporcional con ambos `aporte_esperado` a 0 → cae a 50/50.
- Ajuste en efectivo que reduce la brecha.
- Ajuste en efectivo que la invierte (sobre-compensación).
- Sin gastos del hogar → brecha 0, sin división por cero.
- Filas de ahorro-hogar presentes → **no** afectan la brecha (decisión #1).
- Filas personales presentes → ignoradas.

`tests/hogar-partes.test.mjs` (nuevo): validador puro de partes previo al RPC —
suma = total, montos > 0, sin `user_id` repetidos, tolerancia de redondeo a 2
decimales.

`tests/hogar-aporte.test.mjs`: reescrito para gastos hogar + ahorro hogar.

`tests/hogar-balance.test.mjs`: se borra con su módulo.

## Guardarraíles

- Rama `v2`.
- **Ninguna migración se aplica a producción sin revisión del SQL por el usuario.**
  Datos reales de 2 usuarios.
- Convenciones: IIFE, `var`, `escHtml`, dual-export, hash-routing, estilo editorial
  dark (champagne `#c9a84c`).
- Al cerrar: review holístico + verificación con 2 cuentas + bump de `SHELL_VERSION`
  antes del push a `v2` (Cloudflare Pages despliega solo).

## Fuera de alcance

- La parte de **presupuestos** de la Fase 6.2 (`categorias.limite_mensual_hogar`):
  ortogonal a la economía del hogar. **Ya cerrada** por la tarea paralela el
  2026-07-14 (commit c9bddb8): columna aplicada y verificada en producción.
- Hogares de más de 2 miembros. El cap de 2 lo garantiza `trg_hogar_cap`. El modelo de
  filas hermanas y `p_partes jsonb` ya son N-miembros por construcción, pero no se
  diseña ni se prueba para N > 2 aquí.
- Salida individual de un miembro sin disolver el hogar. Hoy no existe: la única acción
  es "Salir / disolver hogar" → `disolver_hogar()`.
