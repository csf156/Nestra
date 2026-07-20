-- El progreso de las metas de HOGAR solo mostraba los aportes del usuario que
-- consulta, no el total del hogar. Causa: metas_con_progreso es security_invoker
-- y la RLS de aportes_meta (aportes_meta_acceso, cmd ALL, auth.uid()=user_id)
-- filtra el LEFT JOIN a solo los aportes propios. Una meta de hogar acumula
-- aportes de 2 usuarios, así que cada miembro veía su fracción. Es un bug de
-- VISUALIZACIÓN; distribuir_ahorro reparte correcto y NO se toca aquí.
--
-- Fix: partir la policy única ALL en policies por comando. SELECT amplía a los
-- aportes de metas de hogar compartidas (espeja metas_select: propio OR del
-- hogar, vía auth_hogar_id()). INSERT/UPDATE/DELETE siguen restringidos al
-- dueño (auth.uid()=user_id): un usuario no puede crear/editar/borrar aportes
-- atribuidos a otro. auth_hogar_id() ya existe (STABLE SECURITY DEFINER).

drop policy if exists aportes_meta_acceso on public.aportes_meta;

create policy aportes_meta_select on public.aportes_meta
  for select using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.metas m
      where m.id = aportes_meta.meta_id
        and m.ambito = 'hogar'
        and m.hogar_id = public.auth_hogar_id()
    )
  );

create policy aportes_meta_insert on public.aportes_meta
  for insert with check ((select auth.uid()) = user_id);

create policy aportes_meta_update on public.aportes_meta
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy aportes_meta_delete on public.aportes_meta
  for delete using ((select auth.uid()) = user_id);
