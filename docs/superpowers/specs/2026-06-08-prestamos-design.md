# Design: Vista de Préstamos (`views/prestamos.html`)

**Date:** 2026-06-08
**Status:** Draft (pending user review)
**Scope:** Nuevo `views/prestamos.html`. Posible mini-migración SQL (`fecha_devolucion`). Ajuste menor en `js/db.js` (`marcarDevuelto`, `getPrestamos`). La ruta `#prestamos` ya existe en `ROUTES` (router.js) y el ítem NO está en el sidebar (decisión aparte).

---

## Context

Esquema y capa de datos ya soportan préstamos (Sesión previa):

- Tabla `prestamos`: `{ id, transaccion_id NOT NULL (cascade), deudor text, estado ('pendiente'|'devuelto') }`. **No tiene** monto, fecha, ámbito ni nota propios — todo vive en la transacción vinculada (gasto, categoría "Dinero que prestamos").
- `getPrestamos(estado?)` → `prestamos` con `transacciones(fecha, monto, ambito, nota, user_id)` embebido. Filtra por estado opcional.
- `marcarDevuelto(prestamo_id, transaccion_id)` → marca `estado='devuelto'` PRIMERO, luego registra (best-effort) un **ingreso** en categoría `Devolución de préstamo` con el mismo `monto`/`ambito` de la transacción original y `fecha = hoy`. Devuelve `{ prestamo, ingreso }`.
- `getProfiles()` → ambos perfiles `{ user_id, nombre, ... }` (RLS deja leer los dos). Sirve para resolver "quién prestó" desde `transaccion.user_id`.
- Categoría `Devolución de préstamo` (ingreso) existe en el seed.
- RLS `prestamos`: hereda acceso de la transacción (hogar la ven ambos; personal solo el dueño).

**Gap detectado:** la tabla `prestamos` **no almacena la fecha de devolución**, que la Sección 3 necesita mostrar. El ingreso de devolución tiene `fecha = hoy` pero no está enlazado al préstamo. → Ver "Decisión clave" abajo.

---

## Goal

Vista `prestamos.html`, mobile-first, en español, con tres secciones:

1. **Préstamos pendientes** — lista con deudor, monto (S/), fecha, quién prestó, ámbito, nota, días transcurridos; resalte ⚠️ si >30 días; botón "Marcar como devuelto".
2. **Total pendiente** — suma desglosada hogar / personal.
3. **Historial de devueltos** — colapsado por defecto; deudor, monto, fecha del préstamo, fecha de devolución.

---

## Decisión clave: fecha de devolución

La Sección 3 pide "fecha de devolución". Hoy no se guarda. Dos opciones:

**Opción A (recomendada) — añadir columna `fecha_devolucion date` a `prestamos`.**
- Mini-migración: `alter table public.prestamos add column fecha_devolucion date;`
- `marcarDevuelto` setea `fecha_devolucion = current_date` (o la fecha del ingreso) en el mismo `update`.
- `getPrestamos` ya hace `select('*')` → la trae sin cambios.
- Préstamos devueltos **antes** de la migración tendrán `fecha_devolucion = NULL` → la UI muestra "—".

**Opción B — no tocar el esquema; mostrar "—" en fecha de devolución.**
- Cero migración, pero la Sección 3 queda incompleta respecto al pedido.

→ Spec asume **Opción A**. Si prefieres B, la Sección 3 se simplifica a mostrar "—".

---

## Componentes

### Estructura (markup)

Contenedor raíz `.prest` (CSS scopeado con ese prefijo, patrón de `.hist`/`.metas`).

```
.prest
├── header .prest-header        (h1 "Préstamos" + subtítulo)
├── section .prest-pendientes   (Sección 1)
│   ├── h2 "Pendientes"
│   ├── #prestLista              (tarjetas, una por préstamo)
│   └── #prestVacio              (estado vacío: "No tienes préstamos pendientes")
├── section .prest-total        (Sección 2)
│   ├── total general
│   └── desglose: Hogar  S/ x  ·  Personal  S/ y
└── section .prest-devueltos    (Sección 3, colapsable)
    ├── button #prestDevToggle  (aria-expanded="false")
    └── #prestDevPanel (display:none) → tabla/tarjetas de devueltos
```

### Tarjeta de préstamo pendiente

Por cada préstamo:
- **Deudor** (título).
- **Monto** formateado en soles (`formatearMoneda` de `js/format.js` → "S/ 1,234.56").
- **Fecha del préstamo** (`transaccion.fecha`, formateada legible).
- **Quién prestó** — nombre del perfil cuyo `user_id === transaccion.user_id` (desde `getProfiles()`); si no se encuentra, "—".
- **Ámbito** — badge "Personal" / "Hogar" desde `transaccion.ambito`.
- **Nota** — `transaccion.nota` (si existe).
- **Días transcurridos** — `Math.floor((hoy - fecha) / 86400000)` días. Texto "Hace N días".
- **Resalte >30 días** — si días > 30: clase `.prest-card--alerta` + ícono ⚠️ y etiqueta tipo "Vencido (N días)".
- **Botón "Marcar como devuelto"** — `data-act="devolver"`, `data-id`, `data-tx`.

### Sección 2 — Total pendiente

Calculado en cliente desde los pendientes ya cargados (no nueva consulta):
- `totalHogar = Σ monto` de pendientes con `ambito === 'hogar'`.
- `totalPersonal = Σ monto` de pendientes con `ambito === 'personal'`.
- `totalGeneral = totalHogar + totalPersonal`.
- Render: total general grande + desglose "Hogar: S/ x · Personal: S/ y".

### Sección 3 — Historial de devueltos (colapsado)

- `getPrestamos('devuelto')`.
- Colapsado por defecto: `#prestDevPanel` con `display:none`; toggle alterna `aria-expanded` + display (patrón `histAdvToggle`).
- Columnas/campos: deudor, monto (S/), fecha del préstamo, fecha de devolución (`fecha_devolucion` o "—").
- Orden: por `fecha_devolucion` desc (más reciente arriba); fallback `transaccion.fecha` desc.

---

## Lógica (script IIFE en el `.html`)

Patrón de las vistas actuales (IIFE, sin módulos, `var`, delegación de eventos).

```
(async function () {
  async function cargar() {
    const [pendientes, devueltos, perfiles] = await Promise.all([
      getPrestamos('pendiente'),
      getPrestamos('devuelto'),
      getProfiles(),
    ]);
    renderPendientes(pendientes, perfiles);
    renderTotal(pendientes);
    renderDevueltos(devueltos);
  }

  function nombrePor(userId, perfiles) { ... }      // user_id → nombre
  function diasDesde(fechaIso) { ... }              // entero de días
  function renderPendientes(lista, perfiles) { ... }
  function renderTotal(lista) { ... }               // desglose hogar/personal
  function renderDevueltos(lista) { ... }

  // Delegación: botón "Marcar como devuelto"
  document.getElementById('prestLista').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act="devolver"]');
    if (!btn) return;
    btn.disabled = true;
    try {
      await marcarDevuelto(btn.dataset.id, btn.dataset.tx);
      mostrarToast('Préstamo marcado como devuelto');   // helper de alerts.js
      await cargar();                                   // refresca las 3 secciones
    } catch (err) {
      btn.disabled = false;
      mostrarToast('No se pudo marcar como devuelto. Reintenta.', 'error');
    }
  });

  // Toggle Sección 3
  ...

  cargar();
})();
```

Escapar el HTML de `deudor` y `nota` (texto de usuario) antes de inyectar (patrón existente — usar el helper de escape de las otras vistas o `textContent`).

---

## Estilos

- CSS scopeado bajo `.prest`, mobile-first, usando tokens (`--space-*`, `--radius-*`, `--color-primary`, `--bg-light-secondary`, `--border-light`, `--text-secondary`).
- Tarjetas apiladas en una columna en móvil; el desglose total y el historial usan el mismo lenguaje visual que `metas.html` / `historial.html`.
- `.prest-card--alerta`: borde/acento de advertencia (reusar color de alerta existente; el ⚠️ es emoji por ahora — el barrido de emojis es tarea aparte, consistente con el resto de la app).
- Badge de ámbito: estilo chip pequeño.

---

## Manejo de errores

| Escenario | Comportamiento |
|---|---|
| `getPrestamos` falla | secciones muestran estado vacío + toast "No se pudieron cargar los préstamos" |
| `marcarDevuelto` lanza | botón se re-habilita; toast de error; nada cambia |
| Categoría "Devolución de préstamo" ausente | `marcarDevuelto` cierra el préstamo igual y omite el ingreso (ya implementado); el préstamo pasa a devueltos |
| `user_id` sin perfil | "quién prestó" muestra "—" |
| Sin pendientes | `#prestVacio` visible; total en S/ 0.00 |
| `fecha_devolucion` NULL (datos previos) | Sección 3 muestra "—" |

---

## Out of Scope

- Crear préstamos nuevos (se hace desde la vista de transacción con la categoría "Dinero que prestamos").
- Editar deudor o monto de un préstamo existente.
- Devoluciones parciales (el modelo es devuelto/pendiente binario).
- Añadir el ítem "Préstamos" al sidebar (decisión de navegación aparte).
- Barrido de emojis (⚠️) — tarea transversal posterior.

---

## Verificación (navegador, sin framework de tests)

- [ ] Sección 1 lista cada préstamo pendiente con deudor, monto en S/, fecha, quién prestó, ámbito, nota y "Hace N días".
- [ ] Préstamo con >30 días muestra ⚠️ y el resalte de alerta.
- [ ] "Marcar como devuelto" cierra el préstamo, registra el ingreso de devolución, y el préstamo desaparece de pendientes y aparece en devueltos tras recargar.
- [ ] Sección 2 muestra total general y desglose hogar/personal correctos (suma de los pendientes).
- [ ] Sección 3 arranca colapsada; al expandir muestra deudor, monto, fecha del préstamo y fecha de devolución.
- [ ] Estado vacío correcto cuando no hay pendientes.
- [ ] Móvil: sin overflow horizontal; tarjetas y total legibles.
- [ ] Modo claro y oscuro consistentes.
