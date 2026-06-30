-- Etapa 5: idempotencia e cooldown do Telegram por workspace.

drop index if exists public.telegram_aviso_execucoes_cron_dia_tipo_uidx;
drop index if exists public.telegram_aviso_execucoes_manual_iniciado_uidx;
drop index if exists public.telegram_aviso_execucoes_manual_cooldown_idx;

create unique index telegram_aviso_execucoes_cron_workspace_dia_tipo_uidx
  on public.telegram_aviso_execucoes (
    workspace_id,
    data_referencia,
    tipo,
    origem
  )
  where origem = 'cron'
    and status <> 'erro';

create unique index telegram_aviso_execucoes_manual_workspace_iniciado_uidx
  on public.telegram_aviso_execucoes (workspace_id)
  where origem = 'manual'
    and status = 'iniciado';

create index telegram_aviso_execucoes_manual_workspace_cooldown_idx
  on public.telegram_aviso_execucoes (
    workspace_id,
    origem,
    criado_em desc
  )
  where origem = 'manual'
    and status in ('iniciado', 'enviado', 'sem_destinatarios', 'sem_lancamentos');
