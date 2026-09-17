-- A geracao de lancamentos recorrentes e uma operacao administrativa.
-- Mantem o caminho interno/service_role usado pelo cron, mas impede que um
-- member contorne a policy de INSERT de lancamentos chamando a RPC diretamente.

create or replace function public.garantir_competencia_recorrente(
  p_workspace_id uuid,
  p_ano integer,
  p_mes integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_inicio_mes date;
  v_inseridos integer := 0;
begin
  if p_workspace_id is null or p_mes not between 1 and 12 then
    raise exception 'Workspace, ano e mes validos sao obrigatorios.';
  end if;

  if auth.uid() is not null then
    if not public.usuario_administra_workspace(p_workspace_id) then
      raise exception 'Somente administradores podem gerar a competencia.';
    end if;
  elsif coalesce(auth.role(), '') <> 'service_role' and session_user <> current_user then
    raise exception 'Usuario autenticado necessario para gerar a competencia.';
  end if;

  v_inicio_mes := make_date(p_ano, p_mes, 1);

  if auth.uid() is not null
     and v_inicio_mes > (date_trunc('month', v_hoje) + interval '36 months')::date then
    raise exception 'Competencia fora da janela disponivel para consulta.';
  end if;

  if v_inicio_mes < date_trunc('month', v_hoje)::date then
    return jsonb_build_object('inseridos', 0, 'competencia', v_inicio_mes);
  end if;

  insert into public.lancamentos (
    conta_id,
    titular_id,
    valor,
    vencimento,
    status,
    workspace_id
  )
  select
    c.id,
    c.titular_id,
    coalesce(c.valor_referencia, 0),
    public.data_vencimento_no_mes(p_ano, p_mes, c.dia_vencimento),
    case
      when public.data_vencimento_no_mes(p_ano, p_mes, c.dia_vencimento) < v_hoje
        then 'vencido'
      else 'pendente'
    end,
    c.workspace_id
  from public.contas c
  where c.workspace_id = p_workspace_id
    and c.status_contrato = 'ativo'
    and c.dia_vencimento between 1 and 31
    and (
      c.recorrencia = 'mensal'
      or (c.recorrencia = 'anual' and c.mes_vencimento = p_mes)
    )
  on conflict (workspace_id, conta_id, vencimento)
    where conta_id is not null
    do nothing;

  get diagnostics v_inseridos = row_count;

  return jsonb_build_object(
    'inseridos', v_inseridos,
    'competencia', v_inicio_mes
  );
end;
$$;

revoke all on function public.garantir_competencia_recorrente(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.garantir_competencia_recorrente(uuid, integer, integer)
  to authenticated;
grant execute on function public.garantir_competencia_recorrente(uuid, integer, integer)
  to service_role;
