-- Optimización RLS: envolver auth.uid() en (select auth.uid()) para que se
-- evalúe una sola vez por query y no por fila (advisor: auth_rls_initplan).

-- profiles
drop policy if exists "profiles_insert_propio" on public.profiles;
drop policy if exists "profiles_update_propio" on public.profiles;
create policy "profiles_insert_propio" on public.profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "profiles_update_propio" on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- transacciones
drop policy if exists "transacciones_select" on public.transacciones;
drop policy if exists "transacciones_insert" on public.transacciones;
drop policy if exists "transacciones_update" on public.transacciones;
drop policy if exists "transacciones_delete" on public.transacciones;
create policy "transacciones_select" on public.transacciones for select to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id);
create policy "transacciones_insert" on public.transacciones for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "transacciones_update" on public.transacciones for update to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id)
  with check (ambito = 'hogar' or (select auth.uid()) = user_id);
create policy "transacciones_delete" on public.transacciones for delete to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id);

-- prestamos
drop policy if exists "prestamos_acceso" on public.prestamos;
create policy "prestamos_acceso" on public.prestamos for all to authenticated
  using (exists (select 1 from public.transacciones t where t.id = prestamos.transaccion_id and (t.ambito = 'hogar' or (select auth.uid()) = t.user_id)))
  with check (exists (select 1 from public.transacciones t where t.id = prestamos.transaccion_id and (t.ambito = 'hogar' or (select auth.uid()) = t.user_id)));

-- metas
drop policy if exists "metas_select" on public.metas;
drop policy if exists "metas_insert" on public.metas;
drop policy if exists "metas_update" on public.metas;
drop policy if exists "metas_delete" on public.metas;
create policy "metas_select" on public.metas for select to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id);
create policy "metas_insert" on public.metas for insert to authenticated
  with check ((ambito = 'hogar' and user_id is null) or (ambito = 'personal' and (select auth.uid()) = user_id));
create policy "metas_update" on public.metas for update to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id)
  with check ((ambito = 'hogar' and user_id is null) or (ambito = 'personal' and (select auth.uid()) = user_id));
create policy "metas_delete" on public.metas for delete to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id);

-- desafios
drop policy if exists "desafios_select" on public.desafios;
drop policy if exists "desafios_insert" on public.desafios;
drop policy if exists "desafios_update" on public.desafios;
drop policy if exists "desafios_delete" on public.desafios;
create policy "desafios_select" on public.desafios for select to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id);
create policy "desafios_insert" on public.desafios for insert to authenticated
  with check ((ambito = 'hogar' and user_id is null) or (ambito = 'personal' and (select auth.uid()) = user_id));
create policy "desafios_update" on public.desafios for update to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id)
  with check ((ambito = 'hogar' and user_id is null) or (ambito = 'personal' and (select auth.uid()) = user_id));
create policy "desafios_delete" on public.desafios for delete to authenticated
  using (ambito = 'hogar' or (select auth.uid()) = user_id);
