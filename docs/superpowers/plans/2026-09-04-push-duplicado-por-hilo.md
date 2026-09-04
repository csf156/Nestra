# Push repetido por reenvío de hilo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un gasto solo genere una notificación push, la primera vez que su correo entra. Hoy, cada gasto nuevo re-notifica todos los gastos anteriores del mismo hilo de Gmail.

**Architecture:** El arreglo va en el Worker de ingesta, en el punto donde se decide notificar. `insertarPendiente` pasa de `return=minimal` a `return=representation`, con lo que PostgREST devuelve la fila creada (`[{...}]`) o un array vacío (`[]`) si el `ON CONFLICT DO NOTHING` la ignoró. Con eso el Worker distingue por primera vez un insert real de un duplicado, y solo notifica en el primero. Segunda capa: `tag` en el payload, para que una notificación repetida colapse en vez de apilarse.

**Tech Stack:** Cloudflare Worker (`workers/ingest`), PostgREST, Web Push. Deploy con `wrangler`, separado del deploy de Pages.

---

## Diagnóstico

Reportado por el usuario: *"cuando me llegaba una notificación de un nuevo gasto, se repetían también las notificaciones de los gastos previos de ese mismo día."*

Cadena causal, verificada en el código y contra los datos reales:

1. **Gmail agrupa en un hilo** los correos del banco con el mismo asunto y remitente. Confirmado con los datos: el 2026-09-02 entraron 6 `Has realizado un consumo con tu tarjeta BBVA`, 5 `Constancia de operación transferencia PLIN con QR` y 4 `La compra ... ha sido anulada` — todos mismo asunto, mismo día.

2. **El Apps Script busca por hilo y etiqueta por hilo** (`workers/ingest/apps-script/Code.gs`):
   ```js
   var threads = GmailApp.search(QUERY + ' -label:' + LABEL, 0, 20);
   ...
   var messages = threads[i].getMessages();   // TODOS los del hilo
   ```
   `thread.addLabel()` etiqueta los mensajes que existen en ese momento. Cuando llega uno nuevo al mismo hilo, **ese mensaje no lleva la etiqueta**, así que el hilo vuelve a matchear `-label:nestra-procesado` y `getMessages()` devuelve otra vez todos los anteriores.

3. **El Worker ya sabía que esto pasa.** Su propio comentario en `src/index.js:102` dice: *"on_conflict + ignore-duplicates: el script reenvía todos los mensajes de un [hilo]"*. El dedupe de base de datos se diseñó justo para eso, y funciona: no hay filas duplicadas.

4. **Pero el dedupe de notificación no existe.** `insertarPendiente` usa:
   ```js
   prefer: 'resolution=ignore-duplicates,return=minimal',
   ```
   Con `ON CONFLICT DO NOTHING`, PostgREST responde 2xx tanto si insertó como si ignoró, y `return=minimal` no manda cuerpo. **El Worker no tiene forma de distinguir los dos casos**, así que devuelve `json({ok:true})` (HTTP 200) siempre, y el llamador hace:
   ```js
   if (insertResp.status === 200) avisarPendiente(env, ctx, usuario.user_id, fila);
   ```
   → un push por **cada** mensaje reenviado.

**Por qué nadie lo vio antes:** el dedupe se diseñó en la fase del parser (2026-07-15) y el push se añadió después, en Fase 7. Cada pieza es correcta por separado; el defecto está en la costura.

**Por qué "del mismo día":** un hilo agrupa los correos de un mismo asunto, y los del banco llegan a lo largo del día. El enésimo gasto del día re-notifica los n−1 anteriores de ese hilo.

### Descartados durante la investigación

- **El service worker** (`sw.js:154`): un push → una notificación. No enumera nada ni consulta la base. Inocente.
- **La Edge Function del cron**: corre una vez al día (`0 8 * * *`) y tiene candado idempotente por `notificaciones_log` con unique en `(user_id, clave_dedupe)`. No reenvía.
- **Un trigger de base de datos sobre `ingest_pendientes`**: no existe (verificado en `pg_trigger`; los únicos triggers están en `transacciones`).

### Fuera de alcance

Arreglar el Apps Script para que solo mande los mensajes sin etiquetar. Reduciría POSTs inútiles, pero (a) vive en la cuenta de Google del usuario y no se despliega desde el repo, y (b) el Worker debe ser correcto por sí solo — es él quien decide notificar, y no puede confiar en que su llamador nunca repita. El arreglo va en el Worker.

---

## Estructura de archivos

- Modificar: `workers/ingest/src/index.js` — `insertarPendiente` reporta si insertó; el llamador notifica solo entonces; `tag` en el payload.
- Modificar: `test/ingest-parsers.test.mjs` — tests de la función pura nueva.

---

### Task 1: `huboInsercion()` — distinguir insert de duplicado

**Files:**
- Modify: `workers/ingest/src/index.js`
- Test: `test/ingest-parsers.test.mjs`

- [ ] **Step 1: Escribir el test que falla**

Añadir en `test/ingest-parsers.test.mjs`, e importar `huboInsercion` desde `../workers/ingest/src/index.js` en la cabecera:

```js
// ── dedupe de notificación (bug del 2026-09-04) ───────────────────
test('huboInsercion: PostgREST devuelve la fila creada → true', () => {
  assert.equal(huboInsercion([{ id: 'abc', monto: 12.5 }]), true);
});

test('huboInsercion: array vacío = ON CONFLICT DO NOTHING ignoró → false', () => {
  // Este es el caso del reenvío de hilo: la fila ya existía, no se insertó,
  // y por tanto NO debe notificarse.
  assert.equal(huboInsercion([]), false);
});

test('huboInsercion: cuerpo inesperado → false, nunca notifica a ciegas', () => {
  // Ante la duda, no molestar al usuario: una notificación de más es peor
  // que una de menos, porque erosiona la confianza en todas las demás.
  assert.equal(huboInsercion(null), false);
  assert.equal(huboInsercion(undefined), false);
  assert.equal(huboInsercion({}), false);
  assert.equal(huboInsercion('ok'), false);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/ingest-parsers.test.mjs`
Expected: FAIL — `huboInsercion is not a function` (o error de import).

> Si el import del Worker rompe el archivo de tests entero (el `export default { fetch }` no debería estorbar, pero verifícalo), no fuerces el import: mueve `huboInsercion` a `workers/ingest/parsers/utils.js`, que ya se re-exporta por `index.js` de parsers y ya es lo que importan los tests. Avísame si tomas ese camino.

- [ ] **Step 3: Implementar**

En `workers/ingest/src/index.js`, junto a las demás funciones auxiliares:

```js
/**
 * huboInsercion(filas) — ¿PostgREST creó realmente la fila?
 *
 * Con `resolution=ignore-duplicates` el INSERT es ON CONFLICT DO NOTHING y la
 * respuesta es 2xx tanto si insertó como si ignoró el duplicado. Con
 * `return=representation` la diferencia sí es visible: la fila creada viene en
 * un array, y un duplicado ignorado devuelve el array vacío.
 *
 * Importa porque el Apps Script reenvía TODOS los mensajes de un hilo de Gmail
 * cada vez que llega uno nuevo (ver Code.gs). Sin esta distinción, cada gasto
 * nuevo volvía a notificar todos los anteriores del mismo hilo.
 *
 * Ante un cuerpo inesperado devuelve false: una notificación de más es peor que
 * una de menos — la fila ya está encolada y el usuario la verá en #revisar.
 */
function huboInsercion(filas) {
  return Array.isArray(filas) && filas.length > 0;
}
```

Y exportarla junto a lo que el archivo ya exporte, para que el test pueda importarla.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test test/ingest-parsers.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workers/ingest/src/index.js test/ingest-parsers.test.mjs
git commit -m "feat(ingest): huboInsercion distingue insert real de duplicado ignorado"
```

---

### Task 2: Notificar solo cuando la fila es nueva

**Files:**
- Modify: `workers/ingest/src/index.js`

- [ ] **Step 1: `insertarPendiente` pide la fila creada y reporta si la hubo**

Reemplazar el cuerpo de `insertarPendiente` (línea ~109). Cambia el `prefer`, lee el cuerpo, y devuelve `{ response, insertada }` en vez de solo la respuesta:

```js
async function insertarPendiente(env, fila, userId, messageId) {
  const resp = await fetch(
    `${env.SUPABASE_URL}/rest/v1/ingest_pendientes?on_conflict=user_id,message_id`,
    {
      method: 'POST',
      headers: headersSupabase(env, {
        'content-type': 'application/json',
        // representation (antes minimal): sin cuerpo no hay forma de saber si
        // el ON CONFLICT DO NOTHING insertó o ignoró, y sin eso se notificaba
        // cada reenvío de hilo. Ver plan 2026-09-04.
        prefer: 'resolution=ignore-duplicates,return=representation',
      }),
      body: JSON.stringify(fila),
    }
  );

  if (!resp.ok) {
    const detalle = await resp.text();
    console.error(JSON.stringify({
      event: 'insert_failed', userId, messageId,
      status: resp.status, detalle,
    }));
    return { response: json({ error: 'insert failed' }, 500), insertada: false };
  }

  const filas = await resp.json().catch(() => null);
  const insertada = huboInsercion(filas);

  console.log(JSON.stringify({
    event: insertada ? 'email_encolado' : 'email_duplicado', userId, messageId,
    banco: fila.banco, tipo: fila.tipo, monto: fila.monto,
    estado: fila.estado || 'pendiente',
    moneda_original: fila.moneda_original || null,
    comercio: fila.comercio, fecha: fila.fecha,
  }));
  return { response: json({ ok: true, insertada, tipo: fila.tipo, monto: fila.monto }), insertada };
}
```

> El evento de log `email_duplicado` es la señal que se usa para verificar el arreglo en producción (Task 3). Sin él no habría forma de confirmar que el reenvío ocurre y que ya no notifica.

- [ ] **Step 2: Actualizar los DOS llamadores**

Hay dos. El primero, en la rama de `revisar-manual` (línea ~250), hoy hace `return insertarPendiente(...)` directo; ahora debe devolver la respuesta:

```js
        const manual = await insertarPendiente(env, {
```
...manteniendo el objeto de la fila tal como está, y terminando con:
```js
        }, usuario.user_id, messageId);
        return manual.response;
```

> Esa rama nunca notificaba y sigue sin hacerlo: una fila `revisar-manual` no tiene monto ni comercio que mostrar.

El segundo, al final del handler (línea ~318):

```js
    const { response, insertada } = await insertarPendiente(env, fila, usuario.user_id, messageId);
    // Solo la PRIMERA vez que este correo entra. El Apps Script reenvía todos
    // los mensajes del hilo cada vez que llega uno nuevo, y notificar en cada
    // reenvío repetía los gastos anteriores del día.
    if (insertada) avisarPendiente(env, ctx, usuario.user_id, fila);
    return response;
```

> **La respuesta HTTP sigue siendo 200 también para los duplicados**, a propósito: el Apps Script solo etiqueta el hilo `if (todosOk)`, y devolver un no-2xx en los duplicados dejaría el hilo sin etiquetar para siempre, reenviándose en bucle. Lo único que cambia es la decisión de notificar.

- [ ] **Step 3: Verificar sintaxis y suite**

Run: `node --check workers/ingest/src/index.js`
Expected: sin salida.

Run: `for f in test/*.test.mjs; do node --test "$f" || echo "FAIL $f"; done`
Expected: sin líneas `FAIL`.

- [ ] **Step 4: Commit**

```bash
git add workers/ingest/src/index.js
git commit -m "fix(ingest): notificar solo la primera vez que un correo entra"
```

---

### Task 3: Segunda capa — `tag` en la notificación

Aunque el arreglo de la Task 2 corta el problema en origen, el payload no lleva `tag`, así que dos notificaciones idénticas se apilan en vez de colapsar. Un `tag` por `message_id` hace que un eventual duplicado —por un reintento, o por otra ruta futura— reemplace al anterior en lugar de sumarse.

**Files:**
- Modify: `workers/ingest/src/index.js`

- [ ] **Step 1: Pasar el messageId a la notificación**

`enviarPushConfirmacion` y `avisarPendiente` reciben `fila`, que ya tiene `message_id`. En el payload de `enviarPushConfirmacion`:

```js
  const payload = {
    title: '¿Confirmar gasto?',
    body: `S/${fila.monto} en ${fila.comercio || fila.contraparte || 'movimiento'}`,
    url: './#revisar',
    // Un tag por correo: si el mismo aviso se enviara dos veces, el segundo
    // reemplaza al primero en vez de apilarse. Gastos distintos tienen
    // message_id distinto, así que nunca se colapsan entre sí.
    tag: fila.message_id || undefined,
  };
```

- [ ] **Step 2: Que el service worker lo use**

En `sw.js`, dentro del handler de `push` (línea ~158), añadir a `options`:

```js
    tag: data.tag || undefined,
```

- [ ] **Step 3: Bumpear el shell**

`sw.js` cambia, así que `SHELL_VERSION` pasa a `v46`.

- [ ] **Step 4: Suite y commit**

Run: `for f in test/*.test.mjs; do node --test "$f" || echo "FAIL $f"; done`
Expected: sin líneas `FAIL`.

```bash
git add workers/ingest/src/index.js sw.js
git commit -m "feat(push): tag por correo para que un aviso repetido no se apile"
```

---

### Task 4: Desplegar y verificar en producción

**PARAR ANTES DE ESTE PASO.** El deploy lo autoriza el usuario, igual que en la Etapa B.

- [ ] **Step 1: Confirmar la suite**

Run: `node --test test/ingest-parsers.test.mjs`
Expected: `# fail 0`.

- [ ] **Step 2: Desplegar el Worker**

```bash
cd workers/ingest && npx wrangler deploy
```

Reportar el `Current Version ID`.

> La sesión de `wrangler` caduca: si falla con `CLOUDFLARE_API_TOKEN`, el usuario tiene que correr `npx wrangler login` otra vez. No intentes rodearlo.

- [ ] **Step 3: Verificar con tráfico real**

```bash
cd workers/ingest && npx wrangler tail --format pretty
```

Dejarlo corriendo hasta que el Apps Script haga su siguiente pasada (máximo 10 minutos). Lo que debe verse:

- Eventos `email_duplicado` para los mensajes ya conocidos del hilo — confirman que el reenvío **sigue ocurriendo** (es comportamiento del Apps Script, no se arregló ahí).
- **Ningún** push asociado a esos duplicados.
- Un `email_encolado` y un único push cuando entre un correo genuinamente nuevo.

> Si no aparece ningún `email_duplicado`, no significa que esté arreglado: significa que no hubo reenvío en esa ventana. Espera a una pasada donde sí lo haya, o valídalo cuando llegue el próximo gasto real.

- [ ] **Step 4: Bumpear el shell en producción**

El `tag` de la Task 3 toca `sw.js`, así que ese cambio necesita merge a `main` y deploy de Pages, **aparte** del deploy del Worker. Son dos despliegues distintos.
