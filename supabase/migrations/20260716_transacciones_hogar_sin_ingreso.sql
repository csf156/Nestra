-- Tanda 1 (#5): el ámbito hogar solo registra gasto y ahorro.
-- Un ingreso es siempre personal: entra al bolsillo de una persona, no al
-- hogar. El cliente ya lo impide en el form (views/transaccion.html) y en los
-- filtros de historial (views/historial.html), pero sin esta constraint
-- cualquier insert por API puede violarlo — incluido el Worker de ingesta de
-- correos bancarios, que escribe con service-role y salta la RLS.
--
-- El trigger sync_hogar_id() ya valida que quien marca ambito='hogar'
-- pertenezca a un hogar, pero NO valida el tipo; esto lo complementa.
--
-- Verificado por introspección antes de aplicar: 0 filas en ese estado, así
-- que la constraint entra sin migrar ni corregir datos.
alter table public.transacciones
  add constraint transacciones_hogar_sin_ingreso
  check (not (ambito = 'hogar' and tipo = 'ingreso'));
