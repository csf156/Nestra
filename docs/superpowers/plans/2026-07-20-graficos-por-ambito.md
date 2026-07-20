# Gráficos por ámbito — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada gráfico de `#graficos` muestra los datos del ámbito seleccionado (Personal / Hogar): sin líneas que no aplican, sin datos mezclados, con los gráficos correctos visibles en cada ámbito.

**Architecture:** Cambio de solo cliente en `views/graficos.html` (+ el campo `ahorro` en la función pura `js/graficos-serie.js`, que tiene tests). Sin tocar la base de datos.

**Tech Stack:** JS vanilla sin build, Chart.js vendorizado, `node:test` para la lógica pura.

**Spec:** `docs/superpowers/specs/2026-07-20-graficos-por-ambito-design.md`

---

## Contexto que el ejecutor necesita

- **Tests**: `test/*.test.mjs` con `node:test`, por archivo: `node --test test/graficos-serie.test.mjs`.
- **`#graficos` exige sesión** (redirige a `#login`). NO ingresar credenciales. Lo que no se pueda verificar con sesión de prueba, verificarlo por lectura + el unit test, y documentar el test manual para el usuario.
- **Estado actual** (para orientarse):
  - `visiblesPara(ambito)` (graficos.html:858): personal=`[1,2,4,5,7,8,9]`, hogar=`[1,2,3,4,5,6,7,8,9]`.
  - CSS (graficos.html:115): `.graf--personal #card3, .graf--personal #card6 { display: none; }`.
  - `.graf--personal` la togglea `setAmbito` (graficos.html:955), que tiene guard `if (nuevo === estado.ambito) return;` → en el init (ámbito personal por defecto) la clase NUNCA se aplica.
  - `cargarDatos(ambito)` (graficos.html:257): rama personal y rama hogar arman el objeto `datos` distinto.
  - `derivarPorCategoria(txs)` (graficos.html:246): pura, filtra a `tipo==='gasto'`, agrupa por `t.categorias.nombre`. Reusa el embed `categorias` que trae `getTransacciones`.
  - `aporteRealPorMiembro(txs, userId, rango)` (js/hogar-aporte.js): pura, devuelve `{gasto, ahorro, total}` de las filas `ambito='hogar'` del miembro.
  - `window.currentUser.id` disponible (lo usan otras vistas).

---

## Task 1: `agruparSerie` trackea ahorro (TDD)

**Files:**
- Modify: `test/graficos-serie.test.mjs`
- Modify: `js/graficos-serie.js`

- [ ] **Step 1: Añadir tests del campo ahorro (deben fallar)**

En `test/graficos-serie.test.mjs`, tras el test `separa gasto e ingreso; ignora ahorro` (que hay que RENOMBRAR/ajustar — ver Step 2), añade:
```js
test('dias: agrupa ahorro además de gasto e ingreso', () => {
  const r = agruparSerie(
    [g('2026-07-01', 10), i('2026-07-01', 30), { tipo: 'ahorro', fecha: '2026-07-01', monto: 50 }],
    'dias', { mes: 7, anio: 2026 });
  assert.strictEqual(r[0].gasto, 10);
  assert.strictEqual(r[0].ingreso, 30);
  assert.strictEqual(r[0].ahorro, 50);
});
test('meses: agrupa ahorro en el bucket correcto', () => {
  const r = agruparSerie(
    [{ tipo: 'ahorro', fecha: '2026-01-05', monto: 25 }], 'meses', { mes: 1, anio: 2026 }, 12);
  assert.strictEqual(r[11].ahorro, 25);
});
test('sin ahorro, el campo ahorro es 0', () => {
  const r = agruparSerie([g('2026-07-01', 10)], 'dias', { mes: 7, anio: 2026 });
  assert.strictEqual(r[0].ahorro, 0);
});
```
También ajusta el test existente `separa gasto e ingreso; ignora ahorro`: ya NO se ignora el ahorro. Cambia su nombre a `separa gasto, ingreso y ahorro` y añade `assert.strictEqual(r[0].ahorro, 999);` (el test usa un ahorro de 999).

- [ ] **Step 2: Correr — deben fallar los nuevos**
```
node --test test/graficos-serie.test.mjs
```
Esperado: los 3 nuevos + el ajustado fallan (`ahorro` es `undefined`). Los demás pasan.

- [ ] **Step 3: Añadir ahorro a agruparSerie**

En `js/graficos-serie.js`, rama `'dias'`: hoy hace `var g = new Array(dias).fill(0), ing = new Array(dias).fill(0);` y en el forEach `if (t.tipo === 'gasto') ...; else if (t.tipo === 'ingreso') ...;`. Añade un tercer acumulador `aho` y su rama:
```js
    var g = new Array(dias).fill(0), ing = new Array(dias).fill(0), aho = new Array(dias).fill(0);
```
En el forEach, tras la rama de ingreso:
```js
      if (t.tipo === 'gasto') g[d] += Number(t.monto) || 0;
      else if (t.tipo === 'ingreso') ing[d] += Number(t.monto) || 0;
      else if (t.tipo === 'ahorro') aho[d] += Number(t.monto) || 0;
```
Y el `return g.map(...)`:
```js
    return g.map(function (v, k) {
      return { label: String(k + 1), gasto: Math.round(v * 100) / 100,
               ingreso: Math.round(ing[k] * 100) / 100, ahorro: Math.round(aho[k] * 100) / 100 };
    });
```
Para la rama `meses`/`trimestres` (`periodos`): hoy tiene `gs` e `is`. Añade `ahs`:
```js
  var gs = new Array(periodos.length).fill(0), is = new Array(periodos.length).fill(0),
      ahs = new Array(periodos.length).fill(0);
```
En el forEach: hoy `if (t.tipo !== 'gasto' && t.tipo !== 'ingreso') return;` DESCARTA el ahorro. Cámbialo para aceptarlo:
```js
    if (t.tipo !== 'gasto' && t.tipo !== 'ingreso' && t.tipo !== 'ahorro') return;
    var k = idx[_bucketDe(t.fecha, granularidad)];
    if (k === undefined) return;
    if (t.tipo === 'gasto') gs[k] += Number(t.monto) || 0;
    else if (t.tipo === 'ingreso') is[k] += Number(t.monto) || 0;
    else ahs[k] += Number(t.monto) || 0;
```
Y el `return periodos.map(...)`:
```js
  return periodos.map(function (p, k) {
    return { label: p.label, gasto: Math.round(gs[k] * 100) / 100,
             ingreso: Math.round(is[k] * 100) / 100, ahorro: Math.round(ahs[k] * 100) / 100 };
  });
```
Actualiza el comentario de cabecera de `agruparSerie` (que dice "Solo cuentan tipo 'gasto' e 'ingreso'; el ahorro no es ni una cosa ni la otra") para reflejar que ahora también agrupa ahorro.

- [ ] **Step 4: Correr — todos pasan**
```
node --test test/graficos-serie.test.mjs
```
Esperado: 0 fail.

- [ ] **Step 5: Commit**
```bash
git add js/graficos-serie.js test/graficos-serie.test.mjs
git commit -m "feat(graficos-serie): agruparSerie también agrupa ahorro

Se necesita para el chart 1 en ámbito hogar (Gastos + Ahorro en vez de
Gastos + Ingresos, ya que el hogar no tiene ingresos). Cada punto de la
serie gana un campo ahorro; gasto/ingreso no cambian.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Fix del init — aplicar el ámbito al cargar

**Files:**
- Modify: `views/graficos.html` (extraer la lógica de clase/toggle de `setAmbito` a una función reusable, y llamarla en el init)

- [ ] **Step 1: Extraer `aplicarAmbitoUI(ambito)`**

`setAmbito` (graficos.html:955-966) hoy hace, además de recargar: togglea `.graf--personal` en `.graf` y marca el botón activo. Extrae esa parte visual a una función que también se pueda llamar en el init:
```js
    function aplicarAmbitoUI(ambito) {
      var grafRoot = document.querySelector('.graf');
      if (grafRoot) grafRoot.classList.toggle('graf--personal', ambito === 'personal');
      Array.prototype.forEach.call(document.querySelectorAll('.graf-toggle:not(.graf-toggle--gran) .graf-seg'), function (b) {
        var on = b.getAttribute('data-ambito') === ambito;
        b.classList.toggle('graf-seg--active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    function setAmbito(nuevo) {
      if (nuevo === estado.ambito) return;
      estado.ambito = nuevo;
      aplicarAmbitoUI(nuevo);
      recargarTodo();
    }
```

- [ ] **Step 2: Llamar `aplicarAmbitoUI` en el init**

En el init (graficos.html, cerca de `renderLabel(); recargarTodo();` al final del IIFE), antes de `recargarTodo()`:
```js
    aplicarAmbitoUI(estado.ambito);
    renderLabel();
    recargarTodo();
```

- [ ] **Step 3: Verificar por lectura**

Confirma que ahora, con `estado.ambito='personal'` por defecto, `.graf--personal` se aplica en el init → las cards ocultas por CSS en personal (tras la Task 3, será card3) se ocultan desde la primera carga. `node`-check no aplica (HTML); revisa la sintaxis del `<script>` extrayendo e inspeccionando, o con el preview (Task 8).

- [ ] **Step 4: Commit**
```bash
git add views/graficos.html
git commit -m "fix(graficos): aplicar el ámbito en la carga inicial

.graf--personal solo se ponía al togglear el ámbito (setAmbito tiene guard
si el ámbito no cambia), así que en la carga inicial (personal por defecto)
nunca se aplicaba y las cards ocultas por CSS en personal se veían vacías.
Se extrae aplicarAmbitoUI y se llama también en el init.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Qué gráficos se ven en cada ámbito (visiblesPara + CSS)

Chart 6 (flujo de caja) y 9 (proyección de saldo) pasan a personal-only; 3 (aporte real vs esperado) sigue hogar-only.

**Files:**
- Modify: `views/graficos.html` (`visiblesPara` línea 858; CSS línea 115)

- [ ] **Step 1: Actualizar `visiblesPara`**
```js
    function visiblesPara(ambito) {
      return ambito === 'personal' ? [1, 2, 4, 5, 6, 7, 8, 9] : [1, 2, 3, 4, 5, 7, 8];
    }
```
(personal gana 6; hogar pierde 6 y 9; 3 sigue solo en hogar.)

- [ ] **Step 2: Actualizar el CSS de ocultamiento**

Reemplaza (graficos.html:115):
```css
  .graf--personal #card3, .graf--personal #card6 { display: none; }
```
por:
```css
  /* 3 (aporte real vs esperado) es hogar-only; 6 (flujo de caja) y 9 (proyección
     de saldo) son personal-only. Con el fix del init, .graf--personal siempre
     está en personal, así que .graf:not(.graf--personal) = hogar de forma fiable. */
  .graf--personal #card3 { display: none; }
  .graf:not(.graf--personal) #card6,
  .graf:not(.graf--personal) #card9 { display: none; }
```

- [ ] **Step 3: Verificar por lectura**

Confirma la simetría: personal muestra 1,2,4,5,6,7,8,9 (oculta 3); hogar muestra 1,2,3,4,5,7,8 (oculta 6 y 9). `visiblesPara` y el CSS deben coincidir (lo que no está en `visiblesPara` de un ámbito debe estar oculto por CSS en ese ámbito, y viceversa).

- [ ] **Step 4: Commit**
```bash
git add views/graficos.html
git commit -m "feat(graficos): flujo de caja y proyección de saldo a personal-only

El hogar no tiene ingresos → un flujo de caja no aplica; y la proyección de
saldo solo tiene sentido en lo personal. Se mueven 6 y 9 a personal, 3 sigue
hogar-only. visiblesPara + CSS de ocultamiento en sincronía.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Chart 1 — hogar muestra Gastos + Ahorro

**Files:**
- Modify: `views/graficos.html` (`render1` línea 363, y el texto `graf1Desc`)

- [ ] **Step 1: Datasets según ámbito en render1**

En `render1`, el `datasets` (graficos.html:392-403) hoy es fijo `[Gastos, Ingresos]`. Cámbialo a elegir según `estado.ambito`:
```js
      var esHogar = estado.ambito === 'hogar';
      var segundaSerie = esHogar
        ? { label: 'Ahorro', data: serie.map(function (x) { return x.ahorro; }),
            borderColor: cssVar('--color-info'), backgroundColor: 'transparent',
            cubicInterpolationMode: 'monotone', pointRadius: _mob() ? 0 : 3 }
        : { label: 'Ingresos', data: serie.map(function (x) { return x.ingreso; }),
            borderColor: cssVar('--color-success'), backgroundColor: 'transparent',
            cubicInterpolationMode: 'monotone', pointRadius: _mob() ? 0 : 3 };
      // ... en data.datasets:
      datasets: [
        { label: 'Gastos', data: serie.map(function (x) { return x.gasto; }),
          borderColor: cssVar('--color-danger'), backgroundColor: 'transparent',
          cubicInterpolationMode: 'monotone', pointRadius: _mob() ? 0 : 3 },
        segundaSerie,
      ],
```

- [ ] **Step 2: Ajustar la descripción según ámbito**

En render1, el `desc.textContent` (graficos.html:371) hoy dice "Gastos e ingresos, por …". Hazlo depender del ámbito:
```js
        var quePar = estado.ambito === 'hogar' ? 'Gastos y ahorro' : 'Gastos e ingresos';
        desc.textContent = quePar + ', por ' +
          (gran === 'dias' ? 'día del mes.' : gran === 'meses' ? 'mes (últimos 12).' : 'trimestre (últimos 8).');
```

- [ ] **Step 3: Verificar por lectura**

Confirma que `serie` (de `agruparSerie`) ahora trae `x.ahorro` (Task 1). Confirma que en personal el chart 1 sigue mostrando Gastos + Ingresos.

- [ ] **Step 4: Commit**
```bash
git add views/graficos.html
git commit -m "feat(graficos): chart 1 en hogar muestra Gastos + Ahorro

El hogar no tiene ingresos, así que la línea de Ingresos era plana en 0.
En hogar se reemplaza por Ahorro (que agruparSerie ya agrupa). Personal
sigue con Gastos + Ingresos.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Charts 2 y 7 — categorías acotadas al ámbito en hogar

**Files:**
- Modify: `views/graficos.html` (rama hogar de `cargarDatos`, línea 320-360)

- [ ] **Step 1: Sobrescribir porCategoria con datos de hogar en la rama hogar**

En la rama hogar de `cargarDatos` (que hoy devuelve `resumen: resHog[1]` y `resumenAnterior: resHog[2]`), añade el cálculo de las categorías de hogar y sobrescribe ambos `porCategoria`. Antes del `return`:
```js
      // Categorías del gasto de HOGAR (no la mezcla personal+hogar de
      // getResumenMensual): chart 2 y 7 deben mostrar solo el hogar en esta vista.
      var porCatHogarMes = derivarPorCategoria(resHog[0] || []);   // resHog[0] = txMes de hogar
      var txHogarAnt = (await getTransacciones({ fecha_desde: rAnt.desde, fecha_hasta: rAnt.hasta }))
        .filter(function (x) { return x.hogar_id != null; });
      var porCatHogarAnt = derivarPorCategoria(txHogarAnt);
```
Y en el objeto `return` de la rama hogar, reemplaza:
```js
        resumen: resHog[1],
        resumenAnterior: resHog[2],
```
por:
```js
        resumen: Object.assign({}, resHog[1], { porCategoria: porCatHogarMes }),
        resumenAnterior: Object.assign({}, resHog[2], { porCategoria: porCatHogarAnt }),
```
(Se conserva el resto de `resumen`/`resumenAnterior` — render6 no corre en hogar, pero otros campos como `hogar`/`personal` se mantienen por si algún render los usa; solo se pisa `porCategoria`.)

- [ ] **Step 2: Verificar por lectura**

Confirma que `resHog[0]` es el txMes de hogar (ya filtrado `hogar_id != null` en cargarDatos). Confirma que `derivarPorCategoria` filtra a gasto (sí, graficos.html:249) — así el ahorro de hogar no entra en la distribución de categorías. Confirma que render2 (`datos.resumen.porCategoria`) y render7 (`datos.resumen.porCategoria` + `datos.resumenAnterior.porCategoria`) leen de donde se sobrescribió.

- [ ] **Step 3: Commit**
```bash
git add views/graficos.html
git commit -m "fix(graficos): charts 2 y 7 muestran solo el gasto de hogar en la vista hogar

getResumenMensual calcula porCategoria sobre gastos personal+hogar mezclados,
así que en hogar el chart 2 mostraba la mezcla dominada por lo personal y
parecía no cambiar. Se sobrescribe porCategoria (mes y anterior) con las
categorías del gasto de hogar. getResumenMensual no se toca.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Chart 6 — flujo de caja personal con "mi parte" del hogar

**Files:**
- Modify: `views/graficos.html` (rama personal de `cargarDatos`; `render6`)

- [ ] **Step 1: La rama personal calcula "mi aporte a gastos de hogar"**

La rama personal de `cargarDatos` hoy trae solo txs personales (`soloPersonal`). Necesita también el gasto de hogar del usuario para el flujo de caja. En la rama personal, tras obtener `txMesP`, añade (reusa la misma consulta del mes; `getTransacciones` trae personal+hogar):
```js
      // Para el flujo de caja personal: mi aporte real a los gastos del hogar
      // este mes (lo que puse de mi bolsillo a gastos compartidos).
      var txMesTodo = await getTransacciones({ fecha_desde: r.desde, fecha_hasta: r.hasta });
      var uid = (window.currentUser && window.currentUser.id) || null;
      var miAporteGastoHogar = (typeof aporteRealPorMiembro === 'function' && uid)
        ? aporteRealPorMiembro(txMesTodo, uid, { desde: r.desde, hasta: r.hasta }).gasto
        : 0;
```
(Nota: `resPers[0]` ya hace un `getTransacciones` del mes filtrado a personal. Para no duplicar la llamada, puedes obtener `txMesTodo` una vez y derivar `txMesP = soloPersonal(txMesTodo)` de ahí, en vez de dos fetches. Elige la forma que no duplique la consulta de red.)

Añade `miAporteGastoHogar` al objeto `datos` que retorna la rama personal:
```js
        miAporteGastoHogar: miAporteGastoHogar,
```

- [ ] **Step 2: Reescribir render6 con la fórmula personal**

`render6` (graficos.html:589) hoy calcula `ingresos = resumen.personal.ingresos`, `gastos = hogar.gastos + personal.gastos`. Cámbialo a la fórmula personal:
```js
    function render6(datos) {
      // Flujo de caja PERSONAL: ingresos personales vs (gastos personales + mi
      // aporte real a los gastos del hogar). Solo corre en ámbito personal
      // (visiblesPara). El hogar no tiene ingresos → no aplica un flujo de caja.
      var ingresos = (datos.resumen && datos.resumen.personal && datos.resumen.personal.ingresos) || 0;
      var gastosPers = (datos.resumen && datos.resumen.personal && datos.resumen.personal.gastos) || 0;
      var gastos = gastosPers + (datos.miAporteGastoHogar || 0);
      var balance = ingresos - gastos;
      if (ingresos <= 0 && gastos <= 0) { setEstado(6, 'vacio'); return; }
      // ... resto igual (labels, valores, colores, new Chart) ...
```
Conserva el resto del cuerpo de render6 (labels `['Ingresos','Gastos','Balance']`, `valores = [ingresos, gastos, balance]`, colores, y el `new Chart`) tal cual — solo cambia el cálculo de `ingresos`/`gastos`/`balance` de arriba.

**Ojo con `datos.resumen.personal`**: en la rama personal de `cargarDatos`, `resumen` es `{ hogar: balP, porCategoria: ... }` — **no tiene `.personal`**. Hay que asegurar que la rama personal exponga los ingresos y gastos personales para render6. `balP = getBalancePersonal(m, a)` — verifica qué campos trae `getBalancePersonal` (js/db.js:375): probablemente `{ ingresos, gastos, ... }`. Ajusta render6 para leer de donde la rama personal sí los tenga. Opción robusta: en la rama personal, poner `resumen: { personal: balP, hogar: ..., porCategoria: ... }` para que `datos.resumen.personal.ingresos/gastos` funcione — **verifica los campos reales de `getBalancePersonal` y ajusta este mapeo en cargarDatos y el acceso en render6 de forma consistente.**

- [ ] **Step 3: Verificar por lectura**

Traza: rama personal de `cargarDatos` → `datos.resumen.personal.{ingresos,gastos}` + `datos.miAporteGastoHogar` → render6. Confirma que los campos existen con esos nombres (lee `getBalancePersonal`). Confirma que render6 ya no referencia `resumen.hogar` (que en personal no aplica).

- [ ] **Step 4: Commit**
```bash
git add views/graficos.html
git commit -m "feat(graficos): flujo de caja personal con mi parte de gastos de hogar

render6 pasa a: ingresos personales vs (gastos personales + mi aporte real
a los gastos del hogar, via aporteRealPorMiembro). Antes mezclaba hogar y
personal y vivía en la vista hogar (que no tiene ingresos). La rama personal
de cargarDatos calcula miAporteGastoHogar.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Auditoría de charts 4, 5, 8

**Files:**
- (Posiblemente) Modify: `views/graficos.html`

- [ ] **Step 1: Auditar por lectura cada uno**

Lee `render4`, `render5`, `render8` y confirma que cada uno usa datos del ámbito seleccionado (que vienen de `cargarDatos`, ya acotado por ámbito):
- **render4** (Ahorro acumulado): usa `datos.balance6m`. En cargarDatos, personal lo arma de `getBalancePersonal`, hogar de `getAhorrosHogar`. Confirmar que es coherente por ámbito.
- **render5** (Mapa de calor): usa `datos.txMes` (ya acotado por ámbito). Confirmar.
- **render8** (Proyección de metas): usa `datos.metas` (metas del ámbito). Confirmar.

- [ ] **Step 2: Corregir solo si hay desajuste real**

Si alguno usa datos mezclados o del ámbito equivocado, corrígelo con el mismo enfoque (acotar en `cargarDatos` o en el render). Si todos están correctos, NO cambies nada — documenta en el reporte que la auditoría no encontró desajustes.

- [ ] **Step 3: Commit (solo si hubo cambios)**

Si corregiste algo:
```bash
git add views/graficos.html
git commit -m "fix(graficos): <describe el desajuste de ámbito corregido en chart N>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
Si no hubo cambios, no hay commit; reporta el resultado de la auditoría.

---

## Task 8: Bump SHELL_VERSION + verificación integral

**Files:**
- Modify: `sw.js:15`

- [ ] **Step 1: Bump** `SHELL_VERSION` al siguiente valor respecto al real en `main` (verifica `grep SHELL_VERSION sw.js`).

- [ ] **Step 2: Unit test** `node --test test/graficos-serie.test.mjs` → 0 fail.

- [ ] **Step 3: Shell carga limpio**

`preview_start` `{ name: "nestra" }`, `http://localhost:5050/`. `read_console_messages` (onlyErrors) sin errores.

- [ ] **Step 4: Test de integración manual (documentar o ejecutar con sesión de prueba)**

En `#graficos` (cuenta/hogar de PRUEBA, nunca el real):
1. Al entrar (personal): NO se ve "Aporte real vs. esperado" (card3 oculta); SÍ se ven "Flujo de caja" y "Proyección de saldo".
2. Cambiar a Hogar: aparece "Aporte real vs. esperado"; desaparecen "Flujo de caja" y "Proyección de saldo".
3. Chart 1 en hogar: la segunda línea es "Ahorro", no "Ingresos".
4. Chart 2 en hogar: muestra solo categorías de gasto de hogar (distinto de personal). Alternar personal↔hogar cambia el donut.
5. Chart 7 en hogar: solo categorías de hogar.
6. Chart 6 (personal): flujo con ingresos personales, gastos = personales + mi parte de hogar.

Si no hay sesión, documenta estos 6 pasos para el usuario.

- [ ] **Step 5: Sin código de prueba colado**
```bash
git diff origin/main -- views/graficos.html js/graficos-serie.js | grep -n "console.log\|debugger" || echo limpio
```

- [ ] **Step 6: Commit**
```bash
git add sw.js
git commit -m "chore(sw): SHELL_VERSION por gráficos-por-ámbito

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Docs + PR

- [ ] **Step 1: Commit del plan** (el spec ya está commiteado en esta rama):
```bash
git add docs/superpowers/plans/2026-07-20-graficos-por-ambito.md
git commit -m "docs: plan de gráficos por ámbito (subsistema B)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 2: Push + PR**
```bash
git push -u origin feat/graficos-por-ambito
gh pr create --title "Gráficos: cada uno respeta el ámbito seleccionado" --body "..."
```

- [ ] **Step 3: (Orquestador) mergear** tras revisión, verificar deploy con cache-buster.

## Self-review (cobertura del spec)
- Init fix (.graf--personal en carga) → Task 2. ✔
- Chart 1 hogar → Gastos + Ahorro (agruparSerie + render1) → Task 1, 4. ✔
- Chart 2 hogar → solo gasto hogar → Task 5. ✔
- Chart 3 hogar-only (init fix lo oculta en personal) → Task 2 + Task 3 CSS. ✔
- Chart 6 personal-only + fórmula mi parte → Task 3 (visibilidad) + Task 6 (fórmula). ✔
- Chart 7 hogar → solo gasto hogar → Task 5. ✔
- Chart 9 personal-only → Task 3. ✔
- Auditoría 4,5,8 → Task 7. ✔
- agruparSerie con tests → Task 1. ✔
- Bump + deploy → Task 8, 9. ✔
- Sin tocar la base / getResumenMensual → ninguna task los toca (Task 5 sobrescribe en cliente). ✔
