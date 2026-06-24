-- Fase 3: captura excepcional — split, recibo, plantillas, bucket recibos.

-- 1. transacciones: split_id + recibo_path
alter table public.transacciones add column if not exists split_id    uuid;
alter table public.transacciones add column if not exists recibo_path text;
create index if not exists idx_transacciones_split_id on public.transacciones (split_id);

-- 2. plantillas
create table if not exists public.plantillas (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  nombre       text not null,
  monto        numeric(10,2) not null check (monto > 0),
  categoria_id uuid references public.categorias (id) on delete cascade,
  tipo         text not null default 'gasto' check (tipo in ('gasto','ingreso','ahorro')),
  ambito       text not null default 'personal' check (ambito in ('personal','hogar')),
  orden        int  not null default 0,
  updated_at   timestamptz not null default now()
);
create index if not exists idx_plantillas_user_id on public.plantillas (user_id);

alter table public.plantillas enable row level security;
create policy "plantillas_select" on public.plantillas for select to authenticated
  using (user_id = (select auth.uid()));
create policy "plantillas_insert" on public.plantillas for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "plantillas_update" on public.plantillas for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "plantillas_delete" on public.plantillas for delete to authenticated
  using (user_id = (select auth.uid()));

drop trigger if exists trg_plantillas_updated_at on public.plantillas;
create trigger trg_plantillas_updated_at before update on public.plantillas
  for each row execute function public.set_updated_at();

-- 3. bucket privado recibos
insert into storage.buckets (id, name, public)
values ('recibos', 'recibos', false)
on conflict (id) do nothing;

create policy "recibos_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'recibos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "recibos_select" on storage.objects for select to authenticated
  using (bucket_id = 'recibos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "recibos_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'recibos' and (storage.foldername(name))[1] = (select auth.uid())::text);
