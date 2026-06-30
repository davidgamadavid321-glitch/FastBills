# Sistema de Gestao de Contas

Sistema web para gestao de contas domesticas e imobiliarias, com organizacao por workspaces, imoveis, titulares, categorias, lancamentos, comprovantes e avisos automatizados via Telegram.

## Funcionalidades

- Cadastro e gestao de contas recorrentes e avulsas.
- Organizacao por imoveis ou centros de custo.
- Cadastro de titulares responsaveis pelas contas.
- Cadastro de categorias de despesa.
- Geracao e acompanhamento de lancamentos.
- Controle de contas pendentes, pagas e vencidas.
- Calendario de vencimentos.
- Filtros na aba Contas por nome, imovel, titular, categoria, status e recorrencia.
- Agrupamento visual por vencidas, vencem hoje, proximas, futuras e pagas.
- Upload de comprovantes PDF.
- Avisos manuais e automaticos via Telegram.
- Cron de avisos com Supabase Cron e Edge Function.
- Multiworkspace com RLS por workspace.

## Stack

- React
- Vite
- TailwindCSS
- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Storage
- Supabase Edge Functions
- Telegram Bot API

## Estrutura

```text
src/                    Aplicacao React
src/pages/              Telas principais
src/components/         Componentes reutilizaveis
src/contexts/           Contextos da aplicacao
supabase/functions/     Edge Functions
supabase/migrations/    Migrations SQL
docs/                   Documentacao tecnica
```

## Rodar localmente

Instale as dependencias:

```bash
npm install
```

Crie um arquivo `.env` local com base em `.env.example` e configure:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Inicie o ambiente de desenvolvimento:

```bash
npm run dev
```

## Build

Para gerar o build de producao:

```bash
npm run build
```

Para visualizar o build localmente:

```bash
npm run preview
```

## Variaveis de ambiente

O frontend usa somente variaveis publicas do Vite:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Nao coloque tokens do Telegram, service-role key ou outros segredos em variaveis `VITE_*`, pois elas podem entrar no bundle do frontend.

## Deploy e Supabase

A documentacao detalhada de deploy, secrets, Cron, Edge Functions e validacoes do Supabase esta em:

[docs/DEPLOY_SUPABASE.md](docs/DEPLOY_SUPABASE.md)

## Seguranca

- RLS por workspace esta ativo.
- O bucket `comprovantes` e privado.
- PDFs e comprovantes devem ser acessados por URLs assinadas.
- Service-role key nunca deve ser exposta no frontend.
- Tokens e secrets nao devem ser commitados.
- A funcao `telegram-webhook` esta neutralizada.
- Avisos do Telegram rodam server-side por Edge Function.

## Status do projeto

O projeto esta em desenvolvimento ativo. A branch principal de trabalho atual e `dev-david`, com melhorias pequenas, testadas e commitadas separadamente.

## Documentacao tecnica

Para manutencao operacional, configuracao de secrets, deploy de Edge Functions e teste do Cron, consulte:

[docs/DEPLOY_SUPABASE.md](docs/DEPLOY_SUPABASE.md)

