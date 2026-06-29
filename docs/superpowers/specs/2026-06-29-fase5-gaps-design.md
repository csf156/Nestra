# Fase 5 — Gaps de implementación (diseño)

Fecha: 2026-06-29 · Rama: `v2` · Enfoque: **mobile-first**

## Contexto

La v2 se desarrolló siguiendo un documento desactualizado. Auditoría de Fase 5
("editorial luxury dark" + pulido de experiencia + onboarding) revela que el
sistema de diseño base ya existe (`css/base.css`: paleta near-black `#08080f`,
champagne `#c9a84c`, Playfair Display + Outfit, light mode coherente), pero
faltan piezas funcionales:

| Pieza | Estado actual |
|---|---|
| Sistema de diseño editorial | ✅ presente en `base.css`/`components.css` |
| Skeletons | ⚠️ solo `dashboard` + `historial`; spinners en 6 vistas |
| Empty states ilustrados | ❌ `.empty-state` CSS existe, **cero vistas lo usan** |
| Sparklines | ❌ ausente |
| Onboarding 3 pasos | ❌ ausente |
| Moneda configurable | ❌ `formatMonto` hardcodea `S/` / `es-PE` |

Decisiones tomadas (brainstorming): moneda = sistema real · ingreso = recurrente ·
flag once = columna DB · empty states = íconos Tabler.

## Restricciones

- No romper funcionalidad existente: capa visual + onboarding + moneda.
- No duplicar funciones: reusar `insertCategoria`, `getCategorias`,
  `upsertRecurrente`, `insertTransaccion`, `updateProfile`, sprite Tabler,
  CSS `.skeleton`/`.empty-state`/`.progress`/`.cat-chip` existentes.
- **Mobile-first**: cada vista nueva (onboarding) y cada componente nuevo se
  diseña primero para viewport angosto (~380px); desktop es enhancement.
- App vanilla sin build. Scripts globales (no-module) para `format.js` y deps
  cargadas temprano; módulos ES para el resto.
- Offline-safe: render sin `await`. Cache sync para moneda.

## A. Sistema de moneda real

**Migración** (`profiles`):
```sql
alter table public.profiles add column if not exists moneda text not null default 'PEN';
```

**`js/moneda.js`** (script global, nuevo, cargar antes de `format.js`):
- `MONEDAS = { PEN:{symbol:'S/',locale:'es-PE'}, USD:{symbol:'$',locale:'en-US'},
  EUR:{symbol:'€',locale:'es-ES'}, MXN:{symbol:'$',locale:'es-MX'},
  COP:{symbol:'$',locale:'es-CO'}, ARS:{symbol:'$',locale:'es-AR'},
  CLP:{symbol:'$',locale:'es-CL'} }`.
- `getMonedaActiva()` → lee `localStorage['nestra-moneda']`, default `'PEN'`,
  valida contra `MONEDAS`.
- `monedaSimbolo()` / `monedaLocale()` → del code activo.
- `setMoneda(code)` → escribe cache + `updateProfile({moneda:code})` + dispara
  evento `nestra:moneda-cambiada` para re-render de vistas montadas.
- `cacheMonedaDesdePerfil(perfil)` → escribe cache desde el profile cargado.

**`format.js`**: `formatMonto` usa `monedaSimbolo()` + `monedaLocale()` con
fallback `'S/'`/`'es-PE'` si `moneda.js` no cargó (degradación segura). Mantiene
símbolo y monto en la misma línea (sin cambios de layout).

**Boot**: tras login y carga de perfil (donde hoy se llama `getProfiles`/sesión),
invocar `cacheMonedaDesdePerfil`. CLP no usa decimales — `formatMonto` respeta
`maximumFractionDigits` por locale vía `toLocaleString` (CLP → 0 decimales).

**Configuración**: selector de moneda en sección de ajustes → `setMoneda`.

## B. Onboarding 3 pasos

**Migración** (`profiles`):
```sql
alter table public.profiles add column if not exists onboarding_completado boolean not null default false;
```
RLS ya permite editar el perfil propio (cubre el `update` del flag).

**`views/onboarding.html` + `js/onboarding.js`** — overlay full-screen
(patrón `#bioLock` de `index.html`), mobile-first, `z-index` sobre el shell.

**Gatillo (boot)**: en `router.js`/arranque post-auth, leer perfil; si
`onboarding_completado === false` → montar onboarding antes del dashboard.
Robustez: si el perfil no carga (offline sin cache), no bloquear la app.

**Paso 1 — Moneda + ingreso mensual**
- Select de moneda (de `MONEDAS`) + input monto ingreso.
- Siguiente → `setMoneda(code)` + `upsertRecurrente({descripcion:'Ingreso mensual',
  monto, tipo:'ingreso', frecuencia:'mensual', dia_cargo:1, activo:true})`.
- Si monto vacío/0 → permitir continuar sin crear recurrente.

**Paso 2 — 3 categorías**
- Chips sugeridos (Comida, Transporte, Hogar, Ocio, Salud, Servicios) con
  ícono/color Tabler + opción "crear propia" (nombre + ícono).
- Selección objetivo: 3 (mínimo 1 para avanzar). Cada elegida → `insertCategoria
  ({nombre, tipo:'gasto', icono, color, estado:'activa'})`. Evitar duplicar
  categorías ya existentes (chequear `getCategorias`).

**Paso 3 — Transacción de ejemplo**
- Elegir una de las categorías recién creadas + monto → `insertTransaccion
  ({tipo:'gasto', ambito:'personal', categoria_id, monto, fecha:hoy})`.
- Opción "omitir" este paso.

**Fin**: `updateProfile({onboarding_completado:true})` + escribir flag en cache
local para no re-mostrar antes de la próxima carga de perfil → navegar a
dashboard (ya con ingreso + categorías + 1 gasto visibles).

**UI**: dots de progreso (3), montos en Playfair, acento champagne en
CTA/activo, back entre pasos, sin scroll horizontal en 380px.

## C. Empty states ilustrados

**`js/ui.js`** (módulo nuevo, helpers de UI compartidos):
- `renderEmptyState({icon, title, desc, ctaLabel, ctaHref})` → HTML string con
  `.empty-state` + `.empty-state-icon` (sprite Tabler `<svg><use href>`).
- Devuelve markup; cada vista lo inyecta donde hoy muestra tabla/lista vacía.

**Cableado** (sustituir "tabla en blanco" por empty state):
- historial: sin transacciones → "Registra tu primer gasto" (CTA → transaccion).
- graficos: sin datos del periodo → "Aún no hay datos para graficar".
- metas: sin metas → "Crea tu primera meta".
- prestamos: sin préstamos → "Registra un préstamo".
- configuracion: secciones de listas vacías (categorías/recurrentes/plantillas).
- dashboard: estado sin datos → CTA a registrar.

## D. Skeleton loaders

CSS `.skeleton*` ya existe. Reemplazar spinner/`loading-overlay` por skeleton que
imita el layout real (mobile-first) en: `graficos`, `metas`, `prestamos`,
`configuracion`, `decisiones`, `resumen`, `transaccion`. Mantener `prefers-
reduced-motion` (ya cubierto en CSS). Spinners de botón (`.btn .spinner`) se
conservan — son de acción, no de carga de vista.

## E. Sparklines inline (historial)

**`js/ui.js`**: `sparkline(values, opts)` → string SVG inline puro (sin deps,
sin `new Date`), ~48×16, trazo champagne, fondo transparente, `aria-hidden`.
- Datos: por categoría visible en historial, gasto diario de los últimos 7 días
  (helper que agrega transacciones por `categoria_id` y fecha).
- Render: junto al `.cat-chip`/nombre en cada fila/grupo de historial.
- Si <2 puntos con dato → no renderizar (evitar línea plana sin señal).

## F. Pulido design-system + accesibilidad

- insight cards `border-left` 3px → **2px**; fondo tintado sutil ya ~4%.
- `.progress` barras finas → **2px** (default), conservar `progress-md/lg` donde
  haga falta semántica de tamaño.
- `.cat-chip` → caja **24×24** redondeada, ícono centrado.
- Verificar que las 7 vistas usan tokens (no hex hardcodeado).
- **WCAG AA** (skill `accessibility`): contraste champagne `#c9a84c` sobre
  `#08080f`, texto secundario `#a8a29a`, estados semánticos. Ajustar tokens si
  algún par no alcanza 4.5:1 (texto) / 3:1 (UI/gráficos). Verificar también light
  mode.

## Orden de implementación

1. Migraciones DB (`moneda`, `onboarding_completado`).
2. Sistema de moneda (`moneda.js`, refactor `formatMonto`, boot cache, selector config).
3. `js/ui.js` (helpers `renderEmptyState`, `sparkline`, agregador 7 días).
4. Onboarding (`onboarding.html` + `onboarding.js` + gatillo boot).
5. Empty states cableados en las 6 vistas.
6. Skeletons en las 7 vistas (matar spinners de carga).
7. Sparklines en historial.
8. Pulido tokens (2px/24×24) + auditoría WCAG AA.
9. Verificación en preview (mobile viewport) + push a `v2`.

## No-objetivos (YAGNI)

- Conversión de divisas / tipos de cambio (solo símbolo + locale de formato).
- Editar onboarding tras completarlo (se re-corre solo reseteando el flag).
- Ilustraciones SVG bespoke (se usan íconos Tabler).
- Sparklines en vistas distintas de historial.
