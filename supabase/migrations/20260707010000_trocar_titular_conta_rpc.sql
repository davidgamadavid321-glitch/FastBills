-- RPC transacional para trocar o titular de uma conta.
-- Substitui o fluxo manual em 3 passos (update contas + update/insert
-- contas_titulares) feito hoje no frontend sem garantia atomica.
--
-- Ou atualiza a conta e o historico inteiro, ou nao altera nada.

create or replace function public.trocar_titular_conta(
  p_workspace_id uuid,
  p_conta_id uuid,
  p_novo_titular_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_titular_atual uuid;
  v_hoje date := current_date;
  v_historicos_ativos integer;
  v_alterado boolean;
begin
  if auth.uid() is null then
    raise exception 'Usuario autenticado necessario para trocar titular.';
  end if;

  if not public.usuario_pertence_ao_workspace(p_workspace_id) then
    raise exception 'Usuario nao pertence ao workspace informado.';
  end if;

  select titular_id
    into v_titular_atual
  from public.contas
  where id = p_conta_id
    and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'Conta nao encontrada neste workspace.';
  end if;

  if p_novo_titular_id is not null then
    if not exists (
      select 1
      from public.titulares
      where id = p_novo_titular_id
        and workspace_id = p_workspace_id
    ) then
      raise exception 'Titular nao pertence a este workspace.';
    end if;
  end if;

  select count(*)
    into v_historicos_ativos
  from public.contas_titulares
  where conta_id = p_conta_id
    and workspace_id = p_workspace_id
    and fim is null;

  if v_historicos_ativos > 1 then
    raise exception
      'Existe mais de um historico ativo de titular para esta conta (%). Resolva manualmente antes de trocar o titular.',
      p_conta_id;
  end if;

  v_alterado := p_novo_titular_id is distinct from v_titular_atual;

  if v_alterado then
    update public.contas_titulares
      set fim = v_hoje
      where conta_id = p_conta_id
        and workspace_id = p_workspace_id
        and fim is null;

    update public.contas
      set titular_id = p_novo_titular_id
      where id = p_conta_id
        and workspace_id = p_workspace_id;

    if p_novo_titular_id is not null then
      insert into public.contas_titulares (conta_id, titular_id, inicio, fim, workspace_id)
      values (p_conta_id, p_novo_titular_id, v_hoje, null, p_workspace_id);
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'alterado', v_alterado,
    'conta_id', p_conta_id,
    'titular_id_anterior', v_titular_atual,
    'titular_id_novo', p_novo_titular_id
  );
end;
$$;

revoke all on function public.trocar_titular_conta(uuid, uuid, uuid) from public;
revoke all on function public.trocar_titular_conta(uuid, uuid, uuid) from anon;
revoke all on function public.trocar_titular_conta(uuid, uuid, uuid) from authenticated;
grant execute on function public.trocar_titular_conta(uuid, uuid, uuid) to authenticated;
