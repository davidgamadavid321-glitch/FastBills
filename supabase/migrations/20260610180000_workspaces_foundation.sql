create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  papel text not null default 'owner',
  criado_em timestamptz not null default now(),
  primary key (workspace_id, user_id),
  constraint workspace_members_papel_check check (papel in ('owner', 'admin', 'member'))
);

create index if not exists workspace_members_user_id_idx
  on public.workspace_members (user_id);

create index if not exists workspace_members_papel_idx
  on public.workspace_members (papel);

create or replace function public.usuario_pertence_ao_workspace(workspace_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = workspace_uuid
        and wm.user_id = auth.uid()
    );
$$;

create or replace function public.workspace_atual_do_usuario()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  usuario_id uuid := auth.uid();
  workspace_uuid uuid;
  total integer;
begin
  if usuario_id is null then
    raise exception 'Usuario autenticado necessario para resolver workspace.';
  end if;

  select count(*)
    into total
  from public.workspace_members wm
  where wm.user_id = usuario_id;

  if total = 0 then
    raise exception 'Usuario autenticado nao possui workspace.';
  end if;

  if total > 1 then
    raise exception 'Usuario possui mais de um workspace; informe workspace_id explicitamente.';
  end if;

  select wm.workspace_id
    into workspace_uuid
  from public.workspace_members wm
  where wm.user_id = usuario_id
  limit 1;

  return workspace_uuid;
end;
$$;

create or replace function public.preencher_workspace_id_temporario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_uuid uuid;
  total integer;
begin
  if tg_op = 'UPDATE' then
    if new.workspace_id is distinct from old.workspace_id then
      raise exception 'workspace_id nao pode ser alterado por esta operacao.';
    end if;

    return new;
  end if;

  if tg_op <> 'INSERT' then
    return new;
  end if;

  if new.workspace_id is not null then
    if auth.role() = 'service_role' then
      return new;
    end if;

    if public.usuario_pertence_ao_workspace(new.workspace_id) then
      return new;
    end if;

    raise exception 'workspace_id informado nao pertence ao usuario autenticado.';
  end if;

  if auth.uid() is not null then
    new.workspace_id := public.workspace_atual_do_usuario();
    return new;
  end if;

  if auth.role() <> 'service_role' then
    raise exception 'Usuario autenticado necessario para preencher workspace_id.';
  end if;

  -- Compatibilidade temporaria para rotinas server-side existentes.
  -- Aceita somente service_role e nao escolhe workspace quando houver ambiguidade.
  select count(*)
    into total
  from public.workspaces;

  if total = 1 then
    select id
      into workspace_uuid
    from public.workspaces
    limit 1;

    new.workspace_id := workspace_uuid;
    return new;
  end if;

  raise exception 'workspace_id obrigatorio para operacao service_role quando houver zero ou multiplos workspaces.';
end;
$$;

revoke all on function public.usuario_pertence_ao_workspace(uuid) from public;
revoke all on function public.usuario_pertence_ao_workspace(uuid) from anon;
revoke all on function public.usuario_pertence_ao_workspace(uuid) from authenticated;
revoke all on function public.workspace_atual_do_usuario() from public;
revoke all on function public.workspace_atual_do_usuario() from anon;
revoke all on function public.workspace_atual_do_usuario() from authenticated;
revoke all on function public.preencher_workspace_id_temporario() from public;
revoke all on function public.preencher_workspace_id_temporario() from anon;
revoke all on function public.preencher_workspace_id_temporario() from authenticated;

grant execute on function public.usuario_pertence_ao_workspace(uuid) to authenticated;
grant execute on function public.workspace_atual_do_usuario() to authenticated;

revoke all on table public.workspaces from public;
revoke all on table public.workspaces from anon;
revoke all on table public.workspaces from authenticated;
grant select on table public.workspaces to authenticated;

revoke all on table public.workspace_members from public;
revoke all on table public.workspace_members from anon;
revoke all on table public.workspace_members from authenticated;
grant select on table public.workspace_members to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

drop policy if exists "Membros podem ver seus workspaces" on public.workspaces;
create policy "Membros podem ver seus workspaces"
  on public.workspaces
  for select
  to authenticated
  using (public.usuario_pertence_ao_workspace(id));

drop policy if exists "Membros podem ver participantes do workspace" on public.workspace_members;
create policy "Membros podem ver participantes do workspace"
  on public.workspace_members
  for select
  to authenticated
  using (public.usuario_pertence_ao_workspace(workspace_id));

do $$
declare
  tabelas text[] := array[
    'titulares',
    'centros_custo',
    'categorias',
    'contas',
    'lancamentos',
    'contas_titulares',
    'configuracoes',
    'telegram_aviso_execucoes'
  ];
  tabela text;
  constraint_nome text;
begin
  foreach tabela in array tabelas loop
    if to_regclass(format('public.%I', tabela)) is not null then
      execute format('alter table public.%I add column if not exists workspace_id uuid', tabela);

      constraint_nome := tabela || '_workspace_id_fkey';
      if not exists (
        select 1
        from pg_constraint
        where conrelid = to_regclass(format('public.%I', tabela))
          and conname = constraint_nome
      ) then
        execute format(
          'alter table public.%I add constraint %I foreign key (workspace_id) references public.workspaces(id) on delete restrict',
          tabela,
          constraint_nome
        );
      end if;

      execute format(
        'create index if not exists %I on public.%I (workspace_id)',
        tabela || '_workspace_id_idx',
        tabela
      );
    end if;
  end loop;
end;
$$;

do $$
declare
  total_usuarios integer;
  total_workspaces integer;
  owner_id uuid;
  workspace_uuid uuid;
begin
  select count(*)
    into total_usuarios
  from auth.users;

  if total_usuarios = 0 then
    raise exception 'Backfill de workspace interrompido: nenhum usuario encontrado em auth.users. Crie/identifique o owner manualmente antes de aplicar esta migration.';
  end if;

  if total_usuarios > 1 then
    raise exception 'Backfill de workspace interrompido: mais de um usuario encontrado em auth.users. Crie o workspace inicial manualmente para evitar atribuir dados ao owner errado.';
  end if;

  select id
    into owner_id
  from auth.users
  limit 1;

  select count(*)
    into total_workspaces
  from public.workspaces;

  if total_workspaces = 0 then
    insert into public.workspaces (nome, criado_por)
    values ('Workspace principal', owner_id)
    returning id into workspace_uuid;
  elsif total_workspaces > 1 then
    raise exception 'Backfill de workspace interrompido: mais de um workspace existente. Preencha workspace_id manualmente antes de reaplicar.';
  else
    select id
      into workspace_uuid
    from public.workspaces
    limit 1;
  end if;

  insert into public.workspace_members (workspace_id, user_id, papel)
  values (workspace_uuid, owner_id, 'owner')
  on conflict (workspace_id, user_id) do update
    set papel = excluded.papel;

  if to_regclass('public.titulares') is not null then
    update public.titulares
      set workspace_id = workspace_uuid
      where workspace_id is null;
  end if;

  if to_regclass('public.centros_custo') is not null then
    update public.centros_custo
      set workspace_id = workspace_uuid
      where workspace_id is null;
  end if;

  if to_regclass('public.categorias') is not null then
    update public.categorias
      set workspace_id = workspace_uuid
      where workspace_id is null;
  end if;

  if to_regclass('public.contas') is not null then
    update public.contas
      set workspace_id = workspace_uuid
      where workspace_id is null;
  end if;

  if to_regclass('public.lancamentos') is not null then
    update public.lancamentos l
      set workspace_id = c.workspace_id
      from public.contas c
      where l.conta_id = c.id
        and l.workspace_id is null
        and c.workspace_id is not null;

    update public.lancamentos
      set workspace_id = workspace_uuid
      where workspace_id is null;
  end if;

  if to_regclass('public.contas_titulares') is not null then
    update public.contas_titulares ct
      set workspace_id = c.workspace_id
      from public.contas c
      where ct.conta_id = c.id
        and ct.workspace_id is null
        and c.workspace_id is not null;

    update public.contas_titulares
      set workspace_id = workspace_uuid
      where workspace_id is null;
  end if;

  if to_regclass('public.configuracoes') is not null then
    update public.configuracoes
      set workspace_id = workspace_uuid
      where workspace_id is null;
  end if;

  if to_regclass('public.telegram_aviso_execucoes') is not null then
    update public.telegram_aviso_execucoes
      set workspace_id = workspace_uuid
      where workspace_id is null;
  end if;
end;
$$;

do $$
declare
  tabelas text[] := array[
    'titulares',
    'centros_custo',
    'categorias',
    'contas',
    'lancamentos',
    'contas_titulares',
    'configuracoes',
    'telegram_aviso_execucoes'
  ];
  tabela text;
begin
  foreach tabela in array tabelas loop
    if to_regclass(format('public.%I', tabela)) is not null then
      execute format(
        'alter table public.%I alter column workspace_id set not null',
        tabela
      );

      execute format(
        'drop trigger if exists preencher_workspace_id_temporario on public.%I',
        tabela
      );

      execute format(
        'create trigger preencher_workspace_id_temporario before insert or update on public.%I for each row execute function public.preencher_workspace_id_temporario()',
        tabela
      );
    end if;
  end loop;
end;
$$;
