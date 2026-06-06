-- Endurecimiento: handle_new_user() solo debe correr vía trigger, no como
-- RPC pública (advisor: anon/authenticated_security_definer_function_executable).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
