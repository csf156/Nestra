# Nestra — Diseño del esquema de base de datos (Fase 1)

**Fecha:** 2026-06-05
**Entregable:** `supabase/schema.sql`
**Motor:** PostgreSQL vía Supabase (PostgREST + RLS)

## Objetivo

Archivo SQL ejecutable una sola vez en el SQL Editor de Supabase. Crea las
6 tablas del modelo de datos de Nestra, activa Row Level Security con las
políticas de privacidad personal/hogar, instala el trigger que genera un
perfil automáticamente al registrar un usuario, e inserta los datos semilla
(26 categorías + 2 metas del hogar).

## Decisiones tomadas en brainstorming

1. **Tabla `desafios` → se sigue la guía de arquitectura del repo**, no la
   notación abreviada del pedido inicial. Es decir: `titulo` + `descripcion`,
   `duracion_dias`, `fecha_fin` calculada (`fecha_inicio + duracion_dias`),
   y `estado` con valores `'activo' | 'completado' | 'abandonado'`. Razón:
   coincide con la vista `decisiones.html` ya planificada.
2. **CHECK constraints sí** en todas las columnas enumeradas
   (`tipo`, `ambito`, `horizonte`, `estado`). La base rechaza valores fuera
   de lista; no se delega solo al frontend.
3. **ON DELETE:** CASCADE en dependientes (borrar transacción borra su
   préstamo; borrar usuario de `auth.users` borra su perfil y transacciones),
   **RESTRICT** en `transacciones.categoria_id` (protege categorías en uso),
   **SET NULL** en `desafios.categoria_id` (es opcional).
4. **`profiles`:** lectura para cualquier autenticado, edición solo del dueño.
   `profiles` no guarda datos financieros personales — solo nombre y aporte
   mensual esperado, que la app muestra de ambos miembros (nombre de la
   pareja, gráfico "aporte real vs esperado por miembro"). Los datos
   financieros personales viven en `transacciones`/`metas`/`desafios` con
   `ambito='personal'` y ahí solo los ve el dueño.

## Tablas (orden de creación por dependencias FK)

`profiles → categorias → transacciones → prestamos → metas → desafios`

- PK `uuid` con `default gen_random_uuid()`.
- Montos `numeric(10,2)`.
- `profiles.user_id` con `UNIQUE` (un perfil por cuenta).
- `desafios.fecha_fin` es columna generada (`GENERATED ALWAYS AS ... STORED`).

## RLS

| Tabla | Política |
|---|---|
| `profiles` | SELECT: todos autenticados · INSERT/UPDATE: `auth.uid() = user_id` |
| `categorias` | FOR ALL: cualquier autenticado (compartidas) |
| `transacciones` | FOR ALL: `ambito='hogar' OR auth.uid()=user_id` |
| `prestamos` | FOR ALL: hereda vía EXISTS sobre su `transaccion_id` |
| `metas` | FOR ALL: `ambito='hogar' OR auth.uid()=user_id` |
| `desafios` | FOR ALL: `ambito='hogar' OR auth.uid()=user_id` |

## Trigger

`handle_new_user()` `SECURITY DEFINER` → `AFTER INSERT ON auth.users`.
Inserta en `profiles` con `nombre` derivado de `raw_user_meta_data->>'nombre'`
o, en su defecto, la parte local del email; `aporte_mensual_esperado = 0`.

## Datos semilla

- 21 categorías `tipo='gasto'` (Ahorro, Dinero que prestamos y Capital de
  trabajo con `limite_mensual NULL` = sin límite).
- 5 categorías `tipo='ingreso'`.
- 2 metas `ambito='hogar'`, `user_id NULL`: "Fondo de emergencia" y
  "Viaje o experiencia juntos".

> El bloque de seed se ejecuta una sola vez junto con el schema.
