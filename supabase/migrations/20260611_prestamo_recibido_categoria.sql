-- Migration: add 'Préstamo recibido' ingreso category for "me prestaron" loans
insert into public.categorias (nombre, tipo)
select 'Préstamo recibido', 'ingreso'
where not exists (
  select 1 from public.categorias where nombre = 'Préstamo recibido' and tipo = 'ingreso'
);
