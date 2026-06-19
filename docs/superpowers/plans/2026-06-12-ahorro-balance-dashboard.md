# Ahorro — Balance & Dashboard (Fase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Excluir ahorro (tipo='ahorro') del balance neto. Mostrar línea "Ahorros" separada en dashboard cards. Balance neto = ingresos − (gastos − ahorros).

**Architecture:** Balance neto = ingresos − gastos (excluyendo ahorros). Dashboard cards mostrarán: Ingresos | Gastos | Ahorros | Balance neto. Dos archivos: `js/db.js` (nueva función `getAhorros*` + actualizar balance) y `views/dashboard.html` (render actualizado).

**Tech Stack:** Vanilla JS, Supabase queries, SQL WHERE tipo!='ahorro'.

---

## Contexto de codebase

- `getBalanceHogar(mes, anio)` actual: suma ingresos y gastos (ignora tipo), retorna `{ ingresos, gastos, balance }`.
- `getBalancePersonal(mes, anio)` actual: igual, más `aporte_realizado`.
- `getSaldoAcumulado*`: sin cambios de especificación (acumula todo).
- Dashboard renderiza con `renderHogar(b, acum)` — `b` = mes, `acum` = acumulado.
- Transacciones: `tipo = 'gasto' | 'ingreso' | 'ahorro'`.

## Cambio semántico

**Antes:** Balance = Ingresos − Gastos (incluía ahorros como gastos)
**Después:** Balance = Ingresos − Gastos + Ahorros (ahorros mostrados aparte, no reducen balance)

En la BD, las ahorros siguen siendo `tipo='ahorro'`. Pero en el cálculo del balance:
- `gastos` en el balance neto = gastos reales (excluyendo ahorros)
- `ahorros` = nueva línea separada
- `balance = ingresos - gastos` (sin restar ahorros)

## Archivos

- Modificar: `js/db.js` (actualizar `getBalance*`, añadir `getAhorros*`, actualizar `getSaldoAcumulado*`)
- Modificar: `views/dashboard.html` (actualizar `renderHogar` y `renderPersonal` para mostrar ahorros)

---

### Task 1: DB — Crear getAhorrosHogar + getAhorrosPersonal

**Files:**
- Modify: `js/db.js` (sección BALANCES, después de `getSaldoAcumuladoPersonal`)

- [ ] **Step 1: Crear getAhorrosHogar**

Inmediatamente después de `getSaldoAcumuladoPersonal`, añadir:
```javascript
// getAhorrosHogar(mes, anio) — total de ahorros (tipo='ahorro') del hogar en el mes.
// Returns: número (0 en error o sin ahorros).
async function getAhorrosHogar(mes, anio) {
  try {
    const { desde, hasta } = _rangoMes(mes, anio);
    const { data, error } = await supabase
      .from('transacciones')
      .select('monto')
      .eq('ambito', 'hogar')
      .eq('tipo', 'ahorro')
      .gte('fecha', desde)
      .lte('fecha', hasta);
    if (error) throw error;
    return (data || []).reduce((sum, t) => sum + Number(t.monto), 0);
  } catch (err) {
    console.error('Error en getAhorrosHogar():', err.message || err);
    return 0;
  }
}
```

- [ ] **Step 2: Crear getAhorrosPersonal**

Inmediatamente después de `getAhorrosHogar`, añadir:
```javascript
// getAhorrosPersonal(mes, anio) — total de ahorros (tipo='ahorro') personales del usuario en el mes.
// Returns: número (0 en error o sin ahorros).
async function getAhorrosPersonal(mes, anio) {
  try {
    const userId = _requireUserId();
    const { desde, hasta } = _rangoMes(mes, anio);
    const { data, error } = await supabase
      .from('transacciones')
      .select('monto')
      .eq('ambito', 'personal')
      .eq('user_id', userId)
      .eq('tipo', 'ahorro')
      .gte('fecha', desde)
      .lte('fecha', hasta);
    if (error) throw error;
    return (data || []).reduce((sum, t) => sum + Number(t.monto), 0);
  } catch (err) {
    console.error('Error en getAhorrosPersonal():', err.message || err);
    return 0;
  }
}
```

- [ ] **Step 3: Verificar estructura en preview**

No hay UI change aún — solo DB. Abrir DevTools console y verificar que no hay errores de syntax.

- [ ] **Step 4: Commit**

```bash
git add js/db.js
git commit -m "feat(db): add getAhorrosHogar + getAhorrosPersonal queries"
```

---

### Task 2: DB — Actualizar getBalance* para excluir ahorros del cálculo

**Files:**
- Modify: `js/db.js` (funciones `getBalanceHogar` y `getBalancePersonal`)

**Contexto:** Actuales cálculos suman todos los tipos. Necesito excluir `tipo='ahorro'` de ingresos/gastos.

- [ ] **Step 1: Actualizar getBalanceHogar**

Localizar `getBalanceHogar(mes, anio)`. En la línea que cálcula gastos, cambiar:
```javascript
// Antes:
const { data, error } = await supabase
  .from('transacciones')
  .select('tipo, monto')
  .eq('ambito', 'hogar')
  .gte('fecha', desde)
  .lte('fecha', hasta);

// Después:
const { data, error } = await supabase
  .from('transacciones')
  .select('tipo, monto')
  .eq('ambito', 'hogar')
  .neq('tipo', 'ahorro')  // AÑADIR ESTA LÍNEA
  .gte('fecha', desde)
  .lte('fecha', hasta);
```

Esto excluye ahorros de ingresos y gastos. El resto del cálculo queda igual.

- [ ] **Step 2: Actualizar getBalancePersonal**

Igual cambio. Localizar la query y añadir `.neq('tipo', 'ahorro')`:
```javascript
// Antes:
const { data, error } = await supabase
  .from('transacciones')
  .select('tipo, monto, aporte_id')
  .eq('ambito', 'personal')
  .eq('user_id', userId)
  .gte('fecha', desde)
  .lte('fecha', hasta);

// Después:
const { data, error } = await supabase
  .from('transacciones')
  .select('tipo, monto, aporte_id')
  .eq('ambito', 'personal')
  .eq('user_id', userId)
  .neq('tipo', 'ahorro')  // AÑADIR ESTA LÍNEA
  .gte('fecha', desde)
  .lte('fecha', hasta);
```

- [ ] **Step 3: Verificar en preview**

Dashboard debe seguir mostrando balance (sin cambio visual aún — ahorro aún no aparece en la línea). Verificar que el balance neto cambió (si hay ahorros, debería ser más alto).

- [ ] **Step 4: Commit**

```bash
git add js/db.js
git commit -m "feat(db): exclude ahorro (tipo='ahorro') from balance calculation"
```

---

### Task 3: Dashboard — Actualizar renderHogar + renderPersonal para mostrar ahorros

**Files:**
- Modify: `views/dashboard.html` (funciones `renderHogar` y `renderPersonal` en bloque `<script>`)

- [ ] **Step 1: Actualizar renderHogar para aceptar ahorros**

Actualizar la firma:
```javascript
// Antes:
function renderHogar(b, acum) {

// Después:
function renderHogar(b, acum, ahorros) {
```

Dentro de la función, entre la línea de Gastos y el div `.dash-neto`, añadir:
```javascript
        <div class="dash-line">
          <span class="dash-line-label">Ahorros</span>
          <span class="dash-line-value dash-line-value--ahorro">${esc(formatMonto(ahorros))}</span>
        </div>
```

El HTML completo debe ser:
```javascript
      const body = $('hogarBody');
      body.setAttribute('aria-busy', 'false');
      body.innerHTML = `
        <div class="dash-line">
          <span class="dash-line-label">Ingresos</span>
          <span class="dash-line-value dash-line-value--ingreso">${esc(formatMonto(b.ingresos))}</span>
        </div>
        <div class="dash-line">
          <span class="dash-line-label">Gastos</span>
          <span class="dash-line-value dash-line-value--gasto">${esc(formatMonto(b.gastos))}</span>
        </div>
        <div class="dash-line">
          <span class="dash-line-label">Ahorros</span>
          <span class="dash-line-value dash-line-value--ahorro">${esc(formatMonto(ahorros))}</span>
        </div>
        <div class="dash-neto">
          <div>
            <span class="dash-neto-label">Balance acumulado</span>
            <span class="dash-neto-sublabel">${deltaMesHtml(b.balance)}</span>
          </div>
          <span class="dash-neto-value ${netoClass(acum.balance)}">${esc(formatMonto(acum.balance))}</span>
        </div>`;
```

- [ ] **Step 2: Actualizar renderPersonal para aceptar ahorros**

Igual cambio. Actualizar firma y añadir línea de ahorros entre gastos y `.dash-neto`.

- [ ] **Step 3: Actualizar cargar() para pasar ahorros**

Localizar `Promise.allSettled([...])`. Añadir dos nuevas queries:
```javascript
const [hogar, personal, alertas, txs, metas, acumHogar, acumPersonal, ahorrosHogar, ahorrosPersonal] = await Promise.allSettled([
  getBalanceHogar(mes, anio),
  getBalancePersonal(mes, anio),
  evaluarAlertas(mes, anio),
  getUltimasTransacciones(5),
  getMetas(),
  getSaldoAcumuladoHogar(),
  getSaldoAcumuladoPersonal(),
  getAhorrosHogar(mes, anio),      // NEW
  getAhorrosPersonal(mes, anio),   // NEW
]);
```

Luego, antes de llamar `renderHogar` y `renderPersonal`, extraer los valores:
```javascript
const acumH = acumHogar.status === 'fulfilled' ? acumHogar.value : (hogar.status === 'fulfilled' ? hogar.value : { balance: 0 });
const acumP = acumPersonal.status === 'fulfilled' ? acumPersonal.value : (personal.status === 'fulfilled' ? personal.value : { balance: 0 });
const ahorH = ahorrosHogar.status === 'fulfilled' ? ahorrosHogar.value : 0;
const ahorP = ahorrosPersonal.status === 'fulfilled' ? ahorrosPersonal.value : 0;

if (hogar.status === 'fulfilled')    renderHogar(hogar.value, acumH, ahorH);
if (personal.status === 'fulfilled') renderPersonal(personal.value, acumP, ahorP);
```

- [ ] **Step 4: Añadir CSS para .dash-line-value--ahorro**

En el bloque `<style>`, localizar:
```css
  .dash-line-value--ingreso { color: var(--color-success); }
  .dash-line-value--gasto   { color: var(--color-danger); }
```

Añadir:
```css
  .dash-line-value--ahorro  { color: #3b82f6; }
```

(Azul, consistente con ahorro en transacción.)

- [ ] **Step 5: Verificar en preview**

Abrir dashboard. Debe mostrar:
- Ingresos (verde)
- Gastos (rojo, sin ahorros)
- Ahorros (azul, NEW)
- Balance acumulado (balance real, más alto que antes si hay ahorros)

Si tienes un ahorro registrado, verás la diferencia.

- [ ] **Step 6: Commit**

```bash
git add views/dashboard.html
git commit -m "feat(dashboard): add Ahorros line, exclude from balance neto"
```

---

### Task 4: DB — Actualizar getSaldoAcumulado* para excluir ahorros (opcional pero consistente)

**Files:**
- Modify: `js/db.js` (funciones `getSaldoAcumuladoHogar` y `getSaldoAcumuladoPersonal`)

**Nota:** Por consistencia, también deben excluir ahorros del balance acumulado. Cambio idéntico a Task 2 pero en funciones diferentes.

- [ ] **Step 1: Actualizar getSaldoAcumuladoHogar**

Localizar la función. Cambio:
```javascript
// Antes:
const { data, error } = await supabase
  .from('transacciones')
  .select('tipo, monto')
  .eq('ambito', 'hogar');

// Después:
const { data, error } = await supabase
  .from('transacciones')
  .select('tipo, monto')
  .eq('ambito', 'hogar')
  .neq('tipo', 'ahorro');
```

- [ ] **Step 2: Actualizar getSaldoAcumuladoPersonal**

Igual cambio.

- [ ] **Step 3: Verificar en preview**

Dashboard balance acumulado debe ser consistente con el mensual.

- [ ] **Step 4: Commit**

```bash
git add js/db.js
git commit -m "feat(db): exclude ahorro from accumulated balance (consistency)"
```

---

## Self-Review

**Spec coverage:**
- ✅ Ahorro excluido del balance neto (Task 2, Task 4)
- ✅ Línea "Ahorros" en dashboard (Task 3)
- ✅ Nueva query getAhorros* (Task 1)
- ✅ CSS color azul (Task 3)

**Placeholders:** Ninguno.

**Consistency:** Todos los cambios siguen el patrón existente (neq, select, reduce).
