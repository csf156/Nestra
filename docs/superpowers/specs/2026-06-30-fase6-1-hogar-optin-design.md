# Fase 6.1 — Hogar opt-in: gating + #hogar útil + scaffold de config (diseño)

> Continuación de Fase 6 (hogar compartido). La Fase 6 dejó el UI de "ámbito hogar"
> visible siempre (herencia de v1, donde el hogar estaba hard-coded). Esta fase lo
> convierte en **opt-in real**: nada de "hogar" se muestra hasta crear/unir un hogar.
> Además redefine el contenido de la vista `#hogar` para que sea útil y no redundante,
> y crea una sección "Hogar" en Configuración (en 6.1, solo el aporte esperado +
> renombrar; el resto va a Fase 6.2).

**Fecha:** 2026-06-30
**Modelo:** Opus 4.8.
**Skills:** brainstorming (hecho) → writing-plans → subagent-driven-development · test-driven-development.
**Depende de:** Fase 6 (migración `20260629_fase6_hogares.sql` ya aplicada en v2).
**Regla de seguridad:** cualquier SQL nuevo se revisa a mano y se aplica SOLO a v2.

---

## Problema (reportado por el usuario)

Con cuenta sin hogar, se muestran igual: card "Balance del hogar" y "quién debe qué" en dashboard, toggle Hogar/Personal en gráficos (y default Hogar), toggle ámbito en transacción/metas, badges "Hogar", sección hogar en resumen. Debe estar **todo oculto hasta que exista un hogar**.

## Decisiones (cerradas en brainstorming)

1. **Scoping por pertenencia (enfoque A):** "personal" = filas del usuario con `hogar_id IS NULL`; "hogar" = `hogar_id IS NOT NULL`. Reemplaza el filtrado por `ambito`. Equivalente para filas bien-marcadas (el trigger `sync_hogar_id` garantiza `ambito='hogar' ⟺ hogar_id NOT NULL`); arregla los datos legacy automáticamente.
2. **Datos legacy:** filas `ambito='hogar'` con `hogar_id NULL` (de v1) cuentan como **personales** hasta crear/unir un hogar. El backfill ya existente en `crear_hogar`/`unirse_hogar` les pone `hogar_id` y pasan a ser del hogar. Cero pérdida, reversible.
3. **Gating:** sin hogar, ocultar todo el UI de hogar; con hogar, mostrarlo como hoy.
4. **#hogar (centro de control):** miembros, código de invitación, "quién debe qué" + saldar, salir/disolver (ya existen) **+ nuevo:** aporte real vs esperado por miembro, **+ botón "Configuración del hogar →"** que enlaza a Configuración.
5. **Config del hogar vive SOLO en Configuración** (sección nueva "Hogar"). `#hogar` no duplica config; solo enlaza. En **6.1**: aporte esperado por miembro + renombrar hogar. (6.2: presupuestos hogar, reparto proporcional, gestión de metas/fondo.)

---

## Parte 1 — Estado de hogar global (fundación)

- `window.hogarState`: objeto `{ hogar, miembros, codigo, rol }` o `null`. Se carga una vez tras el login (en el flujo de init, junto a `currentUser`) llamando `getEstadoHogar()`. Helper global `tieneHogar()` → `!!(window.hogarState && window.hogarState.hogar)`.
- Se **refresca** tras `crear_hogar` / `unirse_hogar` / `disolver_hogar` (las funciones de `db.js` que envuelven esos RPCs actualizan `window.hogarState` al volver) y dispara un re-render del UI gated (evento `hogar:changed` en `window`, escuchado por dashboard/gráficos/transacción/router-nav).
- **Scoping helper en db.js:** las queries de balance pasan de `.eq('ambito', X)` a filtrar por `hogar_id`:
  - Personal: `.eq('user_id', uid).is('hogar_id', null)`
  - Hogar: `.not('hogar_id', 'is', null)` (sin filtro user_id; RLS limita al hogar del usuario)
  - Funciones afectadas (todas en `db.js`, son queries cliente, NO RPCs): `getBalanceHogar`, `getBalancePersonal`, `getSaldoAcumuladoHogar`, `getSaldoAcumuladoPersonal`, `getAhorrosHogar`, `getAhorrosPersonal`, `getGastoCategoria` (param `ambito`), y los `getTransacciones({ ambito })` de gráficos.
  - `safe-to-spend.js`: el filtro `t.ambito === 'personal'` (línea 47) pasa a `t.hogar_id == null`; idem `m.ambito !== 'personal'` (137) para metas. (El campo `hogar_id` debe venir en el `select` de `getTransacciones`/`getMetas`.)

> **Equivalencia:** para un usuario con hogar, `hogar_id IS NULL ≡ ambito='personal'` y `hogar_id NOT NULL ≡ ambito='hogar'` (por el trigger). El cambio solo altera el comportamiento de filas legacy (las suma a personal), que es justo lo deseado.

## Parte 2 — Gating de UI

Con `tieneHogar() === false`, ocultar:
- **transacción / metas:** el toggle de ámbito (`btnAmbitoPersonal`/`btnAmbitoHogar`). Forzar `ambito='personal'` (el trigger pondrá `hogar_id NULL`). Con hogar: mostrar el toggle.
- **dashboard:** la card "Balance del hogar" (`section[aria-labelledby=hogarTitle]`), la línea "↳ de eso, aporte al hogar" del card personal, y la card "quién debe qué" (ya gated por `getEstadoHogar`, pero ahora vía `tieneHogar()`). Sin hogar, el card personal muestra TODO el dinero del usuario (queries por `hogar_id IS NULL`). Badges "Hogar/Personal" en la lista: sin hogar, no se muestran (todo es personal).
- **gráficos:** ocultar el toggle Hogar/Personal y los gráficos exclusivos de hogar; **default Personal**. Con hogar: como hoy (default puede seguir Hogar o cambiarse a Personal — decisión menor, dejar Personal por defecto para coherencia).
- **resumen:** ocultar la sección/columna de hogar; sin hogar todo es personal.

Mecanismo: cada vista consulta `tieneHogar()` en su render y aplica `hidden`/`display:none` o salta el bloque. Escuchan `window` evento `hogar:changed` para re-render al crear/disolver sin recargar.

## Parte 3 — Vista #hogar (centro de control)

Mantiene lo de Fase 6 (miembros, código, "quién debe qué" + saldar, salir/disolver, preview de disolución). **Añade:**
- **Aporte real vs esperado por miembro** (del mes en curso): por cada miembro, una barra con `real / esperado`. `real` = todo lo que el miembro puso al hogar en el mes = Σ (`tipo='ingreso'`, `hogar_id = hogar`, `user_id = miembro`) + Σ (`tipo='gasto'`, `hogar_id = hogar`, `user_id = miembro`). Refleja parejas que financian el hogar tanto con ingresos al pozo como pagando gastos compartidos directo. `esperado` = `hogar_miembros.aporte_esperado` (Parte 4). Si `esperado=0`, mostrar solo el real sin barra. (Nota: se solapa a propósito con la base del balance 50/50 "quién debe qué" — son dos lecturas distintas: aporte total al hogar vs neto entre miembros.)
- **Botón "Configuración del hogar →"** que navega a `#configuracion` (a la sección Hogar). `#hogar` NO contiene controles de config; solo el enlace.

## Parte 4 — Configuración › sección "Hogar" (scaffold en 6.1)

Nueva sección "Hogar" en `views/configuracion.html`, visible solo con `tieneHogar()`. En **6.1** incluye:
- **Aporte esperado por miembro (mensual):** un input por miembro. Persistencia: columna nueva `hogar_miembros.aporte_esperado numeric(10,2) not null default 0`. RPC `set_aporte_esperado(p_miembro uuid, p_monto numeric)` (SECURITY DEFINER; el llamante debe ser miembro del mismo hogar; `p_miembro` también; pareja acuerda, así que cualquier miembro puede fijar el de ambos). Wrapper `setAporteEsperado` en `db.js`.
- **Renombrar hogar:** input con el nombre. RPC `renombrar_hogar(p_nombre text)` (SECURITY DEFINER; solo miembro). Wrapper `renombrarHogar`.

(6.2 añadirá a esta misma sección: presupuestos por categoría del hogar, reparto configurable 50/50↔proporcional, gestión de metas/fondo del hogar.)

---

## SQL nuevo (migración `20260630_fase6_1_hogar_config.sql`, solo v2)

```sql
alter table public.hogar_miembros
  add column if not exists aporte_esperado numeric(10,2) not null default 0;

create or replace function public.set_aporte_esperado(p_miembro uuid, p_monto numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_hogar uuid := public.auth_hogar_id();
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  if p_monto is null or p_monto < 0 then raise exception 'Monto inválido'; end if;
  if not exists (select 1 from public.hogar_miembros where hogar_id = v_hogar and user_id = p_miembro) then
    raise exception 'El miembro no pertenece a tu hogar';
  end if;
  update public.hogar_miembros set aporte_esperado = round(p_monto, 2)
   where hogar_id = v_hogar and user_id = p_miembro;
end; $$;

create or replace function public.renombrar_hogar(p_nombre text)
returns void language plpgsql security definer set search_path = public as $$
declare v_hogar uuid := public.auth_hogar_id();
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  update public.hogares set nombre = coalesce(nullif(trim(p_nombre),''), nombre)
   where id = v_hogar;
end; $$;

grant execute on function public.set_aporte_esperado(uuid, numeric) to authenticated;
grant execute on function public.renombrar_hogar(text)             to authenticated;
```

`getEstadoHogar` debe incluir `aporte_esperado` en el `select` de miembros (`user_id, rol, joined_at, aporte_esperado`).

---

## Componentes y archivos

| Archivo | Cambio |
|---|---|
| `js/db.js` | Scoping por `hogar_id`; `window.hogarState` + refresco en crear/unir/disolver; wrappers `setAporteEsperado`, `renombrarHogar`; `getEstadoHogar` trae `aporte_esperado`. Helper `tieneHogar()`. |
| `js/auth.js` o init | Cargar `window.hogarState` tras login; limpiar en logout. |
| `js/safe-to-spend.js` | Filtro por `hogar_id == null` en vez de `ambito`. |
| `views/dashboard.html` | Gating de cards hogar; card personal usa scope `hogar_id IS NULL`. |
| `views/graficos.html` | Gating del toggle/gráficos hogar; default Personal; queries por `hogar_id`. |
| `views/transaccion.html`, `views/metas.html` | Ocultar toggle ámbito sin hogar; forzar personal. |
| `views/resumen.html` | Gating de la sección hogar. |
| `views/hogar.html` | Aporte real vs esperado por miembro + botón "Configuración del hogar →". |
| `views/configuracion.html` | Sección nueva "Hogar" (aporte esperado por miembro + renombrar), visible solo con hogar. |
| `supabase/migrations/20260630_fase6_1_hogar_config.sql` | Columna + 2 RPCs. |
| `sw.js` | Bump `SHELL_VERSION` (v18 → v19). |

---

## Testing

**JS puro (`test/*.test.mjs`):**
- Scoping: una función pura `esPersonal(fila)` / `esHogar(fila)` basada en `hogar_id` (si se extrae); o tests del cálculo de aporte real vs esperado por miembro (función pura `aporteRealPorMiembro(txs, miembros, mes)`).
- Verificar que filas con `hogar_id=null` cuentan personal y `hogar_id!=null` cuentan hogar.

**SQL (`supabase/tests/`):** extender o añadir asserts para `set_aporte_esperado` (rechaza no-miembro, monto negativo) y `renombrar_hogar` (solo miembro).

**Verificación manual (preview / 2 cuentas):**
- Cuenta SIN hogar: ningún elemento "hogar" visible; totales personales incluyen las filas legacy hogar.
- Crear hogar → aparecen toggle/cards/gráficos hogar; las filas legacy se re-asocian (backfill) y migran de personal a hogar.
- #hogar muestra aporte real vs esperado; botón lleva a Configuración › Hogar.
- Disolver → todo "hogar" vuelve a ocultarse; las metas/fondo vuelven al creador (Fase 6).

---

## Orden de implementación (para writing-plans)

1. SQL: migración (columna + RPCs). Revisión manual + aplicar a v2.
2. `db.js`: `window.hogarState` + `tieneHogar()` + refresco; scoping por `hogar_id`; wrappers nuevos; `getEstadoHogar` trae `aporte_esperado`. + `getTransacciones`/`getMetas` traen `hogar_id` en el select.
3. `safe-to-spend.js` scoping + tests.
4. Gating en transacción/metas (toggle) — el más visible.
5. Gating en dashboard (cards) + scope personal.
6. Gating en gráficos + resumen.
7. `#hogar`: aporte real vs esperado + enlace a config.
8. Configuración › sección Hogar (aporte esperado + renombrar).
9. Evento `hogar:changed` + re-render; bump `SHELL_VERSION`; verificación 2 cuentas; push v2.

---

## Riesgos / notas

- **Scoping change es transversal:** tocar las 6 funciones de balance + safe-to-spend + gráficos. Riesgo de inconsistencia si alguna queda en `ambito`. Mitigación: auditar que NINGUNA query de balance siga filtrando por `ambito` para scoping (el `ambito` solo se usa ya como input del toggle que decide el stamping del trigger). Tests de equivalencia.
- **`getTransacciones`/`getMetas` deben incluir `hogar_id`** en el `select` para que el scoping cliente (safe-to-spend, balance hogar en #hogar/dashboard) funcione.
- **Evento de refresco:** sin recargar, crear/disolver debe actualizar todas las vistas montadas. Un `CustomEvent('hogar:changed')` en `window` es suficiente; cada vista re-renderiza.
- **No romper Fase 6:** la migración 6.1 solo AÑADE (columna + RPCs); no toca RLS ni la migración previa.
- **Convenciones:** IIFE, `var`, `escHtml`, hash-routing, estilo editorial dark champagne.
