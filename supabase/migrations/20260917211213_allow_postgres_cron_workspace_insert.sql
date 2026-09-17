create or replace function public.preencher_workspace_id_temporario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.workspace_id is distinct from old.workspace_id then
      raise exception 'Não é permitido alterar workspace_id';
    end if;

    return new;
  end if;

  if tg_op <> 'INSERT' then
    return new;
  end if;

  if new.workspace_id is null then
    raise exception 'workspace_id é obrigatório';
  end if;

  -- Chamadas server-side com service_role continuam permitidas.
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Permite processos internos do PostgreSQL, como o pg_cron.
  -- Usamos session_user porque a função é SECURITY DEFINER.
  if session_user = 'postgres' then
    return new;
  end if;

  -- Chamadas normais da aplicação precisam ter usuário autenticado.
  if auth.uid() is null then
    raise exception 'Usuário autenticado necessário para informar workspace_id';
  end if;

  if not public.usuario_pertence_ao_workspace(new.workspace_id) then
    raise exception 'Usuário não pertence ao workspace informado';
  end if;

  return new;
end;
$function$;