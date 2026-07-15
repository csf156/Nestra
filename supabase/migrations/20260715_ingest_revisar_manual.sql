-- =====================================================================
-- Nestra — Migración: estado 'revisar-manual' en ingest_pendientes
-- ---------------------------------------------------------------------
-- NO APLICADA. Revisar antes de aplicar con apply_migration.
--
-- Un correo de remitente bancario cuyo formato el parser no reconoce
-- (FormatoNoReconocidoError) se encola SIN campos parseados: el usuario lo
-- triagea desde la PWA (completa monto/tipo/fecha o descarta) usando
-- raw_subject / raw_body. Antes ese correo se ignoraba con un log; ahora el
-- movimiento no se pierde.
--
-- Para eso tipo/monto/fecha pasan a ser NULLables, con un check que exige
-- que estén completos en cualquier estado que no sea 'revisar-manual'.
-- Los checks existentes de tipo/monto ya toleran NULL (CHECK con NULL pasa);
-- solo cambia el check de estado y los NOT NULL.
--
-- Idempotente: drop if exists / condicionales.
-- =====================================================================

alter table public.ingest_pendientes
  alter column tipo  drop not null,
  alter column monto drop not null,
  alter column fecha drop not null;

alter table public.ingest_pendientes
  drop constraint if exists ingest_pendientes_estado_check;

alter table public.ingest_pendientes
  add constraint ingest_pendientes_estado_check
  check (estado in ('pendiente', 'confirmado', 'descartado', 'revisar-manual'));

-- La propuesta debe estar completa solo donde se usa: 'pendiente' (el Worker
-- la parseó entera) y 'confirmado' (la PWA escribe de vuelta los campos
-- editados al confirmar). 'revisar-manual' llega sin campos y descartarla no
-- exige completar nada. (Ajustado en la migración ingest_descartar_manual_fix
-- tras verificar en preview que descartar un revisar-manual violaba el check.)
alter table public.ingest_pendientes
  drop constraint if exists ingest_pendientes_propuesta_completa;

alter table public.ingest_pendientes
  add constraint ingest_pendientes_propuesta_completa
  check (
    estado in ('revisar-manual', 'descartado')
    or (tipo is not null and monto is not null and fecha is not null)
  );

-- El badge y la vista de revisión también deben listar los 'revisar-manual'.
drop index if exists idx_ingest_pendientes_user_pendiente;
create index idx_ingest_pendientes_user_pendiente
  on public.ingest_pendientes (user_id, created_at desc)
  where estado in ('pendiente', 'revisar-manual');
