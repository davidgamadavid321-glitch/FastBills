create or replace function public.preencher_workspace_id_temporario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

  if auth.role() = 'service_role' then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Usuário autenticado necessário para informar workspace_id';
  end if;

  if not public.usuario_pertence_ao_workspace(new.workspace_id) then
    raise exception 'Usuário não pertence ao workspace informado';
  end if;

  return new;
end;
$$;

revoke all on function public.preencher_workspace_id_temporario() from public;
revoke all on function public.preencher_workspace_id_temporario() from anon;
revoke all on function public.preencher_workspace_id_temporario() from authenticated;
