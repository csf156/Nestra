# Chart "Aporte real vs. esperado" — desglose gasto/ahorro — Design & Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el chart 3 de `#graficos` deje de sumar gasto+ahorro en una barra única, y que se calcule desde datos que ya están cargados en vez de con su propia consulta.

**Architecture:** La barra "Real" se parte en dos segmentos apilados (gasto y ahorro) junto a la de "Esperado". `getAportesPorMiembro` (`js/db.js`) se borra entera: su cálculo lo hace `aporteRealPorMiembro` (`js/hogar-aporte.js`, puro, 9 tests) sobre el `txMes` que `cargarDatos` ya trae, y el `aporte_esperado` sale de `window.hogarState.miembros`, que ya lo incluye.

**Tech Stack:** JS vanilla sin build, Chart.js, tests con `node --test test/*.test.mjs`. Sin cambios en la base.

Spec y plan van juntos: el cambio es pequeño y está cerrado. Documento único.

---

## Por qué

`getAportesPorMiembro` (`js/db.js:658`) calcula `real` = **suma de gasto hogar + ahorro hogar**, y `render3` (`views/graficos.html:437`) lo pinta como una barra contra "Esperado".

Es el mismo defecto que la Tanda 2 arregló en la card de `#hogar`: **gasto y ahorro no son la misma moneda.** El gasto se fue; el ahorro vuelve a quien lo puso al disolver (ver `docs/superpowers/specs/2026-07-16-tanda2-desequilibrio-gasto-ahorro-design.md`). Sumarlos en una barra insinúa que quien ahorra aporta más.

Y con `aporte_esperado = 0` en ambos miembros — su estado real — las barras de "Esperado" están en **cero**, así que el gráfico degenera en dos totales lado a lado: exactamente la lectura de carrera que se quitó del texto y que aquí sigue viva en barras.

**Con los datos reales del fixture** (verificado el 2026-07-17):

| | total | gasto | ahorro |
|---|---|---|---|
| test1 (Tú) | 180.54 | **125.54** | 55.00 |
| test2 (Pareja) | 500.00 | 50.00 | **450.00** |

La barra de test2 seguirá siendo más alta — y está bien, puso más al hogar. Lo que cambia es que se verá que **450 de sus 500 son ahorro** (dinero que recupera) y que lo de test1 es casi todo gasto (que no vuelve). El gráfico deja de mentir sin dejar de responder su pregunta.

### La decisión que NO se tomó

Se consideró **borrar el chart**: duplica la card "Aporte del mes" de `#hogar` (mismos datos, mismo periodo, misma comparación). El usuario eligió **arreglarlo**: quiere la versión gráfica. La duplicación se acepta a conciencia.

También se consideró un **estado vacío** cuando ambos `aporte_esperado` son 0 (un gráfico de metas sin metas no dice nada). Se descartó: hoy dejaría el chart invisible para ellos hasta que fijaran la meta.

## Por qué se borra `getAportesPorMiembro`

No es limpieza gratuita: es **la forma de arreglar el bug sin duplicar aritmética**.

- Hace su **propia consulta** a `transacciones`, pero `cargarDatos` ya trae `txMes` con `select('*')` — tiene `user_id`, `tipo`, `ambito`, `monto`, `fecha`. La consulta sobra.
- Su cálculo es una **copia sin tests** de `aporteRealPorMiembro`, que es pura, tiene **9 tests** y ya devuelve `{ gasto, ahorro, total }` — justo el desglose que hace falta.
- El `aporte_esperado` ya viene en `window.hogarState.miembros` (`db.js:1464` lo selecciona).
- **Un solo caller**: `views/graficos.html:313`.

Si en vez de borrarla se le añadiera el desglose, quedarían dos implementaciones del mismo cálculo, una con tests y otra sin.

**Bonus verificado:** la función actual no redondea y devuelve `180.54000000000002`. `aporteRealPorMiembro` sí (`r2`), así que el camino nuevo da `180.54`.

## Equivalencia, ya verificada

Contra el hogar de pruebas (2 miembros, ver memoria `nestra-v2-test-account`), el 2026-07-17, **antes de escribir este plan**: el camino nuevo (`txMes` + `hogarState.miembros` + `aporteRealPorMiembro`) devuelve **los mismos totales y los mismos esperados** que `getAportesPorMiembro`. Comprobado en el navegador con ambos caminos lado a lado.

**El riesgo que eso descarta:** `getAportesPorMiembro` consulta `transacciones` **sin filtrar por `hogar_id`** (confía en la RLS), mientras la rama hogar de `cargarDatos` filtra `hogar_id != null`. Para un usuario con un solo hogar es equivalente — y lo es, medido. La Task 3 lo re-verifica tras el cambio.

---

## File Structure

| Archivo | Qué cambia | Tarea |
|---|---|---|
| `js/db.js` | **Borrar** `getAportesPorMiembro` (~40 líneas) | 1 |
| `views/graficos.html` | `cargarDatos` deja de llamarla y pasa `miembros`; `render3` apila | 2 |
| — | Verificación en navegador contra el fixture | 3 |
| `sw.js` | Bump `SHELL_VERSION` + deploy | 4 |

**Estado verificado (2026-07-17):** 271 tests pasan. `SHELL_VERSION = 'v30'`. Rama única: `main`, **protegida** — el deploy es por PR, no por push directo.

---

### Task 1: Borrar `getAportesPorMiembro`

**Files:**
- Modify: `js/db.js` (~líneas 653-696)

- [ ] **Step 1: Confirmar que solo hay un caller**

Run: `grep -rn "getAportesPorMiembro" js/ views/ test/`
Expected: 2 hits — la definición en `js/db.js` y **un** caller en `views/graficos.html:313`.
Si hay más, **parar y reportar**: el plan asume uno solo.

- [ ] **Step 2: Borrar la función**

En `js/db.js`, borrar el bloque entero de `getAportesPorMiembro` **incluido su comentario de cabecera** (empieza en `// getAportesPorMiembro(mes, anio) — aporte real al hogar por cada miembro en el` y termina en el `}` de cierre de la función, ~línea 696).

Comprobar si el archivo la expone en `window` o la exporta al final y quitar esa línea también.

Run: `grep -n "getAportesPorMiembro" js/db.js`
Expected: sin resultados (exit 1).

- [ ] **Step 3: Verificar que db.js sigue parseando**

Run: `node --check js/db.js`
Expected: sin output.

Run: `node --test test/*.test.mjs`
Expected: `# pass 271`, `# fail 0`. (Ningún test la cubría — esa es parte del motivo por el que se va.)

**No commitear todavía:** `views/graficos.html` la sigue llamando y la vista queda rota entre esta tarea y la 2. Son consecutivas y no se despliega hasta la 4. Si prefieres commits siempre-verdes, hacer 1 y 2 juntas.

---

### Task 2: Apilar la barra Real y cambiar la fuente

**Files:**
- Modify: `views/graficos.html` (~línea 313 en `cargarDatos`, ~línea 437 `render3`)

- [ ] **Step 1: Leer el sitio exacto**

Leer `views/graficos.html` alrededor de las líneas 290-320 (la rama hogar de `cargarDatos`, con su `Promise.all` y el objeto que retorna) y 437-463 (`render3`). **Localizar por contenido, los números son aproximados.**

Confirmar que existen: `resHog`, `aportesMiembro`, `r` (el rango del mes), `estado.mes`, `estado.anio`, `datos.txMes`.

- [ ] **Step 2: Quitar la llamada del `Promise.all` — SIN renumerar índices**

En la rama hogar de `cargarDatos`, el `Promise.all` incluye `getAportesPorMiembro(m, a)` en la **posición 3**, y hay 5 usos de `resHog[N]` repartidos por la función (líneas 317, 328, 329, 330, 332, 334).

**NO borres la entrada del array y renumeres a mano.** Si te dejas uno, `resHog[4]` (el balance de 6 meses del chart "Ahorro acumulado") pasaría a recibir el array de metas: el gráfico se pintaría igual, con datos de otro sitio. Un bug silencioso y plausible, que es el peor tipo.

**Haz esto en su lugar:** sustituye la entrada por `null` para que los índices no se muevan.

```javascript
      var resHog = await Promise.all([
        getTransacciones({ fecha_desde: r.desde, fecha_hasta: r.hasta })
          .then(function (a) { return (a || []).filter(function (x) { return x.hogar_id != null; }); }),
        getResumenMensual(m, a),
        getResumenMensual(ant.mes, ant.anio),
        // [3] libre: aquí iba getAportesPorMiembro. El chart 3 ahora se calcula
        // desde txMes con aporteRealPorMiembro. Se deja el hueco en vez de
        // renumerar: los índices de abajo son posicionales y moverlos en
        // silencio le daría al chart 4 los datos del 7.
        null,
        Promise.all(meses6.map(function (x) { return getAhorrosHogar(x.mes, x.anio); })),
        getMetas(),
      ]);
```

Un `null` en `Promise.all` se resuelve a `null` sin problema. Cuesta una línea muerta y ahorra una clase entera de bug.

Reemplazar `aportesMiembro: resHog[3] || [],` en el objeto retornado por:

```javascript
        // Miembros con su aporte_esperado. hogarState ya los trae (db.js:1464 los
        // selecciona) y el router lo prima al iniciar sesión (Tanda 1), así que no
        // hace falta consultar de nuevo. El "real" lo calcula render3 desde txMes
        // con aporteRealPorMiembro, que es pura y tiene tests.
        miembrosHogar: ((typeof window !== 'undefined' && window.hogarState && window.hogarState.miembros) || []),
```

En la rama **personal**, el objeto retornado tiene `aportesMiembro: []`. Cambiarlo por `miembrosHogar: [],` (el chart 3 no se pinta en personal — `visiblesPara` lo excluye — pero el campo debe existir para no dejar `undefined` suelto).

- [ ] **Step 3: Reescribir `render3`**

Reemplazar `render3` entero por:

```javascript
    function render3(datos) {
      var miembros = datos.miembrosHogar || [];
      if (!miembros.length) { setEstado(3, 'vacio'); return; }
      var uid = (window.currentUser && window.currentUser.id) || null;
      var rango = {
        desde: new Date(estado.anio, estado.mes - 1, 1).toISOString().slice(0, 10),
        hasta: new Date(estado.anio, estado.mes, 0).toISOString().slice(0, 10),
      };
      var filas = miembros.map(function (m) {
        var r = (typeof aporteRealPorMiembro === 'function')
          ? aporteRealPorMiembro(datos.txMes, m.user_id, rango)
          : { gasto: 0, ahorro: 0, total: 0 };
        return {
          nombre: (m.user_id === uid) ? 'Tú' : 'Pareja',
          esperado: Number(m.aporte_esperado) || 0,
          gasto: r.gasto, ahorro: r.ahorro,
        };
      });

      setEstado(3, 'ok');
      charts.chart3 = new Chart($('chart3'), {
        type: 'bar',
        data: {
          labels: filas.map(function (x) { return x.nombre; }),
          datasets: [
            // La barra "Real" va apilada en dos: el gasto se fue, el ahorro
            // vuelve a quien lo puso al disolver. Sumarlos en una sola insinuaba
            // que quien ahorra aporta más. Ver el spec de la Tanda 2.
            { label: 'Esperado', data: filas.map(function (x) { return x.esperado; }),
              backgroundColor: cssVar('--text-secondary'), stack: 'esperado' },
            { label: 'Real · gasto', data: filas.map(function (x) { return x.gasto; }),
              backgroundColor: cssVar('--color-primary'), stack: 'real' },
            { label: 'Real · ahorro', data: filas.map(function (x) { return x.ahorro; }),
              backgroundColor: cssVar('--color-success'), stack: 'real' },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: _legendOpts(cssVar('--text-dark')) },
          scales: {
            x: { stacked: true, ticks: _tickOpts(cssVar('--text-secondary')), grid: { display: false } },
            y: { stacked: true, ticks: _tickOpts(cssVar('--text-secondary')), grid: { color: cssVar('--border-light') }, beginAtZero: true },
          },
        },
      });
    }
```

Los `stack:` distintos son lo que mantiene "Esperado" como barra **aparte** en vez de sumarse a las otras dos. Sin ellos, con `stacked: true`, las tres se apilarían juntas y el gráfico mentiría peor que antes.

- [ ] **Step 4: Actualizar la descripción de la card**

En `views/graficos.html` (~línea 38):

```html
      <p class="graf-card-desc">Aporte al hogar de cada miembro este mes.</p>
```

por:

```html
      <p class="graf-card-desc">Aporte al hogar de cada miembro este mes, en gasto y en ahorro.</p>
```

- [ ] **Step 5: Verificar**

Run: `grep -n "getAportesPorMiembro\|aportesMiembro" views/graficos.html`
Expected: sin resultados (exit 1).

Run: `grep -rn "getAportesPorMiembro" js/ views/ test/`
Expected: **sin resultados en todo el repo** (exit 1).

Run: `node --test test/*.test.mjs`
Expected: `# pass 271`, `# fail 0`.

- [ ] **Step 6: Commit (Tasks 1 y 2 juntas)**

```bash
git add js/db.js views/graficos.html
git commit -m "fix(graficos): el chart de aportes desglosa gasto y ahorro

La barra 'Real' sumaba gasto hogar + ahorro hogar. Es el mismo defecto que
la Tanda 2 arreglo en la card de #hogar: no son la misma moneda — el gasto
se fue, el ahorro vuelve a quien lo puso al disolver. Con aporte_esperado en
0 (su estado real) las barras de 'Esperado' estan en cero, asi que el
grafico degeneraba en dos totales lado a lado: la lectura de carrera que se
quito del texto seguia viva en barras.

Ahora 'Real' va apilada en gasto + ahorro. Con los datos reales se ve que
450 de los 500 de un miembro son ahorro (que recupera) y que los 180 del
otro son casi todo gasto (que no vuelve).

Se borra getAportesPorMiembro: hacia su propia consulta a transacciones
pese a que cargarDatos ya trae txMes con select('*'), y su calculo era una
copia sin tests de aporteRealPorMiembro — que es pura, tiene 9 tests y ya
devuelve { gasto, ahorro, total }. El aporte_esperado sale de
hogarState.miembros, que ya lo incluye. Menos codigo, una query menos, y la
aritmetica pasa a estar cubierta.

Equivalencia verificada contra el hogar de pruebas antes de tocar nada:
mismos totales y mismos esperados por ambos caminos. De paso desaparece un
error de float — la funcion vieja devolvia 180.54000000000002, la pura
redondea a 180.54."
```

---

### Task 3: Verificar en el navegador

- [ ] **Step 1: Levantar el preview y limpiar el SW**

`preview_start` con la config `nestra`. **El SW sirve el `js/` cacheado**, así que sin esto se verifica código rancio:

```javascript
for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
for (const k of await caches.keys()) await caches.delete(k);
location.reload(true);
```

Entrar con `nestra.pwa.test@gmail.com` / `Test!Pwa-2026-throwaway` (memoria `nestra-v2-test-account`). Está en el hogar de pruebas de 2 miembros.

- [ ] **Step 2: Confirmar que la función vieja ya no existe**

```javascript
typeof window.getAportesPorMiembro   // debe dar 'undefined'
```

- [ ] **Step 3: Verificar el chart contra los valores conocidos**

Ir a `#graficos` y cambiar al ámbito **Hogar** (el chart 3 no se pinta en personal).

```javascript
const c = Chart.getChart('chart3');
c.data.datasets.map(d => ({ label: d.label, stack: d.stack, data: d.data }))
```

Expected, con el fixture:
- `Esperado` (stack `esperado`): `[0, 0]`
- `Real · gasto` (stack `real`): `[125.54, 50]`
- `Real · ahorro` (stack `real`): `[55, 450]`

**Si los totales no dan 180.54 y 500, el cambio de fuente de datos rompió algo** — parar y reportar.

- [ ] **Step 4: Verificar que "Esperado" NO se apila con las otras**

Visualmente: debe haber **dos barras por miembro** (una de Esperado, otra de Real dividida en dos colores), no una sola torre de tres segmentos. Si Esperado se suma encima, los `stack:` están mal.

Con el fixture Esperado es 0, así que su barra no se ve — eso es correcto y no prueba nada sobre el apilado. **Para probarlo, fijar temporalmente un `aporte_esperado`** a un miembro del hogar de pruebas, recargar, comprobar que salen dos barras separadas, y devolverlo a 0:

```sql
update public.hogar_miembros set aporte_esperado = 300
 where user_id = '2da98c7b-e56e-427e-be3e-787913a24477';
-- verificar en el navegador, luego:
update public.hogar_miembros set aporte_esperado = 0
 where user_id = '2da98c7b-e56e-427e-be3e-787913a24477';
```

- [ ] **Step 5: Comprobar que NO se rompieron los charts vecinos**

`resHog` se lee por posición, y el hueco de la entrada 3 quedó como `null`. Si alguien renumeró, los charts 4 y 7 estarían leyendo datos del vecino — y se verían **igual de plausibles**. Comprobar explícitamente:

```javascript
const c4 = Chart.getChart('chart4');
const c7 = Chart.getChart('chart7');
({ chart4_labels: c4 && c4.data.labels,          // deben ser meses: ene, feb...
   chart4_datos:  c4 && c4.data.datasets[0].data, // numeros, no objetos
   chart7_existe: !!c7 })
```

Si `chart4` muestra etiquetas raras o su data no son números, el `null` se perdió.

- [ ] **Step 6: Comprobar móvil y consola**

`resize_window` a mobile (375px). El chart no debe desbordar. Consola sin errores.

- [ ] **Step 7: Confirmar que el hogar real sigue intacto**

```sql
select m.nombre, mp.monto_actual from public.metas m
join public.metas_con_progreso mp on mp.id = m.id
where m.hogar_id = '5891e9b2-a935-447c-9f83-3ae3a857cd30';
-- Esperado: Alquiler 🏠 = 155.00, Fondo de emergencia = 350.00
```

---

### Task 4: Bump y deploy

**Files:**
- Modify: `sw.js:15`

- [ ] **Step 1: Bump**

`const SHELL_VERSION = 'v30';` → `const SHELL_VERSION = 'v31';`

- [ ] **Step 2: Suite**

Run: `node --test test/*.test.mjs`
Expected: `# pass 271`, `# fail 0`. **Si algo falla, parar.**

- [ ] **Step 3: PR — `main` está protegida, el push directo se rechaza**

```bash
git add sw.js
git commit -m "chore: bump SHELL_VERSION a v31

Cambiaron js/db.js y views/graficos.html."
git checkout -b fix/chart-aportes-desglose
git push -u origin fix/chart-aportes-desglose
gh pr create --base main --title "fix(graficos): el chart de aportes desglosa gasto y ahorro" --body "..."
gh pr merge <N> --merge --admin
```

**Ojo con los worktrees:** `main` está checkouteado en `C:/Users/csf93/Desktop/Nestra`, así que `git checkout main` aquí falla con *"already used by worktree"*. Trabajar en una rama aparte y abrir PR lo evita.

- [ ] **Step 4: Verificar el deploy — con cache-buster**

La caché de borde de Pages devuelve el archivo viejo y da falsos negativos (pasó 3 veces).

Run: `curl -sL "https://nestra-8rl.pages.dev/sw.js?cb=$RANDOM" | grep SHELL_VERSION`
Expected: `const SHELL_VERSION = 'v31';`

Run: `curl -sL "https://nestra-8rl.pages.dev/js/db.js?cb=$RANDOM" | grep -c getAportesPorMiembro`
Expected: `0` — la función ya no se sirve.

---

## Self-Review

**Cobertura:** barra apilada (Task 2 Step 3) · borrar la función y su query (Tasks 1, 2 Step 2) · reusar `aporteRealPorMiembro` (Task 2 Step 3) · `aporte_esperado` desde `hogarState` (Task 2 Step 2) · verificación contra el fixture (Task 3) · deploy (Task 4). Sin huecos.

**Placeholder scan:** sin TBD. El cuerpo del PR en Task 4 Step 3 va como `"..."` a propósito: se escribe con lo que salga de la verificación.

**Type consistency:** `aporteRealPorMiembro(txs, userId, rango)` → `{gasto, ahorro, total}` — misma firma que sus 9 tests y que el uso en `views/hogar.html`. `datos.miembrosHogar` sustituye a `datos.aportesMiembro`: lo pone `cargarDatos` en ambas ramas (Task 2 Step 2) y lo lee `render3` (Step 3). Los elementos llevan `{ user_id, aporte_esperado }`, que es lo que `hogarState.miembros` trae (`db.js:1464` selecciona `user_id, rol, joined_at, aporte_esperado`).

**Riesgo principal, y cómo se neutraliza:** `resHog` se lee por posición en 6 sitios. Quitar la entrada 3 desplazaría `[4]` (el balance de 6 meses del chart "Ahorro acumulado") y `[5]` (las metas de los charts 7/8/9), y el resultado se pintaría **igual de plausible con datos de otro sitio** — un bug que ningún test caza y que a ojo no se ve. Por eso Task 2 Step 2 deja un `null` en el hueco en vez de renumerar. Aun así, Task 3 debe **mirar los charts 4 y 7 además del 3**: es la única red si alguien "limpia" el `null` más adelante.
