# Testes Manuais

Checklist para validar o sistema antes de mergear `dev-david` na `main`.

Não substitui testes automatizados (não existem no projeto ainda). É uma
verificação manual do fluxo principal do app antes de liberar uma versão.

---

## 1. Preparação

- [ ] Está na branch correta (`dev-david`)
- [ ] Dependências instaladas
- [ ] App sobe em modo desenvolvimento
- [ ] Build de produção passa sem erro
- [ ] Existe um usuário de teste (não usar conta de produção real)
- [ ] Workspace do usuário de teste carrega normalmente após login

```bash
git status
git branch --show-current
npm install
npm run dev
npm run build
```

---

## 2. Login

- [ ] Login com e-mail/senha válidos funciona e redireciona pro app
- [ ] Login com e-mail/senha inválidos mostra "E-mail ou senha inválidos."
  (sem mensagem técnica crua)
- [ ] Logout (botão "Sair") funciona e volta pra tela de login

---

## 3. Onboarding

- [ ] Workspace novo, sem imóvel/titular/categoria, cai na tela de onboarding
- [ ] Consegue cadastrar um imóvel pela tela de onboarding
- [ ] Consegue cadastrar um titular pela tela de onboarding
- [ ] Consegue cadastrar uma categoria pela tela de onboarding
- [ ] Botão "Tudo pronto, começar" só libera com pelo menos 1 item cadastrado
  (imóvel, titular ou categoria)
- [ ] Ao confirmar, redireciona corretamente pro Dashboard (`/`)

---

## 4. Dashboard

- [ ] Calendário carrega normalmente ao abrir a tela
- [ ] Navegação mês anterior / próximo mês funciona
- [ ] Dia atual aparece destacado visualmente
- [ ] Contas pagas, pendentes e vencidas aparecem com cor/status corretos no dia
- [ ] Se a query falhar, aparece "Não foi possível carregar o calendário.
  Tente novamente." (não fica calendário vazio sem explicação)

---

## 5. Imóveis

- [ ] Lista de imóveis carrega normalmente
- [ ] Consegue criar um novo imóvel
- [ ] Consegue editar um imóvel existente
- [ ] Interface usa sempre o termo "Imóvel" / "Imóveis" (nunca "centro de custo")
- [ ] Se a query falhar, aparece "Não foi possível carregar os imóveis.
  Tente novamente."

---

## 6. Contas

### Criação

- [ ] Criar conta geral, sem imóvel vinculado
- [ ] Criar conta vinculada a um imóvel
- [ ] Criar conta sem titular vinculado

### Filtros

- [ ] Busca por nome
- [ ] Filtro por imóvel específico
- [ ] Filtro "Geral / Sem imóvel"
- [ ] Filtro por titular específico
- [ ] Filtro "Sem titular"
- [ ] Filtro por categoria
- [ ] Filtro por status/contrato
- [ ] Filtro por recorrência
- [ ] Botão "Limpar filtros" reseta tudo

### Agrupamento por vencimento

- [ ] Grupo 🔴 Vencidas
- [ ] Grupo 🟡 Vencem hoje
- [ ] Grupo 🟢 Próximas
- [ ] Grupo ⚪ Futuras
- [ ] Grupo ✅ Pagas

### Garantias de classificação (crítico — não pode regredir)

- [ ] Conta com lançamento pago **não** aparece em Vencidas
- [ ] Conta com lançamento pendente **não** aparece em Pagas
- [ ] Conta com lançamento pendente/vencido real **não** cai em Futuras
  por causa de recorrência calculada

### Seleção e exclusão

- [ ] Seleção em lote funciona
- [ ] "Selecionar visíveis" respeita os filtros/grupos atuais na tela
- [ ] Exclusão individual funciona
- [ ] Exclusão em lote funciona

---

## 7. Lançamento / Detalhe

- [ ] Abrir detalhe de um lançamento
- [ ] Marcar lançamento como pago
- [ ] Anexar comprovante PDF
- [ ] Abrir comprovante já anexado (URL assinada abre em nova aba)
- [ ] Comprovante em formato antigo mostra aviso de migração, não erro cru
- [ ] Trocar titular do lançamento/conta
- [ ] Excluir lançamento (só este / todos os futuros, quando recorrente)
- [ ] Mensagens de erro amigáveis em cada uma das ações acima (sem
  `error.message` técnico na tela)

---

## 8. Resumo

- [ ] Tela de Resumo carrega valores do ano/período selecionado
- [ ] Totais e médias batem com o esperado (checagem visual)
- [ ] Detalhe por mês expande e mostra por imóvel/titular/contas pagas
- [ ] Se a query falhar, aparece "Não foi possível carregar o resumo.
  Tente novamente."

---

## 9. Avisos Telegram

- [ ] Tela Avisos carrega normalmente
- [ ] Prévia da mensagem aparece antes do envio
- [ ] Prévia separa corretamente Vencidas / Vencem hoje / Próximas
- [ ] Conta sem imóvel aparece como "Geral" na prévia
- [ ] Conta sem titular aparece como "Sem titular" na prévia
- [ ] Envio manual dispara sem erro
- [ ] Mensagem chega de fato no Telegram, formatada corretamente
- [ ] Se o envio falhar, aparece "Não foi possível enviar o aviso pelo
  Telegram. Verifique as configurações e tente novamente." (nunca erro
  técnico cru)

---

## 10. Cron Telegram

Executar manualmente no SQL Editor do Supabase (ambiente de teste):

```sql
select public.invoke_telegram_avisos_cron('manha');
```

Depois validar o resultado da chamada HTTP:

```sql
select id, status_code, error_msg, content, created
from net._http_response
order by created desc
limit 5;
```

- [ ] `status_code` retornado é `200`
- [ ] `error_msg` vazio/nulo
- [ ] `content` contém a resposta esperada da função

---

## 11. PDF / Storage

- [ ] Upload de PDF válido funciona
- [ ] Selecionar arquivo que não é PDF é rejeitado com mensagem clara
- [ ] URL assinada do comprovante abre corretamente
- [ ] Comprovante não fica acessível publicamente (bucket privado,
  sem link direto sem assinatura)

---

## 12. Responsividade

- [ ] Layout mobile funciona (telas principais)
- [ ] Layout desktop funciona (telas principais)
- [ ] Cards de conta/imóvel não quebram em telas pequenas
- [ ] Calendário do Dashboard funciona em mobile
- [ ] Filtros da tela Contas funcionam em mobile
- [ ] Modais abrem e rolam corretamente em mobile (sem cortar conteúdo)

---

## 13. Segurança básica (visual)

- [ ] Usuário só enxerga dados do próprio workspace
- [ ] Conta sem imóvel aparece como "Geral" / "Sem imóvel", nunca `null` cru
- [ ] Conta sem titular aparece como "Sem titular", nunca `null` cru
- [ ] Nenhum termo técnico como "centro de custo" aparece na interface

---

## 14. Build final

```bash
npm run build
git status
```

- [ ] `npm run build` passa sem erro
- [ ] `git status` não mostra `dist/` como novo/modificado
- [ ] `.agents/` e `skills-lock.json` não aparecem como arquivos para commit

---

## 15. Checklist antes do merge

- [ ] Todas as alterações da etapa estão commitadas na `dev-david`
- [ ] Push feito para `origin/dev-david`
- [ ] Build final passou
- [ ] Testes manuais das seções principais (Login, Dashboard, Contas,
  Lançamento, Avisos) passaram
- [ ] PR aberto ou merge direto para `main` (conforme decisão do responsável)

```bash
git push origin dev-david
```
