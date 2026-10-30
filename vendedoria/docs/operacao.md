# Operação — o que mudou em 30/10/2026 e o que depende de você

## Como as coisas funcionam agora

**Follow-ups.** O processador (`src/lib/followup/processar.ts`) roda sem segredo a partir de qualquer um destes gatilhos: mensagem recebida no webhook, `GET /api/health` (a rotina externa chama de hora em hora), telas do CRM abertas (Conversas, Ligações, sino de notificações) e o agendamento do GitHub (`cron-vendedoria.yml`). Cadência: 2h, 12h, 24h e 48h depois da última mensagem da IA. Fora da janela de 24h do WhatsApp só sai com template aprovado (`FOLLOWUP_TEMPLATE_NAME`); sem template, o lead vai para a tela **Ligações**.

**IA sai de cena** quando o lead pede uma pessoa, demonstra frustração ("parece um robô", "já falei isso") ou quando a própria IA não tem nada novo a dizer. O lead recebe um aviso curto, fica escalado, você é avisado (notificação, push e WhatsApp) e os follow-ups param. A conversa fica com `humanTakeover` ligado.

**Tela Ligações** (`/crm/ligacoes`): ligações marcadas pelo SDR + leads escalados / que pararam de responder / que pediram humano. Botões: ligar, WhatsApp, abrir conversa, concluído.

**Kanban** abre no funil de entrada (SDR). Em Configurações → Manutenção há a correção dos cards presos em "Novos" (prévia antes de aplicar; nada é apagado).

**Banco.** O deploy aplica migrações (`scripts/db-deploy.mjs` → `prisma migrate deploy`). Nunca mais `db push --accept-data-loss`. Para mudar o schema: edite `prisma/schema.prisma`, rode `npm run db:migrate:new -- --name descricao` com um banco local e commite `prisma/migrations/`.

**API fechada por padrão.** Toda rota `/api/*` exige login, chave de API (`Authorization: Bearer nexo_live_...`) ou o segredo/assinatura que a rota valida. Lista das públicas: `src/lib/auth/rotas-publicas.ts`.

**Login** bloqueia por 15 min após 10 falhas no e-mail ou 30 no IP.

## O que só você pode fazer

| Onde | O quê | Efeito |
|---|---|---|
| Meta Billing Hub | Pagar a pendência do WhatsApp Business (erro 131042) | Disparos e templates voltam a sair |
| CRM → Prospecção → Disparo | "Devolver N para a fila" e retomar | 839 empresas marcadas "abordado" sem nunca ter recebido mensagem |
| Meta → Templates | Aprovar um template de follow-up e informar o nome | `FOLLOWUP_TEMPLATE_NAME` na Vercel → toques de 24h/48h saem fora da janela |
| Vercel → Env | `META_CAPI_TOKEN`, `META_DATASET_ID`, `META_WABA_ID` | Conversões (LeadSubmitted/Purchase) passam a ir para a Meta |
| Vercel → Env | `MERCADO_PAGO_WEBHOOK_SECRET` (se o checkout voltar a ser usado) | Webhook do MP valida assinatura |
| OpenAI → Billing | Recarga automática de créditos | IA não para por saldo zerado (você recebe alerta se parar) |
| GitHub → Secrets | `CRON_SECRET` (mesmo valor da Vercel) | Agendamento chama o cron direto (sem ele, cai no /api/health) |
| GitHub → Secrets | `VENDEDORIA_DIRECT_URL` e `BACKUP_PASSPHRASE` | Backup diário criptografado do banco (artefato, 30 dias) |
| CRM → Configurações → Manutenção | Aplicar as duas correções do Kanban | 46 escalados e 1.000 de prospecção saem de "Novos" |
| Vercel | Plano Pro (ou outro host pago) | Hobby não permite uso comercial, retém logs por 1h e limita crons |

## Restaurar um backup
```
gpg -d backup.sql.gz.gpg | gunzip | psql "$DIRECT_URL"
```

## Financeiro → aba DRE (30/10/2026)

- Fica logo depois de "Visão Geral". Mostra a demonstração do resultado em **regime de caixa**: lê só o extrato (o que já foi confirmado) e agrupa cada categoria numa linha da DRE.
- Cascata: receita bruta → deduções → receita líquida → custos diretos → lucro bruto → despesas operacionais → resultado operacional → financeiras → impostos → resultado líquido → investimentos → sobra de caixa.
- Traz AV % (parte da receita líquida), variação contra o período anterior, margens, 12 meses de evolução, acumulado do ano e uma leitura automática em frases. Botão CSV abre no Excel.
- **Realizado × Projetado**: o projetado soma ao realizado as receitas previstas em aberto e as contas a pagar pendentes com vencimento no período.
- O filtro de negócio abre em **Nexo** (a DRE é da empresa) e a escolha fica salva no navegador.
- Cada **lançamento** cai numa linha nesta ordem: movido à mão > categoria fixada à mão > descrição (ex.: "Salário da Layane" → Pessoal, "Saneago" → Ocupação, "Cartão Nubank" → Dívidas) > categoria (ex.: Assinaturas → Tecnologia) > Administrativas. A descrição vem antes porque as categorias do extrato são genéricas ("Dívidas/Parcelas" guardava água, internet, cartão e salário).
- Pagamento de dívidas e cartões, investimentos e entradas não operacionais (empréstimos recebidos, aportes) ficam **abaixo do resultado**: mexem na sobra de caixa, não no lucro.
- Para corrigir um caso: abra a linha na tabela, abra a categoria e mova o lançamento. Para uma categoria inteira, use "Em que linha cada categoria entra". Nada altera os lançamentos e cada troca fica no Histórico financeiro.
- Banco: só uma tabela nova (`max_dre_classificacoes`), criada pela migração `20261030160000_dre_classificacao` no próximo deploy. Nada existente é alterado.
