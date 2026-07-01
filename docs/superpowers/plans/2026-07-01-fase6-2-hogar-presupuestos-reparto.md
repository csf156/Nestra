# Fase 6.2 — Presupuestos hogar + reparto configurable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Presupuestos por categoría a nivel hogar (`categorias.limite_mensual_hogar` vs gastos del hogar) y un reparto configurable 50/50 ↔ proporcional para el balance "quién debe qué".

**Architecture:** Presupuesto hogar se apoya en el mecanismo vivo (`categorias.limite_mensual`), añadiendo una columna paralela `limite_mensual_hogar` sobre categorías compartidas. El reparto es una columna en `hogares` leída por `calcularBalanceHogar`, que gana un parámetro `modo` (default '50_50', retrocompatible).

**Tech Stack:** Postgres/Supabase, JS vanilla ESM (node:test), PWA sin build.

**Spec:** `docs/superpowers/specs/2026-07-01-fase6-2-hogar-presupuestos-reparto-design.md`

**Regla de seguridad:** el SQL nuevo se revisa a mano y se aplica SOLO a v2.

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `supabase/migrations/20260701_fase6_2_hogar.sql` | Crear | Columnas `limite_mensual_hogar`, `reparto` + RPC `set_reparto_hogar`. |
| `js/hogar-balance.js` | Modificar | `calcularBalanceHogar` acepta `modo`. |
| `test/hogar-balance.test.mjs` | Modificar | Tests del modo proporcional. |
| `js/db.js` | Modificar | Wrapper `setRepartoHogar` + helper `getGastoHogarPorCategoria`. |
| `views/configuracion.html` | Modificar | Sección Hogar: toggle reparto + límites-hogar por categoría. |
| `views/hogar.html` | Modificar | Pasa `reparto` a `calcularBalanceHogar`. |
| `views/dashboard.html` | Modificar | Card "quién debe qué" pasa `reparto`; `renderPresupuestos` añade barras hogar. |
| `js/alerts.js` | Modificar | Alerta in-app de presupuesto-hogar cruzado. |
| `sw.js` | Modificar | Bump `SHELL_VERSION` v19 → v20. |

---

## Task 1: Migración SQL — columnas + RPC set_reparto_hogar

**Files:**
- Create: `supabase/migrations/20260701_fase6_2_hogar.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- supabase/migrations/20260701_fase6_2_hogar.sql
-- Fase 6.2 — presupuestos hogar + reparto configurable. SOLO v2. Idempotente.

begin;

-- Presupuesto del hogar por categoría (paralelo a categorias.limite_mensual,
-- que es el presupuesto personal). Las categorías compartidas (user_id IS NULL)
-- ya son editables por cualquier miembro (categorias_update de 20260622).
alter table public.categorias
  add column if not exists limite_mensual_hogar numeric(10,2);

-- Modo de reparto del balance "quién debe qué" del hogar.
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

- [ ] **Step 2: Verificar**

Run: `grep -nE "limite_mensual_hogar|reparto|set_reparto_hogar" supabase/migrations/20260701_fase6_2_hogar.sql`
Expected: ambas columnas + el RPC + su grant presentes.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260701_fase6_2_hogar.sql
git commit -m "feat(fase6.2): columnas limite_mensual_hogar + reparto + RPC set_reparto_hogar"
```

> NO aplicar aquí. Revisión manual + aplicar en SQL Editor de v2 (Task 8).

---

## Task 2: `calcularBalanceHogar` con modo (TDD)

**Files:**
- Modify: `test/hogar-balance.test.mjs`
- Modify: `js/hogar-balance.js`

- [ ] **Step 1: Añadir los tests del modo proporcional**

Añadir al final de `test/hogar-balance.test.mjs` (tras los tests existentes):

```javascript
test('modo proporcional: parte justa pesada por ingresos hogar', () => {
  // A aportó 600 de ingresos hogar, B 400 → pesoA 60%. Gastos: A pagó 200, B 0.
  // total gastos = 200; parte justa A = 0.6*200 = 120; neto A = 200-120 = 80 (le deben 80).
  const txs = [
    { user_id: 'uidA', tipo: 'ingreso', ambito: 'hogar', hogar_id: 'H', monto: 600 },
    { user_id: 'uidB', tipo: 'ingreso', ambito: 'hogar', hogar_id: 'H', monto: 400 },
    { user_id: 'uidA', tipo: 'gasto',   ambito: 'hogar', hogar_id: 'H', monto: 200 },
  ];
  const r = calcularBalanceHogar(txs, [], 'uidA', 'uidB', 'proporcional');
  assert.strictEqual(r.neto, 80);
  assert.strictEqual(r.acreedor, 'uidA');
  assert.strictEqual(r.deudor, 'uidB');
});

test('modo proporcional con ambos ingresos 0 → cae a 50/50', () => {
  const txs = [
    { user_id: 'uidA', tipo: 'gasto', ambito: 'hogar', hogar_id: 'H', monto: 100 },
    { user_id: 'uidB', tipo: 'gasto', ambito: 'hogar', hogar_id: 'H', monto: 40 },
  ];
  const r = calcularBalanceHogar(txs, [], 'uidA', 'uidB', 'proporcional');
  assert.strictEqual(r.neto, 30); // (100-40)/2
});

test('sin modo (retrocompat) = 50/50', () => {
  const txs = [
    { user_id: 'uidA', tipo: 'gasto', ambito: 'hogar', hogar_id: 'H', monto: 100 },
    { user_id: 'uidB', tipo: 'gasto', ambito: 'hogar', hogar_id: 'H', monto: 40 },
  ];
  const r = calcularBalanceHogar(txs, [], 'uidA', 'uidB');
  assert.strictEqual(r.neto, 30);
});
```

- [ ] **Step 2: Correr — deben fallar (proporcional aún no implementado)**

Run: `node --test test/hogar-balance.test.mjs`
Expected: FAIL en el test "modo proporcional: parte justa..." (neto ≠ 80 porque aún ignora `modo`).

- [ ] **Step 3: Implementar `modo` en `calcularBalanceHogar`**

En `js/hogar-balance.js`, reemplazar la firma y el cálculo del neto de `calcularBalanceHogar`. La función actual calcula `pagoA`/`pagoB` y `neto = (pagoA - pagoB)/2`. Nueva versión (mantiene el resto — abs, acreedor, deudor, liquidaciones — igual):

```javascript
function calcularBalanceHogar(transacciones, liquidaciones, uidA, uidB, modo) {
  var pagoA = 0, pagoB = 0, ingA = 0, ingB = 0;
  (transacciones || []).forEach(function (t) {
    if (t.ambito !== 'hogar' && t.hogar_id == null) return; // solo hogar
    var m = Number(t.monto) || 0;
    if (t.tipo === 'gasto') {
      if (t.user_id === uidA) pagoA += m;
      else if (t.user_id === uidB) pagoB += m;
    } else if (t.tipo === 'ingreso') {
      if (t.user_id === uidA) ingA += m;
      else if (t.user_id === uidB) ingB += m;
    }
  });

  var neto;
  if (modo === 'proporcional' && (ingA + ingB) > 0) {
    var pesoA = ingA / (ingA + ingB);
    neto = pagoA - pesoA * (pagoA + pagoB);   // >0 ⇒ B le debe a A
  } else {
    neto = (pagoA - pagoB) / 2;               // 50/50 (default y fallback)
  }

  (liquidaciones || []).forEach(function (l) {
    var m = Number(l.monto) || 0;
    if (l.de_user === uidB && l.a_user === uidA) neto -= m;
    else if (l.de_user === uidA && l.a_user === uidB) neto += m;
  });
  neto = Math.round(neto * 100) / 100;
  return {
    neto: Math.abs(neto),
    acreedor: neto >= 0 ? uidA : uidB,
    deudor:   neto >= 0 ? uidB : uidA,
    pagoA: pagoA, pagoB: pagoB
  };
}
```

> Nota: el filtro de gasto pasa de `t.ambito !== 'hogar' || t.tipo !== 'gasto'` a un guard por hogar + switch por tipo (para sumar también ingresos). Verificar que los tests existentes (50/50) siguen pasando: el neto 50/50 no cambia.

- [ ] **Step 4: Correr — todos verdes**

Run: `node --test test/hogar-balance.test.mjs`
Expected: PASS (los 6 originales + 3 nuevos = 9).

- [ ] **Step 5: Commit**

```bash
git add js/hogar-balance.js test/hogar-balance.test.mjs
git commit -m "feat(fase6.2): calcularBalanceHogar acepta modo 50_50|proporcional (TDD)"
```

---

## Task 3: db.js — setRepartoHogar + helper de gasto hogar por categoría

**Files:**
- Modify: `js/db.js`

- [ ] **Step 1: Añadir el wrapper del RPC y el helper de gasto hogar por categoría**

Añadir junto a los otros wrappers de hogar en `js/db.js` (siguiendo el patrón de `renombrarHogar`/`setAporteEsperado`, funciones globales top-level):

```javascript
// setRepartoHogar(modo) — fija el modo de reparto del hogar ('50_50'|'proporcional').
// Refresca el estado y emite hogar:changed. Lanza en fallo.
async function setRepartoHogar(modo) {
  const { error } = await supabase.rpc('set_reparto_hogar', { p_modo: modo });
  if (error) throw error;
  await _refrescarHogarState();
}

// getGastoHogarPorCategoria(mes, anio) — mapa { categoria_id: gasto_hogar } del mes.
// Solo transacciones del hogar (hogar_id != null), tipo gasto. {} en error.
async function getGastoHogarPorCategoria(mes, anio) {
  try {
    const { desde, hasta } = _rangoMes(mes, anio);
    const { data, error } = await supabase
      .from('transacciones')
      .select('categoria_id, monto')
      .not('hogar_id', 'is', null)
      .eq('tipo', 'gasto')
      .gte('fecha', desde)
      .lte('fecha', hasta);
    if (error) throw error;
    const mapa = {};
    (data || []).forEach((t) => {
      mapa[t.categoria_id] = (mapa[t.categoria_id] || 0) + Number(t.monto);
    });
    return mapa;
  } catch (err) {
    console.error('Error en getGastoHogarPorCategoria():', err.message || err);
    return {};
  }
}
```

> `getEstadoHogar` usa `select('*')` en `hogares`, así que `reparto` ya llega en `window.hogarState.hogar.reparto` sin cambios. `updateCategoria` hace `.update(datos)`, así que `updateCategoria(id, { limite_mensual_hogar: n })` ya funciona. `getCategorias` usa `select('*')` → trae `limite_mensual_hogar`. No hace falta tocarlos.

- [ ] **Step 2: Verificar sintaxis + no duplicados**

Run: `node --check js/db.js && grep -c "async function setRepartoHogar\|async function getGastoHogarPorCategoria" js/db.js`
Expected: OK y `2`.

- [ ] **Step 3: Commit**

```bash
git add js/db.js
git commit -m "feat(fase6.2): wrappers setRepartoHogar + getGastoHogarPorCategoria"
```

---

## Task 4: Configuración › Hogar — toggle reparto + límites-hogar por categoría

**Files:**
- Modify: `views/configuracion.html`

> La sección Hogar (`#cfgHogarSection` / `#cfgHogarBody`) fue creada en 6.1; su `render()` está en el IIFE `initHogarConfig` y se re-ejecuta en `hogar:changed`. Se le añaden dos bloques al final del `body.innerHTML` + sus listeners.

- [ ] **Step 1: Añadir el toggle de reparto y la lista de límites-hogar al render de la sección Hogar**

En `views/configuracion.html`, dentro de `initHogarConfig`'s `render()`, tras el bloque de aporte esperado, ampliar `body.innerHTML` y añadir listeners. El toggle de reparto:

```javascript
        // ── Modo de reparto ──
        var modo = (st.hogar && st.hogar.reparto) || '50_50';
        body.innerHTML +=
          '<div class="cfg-datos-separador"></div>' +
          '<p class="cfg-label">Reparto de gastos del hogar</p>' +
          '<div class="cfg-input-group">' +
            '<select id="cfgHogarReparto" class="cfg-select">' +
              '<option value="50_50"' + (modo === '50_50' ? ' selected' : '') + '>Mitad y mitad (50/50)</option>' +
              '<option value="proporcional"' + (modo === 'proporcional' ? ' selected' : '') + '>Proporcional al ingreso</option>' +
            '</select>' +
          '</div>';

        // ── Presupuestos del hogar por categoría (compartidas) ──
        var catsHogar = (await getCategorias('gasto')).filter(function (c) { return c.user_id == null; });
        body.innerHTML +=
          '<div class="cfg-datos-separador"></div>' +
          '<p class="cfg-label">Presupuesto del hogar por categoría (S/)</p>' +
          catsHogar.map(function (c) {
            var lim = (c.limite_mensual_hogar != null ? c.limite_mensual_hogar : '');
            return '<div class="cfg-input-group" data-catid="' + escHtml(c.id) + '">' +
              '<label class="cfg-label">' + escHtml(c.nombre) + '</label>' +
              '<input class="cfg-input cfg-hogar-limite" type="number" min="0" step="0.01" value="' + escHtml(String(lim)) + '">' +
              '<button type="button" class="btn btn-secondary btn-sm cfg-hogar-limite-save">Guardar</button>' +
            '</div>';
          }).join('');
```

> `render()` debe ser `async` (ya lo es si usa `await getEstadoHogar`; si no, marcarla `async` — `initHogarConfig`'s render puede volverse `async function render()` y llamarse con `render()` sin await, es seguro).

- [ ] **Step 2: Añadir los listeners (tras construir el innerHTML, dentro del mismo render)**

```javascript
        $('cfgHogarReparto').addEventListener('change', async function () {
          try { await setRepartoHogar(this.value); mostrarToast('Reparto actualizado', 3000); }
          catch (e) { mostrarToast((e && e.message) || 'No se pudo cambiar el reparto', 4000); }
        });
        Array.prototype.forEach.call(body.querySelectorAll('.cfg-hogar-limite-save'), function (btn) {
          btn.addEventListener('click', async function () {
            var grp = btn.closest('[data-catid]');
            var catId = grp.getAttribute('data-catid');
            var val = parseFloat(grp.querySelector('.cfg-hogar-limite').value);
            try {
              await updateCategoria(catId, { limite_mensual_hogar: (val > 0 ? val : null) });
              mostrarToast('Presupuesto del hogar guardado', 3000);
            } catch (e) { mostrarToast((e && e.message) || 'No se pudo guardar', 4000); }
          });
        });
```

- [ ] **Step 3: Verificar sintaxis del script**

Run: `awk '/<script>/{f=1;next} /<\/script>/{f=0} f' views/configuracion.html > /tmp/c.js && node --check /tmp/c.js && echo OK`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add views/configuracion.html
git commit -m "feat(fase6.2): Config Hogar — toggle reparto + presupuesto hogar por categoria"
```

---

## Task 5: Pasar `reparto` a los consumidores del balance

**Files:**
- Modify: `views/hogar.html`
- Modify: `views/dashboard.html`

- [ ] **Step 1: hogar.html — pasar el modo a calcularBalanceHogar**

En `views/hogar.html`, en `renderConHogar`, la llamada `window.calcularBalanceHogar(txs, liqs, uidActual, otro)` pasa a incluir el modo:

```javascript
        var modo = (estado.hogar && estado.hogar.reparto) || '50_50';
        bal = window.calcularBalanceHogar(txs, liqs, uidActual, otro, modo);
```

(La `var modo` va justo antes de la llamada, dentro del `if (otro && ...)`.)

- [ ] **Step 2: dashboard.html — pasar el modo en la card "quién debe qué"**

En `views/dashboard.html`, dentro de `cargarDeudaHogar`, la llamada `calcularBalanceHogar(txs, liqs, uid, otro)` pasa a:

```javascript
        const modo = (estado.hogar && estado.hogar.reparto) || '50_50';
        const bal  = calcularBalanceHogar(txs, liqs, uid, otro, modo);
```

- [ ] **Step 3: Verificar sintaxis de ambas vistas**

Run: `for f in views/hogar.html views/dashboard.html; do awk '/<script>/{f=1;next} /<\/script>/{f=0} f' "$f" > /tmp/x.js; node --check /tmp/x.js && echo "$f OK"; done`
Expected: ambos OK.

- [ ] **Step 4: Commit**

```bash
git add views/hogar.html views/dashboard.html
git commit -m "feat(fase6.2): balance quien-debe-que usa el modo de reparto del hogar"
```

---

## Task 6: Dashboard — barras de presupuesto del hogar

**Files:**
- Modify: `views/dashboard.html`

- [ ] **Step 1: Extender `renderPresupuestos` para añadir barras de hogar**

En `views/dashboard.html`, `renderPresupuestos(categorias, gastoPorCat)` (línea ~700) recibe un tercer argumento opcional `gastoHogarPorCat` y, cuando `tieneHogar()`, renderiza barras de presupuesto-hogar. Cambiar la firma y añadir, tras construir `rows` de presupuestos personales, las filas de hogar:

```javascript
    function renderPresupuestos(categorias, gastoPorCat, gastoHogarPorCat) {
      const card = $('dashPresupCard');
      const body = $('dashPresupBody');
      if (!card || !body) return;
      const lista = (categorias || []).filter((c) => Number(c.limite_mensual) > 0);
      const hay = (typeof tieneHogar === 'function') && tieneHogar();
      const listaHogar = hay ? (categorias || []).filter((c) => Number(c.limite_mensual_hogar) > 0) : [];
      if (!lista.length && !listaHogar.length) { card.style.display = 'none'; return; }
      card.style.display = '';

      function fila(cat, limite, gastado, etiquetaHogar) {
        const est = (typeof estadoPresupuesto === 'function') ? estadoPresupuesto(gastado, limite) : null;
        if (!est) return '';
        const color = /^#[0-9a-fA-F]{3,8}$/.test(cat.color) ? cat.color : '#c9a84c';
        const icon = (typeof iconoCategoria === 'function') ? iconoCategoria(cat.icono) : '';
        const badge = est.superado ? '<span class="dash-presup-badge">superado</span>' : '';
        const tagHogar = etiquetaHogar ? '<span class="dash-badge dash-badge--hogar">Hogar</span>' : '';
        return `<div class="dash-presup">
          <span class="cat-chip" style="--chip-color:${color}" aria-hidden="true">${icon}</span>
          <div class="dash-presup-main">
            <div class="dash-presup-head">
              <span class="dash-presup-nombre">${esc(cat.nombre || 'Categoría')}</span>
              ${tagHogar}${badge}
            </div>
            <span class="dash-presup-cifras">${esc(formatMonto(gastado))} / ${esc(formatMonto(limite))}</span>
            <div class="dash-presup-bar" role="progressbar"
                 aria-valuenow="${est.ancho}" aria-valuemin="0" aria-valuemax="100"
                 aria-label="Presupuesto de ${esc(cat.nombre || 'categoría')}: ${est.pctReal}%">
              <div class="dash-presup-bar-fill dash-presup-bar-fill--${est.color}" style="width:${est.ancho}%;"></div>
            </div>
          </div>
        </div>`;
      }

      const rowsPersonal = lista.map((cat) =>
        fila(cat, Number(cat.limite_mensual) || 0, Number((gastoPorCat || {})[cat.id] || 0), false)).join('');
      const rowsHogar = listaHogar.map((cat) =>
        fila(cat, Number(cat.limite_mensual_hogar) || 0, Number((gastoHogarPorCat || {})[cat.id] || 0), true)).join('');
      body.innerHTML = rowsPersonal + rowsHogar;
    }
```

- [ ] **Step 2: Alimentar `gastoHogarPorCat` desde la carga del dashboard**

En el `cargar()` del dashboard, añadir `getGastoHogarPorCategoria(mes, anio)` al `Promise.allSettled` y pasarlo a `renderPresupuestos`. Localizar la llamada actual `renderPresupuestos(categoriasGasto.value, gMap)` y cambiarla a incluir el mapa de hogar:

```javascript
      // junto a las otras cargas del Promise.allSettled, añadir:
      //   getGastoHogarPorCategoria(mes, anio)
      // y capturar su resultado (p.ej. gastosCatHogar). Luego:
      if (categoriasGasto.status === 'fulfilled') {
        const gMap  = gastosCat.status === 'fulfilled' ? gastosCat.value : {};
        const gMapH = gastosCatHogar.status === 'fulfilled' ? gastosCatHogar.value : {};
        renderPresupuestos(categoriasGasto.value, gMap, gMapH);
      }
```

> Añadir `gastosCatHogar` a la desestructuración del `Promise.allSettled` en la MISMA posición en que se agrega `getGastoHogarPorCategoria(mes, anio)` al array. Mantener el orden posicional consistente.

- [ ] **Step 3: Verificar sintaxis**

Run: `awk '/<script>/{f=1;next} /<\/script>/{f=0} f' views/dashboard.html > /tmp/d.js && node --check /tmp/d.js && echo OK`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add views/dashboard.html
git commit -m "feat(fase6.2): barras de presupuesto del hogar en dashboard (gated por tieneHogar)"
```

---

## Task 7: Alertas in-app de presupuesto del hogar

**Files:**
- Modify: `js/alerts.js`

- [ ] **Step 1: Añadir un chequeo de presupuesto-hogar en `_alertasCategorias`**

En `js/alerts.js`, `_alertasCategorias(mes, anio)` (línea ~86) itera categorías comparando `limite_mensual` vs gasto (personal). Añadir, para las categorías con `limite_mensual_hogar > 0`, un chequeo análogo contra el gasto del hogar de la categoría, generando alertas etiquetadas "hogar".

Primero, obtener el gasto hogar por categoría al inicio de la función (junto a la obtención del gasto personal actual):

```javascript
  const gastoHogar = (typeof getGastoHogarPorCategoria === 'function')
    ? await getGastoHogarPorCategoria(mes, anio) : {};
```

Luego, dentro del `categorias.forEach((cat) => { ... })`, tras el bloque del límite personal, añadir el del hogar:

```javascript
    const limiteH = Number(cat.limite_mensual_hogar);
    if (limiteH > 0) {
      const gastadoH = Number(gastoHogar[cat.id] || 0);
      const ratioH = gastadoH / limiteH;
      if (ratioH >= 1.0) {
        alertas.push({ tipo: 'critica', categoria: cat.nombre, ambito: 'hogar',
          mensaje: 'Presupuesto del hogar de ' + cat.nombre + ' superado' });
      } else if (ratioH >= 0.8) {
        alertas.push({ tipo: 'suave', categoria: cat.nombre, ambito: 'hogar',
          mensaje: 'Presupuesto del hogar de ' + cat.nombre + ' al ' + Math.round(ratioH * 100) + '%' });
      }
    }
```

> Ajustar la forma del objeto `alertas.push({...})` para que coincida EXACTAMENTE con la que ya usa el bloque personal en esta función (mismos campos). Inspeccionar el push existente (~línea 103-115) y replicar su estructura, añadiendo solo `ambito: 'hogar'` para distinguir.

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check js/alerts.js && echo OK`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add js/alerts.js
git commit -m "feat(fase6.2): alerta in-app de presupuesto del hogar cruzado"
```

---

## Task 8: Service worker + verificación + deploy

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: Bump de versión**

En `sw.js`, subir `SHELL_VERSION` de `'v19'` a `'v20'`. (No hay assets JS nuevos; los cambios son a archivos ya precacheados.)

Run: `grep -n "SHELL_VERSION = " sw.js`
Expected: `v20`.

- [ ] **Step 2: Suite JS completa**

Run: `node --test test/*.test.mjs`
Expected: todo verde (incluye los 3 tests nuevos de balance proporcional).

- [ ] **Step 3: Commit**

```bash
git add sw.js
git commit -m "feat(fase6.2): bump SHELL_VERSION v20"
```

- [ ] **Step 4: Aplicar migración en v2 + verificación manual (2 cuentas)**

1. Revisar a mano `supabase/migrations/20260701_fase6_2_hogar.sql` y aplicarlo en el SQL Editor de v2.
2. Con hogar: en Config › Hogar, fijar un presupuesto-hogar a una categoría compartida → barra en el dashboard (vs gasto del hogar); cruzar el umbral → alerta in-app.
3. Cambiar el reparto a "proporcional" con ingresos hogar desiguales → el neto "quién debe qué" (dashboard + #hogar) cambia acorde; verificar que la disolución NO cambió.

- [ ] **Step 5: Deploy**

```bash
git push origin v2
```
Verificar: `curl -sL https://nestra-8rl.pages.dev/sw.js | grep SHELL_VERSION` → `v20`. (Confirmar con el usuario antes del push — outward-facing.)

---

## Self-Review (cobertura del spec)

- **Parte 1 (presupuesto hogar):** Task 1 (columna), 3 (helper), 4 (config UI), 6 (dashboard), 7 (alertas). ✓
- **Parte 2 (reparto):** Task 1 (columna + RPC), 2 (balance modo), 3 (wrapper), 4 (toggle), 5 (consumidores). ✓
- **SQL:** Task 1. ✓ · **Testing:** Task 2 (JS) + Task 8 (manual/SQL). ✓ · **sw:** Task 8. ✓

**Puntos a confirmar contra el código real en ejecución (marcados, no son fallos):**
- Estructura exacta del objeto `alertas.push` en `_alertasCategorias` (Task 7 Step 1).
- Posición en el `Promise.allSettled` del dashboard para `gastosCatHogar` (Task 6 Step 2).
- Que `render()` de `initHogarConfig` sea `async` para el `await getCategorias` (Task 4 Step 1).
