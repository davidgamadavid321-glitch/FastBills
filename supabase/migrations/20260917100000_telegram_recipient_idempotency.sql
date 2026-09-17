-- Idempotencia de avisos por execucao logica e destinatario.

create table if not exists public.telegram_aviso_destinatarios (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  chave_execucao text not null,
  chat_id text not null,
  status text not null check (status in ('iniciado', 'enviado', 'erro')),
  erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (workspace_id, chave_execucao, chat_id)
);

create index if not exists telegram_aviso_destinatarios_workspace_idx
  on public.telegram_aviso_destinatarios (workspace_id, atualizado_em desc);

alter table public.telegram_aviso_destinatarios enable row level security;

revoke all on table public.telegram_aviso_destinatarios from public;
revoke all on table public.telegram_aviso_destinatarios from anon;
revoke all on table public.telegram_aviso_destinatarios from authenticated;
grant all on table public.telegram_aviso_destinatarios to service_role;

create or replace function public.reservar_envio_telegram(
  p_workspace_id uuid,
  p_chave_execucao text,
  p_chat_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.telegram_aviso_destinatarios (
    workspace_id,
    chave_execucao,
    chat_id,
    status
  ) values (
    p_workspace_id,
    p_chave_execucao,
    p_chat_id,
    'iniciado'
  )
  on conflict (workspace_id, chave_execucao, chat_id)
  do update set
    status = 'iniciado',
    erro = null,
    atualizado_em = now()
  where telegram_aviso_destinatarios.status = 'erro'
     or (
       telegram_aviso_destinatarios.status = 'iniciado'
       and telegram_aviso_destinatarios.atualizado_em < now() - interval '15 minutes'
     )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.reservar_envio_telegram(uuid, text, text) from public;
revoke all on function public.reservar_envio_telegram(uuid, text, text) from anon;
revoke all on function public.reservar_envio_telegram(uuid, text, text) from authenticated;
grant execute on function public.reservar_envio_telegram(uuid, text, text) to service_role;

create or replace function public.finalizar_envio_telegram(
  p_id uuid,
  p_status text,
  p_erro text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('enviado', 'erro') then
    raise exception 'Status final de envio invalido.';
  end if;

  update public.telegram_aviso_destinatarios
    set status = p_status,
        erro = case when p_status = 'erro' then p_erro else null end,
        atualizado_em = now()
  where id = p_id;

  if not found then
    raise exception 'Reserva de envio nao encontrada.';
  end if;
end;
$$;

revoke all on function public.finalizar_envio_telegram(uuid, text, text) from public;
revoke all on function public.finalizar_envio_telegram(uuid, text, text) from anon;
revoke all on function public.finalizar_envio_telegram(uuid, text, text) from authenticated;
grant execute on function public.finalizar_envio_telegram(uuid, text, text) to service_role;
