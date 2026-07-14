-- Fase 3: ativa o scheduler central dos avisos Telegram e desativa os crons fixos.

create extension if not exists pg_cron with schema extensions;

select cron.unschedule('telegram-aviso-manha')
where exists (
  select 1 from cron.job where jobname = 'telegram-aviso-manha'
);

select cron.unschedule('telegram-aviso-tarde')
where exists (
  select 1 from cron.job where jobname = 'telegram-aviso-tarde'
);

select cron.unschedule('telegram-aviso-scheduler')
where exists (
  select 1 from cron.job where jobname = 'telegram-aviso-scheduler'
);

select cron.schedule(
  'telegram-aviso-scheduler',
  '*/15 * * * *',
  $$select public.invoke_telegram_avisos_scheduler();$$
);
