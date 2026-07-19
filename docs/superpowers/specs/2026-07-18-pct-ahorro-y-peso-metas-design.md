# % de ahorro configurable y transparencia del peso de metas

Fecha: 2026-07-18
Estado: aprobado (brainstorming).

## Contexto: lo que el código realmente hace

Antes de diseñar se introspeccionó `distribuir_ahorro` (no se asumió). Dos
creencias previas resultaron falsas:

**La categoría NO afecta el reparto.** `metas.categoria_id` existe, la UI la
pide al crear una meta (`views/metas.html:498`) y la muestra (259-262), pero
`distribuir_ahorro` la ignora por completo. Es decorativa.

**La fórmula real tiene cuatro factores, no dos:**

```
peso = importancia × f_horizonte × f_urgencia × f_rezago

importancia   columna de metas, 1–5, DEFAULT 3, no expuesta en la UI
f_horizonte   corto=3, mediano=2, largo=1
f_urgencia    (fecha_limite − hoy) < 7d → 3;  < 30d → 2;  resto → 1
f_rezago      max(0.2, min(1, 1 − progreso/objetivo))   más peso si va atrasada
```

**No hay "recálculo" de pesos al crear una meta nueva, y no hace falta.** Los
pesos se computan de cero en cada llamada a `distribuir_ahorro`, y el reparto
es relativo (`asignado = total × peso / suma_pesos`). Al añadir una meta, la
suma crece y todas las porciones se reajustan solas en el **siguiente** aporte.
Los aportes pasados quedan intactos, con su `peso_aplicado` guardado como
auditoría. Ese diseño ya es correcto.

**Fondo de emergencia:** participa pero distinto. Su peso es solo
`importancia` (sin horizonte/urgencia/rezago) y **recibe el residuo**
(`total − repartido`), no su cuota directa. Si ninguna meta topa contra su
objetivo, el residuo equivale exactamente a su cuota proporcional; si alguna
topa, el sobrante cae al fondo. Coherente, se deja como está.

## Objetivos

1. Que el usuario pueda definir **qué % de su dinero disponible se destina a
   ahorro**, hoy fijo en 50% (PR #17), y que ese mismo valor sirva de objetivo
   visible.
2. Que el reparto entre metas **deje de ser una caja negra**: explicar en la UI
   cómo se calcula el peso, sin cambiar la fórmula.

## No-objetivos (decisión del usuario)

- **No se toca la fórmula de reparto.** Ni se añade un factor por categoría, ni
  se expone `importancia` en la UI. Solo se documenta lo que ya hace.
- No se toca el fondo de emergencia ni su lógica de residuo.
- No se toca `distribuir_ahorro` (el RPC no cambia).

## 1. Un único % configurable

**Dónde vive:** nueva columna `profiles.pct_ahorro_objetivo integer`, **default
50** — el mismo valor que hoy está hardcodeado, así ningún usuario existente ve
un cambio de comportamiento al desplegar.

No se reutiliza `profiles.aporte_mensual_esperado` (existe pero **no se usa en
ningún sitio** — verificado por grep): es un monto, no un porcentaje, y
reaprovecharlo con otra semántica dejaría un nombre que miente.

**Rango permitido: 0–80%**, con CHECK en la base. El 0 es válido (no reservar
nada para metas). El tope de 80 evita dejar el disponible en casi cero por un
dedazo; no es una restricción financiera sino una guarda de usabilidad.

**Dónde se configura:** sección **Preferencias** de `#configuracion` (junto a
moneda y notificaciones, que son las otras preferencias de perfil). Sigue el
patrón de `js/moneda.js`: cache local + `updateProfile` + evento global.

**Qué controla (los dos usos, un solo valor):**

- *Techo de reserva*: en `calcularSafeToSpend`, `techoMetas = max(0, ingreso −
  fijos) × (pct/100)` en vez del `0.5` fijo.
- *Objetivo visible*: el desglose de la card nombra el tope aplicado, p. ej.
  "− Ahorro para tus metas (tope 30%)", para que el número deje de aparecer sin
  contexto.

**Cómo llega al cálculo:** `calcularSafeToSpend(transacciones, metas, { hoy,
pctAhorro })`. Se pasa como **insumo explícito**, igual que se hizo con el
ingreso en el fix anterior — la función sigue siendo pura y testeable.
Si `pctAhorro` viene ausente o inválido, cae a 50 (comportamiento actual).
`cargarSafeToSpend()` (la parte impura) lo lee del perfil.

## 2. Explicar el peso en #metas

En `views/metas.html`, un desplegable "¿Cómo se reparte mi ahorro?" (cerrado por
defecto, mismo patrón que el desglose de la card del dashboard) que explique en
lenguaje llano:

- El aporte se reparte entre tus metas en curso según un peso.
- El peso sube si: el horizonte es corto, la fecha límite está cerca, o la meta
  va atrasada respecto a su objetivo.
- El fondo de emergencia recibe lo que quede sin asignar.
- **La categoría de la meta no afecta el reparto** — es solo una etiqueta.

Ese último punto se dice explícitamente porque la UI pide una categoría al
crear la meta, lo que induce a creer que influye. Callarlo mantendría el
malentendido que originó esta tarea.

No se muestran los números crudos del peso por meta: son un producto de cuatro
factores sin unidad, y exponerlos invita a comparar cifras que no significan
nada por separado. Se explica el *criterio*, no la aritmética.

## Verificación

**Tests (hay runner real, `node --test`):**
- `pctAhorro` explícito cambia el techo: con 500 de ingreso y una meta que
  exige de más, pct=20 reserva 100; pct=50 reserva 250.
- `pctAhorro` ausente o inválido (null, 0/'x', >100, negativo) → cae a 50 y no
  rompe.
- `pctAhorro = 0` → reserva 0, disponible = ingreso − fijos (caso límite real,
  no un error).
- Los 26 tests actuales de safe-to-spend siguen verdes.

**Base:** tras aplicar la migración, verificar por introspección la columna, su
default y su CHECK; que el grant sea de tabla; que PostgREST la vea; y correr
`supabase/tests/schema_contract_test.sql` (`ALL TESTS PASSED`).

**Preview** (cuenta throwaway, nunca la real): cambiar el % en Preferencias
persiste y la card recalcula; el desglose muestra el tope aplicado; el
desplegable de #metas abre y se lee bien en móvil.

## Archivos afectados

- `supabase/migrations/<fecha>_pct_ahorro_objetivo.sql` — columna + CHECK (el
  usuario revisa el SQL antes de aplicar; hay datos reales de 2 usuarios).
- `supabase/tests/schema_contract_test.sql` — cubrir la columna nueva.
- `js/safe-to-spend.js` — `pctAhorro` como insumo; techo parametrizado.
- `test/safe-to-spend.test.mjs` — tests del punto anterior.
- `js/db.js` — leer/escribir la preferencia (patrón `updateProfile`).
- `views/configuracion.html` — control en Preferencias.
- `views/dashboard.html` — nombrar el tope en el desglose.
- `views/metas.html` — desplegable explicativo del reparto.

Sin cambios en `distribuir_ahorro` ni en el esquema de `metas`.
