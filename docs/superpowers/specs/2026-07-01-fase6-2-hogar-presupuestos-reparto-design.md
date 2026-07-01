# Fase 6.2 — Presupuestos del hogar + reparto configurable (diseño)

> Completa la configuración del hogar (Fase 6). 6.1 entregó el opt-in + aporte esperado.
> 6.2 añade: presupuestos por categoría a nivel hogar, y un reparto configurable
> (50/50 ↔ proporcional al ingreso) para el balance "quién debe qué". La gestión de
> metas/fondo del hogar se descartó (redundante: las metas hogar ya se crean en #metas).

**Fecha:** 2026-07-01
**Modelo:** Opus 4.8.
**Skills:** brainstorming (hecho) → writing-plans → subagent-driven-development · test-driven-development.
**Depende de:** Fase 6 + 6.1 (migraciones `20260629`, `20260630` aplicadas en v2).
**Regla de seguridad:** el SQL nuevo se revisa a mano y se aplica SOLO a v2.

## Hallazgos que fundan el diseño

- El presupuesto por categoría VIVO es `categorias.limite_mensual` (dashboard: "Fuente única: categorias.limite_mensual"; `js/presupuestos.js` es un clasificador puro `estadoPresupuesto(gastado, limite)` sin tabla). La tabla `presupuestos` (Fase 4) está **dormida** (sin CRUD ni UI) — NO se usa aquí (evita duplicar sistemas de presupuesto).
- Categorías: las compartidas tienen `user_id IS NULL` y ya son editables por cualquier miembro (`20260622_categorias_editables_hogar.sql`). Las transacciones del hogar usan estas categorías compartidas.
- Balance día-a-día = 50/50 en `js/hogar-balance.js` (`calcularBalanceHogar`). Disolución = proporcional al ingreso del hogar en `disolver_hogar` (RPC).

## Decisiones (cerradas en brainstorming)

1. **Presupuesto hogar:** columna nueva `categorias.limite_mensual_hogar`; el `limite_mensual` existente queda como presupuesto **personal**. Coexisten. Se aplica sobre categorías compartidas (`user_id IS NULL`).
2. **Reparto:** el toggle 50/50 ↔ proporcional afecta SOLO el balance día-a-día ("quién debe qué"); la disolución sigue proporcional siempre (ya lo es).
3. **Proporcional pesado por:** ingresos reales del hogar del mes por miembro (mismo criterio que la disolución, RLS-safe). Fallback 50/50 si ambos = 0.
4. Metas/fondo hogar: fuera de scope (redundante con #metas).

---

## Parte 1 — Presupuestos del hogar por categoría

- **Storage:** `alter table public.categorias add column if not exists limite_mensual_hogar numeric(10,2)`. NULL/0 = sin presupuesto hogar para esa categoría.
- **Semántica:** `limite_mensual` = presupuesto personal (vs gastos personales de la categoría, scope `hogar_id IS NULL`). `limite_mensual_hogar` = presupuesto del hogar (vs gastos del hogar de la categoría, scope `hogar_id IS NOT NULL`). Ambos por categoría, coexisten.
- **RLS/edición:** las categorías compartidas (`user_id IS NULL`) ya tienen `categorias_update` que permite a cualquier autenticado editarlas (incluye ahora `limite_mensual_hogar`). No hace falta policy nueva.
- **Gestión (UI):** en Configuración › sección Hogar (creada en 6.1), añadir una lista de categorías de gasto compartidas (`getCategorias('gasto')` filtradas a `user_id == null`), cada una con un input de "Límite del hogar (S/)". Guardar vía `updateCategoria(id, { limite_mensual_hogar })` (wrapper existente). Visible solo con `tieneHogar()`.
- **Display:** el bloque de presupuestos del dashboard (`renderPresupuestos`) muestra, cuando `tieneHogar()`, barras de presupuesto-hogar (gasto del hogar de la categoría vs `limite_mensual_hogar`) además de las personales, etiquetadas "Hogar". Reusa `estadoPresupuesto(gastado, limite)` y `getGastoCategoria(categoria_id, 'hogar', desde, hasta)` (ya scoped por hogar_id en 6.1). Sin hogar, no se muestran.
- **Alertas:** `alerts.js` genera un aviso in-app cuando un presupuesto-hogar cruza umbral (≥100% superado; ≥70% ámbar), análogo a los personales. Push queda fuera de 6.2.

## Parte 2 — Reparto configurable (50/50 ↔ proporcional)

- **Storage:** `alter table public.hogares add column if not exists reparto text not null default '50_50' check (reparto in ('50_50','proporcional'))`.
- **Exposición:** `getEstadoHogar` incluye `reparto` en el select de `hogares` (`select('*')` ya lo trae) → `window.hogarState.hogar.reparto`.
- **RPC:** `set_reparto_hogar(p_modo text)` SECURITY DEFINER, `search_path=public`: valida `auth_hogar_id()` no null y `p_modo in ('50_50','proporcional')`; `update hogares set reparto = p_modo where id = auth_hogar_id()`. Grant a authenticated. Wrapper `setRepartoHogar(modo)` en db.js (refresca hogarState + emite `hogar:changed`).
- **Cálculo** — extender `calcularBalanceHogar(transacciones, liquidaciones, uidA, uidB, modo)` en `js/hogar-balance.js`:
  - `modo` por defecto `'50_50'` (retrocompatible con las llamadas actuales).
  - `'50_50'`: `neto = (pagóA − pagóB)/2` (actual).
  - `'proporcional'`: `pesoA = ingHogarA / (ingHogarA + ingHogarB)` donde `ingHogar*` = Σ (`tipo='ingreso'`, `hogar_id != null`, `user_id`) de `transacciones`; `parteJustaA = pesoA · (pagóA + pagóB)`; `neto = pagóA − parteJustaA`. Si `ingHogarA + ingHogarB == 0` → cae a `'50_50'`.
  - Las liquidaciones se aplican igual que hoy (restan/suman al neto).
- **UI:** toggle en Configuración › Hogar (50/50 / Proporcional) → `setRepartoHogar`. Los consumidores del balance (`views/hogar.html`, card "quién debe qué" del dashboard) pasan `window.hogarState.hogar.reparto` como `modo`.
- **Alcance:** solo día-a-día. `disolver_hogar` NO cambia.

## Parte 3 — SQL (`supabase/migrations/20260701_fase6_2_hogar.sql`, solo v2)

```sql
begin;

alter table public.categorias
  add column if not exists limite_mensual_hogar numeric(10,2);

alter table public.hogares
  add column if not exists reparto text not null default '50_50'
  check (reparto in ('50_50','proporcional'));

create or replace function public.set_reparto_hogar(p_modo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_hogar uuid := public.auth_hogar_id();
begin
  if v_hogar is null then raise exception 'No perteneces a un hogar'; end if;
  if p_modo not in ('50_50','proporcional') then raise exception 'Modo inválido'; end if;
  update public.hogares set reparto = p_modo where id = v_hogar;
end; $$;
grant execute on function public.set_reparto_hogar(text) to authenticated;

commit;
```

## Componentes y archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260701_fase6_2_hogar.sql` | Columnas `limite_mensual_hogar`, `reparto` + RPC `set_reparto_hogar`. |
| `js/hogar-balance.js` | `calcularBalanceHogar` acepta `modo` ('50_50'|'proporcional'). |
| `test/hogar-balance.test.mjs` | Tests del modo proporcional + fallback. |
| `js/db.js` | Wrapper `setRepartoHogar`; `updateCategoria` ya soporta `limite_mensual_hogar` (pasa datos). Confirmar que el select de categorias trae `limite_mensual_hogar`. |
| `views/configuracion.html` | En sección Hogar: lista de límites-hogar por categoría compartida + toggle de reparto. |
| `views/hogar.html` | `calcularBalanceHogar(...)` pasa `hogarState.hogar.reparto`. |
| `views/dashboard.html` | Card "quién debe qué" pasa `reparto`; `renderPresupuestos` muestra barras de presupuesto-hogar con `tieneHogar()`. |
| `js/alerts.js` | Aviso in-app de presupuesto-hogar cruzado. |
| `sw.js` | Bump `SHELL_VERSION` v19 → v20. |

## Testing

- **JS puro** (`test/hogar-balance.test.mjs`): modo proporcional (A 60% ingresos → parte justa 60%; neto correcto), fallback 50/50 con 0 ingresos, interacción con liquidaciones, retrocompat (sin `modo` = 50/50).
- **SQL** (`supabase/tests/hogar_rls_test.sql` o nuevo): `set_reparto_hogar` rechaza no-miembro y modo inválido; acepta modo válido de un miembro.
- **Manual (2 cuentas):** fijar límite-hogar a una categoría → barra en dashboard vs gasto hogar; cruzar umbral → alerta. Cambiar reparto a proporcional con ingresos desiguales → el neto "quién debe qué" cambia acorde; disolución sigue igual.

## Orden de implementación (para writing-plans)

1. SQL: migración (columnas + RPC). Revisión manual + aplicar a v2.
2. `calcularBalanceHogar` modo proporcional + tests (TDD).
3. `db.js`: `setRepartoHogar` + confirmar `limite_mensual_hogar` en selects de categorias.
4. Config › Hogar: toggle reparto + límites-hogar por categoría.
5. Consumidores del balance (hogar.html, dashboard card) pasan `reparto`.
6. `renderPresupuestos` (dashboard): barras de presupuesto-hogar gated.
7. `alerts.js`: aviso de presupuesto-hogar.
8. sw v20; verificación 2 cuentas; push v2.

## Riesgos / notas

- **Retrocompatibilidad de `calcularBalanceHogar`:** el parámetro `modo` es opcional con default `'50_50'`; las llamadas actuales no rompen.
- **Categorías personales:** `limite_mensual_hogar` solo tiene sentido en categorías compartidas (`user_id IS NULL`); la UI de config solo las lista. Un límite-hogar en una categoría personal sería invisible al socio — no se ofrece.
- **Deploy-ordering:** `getEstadoHogar` usa `select('*')` de hogares, así que `reparto` aparece sin cambio de select; `calcularBalanceHogar` con `hogarState.hogar.reparto` undefined (pre-migración) cae a `'50_50'` por el default del parámetro — degradación segura. Aun así, aplicar la migración antes del push.
- **Convenciones:** IIFE, `var`, `escHtml`, dual-export, estilo editorial dark champagne.
