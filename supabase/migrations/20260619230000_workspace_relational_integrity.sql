-- Impede relacionamentos entre registros de workspaces diferentes.
-- As foreign keys simples existentes sao preservadas.

do $$
begin
  if exists (
    select 1
    from public.contas c
    join public.titulares t on t.id = c.titular_id
    where c.workspace_id <> t.workspace_id
  ) then
    raise exception 'Integridade multiworkspace: existem contas vinculadas a titulares de outro workspace.';
  end if;

  if exists (
    select 1
    from public.contas c
    join public.categorias cat on cat.id = c.categoria_id
    where c.workspace_id <> cat.workspace_id
  ) then
    raise exception 'Integridade multiworkspace: existem contas vinculadas a categorias de outro workspace.';
  end if;

  if exists (
    select 1
    from public.contas c
    join public.centros_custo cc on cc.id = c.centro_id
    where c.centro_id is not null
      and c.workspace_id <> cc.workspace_id
  ) then
    raise exception 'Integridade multiworkspace: existem contas vinculadas a centros de custo de outro workspace.';
  end if;

  if exists (
    select 1
    from public.lancamentos l
    join public.contas c on c.id = l.conta_id
    where l.workspace_id <> c.workspace_id
  ) then
    raise exception 'Integridade multiworkspace: existem lancamentos vinculados a contas de outro workspace.';
  end if;

  if exists (
    select 1
    from public.contas_titulares ct
    join public.contas c on c.id = ct.conta_id
    where ct.workspace_id <> c.workspace_id
  ) then
    raise exception 'Integridade multiworkspace: existem historicos de titular vinculados a contas de outro workspace.';
  end if;

  if exists (
    select 1
    from public.contas_titulares ct
    join public.titulares t on t.id = ct.titular_id
    where ct.workspace_id <> t.workspace_id
  ) then
    raise exception 'Integridade multiworkspace: existem historicos de titular vinculados a titulares de outro workspace.';
  end if;
end;
$$;

do $$
declare
  especificacao record;
  tabela_oid oid;
  workspace_attnum smallint;
  id_attnum smallint;
begin
  for especificacao in
    select *
    from (
      values
        ('titulares', 'titulares_workspace_id_id_key'),
        ('categorias', 'categorias_workspace_id_id_key'),
        ('centros_custo', 'centros_custo_workspace_id_id_key'),
        ('contas', 'contas_workspace_id_id_key')
    ) as uniques(tabela, constraint_nome)
  loop
    tabela_oid := to_regclass(format('public.%I', especificacao.tabela));

    select attnum
      into workspace_attnum
    from pg_attribute
    where attrelid = tabela_oid
      and attname = 'workspace_id'
      and not attisdropped;

    select attnum
      into id_attnum
    from pg_attribute
    where attrelid = tabela_oid
      and attname = 'id'
      and not attisdropped;

    if not exists (
      select 1
      from pg_constraint c
      where c.conrelid = tabela_oid
        and c.contype in ('p', 'u')
        and c.conkey = array[workspace_attnum, id_attnum]::smallint[]
    ) then
      execute format(
        'alter table public.%I add constraint %I unique (workspace_id, id)',
        especificacao.tabela,
        especificacao.constraint_nome
      );
    end if;
  end loop;
end;
$$;

do $$
declare
  especificacao record;
  origem_oid oid;
  destino_oid oid;
  origem_workspace_attnum smallint;
  origem_fk_attnum smallint;
  destino_workspace_attnum smallint;
  destino_id_attnum smallint;
begin
  for especificacao in
    select *
    from (
      values
        ('contas', 'titular_id', 'titulares', 'contas_workspace_titular_fkey'),
        ('contas', 'categoria_id', 'categorias', 'contas_workspace_categoria_fkey'),
        ('contas', 'centro_id', 'centros_custo', 'contas_workspace_centro_fkey'),
        ('lancamentos', 'conta_id', 'contas', 'lancamentos_workspace_conta_fkey'),
        ('contas_titulares', 'conta_id', 'contas', 'contas_titulares_workspace_conta_fkey'),
        ('contas_titulares', 'titular_id', 'titulares', 'contas_titulares_workspace_titular_fkey')
    ) as fks(origem, coluna_fk, destino, constraint_nome)
  loop
    origem_oid := to_regclass(format('public.%I', especificacao.origem));
    destino_oid := to_regclass(format('public.%I', especificacao.destino));

    select attnum
      into origem_workspace_attnum
    from pg_attribute
    where attrelid = origem_oid
      and attname = 'workspace_id'
      and not attisdropped;

    select attnum
      into origem_fk_attnum
    from pg_attribute
    where attrelid = origem_oid
      and attname = especificacao.coluna_fk
      and not attisdropped;

    select attnum
      into destino_workspace_attnum
    from pg_attribute
    where attrelid = destino_oid
      and attname = 'workspace_id'
      and not attisdropped;

    select attnum
      into destino_id_attnum
    from pg_attribute
    where attrelid = destino_oid
      and attname = 'id'
      and not attisdropped;

    if not exists (
      select 1
      from pg_constraint c
      where c.conrelid = origem_oid
        and c.confrelid = destino_oid
        and c.contype = 'f'
        and c.conkey = array[origem_workspace_attnum, origem_fk_attnum]::smallint[]
        and c.confkey = array[destino_workspace_attnum, destino_id_attnum]::smallint[]
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (workspace_id, %I) references public.%I (workspace_id, id)',
        especificacao.origem,
        especificacao.constraint_nome,
        especificacao.coluna_fk,
        especificacao.destino
      );
    end if;
  end loop;
end;
$$;

do $$
declare
  especificacao record;
  tabela_oid oid;
  workspace_attnum smallint;
  fk_attnum smallint;
begin
  for especificacao in
    select *
    from (
      values
        ('contas', 'titular_id', 'contas_workspace_titular_idx'),
        ('contas', 'categoria_id', 'contas_workspace_categoria_idx'),
        ('contas', 'centro_id', 'contas_workspace_centro_idx'),
        ('lancamentos', 'conta_id', 'lancamentos_workspace_conta_idx'),
        ('contas_titulares', 'conta_id', 'contas_titulares_workspace_conta_idx'),
        ('contas_titulares', 'titular_id', 'contas_titulares_workspace_titular_idx')
    ) as indices(tabela, coluna_fk, index_nome)
  loop
    tabela_oid := to_regclass(format('public.%I', especificacao.tabela));

    select attnum
      into workspace_attnum
    from pg_attribute
    where attrelid = tabela_oid
      and attname = 'workspace_id'
      and not attisdropped;

    select attnum
      into fk_attnum
    from pg_attribute
    where attrelid = tabela_oid
      and attname = especificacao.coluna_fk
      and not attisdropped;

    if not exists (
      select 1
      from pg_index i
      where i.indrelid = tabela_oid
        and i.indisvalid
        and i.indpred is null
        and i.indexprs is null
        and i.indnkeyatts >= 2
        and i.indkey[0] = workspace_attnum
        and i.indkey[1] = fk_attnum
    ) then
      execute format(
        'create index %I on public.%I (workspace_id, %I)',
        especificacao.index_nome,
        especificacao.tabela,
        especificacao.coluna_fk
      );
    end if;
  end loop;
end;
$$;
