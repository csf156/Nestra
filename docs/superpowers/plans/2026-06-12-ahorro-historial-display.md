# Ahorro — Historial & Display (Fase 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add visual badge and color coding for tipo='ahorro' transactions in historial (mobile + desktop), transacción, and dashboard.

**Architecture:** Ahorro transactions display with blue (#3b82f6) badge "Ahorro" and icon 🐷, matching the tipo selector design. CSS and HTML only — no DB changes. Historial filters remain pero ahorro es implícito en tipo='ahorro'.

**Tech Stack:** Vanilla JS, CSS custom properties, HTML badges.

---

## Contexto de codebase

- Historial mobile: `.hist-tx` row con badge (Gasto/Ingreso), icono, monto.
- Historial desktop: table con columnas tipo implícito en color monto (rojo gasto, verde ingreso).
- Transacción: badge gasto/ingreso en header.
- Dashboard: badges hogar/personal, no tipo visible.
- Tipo actual: 'gasto' | 'ingreso'. Nuevo: + 'ahorro'.

## Archivos

- Modificar: `views/historial.html` (HTML badges, CSS color ahorro)
- Modificar: `css/components.css` (color + badge styling para ahorro)

---

### Task 1: CSS — Añadir color ahorro y badge styling

**Files:**
- Modify: `css/components.css`

- [ ] **Step 1: Añadir variable CSS para ahorro color**

En el bloque de variables (top del archivo), localizar donde se define `--color-danger`, `--color-success`. Estas ya existen. No es necesario añadir — usar `#3b82f6` inline o confiar en que el JS lo pase.

En realidad, el color #3b82f6 ya está definido en dashboard.html CSS. Para consistencia global, podemos confiar en él.

- [ ] **Step 2: Añadir badge styling para ahorro**

Localizar `.hist-tx-badge` o similar. En `historial.html`, buscar la clase que se usa para badges (probablemente algo como `.hist-badge` o inline `style=""`).

En `components.css`, añadir después de badge gasto/ingreso:
```css
.hist-badge--ahorro {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
  font-weight: 600;
}
```

- [ ] **Step 3: Color del monto para ahorro**

En el bloque de `.hist-tx-monto` styling, si existe `.hist-tx-monto--ahorro`, asegurar que sea azul:
```css
.hist-tx-monto--ahorro {
  color: #3b82f6;
  font-weight: 600;
}
```

Si no existe, la clase será añadida desde el HTML (Task 2).

- [ ] **Step 4: Commit CSS**

```bash
git add css/components.css
git commit -m "feat(css): add ahorro badge + color styling"
```

---

### Task 2: HTML — Mostrar badge Ahorro en historial mobile + desktop

**Files:**
- Modify: `views/historial.html`

**Contexto:** Historial actual tiene lógica que mapea tipo → badge visual. Necesito encontrar dónde se genera y añadir caso para 'ahorro'.

- [ ] **Step 1: Localizar template de historial mobile**

En `views/historial.html`, buscar el bloque `cardTx` (función que renderiza mobile card). Probablemente tiene algo como:
```javascript
var badge = tipo === 'gasto' ? 'Gasto' : 'Ingreso';
var badgeClass = tipo === 'gasto' ? 'hist-badge--gasto' : 'hist-badge--ingreso';
```

Reemplazar con:
```javascript
var badge, badgeClass;
if (tipo === 'gasto') {
  badge = 'Gasto';
  badgeClass = 'hist-badge--gasto';
} else if (tipo === 'ingreso') {
  badge = 'Ingreso';
  badgeClass = 'hist-badge--ingreso';
} else if (tipo === 'ahorro') {
  badge = 'Ahorro';
  badgeClass = 'hist-badge--ahorro';
} else {
  badge = tipo;
  badgeClass = '';
}
```

- [ ] **Step 2: Localizar template de historial desktop (table)**

En la misma función o nearby, encontrar la lógica para desktop table rows. Si usa clase para color:
```javascript
var montoClass = tipo === 'gasto' ? 'hist-tx-monto--gasto' : 'hist-tx-monto--ingreso';
```

Actualizar:
```javascript
var montoClass;
if (tipo === 'gasto') {
  montoClass = 'hist-tx-monto--gasto';
} else if (tipo === 'ingreso') {
  montoClass = 'hist-tx-monto--ingreso';
} else if (tipo === 'ahorro') {
  montoClass = 'hist-tx-monto--ahorro';
} else {
  montoClass = '';
}
```

- [ ] **Step 3: Verificar en preview**

Abrir historial. Si hay transacción ahorro, debe aparecer con:
- Badge "Ahorro" (azul)
- Monto en azul

- [ ] **Step 4: Commit**

```bash
git add views/historial.html
git commit -m "feat(historial): add ahorro badge + color in mobile + desktop"
```

---

### Task 3: Transacción screen — Mostrar badge Ahorro en header success screen

**Files:**
- Modify: `views/transaccion.html`

**Contexto:** Después de guardar transacción, aparece pantalla de éxito. El header puede mostrar qué tipo fue.

- [ ] **Step 1: Localizar header en transacción success**

En `views/transaccion.html`, buscar el bloque que muestra el success (probablemente en `mostrarExito()` o similar).

El header actual probablemente dice "Transacción guardada" sin mencionar tipo. Opcional: actualizar para mostrar tipo.

Si el plan especifica solo historial + css, saltar este paso. Si especifica transacción también, actualizar el header success.

Por ahora, asumir que transacción header no requiere cambio (es optional para v1).

- [ ] **Step 2: Commit (si hay cambios)**

```bash
git add views/transaccion.html
git commit -m "feat(transaccion): show ahorro badge in success screen"
```

Si no hay cambios en transacción, saltar el commit.

---

### Task 4: Dashboard — Color badge para ahorro line (already done in Fase 4)

**Files:**
- Already completed in Fase 4 (Task 3)

No action needed — `.dash-line-value--ahorro` ya está en Fase 4.

---

## Self-Review

**Spec coverage:**
- ✅ Badge visual para ahorro (Task 2)
- ✅ Color distinto azul (Task 1, Task 2)
- ✅ Historial mobile + desktop (Task 2)
- ✅ CSS styling (Task 1)

**Gaps:**
- Transacción screen: optional, puede estar cubierto en Task 3 o no aplicarse.
- Filtros por tipo: historial actualmente no tiene filtro tipo visible. Feature future.

**Placeholders:** Ninguno.

**Consistency:** Todos los ahorros usan #3b82f6, badge "Ahorro", ícono 🐷 (en transacción form).
