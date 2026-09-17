-- Estende a reconciliacao de recorrencia (BUG-06) para cobrir transicoes
-- envolvendo 'uma_vez', com a mesma filosofia ja aprovada para mensal <-> anual:
-- preserva passado e pagos, remove apenas futuros nao pagos da serie antiga,
-- recria automaticamente a nova serie/lancamento aplicavel. Tudo dentro da
-- mesma transacao/funcao ja existente (sem exception handler que engula erro),
-- entao qualquer falha no meio desfaz tudo (conta + lancamentos).
--
-- A data do lancamento unico de 'uma_vez' NUNCA e' escolhida silenciosamente
-- pelo sistema (ex.: "proxima ocorrencia do dia"). Ela vem explicitamente do
-- usuario via p_data_vencimento_unica (campo "Data de vencimento" no
-- formulario, no lugar do campo "Dia de vencimento" quando a recorrencia
-- selecionada e' 'uma_vez').

drop function if exists public.atualizar_conta_com_vencimentos(uuid, uuid, text, uuid, uuid, uuid, text, integer, integer, numeric, text, date);

create or replace function public.atualizar_conta_com_vencimentos(
  p_workspace_id uuid,
  p_conta_id uuid,
  p_nome text,
  p_categoria_id uuid,
  p_centro_id uuid,
  p_titular_id uuid,
  p_recorrencia text,
  p_dia_vencimento integer,
  p_mes_vencimento integer,
  p_valor_referencia numeric,
  p_status_contrato text,
  p_hoje date,
  p_data_vencimento_unica date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conta public.contas%rowtype;
  v_ids_atualizados uuid[] := array[]::uuid[];
  v_excluidos integer := 0;
  v_inseridos integer := 0;
  v_linhas integer := 0;
  v_indice integer;
  v_data date;
  v_base date;
  v_dia_efetivo integer;
  v_mes_efetivo integer;
begin
  if auth.uid() is null then
    raise exception 'Usuario autenticado necessario para atualizar conta.';
  end if;

  if p_workspace_id is null or not public.usuario_administra_workspace(p_workspace_id) then
    raise exception 'Somente administradores podem atualizar contas.';
  end if;

  select * into v_conta
  from public.contas
  where id = p_conta_id and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'Conta nao encontrada neste workspace.';
  end if;

  if p_recorrencia = 'uma_vez' then
    if p_data_vencimento_unica is not null then
      if p_data_vencimento_unica < p_hoje then
        raise exception 'A data do lancamento unico deve ser hoje ou uma data futura.';
      end if;
      v_dia_efetivo := extract(day from p_data_vencimento_unica)::integer;
      v_mes_efetivo := extract(month from p_data_vencimento_unica)::integer;
    else
      -- Edicao de uma conta que ja era 'uma_vez' e nao tem lancamento
      -- pendente/futuro para reconciliar (ex.: unico lancamento ja pago).
      -- Nada a agendar: mantem o dia/mes ja gravados na conta.
      v_dia_efetivo := v_conta.dia_vencimento;
      v_mes_efetivo := v_conta.mes_vencimento;
    end if;
  else
    v_dia_efetivo := p_dia_vencimento;
    v_mes_efetivo := p_mes_vencimento;
  end if;

  update public.contas
  set nome = nullif(btrim(p_nome), ''),
      categoria_id = p_categoria_id,
      centro_id = p_centro_id,
      recorrencia = p_recorrencia,
      dia_vencimento = v_dia_efetivo,
      mes_vencimento = v_mes_efetivo,
      valor_referencia = p_valor_referencia,
      status_contrato = p_status_contrato
  where id = p_conta_id and workspace_id = p_workspace_id;

  if v_conta.recorrencia = p_recorrencia
     and p_recorrencia in ('mensal', 'anual')
     and (
       v_conta.dia_vencimento is distinct from v_dia_efetivo
       or (p_recorrencia = 'anual' and v_conta.mes_vencimento is distinct from v_mes_efetivo)
     ) then
    -- Mesma recorrencia, dia (ou mes) mudou: reconcilia so os futuros nao pagos
    -- para a nova data dentro do mesmo tipo de serie.
    with elegiveis as (
      select
        l.id,
        public.data_vencimento_no_mes(
          extract(year from l.vencimento)::integer,
          case when p_recorrencia = 'anual'
            then v_mes_efetivo
            else extract(month from l.vencimento)::integer
          end,
          v_dia_efetivo
        ) as novo_vencimento
      from public.lancamentos l
      where l.conta_id = p_conta_id
        and l.workspace_id = p_workspace_id
        and l.status <> 'pago'
        and l.vencimento >= p_hoje
      for update
    ), atualizados as (
      update public.lancamentos l
      set vencimento = e.novo_vencimento
      from elegiveis e
      where l.id = e.id
        and e.novo_vencimento >= p_hoje
        and e.novo_vencimento <> l.vencimento
      returning l.id
    )
    select coalesce(array_agg(id), array[]::uuid[])
    into v_ids_atualizados
    from atualizados;

  elsif v_conta.recorrencia in ('mensal', 'anual', 'uma_vez')
        and p_recorrencia in ('mensal', 'anual', 'uma_vez')
        and v_conta.recorrencia <> p_recorrencia then
    -- Troca de tipo de recorrencia (mensal<->anual<->uma_vez): preserva passado
    -- e pagos, remove os futuros nao pagos da serie antiga e recria
    -- automaticamente a serie (ou o lancamento unico) da nova recorrencia.
    delete from public.lancamentos
    where conta_id = p_conta_id
      and workspace_id = p_workspace_id
      and status <> 'pago'
      and vencimento >= p_hoje;
    get diagnostics v_excluidos = row_count;

    if p_status_contrato = 'ativo' and p_recorrencia = 'mensal' then
      v_base := date_trunc('month', p_hoje)::date;
      if public.data_vencimento_no_mes(
        extract(year from v_base)::integer,
        extract(month from v_base)::integer,
        v_dia_efetivo
      ) < p_hoje then
        v_base := (v_base + interval '1 month')::date;
      end if;

      for v_indice in 0..11 loop
        v_data := public.data_vencimento_no_mes(
          extract(year from (v_base + make_interval(months => v_indice)))::integer,
          extract(month from (v_base + make_interval(months => v_indice)))::integer,
          v_dia_efetivo
        );
        insert into public.lancamentos (
          conta_id, titular_id, valor, vencimento, status, workspace_id
        ) values (
          p_conta_id, p_titular_id, coalesce(p_valor_referencia, 0),
          v_data, 'pendente', p_workspace_id
        ) on conflict (workspace_id, conta_id, vencimento)
          where conta_id is not null
          do nothing;
        get diagnostics v_linhas = row_count;
        v_inseridos := v_inseridos + v_linhas;
      end loop;

    elsif p_status_contrato = 'ativo' and p_recorrencia = 'anual' then
      v_base := make_date(extract(year from p_hoje)::integer, v_mes_efetivo, 1);
      if public.data_vencimento_no_mes(
        extract(year from v_base)::integer,
        v_mes_efetivo,
        v_dia_efetivo
      ) < p_hoje then
        v_base := (v_base + interval '1 year')::date;
      end if;

      for v_indice in 0..5 loop
        v_data := public.data_vencimento_no_mes(
          extract(year from v_base)::integer + v_indice,
          v_mes_efetivo,
          v_dia_efetivo
        );
        insert into public.lancamentos (
          conta_id, titular_id, valor, vencimento, status, workspace_id
        ) values (
          p_conta_id, p_titular_id, coalesce(p_valor_referencia, 0),
          v_data, 'pendente', p_workspace_id
        ) on conflict (workspace_id, conta_id, vencimento)
          where conta_id is not null
          do nothing;
        get diagnostics v_linhas = row_count;
        v_inseridos := v_inseridos + v_linhas;
      end loop;

    elsif p_status_contrato = 'ativo' and p_recorrencia = 'uma_vez' then
      -- Data exata informada pelo usuario (sem adivinhar mes/dia). Validada
      -- (>= p_hoje) logo no inicio da funcao quando presente.
      if p_data_vencimento_unica is null then
        raise exception 'Informe a data de vencimento do lancamento unico.';
      end if;

      insert into public.lancamentos (
        conta_id, titular_id, valor, vencimento, status, workspace_id
      ) values (
        p_conta_id, p_titular_id, coalesce(p_valor_referencia, 0),
        p_data_vencimento_unica, 'pendente', p_workspace_id
      ) on conflict (workspace_id, conta_id, vencimento)
        where conta_id is not null
        do nothing;
      get diagnostics v_linhas = row_count;
      v_inseridos := v_inseridos + v_linhas;
    end if;
  end if;

  if p_titular_id is distinct from v_conta.titular_id then
    perform public.trocar_titular_conta(p_workspace_id, p_conta_id, p_titular_id, p_hoje);
  end if;

  return jsonb_build_object(
    'conta_id', p_conta_id,
    'lancamentos_atualizados', to_jsonb(v_ids_atualizados),
    'lancamentos_excluidos', v_excluidos,
    'lancamentos_inseridos', v_inseridos
  );
end;
$$;

revoke all on function public.atualizar_conta_com_vencimentos(uuid, uuid, text, uuid, uuid, uuid, text, integer, integer, numeric, text, date, date) from public;
revoke all on function public.atualizar_conta_com_vencimentos(uuid, uuid, text, uuid, uuid, uuid, text, integer, integer, numeric, text, date, date) from anon;
revoke all on function public.atualizar_conta_com_vencimentos(uuid, uuid, text, uuid, uuid, uuid, text, integer, integer, numeric, text, date, date) from authenticated;
grant execute on function public.atualizar_conta_com_vencimentos(uuid, uuid, text, uuid, uuid, uuid, text, integer, integer, numeric, text, date, date) to authenticated;
