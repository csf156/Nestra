# Design: Categorías Favoritas (por usuario)

**Date:** 2026-06-08
**Status:** Approved (pending spec review)
**Scope:** Lógica de categorías favoritas por usuario (tabla nueva + db.js), una sección mínima en Configuración para marcarlas con estrella, y el cambio del Oráculo para mostrar las favoritas como chips en lugar de un `<select>`.

---

## Context

`categorias` es **global** (columnas: id uuid, nombre, tipo, limite_mensual, color, estado; sin `user_id`). El Oráculo (`views/decisiones.html`) hoy carga todas las categorías de gasto en un `<select>`. El usuario quiere: (a) marcar categorías favoritas con una estrella, **por usuario**; (b) que el Oráculo muestre solo las favoritas, cada una como chip con su nombre (íconos llegan en Sesión 9). `configuracion.html` existe pero no gestiona categorías.

Patrón RLS del proyecto (verificado): políticas `for all using ((select auth.uid()) = user_id) with check (...)`.

---

## Decisiones (confirmadas)

1. **Marcar favoritas:** sección mínima nueva en `configuracion.html` (lista de categorías de gasto + toggle estrella). Solo la estrella ahora; íconos/colores en Sesión 9.
2. **Oráculo sin favoritas:** no hace fallback a "todas". Muestra un mensaje + CTA "Marca tus categorías favoritas en Configuración".
3. **Alcance:** por usuario → tabla join nueva `categorias_favoritas (user_id, categoria_id)`.

---

## Esquema — migración

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

- `unique(user_id, categoria_id)` evita duplicados.
- `on delete cascade` en ambas FKs: si se borra la categoría o el usuario, se limpian sus favoritas.
- RLS: cada usuario solo ve/gestiona sus propias filas.

---

## Capa de datos — db.js

Tres funciones nuevas:

```
getCategoriasConFavorito(tipo?) → [{ ...categoria, favorita: bool }]
  Todas las categorías activas (de `tipo` si se da) + bandera `favorita` para el
  usuario activo. Para la sección de Configuración.
  Implementación: getCategorias(tipo) + SELECT categoria_id FROM categorias_favoritas
  (RLS lo acota al usuario) → marcar.

getCategoriasFavoritas(tipo?) → [categoria]
  Solo las categorías que el usuario marcó como favoritas (de `tipo` si se da).
  Para el Oráculo. = getCategoriasConFavorito(tipo).filter(c => c.favorita).

toggleFavorita(categoria_id, on) → Promise
  on=true  → INSERT { categoria_id, user_id: _requireUserId() } (idempotente por el unique).
  on=false → DELETE WHERE categoria_id = ... (RLS limita al usuario).
  Best-effort con try/catch; lanza en fallo para que la UI revierta el toggle.
```

> `getCategorias` actual no cambia (sigue devolviendo todas, global). Las dos funciones nuevas componen sobre ella.

---

## UI — Configuración (sección mínima nueva)

En `configuracion.html`, añadir una sección "Categorías favoritas":
- Título + ayuda: "Marca con ★ las categorías que consultas seguido. Aparecerán en el Oráculo."
- Lista de categorías de gasto (`getCategoriasConFavorito('gasto')`): cada fila = nombre + botón estrella (★ llena si favorita, ☆ vacía si no).
- Click en estrella → `toggleFavorita(id, !favorita)` optimista (cambia el ícono al instante); si la promesa falla, revertir + toast.
- Accesibilidad: el botón estrella es `<button aria-pressed>` con `aria-label="Marcar [nombre] como favorita"`.
- Mobile-first, tap targets ≥44px.

> Esta sección es el germen de la gestión de categorías de Sesión 9; allí se le añadirán ícono/color/límite. Ahora, solo la estrella.

---

## UI — Oráculo (reemplazo del select)

En `views/decisiones.html`, reemplazar el campo `<select id="decCat">` por un selector de chips:
- Contenedor `#decFavoritas`: un chip-botón por categoría favorita (`getCategoriasFavoritas('gasto')`), con el nombre. (Hueco para ícono en Sesión 9.)
- Seleccionar un chip lo marca activo (`aria-pressed`) y fija la categoría de la consulta (`estado.categoriaId`).
- **Sin favoritas:** en lugar de chips, mostrar mensaje + CTA: "Aún no tienes categorías favoritas. Márcalas en Configuración para consultarlas." con enlace `#configuracion`. El botón "Consultar" queda deshabilitado mientras no haya categoría seleccionable.
- El resto del flujo del Oráculo (monto, ámbito, veredicto, spinner) no cambia; solo la fuente/forma de elegir categoría.

`estado` del Oráculo gana `categoriaId` (reemplaza la lectura de `$('decCat').value`). `catsPorId` se llena desde las favoritas.

---

## Data Flow

```
Configuración:
  estrella click → toggleFavorita(id, on) (optimista) → en fallo revertir + toast

Oráculo:
  al entrar → getCategoriasFavoritas('gasto')
            → si vacío: CTA a Configuración
            → si hay: render chips; primer chip seleccionado por defecto
  Consultar → usa estado.categoriaId (del chip activo)
```

---

## Manejo de errores

| Escenario | Comportamiento |
|---|---|
| `getCategoriasFavoritas` falla | db.js devuelve [] → Oráculo muestra el CTA "marca favoritas" |
| `toggleFavorita` falla | revertir el ícono de estrella + toast "No se pudo actualizar" |
| Categoría favorita borrada en otro lado | `on delete cascade` limpia la fila; al recargar no aparece |

---

## Out of Scope

- Íconos y colores por categoría (Sesión 9).
- Gestión completa de categorías (crear/editar/archivar) en Configuración (Sesión 9).
- Favoritas para categorías de ingreso (solo gasto, que es lo que consulta el Oráculo).
- Reordenar favoritas / límite de cuántas marcar.

---

## Verificación (navegador, sin framework de tests)

- [ ] Migración aplicada: `categorias_favoritas` existe con RLS
- [ ] Configuración lista categorías de gasto con estrella; marcar/desmarcar persiste
- [ ] Oráculo muestra solo las favoritas como chips; seleccionar un chip fija la categoría
- [ ] Oráculo sin favoritas → CTA a Configuración, botón Consultar deshabilitado
- [ ] `toggleFavorita` optimista revierte en error
- [ ] Favoritas son por usuario (RLS): un usuario no ve las del otro
- [ ] Móvil: estrellas y chips con tap ≥44px, sin overflow
