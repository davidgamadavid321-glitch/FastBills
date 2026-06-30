-- Impede mais de um lancamento da mesma conta no mesmo vencimento e workspace.

do $$
begin
  if exists (
    select 1
    from public.lancamentos
    where conta_id is not null
    group by workspace_id, conta_id, vencimento
    having count(*) > 1
  ) then
    raise exception 'Existem lancamentos duplicados por workspace_id, conta_id e vencimento. Resolva as duplicidades manualmente antes de aplicar esta migration.';
  end if;
end;
$$;

do $$
declare
  tabela_oid oid := 'public.lancamentos'::regclass;
  workspace_attnum smallint;
  conta_attnum smallint;
  vencimento_attnum smallint;
begin
  select attnum
    into workspace_attnum
  from pg_attribute
  where attrelid = tabela_oid
    and attname = 'workspace_id'
    and not attisdropped;

  select attnum
    into conta_attnum
  from pg_attribute
  where attrelid = tabela_oid
    and attname = 'conta_id'
    and not attisdropped;

  select attnum
    into vencimento_attnum
  from pg_attribute
  where attrelid = tabela_oid
    and attname = 'vencimento'
    and not attisdropped;

  if not exists (
    select 1
    from pg_index i
    where i.indrelid = tabela_oid
      and i.indisunique
      and i.indisvalid
      and i.indexprs is null
      and i.indnkeyatts = 3
      and i.indkey[0] = workspace_attnum
      and i.indkey[1] = conta_attnum
      and i.indkey[2] = vencimento_attnum
      and (
        i.indpred is null
        or regexp_replace(
          lower(pg_get_expr(i.indpred, i.indrelid)),
          '[()[:space:]]',
          '',
          'g'
        ) = 'conta_idisnotnull'
      )
  ) then
    create unique index lancamentos_workspace_conta_vencimento_uidx
      on public.lancamentos (workspace_id, conta_id, vencimento)
      where conta_id is not null;
  end if;
end;
$$;
