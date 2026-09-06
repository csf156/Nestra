# Ingesta autónoma de correo — decisión de arquitectura y prueba de entrega

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cualquier usuario conecte su correo bancario por su cuenta, sin que nadie le monte nada a mano. Este documento fija la arquitectura elegida y ejecuta **la prueba que puede invalidarla**. La implementación completa se planifica después del resultado.

**Architecture:** Reenvío automático desde el correo del usuario a una dirección única por usuario (`u+<token>@<dominio>`), recibida por Cloudflare Email Routing y entregada al Worker de ingesta que ya existe. Sustituye la copia de Apps Script por cuenta de Gmail, que es el cuello de botella actual.

**Tech Stack:** Cloudflare Email Routing + Worker (`workers/ingest`), Supabase (tokens y colas), PWA vanilla.

---

## Por qué este documento no trae la implementación completa

La opción elegida depende de un hecho que **nadie ha verificado**: que un correo de banco reenviado automáticamente por Gmail sobreviva al antispam de Cloudflare Email Routing.

Un reenvío rompe SPF —la IP de Google no está autorizada para el dominio del banco— y Cloudflare **puede descartar el mensaje en silencio**. Si eso ocurre, toda la arquitectura se cae, y detallar 500 líneas de implementación antes de saberlo sería trabajo tirado.

Por eso este plan ejecuta primero la prueba de entrega. Es de un día. Con su resultado se escribe el plan de implementación.

---

## Estado actual, verificado en código

Pipeline hoy: **Gmail → Google Apps Script → POST HTTPS → Worker → `ingest_pendientes`**.

Lo que **ya escala** y no se toca:
- El token vive hasheado (SHA-256) en `email_ingest_tokens` (`user_id`, `token_hash`, `label`, `revoked`, `last_used_at`). El Worker hashea el Bearer y resuelve el `user_id`. Dar de alta a alguien es insertar una fila; no se redespliega nada.
- Todo correo entra a `ingest_pendientes`, **nunca crea una transacción directamente**. El usuario confirma en `#revisar`.

Lo que **no escala**: el alta del usuario. Hoy son ~5 pasos manuales (crear proyecto en `script.google.com`, pegar `Code.gs`, pegar el token, ajustar el `QUERY` del banco, autorizar permisos, crear el trigger cada 10 minutos). Hay exactamente **2 usuarios con token**.

---

## Decisión de arquitectura

**Elegido: reenvío a dirección única por usuario.** Discutido con la sesión de diseño el 2026-09-06.

### Por qué, y no el Apps Script pulido

El argumento decisivo **no** es la comodidad: **Apps Script es solo-Gmail**. Una regla de reenvío existe en Gmail, Outlook, iCloud, Yahoo y el webmail de cualquier banco. Si el objetivo es "cualquier usuario", el Apps Script tiene un techo que ninguna mejora de interfaz levanta.

El segundo: el paso donde se cae la gente no técnica no es pegar código, es **la pantalla de autorización de Google** ("este script quiere leer tu Gmail"). Reenviar no pide permisos.

### Descartadas, y por qué

- **OAuth de Gmail (`gmail.readonly`).** La experiencia ideal, pero es un scope restringido: exige verificación con evaluación de seguridad anual de Google. Desproporcionado para esta app.
- **Cambiar el correo de notificaciones en el banco.** Sería el camino más limpio —sin Gmail, sin filtro, sin reenvío— pero el usuario reportó que **no es sencillo de cambiar** en sus bancos.
- **IMAP con contraseña de aplicación.** Guardaríamos una credencial de lectura total del buzón. Desproporcionado.
- **Agregadores tipo Belvo.** Es la respuesta "producto" real, pero cuesta y trae KYC. El camino si esto deja de ser una app personal.

### Conservado como camino de poder, no como alternativa para no técnicos

El Apps Script se queda por una razón que el reenvío no cubre: **puede rellenar historial hacia atrás** (`newer_than:90d`). El reenvío solo ve correo futuro. Para todo lo demás es peor, así que no se ofrece como "plan B fácil".

---

## La pregunta de privacidad que hay que responder antes de abrirlo a terceros

El usuario señaló que nadie querrá mandar sus transacciones bancarias a un correo desconocido. Tiene razón, y **la objeción no distingue entre las dos opciones**: `workers/ingest/apps-script/Code.gs:47` hace `body: msg.getPlainBody().slice(0, 20000)` y lo postea al Worker. **El cuerpo del correo acaba en nuestra infraestructura por los dos caminos.**

Para el usuario y su pareja no aplica: es su dominio, su Worker, su base. Pero **antes de abrir Nestra a un tercero** hay que responder: qué se guarda (hoy `raw_body`, 20 000 caracteres), cuánto tiempo, y quién puede leerlo. Eso es una decisión de producto, no de ingeniería, y no la resuelve este plan.

Anotado aquí para que no se descubra tarde.

---

## Riesgos de seguridad que el diseño debe cubrir (tras el go/no-go)

**El reenvío degrada la autenticación.** Hoy la ingesta va con Bearer sobre HTTPS y el token hasheado. Una dirección de correo viaja en SMTP plano y el `From` es trivialmente falsificable: quien vea la dirección puede inyectar movimientos falsos.

Lo que salva el diseño **ya está construido**: el correo escribe en `ingest_pendientes`, nunca una transacción confirmada. Un correo falso es, como mucho, una fila que el usuario descarta en `#revisar`. **Debe quedar explícito en el spec para que nadie lo "optimice" saltándose la cola más adelante.**

Mitigación obligatoria en la implementación: **allowlist de remitentes por usuario**. Solo se guarda el cuerpo si el `From` está entre los remitentes del banco de ese usuario (más `forwarding-noreply@google.com` durante el alta). De remitente desconocido **no se persiste cuerpo**, solo remitente y contador — que además evita guardar correo personal si alguien reenvía de más.

---

## Comportamiento ante error, decidido

Tres cubos, no dos:

1. **Remitente conocido + parseado** → `ingest_pendientes` normal.
2. **Remitente conocido + no parseado** → cola "No reconocido" en `#revisar` (ya existe como `revisar-manual`), con acción para crear a mano prellenando lo que sí se leyó.
3. **Remitente desconocido** → **no entra a ninguna cola**. Solo un contador en la tarjeta de conexión: *"17 correos ignorados (no parecen de un banco)"* con los 3 remitentes más frecuentes y un botón "este sí es mi banco → añadir remitente". Convierte el error de configuración en un tap, y es el mismo mecanismo que la allowlist de seguridad: una regla, dos problemas.

**Y el fallo que de verdad duele: que deje de llegar y nadie se entere.** La tarjeta debe mostrar "último correo hace 4 h", y tras N días sin nada habiendo recibido antes, avisar por push (la Fase 7 ya está). Un pipeline muerto en silencio es peor que uno ruidoso.

---

# La prueba de entrega

**Bloqueada hasta que el usuario compre el dominio.** Lo hará el 2026-09-07.

**Criterio de éxito:** de 3 correos reales de banco reenviados automáticamente por Gmail, **llegan los 3** al Worker.
**Criterio de fallo:** se pierde alguno en silencio, o llegan con el cuerpo alterado de forma que el parser no lo reconozca.

---

### Task 1: Dominio y Email Routing — REQUIERE AL USUARIO

**Files:** ninguno (configuración en el panel de Cloudflare).

- [ ] **Step 1: Confirmar que el dominio existe y su DNS está en Cloudflare**

Sin esto no hay nada que hacer. El usuario compra el dominio; los nameservers deben apuntar a Cloudflare.

- [ ] **Step 2: Activar Email Routing y crear la regla catch-all**

En el panel de Cloudflare, Email → Email Routing. Activar, y crear una regla **catch-all** que envíe a un Worker (no a una dirección). Cloudflare pide verificar los registros MX y SPF que añade solo.

> Esto lo hace el usuario en su panel, o lo guía paso a paso quien ejecute. **No inventar credenciales ni intentar automatizarlo con API sin que el usuario lo pida.**

- [ ] **Step 3: Anotar el dominio elegido en el plan**

Sustituir `<dominio>` por el real en este documento y commitearlo, para que las tasks siguientes no dependan de memoria.

---

### Task 2: Worker de prueba que solo registra

**Files:**
- Create: `workers/ingest-probe/src/index.js`
- Create: `workers/ingest-probe/wrangler.toml`

Un Worker aparte, desechable. **No tocar `workers/ingest`**: si la prueba falla, no queremos haber ensuciado el pipeline que hoy funciona.

- [ ] **Step 1: Escribir el Worker**

`workers/ingest-probe/src/index.js`:

```js
// Worker de PRUEBA — mide si un correo de banco reenviado sobrevive al
// antispam de Cloudflare Email Routing. No escribe a la base, no parsea:
// solo registra lo suficiente para responder la pregunta.
//
// Se borra en cuanto la prueba concluya. NO añadir lógica aquí.
export default {
  async email(message, env, ctx) {
    const headers = {};
    for (const [k, v] of message.headers) headers[k.toLowerCase()] = v;

    let cuerpo = '';
    try {
      cuerpo = await new Response(message.raw).text();
    } catch (e) {
      cuerpo = '(no se pudo leer: ' + (e && e.message) + ')';
    }

    console.log(JSON.stringify({
      event: 'correo_recibido',
      to: message.to,
      from: message.from,
      subject: headers['subject'] || null,
      // Lo que decide si el parser sobrevivirá: si Gmail envolvió el mensaje,
      // el From deja de ser el del banco y aparece la cabecera de reenvío.
      forwarded_for: headers['x-forwarded-for'] || null,
      forwarded_to: headers['x-forwarded-to'] || null,
      auth_results: headers['authentication-results'] || null,
      bytes: cuerpo.length,
      // Primeros 400 caracteres: basta para ver si el cuerpo llegó íntegro o
      // envuelto en "---------- Forwarded message ----------".
      muestra: cuerpo.slice(0, 400),
    }));
  },
};
```

`workers/ingest-probe/wrangler.toml`:

```toml
name = "nestra-email-probe"
main = "src/index.js"
compatibility_date = "2026-09-06"
```

- [ ] **Step 2: Desplegar — REQUIERE AUTORIZACIÓN DEL USUARIO**

```bash
cd workers/ingest-probe && npx wrangler deploy
```

> La sesión de `wrangler` caduca cada hora. Si falla pidiendo `CLOUDFLARE_API_TOKEN`, el usuario tiene que correr `npx wrangler login`. **No intentes rodearlo.**

- [ ] **Step 3: Apuntar el catch-all a este Worker**

En Email Routing, la regla catch-all → Worker `nestra-email-probe`.

---

### Task 3: La prueba

**Files:** ninguno.

- [ ] **Step 1: Reenvío manual primero (el caso fácil)**

El usuario reenvía **a mano** un correo de BBVA a `prueba@<dominio>`. Con `npx wrangler tail --name nestra-email-probe --format pretty` mirando.

Qué esperar: llega, pero el `from` es el del usuario y el cuerpo trae el envoltorio `---------- Forwarded message ----------`. **Eso ya es información:** confirma que la entrega funciona y mide cuánto habría que desenvolver.

- [ ] **Step 2: Reenvío automático (el caso que importa)**

El usuario crea en Gmail un filtro de reenvío hacia `prueba@<dominio>` para los remitentes de su banco. Gmail pedirá confirmar con un código enviado a esa dirección: **aparecerá en el `wrangler tail`** — extraerlo de ahí y dárselo al usuario.

> Ese paso ES la prueba del OTP que el diseño necesita. Anotar cómo llegó el correo de `forwarding-noreply@google.com`: asunto, formato del código, si el código está en el asunto o en el cuerpo.

- [ ] **Step 3: Esperar 3 correos reales de banco**

No forzarlos. Con ~40 correos semanales, en un día entran varios.

Registrar de cada uno: si llegó, el `from`, si hubo envoltorio, y qué dice `authentication-results` sobre SPF/DKIM.

- [ ] **Step 4: El veredicto**

```
Reenviados por Gmail: N
Llegados al Worker:   M
```

- **M = N** → la arquitectura es viable. Escribir el plan de implementación.
- **M < N** → alguno se perdió en silencio. **Parar y replantear** antes de escribir una línea más: revisar si Cloudflare ofrece registro de descartes, y si no, la arquitectura del reenvío no es fiable y hay que volver al Apps Script pulido.

> Un correo perdido en silencio en la prueba es una señal fuerte: en producción significaría gastos que nunca aparecen y que el usuario no sabe que faltan. Peor que un pipeline que falla ruidosamente.

---

### Task 4: Limpiar la prueba

- [ ] **Step 1: Borrar el Worker de prueba**

```bash
cd workers/ingest-probe && npx wrangler delete
```

Y borrar la carpeta `workers/ingest-probe/` del repo. No debe quedar un Worker con un catch-all abierto a internet apuntando a nada.

- [ ] **Step 2: Quitar o reapuntar la regla catch-all**

Mientras no exista el pipeline real, dejar el catch-all sin destino o desactivado.

- [ ] **Step 3: Documentar el resultado**

Añadir al final de este documento una sección "Resultado de la prueba" con las cifras, las cabeceras observadas y el veredicto. Ese es el insumo del plan de implementación — y si dentro de seis meses alguien pregunta por qué se eligió esta arquitectura, la respuesta estará aquí y no en la memoria de nadie.

---

## Lo que viene después del go

Alcance ya decidido, a detallar cuando la prueba pase:

1. **Migración:** direcciones únicas por usuario y allowlist de remitentes.
2. **Worker:** handler `email()` en `workers/ingest` — resolver token desde la dirección, aplicar allowlist, reutilizar los parsers que ya existen.
3. **Captura del OTP** de Google y entrega a la PWA por realtime de Supabase, que ya se usa en el proyecto.
4. **Pantalla "Conectar correo"** con la dirección, el enlace directo a los ajustes de reenvío de Gmail, el campo de código autorrellenado, y el filtro sugerido con el `from:` del banco.
5. **Salud del pipeline:** último correo recibido, contador de ignorados con sus remitentes, y aviso por push si deja de llegar.
