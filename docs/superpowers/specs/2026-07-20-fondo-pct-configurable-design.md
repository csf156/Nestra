# Fondo de emergencia: % configurable del ahorro (personal y hogar)

Fecha: 2026-07-20
Estado: aprobado (brainstorming), pendiente de plan de implementación.

## Motivación

El fondo de emergencia es un recurso de largo plazo que se debe alimentar
paulatinamente. Hoy `distribuir_ahorro` le da al fondo su *peso* (= su
`importancia`, compitiendo con las metas) **más todo el sobrante** tras llenar
las metas — puede llevarse una fracción grande de cada ahorro. El usuario quiere
invertirlo: el fondo recibe un **porcentaje bajo configurable** de cada ahorro
general, y las metas se llevan la mayor parte.

Aplica por igual al **fondo personal** (ahorro general personal) y al **fondo de
hogar** (ahorro general del hogar). El % es **configurable dentro de la app**,
por separado para cada fondo.

## Regla acordada

- **Sin metas que califiquen** → el fondo recibe el **100%** (sigue siendo el
  "cajón por defecto" cuando no hay a dónde repartir).
- **Con ≥1 meta** → el fondo recibe su **corte fijo (`pct_fondo/100 × total`) off
  the top**; el resto se reparte entre las metas por el mecanismo de pesos actual,
  topado a lo que le falta a cada una. El **sobrante** de metas topadas también
  cae al fondo (el fondo nunca "pierde" dinero).
- El fondo **deja de competir por peso** en el reparto de metas.
- El % se topa a **0–50** para garantizar que las metas siempre reciban la mayor
  parte (el fondo nunca toma la mayoría). Default **10**.

## Modelo de datos

Nueva columna `metas.pct_fondo_emergencia` (`smallint`, `CHECK (pct_fondo_emergencia
between 0 and 50)`, `default 10`, `not null`). Tiene sentido solo en filas
`es_fondo_emergencia = true`; en el resto queda en su default y se ignora. El %
vive en la propia fila del fondo, así que el fondo personal y el de hogar cada uno
lleva el suyo, y `distribuir_ahorro` ya selecciona esa fila (`v_fondo_id`) — lee el
% de donde ya mira. No se tocan `profiles` ni `hogares`.

Las filas de fondo existentes (personal de cada usuario + el de hogar) reciben el
default 10 al aplicar la migración.

## `distribuir_ahorro` reescrito

Pseudocódigo de la rama de reparto (aplica a personal y hogar por igual; la
selección del fondo por ámbito no cambia):

```
total := tx.monto
fondo := fila del fondo del ámbito (con su pct_fondo_emergencia)
metas := las que califican HOY (es_fondo_emergencia=false, estado='en_curso',
         fecha_limite >= current_date, objetivo - progreso > 0, del ámbito/hogar)

if metas está vacío:
    if fondo existe: insert aporte(fondo, total)
    return

-- hay metas: el fondo ya NO suma peso a suma_pesos
pct   := coalesce(fondo.pct_fondo_emergencia, 10)   -- 0 si no hay fondo
corte := round(total * pct / 100, 2)                -- 0 si no hay fondo
repartible := total - corte
suma_pesos := Σ (importancia × f_horizonte × f_urgencia × f_rezago) de las metas

for meta in metas:
    asignado := round(repartible * peso/suma_pesos, 2)
    if asignado > restante(meta): asignado := restante(meta)
    if asignado > 0: insert aporte(meta, asignado); repartido += asignado

fondo_final := total - repartido    -- = corte + sobrante de metas topadas
if fondo_final > 0 and fondo existe: insert aporte(fondo, fondo_final)
```

`fondo_final = total - repartido` (en vez de calcular el corte por separado como
valor final) garantiza que `repartido + fondo_final = total` exacto — el fondo
absorbe el redondeo. El fondo recibe **al menos** `corte` y a lo sumo `corte +
sobrante`.

Casos borde:
- **Sin fondo pero con metas** (hogar sin fondo, situación pre-existente): `corte=0`,
  las metas reparten todo, el sobrante se pierde. Comportamiento actual, se
  preserva (no es el caso del hogar real, que sí tiene fondo).
- **Rama personal sin fondo**: sigue lanzando excepción como hoy (el fondo personal
  se auto-crea al registrarse; su ausencia es una anomalía).

## RPC nuevo: `set_pct_fondo(p_ambito text, p_pct int)`

Ambos miembros del hogar deben poder ajustar el % del fondo compartido. La RLS de
`metas` solo deja editar al creador (`auth.uid() = user_id`) y ampliarla dejaría
editar *cualquier* campo de *cualquier* meta de hogar — demasiado. En su lugar, un
RPC acotado SECURITY DEFINER, del mismo estilo que `set_aporte_esperado` /
`renombrar_hogar`:

```
set_pct_fondo(p_ambito text, p_pct int) returns void, SECURITY DEFINER:
  - valida p_pct entre 0 y 50 (raise si no).
  - p_ambito='personal':
      update metas set pct_fondo_emergencia = p_pct
      where es_fondo_emergencia and ambito='personal' and user_id = auth.uid();
  - p_ambito='hogar':
      v_hogar := auth_hogar_id();
      if v_hogar is null: raise (no perteneces a un hogar);
      update metas set pct_fondo_emergencia = p_pct
      where es_fondo_emergencia and ambito='hogar' and hogar_id = v_hogar;
  - otro p_ambito → raise.
```

Al ser SECURITY DEFINER + verificación de membresía vía `auth_hogar_id()`, cualquier
miembro del hogar puede setear el % del fondo compartido sin ampliar la RLS de
metas. El personal solo lo toca su dueño.

## Cliente

- `getPctFondo(ambito)` — lee `pct_fondo_emergencia` de la fila del fondo del ámbito.
  **Requiere actualizar la vista `metas_con_progreso`**: hoy lista columnas explícitas
  (`SELECT m.id, m.nombre, …, m.es_fondo_emergencia, COALESCE(sum…)`), NO `m.*`, así que
  la columna nueva NO se propaga sola. La migración debe recrear la vista añadiendo
  `m.pct_fondo_emergencia` al SELECT (conservando `security_invoker=true` — ver el fix de
  RLS del 2026-07-19). Default 10 si falta en el cliente.
- `setPctFondo(ambito, pct)` — llama al RPC `set_pct_fondo` y refetcha metas.
- UI en `#configuración` → sección Preferencias, junto al "Ahorro para metas"
  existente:
  - Fila "Aporte al fondo personal: __%" (siempre).
  - Fila "Aporte al fondo del hogar: __%" — **solo si el usuario pertenece a un
    hogar** (`tieneHogar()`).
  - Input numérico 0–50, mismo patrón que `cfgPctAhorro` (validación, revertir al
    último válido si el input es inválido).
  - Hint que explique: "De cada ahorro general, cuánto va al fondo de emergencia.
    El resto se reparte entre tus metas."

## Migración

Un solo archivo `supabase/migrations/YYYYMMDD_fondo_pct_configurable.sql`:
1. `alter table metas add column pct_fondo_emergencia smallint not null default 10
   check (pct_fondo_emergencia between 0 and 50);`
2. `create or replace view metas_con_progreso` con `security_invoker=true` y
   `m.pct_fondo_emergencia` añadido al SELECT (recrear la vista actual + la columna).
3. `create or replace function distribuir_ahorro(...)` con el algoritmo nuevo.
4. `create function set_pct_fondo(...)` + `grant execute` al rol `authenticated`.

Aplicar con `apply_migration` (queda registrada). El `apply_migration` a producción
lo ejecuta el orquestador humano/agente principal tras la verificación RED, NO un
subagente.

## Verificación (datos reales de 2 usuarios; cuentas/hogar de PRUEBA para mutaciones)

- **Contrato de esquema**: sumar `set_pct_fondo` a la lista de RPCs de
  `supabase/tests/schema_contract_test.sql`, y `metas.pct_fondo_emergencia` a las
  columnas frágiles (el cliente la lee con fallback a 10). Correr → `ALL TESTS PASSED`.
- **Introspección post-migración**: la columna existe con el CHECK y default; el RPC
  `set_pct_fondo` existe; `distribuir_ahorro` tiene el algoritmo nuevo (grep textual
  como el check de aislamiento ya existente).
- **Reparto** (cuenta/hogar de PRUEBA, nunca el hogar real): registrar un ahorro con
  el fondo al 10% y ≥1 meta; verificar que el fondo recibe ~10% + sobrante y las metas
  el resto por peso, y que la suma cuadra al céntimo. Registrar un ahorro sin metas
  que califiquen → el fondo recibe el 100%.
- **RPC de config**: impersonar a cada miembro del hogar (`set role authenticated` +
  jwt claims) y confirmar que ambos pueden llamar `set_pct_fondo('hogar', N)` y que el
  valor cambia; que un no-miembro no puede.
- **UI**: en `#configuración`, ambas filas aparecen (hogar solo con hogar), el input
  respeta 0–50 y persiste.
- `SHELL_VERSION` bump (cambia el app shell: configuración + db.js).

## No-objetivos

- No se redistribuyen ahorros pasados — el cambio aplica a repartos futuros.
- No se toca el mecanismo de pesos de las metas (importancia/horizonte/urgencia/rezago).
- No se toca el % de `pct_ahorro_objetivo` (reserva de safe-to-spend), que es un
  concepto distinto y no relacionado.
- Subsistema B (correcciones de ámbito en gráficos) es un trabajo aparte.
