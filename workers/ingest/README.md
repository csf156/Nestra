# nestra-email-ingest — Worker de ingesta de correos (Opción A: sin dominio)

Pipeline: **Gmail → Google Apps Script → POST HTTPS → este Worker**.
Cada cuenta Gmail corre una copia del script con su propio token; el token
identifica al usuario de Nestra. El Worker **solo loguea** por ahora — no
escribe a la base de datos. La fase siguiente parseará el correo del banco e
insertará la transacción **personal** (`hogar_id = NULL`) del usuario.

Sin dominio propio ni Email Routing: el Worker vive en el subdominio gratuito
`*.workers.dev`.

## Diseño escalable (token → usuario vía DB)

El Worker **no tiene usuarios ni tokens hardcodeados**. Cada token vive
**hasheado (SHA-256)** en la tabla `email_ingest_tokens` de Supabase:

```
email_ingest_tokens
  user_id      → auth.users
  token_hash   SHA-256(token) en hex   (nunca el token en claro)
  label, revoked, created_at, last_used_at
```

Flujo del Worker: recibe `Bearer <token>` → `SHA-256` → busca la fila
(`revoked=false`) vía service-role → obtiene `user_id`. Miss → 401.

**Consecuencia:** dar de alta un usuario = insertar una fila; revocar = flag
`revoked`. **Nunca** se toca el código del Worker ni se redesplega, y solo hay
**2 secrets fijos** (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`) que no crecen con
el número de usuarios. Futuro: botón "Conectar correo bancario" en la PWA que
genera el token, guarda el hash y muestra el snippet Apps Script pre-armado.

## Estructura

```
workers/ingest/
├── wrangler.toml        # config del Worker (nombre: nestra-email-ingest)
├── src/index.js         # handler fetch(): POST /ingest con Bearer token
├── apps-script/Code.gs  # script para pegar en Apps Script (1 por cuenta Gmail)
└── README.md
```

## Comandos (desde `workers/ingest/`)

```sh
# Verificar que compila sin desplegar
npx wrangler deploy --dry-run

# Login (abre navegador, una sola vez)
npx wrangler login

# Desplegar — la salida muestra la URL https://nestra-email-ingest.<subdominio>.workers.dev
npx wrangler deploy

# Ver logs en vivo
npx wrangler tail nestra-email-ingest
```

## Pasos manuales

### 1. Aplicar la migración (SQL Editor de la base v2)

Revisar y ejecutar `supabase/migrations/20260713_email_ingest_tokens.sql` en
el SQL Editor del proyecto v2 (`ombnhxueclqfeyjzhroz`). Crea la tabla + RLS.

### 2. Desplegar Worker + los 2 secrets fijos

```sh
npx wrangler login
npx wrangler deploy
npx wrangler secret put SUPABASE_URL            # https://ombnhxueclqfeyjzhroz.supabase.co
npx wrangler secret put SUPABASE_SERVICE_ROLE   # service_role JWT del proyecto v2
```

El `service_role` se saca del dashboard Supabase → Project Settings → API →
`service_role` (secret). ⚠️ Salta RLS — solo como secret del Worker, nunca en
el cliente ni en git.

### 3. Alta de los 2 usuarios actuales (generar token + insertar hash)

Por cada usuario: generar un token aleatorio, calcular su SHA-256 e insertar
la fila. En PowerShell:

```powershell
# Genera token + su hash. Correr una vez por usuario.
$token = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
$bytes = [System.Text.Encoding]::UTF8.GetBytes($token)
$hash  = ([System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes) |
          ForEach-Object { $_.ToString('x2') }) -join ''
Write-Host "TOKEN (pegar en Code.gs): $token"
Write-Host "HASH  (insertar en DB):   $hash"
```

Luego insertar en el SQL Editor (usar el hash, NUNCA el token):

```sql
-- César  (csf156@gmail.com)
insert into public.email_ingest_tokens (user_id, token_hash, label)
values ('42c18981-e55f-4271-8f01-e89ab2975f44', '<HASH_CESAR>', 'Gmail César');

-- Darling (mezareyesdarling@gmail.com)
insert into public.email_ingest_tokens (user_id, token_hash, label)
values ('d83a9b58-f740-4c77-af01-d3ebf2669938', '<HASH_DARLING>', 'Gmail Darling');
```

Guardar cada TOKEN (el de claro) para pegarlo en el Code.gs de esa cuenta.

### 4. Apps Script (repetir en CADA cuenta Gmail)

1. Entrar a <https://script.new> con la cuenta (César en la suya, Darling en la suya).
2. Pegar el contenido de [apps-script/Code.gs](apps-script/Code.gs).
3. Configurar las 3 variables de arriba del archivo:
   - `WORKER_URL`: la URL que dio `wrangler deploy` + `/ingest`.
   - `TOKEN`: el token en claro de ESA cuenta (paso 3).
   - `QUERY`: remitente(s) del banco, p. ej.
     `'from:(notificaciones@bcp.com.pe) newer_than:3d'`.
4. Guardar. Ejecutar una vez `procesarCorreos` a mano (▶) — Google pedirá
   autorizar Gmail + "conectar con servicio externo"; aceptar (es tu propio
   script en tu propia cuenta).
5. Trigger automático: menú ⏰ **Activadores** → *Añadir activador* →
   función `procesarCorreos`, tipo *Según tiempo*, cada **10 minutos**.

### 5. Probar punta a punta

1. Enviarse (o esperar) un correo que cumpla el `QUERY`.
2. `npx wrangler tail nestra-email-ingest` y ejecutar `procesarCorreos` a mano.
3. Debe aparecer un JSON `event: "email_received"` con el `userId` correcto,
   `from`, `subject` y `bodyPreview`.
4. En Gmail, el hilo queda con la etiqueta `nestra-procesado`.

## Notas

- Deploy del Worker es independiente de la PWA (Cloudflare Pages, rama `v2`).
  Push a `v2` NO despliega el Worker; se despliega con `wrangler deploy`.
- Idempotencia: el script etiqueta los hilos procesados; si el POST falla, no
  etiqueta y reintenta. En la fase de DB se añadirá dedupe por `messageId`.
- Costos: Apps Script gratis, Workers free tier 100k requests/día. Cero gasto.
- Escala: N usuarios = N filas en `email_ingest_tokens` + N copias del script
  (self-service, cada quien en su Gmail). Infra del Worker no cambia.
- Próxima fase: parser por banco (monto, comercio, gasto/ingreso) + inserción
  de la transacción personal en Supabase + dedupe.
