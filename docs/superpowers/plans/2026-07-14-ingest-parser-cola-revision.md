# Plan — Parser de correos bancarios + cola de revisión

**Fecha:** 2026-07-14
**Estado:** propuesto, pendiente de aprobación
**Depende de:** infra de ingesta ya en vivo (`workers/ingest/`, tabla `email_ingest_tokens`)

## Objetivo

Convertir los correos bancarios que ya llegan al Worker en transacciones de Nestra,
**sin que entren datos incorrectos en silencio**. El Worker parsea y propone; el
usuario confirma con un tap desde la PWA, pudiendo corregir monto y categoría.

## Decisiones tomadas (2026-07-14)

1. **Cola de revisión**, no inserción directa. Con monto y categoría **editables**
   antes de confirmar (el monto porque la conversión USD→PEN es aproximada).
2. **Modelo simétrico** para transferencias entre personas: **gasto** para quien
   envía, **ingreso** para quien recibe — sin importar el motivo.
3. **USD se convierte a PEN** en la ingesta, guardando el original para auditoría.

### Revisión del punto 2 (2026-07-14, tras discutirlo con el usuario)

La propuesta original era detectar el PLIN entre la pareja y sugerir
`hogar_liquidaciones`. **Se descartó.** El usuario lo planteó así: si compran dos
hamburguesas de S/10 y él pone S/5 y ella S/15, ella le está cubriendo S/5
temporalmente; cuando él se los plinea, ese PLIN **es** su gasto (su parte de la
hamburguesa, pagada tarde).

Cuadra:
- Christian: gasto 5 (restaurante) + gasto 5 (PLIN) = 10 = su parte real ✓
- Darling: gasto 15 (restaurante) − ingreso 5 = 10 = su parte real ✓
- Neto del hogar: 0. La plata nunca salió de la pareja ✓

Dos razones por las que este modelo es **mejor** que el de liquidaciones:

1. **No exige adivinar la intención.** Cuadra igual si la transferencia salda un
   gasto común, es un regalo o un préstamo. El modelo de liquidación dependía de
   clasificar el motivo con un match difuso de nombres — el punto débil que el
   propio plan marcaba. Con esto desaparecen `esPareja`, `profiles.ingest_alias`
   y el RPC `ingest_alias_pareja` (migración eliminada).
2. **Los datos lo confirman:** 0 gastos con `hogar_id` (los 122 son personales) y
   0 filas en `hogar_liquidaciones`. El split de hogar y el botón "saldar" no se
   usan. Se estaba diseñando alrededor de un mecanismo muerto.

**Condición indispensable:** el modelo solo cuadra si se registran **ambos lados**.
Si se implementa el gasto del emisor y no el ingreso del receptor, los gastos del
receptor quedan inflados (Darling mostraría 15 en vez de 10, y el hogar sumaría 25
por una compra de 20). Por eso `Constancia de recepción de Yapeo a celular` (BCP)
es obligatorio, no opcional.

**Distorsión conocida y aceptada:** el gasto de Darling en la categoría del
restaurante muestra 15, no 10; su ingreso de 5 vive en otra categoría. Para
exactitud por categoría habría que partir el gasto al registrarlo (`transacciones`
tiene `split_id`). Fuera de alcance por ahora.

**Cuándo volvería a tener sentido `hogar_liquidaciones`:** solo si empiezan a usar
gastos con `ambito='hogar'`. Ahí el PLIN que salda el balance calculado NO debe ser
gasto (se contaría dos veces). Hoy no aplica.

## Contexto: lo que se verificó en las bandejas reales

### Christian — BBVA (`procesos@bbva.com.pe`)

| Asunto | ¿Transacción? | Formato |
|---|---|---|
| `Has realizado un consumo con tu tarjeta BBVA` | ✅ gasto | etiquetas **con** dos puntos, valor en línea siguiente |
| `Constancia de operación transferencia PLIN` | ✅ gasto o liquidación | inline: `Plineaste S/ 20.00 a EDUARDO ALONSO DIAZ` |
| `Constancia de operación transferencia PLIN con QR` | ✅ ídem | variante del anterior |
| `La compra con tu tarjeta BBVA ha sido rechazada` | ❌ **NO** | ⚠️ cuerpo casi idéntico al consumo real |

Consumo real:
```
Comercio:
ANTHROPIC* CLAUDE
Monto:
20.00
Moneda:
USD
Fecha:
06/07/2026
Hora:
17:22:47
```

Rechazado (**trampa**: mismas claves, sin dos puntos; dice "no se cargará a su tarjeta"):
```
Comercio
ZOLUTIUM
Monto
10.01
Moneda
USD
```

USD es real y recurrente (suscripciones: `ANTHROPIC* CLAUDE` 20.00 USD/mes, 5 hilos hallados).

### Darling — BCP (`notificaciones@notificacionesbcp.com.pe`) + Yape (`notificaciones@yape.pe`)

| Patrón | Tipo |
|---|---|
| `Realizaste un consumo de S/ 52.00 con tu Tarjeta de Débito BCP en <comercio>` | gasto |
| `Recibiste un yapeo de S/ 60.00 de <persona>` | ingreso |
| `Se ha devuelto el monto de S/ 5.00` | ingreso (devolución) |
| `Monto de yapeo* S/ 200.00` | gasto |
| `Tu pago en PEDIDOS YA fue exitoso ... Monto total S/64.20` | gasto |
| `S/ 6 Número recargado: 910 735 153` | gasto (recarga celular) |

**Ruido a excluir en ambas cuentas** (matchea el remitente pero no es movimiento):
códigos OTP / validación, `¡Tu afiliación en PEDIDOS YA fue exitosa!`,
`¡Le damos la bienvenida a su billetera digital!`,
`Por tu seguridad, te notificaremos por cada yapeo que realices` (informativo),
`CONSTANCIA DE ENVIO DE OTP APPLE PAY`.

→ **Whitelist por asunto/patrón, nunca blacklist.** Lo no reconocido se ignora y se loguea.

## Trampas identificadas (no negociables)

1. **Rechazo vs consumo**: un regex ingenuo sobre `Monto` crea un gasto falso.
   Gate obligatorio por asunto (`ha sido rechazada`) **y** por
   `no se cargará a su tarjeta`.
2. **Ambos lados de una transferencia**: cuando Christian plinea a Darling, *ambas*
   bandejas reciben correo. Con el modelo simétrico eso es correcto y necesario
   (gasto en un lado, ingreso en el otro, neto 0) — pero **los dos lados tienen que
   estar implementados**, o los números del receptor se inflan. No es doble conteo:
   sería doble conteo solo si el mismo lado se registrara dos veces (lo evita el
   dedupe por `message_id`).
3. **Hilos multi-mensaje**: el hilo de rechazos tenía 5 mensajes; el script reenvía
   todos los mensajes del hilo en cada corrida. **Dedupe por `message_id`
   obligatorio** vía unique constraint + `on conflict do nothing`.
4. **Conversión USD→PEN es aproximada por diseño**: BBVA nunca dice cuántos soles
   cobró; aplica su propia tasa + spread (~1-4% de diferencia). Se guarda el
   original y la tasa usada en la fila para que el usuario corrija el monto.
5. **APIs de tipo de cambio**: frankfurter/ECB **no tienen PEN**. Hay que usar una
   con soporte PEN y sin API key.

## Esquema — `ingest_pendientes`

```sql
create table public.ingest_pendientes (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  message_id            text not null,          -- id de Gmail; dedupe
  banco                 text not null,          -- 'bbva' | 'bcp' | 'yape'

  -- propuesta parseada (todo editable por el usuario antes de confirmar)
  tipo                  text not null,          -- 'gasto' | 'ingreso' | 'liquidacion'
  monto                 numeric not null,       -- ya en PEN
  comercio              text,                   -- la PWA infiere la categoría desde aquí
  fecha                 date not null,
  contraparte           text,                   -- liquidacion: nombre detectado

  -- auditoría de conversión (null si ya venía en PEN)
  monto_original        numeric,
  moneda_original       text,
  tasa_cambio           numeric,

  estado                text not null default 'pendiente',  -- 'pendiente'|'confirmado'|'descartado'
  transaccion_id        uuid references public.transacciones (id) on delete set null,
  raw_subject           text,
  raw_body              text,                   -- para reparse/debug
  created_at            timestamptz not null default now(),
  resolved_at           timestamptz,

  unique (user_id, message_id)                  -- idempotencia
);
```

- RLS por dueño (mismo patrón que `email_ingest_tokens` / `push_subscriptions`).
- Índice parcial en `(user_id) where estado = 'pendiente'` para el badge.
- `raw_body` guarda el correo → permite re-parsear si se corrige el parser sin
  volver a pedirle nada a Gmail.

## Cambios en el Worker

Flujo nuevo tras resolver el token (lo existente no cambia):

1. Detectar banco por `from` + asunto.
2. Rutear al parser correspondiente → `{tipo, monto, moneda, comercio, fecha}` o `null`.
3. `null` (ruido / formato desconocido) → loguear y devolver `200 {ok:true, skipped:true}`.
   **No** etiquetar como error: el script no debe reintentar eternamente.
4. Si `moneda !== 'PEN'` → consultar tasa del **día de la transacción**, convertir,
   guardar `monto_original` / `moneda_original` / `tasa_cambio`.
5. Si es PLIN/Yape y la contraparte matchea a la pareja → `tipo = 'liquidacion'`.
6. `INSERT ... ON CONFLICT (user_id, message_id) DO NOTHING`.

El Worker **no** infiere categoría (ver abajo).

### Detección de pareja

Necesita alias por usuario (el correo dice `a DARLING GABR` / `PLIN-Christian Sanchez`).
`profiles.nombre` existe. Propuesta: columna `ingest_alias text[]` en `profiles`, o
derivar de `profiles.nombre` con normalización (sin tildes, mayúsculas, match por
prefijo del primer nombre + apellido). **Decidir al implementar** — el match por
nombre es frágil por naturaleza; por eso solo *sugiere*, nunca auto-crea.

### Categoría: la sugiere la PWA, NO el Worker

**Decisión revisada (tras leer el código):** el motor de categorización ya existe y
es reutilizable tal cual — `js/autocat.js` (`tokenize` + `matchCategoria`, scoring
determinista sin AI) es exactamente lo que usa el quick-add en `views/transaccion.html`.

Lo decisivo: `autocatLearned()` (`js/nestra-db.js:131`) lee el mapa aprendido desde
**IndexedDB** (store `autocat_tok`), es decir **vive en el dispositivo, no en Supabase**.
El Worker no puede leerlo ni en teoría.

→ El Worker guarda `comercio` y nada más. La vista de revisión calcula la sugerencia
**al renderizar**, con el mismo patrón que ya usa `_ctxPara()` en `views/transaccion.html:1288`:

```js
const ctx = { learned: await autocatLearned(),
              categorias: (await getCategorias(tipo)).map(c => ({id: c.id, nombre: c.nombre})),
              seed: window.NESTRA_SEED };
const sugerida = matchCategoria(tokenize(comercio), ctx);
```

Y al confirmar, llamar `autocatLearnTokens(tokens, categoriaId)` — igual que quick-add.
Beneficio: la sugerencia **mejora sola** con el uso, sin tabla nueva ni cambios en el
Worker, y no se duplica lógica. La "fase 2 de aprendizaje" del plan original queda
cubierta gratis.

`SEED` (`js/autocat.js:66`) ya trae `recarga`/`celular` → Servicios, `restaurante`/`cafe`
→ Comida, `mercado`/`super` → Mercado. Los comercios reales (`ANTHROPIC* CLAUDE`,
`SUPERMERCADO CANDY 3`, `DLC*PedidosYa`) tokenizan razonable; lo que no matchee sale
`null` y el usuario elige (y el sistema lo aprende para la próxima).

## Cambios en la PWA

- **Badge** con el conteo de pendientes (dashboard + nav).
- **Vista de revisión**: lista de tarjetas, cada una con comercio, monto, fecha,
  banco, y para USD el original visible (`USD 20.00 @ 3.72`).
  - Monto: **editable** (corrige la conversión).
  - Categoría: **editable** (selector, pre-llenado con la sugerencia).
  - Ámbito: personal / hogar.
  - Acciones: **Confirmar** → crea la `transaccion` real (o `hogar_liquidaciones` si
    `tipo='liquidacion'`), marca `estado='confirmado'` + `transaccion_id`.
    **Descartar** → `estado='descartado'`.
- Las liquidaciones se muestran distinto: "Darling te devolvió S/ 50 — ¿saldar?"
- Empty state cuando no hay pendientes (patrón de `ui.js` ya existente).

## Fases

1. **Migración** `ingest_pendientes` + RLS + índices. (Aplicar manual en v2.)
2. **Worker**: parsers BBVA + BCP + Yape, whitelist, dedupe, conversión, insert.
   Tests unitarios de los parsers con los cuerpos reales capturados arriba.
3. **PWA**: vista de revisión + badge + confirmar/descartar.
4. **Limpieza previa al arranque**: quitar la etiqueta `nestra-procesado` de ambas
   cuentas para reprocesar el historial que se quemó mientras el Worker solo logueaba
   (ver "Deuda pendiente"). Decidir ventana de historial a importar.
5. **Fase 2 opcional**: memoria comercio→categoría.

## Deuda pendiente / riesgos

- **Correos ya quemados**: el script etiqueta `nestra-procesado` desde antes de que
  existiera el parser. Christian ya tiene ~6 hilos etiquetados que nunca se
  importaron. Antes de activar el parser hay que quitar la etiqueta o esos
  movimientos se pierden en silencio.
- **`newer_than:3d`**: la ventana actual descarta historial. Al activar el parser,
  decidir cuánto historial importar (y recordar que ampliarla sin parser solo quema
  más correos).
- **Formatos que cambien**: si BBVA/BCP cambian el HTML, el parser devuelve `null` y
  el movimiento se ignora en silencio. Mitigación: loguear todo `null` con el asunto
  para poder detectarlo, y considerar una alerta si el ratio de `null` sube.
- **Tasa de cambio**: dependencia externa nueva en el Worker. Si la API falla,
  ¿se encola igual con `monto_original` y sin convertir, o se rechaza? Propuesta:
  encolar con `monto = monto_original`, `tasa_cambio = null`, y que la UI marque
  "conversión falló, corrige el monto".
