-- Fase 5: moneda configurable + flag de onboarding por usuario
alter table public.profiles
  add column if not exists moneda text not null default 'PEN';

alter table public.profiles
  add column if not exists onboarding_completado boolean not null default false;

-- Backfill: los perfiles existentes con datos ya pasaron el onboarding implícito.
-- Evita mostrar el onboarding a usuarios actuales tras desplegar la columna.
update public.profiles p set onboarding_completado = true
where exists (select 1 from public.transacciones t where t.user_id = p.user_id)
   or exists (select 1 from public.categorias c where c.user_id = p.user_id);
