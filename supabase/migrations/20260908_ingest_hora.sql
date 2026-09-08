-- Hora del movimiento. `ingest_pendientes.fecha` es de tipo `date` y pierde la
-- hora, que sí viene en el cuerpo del correo. Sin ella la cola no puede ordenar
-- ni agrupar por momento del día, que es como el usuario recuerda sus gastos.
--
-- Idempotente: `add column if not exists` + el UPDATE solo toca filas con
-- `hora` nula. Correrla dos veces no cambia nada la segunda.
alter table public.ingest_pendientes add column if not exists hora time;

-- Relleno retroactivo. Tres patrones, en orden de preferencia, validados
-- contra las 312 filas reales el 2026-09-08 (cobertura 303 = 97,1%; las 9
-- restantes no traen hora en el correo):
--
--   1. "Fecha y hora: 3 de agosto, 2026 14:04"  (BBVA consumo)
--      "Fecha y Hora de la operación 30 agosto 2026 - 11:39"  (Yape saliente)
--      "Fecha y hora \n*18 de agosto de 2026, 11:51:32*"  (BBVA Apartado)
--      No-greedy tras la etiqueta: salta la fecha y coge el primer HH:MM.
--   2. "Hora:\n\n14:49:05"  y  "Hora\n*07:23:50*"  (BBVA QR / anulada)
--      La etiqueta puede venir sin dos puntos y el valor entre asteriscos.
--   3. "Fecha:\n\n30 ago. 2026 - 10:29 a. m."  (Yape recarga)
--      Aquí la etiqueta es Fecha, y la hora va tras el guion.
--
-- OJO con las tildes: `raw_body` las conserva ("operación"). El Worker
-- normaliza acentos antes de parsear, pero esta consulta lee el cuerpo crudo.
-- Un patrón escrito sin tilde falla en silencio — pasó al escribir el plan.
--
-- Validación del regex, no solo de la cobertura: con estas horas, el retardo
-- entre el pago y la ingesta da entre 0,5 y 10,5 minutos en las 303 filas, sin
-- un solo valor fuera de rango. Un patrón que capturara el número equivocado
-- habría producido retardos absurdos.
update public.ingest_pendientes set hora = sub.hhmm::time
from (
  select id,
    coalesce(
      (regexp_match(raw_body, '[Ff]echa y [Hh]ora.{0,60}?([0-9]{1,2}:[0-9]{2})'))[1],
      (regexp_match(raw_body, '[Hh]ora[^0-9]{0,12}([0-9]{1,2}:[0-9]{2})'))[1],
      (regexp_match(raw_body, '[Ff]echa[^0-9]{0,15}[0-9]{1,2}[^0-9]{1,15}[0-9]{4}\s*-\s*([0-9]{1,2}:[0-9]{2})'))[1]
    ) hhmm
  from public.ingest_pendientes
) sub
where sub.id = public.ingest_pendientes.id
  and sub.hhmm is not null
  and public.ingest_pendientes.hora is null;
