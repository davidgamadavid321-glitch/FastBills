-- Matriz de permissoes: owner/admin operam; member consulta, paga e anexa PDF.

grant execute on function public.papel_usuario_no_workspace(uuid) to authenticated;
grant execute on function public.usuario_administra_workspace(uuid) to authenticated;
grant execute on function public.usuario_e_owner_workspace(uuid) to authenticated;

do $$
declare
  v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'workspaces', 'workspace_members', 'titulares', 'centros_custo',
        'categorias', 'contas', 'lancamentos', 'contas_titulares', 'configuracoes'
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );
  end loop;
end;
$$;

revoke all on table public.workspaces from authenticated;
grant select, update, delete on table public.workspaces to authenticated;

create policy "Membros podem ver workspaces"
  on public.workspaces for select to authenticated
  using (public.usuario_pertence_ao_workspace(id));

create policy "Owner pode atualizar workspace"
  on public.workspaces for update to authenticated
  using (public.usuario_e_owner_workspace(id))
  with check (public.usuario_e_owner_workspace(id));

create policy "Owner pode excluir workspace"
  on public.workspaces for delete to authenticated
  using (public.usuario_e_owner_workspace(id));

revoke all on table public.workspace_members from authenticated;
grant select, insert, update, delete on table public.workspace_members to authenticated;

create policy "Membros podem ver memberships do workspace"
  on public.workspace_members for select to authenticated
  using (public.usuario_pertence_ao_workspace(workspace_id));

create policy "Owner pode inserir memberships"
  on public.workspace_members for insert to authenticated
  with check (public.usuario_e_owner_workspace(workspace_id));

create policy "Owner pode atualizar memberships"
  on public.workspace_members for update to authenticated
  using (public.usuario_e_owner_workspace(workspace_id))
  with check (public.usuario_e_owner_workspace(workspace_id));

create policy "Owner pode excluir memberships"
  on public.workspace_members for delete to authenticated
  using (public.usuario_e_owner_workspace(workspace_id));

do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array array[
    'titulares', 'centros_custo', 'categorias', 'contas',
    'contas_titulares', 'configuracoes'
  ] loop
    execute format('revoke all on table public.%I from authenticated', v_tabela);
    execute format(
      'grant select, insert, update, delete on table public.%I to authenticated',
      v_tabela
    );
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.usuario_pertence_ao_workspace(workspace_id))',
      'Membros podem ver ' || v_tabela || ' do workspace',
      v_tabela
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.usuario_administra_workspace(workspace_id))',
      'Administradores podem inserir ' || v_tabela,
      v_tabela
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.usuario_administra_workspace(workspace_id)) with check (public.usuario_administra_workspace(workspace_id))',
      'Administradores podem atualizar ' || v_tabela,
      v_tabela
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.usuario_administra_workspace(workspace_id))',
      'Administradores podem excluir ' || v_tabela,
      v_tabela
    );
  end loop;
end;
$$;

revoke all on table public.lancamentos from authenticated;
grant select, insert, update, delete on table public.lancamentos to authenticated;

create policy "Membros podem ver lancamentos do workspace"
  on public.lancamentos for select to authenticated
  using (public.usuario_pertence_ao_workspace(workspace_id));

create policy "Administradores podem inserir lancamentos"
  on public.lancamentos for insert to authenticated
  with check (public.usuario_administra_workspace(workspace_id));

create policy "Membros podem atualizar lancamentos"
  on public.lancamentos for update to authenticated
  using (public.usuario_pertence_ao_workspace(workspace_id))
  with check (public.usuario_pertence_ao_workspace(workspace_id));

create policy "Administradores podem excluir lancamentos"
  on public.lancamentos for delete to authenticated
  using (public.usuario_administra_workspace(workspace_id));

create or replace function public.validar_atualizacao_lancamento_por_papel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.usuario_administra_workspace(old.workspace_id) then
    return new;
  end if;

  if not public.usuario_pertence_ao_workspace(old.workspace_id) then
    raise exception 'Lancamento indisponivel para o usuario autenticado.';
  end if;

  if (to_jsonb(new) - array['status', 'data_pagamento', 'pdf_url', 'alterado_por', 'alterado_em'])
     is distinct from
     (to_jsonb(old) - array['status', 'data_pagamento', 'pdf_url', 'alterado_por', 'alterado_em']) then
    raise exception 'Membros podem alterar apenas pagamento e comprovante.';
  end if;

  return new;
end;
$$;

revoke all on function public.validar_atualizacao_lancamento_por_papel() from public, anon, authenticated;

drop trigger if exists validar_atualizacao_lancamento_por_papel on public.lancamentos;
create trigger validar_atualizacao_lancamento_por_papel
before update on public.lancamentos
for each row execute function public.validar_atualizacao_lancamento_por_papel();

drop policy if exists "Membros podem excluir comprovantes do workspace" on storage.objects;
create policy "Administradores podem excluir comprovantes do workspace"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'comprovantes'
    and public.usuario_administra_workspace(
      public.uuid_seguro((storage.foldername(name))[1])
    )
  );

-- Troca de titular e conexao Telegram tambem precisam respeitar a matriz
-- quando chamadas diretamente pela API.
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
    raise exception 'Data de referencia obrigatoria.';
  end if;
  if auth.uid() is null or not public.usuario_administra_workspace(p_workspace_id) then
    raise exception 'Somente administradores podem trocar o titular.';
  end if;

  select titular_id into v_titular_atual
  from public.contas
  where id = p_conta_id and workspace_id = p_workspace_id
  for update;
  if not found then raise exception 'Conta nao encontrada neste workspace.'; end if;

  if p_novo_titular_id is not null and not exists (
    select 1 from public.titulares
    where id = p_novo_titular_id and workspace_id = p_workspace_id
  ) then
    raise exception 'Titular nao pertence a este workspace.';
  end if;

  select count(*) into v_historicos_ativos
  from public.contas_titulares
  where conta_id = p_conta_id and workspace_id = p_workspace_id and fim is null;
  if v_historicos_ativos > 1 then
    raise exception 'Existe mais de um historico ativo para esta conta.';
  end if;

  v_alterado := p_novo_titular_id is distinct from v_titular_atual;
  if v_alterado then
    update public.contas_titulares
    set fim = p_hoje
    where conta_id = p_conta_id and workspace_id = p_workspace_id and fim is null;

    update public.contas set titular_id = p_novo_titular_id
    where id = p_conta_id and workspace_id = p_workspace_id;

    if p_novo_titular_id is not null then
      insert into public.contas_titulares (
        conta_id, titular_id, inicio, fim, workspace_id
      ) values (p_conta_id, p_novo_titular_id, p_hoje, null, p_workspace_id);
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

create or replace function public.gerar_codigo_conexao_telegram(p_workspace_id uuid)
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text;
  v_expires_at timestamptz := now() + interval '10 minutes';
begin
  if v_user_id is null or not public.usuario_administra_workspace(p_workspace_id) then
    raise exception 'Somente administradores podem configurar o Telegram.';
  end if;

  update public.telegram_connection_codes
  set used_at = now()
  where workspace_id = p_workspace_id
    and user_id = v_user_id
    and used_at is null;

  loop
    v_code := 'FB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    begin
      insert into public.telegram_connection_codes (
        workspace_id, user_id, code, expires_at
      ) values (p_workspace_id, v_user_id, v_code, v_expires_at);
      exit;
    exception when unique_violation then null;
    end;
  end loop;

  code := v_code;
  expires_at := v_expires_at;
  return next;
end;
$$;
