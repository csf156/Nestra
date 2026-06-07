# Secciones Personal/Hogar en Gráficos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir un toggle segmentado Hogar|Personal a `views/graficos.html` que cambia el ámbito de datos y la selección de gráficos, con barra de controles sticky y refuerzo mobile-first.

**Architecture:** Todo en `views/graficos.html`. `estado` gana `ambito`; `cargarDatos(ambito)` se ramifica (hogar = fuentes actuales; personal = `getTransacciones({ambito:'personal'})` + `getBalancePersonal×6` + metas filtradas, con `porCategoria` derivada client-side) devolviendo el mismo shape `datos`. Las 8 `render*()` no cambian salvo el rename `txHogarMes`→`txMes`. UI: toggle segmentado, controles sticky, fade en re-render, header apilado y tap targets ≥44px en móvil.

**Tech Stack:** Vanilla JS (IIFE), Chart.js (ya cargado), Supabase vía db.js (cero funciones nuevas). Sin framework de tests — verificación en navegador con harness de datos stub.

**Reference spec:** `docs/superpowers/specs/2026-06-07-graficos-secciones-design.md`

**Convenciones ya verificadas:** db.js tiene `getBalancePersonal(mes,anio)` → `{ingresos,gastos,aporte_realizado,balance}` (usuario activo); `getTransacciones({ambito,fecha_desde,fecha_hasta})` (RLS limita personal al usuario); `getMetas()` → metas con campo `ambito`. Helpers en la vista: `rangoMesLocal`, `mesAnterior`, `nombreMes`, `cssVar`, `setEstado`, `destruir`. Tokens CSS: `--color-primary`, `--bg-light`, `--bg-light-secondary`, `--text-dark`, `--text-secondary`, `--border-light`, `--space-*`, `--radius-*`, `--shadow-sm`.

---

## File Structure

| File | Change |
|---|---|
| `views/graficos.html` | Markup (controles sticky + toggle), CSS (segmentado, sticky, fade, mobile), JS (`estado.ambito`, `cargarDatos(ambito)`, `derivarPorCategoria`, toggle wiring, renders visibles por ámbito, rename `txMes`) |

---

### Task 1: Markup + CSS — controles sticky, toggle segmentado, mobile-first

**Files:**
- Modify: `views/graficos.html` (markup del header y bloque `<style>`)

- [ ] **Step 1: Envolver header + toggle en una barra de controles sticky**

Reemplazar el bloque `<header class="graf-header">…</header>` (líneas ~2-12) por:

```html
  <div class="graf-controls">
    <header class="graf-header">
      <div>
        <h1 class="graf-title">Gráficos</h1>
        <p class="graf-sub">Análisis financiero</p>
      </div>
      <div class="graf-month" role="group" aria-label="Periodo">
        <button type="button" class="graf-month-nav" id="grafMesPrev" aria-label="Mes anterior">‹</button>
        <span class="graf-month-label" id="grafMesLabel" aria-live="polite">—</span>
        <button type="button" class="graf-month-nav" id="grafMesNext" aria-label="Mes siguiente">›</button>
      </div>
    </header>
    <div class="graf-toggle" role="group" aria-label="Ámbito">
      <button type="button" class="graf-seg graf-seg--active" data-ambito="hogar" aria-pressed="true">Hogar</button>
      <button type="button" class="graf-seg" data-ambito="personal" aria-pressed="false">Personal</button>
    </div>
  </div>
```

- [ ] **Step 2: Añadir CSS para controles sticky, toggle segmentado, fade y mobile**

En el bloque `<style>`, inmediatamente después de la regla `.graf { ... }`, insertar:

```css
  .graf-controls { position: sticky; top: 0; z-index: 10; background: var(--bg-light); padding: var(--space-md) 0 var(--space-sm); margin-bottom: var(--space-md); border-bottom: 1px solid var(--border-light); }

  .graf-toggle { display: flex; gap: 4px; background: var(--bg-light-secondary); padding: 4px; border-radius: var(--radius-md); margin-top: var(--space-md); }
  .graf-seg { flex: 1; min-height: 44px; border: none; background: transparent; border-radius: var(--radius-sm); color: var(--text-secondary); font-weight: var(--font-weight-semibold); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s, color 0.15s; }
  .graf-seg--active { background: var(--color-primary); color: #ffffff; }

  /* Fade en re-render */
  .graf-grid { transition: opacity 0.15s ease; }
  .graf-grid.is-loading { opacity: 0.5; }
  @media (prefers-reduced-motion: reduce) { .graf-grid, .graf-seg { transition: none; } }

  /* Ocultar tarjetas no aplicables en Personal */
  .graf--personal #card3, .graf--personal #card6 { display: none; }

  /* Mobile-first: header apilado + tap targets */
  @media (max-width: 719px) {
    .graf-header { flex-direction: column; align-items: stretch; gap: var(--space-sm); }
    .graf-month { justify-content: center; }
    .graf-month-nav { width: 44px; height: 44px; }
  }
```

> Nota: la regla base `.graf { ... }` y el `@media (min-width:720px)` del grid ya existen — NO duplicarlos. El `padding-top` original de `.graf` puede quedar; la barra sticky vive dentro de `.graf`.

- [ ] **Step 3: Verificar markup en navegador**

Iniciar preview (`preview_start` config `nestra`). Vía `preview_eval`:
```js
(async function(){ var d=document.createElement('div'); d.innerHTML=await (await fetch('views/graficos.html')).text(); return { toggle: d.querySelectorAll('.graf-seg').length, sticky: !!d.querySelector('.graf-controls'), cards: d.querySelectorAll('.graf-card').length }; })()
```
Esperado: `{ toggle: 2, sticky: true, cards: 8 }`.

- [ ] **Step 4: Commit**

```bash
git add views/graficos.html
git commit -m "feat(graficos): sticky controls bar + Hogar/Personal segmented toggle (UI/mobile)"
```

---

### Task 2: JS — ámbito en estado, cargarDatos ramificado, toggle, renders por ámbito

**Files:**
- Modify: `views/graficos.html` (bloque `<script>`)

- [ ] **Step 1: Añadir `ambito` al estado**

Cambiar:
```js
    var estado = { mes: hoy.mes, anio: hoy.anio };
```
por:
```js
    var estado = { mes: hoy.mes, anio: hoy.anio, ambito: 'hogar' };
```

- [ ] **Step 2: Añadir helper `derivarPorCategoria` y reemplazar `cargarDatos`**

Reemplazar la función `cargarDatos` ENTERA (líneas ~158-192) por el helper + la versión ramificada:

```js
    // Deriva [{nombre,total}] (gastos por categoría, desc) desde transacciones.
    function derivarPorCategoria(txs) {
      var mapa = {};
      (txs || []).forEach(function (t) {
        if (t.tipo !== 'gasto') return;
        var nombre = t.categorias ? t.categorias.nombre : '—';
        mapa[nombre] = (mapa[nombre] || 0) + Number(t.monto);
      });
      return Object.keys(mapa).map(function (n) { return { nombre: n, total: mapa[n] }; })
        .sort(function (a, b) { return b.total - a.total; });
    }

    async function cargarDatos(ambito) {
      var m = estado.mes, a = estado.anio;
      var r = rangoMesLocal(m, a);
      var ant = mesAnterior(m, a);
      var rAnt = rangoMesLocal(ant.mes, ant.anio);

      var meses6 = [];
      var cur = { mes: m, anio: a };
      for (var i = 0; i < 6; i++) { meses6.unshift(cur); cur = mesAnterior(cur.mes, cur.anio); }

      var categoriasGasto = await getCategorias('gasto');

      if (ambito === 'personal') {
        var resPers = await Promise.all([
          getTransacciones({ ambito: 'personal', fecha_desde: r.desde, fecha_hasta: r.hasta }),
          getTransacciones({ ambito: 'personal', fecha_desde: rAnt.desde, fecha_hasta: rAnt.hasta }),
          Promise.all(meses6.map(function (x) { return getBalancePersonal(x.mes, x.anio); })),
          getMetas(),
        ]);
        var txMesP = resPers[0] || [];
        var balP = await getBalancePersonal(m, a);
        var metasP = (resPers[3] || []).filter(function (x) {
          return x.ambito === 'personal' && Number(x.monto_actual) < Number(x.monto_objetivo);
        });
        var aportesP = await Promise.all(metasP.map(function (mt) { return getAportesDeMeta(mt.id); }));
        return {
          txMes: txMesP,
          resumen: { hogar: balP, porCategoria: derivarPorCategoria(txMesP) },
          resumenAnterior: { porCategoria: derivarPorCategoria(resPers[1] || []) },
          categoriasGasto: categoriasGasto || [],
          aportesMiembro: [],
          balance6m: meses6.map(function (x, i) {
            return { label: nombreMes(x.mes, x.anio).split(' ')[0].slice(0, 3), balance: (resPers[2][i] || {}).balance || 0 };
          }),
          metas: metasP.map(function (mt, i) { return { meta: mt, aportes: aportesP[i] || [] }; }),
          rango: r,
        };
      }

      // ambito === 'hogar'
      var resHog = await Promise.all([
        getTransacciones({ ambito: 'hogar', fecha_desde: r.desde, fecha_hasta: r.hasta }),
        getResumenMensual(m, a),
        getResumenMensual(ant.mes, ant.anio),
        getAportesPorMiembro(m, a),
        Promise.all(meses6.map(function (x) { return getBalanceHogar(x.mes, x.anio); })),
        getMetas(),
      ]);
      var metasH = (resHog[5] || []).filter(function (x) {
        return x.ambito === 'hogar' && Number(x.monto_actual) < Number(x.monto_objetivo);
      });
      var aportesH = await Promise.all(metasH.map(function (mt) { return getAportesDeMeta(mt.id); }));
      return {
        txMes: resHog[0] || [],
        resumen: resHog[1],
        resumenAnterior: resHog[2],
        categoriasGasto: categoriasGasto || [],
        aportesMiembro: resHog[3] || [],
        balance6m: meses6.map(function (x, i) {
          return { label: nombreMes(x.mes, x.anio).split(' ')[0].slice(0, 3), balance: (resHog[4][i] || {}).balance || 0 };
        }),
        metas: metasH.map(function (mt, i) { return { meta: mt, aportes: aportesH[i] || [] }; }),
        rango: r,
      };
    }
```

> Cambio respecto al original: la clave `txHogarMes` pasa a `txMes`, y `getMetas()` ahora se filtra por `ambito`. El gráfico 6 (hogar) sigue leyendo `resumen.hogar.ingresos`; en personal el 6 no se renderiza, así que `resumen.hogar` = balance personal no le afecta.

- [ ] **Step 3: Renombrar `txHogarMes` → `txMes` en render1 y render5**

En `render1`, cambiar `var txs = datos.txHogarMes;` por `var txs = datos.txMes;`.
En `render5`, cambiar `var txs = datos.txHogarMes.filter(...)` → `var txs = datos.txMes.filter(...)` (solo el identificador `txHogarMes`→`txMes`, el resto igual).

- [ ] **Step 4: Hacer `recargarTodo` consciente del ámbito (renders visibles + fade)**

Reemplazar la función `recargarTodo` ENTERA por:

```js
    function visiblesPara(ambito) {
      return ambito === 'personal' ? [1, 2, 4, 5, 7, 8] : [1, 2, 3, 4, 5, 6, 7, 8];
    }

    async function recargarTodo() {
      var token = ++cargaToken;
      var ambito = estado.ambito;
      var visibles = visiblesPara(ambito);
      var grid = document.querySelector('.graf-grid');
      if (grid) grid.classList.add('is-loading');
      visibles.forEach(function (n) { setEstado(n, 'cargando'); });
      var datos;
      try {
        datos = await cargarDatos(ambito);
      } catch (err) {
        if (token !== cargaToken) return;
        console.error('cargarDatos falló:', err);
        visibles.forEach(function (n) { setEstado(n, 'error'); });
        if (grid) grid.classList.remove('is-loading');
        return;
      }
      if (token !== cargaToken) return;
      Object.keys(charts).forEach(function (id) { destruir(id); });
      visibles.forEach(function (n) {
        try { RENDERS[n - 1](datos); }
        catch (err) { console.error('render' + n + ' falló:', err); setEstado(n, 'error'); }
      });
      if (grid) grid.classList.remove('is-loading');
    }
```

> Esto reemplaza el bucle `RENDERS.forEach` por uno que solo corre las tarjetas visibles del ámbito, y añade la clase `is-loading` para el fade.

- [ ] **Step 5: Cablear el toggle segmentado**

Inmediatamente después de los listeners del navegador de mes (`$('grafMesNext').addEventListener(...)`), insertar:

```js
    function setAmbito(nuevo) {
      if (nuevo === estado.ambito) return;
      estado.ambito = nuevo;
      var grafRoot = document.querySelector('.graf');
      if (grafRoot) grafRoot.classList.toggle('graf--personal', nuevo === 'personal');
      Array.prototype.forEach.call(document.querySelectorAll('.graf-seg'), function (b) {
        var on = b.getAttribute('data-ambito') === nuevo;
        b.classList.toggle('graf-seg--active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      recargarTodo();
    }
    Array.prototype.forEach.call(document.querySelectorAll('.graf-seg'), function (b) {
      b.addEventListener('click', function () { setAmbito(b.getAttribute('data-ambito')); });
    });
```

- [ ] **Step 6: Verificar lógica en navegador (harness ambos ámbitos)**

Iniciar/asegurar preview. Ejecutar el harness que inyecta la vista, stubea las funciones db.js (incluyendo `getBalancePersonal` y `getTransacciones` que distinga `ambito`), corre el script, y prueba ambas pestañas:

```js
(async function(){
  var html = await (await fetch('views/graficos.html')).text();
  var styleM = html.match(/<style>([\s\S]*?)<\/style>/); var scriptM = html.match(/<script>([\s\S]*?)<\/script>/);
  var markup = html.replace(/<style>[\s\S]*?<\/style>/,'').replace(/<script>[\s\S]*?<\/script>/,'');
  var host = document.getElementById('gh'); if (host) host.remove();
  host = document.createElement('div'); host.id='gh';
  var st=document.createElement('style'); st.textContent=styleM[1]; host.appendChild(st);
  var w=document.createElement('div'); w.innerHTML=markup; host.appendChild(w); document.body.appendChild(host);
  var P=function(v){return Promise.resolve(v);};
  window.getTransacciones=function(o){ return P([{fecha:'2026-06-05',tipo:'gasto',monto:o.ambito==='personal'?40:120,categorias:{nombre:'Comida'}},{fecha:'2026-06-06',tipo:'ingreso',monto:500,categorias:null}]); };
  window.getResumenMensual=function(){ return P({hogar:{ingresos:2000,gastos:1000,balance:1000},porCategoria:[{nombre:'Comida',total:600},{nombre:'Ocio',total:120}]}); };
  window.getCategorias=function(){ return P([{nombre:'Comida',color:null,limite_mensual:500},{nombre:'Ocio',color:null,limite_mensual:null}]); };
  window.getBalanceHogar=function(){ return P({ingresos:2000,gastos:1000,balance:1000}); };
  window.getBalancePersonal=function(){ return P({ingresos:500,gastos:200,aporte_realizado:0,balance:300}); };
  window.getAportesPorMiembro=function(){ return P([{nombre:'A',esperado:100,real:90}]); };
  window.getMetas=function(){ return P([{id:1,nombre:'Viaje',ambito:'hogar',monto_objetivo:5000,monto_actual:2000,fecha_limite:'2026-12-31'},{id:2,nombre:'Curso',ambito:'personal',monto_objetivo:1000,monto_actual:300,fecha_limite:'2026-10-31'}]); };
  window.getAportesDeMeta=function(){ return P([{monto:1000,created_at:'2026-05-15T12:00:00Z'}]); };
  try { (0,eval)(scriptM[1]); } catch(e){ return {runError:String(e)}; }
  await new Promise(function(r){ setTimeout(r,500); });
  function estados(){ var o={}; [1,2,3,4,5,6,7,8].forEach(function(n){ var c=document.querySelector('#gh #card'+n); o[n]=c?(getComputedStyle(c).display==='none'?'hidden':c.getAttribute('data-estado')):'missing'; }); return o; }
  var hogar = estados();
  document.querySelector('#gh .graf-seg[data-ambito="personal"]').click();
  await new Promise(function(r){ setTimeout(r,500); });
  var personal = estados();
  var h=document.getElementById('gh'); if(h) h.remove();
  return { hogar: hogar, personal: personal };
})()
```
Esperado: `hogar` → cards 1-8 en `'ok'`. `personal` → cards 3 y 6 = `'hidden'`, resto `'ok'`. Revisar `preview_console_logs` (error) = cero.

- [ ] **Step 7: Commit**

```bash
git add views/graficos.html
git commit -m "feat(graficos): Hogar/Personal scopes — branched data layer, scoped renders"
```

---

### Task 3: Verificación integral + móvil

**Files:**
- Verify only (ajustes inline si hace falta)

- [ ] **Step 1: Re-correr el harness de Task 2 Step 6** y confirmar:
  - hogar: 8 cards `ok`
  - personal: cards 3,6 `hidden`; 1,2,4,5,7,8 `ok`
  - cero errores de consola

- [ ] **Step 2: Verificar viewport móvil**

`preview_resize` a 390×844 (móvil). Re-inyectar harness o navegar. `preview_screenshot`. Confirmar visualmente: controles sticky arriba, toggle a ancho completo (2 segmentos 50%), header apilado, grid 1-columna. Botones ‹ › ≥44px.

- [ ] **Step 3: Verificar sticky al hacer scroll**

`preview_eval`: `window.scrollTo(0, 600)` y confirmar que `.graf-controls` sigue visible (`getBoundingClientRect().top` ≈ 0).

- [ ] **Step 4: Commit final (si hubo ajustes)**

```bash
git add views/graficos.html
git commit -m "fix(graficos): mobile/sticky adjustments after verification"
```

---

## Self-Review

**Spec coverage:**
- Toggle segmentado Hogar|Personal, default Hogar → Task 1 (markup) + Task 2 Step 5 ✅
- Curación: personal oculta 3 y 6 → CSS `.graf--personal` (Task 1) + `visiblesPara` (Task 2 Step 4) ✅
- `cargarDatos(ambito)` ramificado, mismo shape → Task 2 Step 2 ✅
- `getMetas` filtrado por ámbito → Task 2 Step 2 ✅
- porCategoria personal derivada client-side → `derivarPorCategoria` (Task 2 Step 2) ✅
- Renders sin cambios salvo rename `txMes` → Task 2 Step 3 ✅
- Barra de controles sticky → Task 1 Step 2 CSS ✅
- Fade en re-render + prefers-reduced-motion → Task 1 CSS + `is-loading` en Task 2 Step 4 ✅
- Header apilado móvil + tap targets 44px → Task 1 Step 2 `@media (max-width:719px)` ✅
- Token-guard concurrencia preservado → Task 2 Step 4 (mantiene `++cargaToken`) ✅

**Placeholder scan:** Sin TBD/TODO. Todo el código es completo.

**Type consistency:** clave `txMes` usada consistentemente en cargarDatos (ambas ramas), render1, render5. `datos` mantiene el mismo shape en ambos ámbitos (`aportesMiembro:[]` en personal). `visiblesPara` → índices 1-based mapean a `RENDERS[n-1]`. `setAmbito`/`graf--personal`/`graf-seg--active` consistentes entre CSS (Task 1) y JS (Task 2).

**Riesgos anotados:**
- Personal `resumen.hogar` = balance personal (nombre engañoso pero solo lo lee render6, que no corre en personal). Aceptable; documentado.
- `getMetas` debe traer el campo `ambito` (lo trae: `metas_con_progreso`). Si faltara, el filtro personal/hogar quedaría vacío — verificar con datos reales.
- Líneas absolutas pueden variar; localizar por nombre de función/identificador.
