-- =====================================================================
-- Nestra — Migración: cola de revisión de ingesta de correos bancarios
-- ---------------------------------------------------------------------
-- Una fila por correo bancario parseado. El Worker NO crea transacciones
-- directamente: propone, y el usuario confirma/corrige desde la PWA.
--
-- Por qué cola y no inserción directa: el parser no puede saber (a) la
-- categoría del comercio, (b) el monto exacto en PEN de un consumo en USD
-- (el banco aplica su propia tasa + spread y nunca la informa en el correo).
--
-- Modelo simétrico: una transferencia es gasto para quien la envía e ingreso
-- para quien la recibe, sin importar el motivo. No hay tipo 'liquidacion':
-- `hogar_liquidaciones` es para saldar el split de gastos con ambito='hogar',
-- mecanismo que hoy no se usa (0 gastos de hogar, 0 liquidaciones).
--
-- La categoría NO se guarda aquí: la infiere la PWA al renderizar con
-- js/autocat.js, cuyo mapa aprendido vive en IndexedDB (por dispositivo),
-- inalcanzable para el Worker.
--
-- RLS estricta por dueño. El Worker usa service-role (salta RLS).
-- Idempotente: if not exists / drop if exists.
-- =====================================================================

create table if not exists public.ingest_pendientes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  message_id      text not null,          -- id del mensaje en Gmail
  banco           text not null check (banco in ('bbva', 'bcp', 'yape')),

  -- Propuesta parseada. Todo editable por el usuario antes de confirmar.
  -- 'ahorro' = traslado entre cuentas propias (ej. yapeo de la cuenta común a
  -- la de ahorros en otro banco): no es gasto, la plata sigue siendo del
  -- usuario. Mismos tipos que public.transacciones, donde además 'ahorro' es
  -- el único que no exige categoria_id.
  tipo            text not null check (tipo in ('gasto', 'ingreso', 'ahorro')),
  monto           numeric not null check (monto > 0),   -- ya convertido a PEN
  comercio        text,                                  -- la PWA infiere categoría de aquí
  fecha           date not null,
  contraparte     text,                                  -- persona/destino de la operación

  -- Auditoría de conversión de divisa. Null si el correo ya venía en PEN.
  -- tasa_cambio null + moneda_original no null => la conversión falló y
  -- `monto` quedó en la moneda original: la UI debe pedir corrección.
  monto_original  numeric,
  moneda_original text,
  tasa_cambio     numeric,

  estado          text not null default 'pendiente'
                    check (estado in ('pendiente', 'confirmado', 'descartado')),
  transaccion_id  uuid references public.transacciones (id) on delete set null,

  -- Correo crudo: permite re-parsear si se corrige el parser, sin volver
  -- a pedirle nada a Gmail (el hilo ya quedó etiquetado como procesado).
  raw_subject     text,
  raw_body        text,

  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,

  -- Idempotencia: el script de Apps Script reenvía todos los mensajes de
  -- un hilo en cada corrida.
  unique (user_id, message_id)
);

-- Badge de pendientes + listado de la vista de revisión.
create index if not exists idx_ingest_pendientes_user_pendiente
  on public.ingest_pendientes (user_id, fecha desc)
  where estado = 'pendiente';

alter table public.ingest_pendientes enable row level security;

-- El dueño ve y resuelve sus propios pendientes. El Worker (service-role)
-- salta RLS para insertar.
drop policy if exists "ingest_pendientes_acceso" on public.ingest_pendientes;
create policy "ingest_pendientes_acceso"
  on public.ingest_pendientes for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
