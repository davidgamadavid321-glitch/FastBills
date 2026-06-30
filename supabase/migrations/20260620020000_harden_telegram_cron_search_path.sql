-- Endurece a resolucao de objetos da funcao SECURITY DEFINER usada pelo Cron.
-- Mantem a assinatura e o comportamento funcional atuais.

create or replace function public.invoke_telegram_avisos_cron(tipo_aviso text)
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
  if tipo_aviso not in ('manha', 'tarde') then
    raise exception 'Tipo de aviso invalido.';
  end if;

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
    raise exception 'Configure os secrets supabase_project_url e supabase_service_role_key no Vault antes de ativar o cron.';
  end if;

  select net.http_post(
    url := project_url || '/functions/v1/enviar-avisos-telegram',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key,
      'apikey', service_role_key
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

revoke execute on function public.invoke_telegram_avisos_cron(text) from public;
revoke execute on function public.invoke_telegram_avisos_cron(text) from anon;
revoke execute on function public.invoke_telegram_avisos_cron(text) from authenticated;
