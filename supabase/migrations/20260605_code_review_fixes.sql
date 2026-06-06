-- =====================================================================
-- Nestra — Migración: correcciones de code review sobre el schema base
-- ---------------------------------------------------------------------
-- Aplica los cambios #1 (RLS por comando), #2 (índices FK) y #3 (CHECKs)
-- SIN borrar datos. Idempotente: se puede re-ejecutar sin error.
-- Ejecutar en el SQL Editor de Supabase.
-- NOTA: si ya hay filas con monto <= 0 o monto_objetivo <= 0, los CHECK
-- fallarán; corrige esos datos antes de correr esta migración.
-- =====================================================================

-- ---- #3 CHECK constraints -------------------------------------------
alter table public.transacciones drop constraint if exists transacciones_monto_check;
alter table public.transacciones add  constraint transacciones_monto_check check (monto > 0);

alter table public.metas drop constraint if exists metas_monto_objetivo_check;
alter table public.metas add  constraint metas_monto_objetivo_check check (monto_objetivo > 0);

alter table public.metas drop constraint if exists metas_monto_actual_check;
alter table public.metas add  constraint metas_monto_actual_check check (monto_actual >= 0);

-- ---- #2 Índices de claves foráneas ----------------------------------
create index if not exists idx_transacciones_user_id      on public.transacciones (user_id);
create index if not exists idx_transacciones_categoria_id on public.transacciones (categoria_id);
create index if not exists idx_transacciones_fecha        on public.transacciones (fecha);
create index if not exists idx_transacciones_aporte_id    on public.transacciones (aporte_id);
create index if not exists idx_prestamos_transaccion_id   on public.prestamos (transaccion_id);
create index if not exists idx_metas_user_id              on public.metas (user_id);
create index if not exists idx_desafios_user_id           on public.desafios (user_id);
create index if not exists idx_desafios_categoria_id      on public.desafios (categoria_id);

-- ---- #1 Políticas RLS por comando -----------------------------------
-- Quitar las políticas FOR ALL antiguas
drop policy if exists "transacciones_acceso" on public.transacciones;
drop policy if exists "metas_acceso"         on public.metas;
drop policy if exists "desafios_acceso"      on public.desafios;

-- Limpiar las nuevas (por si la migración se re-ejecuta)
drop policy if exists "transacciones_select" on public.transacciones;
drop policy if exists "transacciones_insert" on public.transacciones;
drop policy if exists "transacciones_update" on public.transacciones;
drop policy if exists "transacciones_delete" on public.transacciones;
drop policy if exists "metas_select"    on public.metas;
drop policy if exists "metas_insert"    on public.metas;
drop policy if exists "metas_update"    on public.metas;
drop policy if exists "metas_delete"    on public.metas;
drop policy if exists "desafios_select" on public.desafios;
drop policy if exists "desafios_insert" on public.desafios;
drop policy if exists "desafios_update" on public.desafios;
drop policy if exists "desafios_delete" on public.desafios;

-- transacciones: hogar compartido o propias; inserción atribuida al autor
create policy "transacciones_select" on public.transacciones for select to authenticated
  using (ambito = 'hogar' or auth.uid() = user_id);
create policy "transacciones_insert" on public.transacciones for insert to authenticated
  with check (auth.uid() = user_id);
create policy "transacciones_update" on public.transacciones for update to authenticated
  using (ambito = 'hogar' or auth.uid() = user_id)
  with check (ambito = 'hogar' or auth.uid() = user_id);
create policy "transacciones_delete" on public.transacciones for delete to authenticated
  using (ambito = 'hogar' or auth.uid() = user_id);

-- metas: hogar ⇒ user_id nulo; personal ⇒ propia
create policy "metas_select" on public.metas for select to authenticated
  using (ambito = 'hogar' or auth.uid() = user_id);
create policy "metas_insert" on public.metas for insert to authenticated
  with check ((ambito = 'hogar' and user_id is null) or (ambito = 'personal' and auth.uid() = user_id));
create policy "metas_update" on public.metas for update to authenticated
  using (ambito = 'hogar' or auth.uid() = user_id)
  with check ((ambito = 'hogar' and user_id is null) or (ambito = 'personal' and auth.uid() = user_id));
create policy "metas_delete" on public.metas for delete to authenticated
  using (ambito = 'hogar' or auth.uid() = user_id);

-- desafios: misma lógica que metas
create policy "desafios_select" on public.desafios for select to authenticated
  using (ambito = 'hogar' or auth.uid() = user_id);
create policy "desafios_insert" on public.desafios for insert to authenticated
  with check ((ambito = 'hogar' and user_id is null) or (ambito = 'personal' and auth.uid() = user_id));
create policy "desafios_update" on public.desafios for update to authenticated
  using (ambito = 'hogar' or auth.uid() = user_id)
  with check ((ambito = 'hogar' and user_id is null) or (ambito = 'personal' and auth.uid() = user_id));
create policy "desafios_delete" on public.desafios for delete to authenticated
  using (ambito = 'hogar' or auth.uid() = user_id);
