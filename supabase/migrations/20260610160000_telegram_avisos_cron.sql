create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create table if not exists public.telegram_aviso_execucoes (
  id uuid primary key default gen_random_uuid(),
  data_referencia date not null,
  tipo text not null check (tipo in ('manha', 'tarde')),
  origem text not null check (origem in ('cron', 'manual')),
  status text not null check (
    status in ('iniciado', 'enviado', 'sem_destinatarios', 'sem_lancamentos', 'erro')
  ),
  total_chats integer,
  total_envios integer,
  total_lancamentos integer,
  erro text,
  criado_em timestamptz not null default now(),
  finalizado_em timestamptz
);

create unique index if not exists telegram_aviso_execucoes_cron_dia_tipo_uidx
  on public.telegram_aviso_execucoes (data_referencia, tipo)
  where origem = 'cron' and status <> 'erro';

create or replace function public.invoke_telegram_avisos_cron(tipo_aviso text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  project_url text;
  service_role_key text;
  request_id bigint;
begin
  select decrypted_secret
    into project_url
  from vault.decrypted_secrets
  where name = 'supabase_project_url'
  limit 1;

  select decrypted_secret
    into service_role_key
  from vault.decrypted_secrets
  where name = 'supabase_service_role_key'
  limit 1;

  if project_url is null or service_role_key is null then
    raise exception 'Configure os secrets supabase_project_url e supabase_service_role_key no Vault antes de ativar o cron.';
  end if;

  select net.http_post(
    url := project_url || '/functions/v1/enviar-avisos-telegram',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    ),
    body := jsonb_build_object(
      'tipo', tipo_aviso,
      'origem', 'cron'
    )
  )
  into request_id;

  return request_id;
end;
$$;

select cron.unschedule('telegram-aviso-manha')
where exists (
  select 1 from cron.job where jobname = 'telegram-aviso-manha'
);

select cron.unschedule('telegram-aviso-tarde')
where exists (
  select 1 from cron.job where jobname = 'telegram-aviso-tarde'
);

-- Supabase Cron executa em UTC. 08:00 America/Sao_Paulo = 11:00 UTC.
select cron.schedule(
  'telegram-aviso-manha',
  '0 11 * * *',
  $$select public.invoke_telegram_avisos_cron('manha');$$
);

-- Supabase Cron executa em UTC. 19:00 America/Sao_Paulo = 22:00 UTC.
select cron.schedule(
  'telegram-aviso-tarde',
  '0 22 * * *',
  $$select public.invoke_telegram_avisos_cron('tarde');$$
);
