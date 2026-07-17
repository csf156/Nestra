# Tanda 3 — Granularidad en gráficos y quick-add de metas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (#2) Quitar el acumulado del gráfico de evolución temporal y añadirle un toggle días/meses/trimestres. (#6) Que el quick-add reconozca `meta <nombre>` y haga un aporte directo a esa meta.

**Architecture:** Dos features independientes, sin cambios en la base. Toda la lógica frágil (aritmética de fechas, matching de nombres) va en dos módulos puros nuevos con tests; las vistas solo cablean. #6 reusa `tokenize` (que el parser ya importa) e `insertAporteDirecto` → RPC `aporte_directo_meta` (que ya existe).

**Tech Stack:** JS vanilla sin build, módulos puros dual-export (`window.X` + `export`), Chart.js, tests con `node --test test/*.test.mjs`, deploy por push a `v2`.

**Spec:** `docs/superpowers/specs/2026-07-16-tanda3-graficos-quickadd-design.md`

---

## Contexto imprescindible

**Todo el código de este plan se validó ejecutándolo** contra sus propios tests en un
directorio temporal antes de escribirlo: 10/10 de `agruparSerie`, 8/8 de `resolverMeta`, 8/8
del parser. No es código "que debería funcionar".

**Estado verificado (2026-07-16):** 245 tests pasan. `SHELL_VERSION = 'v29'` (`sw.js:15`).

**Dos trampas que ya se pagaron al redactar este plan:**

1. **El orden importa en el parser.** La extracción de `meta <nombre>` va **después** del
   monto. Al revés, el nombre se traga la cifra: `"meta alquiler S/5"` → nombre
   `"alquiler S/5"` y `monto: null`.
2. **El regex lleva `\b`.** `/\bmeta\b\s*(.*)$/i`. Sin los límites de palabra, "meta" casaría
   dentro de otras palabras. (Al redactar, una herramienta convirtió los `\b` en backspaces
   literales y el regex quedó `/^Hmeta^H\s*/` — casaba con nada y fallaba en silencio. El
   código de abajo está verificado byte a byte; si al copiarlo algo se ve raro, comprobar con
   `grep -n "mMeta = str.match" js/parse-quickadd.js | cat -A`.)

**#6 es pequeño.** `"ahorro hogar S/100"` y `"ahorro 50"` **ya funcionan** — `insertTransaccion`
llama a `distribuir_ahorro` solo (`db.js:192`). Lo único roto es `"aporte meta alquiler S/5"`,
que parsea como gasto personal. No re-implementar lo que ya anda.

---

## File Structure

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `js/graficos-serie.js` | **Crear.** `agruparSerie` — bucketing por día/mes/trimestre | 1 |
| `test/graficos-serie.test.mjs` | **Crear.** 10 tests de aritmética de fechas | 1 |
| `views/graficos.html` | Toggle + quitar cumsum + ventana ancha | 2 |
| `js/meta-resolver.js` | **Crear.** `resolverMeta` — nombre → meta_id | 3 |
| `test/meta-resolver.test.mjs` | **Crear.** 8 tests de matching | 3 |
| `js/parse-quickadd.js` | Reconocer `meta <nombre>` | 4 |
| `test/parse-quickadd.test.mjs` | +8 tests | 4 |
| `views/transaccion.html` | `insertAporteDirecto` + errores de meta | 5 |
| `index.html`, `sw.js` | Cargar/precachear los 2 módulos; bump | 2, 4, 6 |

---

### Task 1: `agruparSerie` — bucketing puro

**Files:**
- Create: `js/graficos-serie.js`
- Create: `test/graficos-serie.test.mjs`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `test/graficos-serie.test.mjs`:

```javascript
import assert from 'node:assert';
import { test } from 'node:test';
import { agruparSerie } from '../js/graficos-serie.js';

const g = (f, m) => ({ tipo: 'gasto', fecha: f, monto: m });
const i = (f, m) => ({ tipo: 'ingreso', fecha: f, monto: m });

// El bug original: el gráfico acumulaba dentro del mes y aplanaba los picos.
test('dias: NO acumula (el bug original)', () => {
  const r = agruparSerie([g('2026-07-01', 10), g('2026-07-02', 10)], 'dias', { mes: 7, anio: 2026 });
  assert.strictEqual(r[0].gasto, 10);
  assert.strictEqual(r[1].gasto, 10, 'el dia 2 debe ser 10, no 20 (acumulado)');
});

test('dias: respeta el largo del mes', () => {
  assert.strictEqual(agruparSerie([], 'dias', { mes: 2, anio: 2026 }).length, 28);
  assert.strictEqual(agruparSerie([], 'dias', { mes: 2, anio: 2024 }).length, 29, 'bisiesto');
  assert.strictEqual(agruparSerie([], 'dias', { mes: 4, anio: 2026 }).length, 30);
  assert.strictEqual(agruparSerie([], 'dias', { mes: 7, anio: 2026 }).length, 31);
});

test('dias: ignora las filas de otro mes', () => {
  const r = agruparSerie([g('2026-06-30', 999), g('2026-07-05', 5)], 'dias', { mes: 7, anio: 2026 });
  assert.strictEqual(r.reduce((a, x) => a + x.gasto, 0), 5);
});

test('meses: 12 periodos cruzando el año hacia atras', () => {
  const r = agruparSerie([], 'meses', { mes: 1, anio: 2026 }, 12);
  assert.strictEqual(r.length, 12);
  assert.strictEqual(r[0].label, 'feb', '12 meses hasta ene-2026 empiezan en feb-2025');
  assert.strictEqual(r[11].label, 'ene');
});

test('meses: agrupa en el bucket correcto', () => {
  const r = agruparSerie(
    [g('2025-02-10', 7), g('2025-02-28', 3), g('2026-01-01', 100)], 'meses', { mes: 1, anio: 2026 }, 12);
  assert.strictEqual(r[0].gasto, 10);
  assert.strictEqual(r[11].gasto, 100);
});

test('trimestres: limites T1=ene-mar .. T4=oct-dic', () => {
  const r = agruparSerie(
    [g('2026-01-01', 1), g('2026-03-31', 2), g('2026-04-01', 4)], 'trimestres', { mes: 6, anio: 2026 }, 8);
  assert.strictEqual(r.find((x) => x.label === 'T1 26').gasto, 3, 'ene y mar caen en T1');
  assert.strictEqual(r.find((x) => x.label === 'T2 26').gasto, 4, 'abr cae en T2');
});

test('trimestres: 8 periodos = 2 años', () => {
  const r = agruparSerie([], 'trimestres', { mes: 12, anio: 2026 }, 8);
  assert.strictEqual(r.length, 8);
  assert.strictEqual(r[0].label, 'T1 25');
  assert.strictEqual(r[7].label, 'T4 26');
});

test('periodos sin datos salen en 0, no se saltan', () => {
  const r = agruparSerie([g('2026-01-05', 50)], 'meses', { mes: 1, anio: 2026 }, 12);
  assert.strictEqual(r.length, 12);
  assert.ok(r.slice(0, 11).every((x) => x.gasto === 0));
});

test('separa gasto e ingreso; ignora ahorro', () => {
  const r = agruparSerie(
    [g('2026-07-01', 10), i('2026-07-01', 30), { tipo: 'ahorro', fecha: '2026-07-01', monto: 999 }],
    'dias', { mes: 7, anio: 2026 });
  assert.strictEqual(r[0].gasto, 10);
  assert.strictEqual(r[0].ingreso, 30);
});

test('lista vacia o null no rompe', () => {
  assert.strictEqual(agruparSerie([], 'meses', { mes: 7, anio: 2026 }, 12).length, 12);
  assert.strictEqual(agruparSerie(null, 'dias', { mes: 7, anio: 2026 }).length, 31);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `node --test test/graficos-serie.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` (`../js/graficos-serie.js` no existe).

- [ ] **Step 3: Implementar el módulo**

Crear `js/graficos-serie.js`:

```javascript
// ─────────────────────────────────────────────────────────────────
// Nestra — graficos-serie.js (Tanda 3, #2)
// Agrupa transacciones en una serie temporal por día, mes o trimestre.
// NO acumula: cada periodo lleva lo suyo. El acumulado era el bug — aplanaba
// los picos y no dejaba ver los periodos de mayor gasto.
// (El chart "Ahorro acumulado" sí acumula, pero eso es otro gráfico y ahí es
// el punto: mide cómo crece el bote.)
// Puro y determinista. Dual-export como safe-to-spend.js.
// ─────────────────────────────────────────────────────────────────
'use strict';

function _p2(n) { return n < 10 ? '0' + n : String(n); }

// Aritmética de meses en un solo eje (anio*12 + mes-1) para no pelearse con
// los cruces de año hacia atrás.
function _mesesAtras(mes, anio, k) {
  var t = (anio * 12 + (mes - 1)) - k;
  return { mes: (t % 12) + 1, anio: Math.floor(t / 12) };
}

var _MES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Clave del periodo al que cae una fecha. Se parsea la cadena ISO a mano en vez
// de con new Date(): 'YYYY-MM-DD' se interpreta como UTC y el equivalente local
// puede caer el día anterior según la zona horaria.
function _bucketDe(fechaISO, granularidad) {
  var s = String(fechaISO).split('T')[0];
  var y = parseInt(s.slice(0, 4), 10), m = parseInt(s.slice(5, 7), 10);
  if (granularidad === 'meses') return y + '-' + _p2(m);
  return y + '-T' + Math.ceil(m / 3);
}

// Los n periodos que terminan en `hasta`, del más viejo al más nuevo.
function _periodos(granularidad, hasta, n) {
  var out = [];
  if (granularidad === 'meses') {
    for (var i = n - 1; i >= 0; i--) {
      var p = _mesesAtras(hasta.mes, hasta.anio, i);
      out.push({ clave: p.anio + '-' + _p2(p.mes), label: _MES3[p.mes - 1] });
    }
    return out;
  }
  var tHasta = Math.ceil(hasta.mes / 3);
  for (var j = n - 1; j >= 0; j--) {
    var tt = (hasta.anio * 4 + (tHasta - 1)) - j;
    var anio = Math.floor(tt / 4), tri = (tt % 4) + 1;
    out.push({ clave: anio + '-T' + tri, label: 'T' + tri + ' ' + String(anio).slice(2) });
  }
  return out;
}

// agruparSerie(transacciones, granularidad, hasta, n) → [{ label, gasto, ingreso }]
//   granularidad: 'dias' | 'meses' | 'trimestres'
//   hasta: { mes, anio } — el último periodo de la ventana (el del navegador).
//   n: cuántos periodos (12 meses / 8 trimestres). Se ignora en 'dias', donde
//      la ventana es el mes entero de `hasta`.
// Solo cuentan tipo 'gasto' e 'ingreso'; el ahorro no es ni una cosa ni la otra.
// Los periodos sin datos salen en 0: se dibujan, no se saltan.
function agruparSerie(transacciones, granularidad, hasta, n) {
  if (granularidad === 'dias') {
    var dias = new Date(Date.UTC(hasta.anio, hasta.mes, 0)).getUTCDate();
    var g = new Array(dias).fill(0), ing = new Array(dias).fill(0);
    (transacciones || []).forEach(function (t) {
      var s = String(t.fecha).split('T')[0];
      if (parseInt(s.slice(0, 4), 10) !== hasta.anio) return;
      if (parseInt(s.slice(5, 7), 10) !== hasta.mes) return;
      var d = parseInt(s.slice(8, 10), 10) - 1;
      if (d < 0 || d >= dias) return;
      if (t.tipo === 'gasto') g[d] += Number(t.monto) || 0;
      else if (t.tipo === 'ingreso') ing[d] += Number(t.monto) || 0;
    });
    return g.map(function (v, k) {
      return { label: String(k + 1), gasto: Math.round(v * 100) / 100, ingreso: Math.round(ing[k] * 100) / 100 };
    });
  }

  var periodos = _periodos(granularidad, hasta, n);
  var idx = {};
  periodos.forEach(function (p, k) { idx[p.clave] = k; });
  var gs = new Array(periodos.length).fill(0), is = new Array(periodos.length).fill(0);
  (transacciones || []).forEach(function (t) {
    if (t.tipo !== 'gasto' && t.tipo !== 'ingreso') return;
    var k = idx[_bucketDe(t.fecha, granularidad)];
    if (k === undefined) return;   // fuera de la ventana
    if (t.tipo === 'gasto') gs[k] += Number(t.monto) || 0;
    else is[k] += Number(t.monto) || 0;
  });
  return periodos.map(function (p, k) {
    return { label: p.label, gasto: Math.round(gs[k] * 100) / 100, ingreso: Math.round(is[k] * 100) / 100 };
  });
}

if (typeof window !== 'undefined') {
  window.agruparSerie = agruparSerie;
}

export { agruparSerie };
```

- [ ] **Step 4: Verificar que pasa**

Run: `node --test test/graficos-serie.test.mjs`
Expected: PASS — 10/10.

- [ ] **Step 5: Commit**

```bash
git add js/graficos-serie.js test/graficos-serie.test.mjs
git commit -m "feat(graficos): agruparSerie — bucketing por dia, mes o trimestre

Modulo puro para la serie temporal del grafico de evolucion. NO acumula:
el acumulado era el bug, aplanaba los picos y no dejaba ver los periodos de
mayor gasto.

Va en un modulo con tests porque es aritmetica de fechas, que es donde se
cometen los errores y donde un bug miente en silencio: el grafico se veria
plausible igual. Los tests fijan los limites de trimestre, el cruce de anio
hacia atras (12 meses hasta ene-2026 empiezan en feb-2025), los meses de
28/29/30/31 dias y que los periodos vacios salgan en 0 en vez de saltarse.

Las fechas ISO se parsean a mano en vez de con new Date(): 'YYYY-MM-DD' se
interpreta como UTC y el equivalente local puede caer el dia anterior."
```

---

### Task 2: Toggle y ventana ancha en la vista

**Files:**
- Modify: `views/graficos.html` (markup del toggle, CSS, `estado`, `cargarDatos`, `render1`, la card desc)
- Modify: `index.html` (cargar el módulo)
- Modify: `sw.js` (precachear)

- [ ] **Step 1: Cargar y precachear el módulo**

En `index.html`, junto a los otros módulos puros (después de `<script type="module" src="js/presupuestos-orden.js"></script>`):

```html
    <script type="module" src="js/graficos-serie.js"></script>
```

En `sw.js`, en la lista de precache junto a los otros `js/`:

```javascript
  { url: 'js/graficos-serie.js', revision: SHELL_VERSION },
```

- [ ] **Step 2: Añadir el toggle al markup**

En `views/graficos.html`, justo después del `<div class="graf-toggle">` del ámbito (~línea 17,
el que cierra tras los botones Hogar/Personal), añadir:

```html
    <!-- Granularidad: SOLO afecta al chart 1 (Evolución temporal). Los demás no
         la necesitan: el 4 acumula a propósito, el 5 ya es por día, el resto son
         mensuales por diseño. Ver el spec de la Tanda 3. -->
    <div class="graf-toggle graf-toggle--gran" role="group" aria-label="Granularidad">
      <button type="button" class="graf-seg graf-seg--active" data-gran="dias" aria-pressed="true">Días</button>
      <button type="button" class="graf-seg" data-gran="meses" aria-pressed="false">Meses</button>
      <button type="button" class="graf-seg" data-gran="trimestres" aria-pressed="false">Trimestres</button>
    </div>
```

- [ ] **Step 3: Corregir la descripción de la card**

En `views/graficos.html:23`, cambiar:

```html
      <p class="graf-card-desc">Gastos e ingresos del hogar, acumulados por día.</p>
```

por:

```html
      <p class="graf-card-desc" id="graf1Desc">Gastos e ingresos del hogar, por día.</p>
```

Deja de ser cierto que acumula. El `id` lo usa el Step 6 para reflejar la granularidad.

- [ ] **Step 4: Añadir la granularidad al estado y su listener**

En `views/graficos.html`, localizar la declaración de `estado` (la que tiene `mes`, `anio`,
`ambito`) y añadirle `granularidad: 'dias'`.

Junto al listener de los `.graf-seg` del ámbito (~línea 817), añadir:

```javascript
    // El toggle de granularidad llama a recargarTodo() igual que cambiarMes y
    // setAmbito: es el camino que la vista ya tiene, con su guarda de carrera
    // (cargaToken) resuelta. Recarga de más (todos los charts por un toggle que
    // afecta a uno), pero no inventa un camino nuevo.
    function setGranularidad(nueva) {
      if (nueva === estado.granularidad) return;
      estado.granularidad = nueva;
      Array.prototype.forEach.call(document.querySelectorAll('.graf-toggle--gran .graf-seg'), function (b) {
        var on = b.getAttribute('data-gran') === nueva;
        b.classList.toggle('graf-seg--active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      recargarTodo();
    }
    Array.prototype.forEach.call(document.querySelectorAll('.graf-toggle--gran .graf-seg'), function (b) {
      b.addEventListener('click', function () { setGranularidad(b.getAttribute('data-gran')); });
    });
```

**Cuidado:** el selector de los listeners del ámbito es `.graf-seg` a secas
(`document.querySelectorAll('.graf-seg')`, ~líneas 811 y 817). Ahora hay `.graf-seg` de dos
grupos, así que **hay que acotar los del ámbito a `.graf-toggle:not(.graf-toggle--gran) .graf-seg`**
o los botones de granularidad se registrarán también como botones de ámbito y todo se romperá.
Revisar las dos ocurrencias.

- [ ] **Step 5: Traer la ventana ancha solo cuando hace falta**

En `cargarDatos(ambito)` (~línea 237), antes del `return` de cada rama (personal y hogar),
calcular la serie ancha. Añadir cerca del inicio de la función, tras el cálculo de `r`:

```javascript
      // Ventana ancha para el chart 1 en meses/trimestres. Solo se pide si el
      // toggle lo necesita: en 'dias' el mes que ya se trae basta y no se paga
      // el coste. 12 meses o 8 trimestres (= 24 meses) hacia atrás desde el mes
      // del navegador.
      var serieAmplia = null;
      if (estado.granularidad !== 'dias') {
        var nPeriodos = estado.granularidad === 'meses' ? 12 : 8;
        var mesesAtras = estado.granularidad === 'meses' ? 11 : (8 * 3 - 1);
        var ini = { mes: m, anio: a };
        for (var k = 0; k < mesesAtras; k++) ini = mesAnterior(ini.mes, ini.anio);
        var rIni = rangoMesLocal(ini.mes, ini.anio);
        serieAmplia = { desde: rIni.desde, hasta: r.hasta, n: nPeriodos };
      }
```

y en cada rama, tras obtener las transacciones del mes, añadir la consulta ancha. En la rama
**personal**, antes del `return`:

```javascript
        var txAmpliaP = null;
        if (serieAmplia) {
          txAmpliaP = soloPersonal(await getTransacciones({
            fecha_desde: serieAmplia.desde, fecha_hasta: serieAmplia.hasta }));
        }
```

y añadir al objeto que retorna: `serieAmplia: serieAmplia ? { txs: txAmpliaP, n: serieAmplia.n } : null,`

En la rama **hogar**, análogamente antes del `return`:

```javascript
      var txAmpliaH = null;
      if (serieAmplia) {
        txAmpliaH = (await getTransacciones({
          fecha_desde: serieAmplia.desde, fecha_hasta: serieAmplia.hasta })
        ).filter(function (x) { return x.hogar_id != null; });
      }
```

y al objeto retornado: `serieAmplia: serieAmplia ? { txs: txAmpliaH, n: serieAmplia.n } : null,`

**Nota:** el filtro de ámbito debe ser el mismo que ya usa cada rama para `txMes`
(`soloPersonal` / `hogar_id != null`). Copiarlo, no reinventarlo.

- [ ] **Step 6: Reescribir `render1`**

Reemplazar `render1` entero (~líneas 308-353) por:

```javascript
    function render1(datos) {
      var gran = estado.granularidad;
      var serie;
      if (gran === 'dias') {
        if (!datos.txMes.length) { setEstado(1, 'vacio'); return; }
        serie = agruparSerie(datos.txMes, 'dias', { mes: estado.mes, anio: estado.anio });
      } else {
        var amplia = datos.serieAmplia;
        if (!amplia || !amplia.txs || !amplia.txs.length) { setEstado(1, 'vacio'); return; }
        serie = agruparSerie(amplia.txs, gran, { mes: estado.mes, anio: estado.anio }, amplia.n);
      }

      var desc = $('graf1Desc');
      if (desc) {
        desc.textContent = 'Gastos e ingresos, por ' +
          (gran === 'dias' ? 'día del mes.' : gran === 'meses' ? 'mes (últimos 12).' : 'trimestre (últimos 8).');
      }

      setEstado(1, 'ok');
      charts.chart1 = new Chart($('chart1'), {
        type: 'line',
        data: {
          labels: serie.map(function (x) { return x.label; }),
          datasets: [
            { label: 'Gastos', data: serie.map(function (x) { return x.gasto; }),
              borderColor: cssVar('--color-danger'), backgroundColor: 'transparent',
              tension: 0.25, pointRadius: _mob() ? 0 : 3 },
            { label: 'Ingresos', data: serie.map(function (x) { return x.ingreso; }),
              borderColor: cssVar('--color-success'), backgroundColor: 'transparent',
              tension: 0.25, pointRadius: _mob() ? 0 : 3 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: _legendOpts(cssVar('--text-dark')) },
          scales: {
            x: { ticks: _tickOpts(cssVar('--text-secondary')), grid: { color: cssVar('--border-light') } },
            y: { ticks: _tickOpts(cssVar('--text-secondary')), grid: { color: cssVar('--border-light') } },
          },
        },
      });
    }
```

El cumsum (`for (var i=1;i<dias;i++){ gastos[i]+=gastos[i-1]; ... }`) **desaparece**: era el bug.

- [ ] **Step 7: Verificar que no rompiste nada**

Run: `grep -n "gastos\[i - 1\]\|gastos\[i-1\]" views/graficos.html`
Expected: sin resultados (exit 1) — el cumsum del chart 1 ya no existe. (El chart 4 usa
`run +=`, no este patrón, y debe seguir intacto.)

Run: `grep -n "acumulados por día" views/graficos.html`
Expected: sin resultados.

Run: `grep -c "querySelectorAll('.graf-seg')" views/graficos.html`
Expected: `0` — los selectores del ámbito deben estar acotados (Step 4).

Run: `node --test test/*.test.mjs`
Expected: `# pass 255`, `# fail 0`. (245 + 10 del Task 1.)

- [ ] **Step 8: Commit**

```bash
git add views/graficos.html index.html sw.js
git commit -m "feat(graficos): evolucion temporal por dia/mes/trimestre, sin acumular

El grafico acumulaba dentro del mes, asi que la linea solo subia y era
imposible ver que dias se gasto mas — que es justo para lo que sirve. Ahora
cada punto lleva lo suyo.

El toggle va solo en este chart. Analizados los 7: el 4 (Ahorro acumulado)
acumula a proposito porque mide como crece el bote, el 5 (heatmap) ya es por
dia, y el resto son mensuales por diseno.

La ventana ancha (12 meses / 8 trimestres) solo se pide cuando el toggle no
esta en dias; en dias el mes que ya se traia basta. El navegador de mes
sigue mandando: mueve el final de la ventana, no cambia de significado."
```

---

### Task 3: `resolverMeta` — nombre → meta_id

**Files:**
- Create: `js/meta-resolver.js`
- Create: `test/meta-resolver.test.mjs`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `test/meta-resolver.test.mjs`:

```javascript
import assert from 'node:assert';
import { test } from 'node:test';
import { resolverMeta } from '../js/meta-resolver.js';

// Nombres reales de la base: llevan emoji y tildes a propósito.
const METAS = [
  { id: 'm1', nombre: 'Alquiler 🏠' },
  { id: 'm2', nombre: 'Máquina de afeitar' },
  { id: 'm3', nombre: 'Fondo de emergencia' },
];

test('casa ignorando el emoji', () => {
  assert.deepStrictEqual(resolverMeta('alquiler', METAS), { meta_id: 'm1' });
});

test('casa ignorando tildes y stopwords', () => {
  assert.deepStrictEqual(resolverMeta('maquina', METAS), { meta_id: 'm2' });
  assert.deepStrictEqual(resolverMeta('máquina de afeitar', METAS), { meta_id: 'm2' });
});

test('sin match → error, sin meta_id', () => {
  const r = resolverMeta('viaje a japon', METAS);
  assert.strictEqual(r.error, 'no-encontrada');
  assert.strictEqual(r.meta_id, undefined);
});

test('ambigua → lista las candidatas', () => {
  const dos = [{ id: 'a', nombre: 'Viaje a Cusco' }, { id: 'b', nombre: 'Viaje a Lima' }];
  const r = resolverMeta('viaje', dos);
  assert.strictEqual(r.error, 'ambigua');
  assert.deepStrictEqual(r.candidatas, ['Viaje a Cusco', 'Viaje a Lima']);
});

test('mas tokens desambiguan', () => {
  const dos = [{ id: 'a', nombre: 'Viaje a Cusco' }, { id: 'b', nombre: 'Viaje a Lima' }];
  assert.deepStrictEqual(resolverMeta('viaje cusco', dos), { meta_id: 'a' });
});

test('nombre vacio → error', () => {
  assert.strictEqual(resolverMeta('', METAS).error, 'sin-nombre');
  assert.strictEqual(resolverMeta(null, METAS).error, 'sin-nombre');
});

test('lista de metas vacia → no-encontrada', () => {
  assert.strictEqual(resolverMeta('alquiler', []).error, 'no-encontrada');
});

// "casa" NO debe casar con "Máquina" por ser subcadena.
test('NO casa por subcadena accidental', () => {
  assert.strictEqual(resolverMeta('casa', METAS).error, 'no-encontrada');
});
```

- [ ] **Step 2: Verificar que falla**

Run: `node --test test/meta-resolver.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar**

Crear `js/meta-resolver.js`:

```javascript
// ─────────────────────────────────────────────────────────────────
// Nestra — meta-resolver.js (Tanda 3, #6)
// Resuelve el nombre que el usuario escribe en el quick-add a una meta.
// Puro: recibe las metas, no consulta la base. Dual-export.
// ─────────────────────────────────────────────────────────────────
'use strict';

import { tokenize } from './autocat.js';

// resolverMeta(nombre, metas) → { meta_id } | { error, candidatas }
//   error ∈ 'sin-nombre' | 'no-encontrada' | 'ambigua'
//
// Casa por tokens reusando tokenize(), que ya baja a minúsculas, quita tildes,
// emoji y stopwords: "alquiler" casa con "Alquiler 🏠" y "maquina" con
// "Máquina de afeitar" sin normalizar nada aparte.
//
// Una meta es candidata si TODOS los tokens escritos están entre los suyos. Por
// tokens y no por subcadena: así "casa" no casa con "Máquina" por accidente, y
// escribir más palabras desambigua en vez de romper.
function resolverMeta(nombre, metas) {
  var buscados = tokenize(nombre || '');
  if (!buscados.length) return { error: 'sin-nombre', candidatas: [] };
  var cand = (metas || []).filter(function (m) {
    var suyos = tokenize(m.nombre || '');
    return buscados.every(function (b) { return suyos.indexOf(b) !== -1; });
  });
  if (cand.length === 1) return { meta_id: cand[0].id };
  if (cand.length === 0) return { error: 'no-encontrada', candidatas: [] };
  return { error: 'ambigua', candidatas: cand.map(function (m) { return m.nombre; }) };
}

if (typeof window !== 'undefined') {
  window.resolverMeta = resolverMeta;
}

export { resolverMeta };
```

- [ ] **Step 4: Verificar que pasa**

Run: `node --test test/meta-resolver.test.mjs`
Expected: PASS — 8/8.

- [ ] **Step 5: Commit**

```bash
git add js/meta-resolver.js test/meta-resolver.test.mjs
git commit -m "feat(quickadd): resolverMeta — nombre escrito → meta

Reusa tokenize() de autocat.js, que ya quita tildes, emoji y stopwords: no
hace falta normalizador nuevo. Verificado contra los nombres reales de la
base: 'Alquiler 🏠' → ['alquiler'], 'Máquina de afeitar' → ['maquina',
'afeitar'].

Casa por tokens y no por subcadena, para que 'casa' no case con 'Máquina'
por accidente y escribir mas palabras desambigue. Sin match o con varias
devuelve error con las candidatas: el llamador decide, la funcion no adivina."
```

---

### Task 4: El parser reconoce `meta <nombre>`

**Files:**
- Modify: `js/parse-quickadd.js`
- Modify: `test/parse-quickadd.test.mjs`
- Modify: `index.html`, `sw.js` (cargar/precachear `meta-resolver.js`)

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `test/parse-quickadd.test.mjs`:

```javascript

// ── Aporte a meta (Tanda 3, #6) ────────────────────────────────────────────
// Nombres con emoji y tilde a propósito: son los reales de la base.
const METAS_T3 = [{ id: 'm1', nombre: 'Alquiler 🏠' }, { id: 'm2', nombre: 'Máquina de afeitar' }];
const pm = (s) => parseQuickAdd(s, { hoy: HOY, ctx: { metas: METAS_T3 } });

test('"aporte meta alquiler S/5" → ahorro + meta_id + monto', () => {
  const r = pm('aporte meta alquiler S/5');
  assert.equal(r.tipo, 'ahorro');
  assert.equal(r.meta_id, 'm1');
  assert.equal(r.monto, 5);
});

test('meta sin S/: "meta alquiler 5"', () => {
  const r = pm('meta alquiler 5');
  assert.equal(r.meta_id, 'm1');
  assert.equal(r.monto, 5);
});

test('meta casa con tildes: "meta maquina 20"', () => {
  assert.equal(pm('meta maquina 20').meta_id, 'm2');
});

test('la meta gana al ambito escrito', () => {
  const r = pm('meta alquiler personal S/5');
  assert.equal(r.meta_id, 'm1');
  assert.equal(r.tipo, 'ahorro');
});

test('meta sin match → metaError, sin meta_id, pero el monto se conserva', () => {
  const r = pm('meta viaje a japon S/5');
  assert.equal(r.meta_id, undefined);
  assert.equal(r.metaError, 'no-encontrada');
  assert.equal(r.monto, 5);
});

test('meta ambigua → candidatas', () => {
  const r = parseQuickAdd('meta viaje S/5', {
    hoy: HOY, ctx: { metas: [{ id: 'a', nombre: 'Viaje Cusco' }, { id: 'b', nombre: 'Viaje Lima' }] },
  });
  assert.equal(r.metaError, 'ambigua');
  assert.deepEqual(r.metaCandidatas, ['Viaje Cusco', 'Viaje Lima']);
});

test('REGRESION: sin la palabra "meta" nada cambia', () => {
  const r = pm('uber 15');
  assert.equal(r.tipo, 'gasto');
  assert.equal(r.monto, 15);
  assert.equal(r.meta_id, undefined);
});

test('REGRESION: "ahorro hogar S/100" sigue igual (ya funcionaba)', () => {
  const r = pm('ahorro hogar S/100');
  assert.equal(r.tipo, 'ahorro');
  assert.equal(r.ambito, 'hogar');
  assert.equal(r.monto, 100);
  assert.equal(r.meta_id, undefined);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `node --test test/parse-quickadd.test.mjs`
Expected: FAIL — los 6 primeros nuevos fallan (`tipo` es `'gasto'`, `meta_id` es `undefined`).
Los 2 de regresión pasan ya.

- [ ] **Step 3: Implementar**

En `js/parse-quickadd.js`, añadir el import tras el que ya existe:

```javascript
import { tokenize, matchCategoria } from './autocat.js';
import { resolverMeta } from './meta-resolver.js';
```

E insertar este bloque **justo antes** del comentario `// 5. Descripción.`:

```javascript
  // 4.5 Aporte a meta: "meta <nombre>" apunta a una meta concreta y fuerza
  // tipo=ahorro (un aporte a meta siempre lo es).
  //
  // Va DESPUES del monto a proposito: si se extrae antes, el nombre se traga la
  // cifra ("meta alquiler S/5" → nombre "alquiler S/5" y monto null).
  //
  // El \b de los dos lados no es decorativo: sin el, "meta" casaria dentro de
  // otras palabras.
  //
  // El ambito NO se toca: lo hereda la meta (aporte_directo_meta usa el suyo),
  // asi que un ambito escrito a mano se ignora — la meta es lo especifico.
  const mMeta = str.match(/\bmeta\b\s*(.*)$/i);
  if (mMeta) {
    out.tipo = 'ahorro';
    const res = resolverMeta(mMeta[1], (ctx && ctx.metas) || []);
    if (res.meta_id) out.meta_id = res.meta_id;
    else { out.metaError = res.error; out.metaCandidatas = res.candidatas || []; }
    str = str.slice(0, mMeta.index) + ' ';
  }

```

- [ ] **Step 4: Verificar los bytes del regex**

Run: `grep -n "mMeta = str.match" js/parse-quickadd.js | cat -A`
Expected: `const mMeta = str.match(/\bmeta\b\s*(.*)$/i);$` — con `\b` literales.
**Si aparece `^H`, los `\b` se convirtieron en backspaces** y el regex no casa con nada:
reescribir a mano. Esto pasó de verdad al redactar el plan.

- [ ] **Step 5: Verificar que pasa**

Run: `node --test test/parse-quickadd.test.mjs`
Expected: PASS — 23/23 (15 previos + 8 nuevos).

- [ ] **Step 6: Cargar y precachear `meta-resolver.js`**

En `index.html`, junto a los otros módulos:

```html
    <script type="module" src="js/meta-resolver.js"></script>
```

En `sw.js`:

```javascript
  { url: 'js/meta-resolver.js', revision: SHELL_VERSION },
```

**Ojo al orden:** `parse-quickadd.js` importa `meta-resolver.js`, que importa `autocat.js`.
Como son módulos ES, el orden de los `<script type="module">` no importa para la resolución
(el navegador resuelve el grafo), pero los tres deben estar precacheados o la app rompe offline.

- [ ] **Step 7: Suite completa**

Run: `node --test test/*.test.mjs`
Expected: `# pass 271`, `# fail 0`. (255 + 8 del Task 3 + 8 del Task 4.)

- [ ] **Step 8: Commit**

```bash
git add js/parse-quickadd.js test/parse-quickadd.test.mjs index.html sw.js
git commit -m "feat(quickadd): reconoce 'meta <nombre>' como aporte a esa meta

'aporte meta alquiler S/5' parseaba como gasto personal. Ahora fuerza
tipo=ahorro y resuelve la meta por nombre.

De lo que pedia el item, esto es lo unico que faltaba: 'ahorro hogar S/100'
y 'ahorro 50' ya funcionaban (insertTransaccion llama a distribuir_ahorro
solo). Verificado con parseQuickAdd antes de tocar nada.

La extraccion va DESPUES del monto: al reves el nombre se traga la cifra.
El ambito lo hereda la meta, no la sintaxis."
```

---

### Task 5: El quick-add hace el aporte directo

**Files:**
- Modify: `views/transaccion.html` (`_ctxPara` y `quickAgregar`, ~líneas 1370-1420)

- [ ] **Step 1: Pasar las metas en el ctx**

En `_ctxPara(tipo)` (~línea 1370), añadir las metas al contexto que devuelve. Leer primero la
función para ver qué forma tiene; debe seguir devolviendo lo que ya devolvía **más**
`metas: <array de { id, nombre }>`.

Las metas se obtienen con `getMetas()` (`js/db.js`). Filtrar a las que tienen sentido como
destino de un aporte: `estado === 'en_curso'`. **No filtrar por ámbito**: el usuario puede
aportar a una meta personal o del hogar, y es la meta la que decide el ámbito.

- [ ] **Step 2: Manejar el error de meta y el aporte directo**

En `quickAgregar` (~línea 1395), tras la línea `if (r.monto == null) { ... return; }`, añadir
el manejo del error de meta:

```javascript
        if (r.metaError) {
          errEl.textContent = r.metaError === 'ambigua'
            ? 'Hay varias metas que coinciden: ' + r.metaCandidatas.join(', ') + '. Precisa cuál.'
            : 'No encontré una meta con ese nombre.';
          errEl.style.display = 'block';
          return;
        }
```

Y reemplazar el insert:

```javascript
        const tx = await insertTransaccion({
          tipo: r.tipo, ambito: r.ambito,
          categoria_id: r.tipo === 'ahorro' ? null : r.categoria_id,
          monto: r.monto, fecha: r.fecha, nota: r.descripcion,
        });
        _quickTxId = tx && tx.id;
```

por:

```javascript
        let txId;
        if (r.meta_id) {
          // Aporte 100% a una meta: aporte_directo_meta lo asigna entero, marca
          // es_aporte_directo (para que distribuir_ahorro la salte) y manda el
          // excedente al fondo del ambito de la meta.
          // OJO: es online-only (lanza si !navigator.onLine). El quick-add normal
          // sí encola offline; este no puede — calcular el excedente exige leer
          // el estado de la meta en el servidor. El catch de abajo muestra ese
          // mensaje tal cual.
          txId = await insertAporteDirecto(r.meta_id, r.monto, r.fecha, r.descripcion);
        } else {
          const tx = await insertTransaccion({
            tipo: r.tipo, ambito: r.ambito,
            categoria_id: r.tipo === 'ahorro' ? null : r.categoria_id,
            monto: r.monto, fecha: r.fecha, nota: r.descripcion,
          });
          txId = tx && tx.id;
        }
        _quickTxId = txId;
```

**Cuidado con el `catch`:** el `catch (e)` de `quickAgregar` (~línea 1416) pone
`'No se pudo guardar. Reintenta.'`, que taparía el mensaje útil de
`insertAporteDirecto` cuando no hay red (`Esta acción requiere conexión a internet.`).
Cambiar el catch para preferir el mensaje del error si lo trae:

```javascript
      } catch (e) {
        console.error('quickAgregar falló:', e);
        errEl.textContent = (e && e.message) ? e.message : 'No se pudo guardar. Reintenta.';
        errEl.style.display = 'block';
      }
```

- [ ] **Step 3: Verificar la ruta de `_mostrarConfirm`**

`_mostrarConfirm(r)` se llama tras el insert y arma el texto de confirmación leyendo `r.tipo`
y `r.ambito`. Con un aporte a meta, `r.ambito` es el que el parser dejó (`personal` por
defecto), que **puede no ser el de la meta**. Leer `_mostrarConfirm` y comprobar qué muestra.

Si menciona el ámbito, o bien no mencionarlo cuando hay `meta_id`, o mostrar "a tu meta" en su
lugar. **No inventar**: reportar qué hace y elegir lo mínimo que no mienta.

- [ ] **Step 4: Verificar en el navegador**

Levantar el preview. **Desregistrar el SW primero** o se sirve el `js/` cacheado:

```javascript
for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
for (const k of await caches.keys()) await caches.delete(k);
location.reload(true);
```

Entrar con `nestra.pwa.test@gmail.com` / `Test!Pwa-2026-throwaway` (ver memoria
`nestra-v2-test-account`). Ese usuario está en el hogar de pruebas, que tiene la meta
**"ZZ Meta fixture"**.

En el quick-add del dashboard:
1. `meta zz 25` → debe crear un aporte directo a "ZZ Meta fixture". Verificar en `#metas` que
   el progreso subió 25, y en la base que la fila lleva `es_aporte_directo = true`.
2. `meta noexiste 10` → error "No encontré una meta con ese nombre." y **no guarda nada**.
3. `uber 15` → sigue creando un gasto normal (regresión).

- [ ] **Step 5: Limpiar los datos de prueba**

Borrar el aporte de 25 y su transacción; dejar la meta y el hogar de pruebas (el usuario pidió
conservarlos). Verificar que las metas del **hogar real** siguen intactas:

```sql
select m.nombre, mp.monto_actual from public.metas m
join public.metas_con_progreso mp on mp.id = m.id
where m.hogar_id = '5891e9b2-a935-447c-9f83-3ae3a857cd30';
-- Esperado: Alquiler 🏠 = 155.00, Fondo de emergencia = 350.00
```

- [ ] **Step 6: Commit**

```bash
git add views/transaccion.html
git commit -m "feat(quickadd): 'meta <nombre>' hace un aporte directo a esa meta

Cablea el parseo de meta con insertAporteDirecto (RPC aporte_directo_meta),
que ya existia: asigna el 100% a la meta, la marca es_aporte_directo para
que distribuir_ahorro la salte, y manda el excedente al fondo del ambito de
la meta.

Sin match o con varias candidatas: error y no guarda nada. El usuario nombro
una meta concreta; guardar en otro sitio es peor que no guardar.

El catch deja de tapar el mensaje del error: insertAporteDirecto es
online-only y su 'Esta accion requiere conexion' es util, a diferencia del
generico 'No se pudo guardar'."
```

---

### Task 6: Bump y deploy

**Files:**
- Modify: `sw.js:15`

- [ ] **Step 1: Bump**

En `sw.js:15`: `const SHELL_VERSION = 'v29';` → `const SHELL_VERSION = 'v30';`

- [ ] **Step 2: Suite completa**

Run: `node --test test/*.test.mjs`
Expected: `# pass 271`, `# fail 0`. **Si algo falla, parar.**

Run: `grep -c "graficos-serie.js\|meta-resolver.js" sw.js`
Expected: `2` — los dos módulos precacheados.

- [ ] **Step 3: Commit y push**

```bash
git add sw.js
git commit -m "chore(tanda3): bump SHELL_VERSION a v30

Modulos nuevos (js/graficos-serie.js, js/meta-resolver.js) y cambios en
views/graficos.html, views/transaccion.html, js/parse-quickadd.js."
git push origin v2
```

- [ ] **Step 4: Verificar el deploy**

**Usar cache-buster**: la caché de borde de Pages devuelve el archivo viejo y da falsos
negativos (pasó dos veces en tandas anteriores).

Run: `curl -sL "https://nestra-8rl.pages.dev/sw.js?cb=$RANDOM" | grep SHELL_VERSION`
Expected: `const SHELL_VERSION = 'v30';`

Run: `curl -sL "https://nestra-8rl.pages.dev/js/graficos-serie.js?cb=$RANDOM" | head -3`
Expected: la cabecera del módulo.

- [ ] **Step 5: Avisar al usuario**

Recargar o cerrar/reabrir la PWA. Qué va a ver: en `#graficos`, el gráfico de evolución ya no
sube en escalera —cada día lleva lo suyo— y hay un toggle Días/Meses/Trimestres. En el
quick-add, `meta alquiler S/5` aporta directo a "Alquiler 🏠".

---

## Self-Review

**Spec coverage:**

| Requisito del spec | Tarea |
|---|---|
| §1 — quitar el cumsum del chart 1 | Task 2 Step 6 (+ grep de verificación en Step 7) |
| §1 — toggle días/meses/trimestres solo en el chart 1 | Task 2 Steps 2 y 4 |
| §1 — ventanas 12 meses / 8 trimestres, navegador mueve el final | Task 2 Step 5 |
| §1 — bucketing en módulo puro con tests | Task 1 |
| §1 — ventana ancha solo si granularidad ≠ días | Task 2 Step 5 |
| §2 — parser reconoce `meta <nombre>`, tipo=ahorro | Task 4 |
| §2 — matching vía tokenize (emoji, tildes) | Task 3 |
| §2 — el ámbito lo hereda la meta | Task 4 Step 3 (comentario explícito) |
| §2 — sin match/ambigua → error, no guarda | Task 4 (parser) + Task 5 Step 2 (UI) |
| §2 — `insertAporteDirecto` en vez de `insertTransaccion` | Task 5 Step 2 |
| §2 — online-only documentado y su mensaje visible | Task 5 Step 2 (el fix del catch) |
| Pruebas — los 3 sets | Tasks 1, 3, 4 |
| Pruebas — manual con el fixture | Task 5 Step 4 |

Sin huecos.

**Placeholder scan:** sin TBD/TODO. Dos tareas piden **leer antes de escribir** en vez de dar
el código: Task 5 Step 1 (`_ctxPara`, cuya forma no se citó) y Step 3 (`_mostrarConfirm`, que
puede mostrar un ámbito que ya no aplica). Es deliberado: no vi esas dos funciones enteras y
prefiero que el implementador reporte a que yo invente su contenido.

**Type consistency:**
- `agruparSerie(txs, granularidad, hasta, n)` → `[{label, gasto, ingreso}]` — misma firma en
  el test (Task 1 Step 1), la implementación (Step 3) y el llamador (Task 2 Step 6). En
  `'dias'` se llama sin `n`, que la función ignora. Verificado ejecutándolo.
- `resolverMeta(nombre, metas)` → `{meta_id}` | `{error, candidatas}` — misma forma en el test
  (Task 3 Step 1), la implementación (Step 3) y el consumidor (Task 4 Step 3).
- `out.meta_id` / `out.metaError` / `out.metaCandidatas` — los pone el parser (Task 4) y los
  leen los tests (Task 4 Step 1) y la vista (Task 5 Step 2). Consistentes.
- `estado.granularidad` — la declara Task 2 Step 4 y la leen `cargarDatos` (Step 5) y
  `render1` (Step 6).
- `datos.serieAmplia = { txs, n }` — la construye Task 2 Step 5 en ambas ramas y la lee
  `render1` (Step 6).
