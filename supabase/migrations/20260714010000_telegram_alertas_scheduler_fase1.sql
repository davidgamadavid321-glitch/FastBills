-- Fase 1: prepara avisos Telegram por horarios configuraveis sem ativar novo cron.

alter table public.telegram_aviso_execucoes
  add column if not exists slot text;

alter table public.telegram_aviso_execucoes
  drop constraint if exists telegram_aviso_execucoes_tipo_check;

alter table public.telegram_aviso_execucoes
  add constraint telegram_aviso_execucoes_tipo_check
  check (tipo in ('manha', 'tarde', 'scheduler'));

alter table public.telegram_aviso_execucoes
  drop constraint if exists telegram_aviso_execucoes_slot_check;

alter table public.telegram_aviso_execucoes
  add constraint telegram_aviso_execucoes_slot_check
  check (slot is null or slot ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- Mantem a deduplicacao do cron legado manha/tarde para registros sem slot.
drop index if exists public.telegram_aviso_execucoes_cron_workspace_dia_tipo_uidx;

create unique index telegram_aviso_execucoes_cron_workspace_dia_tipo_uidx
  on public.telegram_aviso_execucoes (
    workspace_id,
    data_referencia,
    tipo,
    origem
  )
  where origem = 'cron'
    and status <> 'erro'
    and slot is null;

-- Deduplicacao do scheduler novo por workspace, dia local e horario configurado.
create unique index if not exists telegram_aviso_execucoes_cron_workspace_dia_slot_uidx
  on public.telegram_aviso_execucoes (
    workspace_id,
    data_referencia,
    origem,
    slot
  )
  where origem = 'cron'
    and status <> 'erro'
    and slot is not null;

create or replace function public.invoke_telegram_avisos_scheduler()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  service_role_key text;
  request_id bigint;
begin
  select rtrim(btrim(decrypted_secret), '/')
    into project_url
  from vault.decrypted_secrets
  where name = 'supabase_project_url'
  limit 1;

  select regexp_replace(
           btrim(decrypted_secret),
           '^Bearer[[:space:]]+',
           '',
           'i'
         )
    into service_role_key
  from vault.decrypted_secrets
  where name = 'supabase_service_role_key'
  limit 1;

  if nullif(project_url, '') is null or nullif(service_role_key, '') is null then
    raise exception 'Configure os secrets supabase_project_url e supabase_service_role_key no Vault antes de ativar o scheduler.';
  end if;

  select net.http_post(
    url := project_url || '/functions/v1/enviar-avisos-telegram',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key,
      'apikey', service_role_key
    ),
    body := jsonb_build_object(
      'origem', 'cron',
      'modo', 'scheduler'
    )
  )
  into request_id;

  return request_id;
end;
$$;

revoke execute on function public.invoke_telegram_avisos_scheduler() from public;
revoke execute on function public.invoke_telegram_avisos_scheduler() from anon;
revoke execute on function public.invoke_telegram_avisos_scheduler() from authenticated;
