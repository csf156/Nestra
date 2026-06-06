-- =====================================================================
-- Nestra — Fix: permisos de lectura sobre la vista metas_con_progreso
-- ---------------------------------------------------------------------
-- Una VISTA nueva NO hereda los GRANT de sus tablas base. Sin un
-- GRANT SELECT explícito al rol `authenticated`, PostgREST responde
-- "permission denied for view metas_con_progreso" y getMetas() devuelve
-- [] (cae a su catch) → el dashboard no muestra ninguna meta.
--
-- La vista usa security_invoker = true, así que las políticas RLS de las
-- tablas base (metas, aportes_meta) siguen aplicándose por usuario; el
-- GRANT solo habilita el acceso de la vista, no relaja la privacidad.
--
-- Idempotente: GRANT es repetible sin error.
-- =====================================================================

grant select on public.metas_con_progreso to authenticated;

-- aportes_meta se consulta directo desde db.js (getAportesDeMeta,
-- getAporteMetaMes); asegurar también su lectura para authenticated.
grant select on public.aportes_meta to authenticated;

-- Refrescar el cache de esquema de PostgREST para exponer los cambios.
notify pgrst, 'reload schema';
