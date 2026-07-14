-- Corrige bug de fuso horario em trocar_titular_conta: a versao anterior
-- usava current_date (fuso do servidor Postgres, UTC), enquanto o restante
-- do frontend usa localISODate(new Date()) (fuso local do navegador).
-- Em horarios em que o UTC ja virou o dia seguinte mas o horario local
-- (America/Sao_Paulo) ainda nao, a funcao podia gravar um historico com
-- inicio no "dia seguinte" e uma chamada posterior tentar fechar esse
-- historico com fim no "dia local anterior", violando
-- contas_titulares_periodo_check (fim >= inicio) com erro 23514.
--
-- A funcao passa a receber a data de referencia (p_hoje) como parametro,
-- calculada no frontend com localISODate(new Date()). Para nao quebrar
-- chamadas antigas de 3 parametros (frontend ainda nao atualizado em cache
-- do navegador), p_hoje tem um valor padrao baseado no fuso America/Sao_Paulo
-- do lado do banco. Isso mantem uma unica implementacao da regra de negocio
-- (nao ha funcao "antiga" e "nova" coexistindo).

drop function if exists public.trocar_titular_conta(uuid, uuid, uuid);

create or replace function public.trocar_titular_conta(
  p_workspace_id uuid,
  p_conta_id uuid,
  p_novo_titular_id uuid,
  p_hoje date default (now() at time zone 'America/Sao_Paulo')::date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_titular_atual uuid;
  v_historicos_ativos integer;
  v_alterado boolean;
begin
  if p_hoje is null then
    raise exception 'Data de referencia (p_hoje) e obrigatoria.';
  end if;

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
      set fim = p_hoje
      where conta_id = p_conta_id
        and workspace_id = p_workspace_id
        and fim is null;

    update public.contas
      set titular_id = p_novo_titular_id
      where id = p_conta_id
        and workspace_id = p_workspace_id;

    if p_novo_titular_id is not null then
      insert into public.contas_titulares (conta_id, titular_id, inicio, fim, workspace_id)
      values (p_conta_id, p_novo_titular_id, p_hoje, null, p_workspace_id);
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

revoke all on function public.trocar_titular_conta(uuid, uuid, uuid, date) from public;
revoke all on function public.trocar_titular_conta(uuid, uuid, uuid, date) from anon;
revoke all on function public.trocar_titular_conta(uuid, uuid, uuid, date) from authenticated;
grant execute on function public.trocar_titular_conta(uuid, uuid, uuid, date) to authenticated;
