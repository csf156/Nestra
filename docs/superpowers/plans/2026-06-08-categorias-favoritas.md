# Categorías Favoritas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Favoritas por usuario: tabla nueva + helpers db.js + sección estrella en Configuración + chips de favoritas en el Oráculo (sin favoritas → CTA).

**Architecture:** Tabla join `categorias_favoritas (user_id, categoria_id)` con RLS por usuario. `db.js` añade `getCategoriasConFavorito`, `getCategoriasFavoritas`, `toggleFavorita`. `configuracion.html` gana una sección con toggle de estrella. `views/decisiones.html` reemplaza el `<select>` de categoría por chips de favoritas.

**Tech Stack:** Vanilla JS, Supabase (migración vía MCP `apply_migration`), sin framework de tests — verificación en navegador con harness + verificación de esquema vía SQL.

**Reference spec:** `docs/superpowers/specs/2026-06-08-categorias-favoritas-design.md`

**Convenciones verificadas:** `categorias` global (id uuid, nombre, tipo, limite_mensual, color, estado). RLS del proyecto: `for all using ((select auth.uid()) = user_id) with check (...)`. db.js: `getCategorias(tipo?)`, `_requireUserId()`, cliente global `supabase`. Oráculo IIFE en `views/decisiones.html` usa `$('decCat').value` hoy.

---

## File Structure

| File | Change |
|---|---|
| (migración Supabase) | Crear tabla `categorias_favoritas` + RLS |
| `js/db.js` | `getCategoriasConFavorito`, `getCategoriasFavoritas`, `toggleFavorita` |
| `views/configuracion.html` | Sección "Categorías favoritas" (lista + estrella) |
| `views/decisiones.html` | Reemplazo del select por chips de favoritas + estado.categoriaId |

---

### Task 1: Migración — tabla `categorias_favoritas`

**Files:** (cambio en BD, sin archivo de repo)

- [ ] **Step 1: Aplicar la migración (MCP `apply_migration`)**

Nombre: `categorias_favoritas`. SQL:
```sql
create table public.categorias_favoritas (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  categoria_id uuid not null references public.categorias(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (user_id, categoria_id)
);

alter table public.categorias_favoritas enable row level security;

create policy categorias_favoritas_acceso on public.categorias_favoritas
  for all
  using  ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
```

- [ ] **Step 2: Verificar (MCP `execute_sql`)**

```sql
select count(*) as tabla_existe from information_schema.tables where table_name='categorias_favoritas';
select relrowsecurity from pg_class where relname='categorias_favoritas';
select polname from pg_policy where polrelid='public.categorias_favoritas'::regclass;
```
Esperado: `tabla_existe=1`, `relrowsecurity=true`, una política `categorias_favoritas_acceso`.

- [ ] **Step 3: Sin commit de repo** (cambio solo en BD). Anotar la migración en el mensaje del commit de la Task 2.

---

### Task 2: db.js — helpers de favoritas

**Files:**
- Modify: `js/db.js` (tras `getCategorias`, ~línea 370)

- [ ] **Step 1: Añadir las tres funciones tras `getCategorias`**

```js
// getCategoriasConFavorito(tipo?) — todas las categorías activas (de `tipo` si se da)
// + bandera `favorita` para el usuario activo. Para la gestión en Configuración.
// Returns: [{ ...categoria, favorita: bool }] o [].
async function getCategoriasConFavorito(tipo = null) {
  try {
    const cats = await getCategorias(tipo);
    const { data: favs, error } = await supabase
      .from('categorias_favoritas')
      .select('categoria_id'); // RLS lo acota al usuario activo
    if (error) throw error;
    const favSet = new Set((favs || []).map((f) => f.categoria_id));
    return cats.map((c) => ({ ...c, favorita: favSet.has(c.id) }));
  } catch (err) {
    console.error('Error en getCategoriasConFavorito():', err.message || err);
    return [];
  }
}

// getCategoriasFavoritas(tipo?) — solo las categorías marcadas favoritas por el
// usuario activo (de `tipo` si se da). Para el Oráculo. Returns: [categoria] o [].
async function getCategoriasFavoritas(tipo = null) {
  const cats = await getCategoriasConFavorito(tipo);
  return cats.filter((c) => c.favorita);
}

// toggleFavorita(categoria_id, on) — marca (on=true) o desmarca (on=false) una
// categoría como favorita del usuario activo. Idempotente (upsert por unique).
// Lanza Error en fallo para que la UI revierta el toggle optimista.
async function toggleFavorita(categoria_id, on) {
  try {
    if (on) {
      const userId = _requireUserId();
      const { error } = await supabase
        .from('categorias_favoritas')
        .upsert({ categoria_id: categoria_id, user_id: userId }, { onConflict: 'user_id,categoria_id' });
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('categorias_favoritas')
        .delete()
        .eq('categoria_id', categoria_id); // RLS limita al usuario activo
      if (error) throw error;
    }
  } catch (err) {
    console.error('Error en toggleFavorita():', err.message || err);
    throw err;
  }
}
```

- [ ] **Step 2: Verificar definición (navegador)**

`preview_start`, recargar. `preview_eval`:
```js
({ a: typeof getCategoriasConFavorito, b: typeof getCategoriasFavoritas, c: typeof toggleFavorita })
```
Esperado: los tres `"function"`. (La ejecución real contra Supabase requiere sesión; se valida con el usuario.)

- [ ] **Step 3: Commit**

```bash
git add js/db.js
git commit -m "feat(favoritas): db helpers + categorias_favoritas migration

Tabla categorias_favoritas (por usuario, RLS) aplicada en Supabase.
db.js: getCategoriasConFavorito, getCategoriasFavoritas, toggleFavorita."
```

---

### Task 3: Configuración — sección de favoritas

**Files:**
- Modify: `views/configuracion.html` (markup, CSS, script)

- [ ] **Step 1: Insertar la sección entre "Preferencias" y "Cuenta"**

Localizar el cierre del card de Preferencias (`</div>` del card que contiene "Más opciones disponibles próximamente.") e insertar inmediatamente DESPUÉS:

```html
  <!-- Categorías favoritas -->
  <div class="card config-card">
    <div class="card-header">
      <h2 class="card-title">Categorías favoritas</h2>
    </div>
    <p class="text-muted config-fav-ayuda">Marca con ★ las categorías que consultas seguido. Aparecerán en el Oráculo.</p>
    <ul class="config-fav-lista" id="configFavLista"><li class="config-fav-cargando">Cargando…</li></ul>
  </div>
```

- [ ] **Step 2: Añadir CSS antes de `</style>`**

```css
  .config-fav-ayuda { font-size: var(--font-size-sm); margin: 0 0 var(--space-md); }
  .config-fav-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .config-fav-lista li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); padding: 8px 0; border-bottom: 1px solid var(--border-light); }
  .config-fav-nombre { color: var(--text-dark); font-size: var(--font-size-base); }
  .config-fav-estrella { min-width: 44px; min-height: 44px; border: none; background: transparent; font-size: 22px; line-height: 1; cursor: pointer; color: var(--color-warning); }
  .config-fav-estrella[aria-pressed="false"] { color: var(--border-light); }
  .config-fav-cargando { color: var(--text-secondary); justify-content: flex-start; }
```

- [ ] **Step 3: Añadir el script de favoritas (segundo IIFE antes de `</script>`)**

Insertar dentro del bloque `<script>`, después del IIFE existente (antes de `</script>`):

```js
  (function () {
    'use strict';
    var lista = document.getElementById('configFavLista');
    if (!lista) return;

    function fila(c) {
      var li = document.createElement('li');
      var nom = document.createElement('span');
      nom.className = 'config-fav-nombre'; nom.textContent = c.nombre;
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'config-fav-estrella';
      btn.setAttribute('aria-pressed', c.favorita ? 'true' : 'false');
      btn.setAttribute('aria-label', (c.favorita ? 'Quitar de favoritas: ' : 'Marcar como favorita: ') + c.nombre);
      btn.textContent = c.favorita ? '★' : '☆';
      btn.addEventListener('click', function () {
        var on = btn.getAttribute('aria-pressed') !== 'true';
        // optimista
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.textContent = on ? '★' : '☆';
        toggleFavorita(c.id, on).catch(function () {
          // revertir
          btn.setAttribute('aria-pressed', on ? 'false' : 'true');
          btn.textContent = on ? '☆' : '★';
          alert('No se pudo actualizar la favorita. Reintenta.');
        });
      });
      li.appendChild(nom); li.appendChild(btn);
      return li;
    }

    (async function () {
      var cats = await getCategoriasConFavorito('gasto');
      lista.innerHTML = '';
      if (!cats.length) { lista.innerHTML = '<li class="config-fav-cargando">No hay categorías de gasto.</li>'; return; }
      cats.forEach(function (c) { lista.appendChild(fila(c)); });
    })();
  })();
```

- [ ] **Step 4: Verificar (harness)**

`preview_eval` que inyecta `configuracion.html`, stubea `getCategoriasConFavorito` (devuelve 2 categorías, una favorita) y `toggleFavorita`, ejecuta el segundo IIFE y comprueba: 2 filas, una estrella `aria-pressed="true"`, click alterna el estado. (Harness completo en Task 5.)

- [ ] **Step 5: Commit**

```bash
git add views/configuracion.html
git commit -m "feat(favoritas): star toggle section in Configuración"
```

---

### Task 4: Oráculo — chips de favoritas en vez de select

**Files:**
- Modify: `views/decisiones.html` (markup del campo categoría, CSS, script)

- [ ] **Step 1: Reemplazar el campo de categoría en el markup**

Localizar:
```html
    <div class="dec-field">
      <label class="dec-label" for="decCat">¿En qué categoría?</label>
      <select class="dec-select" id="decCat"></select>
    </div>
```
Reemplazar por:
```html
    <div class="dec-field">
      <span class="dec-label">¿En qué categoría?</span>
      <div class="dec-chips" id="decFavoritas" role="group" aria-label="Categorías favoritas"></div>
    </div>
```

- [ ] **Step 2: Añadir CSS antes de `</style>`**

```css
  .dec-chips { display: flex; flex-wrap: wrap; gap: var(--space-sm); }
  .dec-chip { min-height: 44px; padding: 0 var(--space-md); border: 1px solid var(--border-light); border-radius: 999px; background: var(--bg-light); color: var(--text-dark); font-size: var(--font-size-sm); cursor: pointer; }
  .dec-chip[aria-pressed="true"] { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
  .dec-chips-vacio { font-size: var(--font-size-sm); color: var(--text-secondary); }
  .dec-chips-vacio a { color: var(--color-primary); }
```

- [ ] **Step 3: Cambiar el script — cargar favoritas como chips, estado.categoriaId**

3a. En el estado, añadir `categoriaId`:
```js
    var estado = { ambito: 'hogar' };
```
→
```js
    var estado = { ambito: 'hogar', categoriaId: null };
```

3b. Reemplazar la función `cargarCategorias` por una que pinta chips de favoritas:
```js
    async function cargarCategorias() {
      var cats = await getCategoriasFavoritas('gasto');
      catsPorId = {};
      var cont = $('decFavoritas');
      cont.innerHTML = '';
      if (!cats.length) {
        cont.innerHTML = '<p class="dec-chips-vacio">Aún no tienes categorías favoritas. <a href="#configuracion">Márcalas en Configuración</a> para consultarlas.</p>';
        $('decSubmit').disabled = true;
        return;
      }
      $('decSubmit').disabled = false;
      cats.forEach(function (c, i) {
        catsPorId[c.id] = c;
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'dec-chip'; b.textContent = c.nombre;
        b.setAttribute('data-id', c.id);
        b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
        if (i === 0) estado.categoriaId = c.id;
        b.addEventListener('click', function () {
          estado.categoriaId = c.id;
          Array.prototype.forEach.call(cont.querySelectorAll('.dec-chip'), function (x) {
            x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
          });
        });
        cont.appendChild(b);
      });
    }
```

3c. En el handler de submit, cambiar la lectura de la categoría de:
```js
      var cat = catsPorId[$('decCat').value];
```
a:
```js
      var cat = catsPorId[estado.categoriaId];
```

- [ ] **Step 4: Verificar (harness)**

`preview_eval` que inyecta `decisiones.html`, stubea `getCategoriasFavoritas` (2 favoritas) y el resto, comprueba: 2 chips, el primero `aria-pressed="true"`, click en el segundo cambia la selección; con `getCategoriasFavoritas` → [] aparece el CTA y `#decSubmit` queda deshabilitado. (Harness en Task 5.)

- [ ] **Step 5: Commit**

```bash
git add views/decisiones.html
git commit -m "feat(favoritas): oracle uses favorite-category chips instead of select"
```

---

### Task 5: Verificación integral + móvil

**Files:**
- Verify only

- [ ] **Step 1: Esquema (MCP execute_sql)** — repetir la verificación de la Task 1 Step 2.

- [ ] **Step 2: Harness Configuración**

`preview_eval`:
```js
(async function(){
  var html=await (await fetch('views/configuracion.html')).text();
  var styleM=html.match(/<style>([\s\S]*?)<\/style>/), scripts=html.match(/<script>([\s\S]*?)<\/script>/g);
  var markup=html.replace(/<style>[\s\S]*?<\/style>/,'').replace(/<script>[\s\S]*?<\/script>/g,'');
  var host=document.getElementById('ch'); if(host) host.remove();
  host=document.createElement('div'); host.id='ch';
  var st=document.createElement('style'); st.textContent=styleM[1]; host.appendChild(st);
  var w=document.createElement('div'); w.innerHTML=markup; host.appendChild(w); document.body.appendChild(host);
  window.currentProfile={nombre:'Test'}; window.currentUser={email:'t@t.com'};
  var P=function(v){return Promise.resolve(v);};
  window.getCategoriasConFavorito=function(){ return P([{id:'1',nombre:'Comida',favorita:true},{id:'2',nombre:'Ocio',favorita:false}]); };
  window.toggleFavorita=function(){ return P(); };
  // ejecutar solo el segundo IIFE (favoritas)
  var favScript=scripts[scripts.length-1].replace(/<\/?script>/g,'');
  // re-apuntar getElementById al contenedor del harness
  var _gid=document.getElementById.bind(document);
  document.getElementById=function(id){ return host.querySelector('#'+id) || _gid(id); };
  try { (0,eval)(favScript); } catch(e){ document.getElementById=_gid; return {err:String(e)}; }
  await new Promise(function(r){ setTimeout(r,300); });
  var filas=host.querySelectorAll('#configFavLista li').length;
  var estrella=host.querySelector('#configFavLista .config-fav-estrella');
  var antes=estrella.getAttribute('aria-pressed');
  estrella.click(); await new Promise(function(r){ setTimeout(r,100); });
  var despues=estrella.getAttribute('aria-pressed');
  document.getElementById=_gid;
  var h=document.getElementById('ch'); if(h) h.remove();
  return { filas:filas, toggleCambia: antes!==despues };
})()
```
Esperado: `filas:2`, `toggleCambia:true`.

- [ ] **Step 3: Harness Oráculo (chips + vacío)**

`preview_eval` inyectando `decisiones.html` con `getCategoriasFavoritas` → 2 favoritas: confirmar 2 `.dec-chip`, primero `aria-pressed="true"`, `#decSubmit` habilitado. Repetir con `getCategoriasFavoritas` → []: confirmar `.dec-chips-vacio` presente y `#decSubmit.disabled === true`. `preview_console_logs` (error) = cero.

- [ ] **Step 4: Móvil**

`preview_resize` mobile. Confirmar estrellas y chips ≥44px, sin overflow (`scrollWidth <= clientWidth`). `preview_screenshot`.

- [ ] **Step 5: Commit final (si hubo ajustes)**

```bash
git add -A
git commit -m "fix(favoritas): adjustments after full verification"
```

---

## Self-Review

**Spec coverage:**
- Tabla `categorias_favoritas` por usuario + RLS → Task 1 ✅
- db.js `getCategoriasConFavorito` / `getCategoriasFavoritas` / `toggleFavorita` → Task 2 ✅
- Configuración: lista + estrella optimista con revertir → Task 3 ✅
- Oráculo: chips de favoritas, primer chip por defecto → Task 4 ✅
- Sin favoritas → CTA a Configuración + Consultar deshabilitado → Task 4 Step 3b ✅
- Por usuario (RLS) → Task 1 política ✅
- Mobile-first tap ≥44px → Task 3/4 CSS ✅

**Placeholder scan:** sin TBD/TODO; el "Cargando…" inicial se reemplaza al cargar.

**Type consistency:** `getCategoriasConFavorito` devuelve `{...categoria, favorita}` consumido por Configuración (Task 3) y por `getCategoriasFavoritas` (Task 2). `toggleFavorita(id, on)` firma idéntica en db.js y llamadas. `estado.categoriaId` (Task 4) reemplaza `$('decCat').value` de forma consistente en `cargarCategorias` y el submit. `catsPorId` se llena en ambas vistas con la misma forma.

**Riesgos anotados:**
- La verificación real de RLS por-usuario requiere dos sesiones distintas (no reproducible con harness/stub ni con MCP admin que omite RLS) → marcar para prueba del usuario.
- `upsert` con `onConflict:'user_id,categoria_id'` depende del índice unique de la migración (Task 1).
- Líneas absolutas pueden variar; localizar por identificador.
