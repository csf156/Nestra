# Rediseño de Configuración: de 7 acordeones a 6 sub-vistas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) o superpowers:executing-plans para ejecutar este plan task por task. Los pasos usan checkbox (`- [ ]`).

**Goal:** Reemplazar los 7 acordeones de `#configuracion` por un índice con 6 sub-vistas navegables, sin perder ni un solo control de los que existen hoy y sin tocar los datos de nadie.

**Architecture:** Las secciones siguen siendo las **mismas `<section>` del mismo `views/configuracion.html`**; solo cambia cuál está visible. El router aprende a partir el hash por `/` para que `#configuracion/categorias` resuelva a la vista de configuración con contexto. Cero fetch nuevo, cero DOM reescrito, cero migración.

**Tech Stack:** PWA vanilla sin build, router por hash, `node:test` para lógica pura.

---

## Por qué el acordeón no se arregla puliéndolo

Falla por estructura, no por estética: es un contenedor de altura ilimitada dentro de un scroll ilimitado. Con **30 categorías de gasto**, el encabezado se pierde arriba, el scroll no tiene final conocido, y cerrar exige volver a subir. Con 7 acordeones hay 128 combinaciones de abierto/cerrado y ninguna es memorable.

La sub-vista da título fijo, botón atrás, scroll acotado al tema, y **URL propia** — que permite enlazar desde el resto de la app (un insight de presupuesto → `#configuracion/categorias`) y hace que el gesto "atrás" del teléfono funcione gratis.

## La garantía que el usuario pidió

Puso dos condiciones duras: que no se pierda ningún elemento, y que se mantenga la configuración de cada usuario.

**Ambas se cumplen por construcción, no por cuidado:**
- Las secciones no se reescriben. Se mueven dentro del mismo archivo y se muestran de una en una. Si el elemento estaba en el DOM, sigue estándolo.
- **Nada de esto toca datos.** Es presentacional. La única excepción es mover *dónde se edita* `limite_mensual_hogar`, y sigue escribiendo la misma columna con la misma función.

## Números reales (verificados en la base el 2026-09-06)

40 categorías: **30 de gasto activas** (21 con límite, **9 sin**) y 10 de ingreso. 2 categorías con `limite_mensual_hogar`. 0 archivadas. 5 recurrentes, 1 plantilla.

`views/configuracion.html`: **2012 líneas**, con CSS y JS en línea.

---

## Inventario completo — nada de esto puede perderse

| Hoy (acordeón) | Controles | Va a |
|---|---|---|
| **Perfiles** | contenedor dinámico `cfgPerfilesCont` | Cuenta y datos |
| **Categorías** | añadir; form (nombre, tipo, límite mensual); lista gastos; lista ingresos; modales eliminar / editar / elegir ícono (`cfgAccModal`) | Categorías y presupuestos |
| **Recurrentes** | form (descripción, monto, día de cargo, tipo, frecuencia, categoría) + lista | Automatismos |
| **Preferencias** | modo oscuro; moneda; % ahorro metas; % fondo personal; % fondo hogar (oculto sin hogar); notificaciones push; idioma | se **parte** entre Tu dinero y Apariencia |
| **Plantillas** | lista + form (nombre, monto, categoría) | Automatismos |
| **Hogar** | renombrar; aporte esperado por miembro; modo de reparto (50/50 · proporcional); **límite mensual de hogar por categoría** | Hogar, salvo el límite → Categorías |
| **Datos** | exportar JSON; importar JSON; cerrar sesión; resetear todo (modal) | Cuenta y datos |

**La duplicación que hay que arreglar:** el límite por categoría se edita en **dos pantallas distintas** — el personal en Categorías, el del hogar en `views/configuracion.html:1963-2000`, dentro de Hogar. Mismo concepto, dos sitios. Se unifican en Categorías con el selector de ámbito que la app ya usa en otras vistas.

## El índice: 6 filas

1. **Tu dinero** — % ahorro metas, % fondo personal, % fondo hogar, moneda. *"Ahorro 20% · PEN"*
   Los porcentajes **no son preferencias**: gobiernan safe-to-spend, metas y Brújula. Esconderlos entre ajustes cosméticos es por qué nadie los encuentra.
2. **Categorías y presupuestos** — las 40, con límite personal **y** de hogar. *"30 gastos · 21 con presupuesto"*
3. **Automatismos** — recurrentes, plantillas, y sitio para "conectar correo" cuando exista. *"5 recurrentes · 1 plantilla"*
   Los tres son "cosas que crean transacciones sin que las escribas".
4. **Hogar** — renombrar, aporte esperado, modo de reparto. Oculto sin hogar, como ya está.
5. **Apariencia y avisos** — modo oscuro, idioma, notificaciones push.
6. **Cuenta y datos** — perfiles, exportar, importar, cerrar sesión, y al fondo el reseteo.
   Perfil es *quién eres*; hogar es *con quién compartes*. Por eso Perfiles va aquí.

**Peligro y frecuencia:** el toggle de modo oscuro vive **en la propia fila del índice** como switch en línea — única excepción, se toca a diario y no tiene consecuencias. El reseteo va al fondo de Cuenta y datos tras un separador "Zona de peligro", **con rojo solo en el botón, nunca en el título de la fila del índice**: pintar la sección de rojo hace que el usuario la evite entera, incluido "exportar respaldo", que es justo lo que sí quieres que use.

---

## Estructura de archivos

- Modificar: `js/router.js` — partir el hash por `/`.
- Create: `js/config-rutas.js` — resolución de sub-ruta, pura y testeable.
- Create: `test/config-rutas.test.mjs`.
- Modificar: `views/configuracion.html` — índice, mostrado por sub-vista, reagrupación, pantalla de categorías.
- Modificar: `index.html`, `sw.js` — alta del módulo, `SHELL_VERSION`.

---

### Task 1: El router aprende sub-rutas

Hoy `js/router.js` toma el hash completo y busca `ROUTES[hash]`, así que `#configuracion/categorias` cae en desconocido y rebota al dashboard.

**Files:**
- Create: `js/config-rutas.js`
- Test: `test/config-rutas.test.mjs`
- Modify: `js/router.js`

- [ ] **Step 1: Escribir el test que falla**

Crear `test/config-rutas.test.mjs`:

```js
// test/config-rutas.test.mjs
// Partir el hash en ruta base + sub-ruta. Puro: entra un string, sale un objeto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partirHash, subvistaValida } from '../js/config-rutas.js';

test('partirHash: sin sub-ruta devuelve base y sub vacía', () => {
  assert.deepEqual(partirHash('configuracion'), { base: 'configuracion', sub: '' });
});

test('partirHash: con sub-ruta las separa', () => {
  assert.deepEqual(partirHash('configuracion/categorias'), { base: 'configuracion', sub: 'categorias' });
});

test('partirHash: ignora barras de más y espacios', () => {
  assert.deepEqual(partirHash('configuracion//categorias/'), { base: 'configuracion', sub: 'categorias' });
  assert.deepEqual(partirHash('  configuracion/hogar  '), { base: 'configuracion', sub: 'hogar' });
});

test('partirHash: solo la PRIMERA barra separa; el resto se ignora', () => {
  // No hay sub-sub-vistas. Si algún día las hay, este test se cambia a propósito.
  assert.deepEqual(partirHash('configuracion/categorias/gastos'), { base: 'configuracion', sub: 'categorias' });
});

test('partirHash: entradas basura no revientan', () => {
  assert.deepEqual(partirHash(''), { base: '', sub: '' });
  assert.deepEqual(partirHash(null), { base: '', sub: '' });
  assert.deepEqual(partirHash('/'), { base: '', sub: '' });
});

test('subvistaValida: reconoce las seis', () => {
  ['dinero', 'categorias', 'automatismos', 'hogar', 'apariencia', 'cuenta']
    .forEach((s) => assert.equal(subvistaValida(s), true, s));
});

test('subvistaValida: cualquier otra cosa es falsa', () => {
  assert.equal(subvistaValida('inventada'), false);
  assert.equal(subvistaValida(''), false);
  assert.equal(subvistaValida(null), false);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/config-rutas.test.mjs`
Expected: FAIL — `Cannot find module '../js/config-rutas.js'`

- [ ] **Step 3: Implementar**

Crear `js/config-rutas.js`:

```js
// js/config-rutas.js — sub-rutas de #configuracion. Puro: entra el hash ya sin
// almohadilla, sale { base, sub }. Carga doble: <script type="module">
// (window.*) y ESM en node:test.

// Las seis sub-vistas del índice. Una sub-ruta fuera de esta lista se trata
// como "sin sub-ruta" y cae en el índice — nunca rebota al dashboard, que es
// lo que hacía el router antes de conocer las barras.
var SUBVISTAS = ['dinero', 'categorias', 'automatismos', 'hogar', 'apariencia', 'cuenta'];

// partirHash(hash) → { base, sub }
function partirHash(hash) {
  var partes = String(hash == null ? '' : hash).trim().split('/').filter(Boolean);
  return { base: partes[0] || '', sub: partes[1] || '' };
}

// subvistaValida(sub) → boolean
function subvistaValida(sub) {
  return SUBVISTAS.indexOf(String(sub || '')) !== -1;
}

if (typeof window !== 'undefined') {
  window.partirHash = partirHash;
  window.subvistaValida = subvistaValida;
  window.CFG_SUBVISTAS = SUBVISTAS;
}
export { partirHash, subvistaValida, SUBVISTAS };
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test test/config-rutas.test.mjs`
Expected: PASS — 7 tests.

- [ ] **Step 5: Enganchar el router**

En `js/router.js`, dentro de `handleRouteChange`, donde hoy se resuelve `ROUTES[hash]`, resolver por la base y dejar la sub-ruta accesible para la vista:

```js
    // El hash puede traer sub-ruta (#configuracion/categorias). La ruta se
    // resuelve por la BASE; la sub viaja aparte para que la vista la lea.
    var partes = (typeof partirHash === 'function')
      ? partirHash(hash)
      : { base: hash, sub: '' };
    window.routerContext = { sub: partes.sub };
    var rutaBase = partes.base || DEFAULT_ROUTE;
```

y usar `rutaBase` en la búsqueda de `ROUTES` y en el resto de la función, en lugar de `hash`.

> **Lee la función entera antes de editarla.** Usa `hash` en más de un sitio (log, comparaciones, quizá el guard de auth) y hay que cambiar los que deban mirar la base sin romper los que deban ver el hash completo.

- [ ] **Step 6: Cargar el módulo**

En `index.html`, junto a los otros `<script type="module">`:

```html
    <script type="module" src="js/config-rutas.js"></script>
```

Y en `sw.js`, al precache: `{ url: 'js/config-rutas.js', revision: SHELL_VERSION },`

> `js/config-rutas.js` debe cargarse **antes** que `js/router.js` para que `partirHash` exista cuando el router arranque. Verificar el orden en `index.html`.

- [ ] **Step 7: Verificar que no se rompió la navegación normal**

En el preview: `#dashboard`, `#historial`, `#metas`, `#configuracion` siguen cargando. Una ruta inventada (`#noexiste`) sigue rebotando al dashboard.

- [ ] **Step 8: Commit**

```bash
git add js/config-rutas.js test/config-rutas.test.mjs js/router.js index.html sw.js
git commit -m "feat(router): sub-rutas por barra para #configuracion"
```

---

### Task 2: El índice y el mostrado por sub-vista

**Files:**
- Modify: `views/configuracion.html`

- [ ] **Step 1: Añadir el índice**

Al principio del `<main>` de la vista, antes de las secciones existentes. Enlaces reales, no botones con JS — así el teclado y el gesto atrás funcionan gratis:

```html
<nav class="cfg-indice" id="cfgIndice" aria-label="Secciones de configuración">
  <a class="cfg-indice-fila" href="#configuracion/dinero">
    <span class="cfg-indice-nombre">Tu dinero</span>
    <span class="cfg-indice-sub" data-summary="dinero"></span>
  </a>
  <a class="cfg-indice-fila" href="#configuracion/categorias">
    <span class="cfg-indice-nombre">Categorías y presupuestos</span>
    <span class="cfg-indice-sub" data-summary="categorias"></span>
  </a>
  <a class="cfg-indice-fila" href="#configuracion/automatismos">
    <span class="cfg-indice-nombre">Automatismos</span>
    <span class="cfg-indice-sub" data-summary="automatismos"></span>
  </a>
  <a class="cfg-indice-fila" href="#configuracion/hogar" id="cfgIndiceHogar">
    <span class="cfg-indice-nombre">Hogar</span>
    <span class="cfg-indice-sub" data-summary="hogar"></span>
  </a>
  <a class="cfg-indice-fila" href="#configuracion/apariencia">
    <span class="cfg-indice-nombre">Apariencia y avisos</span>
    <span class="cfg-indice-sub" data-summary="apariencia"></span>
  </a>
  <a class="cfg-indice-fila" href="#configuracion/cuenta">
    <span class="cfg-indice-nombre">Cuenta y datos</span>
    <span class="cfg-indice-sub" data-summary="cuenta"></span>
  </a>
</nav>
```

> Los `data-summary` ya existen y se rellenan solos; reutilizar ese mecanismo tal cual. Revisar cómo se pueblan hoy y ampliarlo a las claves nuevas (`dinero`, `automatismos`, `apariencia`, `cuenta`).

`#cfgIndiceHogar` se oculta cuando no hay hogar, con la misma condición que hoy oculta la sección.

- [ ] **Step 2: Reagrupar las secciones**

Cada sección pasa de acordeón a sub-vista: quitar el `<button class="cfg-acord-head">` y el envoltorio `cfg-acord-body`, dejando el contenido con un encabezado fijo y un botón atrás a `#configuracion`.

Las secciones nuevas **Tu dinero**, **Apariencia y avisos**, **Automatismos** y **Cuenta y datos** se arman **moviendo los bloques existentes**, no reescribiéndolos:

- *Tu dinero* ← de Preferencias: `cfgPctAhorro` (+ su hint), `cfgPctFondoPersonalRow`, `cfgPctFondoHogarRow` (+ `cfgPctFondoHint`), y la fila de moneda (`cfgMonedaValor`).
- *Apariencia y avisos* ← de Preferencias: modo oscuro (`cfgDarkToggle`), idioma, notificaciones push (`pushToggle`).
- *Automatismos* ← las secciones Recurrentes y Plantillas completas, una tras otra con su encabezado.
- *Cuenta y datos* ← `cfgPerfilesCont` + la sección Datos completa.

> **Mover, no recrear.** Corta y pega los nodos con sus `id` intactos: todo el JS de la vista los busca por `id` y romperlos es la forma más fácil de perder un control sin notarlo. Al terminar, comprueba que **cada `id` del inventario sigue existiendo** con un grep.

- [ ] **Step 3: Mostrar solo la sub-vista activa**

```js
  // mostrarSubvista(sub) — enseña una sección y esconde el resto. El DOM NO se
  // reescribe: solo cambia la visibilidad, así que ningún control puede
  // perderse ni ningún estado en curso se descarta.
  var SECCIONES = {
    dinero: 'cfgDineroSection',
    categorias: 'cfgCatSection',
    automatismos: 'cfgAutomatismosSection',
    hogar: 'cfgHogarSection',
    apariencia: 'cfgAparienciaSection',
    cuenta: 'cfgCuentaSection',
  };

  function mostrarSubvista(sub) {
    var valida = (typeof subvistaValida === 'function') && subvistaValida(sub);
    var indice = document.getElementById('cfgIndice');
    // Sub-ruta desconocida → índice, NO dashboard.
    if (indice) indice.hidden = valida;
    Object.keys(SECCIONES).forEach(function (k) {
      var el = document.getElementById(SECCIONES[k]);
      if (!el) return;
      el.style.display = (valida && k === sub) ? '' : 'none';
    });
    window.scrollTo(0, 0);
  }
```

Llamarla al iniciar la vista con `(window.routerContext || {}).sub`, y también al cambiar el hash dentro de la misma vista (el router no vuelve a montar la vista si la base no cambia — **verificar ese comportamiento** y, si hace falta, escuchar `hashchange` desde la vista).

- [ ] **Step 4: Modo oscuro en la fila del índice**

Mover el toggle `cfgDarkToggle` a la fila de *Apariencia* del índice, como switch en línea. Su click **no** debe navegar: `ev.preventDefault()` y `ev.stopPropagation()` en el handler del toggle, porque vive dentro de un `<a>`.

- [ ] **Step 5: Verificar en navegador**

1. `#configuracion` muestra el índice de 6 filas con sus subtítulos.
2. Cada fila entra a su sub-vista; atrás vuelve al índice.
3. El gesto atrás del navegador funciona.
4. `#configuracion/inventada` cae en el índice, **no** en el dashboard.
5. Sin hogar, la fila de Hogar no aparece.
6. El toggle de modo oscuro funciona desde el índice sin navegar.
7. **Recorrer el inventario entero** y confirmar que cada control existe y responde.

- [ ] **Step 6: Commit**

```bash
git add views/configuracion.html
git commit -m "feat(configuracion): índice de 6 sub-vistas en vez de 7 acordeones"
```

---

### Task 3: La pantalla de categorías

El dolor concreto: 30 filas de gasto y 10 de ingreso apiladas. Para ver una de ingreso hay que scrollear las 30 de gasto.

**Files:**
- Modify: `views/configuracion.html`

- [ ] **Step 1: Cabecera fija con buscador y segmentos**

```html
<div class="cfg-cat-cabecera">
  <input type="search" id="cfgCatBuscar" class="cfg-input"
         placeholder="Buscar categoría…" autocomplete="off">
  <div class="cfg-cat-segmentos" role="group" aria-label="Tipo de categoría">
    <button type="button" class="cfg-seg is-activo" data-cat-tipo="gasto">Gastos</button>
    <button type="button" class="cfg-seg" data-cat-tipo="ingreso">Ingresos</button>
  </div>
  <div class="cfg-cat-filtros">
    <button type="button" class="cfg-chip" id="cfgCatChipSinPresupuesto" aria-pressed="false">
      Sin presupuesto
    </button>
  </div>
</div>
```

Los segmentos muestran **un tipo a la vez** — hoy son dos listas apiladas, y esa es la mitad del desorden reportado. El contador va en la etiqueta (*"Gastos (30)"*), calculado al pintar.

- [ ] **Step 2: Filtrado en vivo**

El buscador filtra **al teclear**, sin submit, reutilizando `normalizeDesc` de `js/autocat.js` para que "cafe" encuentre "Café". El chip "Sin presupuesto" filtra a las que tienen `limite_mensual` nulo — **9 hoy**, y es el uso real de "verlas de un vistazo": no leer 21 números, sino encontrar las que faltan.

> **No paginar.** 30 nodos no son un problema de rendimiento, y paginar rompe el buscador y la noción de cuántas hay.

- [ ] **Step 3: Unificar el límite de hogar**

El límite del hogar se edita hoy en `views/configuracion.html:1963-2000`, dentro de Hogar. Traerlo aquí: cuando hay hogar, cada fila ofrece los dos ámbitos con el selector que la app ya usa.

Sigue llamando a `updateCategoria(catId, { limite_mensual_hogar: ... })` — **misma columna, misma función, sin migración**. Y quitar ese bloque de la sección Hogar para que no queden dos sitios.

- [ ] **Step 4: Conservar lo que ya funciona**

- El límite se ve **en la fila** (`cfg-cat-limite-static`); no hay que entrar a verlo.
- La edición en línea del número (`cfg-cat-limite-input`) se queda como atajo: tap en el número edita solo el número. **No** convertir la fila entera en formulario.
- Tap en la fila abre la hoja de acciones que ya existe (`cfgAccModal`: editar / archivar / eliminar).
- Bloque colapsado al fondo con las archivadas: *"Archivadas (N)"*. Hoy son 0, pero la lista existe y no puede desaparecer.

- [ ] **Step 5: Orden**

Por defecto, las que tienen presupuesto y están cerca del límite arriba — `js/presupuestos-orden.js` ya existe y hace eso. Toggle a alfabético.

- [ ] **Step 6: Verificar en navegador**

1. Entra mostrando Gastos (30); el segmento de Ingresos muestra 10.
2. Teclear "com" filtra en vivo; "cafe" encuentra "Café".
3. El chip "Sin presupuesto" deja **9**.
4. Editar un límite en línea lo guarda y se refleja al volver.
5. Con hogar: el ámbito cambia y guarda en la columna correcta.
6. La hoja de acciones sigue abriendo con editar / archivar / eliminar.
7. En 375px la cabecera no tapa la lista y el buscador es alcanzable con el pulgar.

- [ ] **Step 7: Bump, suite y commit**

`sw.js`: `SHELL_VERSION` a la siguiente sin usar (la última publicada es `v49`; si la Etapa F ya la consumió, subir a `v50`).

Run: `for f in test/*.test.mjs; do node --test "$f" || echo "FAIL $f"; done`
Expected: sin líneas `FAIL`.

```bash
git add views/configuracion.html sw.js
git commit -m "feat(configuracion): pantalla de categorías con buscador y ámbito unificado"
```

---

### Task 4: Auditoría final del inventario

El riesgo real de esta etapa no es un bug: es **perder un control sin que nadie lo note** hasta dentro de un mes.

**Files:** ninguno (verificación).

- [ ] **Step 1: Comparar los `id` antes y después**

```bash
git show origin/main:views/configuracion.html | grep -oE 'id="[a-zA-Z0-9_-]+"' | sort -u > /tmp/ids_antes.txt
grep -oE 'id="[a-zA-Z0-9_-]+"' views/configuracion.html | sort -u > /tmp/ids_despues.txt
diff /tmp/ids_antes.txt /tmp/ids_despues.txt
```

Expected: solo líneas `>` (ids nuevos). **Cualquier línea `<` es un control que desapareció** — investigarla una por una antes de dar la etapa por buena.

- [ ] **Step 2: Recorrer el inventario a mano**

Con la tabla del inventario de este plan delante, abrir cada sub-vista y confirmar que cada control existe y responde. Anotar cuál se revisó, para que el reporte sea verificable y no una afirmación.

- [ ] **Step 3: Confirmar que ningún dato cambió**

Consulta de solo lectura, antes y después:

```sql
select
 (select count(*) from public.categorias) categorias,
 (select count(*) from public.categorias where limite_mensual is not null) con_limite,
 (select count(*) from public.categorias where limite_mensual_hogar is not null) con_limite_hogar,
 (select count(*) from public.recurrentes) recurrentes,
 (select count(*) from public.plantillas) plantillas;
```

Expected: idénticos. Es un cambio presentacional; **si algún número se movió, algo escribió cuando no debía**.

---

## Fuera de alcance, a propósito

**Sacar el CSS y el JS en línea a `css/` y `js/configuracion.js`.** Las 2012 líneas piden ese refactor y este es el momento natural, pero mezclarlo con el cambio de estructura hace que un rollback sea imposible de acotar. Va en su propio PR, después de que este esté en producción y estable.
