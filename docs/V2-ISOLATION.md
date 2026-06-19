# Nestra v2 — Setup de Aislamiento

## Instancia Supabase

| Entorno | Proyecto Supabase | Rama Git |
|---------|------------------|----------|
| Producción (v1) | `rblxwqdphhmpglxxtgtv` (Nestra) | `master` / `main` |
| Desarrollo (v2) | `Nestra-v2` (proyecto separado) | `v2` |

Las credenciales de v2 viven **únicamente** en `js/config.js` de esta rama.
Las credenciales de v1 **no existen en ningún archivo de la rama v2**.

---

## Cómo se inicializó este entorno

1. Rama `v2` creada desde `master` el 2026-06-18.
2. Proyecto Supabase `Nestra-v2` creado manualmente en el dashboard.
3. Schema aplicado desde `supabase/schema_v2_fresh.sql` (estado final consolidado).
4. `js/config.js` actualizado con URL y anon key de `Nestra-v2`.

---

## Cómo aplicar el schema en el proyecto v2

1. Ir a [supabase.com](https://supabase.com) → proyecto `Nestra-v2`.
2. SQL Editor → New query.
3. Pegar el contenido de `supabase/schema_v2_fresh.sql`.
4. Run. Verificar que no hay errores.
5. Copiar **Project URL** y **anon public key** desde Settings → API.
6. Pegar ambos valores en `js/config.js` de esta rama.

---

## Plan de cutover (Fase 0 — cuando v2 esté listo para producción)

1. **Exportar datos de v1**: `pg_dump` o Supabase dashboard export del proyecto `rblxwqdphhmpglxxtgtv`.
2. **Importar en v2**: cargar el dump en `Nestra-v2` (solo tablas de datos: transacciones, metas, aportes_meta, perfiles, desafios; no el schema, ya está aplicado).
3. **Verificar integridad**: comparar counts por tabla entre v1 y v2.
4. **Congelar v1**: modo mantenimiento o RLS de solo lectura en v1.
5. **Actualizar GitHub Pages**: apuntar el deploy a la rama `v2` (Settings → Pages → Source).
6. **Archivar v1**: el proyecto Supabase `rblxwqdphhmpglxxtgtv` queda en pausa; NO borrar hasta 30 días post-cutover.

---

## QUÉ NO TOCAR EN PRODUCCIÓN

Las siguientes cosas son de **v1 producción** y no deben modificarse desde la rama `v2`:

- **Proyecto Supabase `rblxwqdphhmpglxxtgtv`**: ninguna migración, ningún cambio de schema, ninguna política RLS.
- **Rama `master`**: no hacer merge de `v2` hasta que el cutover esté validado.
- **Rama `main`**: ídem. GitHub Pages la usa para el deploy de producción.
- **Credenciales v1** (`rblxwqdphhmpglxxtgtv` / la anon key original): no copiarlas en ningún archivo de la rama `v2`.
- **Datos de usuarios reales**: no importarlos a v2 antes de que el schema esté estabilizado y el cutover sea intencional.

---

## Archivos clave

| Archivo | Propósito |
|---------|-----------|
| `js/config.js` | Credenciales activas (v2 en esta rama) |
| `supabase/schema_v2_fresh.sql` | Schema completo para aplicar en proyecto v2 |
| `supabase/schema.sql` | Schema base original de v1 (referencia histórica) |
| `supabase/migrations/` | Historial de migraciones de v1 (ya consolidadas en schema_v2_fresh.sql) |

---

## Google OAuth setup (proyecto v2)

Pasos manuales en el dashboard (los hace el dueño de la cuenta):

1. **Google Cloud Console** → crear proyecto (o reusar) → APIs & Services →
   Credentials → Create Credentials → OAuth client ID → Web application.
2. Authorized redirect URI (sin ruta): `https://ombnhxueclqfeyjzhroz.supabase.co`
   (Google Cloud solo acepta base URL, sin `/auth/v1/callback`).
3. Copiar **Client ID** y **Client Secret**.
4. **Supabase v2** → Authentication → Providers → Google → Enable → pegar
   Client ID + Secret → Save.
5. **Authentication → URL Configuration** → Site URL = la URL de la app
   (local: `http://localhost:<puerto>/`; prod futura: el dominio de v2).
   Añadir esa misma URL a **Redirect URLs**.
6. Verificar que los emails de Google de Christian y Darling coinciden con sus
   cuentas email/password actuales (Supabase vincula por email).
