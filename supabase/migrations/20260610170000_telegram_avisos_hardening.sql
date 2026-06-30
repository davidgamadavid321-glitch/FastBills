revoke execute on function public.invoke_telegram_avisos_cron(text) from public;
revoke execute on function public.invoke_telegram_avisos_cron(text) from anon;
revoke execute on function public.invoke_telegram_avisos_cron(text) from authenticated;

-- Evita dois envios manuais simultaneos. O cooldown adicional e aplicado na Edge Function.
create unique index if not exists telegram_aviso_execucoes_manual_iniciado_uidx
  on public.telegram_aviso_execucoes ((origem))
  where origem = 'manual' and status = 'iniciado';

create index if not exists telegram_aviso_execucoes_manual_cooldown_idx
  on public.telegram_aviso_execucoes (origem, criado_em desc)
  where origem = 'manual'
    and status in ('iniciado', 'enviado', 'sem_destinatarios', 'sem_lancamentos');
