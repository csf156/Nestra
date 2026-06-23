# Ahorro como tipo puro (sin categoría) — Diseño

**Fecha:** 2026-06-23
**Estado:** aprobado (pendiente revisión del spec escrito)

## Problema

El "ahorro" en Nestra v2 tiene un modelo doble y confuso:

- `transacciones.tipo` admite `'ahorro'`, pero la distribución del ahorro entre metas **no** se dispara por `tipo='ahorro'`: se dispara cuando se registra un **gasto en la categoría llamada 'Ahorro'** (`db.js::_distribuirSiAhorro` comprueba `cat.nombre === 'Ahorro'`).
- El formulario, al elegir tipo "Ahorro", carga categorías de **gasto** y obliga a elegir una, lo que no tiene sentido para el usuario.
- En móvil, el botón "Ahorro" del selector de tipo se ve recortado.

El usuario quiere: el ahorro es **solo un tipo de transacción**. Al registrarlo no se pide categoría; el sistema reparte ese ahorro entre las metas **personales** (si el ámbito es personal) o las metas **del hogar** (si el ámbito es hogar). La categoría 'Ahorro' deja de existir.

**Datos actuales (instancia v2):** `tipo` ya admite `'ahorro'`; hay **0** transacciones `tipo='ahorro'` y **0** transacciones en la categoría 'Ahorro' (existe 1 categoría 'Ahorro' sin uso). Migración limpia, sin FKs que romper. (Producción = v1, instancia separada, no afectada.)

## Objetivos

1. Ahorro = tipo puro, sin categoría. Al elegir "Ahorro" el formulario oculta el selector de categoría.
2. Al guardar un ahorro, repartirlo automáticamente entre metas: ámbito personal → metas personales + fondo personal; ámbito hogar → metas del hogar + fondo del hogar.
3. Eliminar la categoría 'Ahorro' y todo el código que la referencia por nombre.
4. Arreglar el botón "Ahorro" recortado en móvil.

## No-objetivos

- No se cambia el flujo de "aporte al hogar" para **gastos** (sigue siendo el par gasto-personal + ingreso-hogar con su `distribuir_aporte_hogar`).
- No se toca `metas.categoria_id` ("categoría para este ahorro" al crear una meta, que pondera la distribución). Eso es correcto y se mantiene.
- No se cambian los cálculos de balance (ya excluyen `tipo='ahorro'` vía `neq('tipo','ahorro')`) ni los contadores de ahorro (`getAhorrosPersonal/Hogar`, ya filtran por `tipo='ahorro'`).

## Arquitectura

### 1. Esquema de base de datos (migración)

`supabase/migrations/20260623_ahorro_tipo.sql`:

- `alter table public.transacciones alter column categoria_id drop not null;`
- CHECK de integridad: una transacción de ahorro no lleva categoría; gasto/ingreso sí.
  ```sql
  alter table public.transacciones drop constraint if exists transacciones_categoria_por_tipo;
  alter table public.transacciones add constraint transacciones_categoria_por_tipo
    check (tipo = 'ahorro' or categoria_id is not null);
  ```
- Borrar la categoría 'Ahorro' (segura: 0 referencias):
  ```sql
  delete from public.categorias where nombre = 'Ahorro' and tipo = 'gasto';
  ```
- Reflejar en `supabase/schema.sql` (y `schema_v2_fresh.sql`): `categoria_id` nullable, el CHECK nuevo, y quitar 'Ahorro' del seed de categorías.

### 2. RPC `distribuir_ahorro(p_transaccion_id)` — generalizar a ámbito

Hoy `distribuir_ahorro` (migración `20260606_metas_automaticas.sql`) reparte solo entre metas **personales** del dueño + fondo personal. Se generaliza para ramificar por `tx.ambito`:

- Carga la transacción; valida que `auth.uid() = tx.user_id` (igual que hoy).
- Determina el conjunto de metas y el fondo según ámbito:
  - `tx.ambito = 'personal'` → metas `ambito='personal' and user_id = tx.user_id`; fondo personal del usuario.
  - `tx.ambito = 'hogar'` → metas `ambito='hogar' and user_id is null`; fondo del hogar.
- El resto de la lógica (pesos por importancia/horizonte/urgencia/rezago, tope por restante, sobrante al fondo, marcar 'lograda', cuadre por redondeo) es idéntica; solo cambian las cláusulas de selección de metas/fondo y la validación.

Se mantiene `distribuir_aporte_hogar(p_aporte_id)` para el flujo de **aporte al hogar de gastos** (sin cambios). `distribuir_ahorro` pasa a cubrir el nuevo camino "ahorro de ámbito hogar".

### 3. RPC `aporte_directo_meta` — refactor

Hoy crea el aporte como **gasto en la categoría 'Ahorro'** (`es_aporte_directo=true`). Al borrar esa categoría, debe crear la transacción como **`tipo='ahorro'`, `categoria_id NULL`**, `es_aporte_directo=true`. Se elimina la búsqueda `where nombre='Ahorro'` y su `raise exception`. El resto (asignar el monto íntegro a la meta, excedente al fondo del ámbito, no disparar reparto por peso) se mantiene. Migración en el mismo archivo.

### 4. Capa de datos `js/db.js`

- `insertTransaccion`: tras insertar, disparar la distribución cuando **`data.tipo === 'ahorro'`** (en vez de `data.tipo === 'gasto'` + categoría 'Ahorro'). Llama `supabase.rpc('distribuir_ahorro', { p_transaccion_id: data.id })`. Best-effort (no revierte la transacción si falla el reparto), igual que hoy.
- Eliminar `_distribuirSiAhorro` (basada en nombre de categoría). Reemplazar por una llamada directa o un helper `_distribuirSiTipoAhorro(tx)` que solo comprueba `tx.tipo === 'ahorro'` y `!tx.es_aporte_directo`.
- `_reDistribuirAhorro(txId, nuevoTipo)`: re-clavar en `tipo === 'ahorro'` (en vez de categoría). Borra aportes previos del tx y redistribuye si el nuevo tipo es 'ahorro'.
- `insertTransaccion`: permitir `categoria_id` ausente/null cuando `tipo==='ahorro'` (la fila ya se arma desde `datos`; asegurar que no fuerza categoría).

### 5. Formulario `views/transaccion.html`

- **Ocultar categoría para ahorro:** al elegir tipo "Ahorro", ocultar todo el grupo `.form-group` de categoría (label + select + mini-form nueva categoría) y NO validar categoría. Para gasto/ingreso, mostrar y validar como hoy.
- **Submit ahorro:** `categoria_id = null`, `tipo='ahorro'`, `ambito` según el toggle. Sin checkbox "aporte al hogar" para ahorro (el ámbito Personal/Hogar decide el destino de las metas). El checkbox de aporte al hogar sigue apareciendo solo para gasto+hogar.
- **Edición:** al editar una transacción de ahorro, el selector de categoría queda oculto; `_reDistribuirAhorro` se llama con el tipo resultante.
- **CSS botón recortado:** en móvil el `.tx-toggle` de 3 botones recorta "Ahorro". Reducir el `gap`/`padding` horizontal de `.tx-toggle-btn` en móvil (o permitir que el ícono se oculte < cierto ancho) para que el texto "Ahorro" entre completo. Verificar a 375px y a ~320px.
- `cargarCategorias`: ya no necesita el caso `tipo==='ahorro' → catTipo='gasto'`; para ahorro no se cargan categorías.

### 6. Limpieza de referencias a la categoría 'Ahorro'

- `views/decisiones.html` (Oráculo): ramas `cat.nombre === 'Ahorro'` (líneas ~216, ~334, ~355) quedan muertas al no existir la categoría. Eliminarlas/simplificarlas. El selector de categoría del Oráculo ya no mostrará 'Ahorro'.
- Verificar que `getResumenMensual.porCategoria`, `alerts.js` (presupuestos/alertas por categoría) y gráficos por categoría **excluyen** ahorro automáticamente (ya filtran `tipo='gasto'`; las transacciones de ahorro tienen `categoria_id NULL` y `tipo='ahorro'`, así que no entran). Confirmar en la implementación, sin cambios esperados.
- Lo que **no** cambia (usa `tipo`, no la categoría): línea "Ahorros" del dashboard, "Ahorro acumulado" en gráficos, badge 'Ahorro' en historial, toggle de tipo, `metas` TIPO_LBL.

## Flujo de datos (ahorro nuevo)

1. Usuario elige tipo "Ahorro", ámbito Personal u Hogar, monto, (nota/fecha). Sin categoría.
2. `insertTransaccion` inserta `{ tipo:'ahorro', categoria_id:null, ambito, monto, ... }`.
3. `db.js` detecta `tipo==='ahorro'` → `rpc('distribuir_ahorro', { p_transaccion_id })`.
4. El RPC reparte el monto entre las metas del ámbito correspondiente (+ fondo), creando filas en `aportes_meta`.
5. Dashboard: la línea "Ahorros" (por `tipo='ahorro'`) y el progreso de metas/fondos reflejan el aporte.

## Manejo de errores

- Distribución best-effort: si `distribuir_ahorro` falla, la transacción de ahorro queda guardada; se loguea el aviso (igual que hoy). El usuario no pierde el registro.
- Offline: el alta de ahorro sigue el patrón outbox de `insertTransaccion`; la distribución (RPC) solo corre online. Al sincronizar, la transacción se sube; **la distribución NO se re-dispara automáticamente desde la outbox** (limitación actual heredada del flujo de ahorro — documentar; igual que el comportamiento previo basado en categoría). Aceptable para esta fase.
- CHECK de tipo/categoría protege integridad a nivel DB.

## Pruebas / verificación

- Unit (si aplica): ninguna lógica pura nueva relevante; la distribución vive en SQL.
- Verificación e2e en preview (cuenta de prueba v2):
  1. Registrar ahorro **personal** → no pide categoría; aparece en "Ahorros"; las metas personales (o el fondo personal) reciben el aporte.
  2. Registrar ahorro **hogar** → se reparte entre metas del hogar + fondo del hogar.
  3. Confirmar que la categoría 'Ahorro' ya no aparece en ningún selector (gasto/Oráculo).
  4. Botón "Ahorro" del tipo se ve completo a 375px y ~320px.
  5. Consola sin errores; balances y "Ahorros" coherentes.

## Migración / despliegue

- Migración aplicada a la instancia **v2** (Supabase MCP). v1 intacta.
- Cambios de código se sirven en la rama `v2` (Cloudflare Pages) para verificación en el teléfono.
