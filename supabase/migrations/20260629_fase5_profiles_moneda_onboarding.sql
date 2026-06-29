-- Fase 5: moneda configurable + flag de onboarding por usuario
alter table public.profiles
  add column if not exists moneda text not null default 'PEN';

alter table public.profiles
  add column if not exists onboarding_completado boolean not null default false;
