-- Constraints basicas de integridade para valores confirmados pelo projeto.
-- Nao altera nulabilidade nem corrige dados existentes automaticamente.
-- public.contas nao possui coluna status; o campo confirmado pelo app e
-- status_contrato, usado com os valores ativo e a_fazer.

do $$
begin
  if exists (
    select 1 from public.workspaces
    where btrim(nome) = ''
  ) then
    raise exception 'Integridade: existem workspaces com nome vazio.';
  end if;

  if exists (
    select 1 from public.titulares
    where nome is not null and btrim(nome) = ''
  ) then
    raise exception 'Integridade: existem titulares com nome vazio.';
  end if;

  if exists (
    select 1 from public.centros_custo
    where nome is not null and btrim(nome) = ''
  ) then
    raise exception 'Integridade: existem centros de custo com nome vazio.';
  end if;

  if exists (
    select 1 from public.categorias
    where nome is not null and btrim(nome) = ''
  ) then
    raise exception 'Integridade: existem categorias com nome vazio.';
  end if;

  if exists (
    select 1 from public.contas
    where nome is not null and btrim(nome) = ''
  ) then
    raise exception 'Integridade: existem contas com nome vazio.';
  end if;

  if exists (
    select 1 from public.configuracoes
    where btrim(chave) = ''
  ) then
    raise exception 'Integridade: existem configuracoes com chave vazia.';
  end if;

  if exists (
    select 1 from public.centros_custo
    where tipo is not null
      and tipo not in ('casa', 'apartamento', 'comercial', 'pessoal', 'outro')
  ) then
    raise exception 'Integridade: existem centros de custo com tipo invalido.';
  end if;

  if exists (
    select 1 from public.centros_custo
    where status is not null
      and status not in ('ativo', 'configuracao')
  ) then
    raise exception 'Integridade: existem centros de custo com status invalido.';
  end if;

  if exists (
    select 1 from public.contas
    where recorrencia is not null
      and recorrencia not in ('uma_vez', 'mensal', 'anual')
  ) then
    raise exception 'Integridade: existem contas com recorrencia invalida.';
  end if;

  if exists (
    select 1 from public.contas
    where status_contrato is not null
      and status_contrato not in ('ativo', 'a_fazer')
  ) then
    raise exception 'Integridade: existem contas com status de contrato invalido.';
  end if;

  if exists (
    select 1 from public.contas
    where dia_vencimento is not null
      and dia_vencimento not between 1 and 31
  ) then
    raise exception 'Integridade: existem contas com dia de vencimento fora do intervalo 1 a 31.';
  end if;

  if exists (
    select 1 from public.contas
    where mes_vencimento is not null
      and mes_vencimento not between 1 and 12
  ) then
    raise exception 'Integridade: existem contas com mes de vencimento fora do intervalo 1 a 12.';
  end if;

  if exists (
    select 1 from public.contas
    where recorrencia = 'anual'
      and mes_vencimento is null
  ) then
    raise exception 'Integridade: existem contas anuais sem mes de vencimento.';
  end if;

  if exists (
    select 1 from public.contas
    where valor_referencia is not null
      and valor_referencia < 0
  ) then
    raise exception 'Integridade: existem contas com valor de referencia negativo.';
  end if;

  if exists (
    select 1 from public.lancamentos
    where valor is not null
      and valor < 0
  ) then
    raise exception 'Integridade: existem lancamentos com valor negativo.';
  end if;

  if exists (
    select 1 from public.lancamentos
    where status is not null
      and status not in ('pendente', 'pago', 'vencido')
  ) then
    raise exception 'Integridade: existem lancamentos com status invalido.';
  end if;

  if exists (
    select 1 from public.contas_titulares
    where inicio is not null
      and fim is not null
      and fim < inicio
  ) then
    raise exception 'Integridade: existem historicos de titular com fim anterior ao inicio.';
  end if;

  if exists (
    select 1 from public.telegram_aviso_execucoes
    where total_chats < 0
       or total_envios < 0
       or total_lancamentos < 0
  ) then
    raise exception 'Integridade: existem execucoes do Telegram com totais negativos.';
  end if;
end;
$$;

do $$
declare
  especificacao record;
begin
  for especificacao in
    select *
    from (
      values
        ('workspaces', 'workspaces_nome_non_empty_check', 'btrim(nome) <> '''''),
        ('titulares', 'titulares_nome_non_empty_check', 'nome is null or btrim(nome) <> '''''),
        ('centros_custo', 'centros_custo_nome_non_empty_check', 'nome is null or btrim(nome) <> '''''),
        ('centros_custo', 'centros_custo_tipo_check', 'tipo is null or tipo in (''casa'', ''apartamento'', ''comercial'', ''pessoal'', ''outro'')'),
        ('centros_custo', 'centros_custo_status_check', 'status is null or status in (''ativo'', ''configuracao'')'),
        ('categorias', 'categorias_nome_non_empty_check', 'nome is null or btrim(nome) <> '''''),
        ('contas', 'contas_nome_non_empty_check', 'nome is null or btrim(nome) <> '''''),
        ('contas', 'contas_recorrencia_check', 'recorrencia is null or recorrencia in (''uma_vez'', ''mensal'', ''anual'')'),
        ('contas', 'contas_status_contrato_check', 'status_contrato is null or status_contrato in (''ativo'', ''a_fazer'')'),
        ('contas', 'contas_dia_vencimento_range_check', 'dia_vencimento is null or dia_vencimento between 1 and 31'),
        ('contas', 'contas_mes_vencimento_range_check', 'mes_vencimento is null or mes_vencimento between 1 and 12'),
        ('contas', 'contas_anual_mes_vencimento_check', 'recorrencia is null or recorrencia <> ''anual'' or mes_vencimento is not null'),
        ('contas', 'contas_valor_referencia_non_negative_check', 'valor_referencia is null or valor_referencia >= 0'),
        ('lancamentos', 'lancamentos_valor_non_negative_check', 'valor is null or valor >= 0'),
        ('lancamentos', 'lancamentos_status_check', 'status is null or status in (''pendente'', ''pago'', ''vencido'')'),
        ('contas_titulares', 'contas_titulares_periodo_check', 'inicio is null or fim is null or fim >= inicio'),
        ('configuracoes', 'configuracoes_chave_non_empty_check', 'btrim(chave) <> '''''),
        ('telegram_aviso_execucoes', 'telegram_aviso_execucoes_totais_non_negative_check', '(total_chats is null or total_chats >= 0) and (total_envios is null or total_envios >= 0) and (total_lancamentos is null or total_lancamentos >= 0)')
    ) as checks(tabela, constraint_nome, expressao)
  loop
    if not exists (
      select 1
      from pg_constraint
      where conrelid = to_regclass(format('public.%I', especificacao.tabela))
        and conname = especificacao.constraint_nome
    ) then
      execute format(
        'alter table public.%I add constraint %I check (%s)',
        especificacao.tabela,
        especificacao.constraint_nome,
        especificacao.expressao
      );
    end if;
  end loop;
end;
$$;
