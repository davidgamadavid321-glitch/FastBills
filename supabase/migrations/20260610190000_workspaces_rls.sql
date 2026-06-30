-- Etapa 3: RLS definitivo das tabelas antigas e integridade minima multiworkspace.
-- Mantem a trigger temporaria preencher_workspace_id_temporario instalada.

revoke all on function public.usuario_pertence_ao_workspace(uuid) from public;
revoke all on function public.usuario_pertence_ao_workspace(uuid) from anon;
revoke all on function public.usuario_pertence_ao_workspace(uuid) from authenticated;
grant execute on function public.usuario_pertence_ao_workspace(uuid) to authenticated;
grant execute on function public.usuario_pertence_ao_workspace(uuid) to service_role;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'workspaces',
        'workspace_members',
        'titulares',
        'centros_custo',
        'categorias',
        'contas',
        'lancamentos',
        'contas_titulares',
        'configuracoes',
        'telegram_aviso_execucoes'
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end;
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

revoke all on table public.workspaces from public;
revoke all on table public.workspaces from anon;
revoke all on table public.workspaces from authenticated;
grant select on table public.workspaces to authenticated;
grant all on table public.workspaces to service_role;

revoke all on table public.workspace_members from public;
revoke all on table public.workspace_members from anon;
revoke all on table public.workspace_members from authenticated;
grant select on table public.workspace_members to authenticated;
grant all on table public.workspace_members to service_role;

create policy "Membros podem ver workspaces"
  on public.workspaces
  for select
  to authenticated
  using (public.usuario_pertence_ao_workspace(id));

create policy "Membros podem ver memberships do workspace"
  on public.workspace_members
  for select
  to authenticated
  using (public.usuario_pertence_ao_workspace(workspace_id));

do $$
declare
  tabelas_crud text[] := array[
    'titulares',
    'centros_custo',
    'categorias',
    'contas',
    'lancamentos',
    'contas_titulares',
    'configuracoes'
  ];
  tabela text;
begin
  foreach tabela in array tabelas_crud loop
    if to_regclass(format('public.%I', tabela)) is not null then
      execute format('alter table public.%I enable row level security', tabela);

      execute format('revoke all on table public.%I from public', tabela);
      execute format('revoke all on table public.%I from anon', tabela);
      execute format('revoke all on table public.%I from authenticated', tabela);
      execute format('grant select, insert, update, delete on table public.%I to authenticated', tabela);
      execute format('grant all on table public.%I to service_role', tabela);

      execute format(
        'create policy %I on public.%I for select to authenticated using (public.usuario_pertence_ao_workspace(workspace_id))',
        'Membros podem ver ' || tabela || ' do workspace',
        tabela
      );

      execute format(
        'create policy %I on public.%I for insert to authenticated with check (public.usuario_pertence_ao_workspace(workspace_id))',
        'Membros podem inserir ' || tabela || ' no workspace',
        tabela
      );

      execute format(
        'create policy %I on public.%I for update to authenticated using (public.usuario_pertence_ao_workspace(workspace_id)) with check (public.usuario_pertence_ao_workspace(workspace_id))',
        'Membros podem atualizar ' || tabela || ' do workspace',
        tabela
      );

      execute format(
        'create policy %I on public.%I for delete to authenticated using (public.usuario_pertence_ao_workspace(workspace_id))',
        'Membros podem excluir ' || tabela || ' do workspace',
        tabela
      );
    end if;
  end loop;
end;
$$;

alter table public.telegram_aviso_execucoes enable row level security;

revoke all on table public.telegram_aviso_execucoes from public;
revoke all on table public.telegram_aviso_execucoes from anon;
revoke all on table public.telegram_aviso_execucoes from authenticated;
grant all on table public.telegram_aviso_execucoes to service_role;

do $$
declare
  chave_attnum smallint;
begin
  select attnum
    into chave_attnum
  from pg_attribute
  where attrelid = 'public.configuracoes'::regclass
    and attname = 'chave'
    and not attisdropped;

  if exists (
    select 1
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'public.configuracoes'::regclass
      and chave_attnum = any(c.confkey)
  ) then
    raise exception 'Nao foi possivel substituir configuracoes_pkey: existe foreign key referenciando public.configuracoes(chave). Remova ou ajuste a dependencia manualmente antes de aplicar esta migration.';
  end if;

  if exists (
    select 1
    from public.configuracoes
    group by workspace_id, chave
    having count(*) > 1
  ) then
    raise exception 'Configuracoes possui duplicidades por workspace_id/chave. Resolva manualmente antes de aplicar a primary key composta configuracoes_pkey.';
  end if;

  if exists (
    select 1
    from public.configuracoes
    where workspace_id is null
       or chave is null
  ) then
    raise exception 'Configuracoes possui workspace_id ou chave nulos. Resolva manualmente antes de aplicar a primary key composta configuracoes_pkey.';
  end if;

  alter table public.configuracoes
    drop constraint if exists configuracoes_pkey;

  alter table public.configuracoes
    add constraint configuracoes_pkey primary key (workspace_id, chave);
end;
$$;

create index if not exists workspace_members_user_id_idx
  on public.workspace_members (user_id);

create index if not exists titulares_workspace_id_idx
  on public.titulares (workspace_id);

create index if not exists centros_custo_workspace_id_idx
  on public.centros_custo (workspace_id);

create index if not exists categorias_workspace_id_idx
  on public.categorias (workspace_id);

create index if not exists contas_workspace_id_idx
  on public.contas (workspace_id);

create index if not exists lancamentos_workspace_id_idx
  on public.lancamentos (workspace_id);

create index if not exists contas_titulares_workspace_id_idx
  on public.contas_titulares (workspace_id);

create index if not exists configuracoes_workspace_id_idx
  on public.configuracoes (workspace_id);

create index if not exists telegram_aviso_execucoes_workspace_id_idx
  on public.telegram_aviso_execucoes (workspace_id);
