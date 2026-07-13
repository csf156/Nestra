-- =====================================================================
-- Nestra — Fix: categorías compartidas editables por el hogar
-- ---------------------------------------------------------------------
-- fase0 (20260618) hizo categorias owner-scoped y dejó las semillas como
-- "system rows" (user_id IS NULL). Sus políticas UPDATE/DELETE exigían
-- auth.uid()=user_id, así que las semillas (user_id NULL) no matcheaban y
-- editar su límite/nombre/ícono fallaba con PGRST116 (0 filas).
--
-- Decisión de producto: las categorías compartidas (user_id IS NULL) son
-- del hogar y cualquier miembro autenticado puede editarlas/borrarlas,
-- además de las propias. Coincide con la intención original (schema.sql
-- las documentaba como compartidas read+write).
--
-- Idempotente: drop policy if exists / create. Ejecutar en SQL Editor.
-- =====================================================================

drop policy if exists "categorias_update" on public.categorias;
create policy "categorias_update" on public.categorias for update
  to authenticated
  using      (user_id is null or (select auth.uid()) = user_id)
  with check (user_id is null or (select auth.uid()) = user_id);

drop policy if exists "categorias_delete" on public.categorias;
create policy "categorias_delete" on public.categorias for delete
  to authenticated
  using (user_id is null or (select auth.uid()) = user_id);
