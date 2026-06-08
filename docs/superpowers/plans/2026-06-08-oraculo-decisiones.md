# Oráculo Financiero (decisiones.html) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir `views/decisiones.html` — un oráculo que responde "¿puedo gastar S/ X en [categoría]?" con veredicto razonado, monto alternativo y estado general del hogar.

**Architecture:** Vista nueva con IIFE. Dos helpers nuevos en `js/db.js` (`_rangoSemana`, `getGastoCategoria`). La vista recolecta métricas vía db.js y aplica una función de dictamen pura (`dictaminar`) que devuelve uno de 5 niveles. UI mobile-first con tarjeta de veredicto (tinte semáforo + ícono + texto), banner de estado general, y a11y por `aria-live`.

**Tech Stack:** Vanilla JS (IIFE en vista, ES6 en db.js), Supabase vía db.js, sin Chart.js, sin framework de tests — verificación en navegador con harness de stubs.

**Reference spec:** `docs/superpowers/specs/2026-06-08-oraculo-decisiones-design.md`

**Convenciones verificadas:** `getCategorias('gasto')` → `[{id,nombre,limite_mensual,color}]`; categoría de ahorro = `nombre === 'Ahorro'`. `getBalanceHogar(mes,anio)`/`getBalancePersonal(mes,anio)` → `{ingresos,gastos,balance}`. `getMetas(ambito)` → `metas_con_progreso [{nombre,ambito,monto_objetivo,monto_actual,fecha_limite,es_fondo_emergencia}]`. `getTransacciones({categoria_id,ambito,tipo,fecha_desde,fecha_hasta})`. Helpers globales: `mesActual()`→`{mes,anio}`, `formatMonto(n)`. Ruta `decisiones` ya en router. `_rangoMes` en db.js como referencia de formato.

---

## File Structure

| File | Change |
|---|---|
| `js/db.js` | Helpers nuevos `_rangoSemana()` y `getGastoCategoria()` |
| `views/decisiones.html` | **Nuevo** — markup (estado general, form, veredicto), CSS, IIFE (carga categorías, toggle ámbito, recolecta métricas, dictamina, renderiza) |

---

### Task 1: Helpers en db.js — `_rangoSemana` y `getGastoCategoria`

**Files:**
- Modify: `js/db.js` (tras `_rangoMes`, ~línea 30; y junto a las funciones de lectura)

- [ ] **Step 1: Añadir `_rangoSemana` tras `_rangoMes`**

Insertar inmediatamente después de la función `_rangoMes` (línea ~30):

```js
// _rangoSemana(ref?) — lunes 00:00 de la semana actual → hoy (hora local).
// Semana ISO (lunes primer día). ref: Date opcional (default: hoy).
// Retorna { desde: 'YYYY-MM-DD', hasta: 'YYYY-MM-DD', diasTranscurridos }.
function _rangoSemana(ref) {
  const hoy = ref ? new Date(ref) : new Date();
  const dow = hoy.getDay();              // 0=domingo … 6=sábado
  const offsetLunes = (dow + 6) % 7;     // días desde el lunes
  const lunes = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - offsetLunes);
  const fmt = (d) => d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
  return { desde: fmt(lunes), hasta: fmt(hoy), diasTranscurridos: offsetLunes + 1 };
}
```

- [ ] **Step 2: Añadir `getGastoCategoria` junto a las lecturas (tras `getCategorias`, ~línea 370)**

```js
// getGastoCategoria(categoria_id, ambito, fecha_desde, fecha_hasta) — suma de
// GASTOS de una categoría en el rango y ámbito dados. Para el oráculo.
// Returns: número (0 en error o sin gastos).
async function getGastoCategoria(categoria_id, ambito, fecha_desde, fecha_hasta) {
  try {
    const txs = await getTransacciones({
      categoria_id: categoria_id,
      ambito: ambito,
      tipo: 'gasto',
      fecha_desde: fecha_desde,
      fecha_hasta: fecha_hasta,
    });
    return (txs || []).reduce((acc, t) => acc + Number(t.monto), 0);
  } catch (err) {
    console.error('Error en getGastoCategoria():', err.message || err);
    return 0;
  }
}
```

- [ ] **Step 3: Verificar en navegador**

`preview_start` (config `nestra`). Vía `preview_eval`:
```js
({ rangoSemana: typeof _rangoSemana, gastoCat: typeof getGastoCategoria, semana: _rangoSemana(new Date('2026-06-08')) })
```
Esperado: ambos `"function"`; `semana.desde` = `"2026-06-08"` (8 jun 2026 es lunes), `semana.diasTranscurridos` = 1. Probar también un miércoles: `_rangoSemana(new Date('2026-06-10'))` → `desde:"2026-06-08"`, `diasTranscurridos:3`.

- [ ] **Step 4: Commit**

```bash
git add js/db.js
git commit -m "feat(decisiones): add _rangoSemana and getGastoCategoria helpers"
```

---

### Task 2: Scaffold de decisiones.html — markup, CSS, carga de categorías y toggle

**Files:**
- Create: `views/decisiones.html`

- [ ] **Step 1: Crear el archivo con markup + CSS + IIFE base**

```html
<div class="dec">
  <header class="dec-header">
    <h1 class="dec-title">Oráculo</h1>
    <p class="dec-sub">Consulta antes de gastar</p>
  </header>

  <div class="dec-estado" id="decEstado" data-salud="" aria-live="polite"></div>

  <form class="dec-form" id="decForm">
    <div class="dec-field">
      <label class="dec-label" for="decMonto">¿Cuánto quieres gastar?</label>
      <div class="dec-monto">
        <span class="dec-monto-pre" aria-hidden="true">S/</span>
        <input class="dec-monto-input" id="decMonto" type="text" inputmode="decimal"
               placeholder="0.00" autocomplete="off" />
      </div>
    </div>
    <div class="dec-field">
      <label class="dec-label" for="decCat">¿En qué categoría?</label>
      <select class="dec-select" id="decCat"></select>
    </div>
    <div class="dec-field">
      <span class="dec-label">¿Ámbito?</span>
      <div class="dec-toggle" id="decAmbito" role="group" aria-label="Ámbito">
        <button type="button" class="dec-seg dec-seg--active" data-ambito="hogar" aria-pressed="true">Hogar</button>
        <button type="button" class="dec-seg" data-ambito="personal" aria-pressed="false">Personal</button>
      </div>
    </div>
    <button type="submit" class="btn btn-primary dec-submit">Consultar al oráculo</button>
  </form>

  <section class="dec-veredicto" id="decVeredicto" data-nivel="" aria-live="polite" hidden></section>
</div>

<style>
  .dec { max-width: 640px; margin: 0 auto; padding: var(--space-lg) var(--space-md) var(--space-xl); }
  .dec-header { margin-bottom: var(--space-lg); }
  .dec-title { font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); color: var(--text-dark); margin: 0; }
  .dec-sub { color: var(--text-secondary); font-size: var(--font-size-sm); margin: 2px 0 0; }

  /* Estado general (banner) */
  .dec-estado { display: none; padding: var(--space-md); border-radius: var(--radius-md); margin-bottom: var(--space-lg); font-size: var(--font-size-sm); border: 1px solid var(--border-light); }
  .dec-estado[data-salud] { display: block; }
  .dec-estado[data-salud=""] { display: none; }
  .dec-estado-titulo { font-weight: var(--font-weight-semibold); color: var(--text-dark); display: flex; align-items: center; gap: var(--space-sm); margin-bottom: 4px; }
  .dec-estado-focos { margin: 4px 0 0; padding-left: 1.1em; color: var(--text-secondary); }
  .dec-estado[data-salud="sano"]     { background: rgba(16,185,129,0.10); }
  .dec-estado[data-salud="ajustado"] { background: rgba(245,158,11,0.10); }
  .dec-estado[data-salud="riesgo"]   { background: rgba(239,68,68,0.10); }

  /* Form */
  .dec-form { display: flex; flex-direction: column; gap: var(--space-lg); background: var(--bg-light); border: 1px solid var(--border-light); border-radius: var(--radius-lg); padding: var(--space-lg); box-shadow: var(--shadow-sm); }
  .dec-field { display: flex; flex-direction: column; gap: var(--space-sm); }
  .dec-label { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--text-dark); }
  .dec-monto { display: flex; align-items: center; border: 1px solid var(--border-light); border-radius: var(--radius-md); overflow: hidden; }
  .dec-monto-pre { padding: 0 var(--space-md); color: var(--text-secondary); background: var(--bg-light-secondary); align-self: stretch; display: flex; align-items: center; }
  .dec-monto-input { flex: 1; border: none; padding: 12px var(--space-md); font-size: var(--font-size-lg); min-height: 44px; background: transparent; color: var(--text-dark); }
  .dec-monto-input:focus { outline: 2px solid var(--color-primary); outline-offset: -2px; }
  .dec-select { min-height: 44px; padding: 0 var(--space-md); border: 1px solid var(--border-light); border-radius: var(--radius-md); background: var(--bg-light); color: var(--text-dark); font-size: var(--font-size-base); }

  .dec-toggle { display: flex; gap: 4px; background: var(--bg-light-secondary); padding: 4px; border-radius: var(--radius-md); }
  .dec-seg { flex: 1; min-height: 44px; border: none; background: transparent; border-radius: var(--radius-sm); color: var(--text-secondary); font-weight: var(--font-weight-semibold); cursor: pointer; }
  .dec-seg--active { background: var(--color-primary); color: #fff; }
  .dec-submit { min-height: 48px; }

  /* Veredicto */
  .dec-veredicto { margin-top: var(--space-lg); border-radius: var(--radius-lg); padding: var(--space-lg); border: 1px solid var(--border-light); }
  .dec-veredicto[hidden] { display: none; }
  .dec-ver-cabecera { display: flex; align-items: center; gap: var(--space-sm); font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--text-dark); }
  .dec-ver-icono { font-size: 1.6em; line-height: 1; }
  .dec-ver-razon { margin: var(--space-sm) 0 0; color: var(--text-dark); }
  .dec-ver-cifra { margin: var(--space-md) 0 0; font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); color: var(--text-dark); }
  .dec-ver-acciones { display: flex; flex-direction: column; gap: var(--space-sm); margin-top: var(--space-md); }
  .dec-ver-detalle { margin-top: var(--space-md); font-size: var(--font-size-sm); color: var(--text-secondary); }
  .dec-ver-detalle summary { cursor: pointer; color: var(--color-primary); }
  .dec-ver-detalle ul { margin: var(--space-sm) 0 0; padding-left: 1.1em; }

  .dec-veredicto[data-nivel="recomendable"] { background: rgba(16,185,129,0.10); }
  .dec-veredicto[data-nivel="cautela"]      { background: rgba(245,158,11,0.10); }
  .dec-veredicto[data-nivel="no"]           { background: rgba(239,68,68,0.10); }
  .dec-veredicto[data-nivel="sin-presupuesto"] { background: var(--bg-light-secondary); }
  .dec-veredicto[data-nivel="ahorro"]       { background: rgba(16,185,129,0.10); }

  .btn-ghost { background: transparent; border: 1px solid var(--border-light); color: var(--text-secondary); min-height: 44px; border-radius: var(--radius-md); cursor: pointer; }

  @media (prefers-reduced-motion: reduce) { .dec-seg { transition: none; } }
</style>

<script>
  (function () {
    'use strict';
    function $(id) { return document.getElementById(id); }
    function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

    var estado = { ambito: 'hogar' };
    var catsPorId = {};   // id → categoría
    var hoy = mesActual();

    // ── Cargar categorías de gasto en el select ───────────────
    async function cargarCategorias() {
      var cats = await getCategorias('gasto');
      catsPorId = {};
      var sel = $('decCat');
      sel.innerHTML = '';
      (cats || []).forEach(function (c) {
        catsPorId[c.id] = c;
        var opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.nombre;
        sel.appendChild(opt);
      });
    }

    // ── Toggle de ámbito ──────────────────────────────────────
    Array.prototype.forEach.call(document.querySelectorAll('#decAmbito .dec-seg'), function (b) {
      b.addEventListener('click', function () {
        estado.ambito = b.getAttribute('data-ambito');
        Array.prototype.forEach.call(document.querySelectorAll('#decAmbito .dec-seg'), function (x) {
          var on = x === b;
          x.classList.toggle('dec-seg--active', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      });
    });

    // Los stubs de evaluación y estado general se completan en Tasks 3 y 4.
    $('decForm').addEventListener('submit', function (e) { e.preventDefault(); });

    // ── Arranque ──────────────────────────────────────────────
    cargarCategorias();
  })();
</script>
```

- [ ] **Step 2: Verificar scaffold**

`preview_eval`:
```js
(async function(){ var d=document.createElement('div'); d.innerHTML=await (await fetch('views/decisiones.html')).text(); return { form: !!d.querySelector('#decForm'), monto: !!d.querySelector('#decMonto'), cat: !!d.querySelector('#decCat'), toggle: d.querySelectorAll('#decAmbito .dec-seg').length, veredicto: !!d.querySelector('#decVeredicto') }; })()
```
Esperado: `{ form:true, monto:true, cat:true, toggle:2, veredicto:true }`.

- [ ] **Step 3: Commit**

```bash
git add views/decisiones.html
git commit -m "feat(decisiones): scaffold oracle view — form, verdict shell, ambito toggle"
```

---

### Task 3: Algoritmo del oráculo + render del veredicto

**Files:**
- Modify: `views/decisiones.html` (bloque `<script>`)

- [ ] **Step 1: Añadir recolección de métricas, dictamen y render**

Reemplazar la línea stub `$('decForm').addEventListener('submit', function (e) { e.preventDefault(); });` por:

```js
    // ── Recolecta las métricas necesarias para una consulta ───
    async function recolectar(cat, ambito) {
      var rMes = { desde: hoy.anio + '-' + String(hoy.mes).padStart(2, '0') + '-01',
                   hasta: _rangoSemana().hasta };
      var rSem = _rangoSemana();
      var diasMes = new Date(hoy.anio, hoy.mes, 0).getDate();
      var diaHoy = new Date().getDate();

      var resultados = await Promise.all([
        getGastoCategoria(cat.id, ambito, rMes.desde, rMes.hasta),
        getGastoCategoria(cat.id, ambito, rSem.desde, rSem.hasta),
        (ambito === 'personal' ? getBalancePersonal(hoy.mes, hoy.anio) : getBalanceHogar(hoy.mes, hoy.anio)),
        getMetas(ambito),
      ]);
      var gastoMes = resultados[0], gastoSemana = resultados[1], balance = resultados[2];
      var metasPend = (resultados[3] || []).filter(function (x) {
        return Number(x.monto_actual) < Number(x.monto_objetivo);
      });

      // colchón mensual de ahorro comprometido por metas con fecha
      var colchon = 0, metaCritica = null;
      metasPend.forEach(function (mt) {
        if (!mt.fecha_limite) return;
        var hoyD = new Date();
        var limD = new Date(mt.fecha_limite);
        var meses = Math.max((limD.getFullYear() - hoyD.getFullYear()) * 12 + (limD.getMonth() - hoyD.getMonth()), 1);
        var faltante = Number(mt.monto_objetivo) - Number(mt.monto_actual);
        colchon += faltante / meses;
        if (!metaCritica || meses <= 2) metaCritica = mt.nombre;
      });

      return {
        limite: Number(cat.limite_mensual),
        gastoMes: gastoMes,
        gastoSemana: gastoSemana,
        diasMes: diasMes,
        diaHoy: diaHoy,
        diasSemana: rSem.diasTranscurridos,
        ingresos: balance.ingresos, gastos: balance.gastos,
        colchon: colchon, metaCritica: metaCritica,
      };
    }

    // ── Dictamen puro a partir de monto + métricas + categoría ─
    function dictaminar(monto, m, cat) {
      if (cat.nombre === 'Ahorro') {
        return { nivel: 'ahorro', razon: 'Estás ahorrando, no gastando. Adelante.' };
      }
      if (cat.limite_mensual == null) {
        return { nivel: 'sin-presupuesto', razon: 'Define un presupuesto para ' + cat.nombre + ' y podré aconsejarte.' };
      }
      var margen = m.limite - m.gastoMes;
      var disponible = m.ingresos - m.gastos - m.colchon;
      var sugerido = Math.max(0, Math.min(margen, disponible));
      var objetivoSemanal = m.limite * 7 / m.diasMes;
      var ritmoSemanal = m.gastoSemana / Math.max(m.diasSemana, 1);
      var aceleracion = (ritmoSemanal * 7) > objetivoSemanal;

      var rompeColchon = (m.gastos + monto) > (m.ingresos - m.colchon);
      if (monto > margen || rompeColchon) {
        var causa = monto > margen
          ? 'Superarías tu presupuesto de ' + cat.nombre + ' por ' + formatMonto(monto - margen) + '.'
          : 'Comprometerías el ahorro de tu meta ' + (m.metaCritica || 'del hogar') + '.';
        return { nivel: 'no', razon: causa, sugerido: sugerido, margen: margen };
      }
      if (monto <= sugerido && aceleracion) {
        return { nivel: 'cautela', razon: 'Cabe en tu presupuesto, pero vas rápido esta semana.', sugerido: sugerido, margen: margen };
      }
      return { nivel: 'recomendable', razon: 'Te alcanza. Usarías ' + Math.round((m.gastoMes + monto) / m.limite * 100) + '% de tu presupuesto de ' + cat.nombre + '.', sugerido: sugerido, margen: margen };
    }

    // ── Render de la tarjeta de veredicto ─────────────────────
    var ICONOS = { recomendable: '✅', cautela: '🟡', no: '⚠️', 'sin-presupuesto': '⚙️', ahorro: '💰' };
    var TITULOS = { recomendable: 'Recomendable', cautela: 'Con cautela', no: 'No recomendable', 'sin-presupuesto': 'Fija un presupuesto primero', ahorro: 'Adelante' };

    function renderVeredicto(v, monto, m, cat) {
      var box = $('decVeredicto');
      box.setAttribute('data-nivel', v.nivel);
      var html = '<div class="dec-ver-cabecera"><span class="dec-ver-icono" aria-hidden="true">' + ICONOS[v.nivel] + '</span>' + TITULOS[v.nivel] + '</div>' +
        '<p class="dec-ver-razon">' + v.razon + '</p>';
      if (v.nivel === 'no' || v.nivel === 'cautela') {
        html += '<p class="dec-ver-cifra">Te sugiero gastar hasta ' + formatMonto(v.sugerido) + '.</p>';
      }
      if (m && v.nivel !== 'sin-presupuesto' && v.nivel !== 'ahorro') {
        html += '<details class="dec-ver-detalle"><summary>Ver desglose</summary><ul>' +
          '<li>Presupuesto de ' + cat.nombre + ': ' + formatMonto(m.limite) + '</li>' +
          '<li>Gastado este mes: ' + formatMonto(m.gastoMes) + '</li>' +
          '<li>Margen restante: ' + formatMonto(m.limite - m.gastoMes) + '</li>' +
          '<li>Ahorro comprometido (metas): ' + formatMonto(m.colchon) + '</li>' +
          '</ul></details>';
      }
      html += '<div class="dec-ver-acciones">';
      if (v.nivel === 'sin-presupuesto') {
        html += '<a class="btn btn-primary" href="#configuracion">Fijar presupuesto</a>';
      } else {
        html += '<button type="button" class="btn-ghost" id="decRegistrar">Registrar de todos modos</button>';
      }
      html += '</div>';
      box.innerHTML = html;
      box.hidden = false;
      var reg = $('decRegistrar');
      if (reg) reg.addEventListener('click', function () {
        if (typeof abrirModalTransaccion === 'function') abrirModalTransaccion();
        else window.location.hash = '#transaccion';
      });
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      box.focus && box.setAttribute('tabindex', '-1');
    }

    $('decForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var monto = parseFloat(String($('decMonto').value).replace(',', '.'));
      var cat = catsPorId[$('decCat').value];
      if (!cat || !(monto > 0)) {
        renderVeredicto({ nivel: 'sin-presupuesto', razon: 'Ingresa un monto y una categoría válidos.' }, 0, null, cat || { nombre: '' });
        return;
      }
      if (cat.nombre === 'Ahorro' || cat.limite_mensual == null) {
        renderVeredicto(dictaminar(monto, { limite: NaN }, cat), monto, null, cat);
        return;
      }
      var m = await recolectar(cat, estado.ambito);
      renderVeredicto(dictaminar(monto, m, cat), monto, m, cat);
    });
```

- [ ] **Step 2: Verificar los 5 veredictos (harness)**

Harness que inyecta la vista, stubea db.js y ejecuta consultas. Probar: monto bajo→recomendable; monto > margen→no; categoría sin límite→sin-presupuesto; categoría Ahorro→ahorro. (Código del harness completo en Task 5 Step 1.)

- [ ] **Step 3: Commit**

```bash
git add views/decisiones.html
git commit -m "feat(decisiones): oracle algorithm and verdict card render"
```

---

### Task 4: Estado general del hogar

**Files:**
- Modify: `views/decisiones.html` (bloque `<script>`)

- [ ] **Step 1: Añadir cálculo + render del estado general**

Insertar antes de `cargarCategorias();` (la línea de arranque), y llamar tras cargar categorías. Añadir:

```js
    // ── Estado general del hogar ──────────────────────────────
    async function renderEstadoGeneral() {
      var cats = await getCategorias('gasto');
      var conLimite = (cats || []).filter(function (c) { return c.limite_mensual != null && c.nombre !== 'Ahorro'; });
      var rMes = { desde: hoy.anio + '-' + String(hoy.mes).padStart(2, '0') + '-01', hasta: _rangoSemana().hasta };

      var usos = await Promise.all(conLimite.map(function (c) {
        return getGastoCategoria(c.id, 'hogar', rMes.desde, rMes.hasta).then(function (g) {
          return { nombre: c.nombre, pct: Number(c.limite_mensual) > 0 ? g / Number(c.limite_mensual) : 0 };
        });
      }));
      var metas = await getMetas('hogar');
      var metasRiesgo = (metas || []).filter(function (mt) {
        if (Number(mt.monto_actual) >= Number(mt.monto_objetivo) || !mt.fecha_limite) return false;
        var hoyD = new Date(), limD = new Date(mt.fecha_limite);
        var meses = (limD.getFullYear() - hoyD.getFullYear()) * 12 + (limD.getMonth() - hoyD.getMonth());
        return meses <= 1;
      });

      var rojas = usos.filter(function (u) { return u.pct > 1; });
      var ambar = usos.filter(function (u) { return u.pct >= 0.8 && u.pct <= 1; });
      var salud = (rojas.length || metasRiesgo.length) ? 'riesgo' : (ambar.length ? 'ajustado' : 'sano');

      var focos = [];
      rojas.slice(0, 2).forEach(function (u) { focos.push(u.nombre + ' superó su presupuesto'); });
      ambar.slice(0, 2).forEach(function (u) { focos.push(u.nombre + ' cerca del límite'); });
      metasRiesgo.slice(0, 1).forEach(function (mt) { focos.push('Meta ' + mt.nombre + ' en riesgo de plazo'); });

      var titulos = { sano: '🟢 Hogar sano', ajustado: '🟡 Mes ajustado', riesgo: '🔴 En riesgo' };
      var box = $('decEstado');
      box.setAttribute('data-salud', salud);
      box.innerHTML = '<div class="dec-estado-titulo">' + titulos[salud] + '</div>' +
        (focos.length ? '<ul class="dec-estado-focos"><li>' + focos.join('</li><li>') + '</li></ul>'
                      : '<p class="dec-estado-focos">Todo dentro de presupuesto este mes.</p>');
    }
```

Y cambiar el arranque de:
```js
    cargarCategorias();
```
a:
```js
    cargarCategorias();
    renderEstadoGeneral();
```

- [ ] **Step 2: Verificar estado general (harness)**

Con stubs donde una categoría supera el límite → `data-salud="riesgo"`. (Incluido en el harness de Task 5.)

- [ ] **Step 3: Commit**

```bash
git add views/decisiones.html
git commit -m "feat(decisiones): household general status banner"
```

---

### Task 5: Verificación integral + móvil

**Files:**
- Verify only (ajustes inline si hace falta)

- [ ] **Step 1: Harness de los 5 veredictos + estado general**

`preview_start`. `preview_eval`:
```js
(async function(){
  var html = await (await fetch('views/decisiones.html')).text();
  var styleM = html.match(/<style>([\s\S]*?)<\/style>/); var scriptM = html.match(/<script>([\s\S]*?)<\/script>/);
  var markup = html.replace(/<style>[\s\S]*?<\/style>/,'').replace(/<script>[\s\S]*?<\/script>/,'');
  var host=document.getElementById('dh'); if(host) host.remove();
  host=document.createElement('div'); host.id='dh';
  var st=document.createElement('style'); st.textContent=styleM[1]; host.appendChild(st);
  var w=document.createElement('div'); w.innerHTML=markup; host.appendChild(w); document.body.appendChild(host);
  var P=function(v){return Promise.resolve(v);};
  window.getCategorias=function(){ return P([
    {id:1,nombre:'Comida',limite_mensual:500,color:null},
    {id:2,nombre:'Lujo',limite_mensual:null,color:null},
    {id:3,nombre:'Ahorro',limite_mensual:null,color:null}
  ]); };
  window.getGastoCategoria=function(id){ return P(id===1?480:0); }; // Comida casi al tope
  window.getBalanceHogar=function(){ return P({ingresos:3000,gastos:1500,balance:1500}); };
  window.getBalancePersonal=function(){ return P({ingresos:800,gastos:400,balance:400}); };
  window.getMetas=function(){ return P([{nombre:'Viaje',ambito:'hogar',monto_objetivo:5000,monto_actual:2000,fecha_limite:'2026-12-31'}]); };
  try { (0,eval)(scriptM[1]); } catch(e){ return {runError:String(e)}; }
  await new Promise(function(r){ setTimeout(r,400); });
  function consultar(monto, catId){ $D('decMonto').value=String(monto); $D('decCat').value=String(catId); $D('decForm').dispatchEvent(new Event('submit',{cancelable:true})); }
  function $D(id){ return document.querySelector('#dh #'+id); }
  var out = {};
  // sin presupuesto (Lujo)
  consultar(50, 2); await new Promise(function(r){ setTimeout(r,300); }); out.lujo = document.querySelector('#dh #decVeredicto').getAttribute('data-nivel');
  // ahorro
  consultar(50, 3); await new Promise(function(r){ setTimeout(r,300); }); out.ahorro = document.querySelector('#dh #decVeredicto').getAttribute('data-nivel');
  // no recomendable (Comida margen 20, pido 100)
  consultar(100, 1); await new Promise(function(r){ setTimeout(r,400); }); out.excede = document.querySelector('#dh #decVeredicto').getAttribute('data-nivel');
  // recomendable (Comida margen 20, pido 10)
  consultar(10, 1); await new Promise(function(r){ setTimeout(r,400); }); out.cabe = document.querySelector('#dh #decVeredicto').getAttribute('data-nivel');
  out.estadoSalud = document.querySelector('#dh #decEstado').getAttribute('data-salud');
  var h=document.getElementById('dh'); if(h) h.remove();
  return out;
})()
```
Esperado: `lujo:'sin-presupuesto'`, `ahorro:'ahorro'`, `excede:'no'`, `cabe:'recomendable'` (o `'cautela'` si dispara aceleración), `estadoSalud:'ajustado'` (Comida 96%). Revisar `preview_console_logs` (error) = cero.

- [ ] **Step 2: Verificar móvil**

`preview_resize` preset `mobile`. Re-inyectar harness, `preview_screenshot`. Confirmar: form a ancho completo, toggle 2 segmentos 50%, monto con prefijo S/, tarjeta de veredicto a ancho completo con color por nivel. Sin overflow horizontal: `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.

- [ ] **Step 3: Verificar a11y (aria-live)**

`preview_eval`: confirmar `#decVeredicto` tiene `aria-live="polite"` y `#decEstado` también. Confirmar que el veredicto incluye texto (no solo color): la cabecera contiene la palabra del título (`Recomendable`/`No recomendable`/etc.).

- [ ] **Step 4: Commit final (si hubo ajustes)**

```bash
git add views/decisiones.html js/db.js
git commit -m "fix(decisiones): adjustments after full verification"
```

---

## Self-Review

**Spec coverage:**
- Helpers `_rangoSemana` (lunes-domingo, local) + `getGastoCategoria` → Task 1 ✅
- Consulta puntual (monto, categoría, ámbito) → Task 2 form + Task 3 submit ✅
- Algoritmo Gasto Máximo Sugerido (margen, colchón, disponible, sugerido) → Task 3 `recolectar`+`dictaminar` ✅
- 5 veredictos con orden de evaluación (Ahorro→sin-presupuesto→no→cautela→recomendable) → Task 3 `dictaminar` ✅
- Excepción Ahorro = nombre 'Ahorro' → Task 3 ✅
- Bloqueo suave sin presupuesto + CTA a configuración → Task 3 render ✅
- Estado general (Sano/Ajustado/En riesgo + focos) → Task 4 ✅
- Personal + hogar (balance + metas por ámbito) → Task 3 `recolectar` ✅
- UI: jerarquía veredicto (ícono+título→razón→cifra→desglose) → Task 3 render ✅
- Microcopy sentence case, sin mayúsculas, causa concreta → Task 3 textos ✅
- A11y color: ícono+texto, `aria-live`, tinte con texto de alto contraste → Task 2 CSS + Task 3 render ✅
- "Registrar igual" botón fantasma → Task 3 render ✅
- Mobile-first, tap targets 44px → Task 2 CSS ✅
- Form: prefijo S/, inputmode decimal, select nativo, toggle segmentado → Task 2 ✅

**Placeholder scan:** sin TBD/TODO; los "stubs" de Task 2 se reemplazan con código completo en Tasks 3-4.

**Type consistency:** `recolectar` devuelve `{limite,gastoMes,gastoSemana,diasMes,diaHoy,diasSemana,ingresos,gastos,colchon,metaCritica}`, consumido idénticamente por `dictaminar` y `renderVeredicto`. Niveles `recomendable|cautela|no|sin-presupuesto|ahorro` consistentes entre `dictaminar`, `ICONOS`, `TITULOS`, CSS `[data-nivel]`. `getGastoCategoria(id,ambito,desde,hasta)` firma idéntica en db.js (Task 1) y llamadas (Tasks 3-4).

**Riesgos anotados:**
- `getMetas` debe traer `ambito` y `fecha_limite` (los trae: `metas_con_progreso`). Metas sin fecha se excluyen del colchón.
- `recolectar` usa `_rangoSemana().hasta` como "hoy"; coherente con el rango del mes (mes-a-la-fecha).
- Líneas absolutas pueden variar; localizar por nombre de función/identificador.
