# Deploy e configuracao do Supabase

Este documento resume como configurar, validar e manter o deploy do projeto com Supabase, Edge Functions, Cron e Telegram.

## Pre-requisitos

- Node.js instalado.
- npm instalado.
- Supabase CLI instalada e autenticada.
- Acesso ao projeto Supabase correto.
- Acesso ao bot do Telegram e ao token do bot.
- Docker instalado quando for necessario rodar recursos locais do Supabase ou testar funcoes localmente.

## Variaveis do frontend

O frontend usa variaveis `VITE_*`, carregadas pelo Vite a partir do arquivo `.env` local.

Crie um `.env` local com base em `.env.example`:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Use:

- `VITE_SUPABASE_URL`: URL publica do projeto Supabase.
- `VITE_SUPABASE_ANON_KEY`: chave anon/public do projeto Supabase.

Nunca coloque service-role, token do Telegram ou outros segredos em variaveis `VITE_*`. Tudo que comeca com `VITE_` pode entrar no bundle do frontend.

## Secrets das Edge Functions

As Edge Functions devem receber segredos pelo gerenciador de secrets do Supabase, nunca por arquivos versionados.

Secrets usados pela funcao `enviar-avisos-telegram`:

- `TELEGRAM_BOT_TOKEN`: token do bot do Telegram.
- `CRON_SERVICE_ROLE_KEY`: service-role key usada pela chamada interna do Cron para autenticar a origem `cron`.

Configure sem valores reais no repositorio:

```bash
supabase secrets set TELEGRAM_BOT_TOKEN="SEU_TOKEN_DO_BOT"
supabase secrets set CRON_SERVICE_ROLE_KEY="SUA_SERVICE_ROLE_KEY"
```

O valor de `CRON_SERVICE_ROLE_KEY` deve ser a mesma service-role key salva no Vault do banco como `supabase_service_role_key`.

Observacao: nao use um secret customizado chamado `SUPABASE_SERVICE_ROLE_KEY`; a CLI do Supabase pode rejeitar nomes customizados iniciados com `SUPABASE_`.

## Secrets no Vault do banco

A funcao SQL do Cron le secrets pelo Vault do banco para chamar a Edge Function via `pg_net`.

Secrets esperados no Vault:

- `supabase_project_url`: URL do projeto Supabase.
- `supabase_service_role_key`: service-role key usada para montar os headers da chamada HTTP.

Esses valores devem ser criados ou atualizados pelo SQL Editor ou pela interface de Vault do projeto Supabase. Nao grave esses valores em migrations, `.env`, `.env.example` ou qualquer arquivo versionado.

A service-role nunca deve ir para o frontend.

## Comandos uteis

Instalar dependencias:

```bash
npm install
```

Rodar o frontend em desenvolvimento:

```bash
npm run dev
```

Gerar build de producao:

```bash
npm run build
```

Verificar status local do Supabase:

```bash
supabase status
```

Aplicar migrations quando necessario:

```bash
supabase db push
```

Deploy da funcao de avisos:

```bash
supabase functions deploy enviar-avisos-telegram
```

Deploy do webhook do Telegram, se esse arquivo for alterado:

```bash
supabase functions deploy telegram-webhook
```

## Cron de avisos do Telegram

O Supabase Cron chama a funcao SQL:

```sql
select public.invoke_telegram_avisos_cron('manha');
select public.invoke_telegram_avisos_cron('tarde');
```

A funcao SQL chama a Edge Function:

```text
/functions/v1/enviar-avisos-telegram
```

Os horarios do Supabase Cron ficam em UTC. No projeto, os horarios foram configurados para equivaler ao horario de Brasilia:

- Manha: `11:00 UTC`, aproximadamente `08:00` em `America/Sao_Paulo`.
- Tarde: `22:00 UTC`, aproximadamente `19:00` em `America/Sao_Paulo`.

Para testar manualmente a chamada da manha:

```sql
select public.invoke_telegram_avisos_cron('manha');
```

Para testar manualmente a chamada da tarde:

```sql
select public.invoke_telegram_avisos_cron('tarde');
```

## Validacao do Cron

Apos chamar a funcao SQL, valide a resposta HTTP registrada pelo `pg_net`:

```sql
select id, status_code, error_msg, content, created
from net._http_response
order by created desc
limit 5;
```

O esperado e `status_code = 200`.

Tambem e possivel conferir o historico de execucoes:

```sql
select workspace_id, data_referencia, tipo, origem, status,
       total_chats, total_envios, total_lancamentos,
       criado_em, finalizado_em
from public.telegram_aviso_execucoes
order by criado_em desc
limit 20;
```

Para chamadas automaticas, o esperado e:

- `origem = 'cron'`;
- `workspace_id` preenchido;
- `status` coerente com o resultado da execucao.

## Deploy seguro

Fluxo recomendado:

1. Confirmar que esta na branch correta.
2. Atualizar dependencias somente se necessario.
3. Configurar `.env` local sem secrets privados.
4. Rodar:

   ```bash
   npm run build
   ```

5. Aplicar migrations somente quando houver migration nova ou pendente:

   ```bash
   supabase db push
   ```

6. Deployar somente Edge Functions alteradas:

   ```bash
   supabase functions deploy enviar-avisos-telegram
   ```

   ```bash
   supabase functions deploy telegram-webhook
   ```

7. Testar envio manual na tela Avisos.
8. Testar o Cron pelo SQL Editor.
9. Conferir `net._http_response`.
10. Conferir `telegram_aviso_execucoes`.
11. Commitar e fazer push somente depois da validacao.

## Observacoes de seguranca

- Nao commitar `.env`.
- Nao colocar service-role no frontend.
- Nao colocar token do Telegram no frontend.
- Nao usar variaveis `VITE_*` para segredos.
- `telegram-webhook` esta neutralizado e nao deve executar acoes privilegiadas.
- O bucket `comprovantes` e privado.
- PDFs e comprovantes devem usar URL assinada quando precisarem ser acessados pelo usuario.
- RLS por workspace esta ativo.
- Secrets nao devem aparecer em logs, respostas HTTP, migrations ou arquivos versionados.

