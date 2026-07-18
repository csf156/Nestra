# Repartir gasto al editarlo a ámbito hogar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al editar una transacción sin dividir (`grupo_id` null) y marcarla ámbito=hogar + tipo=gasto, ofrecer el bloque de partes (igual que en alta) y, al guardar con 2+ pagadores, convertir la fila única en un split real (`registrar_gasto_hogar`), migrando el recibo si lo hay.

**Architecture:** Cambio contenido en un solo archivo, `views/transaccion.html`. Reusa funciones globales ya existentes en `js/db.js` (`registrarGastoHogar`, `deleteTransaccion`, `subirRecibo`, `validarPartesGastoHogar`) sin modificarlas. Sin cambios de esquema.

**Tech Stack:** JS vanilla (globals, sin build). Sin harness de tests JS.

**Testing:** Verificación en preview local (`preview_start` config `nestra`, :5050) con la cuenta throwaway + hogar de pruebas permanente (memoria `nestra-v2-test-account`). Evidencia = estado real en base + DOM tras drivear la UI, no aserciones.

---

## File Structure

- `views/transaccion.html` — **modificar únicamente**: `_mostrarPartes()` (ya no oculta en edición), submit de edición (conversión 1→N + migración de recibo), `mostrarExito()` (acepta aviso extra opcional).

No se crean archivos nuevos. No se toca `js/db.js` ni el esquema.

---

## Task 1: Mostrar partes en edición (con bloqueo por préstamo)

**Files:**
- Modify: `views/transaccion.html:919-924` (`_mostrarPartes`)

- [ ] **Step 1: Leer el estado actual de `_mostrarPartes` para confirmar contexto**

Confirmar que el bloque es exactamente:
```javascript
function _mostrarPartes() {
  if (editTx) { partesGroup.style.display = 'none'; return; }
  const esHogarGasto = ambitoEl.value === 'hogar' && tipoEl.value === 'gasto' && _miembrosHogar().length >= 2;
  partesGroup.style.display = esHogarGasto ? 'block' : 'none';
  if (esHogarGasto && !partesFilas.children.length) _renderPartesFilas();
}
```
(Si difiere, detener y reportar — no asumir.)

- [ ] **Step 2: Reemplazar por la versión que también se aplica en edición, con bloqueo por préstamo y sin reusar reparto viejo**

```javascript
function _mostrarPartes() {
  const esHogarGasto = ambitoEl.value === 'hogar' && tipoEl.value === 'gasto' &&
    _miembrosHogar().length >= 2 && !_esPrestamo();
  partesGroup.style.display = esHogarGasto ? 'block' : 'none';
  if (esHogarGasto && !partesFilas.children.length) _renderPartesFilas();
}
```
Nota: `_esPrestamo()` está definida más abajo en el archivo (línea ~932) pero es una `function` declaration — hoisted, así que es válida aquí sin reordenar nada. `_renderPartesFilas()` (línea 881-893) ya prefillea 100% al usuario actual — no hace falta tocarla; es el comportamiento correcto también en edición (no asumir reparto sobre una fila que nunca lo tuvo).

- [ ] **Step 3: Actualizar el comentario que ya no aplica**

Reemplazar el comentario de cabecera de la sección de partes (línea ~870-873):
```javascript
    // ── Partes del gasto compartido (Fase 6.3) ──────────────────
    // Visible para ambito=hogar && tipo=gasto && 2+ miembros, tanto en alta
    // como en edición de una transacción SIN dividir (grupo_id null — un
    // gasto ya dividido no se edita desde aquí, historial.html lo bloquea
    // antes de abrir el editor). Nunca se ofrece si la categoría es
    // "Dinero que prestamos" (_esPrestamo()): sin análogo en gasto
    // compartido. Prefill 100% al usuario actual siempre, también editando —
    // la fila original nunca tuvo reparto, no hay nada que precargar del otro.
```

- [ ] **Step 4: Verificar en preview**

Preview `nestra` :5050, cuenta throwaway (`nestra.pwa.test@gmail.com` / `Test!Pwa-2026-throwaway`), hogar de pruebas ya existente (2 miembros). Crear o usar una tx personal existente de gasto. Editarla, marcar ámbito=Hogar → el bloque de partes debe aparecer con 2 filas, la propia prefilleada al monto total, la del otro en 0. Cambiar a categoría "Dinero que prestamos" (si existe con ese nombre exacto) → el bloque debe desaparecer.

- [ ] **Step 5: Commit**

```bash
git add views/transaccion.html
git commit -m "feat(transaccion): muestra partes de hogar también al editar"
```

---

## Task 2: Conversión 1→N al guardar con 2+ pagadores

**Files:**
- Modify: `views/transaccion.html:1231-1246` (rama `if (editTx)` del submit)

- [ ] **Step 1: Leer el bloque actual para confirmar contexto exacto**

Confirmar que es:
```javascript
        if (editTx) {
          // Edición: solo actualiza campos. No toca préstamos ni aportes
          // vinculados (esas filas no son editables desde el historial).
          await updateTransaccion(editTx.id, {
            tipo:         tipoEl.value,
            ambito:       ambitoEl.value,
            categoria_id: tipoEl.value === 'ahorro' ? null : savedCatId,
            monto,
            fecha,
            nota,
          });
          // Re-distribuir aportes a metas si la categoría es/era "Ahorro".
          // Best-effort: fallo no revierte la edición ya guardada.
          await _reDistribuirAhorro(editTx.id, tipoEl.value);
          await mostrarExito(savedCatId);
          return;
        }
```
(Si difiere de lo que dejó la Task 1 en el resto del archivo, no asumir — releer el submit completo.)

- [ ] **Step 2: Reemplazar por la versión con rama de conversión a split**

```javascript
        if (editTx) {
          const conPartesEnEdicion = partesGroup.style.display !== 'none';
          if (conPartesEnEdicion) {
            const partes = _leerPartes().filter((p) => p.monto > 0);
            const check = validarPartesGastoHogar(monto, partes);
            if (!check.ok) {
              partesError.textContent = check.error;
              partesError.style.display = 'block';
              setCargando(false);
              return;
            }
            partesError.style.display = 'none';
            if (partes.length >= 2) {
              // Conversión 1 fila → N: crear el split PRIMERO, borrar la
              // original SOLO si eso resolvió — si registrarGastoHogar lanza
              // (error real, no de red — ya distingue y encola offline), la
              // fila original queda intacta.
              const filas = await registrarGastoHogar(fecha, savedCatId, nota, partes);
              await deleteTransaccion(editTx.id);
              let avisoExtra = null;
              if (editTx.recibo_path) {
                avisoExtra = await _migrarReciboASplit(filas);
              }
              await mostrarExito(savedCatId, avisoExtra);
              return;
            }
            // partes.length === 1 (todo en la fila propia): camino simple,
            // sin crear grupo_id — cae al updateTransaccion de abajo.
          }
          // Edición sin split: solo actualiza campos. No toca préstamos ni
          // aportes vinculados (esas filas no son editables desde el historial).
          await updateTransaccion(editTx.id, {
            tipo:         tipoEl.value,
            ambito:       ambitoEl.value,
            categoria_id: tipoEl.value === 'ahorro' ? null : savedCatId,
            monto,
            fecha,
            nota,
          });
          // Re-distribuir aportes a metas si la categoría es/era "Ahorro".
          // Best-effort: fallo no revierte la edición ya guardada.
          await _reDistribuirAhorro(editTx.id, tipoEl.value);
          await mostrarExito(savedCatId);
          return;
        }
```

- [ ] **Step 3: Añadir el helper `_migrarReciboASplit`**

Añadir cerca de `_leerPartes`/`_actualizarRestante` (~línea 918, antes de la sección Préstamo):

```javascript
    // _migrarReciboASplit(filas) — best-effort: descarga el recibo de la tx
    // original y lo re-sube a la fila del usuario actual dentro del split
    // nuevo. Un fallo aquí NUNCA revierte el split ya creado (el archivo
    // original en Storage no se borra al borrar la transacción — no hay
    // pérdida irreversible, solo desvinculación). Devuelve un string de aviso
    // si no se pudo migrar, o null si migró bien.
    async function _migrarReciboASplit(filas) {
      const uid = window.currentUser && window.currentUser.id;
      const propia = (filas || []).filter(Boolean).find((f) => f.user_id === uid);
      if (!propia) return 'El recibo no se pudo trasladar (sin fila propia en el split). Adjúntalo de nuevo si quieres conservarlo.';
      if (!navigator.onLine) return 'El recibo no se pudo trasladar (sin conexión). Adjúntalo de nuevo si quieres conservarlo.';
      try {
        const { data: blob, error } = await supabase.storage.from('recibos').download(editTx.recibo_path);
        if (error || !blob) throw error || new Error('sin blob');
        await subirRecibo(propia.id, blob);
        return null;
      } catch (_) {
        return 'El recibo no se pudo trasladar. Adjúntalo de nuevo si quieres conservarlo.';
      }
    }
```

- [ ] **Step 4: Extender `mostrarExito` para aceptar un aviso extra opcional**

Leer la función actual (`views/transaccion.html:1156-1182`) antes de editar — confirmar que sigue siendo la del spec (usa `txAlertaPost`, `evaluarAlertaCategoria`, `setTimeout` de 1.8s si no hay alerta). Reemplazar la firma y el bloque de alerta:

```javascript
    async function mostrarExito(categoriaId, avisoExtra) {
      form.style.display = 'none';
      txExito.style.display = 'flex';

      // Evaluar alerta de categoría de forma no bloqueante.
      const { mes, anio } = mesActual();
      let alerta = null;
      try {
        alerta = await evaluarAlertaCategoria(categoriaId, mes, anio);
      } catch (_) {}

      const partesHtml = [];
      if (alerta) {
        partesHtml.push(`
          <div class="alert-item alert-item--${esc(alerta.nivel)}" role="status">
            <span class="alert-icon" aria-hidden="true">${esc(alerta.icono)}</span>
            <span>${esc(alerta.mensaje)}</span>
          </div>`);
      }
      if (avisoExtra) {
        partesHtml.push(`
          <div class="alert-item alert-item--suave" role="status">
            <span>${esc(avisoExtra)}</span>
          </div>`);
      }

      if (partesHtml.length) {
        txAlertaPost.innerHTML = partesHtml.join('');
        txAlertaPost.style.display = 'block';
        // Con alerta o aviso: espera que el usuario haga click.
      } else {
        // Sin nada que mostrar: navega automáticamente tras 1.8s.
        setTimeout(() => {
          if (window._modalMode) window._modalRefresh = true;
          _salir();
        }, 1800);
      }
    }
```
Nota de investigación ya hecha (no repetir): `.alert-item` NO está definida en ningún CSS global (`css/base.css`, `css/layout.css`, `css/components.css`) — solo existe localmente en `views/dashboard.html`. `views/transaccion.html` ya usa `.alert-item` (para `alerta.nivel`) sin definición propia — gap preexistente, fuera de alcance de esta tarea, no lo arregles. Los únicos modificadores válidos (los que usa `evaluarAlertaCategoria`, ver `js/alerts.js:14`) son `critica`/`suave`/`positiva`; NO existe `warning`. Por eso el bloque de arriba usa `alert-item--suave` (el semánticamente más cercano a "aviso no bloqueante", mismo que usa el sistema para `--color-warning`).

- [ ] **Step 5: Actualizar la única otra llamada a `mostrarExito`**

La rama de alta normal (`views/transaccion.html:1282`, `await mostrarExito(savedCatId);`) sigue funcionando sin cambios — `avisoExtra` es opcional (`undefined` es falsy, mismo camino que antes). No requiere edición, solo confirmar que no se rompió al leer el diff final.

- [ ] **Step 6: Verificar en preview — camino con 1 pagador (no debe crear split)**

Editar una tx personal, marcar hogar+gasto, dejar el reparto 100% propio (0 en la fila del otro), guardar. Confirmar en base: la tx sigue siendo la MISMA fila (mismo `id`), `ambito='hogar'`, `grupo_id` sigue null.

- [ ] **Step 7: Verificar en preview — camino con 2 pagadores (crea split)**

Editar una tx personal (anotar su `id` original), marcar hogar+gasto, repartir monto entre las 2 filas (ambas >0, suma = total), guardar. Confirmar en base:
- La fila original (`id` anotado) ya no existe.
- Existen 2 filas nuevas con el mismo `grupo_id`, `ambito='hogar'`, `tipo='gasto'`, montos = lo repartido.
- `mostrarExito` no auto-navega si hubo `avisoExtra` (no debería haberlo aquí, sin recibo) — verificar que si NO hay aviso ni alerta, sigue auto-navegando a los 1.8s.

- [ ] **Step 8: Verificar en preview — recibo se migra**

Editar una tx personal CON recibo adjunto (o adjuntar uno antes de guardar la primera vez), luego editarla a hogar+split con 2 pagadores. Confirmar: la fila del split que pertenece al usuario actual tiene `recibo_path` no null, apuntando a un archivo descargable (`getReciboUrl`).

- [ ] **Step 9: Verificar en preview — validación de suma no cuadra**

Editar a hogar+gasto, dejar las partes sin sumar el total (ej. total=100, partes 30+30). Guardar → debe mostrar el error de `validarPartesGastoHogar` inline, NO guardar nada (la fila original sigue intacta, sin split creado).

- [ ] **Step 10: Verificar en preview — offline**

DevTools Offline. Editar tx a hogar+gasto con 2 pagadores, guardar. Confirmar: no lanza error fatal (registrarGastoHogar y deleteTransaccion encolan), el mirror local refleja el split optimista. Reconectar, esperar sync, confirmar en base que el resultado final es igual al camino online (Step 7). El recibo (si hubiera) debe mostrar el aviso de "no se pudo trasladar (sin conexión)" en vez de intentarlo.

- [ ] **Step 11: Commit**

```bash
git add views/transaccion.html
git commit -m "feat(transaccion): convierte a split de hogar al editar con 2+ pagadores"
```

---

## Task 3: Verificación de regresión — camino ya-dividido y camino de alta

**Files:** ninguno (verificación).

- [ ] **Step 1: Confirmar que editar un gasto YA dividido sigue bloqueado**

En #historial, un gasto con `grupo_id` (crear uno vía alta con 2 pagadores si no hay ninguno de prueba) → intentar abrir su editor (tocar la fila / botón editar). Confirmar que `abrirEdicion` en `views/historial.html:1291-1297` sigue retornando temprano (`tx.grupo_id` truthy) — el modal de edición NO se abre. Sin cambios esperados aquí; es una verificación de que Task 1/2 no rompieron el gate existente (no se tocó ese archivo).

- [ ] **Step 2: Confirmar que el camino de ALTA (crear nueva tx) con partes sigue igual**

Crear una transacción nueva (no editar), marcar hogar+gasto, repartir entre 2 miembros, guardar. Debe comportarse exactamente igual que antes de este plan (usa la rama `esHogarGastoConPartes` de alta en `views/transaccion.html:1248-1264`, que Task 1/2 no tocaron). Confirmar en base que crea el split correctamente.

- [ ] **Step 3: Limpiar filas de prueba**

Borrar cualquier tx/split de prueba creado durante la verificación (por SQL en la cuenta throwaway, o desde #historial). No dejar residuos en el hogar de pruebas permanente más allá de los datos fixture documentados en memoria.

- [ ] **Step 4: Correr `verification-before-completion`**

Antes de declarar listo, adjuntar evidencia real (consultas de base + estado del DOM) de cada verificación de Tasks 1-3, no aserciones.

- [ ] **Step 5: Abrir PR a `main`**

`main` está protegida (push directo rechazado). `gh pr create` desde `feat/editar-tx-hogar-split`. Este cambio NO toca `sw.js` — no requiere bump de `SHELL_VERSION` (no cambia ningún asset cacheado por revisión más allá del propio `views/transaccion.html`, que ya usa NetworkFirst como todas las vistas). Verificar tras merge con cache-buster igual que en el PR anterior:
```bash
curl -sL "https://nestra-8rl.pages.dev/views/transaccion.html?cb=$RANDOM" | grep -c "_migrarReciboASplit"
```
Esperado: `1` (la función nueva presente en el HTML servido).

---

## Self-Review (contra el spec)

- **Mostrar partes en edición, bloqueo por préstamo, prefill 100% propio** → Task 1. ✓
- **Conversión 1→N, orden crear-antes-de-borrar** → Task 2 Step 2. ✓
- **Camino 1 pagador = updateTransaccion simple, sin grupo_id** → Task 2 Step 2 (rama `partes.length === 1` cae al bloque de abajo) + verificado en Step 6. ✓
- **Migración de recibo best-effort, sin revertir split, aviso al usuario** → Task 2 Step 3-4, verificado Step 8. ✓
- **Offline: reusa registrarGastoHogar/deleteTransaccion offline-first; recibo se salta si !onLine** → Task 2 Step 3 (`if (!navigator.onLine)`) + verificado Step 10. ✓
- **No tocar gasto ya dividido / alta / ingreso-ahorro** → Task 3 Steps 1-2 (regresión), sin cambios de código en esos caminos. ✓
- **Validación de suma no cuadra** → reusa `validarPartesGastoHogar` existente, verificado Step 9. ✓

Consistencia de nombres: `_mostrarPartes`, `_esPrestamo`, `_leerPartes`, `_migrarReciboASplit`, `mostrarExito(categoriaId, avisoExtra)` — usados igual en todas las tareas donde aparecen. `partes`, `filas`, `avisoExtra` como variables locales del submit, sin colisión con nombres existentes del archivo (verificado por grep antes de escribir cada bloque).
