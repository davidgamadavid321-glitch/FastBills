-- Operacoes atomicas de conta. Nenhuma rotina altera historico pago/passado.

create or replace function public.papel_usuario_no_workspace(p_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select wm.papel
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.usuario_administra_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.papel_usuario_no_workspace(p_workspace_id) in ('owner', 'admin'), false);
$$;

create or replace function public.usuario_e_owner_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.papel_usuario_no_workspace(p_workspace_id) = 'owner', false);
$$;

revoke all on function public.papel_usuario_no_workspace(uuid) from public, anon, authenticated;
revoke all on function public.usuario_administra_workspace(uuid) from public, anon, authenticated;
revoke all on function public.usuario_e_owner_workspace(uuid) from public, anon, authenticated;

alter table public.contas
  add column if not exists requisicao_criacao uuid;

create unique index if not exists contas_workspace_requisicao_criacao_uidx
  on public.contas (workspace_id, requisicao_criacao)
  where requisicao_criacao is not null;

create or replace function public.data_vencimento_no_mes(
  p_ano integer,
  p_mes integer,
  p_dia integer
)
returns date
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_ultimo_dia integer;
begin
  if p_mes not between 1 and 12 or p_dia not between 1 and 31 then
    raise exception 'Data-base de vencimento invalida.';
  end if;

  v_ultimo_dia := extract(
    day from (date_trunc('month', make_date(p_ano, p_mes, 1)) + interval '1 month - 1 day')
  )::integer;

  return make_date(p_ano, p_mes, least(p_dia, v_ultimo_dia));
end;
$$;

revoke all on function public.data_vencimento_no_mes(integer, integer, integer) from public;
revoke all on function public.data_vencimento_no_mes(integer, integer, integer) from anon;
revoke all on function public.data_vencimento_no_mes(integer, integer, integer) from authenticated;

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

  select *
    into v_conta
  from public.contas
  where workspace_id = p_workspace_id
    and requisicao_criacao = p_requisicao_id;

  if found then
    v_ja_existia := true;
  else
    begin
      insert into public.contas (
        nome,
        categoria_id,
        centro_id,
        titular_id,
        recorrencia,
        dia_vencimento,
        mes_vencimento,
        valor_referencia,
        status_contrato,
        workspace_id,
        requisicao_criacao
      ) values (
        nullif(btrim(p_nome), ''),
        p_categoria_id,
        p_centro_id,
        p_titular_id,
        p_recorrencia,
        p_dia_vencimento,
        p_mes_vencimento,
        p_valor_referencia,
        p_status_contrato,
        p_workspace_id,
        p_requisicao_id
      )
      returning * into v_conta;
    exception
      when unique_violation then
        select *
          into v_conta
        from public.contas
        where workspace_id = p_workspace_id
          and requisicao_criacao = p_requisicao_id;

        if not found then
          raise;
        end if;
        v_ja_existia := true;
    end;
  end if;

  if not v_ja_existia then
    if p_titular_id is not null then
      insert into public.contas_titulares (
        conta_id,
        titular_id,
        inicio,
        fim,
        workspace_id
      ) values (
        v_conta.id,
        p_titular_id,
        (now() at time zone 'America/Sao_Paulo')::date,
        null,
        p_workspace_id
      );
    end if;

    for v_lancamento in select value from jsonb_array_elements(p_lancamentos)
    loop
      v_vencimento := (v_lancamento->>'vencimento')::date;
      v_valor := (v_lancamento->>'valor')::numeric;
      v_status := v_lancamento->>'status';

      if v_status not in ('pendente', 'pago', 'vencido') then
        raise exception 'Status de lancamento invalido.';
      end if;
      if v_valor < 0 then
        raise exception 'Valor de lancamento invalido.';
      end if;

      insert into public.lancamentos (
        conta_id,
        valor,
        vencimento,
        status,
        workspace_id
      ) values (
        v_conta.id,
        v_valor,
        v_vencimento,
        v_status,
        p_workspace_id
      );
    end loop;
  end if;

  return jsonb_build_object(
    'conta_id', v_conta.id,
    'reutilizada', v_ja_existia
  );
end;
$$;

revoke all on function public.criar_conta_com_lancamentos(uuid, uuid, text, uuid, uuid, uuid, text, integer, integer, numeric, text, jsonb) from public;
revoke all on function public.criar_conta_com_lancamentos(uuid, uuid, text, uuid, uuid, uuid, text, integer, integer, numeric, text, jsonb) from anon;
revoke all on function public.criar_conta_com_lancamentos(uuid, uuid, text, uuid, uuid, uuid, text, integer, integer, numeric, text, jsonb) from authenticated;
grant execute on function public.criar_conta_com_lancamentos(uuid, uuid, text, uuid, uuid, uuid, text, integer, integer, numeric, text, jsonb) to authenticated;

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
begin
  if auth.uid() is null then
    raise exception 'Usuario autenticado necessario para atualizar conta.';
  end if;

  if p_workspace_id is null or not public.usuario_administra_workspace(p_workspace_id) then
    raise exception 'Somente administradores podem atualizar contas.';
  end if;

  select *
    into v_conta
  from public.contas
  where id = p_conta_id
    and workspace_id = p_workspace_id
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
  where id = p_conta_id
    and workspace_id = p_workspace_id;

  if v_conta.recorrencia = p_recorrencia
     and p_recorrencia in ('mensal', 'anual')
     and (
       v_conta.dia_vencimento is distinct from p_dia_vencimento
       or (
         p_recorrencia = 'anual'
         and v_conta.mes_vencimento is distinct from p_mes_vencimento
       )
     ) then
    with elegiveis as (
      select
        l.id,
        public.data_vencimento_no_mes(
          extract(year from l.vencimento)::integer,
          case
            when p_recorrencia = 'anual' then p_mes_vencimento
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
        and l.workspace_id = p_workspace_id
        and e.novo_vencimento >= p_hoje
        and e.novo_vencimento <> l.vencimento
      returning l.id
    )
    select coalesce(array_agg(id), array[]::uuid[])
      into v_ids_atualizados
    from atualizados;
  end if;

  if p_titular_id is distinct from v_conta.titular_id then
    perform public.trocar_titular_conta(
      p_workspace_id,
      p_conta_id,
      p_titular_id,
      p_hoje
    );
  end if;

  return jsonb_build_object(
    'conta_id', p_conta_id,
    'lancamentos_atualizados', to_jsonb(v_ids_atualizados)
  );
end;
$$;

revoke all on function public.atualizar_conta_com_vencimentos(uuid, uuid, text, uuid, uuid, uuid, text, integer, integer, numeric, text, date) from public;
revoke all on function public.atualizar_conta_com_vencimentos(uuid, uuid, text, uuid, uuid, uuid, text, integer, integer, numeric, text, date) from anon;
revoke all on function public.atualizar_conta_com_vencimentos(uuid, uuid, text, uuid, uuid, uuid, text, integer, integer, numeric, text, date) from authenticated;
grant execute on function public.atualizar_conta_com_vencimentos(uuid, uuid, text, uuid, uuid, uuid, text, integer, integer, numeric, text, date) to authenticated;

create or replace function public.excluir_conta_com_lancamentos_futuros(
  p_workspace_id uuid,
  p_conta_id uuid,
  p_hoje date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lancamentos_excluidos integer := 0;
  v_contas_excluidas integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Usuario autenticado necessario para excluir conta.';
  end if;

  if p_workspace_id is null or not public.usuario_administra_workspace(p_workspace_id) then
    raise exception 'Somente administradores podem excluir contas.';
  end if;

  perform 1
  from public.contas
  where id = p_conta_id
    and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'Conta nao encontrada neste workspace.';
  end if;

  delete from public.lancamentos
  where conta_id = p_conta_id
    and workspace_id = p_workspace_id
    and status <> 'pago'
    and vencimento >= p_hoje;
  get diagnostics v_lancamentos_excluidos = row_count;

  delete from public.contas_titulares
  where conta_id = p_conta_id
    and workspace_id = p_workspace_id;

  delete from public.contas
  where id = p_conta_id
    and workspace_id = p_workspace_id;
  get diagnostics v_contas_excluidas = row_count;

  if v_contas_excluidas <> 1 then
    raise exception 'A conta nao foi excluida.';
  end if;

  return jsonb_build_object(
    'conta_id', p_conta_id,
    'lancamentos_excluidos', v_lancamentos_excluidos
  );
end;
$$;

revoke all on function public.excluir_conta_com_lancamentos_futuros(uuid, uuid, date) from public;
revoke all on function public.excluir_conta_com_lancamentos_futuros(uuid, uuid, date) from anon;
revoke all on function public.excluir_conta_com_lancamentos_futuros(uuid, uuid, date) from authenticated;
grant execute on function public.excluir_conta_com_lancamentos_futuros(uuid, uuid, date) to authenticated;

create or replace function public.excluir_lancamentos_conta(
  p_workspace_id uuid,
  p_conta_id uuid,
  p_lancamento_id uuid,
  p_hoje date,
  p_todos_futuros boolean
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'Usuario autenticado necessario para excluir lancamento.';
  end if;

  if p_workspace_id is null or not public.usuario_administra_workspace(p_workspace_id) then
    raise exception 'Somente administradores podem excluir lancamentos.';
  end if;

  with excluidos as (
    delete from public.lancamentos
    where workspace_id = p_workspace_id
      and conta_id = p_conta_id
      and (
        id = p_lancamento_id
        or (
          p_todos_futuros
          and status <> 'pago'
          and vencimento >= p_hoje
        )
      )
    returning id
  )
  select coalesce(array_agg(id), array[]::uuid[])
    into v_ids
  from excluidos;

  if not (p_lancamento_id = any(v_ids)) then
    raise exception 'Lancamento nao encontrado neste workspace.';
  end if;

  return v_ids;
end;
$$;

revoke all on function public.excluir_lancamentos_conta(uuid, uuid, uuid, date, boolean) from public;
revoke all on function public.excluir_lancamentos_conta(uuid, uuid, uuid, date, boolean) from anon;
revoke all on function public.excluir_lancamentos_conta(uuid, uuid, uuid, date, boolean) from authenticated;
grant execute on function public.excluir_lancamentos_conta(uuid, uuid, uuid, date, boolean) to authenticated;
