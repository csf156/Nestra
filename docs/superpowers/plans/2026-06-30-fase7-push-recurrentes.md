# Fase 7 — Disparador push de gasto recurrente próximo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir el cuarto disparador de notificaciones push (Fase 7 del roadmap, ejecutado dentro de la infra de Fase 6 ya en producción): avisar cuando un gasto/ingreso recurrente (tabla `recurrentes`, Fase 4) tiene `proximo_cargo` dentro de los próximos 3 días.

**Architecture:** La infra de push (tablas `push_subscriptions`/`notificaciones_log`, SW, Edge Function `enviar-notificaciones`, cron diario, VAPID) ya está deployada (ver memoria `nestra-v2-fase6-push`). Solo falta: (1) un detector puro nuevo en `detectors.ts` siguiendo el patrón de `detectarPresupuestos`/`detectarMetas`/`detectarPrestamos`, (2) su wiring en `index.ts` (query a `recurrentes` + llamada al detector), (3) un prompt contextual `pushOfrecerContextual('recurrente', …)` en el form de alta de recurrentes en `configuracion.html`, igual que ya existe para presupuesto/meta/préstamo. No se toca SW, cron, ni tablas — cero duplicación de la infra existente.

**Tech Stack:** Deno Edge Function (TypeScript), tests con `node --experimental-strip-types --test`, JS vanilla en `configuracion.html`.

---

### Task 1: Detector puro `detectarRecurrentesProximos`

**Files:**
- Modify: `supabase/functions/enviar-notificaciones/detectors.ts`
- Test: `supabase/functions/enviar-notificaciones/detectors.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `detectors.test.ts` (junto al import existente, agregar `detectarRecurrentesProximos`):

```typescript
import {
  detectarPresupuestos, detectarMetas, detectarPrestamos, detectarRecurrentesProximos,
} from './detectors.ts';
```

(reemplaza la línea de import existente en la cabecera del archivo, que hoy solo trae los tres primeros detectores)

```typescript
test('recurrente: proximo_cargo dentro de 3 días produce aviso', () => {
  const recs = [{ id: 'r1', descripcion: 'Netflix', monto: 15, tipo: 'gasto', activo: true, proximo_cargo: '2026-06-25' }];
  const r = detectarRecurrentesProximos(recs, HOY);
  assert.equal(r.length, 1);
  assert.equal(r[0].clave_dedupe, 'recurrente:r1:2026-06');
  assert.equal(r[0].tipo, 'recurrente');
  assert.equal(r[0].title, 'Cargo recurrente próximo');
  assert.equal(r[0].body, 'Netflix ($15) se cobra el 2026-06-25.');
});

test('recurrente: proximo_cargo hoy produce aviso', () => {
  const recs = [{ id: 'r1', descripcion: 'Renta', monto: 500, tipo: 'gasto', activo: true, proximo_cargo: '2026-06-23' }];
  const r = detectarRecurrentesProximos(recs, HOY);
  assert.equal(r.length, 1);
});

test('recurrente: proximo_cargo lejano (>3 días) NO produce aviso', () => {
  const recs = [{ id: 'r1', descripcion: 'Netflix', monto: 15, tipo: 'gasto', activo: true, proximo_cargo: '2026-06-30' }];
  const r = detectarRecurrentesProximos(recs, HOY);
  assert.equal(r.length, 0);
});

test('recurrente: proximo_cargo ya pasado NO produce aviso', () => {
  const recs = [{ id: 'r1', descripcion: 'Netflix', monto: 15, tipo: 'gasto', activo: true, proximo_cargo: '2026-06-20' }];
  const r = detectarRecurrentesProximos(recs, HOY);
  assert.equal(r.length, 0);
});

test('recurrente: inactivo (activo=false) NO produce aviso', () => {
  const recs = [{ id: 'r1', descripcion: 'Netflix', monto: 15, tipo: 'gasto', activo: false, proximo_cargo: '2026-06-25' }];
  const r = detectarRecurrentesProximos(recs, HOY);
  assert.equal(r.length, 0);
});

test('recurrente: sin proximo_cargo (null) NO produce aviso', () => {
  const recs = [{ id: 'r1', descripcion: 'Netflix', monto: 15, tipo: 'gasto', activo: true, proximo_cargo: null }];
  const r = detectarRecurrentesProximos(recs, HOY);
  assert.equal(r.length, 0);
});

test('recurrente: ingreso fijo también produce aviso', () => {
  const recs = [{ id: 'r1', descripcion: 'Sueldo', monto: 1000, tipo: 'ingreso', activo: true, proximo_cargo: '2026-06-24' }];
  const r = detectarRecurrentesProximos(recs, HOY);
  assert.equal(r.length, 1);
  assert.equal(r[0].url, '/#/configuracion');
});
```

- [ ] **Step 2: Verificar que falla**

Run: `node --experimental-strip-types --test supabase/functions/enviar-notificaciones/detectors.test.ts`
Expected: FAIL — `detectarRecurrentesProximos is not a function` (o error de import).

- [ ] **Step 3: Implementar el detector**

En `detectors.ts`, ampliar el union type `Aviso.tipo` (línea 5) de:

```typescript
  tipo: 'presupuesto' | 'meta' | 'prestamo';
```

a:

```typescript
  tipo: 'presupuesto' | 'meta' | 'prestamo' | 'recurrente';
```

Y agregar al final del archivo (después de `detectarPrestamos`):

```typescript
export interface RecurrenteRow {
  id: string; descripcion: string; monto: number; tipo: string;
  activo: boolean; proximo_cargo: string | null;
}
const DIAS_ANTICIPACION_RECURRENTE = 3;
function diasHasta(fechaISO: string, hoy: Date): number {
  const d = new Date(fechaISO + 'T00:00:00Z').getTime();
  const hoyUTC = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  return Math.floor((d - hoyUTC) / (1000 * 60 * 60 * 24));
}
export function detectarRecurrentesProximos(recurrentes: RecurrenteRow[], hoy: Date): Aviso[] {
  const mes = periodoMes(hoy);
  const out: Aviso[] = [];
  for (const r of recurrentes) {
    if (!r.activo || !r.proximo_cargo) continue;
    const dias = diasHasta(r.proximo_cargo, hoy);
    if (dias < 0 || dias > DIAS_ANTICIPACION_RECURRENTE) continue;
    out.push({
      tipo: 'recurrente', ref_id: r.id, clave_dedupe: `recurrente:${r.id}:${mes}`,
      title: 'Cargo recurrente próximo',
      body: `${r.descripcion} ($${r.monto}) se cobra el ${r.proximo_cargo}.`,
      url: '/#/configuracion',
    });
  }
  return out;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `node --experimental-strip-types --test supabase/functions/enviar-notificaciones/detectors.test.ts`
Expected: PASS — 15/15 tests (8 previos + 7 nuevos).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/enviar-notificaciones/detectors.ts supabase/functions/enviar-notificaciones/detectors.test.ts
git commit -m "feat(fase7): detector push de recurrente próximo a cobrarse"
```

---

### Task 2: Wiring en la Edge Function

**Files:**
- Modify: `supabase/functions/enviar-notificaciones/index.ts`

- [ ] **Step 1: Importar el nuevo detector**

En `index.ts` línea 6-8, cambiar:

```typescript
import {
  detectarPresupuestos, detectarMetas, detectarPrestamos, type Aviso,
} from './detectors.ts';
```

a:

```typescript
import {
  detectarPresupuestos, detectarMetas, detectarPrestamos, detectarRecurrentesProximos, type Aviso,
} from './detectors.ts';
```

- [ ] **Step 2: Query a `recurrentes` dentro de `evaluarUsuario`**

Justo antes del `return [...]` final de `evaluarUsuario` (línea 116), insertar:

```typescript
  // Recurrentes activos del usuario (Fase 4) con proximo_cargo próximo.
  const { data: recs } = await db
    .from('recurrentes')
    .select('id, descripcion, monto, tipo, activo, proximo_cargo')
    .eq('user_id', userId).eq('activo', true);
  const recurrentesRows = (recs || []).map((r) => ({
    id: r.id, descripcion: r.descripcion, monto: Number(r.monto),
    tipo: r.tipo, activo: r.activo, proximo_cargo: r.proximo_cargo,
  }));

```

Y cambiar el `return` final de:

```typescript
  return [
    ...detectarPresupuestos(categoriasPresup, gastoPorCat, hoy),
    ...detectarMetas(metasRows, conAporte, hoy),
    ...detectarPrestamos(prestamosRows, hoy),
  ];
```

a:

```typescript
  return [
    ...detectarPresupuestos(categoriasPresup, gastoPorCat, hoy),
    ...detectarMetas(metasRows, conAporte, hoy),
    ...detectarPrestamos(prestamosRows, hoy),
    ...detectarRecurrentesProximos(recurrentesRows, hoy),
  ];
```

- [ ] **Step 3: Verificar sintaxis del módulo**

Run: `node --experimental-strip-types --check supabase/functions/enviar-notificaciones/index.ts`
Expected: sin output (sintaxis válida). Nota: este comando no ejecuta el Deno runtime real (usa `jsr:`/`npm:` imports que node no resuelve) — solo valida que el TypeScript parsea. La validación funcional ocurre en Task 1 (detector) y manualmente al invocar la función deployada.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/enviar-notificaciones/index.ts
git commit -m "feat(fase7): incluir recurrentes en la evaluación diaria de avisos"
```

---

### Task 3: Prompt contextual al crear un recurrente

**Files:**
- Modify: `views/configuracion.html:1424-1436`

- [ ] **Step 1: Agregar el prompt contextual tras el alta exitosa**

En el handler `form.addEventListener('submit', ...)` del form de recurrentes (`views/configuracion.html`), el bloque actual es:

```javascript
        try {
          await upsertRecurrente({
            descripcion:  desc,
            monto:        monto,
            tipo:         $('recTipo').value,
            categoria_id: $('recCat').value || null,
            frecuencia:   $('recFrec').value,
            dia_cargo:    parseInt($('recDia').value, 10) || null,
          });
          ev.target.reset();
          // Resync searchable-select tras reset si el enhancer lo expone
          var catEl = $('recCat');
          if (catEl && typeof catEl._ssSync === 'function') catEl._ssSync();
          cargarRecurrentes();
        } catch (err) {
          console.error('recForm submit:', err);
        } finally {
```

Reemplazar por (agrega el prompt justo después de `cargarRecurrentes();`):

```javascript
        try {
          await upsertRecurrente({
            descripcion:  desc,
            monto:        monto,
            tipo:         $('recTipo').value,
            categoria_id: $('recCat').value || null,
            frecuencia:   $('recFrec').value,
            dia_cargo:    parseInt($('recDia').value, 10) || null,
          });
          ev.target.reset();
          // Resync searchable-select tras reset si el enhancer lo expone
          var catEl = $('recCat');
          if (catEl && typeof catEl._ssSync === 'function') catEl._ssSync();
          cargarRecurrentes();
          // Al crear un recurrente, ofrecer push de aviso de cargo próximo (una vez por clave).
          if (typeof pushOfrecerContextual === 'function') {
            pushOfrecerContextual('recurrente',
              '¿Quieres que te avise unos días antes de cada cargo recurrente?');
          }
        } catch (err) {
          console.error('recForm submit:', err);
        } finally {
```

- [ ] **Step 2: Verificar manualmente en preview**

Levantar el server local (`npx serve -l 5050 .` o el config `nestra` de `.claude/launch.json`), entrar a Configuración → Gastos recurrentes, dar de alta uno con permiso de notificación en estado `default`. Confirmar que aparece el `confirm()` nativo y que `console` no muestra errores (`pushOfrecerContextual` ya está cargada por `push.js`, precacheado en el SW).

- [ ] **Step 3: Commit**

```bash
git add views/configuracion.html
git commit -m "feat(fase7): prompt contextual push al crear gasto recurrente"
```

---

### Task 4: Push + verificar deploy en el teléfono

**Files:** ninguno (solo deploy)

- [ ] **Step 1: Push a v2**

```bash
git push origin v2
```

- [ ] **Step 2: Esperar build de Cloudflare Pages (~1-2 min) y verificar**

Run: `curl -sL https://nestra-8rl.pages.dev/sw.js | grep SHELL_VERSION`
Expected: el SHELL_VERSION vigente (no se bumpeó en este plan porque no se tocó el SW ni assets precacheados nuevos — `push.js` y `configuracion.html` ya estaban en la lista de precache de Fase 6).

- [ ] **Step 3: Deploy de la Edge Function actualizada**

La Edge Function `enviar-notificaciones` vive en Supabase, no en Cloudflare Pages — el `git push` no la deploya. Ejecutar manualmente (requiere Supabase CLI autenticado, igual que el deploy original de Fase 6):

```bash
supabase functions deploy enviar-notificaciones --project-ref ombnhxueclqfeyjzhroz
```

- [ ] **Step 4: Confirmar al usuario**

Avisar que el disparador de recurrentes ya corre en el cron diario (`0 8 * * *` UTC, jobid=1, sin cambios) y que el próximo run evaluará también `recurrentes`.

---

## Self-Review

**Spec coverage:** Punto 2 del pedido del usuario lista 4 disparadores: presupuesto ✅ (ya existía), meta ✅ (ya existía), préstamo ✅ (ya existía), recurrente ✅ (Task 1-3 de este plan). Punto 1 (Web Push API + tabla `push_subscriptions`) y punto 3 (Edge Function cron) ya estaban completos en Fase 6 — no se duplican, solo se extiende `index.ts`/`detectors.ts` existentes.

**Placeholder scan:** sin TBD/TODO; todo el código de cada step está completo.

**Type consistency:** `RecurrenteRow` usa los mismos nombres de columna que la migración `20260629_recurrentes.sql` (`descripcion`, `monto`, `tipo`, `activo`, `proximo_cargo`). `Aviso.tipo` ampliado a 4 variantes coherente con `detectors.ts` existente. `clave_dedupe` sigue el patrón `tipo:ref_id:YYYY-MM` igual que los otros 3 detectores, reutilizando `periodoMes()` ya definido en el archivo.
