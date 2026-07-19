# Pulido visual de #revisar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arreglar el padding ausente de `#revisar`, devolver la card compacta a una jerarquía legible, hacer descubrible el swipe y cerrar dos huecos de teclado — sin tocar lógica de negocio.

**Architecture:** Todo el cambio vive en un solo archivo, `views/revisar.html`, que contiene su `<style>`, su marcado y su `<script>` IIFE (patrón de todas las vistas de este repo). Más un bump de `SHELL_VERSION` en `sw.js`. No se crean archivos nuevos ni se toca CSS global.

**Tech Stack:** HTML/CSS/JS vanilla, sin build. Tokens CSS en `css/base.css`. Componentes en `css/components.css`. Service Worker con Workbox vendorizado.

**Spec:** `docs/superpowers/specs/2026-07-18-revisar-pulido-visual-design.md`

---

## Nota sobre verificación — leer antes de empezar

**Este repo no tiene test runner.** No hay `package.json`, ni `tests/`, ni Jest/Vitest/Playwright. No inventes uno ni añadas dependencias: la app es vanilla sin build **a propósito** (ver `CLAUDE.md`). El único test automatizado del proyecto es SQL (`supabase/tests/schema_contract_test.sql`) y **no aplica aquí** — este trabajo no toca el esquema.

Por lo tanto, la verificación de cada tarea es **manual en navegador**, y los pasos la describen de forma concreta. Levanta el server una sola vez al empezar:

```
preview_start con { name: "nestra" }
```

Sirve `npx serve -l 5050 .`. Navega a `http://localhost:5050/#revisar`.

**El server local es solo para tu verificación — el usuario no lo ve.** Su sitio es Cloudflare Pages, que reconstruye al mergear a `main`.

**Ojo con la caché del Service Worker:** el SW cachea las vistas con NetworkFirst, así que un recargo online basta para ver cambios en `views/revisar.html`. Si algo parece no aplicarse, hard-reload (Ctrl+Shift+R) antes de sospechar de tu código.

**Para ver cards de verdad** necesitas filas en `ingest_pendientes`. Si la cuenta de prueba no tiene, la vista muestra el estado vacío y no podrás verificar nada de las tareas 2-6. En ese caso, inyecta filas de prueba desde la consola del navegador **antes** de que corra `init()` no es viable (el IIFE corre al cargar la vista); en su lugar usa este stub temporal en la consola y vuelve a navegar a `#revisar`:

```js
// Stub SOLO para verificación visual. NO commitear. Sobrescribe la función que
// lee de la base para que init() renderice cards falsas.
window.getIngestPendientes = async () => ([
  { id: 'demo-1', banco: 'bbva', estado: 'pendiente', tipo: 'gasto',
    comercio: 'RIMAC SEGUROS Y REASEGUROS', monto: 1250.5, fecha: '2026-07-16',
    created_at: '2026-07-16T10:00:00Z' },
  { id: 'demo-2', banco: 'bcp', estado: 'pendiente', tipo: 'gasto',
    comercio: 'WONG', monto: 89.9, fecha: '2026-07-17',
    created_at: '2026-07-17T18:30:00Z' },
  { id: 'demo-3', banco: 'yape', estado: 'revisar-manual', tipo: 'gasto',
    raw_subject: 'Constancia de operacion', monto: 20, fecha: '2026-07-18',
    created_at: '2026-07-18T09:00:00Z' },
]);
```

Con el stub puesto, navega a otra vista y vuelve a `#revisar` para que `init()` corra de nuevo.

**Nunca uses el hogar real para probar el ámbito hogar.** Hay una cuenta y un hogar de pruebas permanentes (ver memoria del proyecto).

**Restricción dura que aplica a TODAS las tareas:** los `id` (`revCard{i}`, `revChip{i}`, `revMonto{i}`, `revFecha{i}`, `revTipo{i}`, `revAmbito{i}`, `revCat{i}`, `revCatWrap{i}`, `revErr{i}`, `revPartesGroup{i}`, `revPartesFilas{i}`, `revPartesRestante{i}`, `revPartesErr{i}`) y los atributos `data-rev-expandir`, `data-rev-chip`, `data-rev-confirmar`, `data-rev-descartar`, `data-idx` se conservan **exactamente**. El JS los busca por `getElementById` y por delegación de eventos. Cambiar uno rompe la vista en silencio, sin error en consola.

---

## Task 1: Padding del contenedor

Arregla el bug reportado por el usuario. Es el cambio de mayor impacto y el de menor riesgo, así que va primero y se commitea solo.

**Files:**
- Modify: `views/revisar.html:2`

- [ ] **Step 1: Ver el bug**

Con el server levantado, abre `http://localhost:5050/#revisar` y pon el viewport en móvil:

```
resize_window con { preset: "mobile" }
```

Confirma visualmente que el título "Revisar movimientos" y el texto de abajo tocan el borde izquierdo de la pantalla, sin aire.

- [ ] **Step 2: Aplicar el padding**

En `views/revisar.html`, reemplaza la línea 2:

```css
  .rev { max-width: 640px; margin: 0 auto; }
```

por:

```css
  .rev {
    max-width: 640px;
    margin: 0 auto;
    padding: var(--space-md);
    padding-bottom: calc(var(--space-xl) + 72px); /* hueco para el FAB global */
  }
  @media (min-width: 600px) {
    .rev { padding: var(--space-lg); padding-bottom: calc(var(--space-xl) + 72px); }
  }
```

Estos valores no son inventados: son los mismos de `.dash` en `views/dashboard.html:113-121`.

- [ ] **Step 3: Verificar en móvil**

Recarga `#revisar` a 375px de ancho. Esperado: hay `1rem` de aire a izquierda y derecha, y el contenido ya no toca los bordes.

- [ ] **Step 4: Verificar en desktop**

```
resize_window con { preset: "desktop" }
```

Esperado: el padding sube a `1.5rem` y la columna sigue centrada con `max-width: 640px`.

- [ ] **Step 5: Verificar el hueco del FAB**

Con el stub de 3 cards puesto, scrollea hasta el fondo de la lista. Esperado: la última card queda por encima del FAB y de la nav inferior, no debajo.

- [ ] **Step 6: Commit**

```bash
git add views/revisar.html
git commit -m "fix(revisar): la vista no tenía padding y el texto pegaba al borde

.rev era la única vista sin padding: ni el suyo ni heredado, porque
.app-container (index.html:145) es una clase que no existe en ningún CSS.
En móvil el texto tocaba los bordes y la última card quedaba bajo el FAB.

Se copian los valores de .dash (dashboard.html:113) en vez de elegir unos
nuevos, para que las vistas no vuelvan a divergir.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: El h1 usa la fuente de display

**Files:**
- Modify: `views/revisar.html:4`

- [ ] **Step 1: Aplicar Playfair al título**

En `views/revisar.html`, reemplaza la línea 4:

```css
  .rev-title { font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); }
```

por:

```css
  .rev-title { font-family: var(--font-display); font-size: var(--font-size-2xl); font-weight: 400; }
```

Por qué `font-weight: 400` y no `bold`: `css/base.css:116` pone todo `h1, h2` en Playfair con peso 400, y dashboard/historial/login lo respetan. Además `--font-weight-bold` vale 600 en este repo (`css/base.css:45`), no 700 — pedir "bold" no da el contraste que uno esperaría.

- [ ] **Step 2: Verificar**

Recarga `#revisar`. Esperado: "Revisar movimientos" se ve en serif (Playfair Display), del mismo tamaño y peso que el "Metas" de `#metas` o el saludo de `#dashboard`. Compara navegando entre vistas.

- [ ] **Step 3: Commit**

```bash
git add views/revisar.html
git commit -m "style(revisar): el título usa Playfair como el resto de vistas

base.css:116 pone todo h1/h2 en la fuente de display; esta vista era la
única que lo pisaba con Outfit.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Jerarquía de la card compacta

El núcleo del trabajo. La card pasa a leerse como un comprobante: metadatos pequeños arriba, comercio como título, monto como ancla grande, chip de categoría al pie.

**Files:**
- Modify: `views/revisar.html` (bloque `<style>`, líneas ~15-16 y ~57-59; y la función `cardHTML`, líneas ~196-213)

- [ ] **Step 1: Reemplazar las reglas CSS de la card compacta**

En el `<style>`, **borra** estas cuatro reglas. Las dos primeras están juntas (líneas ~15-16); las otras dos están más abajo (líneas ~58-59), separadas de las primeras:

```css
  .rev-compact-top { display: flex; align-items: center; gap: var(--space-sm); }
  .rev-compact-monto { margin-left: auto; font-weight: var(--font-weight-bold); color: var(--text-dark); }
```

```css
  .rev-banco { text-transform: uppercase; }
  .rev-fecha-correo { color: var(--text-secondary); font-size: var(--font-size-xs); margin-left: auto; }
```

Las cuatro se reemplazan por el bloque del paso siguiente. `.rev-banco` y `.rev-fecha-correo` **se redefinen ahí** — si no borras estas versiones quedarán duplicadas y la de `margin-left: auto` romperá la línea de metadatos.

Borra también `.rev-top` (línea ~57), que es distinta de `.rev-compact-top` pese al nombre parecido:

```css
  .rev-top { display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; margin-bottom: var(--space-sm); }
```

Es CSS muerto: ningún marcado de la vista usa esa clase. Verifícalo antes de borrar con `grep -n "rev-top" views/revisar.html` — deben salir solo la definición y ninguna aparición en el HTML generado.

**Añade** en su lugar, junto a la regla de `.rev-compact`:

```css
  /* Cabecera tipo recibo: banco y fecha son metadatos, no estados. Por eso el
     banco dejó de ser .badge — en el resto de la app .badge significa estado. */
  .rev-meta { display: flex; align-items: center; gap: var(--space-sm);
    font-size: var(--font-size-xs); color: var(--text-secondary); }
  .rev-banco { text-transform: uppercase; letter-spacing: 0.08em; }
  .rev-fecha-correo { color: var(--text-secondary); font-size: var(--font-size-xs); }
  .rev-meta .badge { margin-left: auto; }

  /* El ancla visual de la card. tabular-nums para que los montos de la lista
     alineen en columna, como en dashboard e historial. */
  .rev-monto { margin: 2px 0 0; text-align: right;
    font-family: var(--font-display); font-size: var(--font-size-2xl);
    font-weight: 400; color: var(--text-dark); font-variant-numeric: tabular-nums; }

  .rev-compact-foot { display: flex; align-items: center; gap: var(--space-sm); }
```

Y **modifica** la regla existente de `.rev-banco` en la línea ~58 si quedó duplicada — debe existir una sola. La versión que queda es la de arriba (con `letter-spacing`).

- [ ] **Step 2: Reescribir el marcado compacto en `cardHTML`**

En la función `cardHTML`, reemplaza el bloque que empieza en `'<div class="rev-compact" ...'` y termina antes de `'<div class="rev-expandido">'` por:

```js
        '<div class="rev-compact" data-rev-expandir="' + i + '">' +
          '<div class="rev-meta">' +
            '<span class="rev-banco">' + esc(BANCO_LABEL[p.banco] || p.banco) + '</span>' +
            '<span class="rev-fecha-correo">' + esc((p.created_at || '').slice(0, 10)) + '</span>' +
            (manual ? '<span class="badge badge-warning">Formato no reconocido</span>' : '') +
          '</div>' +
          (texto ? '<p class="rev-comercio">' + esc(texto) + '</p>' : '') +
          '<p class="rev-monto">' + (p.monto != null ? fmt(p.monto) : '—') + '</p>' +
          '<div class="rev-compact-foot">' +
            '<button type="button" class="rev-chip' + (sugerida ? ' rev-chip--sugerida' : '') + '" data-rev-chip="' + i + '" id="revChip' + i + '">' +
              esc(nombreCat(cats, sugerida) || 'Sin categoría') +
            '</button>' +
          '</div>' +
        '</div>' +
```

Cambios respecto al original, todos deliberados:
- El badge del banco es ahora un `<span class="rev-banco">` sin clases `.badge`.
- La fecha subió a la línea de metadatos (antes estaba abajo, junto al chip).
- El monto tiene su propio `<p>` en vez de ir apretado en la fila superior.
- El chip quedó solo al pie, que es donde se toca.
- `data-rev-expandir`, `data-rev-chip` y el `id="revChip{i}"` **no cambian**.

- [ ] **Step 3: Verificar la jerarquía**

Recarga `#revisar` con el stub de 3 cards, a 375px. Esperado:
- Cada card muestra, de arriba abajo: `BBVA  2026-07-16`, luego el comercio en semibold, luego el monto grande en serif alineado a la derecha, luego el chip.
- Los montos de las tres cards **alinean verticalmente** entre sí (esto lo da `tabular-nums`).
- La tercera card (`demo-3`, estado `revisar-manual`) muestra el badge ámbar "Formato no reconocido" empujado a la derecha de la línea de metadatos.
- El comercio largo de `demo-1` no desborda la card (lo cubre `overflow-wrap: anywhere`, que ya estaba).

- [ ] **Step 4: Verificar que no rompiste el comportamiento**

Con el stub puesto, comprueba una por una:
- Tocar la card la expande y muestra los inputs de monto/fecha/tipo/ámbito/categoría.
- Tocar el chip abre el bottom-sheet **sin** expandir la card (el `stopPropagation` sigue vivo).
- Elegir una categoría en el sheet actualiza el texto del chip y le quita el borde punteado.

Si alguna falla, casi seguro es un `id` o `data-` que se perdió al reescribir el marcado.

- [ ] **Step 5: Verificar en tema claro**

```
resize_window con { preset: "mobile", colorScheme: "light" }
```

Esperado: el monto y el comercio siguen legibles sobre el fondo crema; los metadatos en gris quedan más claros pero con contraste suficiente. Los tokens cambian de valor entre temas (`css/base.css:13-83`), así que esto no es redundante.

- [ ] **Step 6: Commit**

```bash
git add views/revisar.html
git commit -m "style(revisar): la card compacta se lee como un comprobante

Antes, banco/monto/chip/fecha tenían peso visual parecido y no había punto
de entrada al escanear la lista. Ahora el monto es el ancla (Playfair 2xl,
tabular-nums para que alineen en columna), el comercio es el título, y
banco+fecha bajan a una línea de metadatos.

El banco deja de usar .badge: no es un estado, y en el resto de la app
.badge significa estado. 'Formato no reconocido' sí se queda como badge
porque eso sí lo es.

Todos los id y data-rev-* se conservan: el JS los busca por getElementById
y por delegación.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: El chip sugerido se distingue del confirmado

Hoy la única diferencia entre "categoría que adivinó la app" y "categoría que elegiste tú" es `border-style: dashed`, invisible en un teléfono.

**Files:**
- Modify: `views/revisar.html:17-22` (reglas `.rev-chip`)

- [ ] **Step 1: Diferenciar los dos estados**

Reemplaza el bloque de reglas del chip:

```css
  .rev-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 12px;
    border-radius: var(--radius-pill, 999px); border: 1px solid var(--border-light);
    background: color-mix(in srgb, var(--text-secondary) 12%, transparent);
    color: var(--text-dark); font-size: var(--font-size-sm); cursor: pointer; transition: background .15s ease; }
  .rev-chip:hover { background: color-mix(in srgb, var(--text-secondary) 20%, transparent); }
  .rev-chip--sugerida { border-style: dashed; }
```

por:

```css
  /* Estado confirmado: sólido y neutro — es un dato ya resuelto. */
  .rev-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 12px;
    border-radius: var(--radius-pill, 999px); border: 1px solid var(--border-light);
    background: color-mix(in srgb, var(--text-secondary) 12%, transparent);
    color: var(--text-dark); font-size: var(--font-size-sm); cursor: pointer;
    transition: background .15s ease, border-color .15s ease; }
  .rev-chip:hover { background: color-mix(in srgb, var(--text-secondary) 20%, transparent); }

  /* Estado sugerido: es una propuesta de la app, no una decisión tuya. Se marca
     en el color de acento (oro) además del borde punteado — el dashed solo no
     se distingue en pantalla de teléfono. */
  .rev-chip--sugerida { border-style: dashed; border-color: var(--color-primary);
    color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
  .rev-chip--sugerida:hover { background: color-mix(in srgb, var(--color-primary) 18%, transparent); }
```

- [ ] **Step 2: Verificar los dos estados lado a lado**

Con el stub, las tres cards arrancan con categoría sugerida (o "Sin categoría" si `autocat` no adivina). Esperado: los chips sugeridos se ven en oro con borde punteado.

Ahora toca un chip, elige una categoría en el sheet y ciérralo. Esperado: ese chip pasa a gris sólido, visiblemente distinto de los otros dos. El código que hace esto ya existe — `elegirCategoria` hace `chip.classList.remove('rev-chip--sugerida')`.

- [ ] **Step 3: Verificar en tema claro**

En claro, `--color-primary` es `#8a6d22` (oro oscuro) en vez de `#c9a84c`. Esperado: el chip sugerido sigue distinguiéndose del confirmado y el texto se lee sobre el fondo tintado.

- [ ] **Step 4: Commit**

```bash
git add views/revisar.html
git commit -m "style(revisar): el chip sugerido se distingue del confirmado

La única señal era border-style: dashed, que en un teléfono no se ve. Ahora
la sugerencia va en el oro de acento (borde, texto y fondo tintado), así que
de un vistazo se sabe qué categorías falta confirmar.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Hacer descubrible el swipe

`.rev-swipe-hint` arranca en `opacity: 0` y solo se revela mientras arrastras, así que el gesto es invisible para quien no lo intenta por accidente.

**Files:**
- Modify: `views/revisar.html` (bloque `<style>`: añadir keyframes; función `init`: marcar la primera card; función `swipeStart`: cancelar la demo)

- [ ] **Step 1: Añadir la animación**

En el `<style>`, después de las reglas de `.rev-swipe-hint--descartar`, añade:

```css
  /* Affordance: el swipe existe pero es invisible hasta que ya lo estás
     haciendo. Una sola vez por carga, la PRIMERA card se desplaza y vuelve,
     revelando un instante el borde de "Confirmar". Sin texto permanente:
     ocuparía sitio fijo para enseñar algo que se aprende una vez. */
  .rev-card.is-demo .rev-swipe-surface { animation: revDemoSurface 1.1s ease .45s 1 both; }
  .rev-card.is-demo .rev-swipe-hint--confirm { animation: revDemoHint 1.1s ease .45s 1 both; }
  @keyframes revDemoSurface {
    0%, 100% { transform: translateX(0); }
    35%, 55% { transform: translateX(14px); }
  }
  @keyframes revDemoHint {
    0%, 100% { opacity: 0; }
    35%, 55% { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .rev-card.is-demo .rev-swipe-surface,
    .rev-card.is-demo .rev-swipe-hint--confirm { animation: none; }
  }
```

- [ ] **Step 2: Marcar la primera card al renderizar**

En `init()`, justo después de `listaEl.style.display = '';`, añade:

```js
      // Solo la primera card, y solo en esta carga de la vista.
      var primera = listaEl.querySelector('.rev-card');
      if (primera) {
        primera.classList.add('is-demo');
        primera.addEventListener('animationend', function quitar() {
          primera.classList.remove('is-demo');
          primera.removeEventListener('animationend', quitar);
        });
      }
```

Por qué se quita al terminar: mientras la clase esté puesta, la animación gana sobre el `transform` inline que escribe `swipeMove` — en la cascada, una animación activa pisa al estilo inline. Si no se retira, el primer arrastre del usuario no se movería.

- [ ] **Step 3: Cancelar la demo si el usuario toca antes**

En `swipeStart`, después de la línea que obtiene `card` y verifica que existe, añade:

```js
    // Un gesto real siempre gana sobre la demo.
    card.classList.remove('is-demo');
```

Colócala justo antes de `var surface = card.querySelector('.rev-swipe-surface');`.

- [ ] **Step 4: Verificar la animación**

Recarga `#revisar` con el stub. Esperado: tras ~0.45s, **solo la primera** card se desliza ~14px a la derecha, se ve asomar la franja verde "Confirmar", y vuelve a su sitio. Las otras dos no se mueven.

- [ ] **Step 5: Verificar que el swipe real sigue funcionando**

Después de que termine la animación, arrastra la primera card a la derecha más allá del 40% de su ancho. Esperado: se comporta igual que antes — o confirma, o se expande y enfoca el campo que falta (según `pendienteCompleto`).

Ahora recarga y arrastra la primera card **durante** la animación. Esperado: el arrastre manda; la card sigue tu dedo/puntero sin saltar.

- [ ] **Step 6: Verificar reduced-motion**

```
javascript_tool: window.matchMedia('(prefers-reduced-motion: reduce)').matches
```

Para forzarlo, usa la emulación de DevTools o el ajuste del sistema. Con `reduce` activo, recarga `#revisar`. Esperado: ninguna card se mueve al cargar, y el swipe manual sigue funcionando.

- [ ] **Step 7: Commit**

```bash
git add views/revisar.html
git commit -m "feat(revisar): la primera card insinúa el swipe al cargar

Los hints de swipe arrancaban en opacity 0 y solo se revelaban durante el
arrastre, así que el gesto era indescubrible para quien no lo intentara por
accidente.

Ahora la primera card de la lista se desplaza y vuelve una vez por carga,
asomando la franja de Confirmar. Se retira la clase en animationend y en
pointerdown: mientras la animación está activa pisa al transform inline que
escribe swipeMove, y sin eso el primer arrastre no respondería.

Respeta prefers-reduced-motion.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Accesibilidad de teclado

Dos huecos concretos. **No** hace falta añadir estilos de foco: `css/components.css:162` ya da outline oro a `a, button, input, select, textarea, [tabindex]` con `:focus-visible`, así que en cuanto el div tenga `tabindex` lo hereda gratis.

**Files:**
- Modify: `views/revisar.html` (función `cardHTML`; handler de click en `init`; nuevo handler de keydown)

- [ ] **Step 1: Hacer el disparador de expandir alcanzable por teclado**

En `cardHTML`, cambia la apertura del div compacto:

```js
        '<div class="rev-compact" data-rev-expandir="' + i + '">' +
```

por:

```js
        '<div class="rev-compact" data-rev-expandir="' + i + '" role="button" tabindex="0" aria-expanded="false">' +
```

Por qué `role="button"` en un div y no un `<button>` de verdad: el chip de categoría es un `<button>` **anidado dentro** de este contenedor, y el HTML no permite botón dentro de botón. Envolver todo en un `<button>` produciría marcado inválido y comportamiento impredecible.

- [ ] **Step 2: Mantener `aria-expanded` sincronizado**

En `init()`, dentro del handler de click de `listaEl`, reemplaza la rama de expandir:

```js
        var expandir = ev.target.closest('[data-rev-expandir]');
        if (expandir && !ev.target.closest('[data-rev-chip]')) { var c = expandir.closest('.rev-card'); c.classList.toggle('is-expanded'); return; }
```

por:

```js
        var expandir = ev.target.closest('[data-rev-expandir]');
        if (expandir && !ev.target.closest('[data-rev-chip]')) {
          var c = expandir.closest('.rev-card');
          var abierta = c.classList.toggle('is-expanded');
          expandir.setAttribute('aria-expanded', abierta ? 'true' : 'false');
          return;
        }
```

- [ ] **Step 3: Activar con Enter y Espacio**

En `init()`, junto a los demás `addEventListener` de `listaEl`, añade:

```js
      // role="button" no trae activación por teclado: hay que darla a mano.
      listaEl.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        var expandir = ev.target.closest('[data-rev-expandir]');
        if (!expandir || ev.target.closest('[data-rev-chip]')) return;
        ev.preventDefault();   // Espacio scrollearía la página
        expandir.click();
      });
```

Se delega en `.click()` para no duplicar la lógica del handler de click.

- [ ] **Step 4: Cerrar el bottom-sheet con Escape**

En `init()`, junto a los otros listeners, añade:

```js
      // El sheet solo cerraba tocando el backdrop; con teclado era una trampa.
      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && _sheetIdx != null) cerrarSheet();
      });
```

`_sheetIdx` ya es la variable que indica si el sheet está abierto (`null` cuando está cerrado) — se declara arriba, junto a `abrirSheet`.

- [ ] **Step 5: Verificar el recorrido de teclado**

Recarga `#revisar` con el stub. Sin tocar el ratón, pulsa Tab repetidamente. Esperado:
- El foco llega a cada card compacta con un outline oro visible.
- Enter (o Espacio) sobre una card la expande, y el contorno no salta a otro sitio.
- Espacio **no** scrollea la página al activar.
- Seguir tabulando entra al chip de categoría, que también recibe outline.

- [ ] **Step 6: Verificar Escape en el sheet**

Con el teclado, activa el chip para abrir el bottom-sheet. Pulsa Escape. Esperado: el sheet se cierra y el backdrop desaparece.

- [ ] **Step 7: Verificar `aria-expanded`**

```
javascript_tool: document.querySelector('[data-rev-expandir]').getAttribute('aria-expanded')
```

Esperado: `"false"` con la card cerrada, `"true"` tras expandirla.

- [ ] **Step 8: Commit**

```bash
git add views/revisar.html
git commit -m "a11y(revisar): expandir la card por teclado y cerrar el sheet con Escape

El disparador de expandir era un div sin tabindex ni rol, así que con
teclado no había forma de abrir la card para corregir monto o fecha. Se le
da role=button + tabindex + aria-expanded y activación con Enter/Espacio.

No se usa un <button> real porque el chip de categoría va anidado dentro y
el HTML no permite botón dentro de botón.

El bottom-sheet solo cerraba tocando el backdrop; ahora también con Escape.

No hacen falta estilos de foco: components.css:162 ya cubre [tabindex] con
:focus-visible.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Bump de SHELL_VERSION y verificación integral

**Files:**
- Modify: `sw.js:15`

- [ ] **Step 1: Bump**

En `sw.js` línea 15, cambia:

```js
const SHELL_VERSION = 'v34';
```

por:

```js
const SHELL_VERSION = 'v35';
```

Verifica antes que siga en `v34`; si otro trabajo ya lo subió, usa el siguiente número respecto al valor real, no respecto a este documento.

- [ ] **Step 2: Repaso funcional completo**

Con el stub de cards, recorre el flujo entero y confirma que nada de las tareas 1-6 lo rompió:

- Expandir y colapsar una card.
- Abrir el sheet, elegir categoría, ver el chip actualizado y sin borde punteado.
- Cambiar Tipo a `Ingreso` y confirmar que las categorías del select se recargan.
- Cambiar Tipo a `Ahorro` y confirmar que el campo Categoría se oculta.
- Swipe a la izquierda sobre una card → se descarta y sale el toast de deshacer.
- Pulsar "Deshacer" antes de los 7s → la card vuelve.
- Swipe a la derecha sobre una card incompleta → se expande y enfoca el campo que falta, **no** confirma.

Los tres últimos tocan lógica que este trabajo no modificó; se verifican igual porque el marcado sí cambió.

- [ ] **Step 3: Verificar el ámbito hogar**

Solo si tienes sesión con la **cuenta de prueba** (nunca el hogar real). Expande una card, pon Ámbito = Hogar. Esperado: aparece el bloque "¿Quién puso cuánto?" y la opción `Ingreso` del select de Tipo se deshabilita.

- [ ] **Step 4: Verificar el toast por encima de la nav**

Descarta una card y, con el toast visible, comprueba que el botón "Deshacer" recibe el click de verdad y no un nav-link de debajo:

```
javascript_tool: (() => { const b = document.getElementById('revUndoBtn'); const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2); return el === b || b.contains(el); })()
```

Esperado: `true`. Este chequeo existe porque el bug que motivó el `z-index: 110` no se veía por clases CSS — solo con `elementFromPoint` (ver el comentario en `views/revisar.html:41-45`).

- [ ] **Step 5: Verificar en ambos temas y anchos**

Recorre las cuatro combinaciones: {mobile, desktop} × {light, dark}. Esperado: sin desbordes horizontales, sin texto ilegible, montos alineados.

- [ ] **Step 6: Screenshot para el usuario**

Toma capturas de `#revisar` en móvil, tema claro y tema oscuro, para adjuntarlas al reporte.

- [ ] **Step 7: Commit**

```bash
git add sw.js
git commit -m "chore(sw): SHELL_VERSION v35 por el pulido visual de #revisar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 8: Confirmar que el stub no se coló**

```bash
git diff origin/main -- views/revisar.html | grep -n "demo-1\|getIngestPendientes = " || echo "limpio"
```

Esperado: `limpio`. El stub de verificación vive solo en la consola del navegador; si aparece en el diff, quítalo antes de abrir el PR.

---

## Cierre

`main` está protegida: el push directo se rechaza. Abrir PR:

```bash
git push -u origin feat/revisar-pulido-visual
gh pr create --title "Pulido visual de #revisar" --body "..."
```

Tras el merge, verificar el deploy con cache-buster — la caché de borde de Pages devuelve el archivo viejo y da falsos negativos:

```bash
curl -sL "https://nestra-8rl.pages.dev/sw.js?cb=$RANDOM" | grep SHELL_VERSION
```

Esperado: `v35`.
