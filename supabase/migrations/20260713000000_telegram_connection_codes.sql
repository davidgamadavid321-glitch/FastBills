create table if not exists public.telegram_connection_codes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists telegram_connection_codes_workspace_id_idx
  on public.telegram_connection_codes (workspace_id);

create index if not exists telegram_connection_codes_user_id_idx
  on public.telegram_connection_codes (user_id);

create index if not exists telegram_connection_codes_valid_code_idx
  on public.telegram_connection_codes (code)
  where used_at is null;

alter table public.telegram_connection_codes enable row level security;

revoke all on table public.telegram_connection_codes from public;
revoke all on table public.telegram_connection_codes from anon;
revoke all on table public.telegram_connection_codes from authenticated;
grant all on table public.telegram_connection_codes to service_role;

create or replace function public.gerar_codigo_conexao_telegram(p_workspace_id uuid)
returns table (
  code text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text;
  v_expires_at timestamptz := now() + interval '10 minutes';
begin
  if v_user_id is null then
    raise exception 'Usuario autenticado necessario para gerar codigo de conexao.';
  end if;

  if p_workspace_id is null or not public.usuario_pertence_ao_workspace(p_workspace_id) then
    raise exception 'Workspace invalido ou indisponivel para o usuario autenticado.';
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
        workspace_id,
        user_id,
        code,
        expires_at
      )
      values (
        p_workspace_id,
        v_user_id,
        v_code,
        v_expires_at
      );

      exit;
    exception
      when unique_violation then
        null;
    end;
  end loop;

  code := v_code;
  expires_at := v_expires_at;
  return next;
end;
$$;

revoke all on function public.gerar_codigo_conexao_telegram(uuid) from public;
revoke all on function public.gerar_codigo_conexao_telegram(uuid) from anon;
revoke all on function public.gerar_codigo_conexao_telegram(uuid) from authenticated;
grant execute on function public.gerar_codigo_conexao_telegram(uuid) to authenticated;

create or replace function public.conectar_telegram_por_codigo(
  p_code text,
  p_chat_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_chat_id text := btrim(coalesce(p_chat_id, ''));
  v_connection public.telegram_connection_codes%rowtype;
  v_config_valor text;
  v_chats jsonb := '[]'::jsonb;
  v_chats_atualizados jsonb := '[]'::jsonb;
  v_chat jsonb;
  v_chat_existe boolean := false;
  v_agora timestamptz := now();
begin
  if v_code = '' or v_chat_id = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_or_expired');
  end if;

  select *
    into v_connection
  from public.telegram_connection_codes
  where code = v_code
    and used_at is null
    and expires_at > v_agora
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_or_expired');
  end if;

  select valor
    into v_config_valor
  from public.configuracoes
  where workspace_id = v_connection.workspace_id
    and chave = 'telegram_chats'
  for update;

  begin
    v_chats := coalesce(v_config_valor::jsonb, '[]'::jsonb);
    if jsonb_typeof(v_chats) <> 'array' then
      v_chats := '[]'::jsonb;
    end if;
  exception
    when others then
      v_chats := '[]'::jsonb;
  end;

  v_chat := jsonb_build_object(
    'chat_id', v_chat_id,
    'nome', 'Telegram conectado',
    'connected_at', v_agora
  );

  select exists (
    select 1
    from jsonb_array_elements(v_chats) as item
    where item->>'chat_id' = v_chat_id
  )
    into v_chat_existe;

  if v_chat_existe then
    select coalesce(
      jsonb_agg(
        case
          when item->>'chat_id' = v_chat_id then v_chat
          else item
        end
      ),
      '[]'::jsonb
    )
      into v_chats_atualizados
    from jsonb_array_elements(v_chats) as item;
  else
    v_chats_atualizados := v_chats || jsonb_build_array(v_chat);
  end if;

  insert into public.configuracoes (
    workspace_id,
    chave,
    valor,
    atualizado_em
  )
  values (
    v_connection.workspace_id,
    'telegram_chats',
    v_chats_atualizados::text,
    v_agora
  )
  on conflict (workspace_id, chave)
  do update set
    valor = excluded.valor,
    atualizado_em = excluded.atualizado_em;

  update public.telegram_connection_codes
    set used_at = v_agora
    where id = v_connection.id;

  return jsonb_build_object(
    'ok', true,
    'workspace_id', v_connection.workspace_id::text
  );
end;
$$;

revoke all on function public.conectar_telegram_por_codigo(text, text) from public;
revoke all on function public.conectar_telegram_por_codigo(text, text) from anon;
revoke all on function public.conectar_telegram_por_codigo(text, text) from authenticated;
grant execute on function public.conectar_telegram_por_codigo(text, text) to service_role;
