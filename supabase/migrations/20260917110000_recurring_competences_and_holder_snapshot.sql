-- Continuidade idempotente das recorrencias e snapshot historico do titular.

alter table public.lancamentos
  add column if not exists titular_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.lancamentos'::regclass
      and conname = 'lancamentos_workspace_titular_fkey'
  ) then
    alter table public.lancamentos
      add constraint lancamentos_workspace_titular_fkey
      foreign key (workspace_id, titular_id)
      references public.titulares (workspace_id, id);
  end if;
end;
$$;

create index if not exists lancamentos_workspace_titular_idx
  on public.lancamentos (workspace_id, titular_id);

-- Um titular so e atribuido quando exatamente um periodo historico cobre o
-- vencimento. Ausencia ou sobreposicao permanece nula para nao inventar dados.
with correspondencias_unicas as (
  select
    l.id as lancamento_id,
    min(ct.titular_id::text)::uuid as titular_id
  from public.lancamentos l
  join public.contas_titulares ct
    on ct.workspace_id = l.workspace_id
   and ct.conta_id = l.conta_id
   and ct.inicio <= l.vencimento
   and (ct.fim is null or ct.fim >= l.vencimento)
  where l.titular_id is null
  group by l.id
  having count(*) = 1
)
update public.lancamentos l
set titular_id = c.titular_id
from correspondencias_unicas c
where l.id = c.lancamento_id
  and l.titular_id is null;

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
    if not public.usuario_pertence_ao_workspace(p_workspace_id) then
      raise exception 'Workspace invalido ou indisponivel para o usuario autenticado.';
    end if;
  elsif coalesce(auth.role(), '') <> 'service_role' and session_user <> current_user then
    raise exception 'Usuario autenticado necessario para gerar a competencia.';
  end if;

  v_inicio_mes := make_date(p_ano, p_mes, 1);

  if auth.uid() is not null
     and v_inicio_mes > (date_trunc('month', v_hoje) + interval '36 months')::date then
    raise exception 'Competencia fora da janela disponivel para consulta.';
  end if;

  -- Consultar o passado nunca fabrica historico. O mes corrente e os meses
  -- futuros podem ser recompostos com seguranca pela chave unica da conta/data.
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

revoke all on function public.garantir_competencia_recorrente(uuid, integer, integer) from public;
revoke all on function public.garantir_competencia_recorrente(uuid, integer, integer) from anon;
revoke all on function public.garantir_competencia_recorrente(uuid, integer, integer) from authenticated;
grant execute on function public.garantir_competencia_recorrente(uuid, integer, integer) to authenticated;
grant execute on function public.garantir_competencia_recorrente(uuid, integer, integer) to service_role;

create or replace function public.garantir_competencias_recorrentes_diarias()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_competencia date;
  v_workspace record;
  v_resultado jsonb;
  v_total integer := 0;
begin
  for v_workspace in select id from public.workspaces loop
    for v_competencia in
      select competencia::date
      from generate_series(
        date_trunc('month', v_hoje)::date,
        date_trunc('month', v_hoje + 30)::date,
        interval '1 month'
      ) competencia
    loop
      v_resultado := public.garantir_competencia_recorrente(
        v_workspace.id,
        extract(year from v_competencia)::integer,
        extract(month from v_competencia)::integer
      );
      v_total := v_total + coalesce((v_resultado->>'inseridos')::integer, 0);
    end loop;
  end loop;

  return v_total;
end;
$$;

revoke all on function public.garantir_competencias_recorrentes_diarias() from public;
revoke all on function public.garantir_competencias_recorrentes_diarias() from anon;
revoke all on function public.garantir_competencias_recorrentes_diarias() from authenticated;
revoke all on function public.garantir_competencias_recorrentes_diarias() from service_role;

create extension if not exists pg_cron with schema extensions;

select cron.unschedule('garantir-competencias-recorrentes')
where exists (
  select 1 from cron.job where jobname = 'garantir-competencias-recorrentes'
);

select cron.schedule(
  'garantir-competencias-recorrentes',
  '7 3 * * *',
  $$select public.garantir_competencias_recorrentes_diarias();$$
);

-- A criacao atomica passa a gravar o titular vigente em cada novo lancamento.
create or replace function public.criar_conta_com_lancamentos(
  p_workspace_id uuid,
  p_requisicao_id uuid,
  p_nome text,
  p_categoria_id uuid,
  p_centro_id uuid,
  p_titular_id uuid,
  p_recorrencia text,
  p_dia_vencimento integer,
  p_mes_vencimento integer,
  p_valor_referencia numeric,
  p_status_contrato text,
  p_lancamentos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conta public.contas%rowtype;
  v_lancamento jsonb;
  v_vencimento date;
  v_valor numeric;
  v_status text;
  v_ja_existia boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Usuario autenticado necessario para criar conta.';
  end if;

  if p_workspace_id is null or not public.usuario_administra_workspace(p_workspace_id) then
    raise exception 'Somente administradores podem criar contas.';
  end if;

  if p_requisicao_id is null then
    raise exception 'Identificador idempotente de criacao obrigatorio.';
  end if;

  if jsonb_typeof(p_lancamentos) <> 'array' or jsonb_array_length(p_lancamentos) = 0 then
    raise exception 'Informe ao menos um lancamento para criar a conta.';
  end if;

  select * into v_conta
  from public.contas
  where workspace_id = p_workspace_id
    and requisicao_criacao = p_requisicao_id;

  if found then
    v_ja_existia := true;
  else
    begin
      insert into public.contas (
        nome, categoria_id, centro_id, titular_id, recorrencia,
        dia_vencimento, mes_vencimento, valor_referencia,
        status_contrato, workspace_id, requisicao_criacao
      ) values (
        nullif(btrim(p_nome), ''), p_categoria_id, p_centro_id,
        p_titular_id, p_recorrencia, p_dia_vencimento,
        p_mes_vencimento, p_valor_referencia, p_status_contrato,
        p_workspace_id, p_requisicao_id
      ) returning * into v_conta;
    exception
      when unique_violation then
        select * into v_conta
        from public.contas
        where workspace_id = p_workspace_id
          and requisicao_criacao = p_requisicao_id;
        if not found then raise; end if;
        v_ja_existia := true;
    end;
  end if;

  if not v_ja_existia then
    if p_titular_id is not null then
      insert into public.contas_titulares (
        conta_id, titular_id, inicio, fim, workspace_id
      ) values (
        v_conta.id, p_titular_id,
        (now() at time zone 'America/Sao_Paulo')::date,
        null, p_workspace_id
      );
    end if;

    for v_lancamento in select value from jsonb_array_elements(p_lancamentos)
    loop
      v_vencimento := (v_lancamento->>'vencimento')::date;
      v_valor := (v_lancamento->>'valor')::numeric;
      v_status := v_lancamento->>'status';

      if v_status not in ('pendente', 'pago', 'vencido') or v_valor < 0 then
        raise exception 'Lancamento invalido.';
      end if;

      insert into public.lancamentos (
        conta_id, titular_id, valor, vencimento, status, workspace_id
      ) values (
        v_conta.id, p_titular_id, v_valor, v_vencimento, v_status, p_workspace_id
      );
    end loop;
  end if;

  return jsonb_build_object('conta_id', v_conta.id, 'reutilizada', v_ja_existia);
end;
$$;

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
  p_hoje date
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

  update public.contas
  set nome = nullif(btrim(p_nome), ''),
      categoria_id = p_categoria_id,
      centro_id = p_centro_id,
      recorrencia = p_recorrencia,
      dia_vencimento = p_dia_vencimento,
      mes_vencimento = p_mes_vencimento,
      valor_referencia = p_valor_referencia,
      status_contrato = p_status_contrato
  where id = p_conta_id and workspace_id = p_workspace_id;

  if v_conta.recorrencia = p_recorrencia
     and p_recorrencia in ('mensal', 'anual')
     and (
       v_conta.dia_vencimento is distinct from p_dia_vencimento
       or (p_recorrencia = 'anual' and v_conta.mes_vencimento is distinct from p_mes_vencimento)
     ) then
    with elegiveis as (
      select
        l.id,
        public.data_vencimento_no_mes(
          extract(year from l.vencimento)::integer,
          case when p_recorrencia = 'anual'
            then p_mes_vencimento
            else extract(month from l.vencimento)::integer
          end,
          p_dia_vencimento
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
  elsif v_conta.recorrencia in ('mensal', 'anual')
        and p_recorrencia in ('mensal', 'anual')
        and v_conta.recorrencia <> p_recorrencia then
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
        p_dia_vencimento
      ) < p_hoje then
        v_base := (v_base + interval '1 month')::date;
      end if;

      for v_indice in 0..11 loop
        v_data := public.data_vencimento_no_mes(
          extract(year from (v_base + make_interval(months => v_indice)))::integer,
          extract(month from (v_base + make_interval(months => v_indice)))::integer,
          p_dia_vencimento
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
    elsif p_status_contrato = 'ativo' then
      v_base := make_date(extract(year from p_hoje)::integer, p_mes_vencimento, 1);
      if public.data_vencimento_no_mes(
        extract(year from v_base)::integer,
        p_mes_vencimento,
        p_dia_vencimento
      ) < p_hoje then
        v_base := (v_base + interval '1 year')::date;
      end if;

      for v_indice in 0..5 loop
        v_data := public.data_vencimento_no_mes(
          extract(year from v_base)::integer + v_indice,
          p_mes_vencimento,
          p_dia_vencimento
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
