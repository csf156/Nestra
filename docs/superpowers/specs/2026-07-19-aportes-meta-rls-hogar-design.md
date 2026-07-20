# El progreso de las metas de hogar solo muestra los aportes propios

Fecha: 2026-07-19
Estado: aprobado (diagnóstico + diseño), pendiente de plan de implementación.

## Reporte

El usuario (csf156) reporta que el ahorro que él y su pareja aportaron al hogar
"no se distribuyó" entre las metas del hogar ni el fondo de emergencia del hogar.
Pregunta además cómo se asigna el factor de distribución y cómo se maneja al crear
metas nuevas.

## Diagnóstico (verificado por introspección del esquema y los datos reales)

**El ahorro SÍ se distribuyó.** El motor `distribuir_ahorro` (SECURITY DEFINER)
funciona correctamente: los 5 ahorros de hogar del hogar real
(`5891e9b2-a935-447c-9f83-3ae3a857cd30`) están repartidos al 100% y cuadran:

| Meta | Total real (todos los aportes) |
|---|---|
| Fondo de emergencia | S/ 362.75 |
| Alquiler 🏠 | S/ 192.25 |
| **Suma** | **555.00** (= suma de los 5 ahorros) |

**Lo que falla es la visualización del progreso, no la distribución.** Causa raíz,
en tres capas:

1. La app lee el progreso de metas desde la vista `metas_con_progreso`
   (`js/db.js:686`, `getMetas`). Esa vista calcula
   `monto_actual = COALESCE(SUM(aportes_meta.monto), 0)` vía `LEFT JOIN aportes_meta`.
2. La vista es **`security_invoker=true`** (verificado en `pg_class.reloptions`) →
   corre con la RLS del usuario que consulta, no la del owner.
3. La RLS de `aportes_meta` es una sola policy `aportes_meta_acceso` con
   `cmd = ALL` y `qual = (auth.uid() = user_id)` → **cada usuario solo puede leer
   los aportes cuyo `user_id` es el suyo**.

Consecuencia: en una meta de **hogar** —la única que recibe aportes de más de un
usuario— cada miembro ve como progreso únicamente la suma de SUS propios aportes.

Verificado impersonando por RLS (`set role authenticated` + `request.jwt.claims`)
con la query exacta de la app:

| Meta | Total real | Ve csf156 (42c18…) | Ve la pareja (d83a9…) |
|---|---|---|---|
| Fondo de emergencia | 362.75 | **62.75** | **300.00** |
| Alquiler 🏠 | 192.25 | **42.25** | **150.00** |

Por eso el usuario percibe que su ahorro "no se distribuyó": ve una fracción del
progreso real.

### Por qué el ámbito personal NO tiene este bug

Una meta personal tiene un único contribuyente, así que `auth.uid() = user_id`
muestra el 100% de sus aportes. El bug es **exclusivo del hogar**: es el único
caso donde una meta acumula aportes de varios `user_id`. La intuición "si el
hogar falla, el personal también" no aplica — la causa es precisamente la RLS
multiusuario que solo el hogar ejercita.

### El motor de distribución es correcto (no se toca)

`distribuir_ahorro` es SECURITY DEFINER, así que calcula los pesos y el progreso
(`f_rezago`) sobre TODOS los aportes (ve la tabla completa). Los repartos son
correctos. El fix es puramente de lectura/RLS; no se toca la función ni se
redistribuye nada.

## Referencia: cómo se asigna el factor de distribución (respuesta a la pregunta)

Al registrar un ahorro (que no sea aporte directo), `distribuir_ahorro` reparte:

- **Peso de cada meta** = `importancia × f_horizonte × f_urgencia × f_rezago`
  - `f_horizonte`: corto=3, mediano=2, largo=1
  - `f_urgencia`: <7 días al límite=3, <30 días=2, resto=1
  - `f_rezago`: `greatest(0.2, least(1, 1 − avance))` — más atraso, más peso
  - El **fondo de emergencia** entra con peso = su `importancia` (sin los otros factores)
- Cada meta recibe `monto × peso/Σpesos`, **topado a lo que le falta**. El sobrante
  va al fondo de emergencia.
- **Metas que califican**: `estado='en_curso'` AND `fecha_limite >= hoy` AND
  `monto_objetivo − progreso > 0` AND del mismo ámbito/hogar.
- **Metas nuevas / categorías**: el reparto es por meta, no por categoría (las metas
  no llevan categoría). Una meta nueva de hogar con fecha futura, `en_curso` e
  importancia empieza a recibir su parte del PRÓXIMO ahorro automáticamente. Los
  ahorros pasados no se redistribuyen.

Esto es referencia; no cambia con este trabajo.

## Objetivo

Que el progreso mostrado de una meta de **hogar** sea la suma de los aportes de
TODOS los miembros del hogar, para todos (dueño y co-miembro), sin exponer aportes
de metas personales ajenas ni permitir escritura sobre aportes de otro usuario.

## Diseño del fix

Partir la RLS de `aportes_meta` en policies por comando, espejando exactamente el
patrón que ya usa `metas_select` (propio **OR** del hogar):

- **SELECT**: `auth.uid() = user_id` **OR** el aporte pertenece a una meta de hogar
  del hogar del usuario (`EXISTS` sobre `metas` con `ambito='hogar'` y
  `hogar_id = auth_hogar_id()`).
- **INSERT / UPDATE / DELETE**: siguen restringidos a `auth.uid() = user_id` (sin
  ampliar alcance — un usuario no puede crear/editar/borrar aportes atribuidos a
  otro).

`auth_hogar_id()` ya existe (STABLE SECURITY DEFINER; devuelve el `hogar_id` del
usuario desde `hogar_miembros`) y es el mismo helper que usa `metas_select`.

Un solo cambio de RLS corrige **todos** los puntos de lectura a la vez:
- la vista `metas_con_progreso` (dashboard + `#metas`),
- `getAportesDeMeta` (desglose de aportes de una meta),
- `getAporteMetaMes` (variación mensual del fondo).

### Por qué no otras opciones

- **Quitar `security_invoker` de la vista**: la haría correr como owner (postgres,
  BYPASSRLS) → devolvería metas de TODOS los usuarios. Fuga masiva. Rechazado.
- **Función SECURITY DEFINER paralela para el progreso de hogar**: añade un camino
  duplicado y no arregla `getAportesDeMeta`/`getAporteMetaMes`. Más complejo, menos
  cobertura. Rechazado.

## Alcance / No-objetivos

- **Sin cambios de cliente.** Las queries ya leen `monto_actual`/`aportes_meta`
  correctamente; al ampliar la RLS de lectura, devuelven el total real solos. No
  hay bump de `SHELL_VERSION` (no cambia el app shell). El usuario solo debe
  recargar la app online una vez para refrescar el espejo de IndexedDB.
- **No se toca `distribuir_ahorro`** ni ningún reparto. No se redistribuye ni se
  mueve dinero. Es solo visibilidad de lectura.
- **No se aborda el hueco del path offline** (el ahorro creado sin conexión no
  llama a `distribuir_ahorro` al sincronizar — `db.js:168` solo corre online). Es
  un bug latente aparte, no la causa del síntoma reportado (todos los ahorros
  actuales están repartidos). Queda como follow-up.

## Seguridad / privacidad

Ampliar el SELECT no crea fuga nueva: los co-miembros ya se ven mutuamente las
metas de hogar (`metas_select`) y las transacciones de hogar. Ver los aportes a
una meta **compartida** del hogar es exactamente el modelo de datos deseado. Las
metas personales quedan intactas (el `EXISTS` exige `ambito='hogar'`).

## Verificación (obligatoria antes y después — datos reales de 2 usuarios)

- **RED (antes)**: impersonar a cada miembro (`set role authenticated` +
  `set_config('request.jwt.claims', ...)`) y confirmar que `metas_con_progreso`
  devuelve la fracción por-usuario (Fondo 62.75/300, Alquiler 42.25/150).
- **GREEN (después)**: re-impersonar a ambos → cada uno ve el total completo
  (Fondo 362.75, Alquiler 192.25).
- **Personal intacto**: impersonar un usuario con meta personal → su progreso no
  cambia.
- **Escritura restringida**: intentar insertar un `aporte_meta` con `user_id` ajeno
  como usuario impersonado → rechazado por RLS.
- **PostgREST ve la policy**: un `curl` REST a `metas_con_progreso` como cada
  usuario devuelve el total completo (descarta caché de esquema rancia).
- **Contrato**: correr `supabase/tests/schema_contract_test.sql` → `ALL TESTS PASSED`.
- Aplicar con `apply_migration` (queda registrada), NUNCA por el SQL Editor.
- El `apply_migration` a producción lo ejecuta el orquestador humano/agente
  principal tras la verificación RED, NO un subagente.
