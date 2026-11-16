# Corte do CRM antigo (F5: C12 homologação, C13 corte) — roteiro

Estado em que este roteiro começa: Comercial no Vendedor IA (`com_*`, telas `/comercial/*`, contratos com ClickSign),
dados do CRM copiados e conferidos, endereço único `app.avanteza.com.br/comercial/*` (reescrita da Central), API de
entregas no Vendedor IA, ponte interna `COMERCIAL_NATIVO` e `CRM_SOMENTE_LEITURA` prontas **e desligadas**.
Nada deste documento foi executado. Cada passo tem verificação e reversão. Nunca cole segredo no chat: variáveis só na
Vercel (o MCP da Vercel não lê nem grava variáveis; quem troca é o dono, na tela do projeto, e depois **Redeploy**).

Projetos: Vendedor IA = `nexo-vendedoria` (`nexo-vendedoria.vercel.app`), CRM antigo = `nexo-crm`
(`nexo-crm-tawny.vercel.app`), Central = `app.avanteza.com.br`. Banco: Supabase `kwzbbjhteanvibfqwkky`
(schema `crm` = CRM antigo; `public.com_*` = Comercial).

---

## Parte A — subir o endereço único (antes da homologação; não mexe em dados)

Ordem obrigatória: **Vendedor IA primeiro**, Central depois (a Central passa a mandar gente para `/comercial`).

| # | Onde | O quê | Verificação | Reversão |
|---|---|---|---|---|
| A1 | `nexo-vendedoria` (variáveis) | `COMERCIAL_URL_PUBLICA=https://app.avanteza.com.br/comercial` (link da proposta). **Manter** `NEXTAUTH_URL=https://nexo-vendedoria.vercel.app` (só origem; o código usa como endereço público de mídia, fila e checkout). **Não** criar `AUTH_URL` com caminho (`…/comercial/api/auth` mudaria o basePath do NextAuth e quebraria o login do domínio antigo). `AVANTEZA_HUB_URL` pode ficar sem valor (padrão `https://app.avanteza.com.br`). `AVANTEZA_CRM_KEY` = **a mesma** da Central (API de entregas). | — | apagar as variáveis |
| A2 | `nexo-vendedoria` (deploy do `master`) | merge do PR da F5 | `GET /api/health` → `{"status":"ok","db":"connected"}`; `GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=1` → `1`; `/crm/conversations` abre com CSS (os arquivos agora saem como `/comercial/_next/…`); `curl -I https://nexo-vendedoria.vercel.app/comercial/icon-192.png` → 200 | Vercel → *Instant Rollback* para o deploy anterior |
| A3 | `nexo-vendedoria` | conferir a API de entregas lado a lado com o CRM: `GET /api/integracoes/avanteza/entregas/quadro`, `/renovacoes`, `/modelos` com `Authorization: Bearer $AVANTEZA_CRM_KEY` nos dois domínios (as chaves das respostas são as mesmas por teste; os dados batem depois da recópia do corte) | 200 nos dois | nada a reverter (a Central ainda lê o CRM) |
| A4 | Central (variáveis) | `VENDEDORIA_URL` vazio ou `https://nexo-vendedoria.vercel.app` (destino da reescrita); **apagar `APP_VENDAS_URL` se existir** apontando para o domínio antigo (ela vence o padrão novo `https://app.avanteza.com.br/comercial`); `SSO_APPS` contém `vendas` | — | — |
| A5 | Central (deploy) | merge do PR da F5 da Central | logado na Central: menu Comercial → Oportunidades abre `app.avanteza.com.br/comercial/oportunidades` **sem tela de login extra** (login único); CSS/JS/fontes 200; `GET https://app.avanteza.com.br/comercial/p/<token de teste>` sem sessão 200; `/comercial/api/comercial/oportunidades` sem sessão 401 | `COMERCIAL_ZONA=0` + Redeploy (menu volta aos atalhos antigos); para tirar a reescrita, reverter o commit da Central |
| A6 | Google (ação do dono) | só se for usar a agenda do SDR pela zona: o OAuth do calendário continua usando `NEXTAUTH_URL` (domínio antigo); nada a mudar agora | — | — |

Roteiro local que provou a Parte A (as duas apps em portas locais, Central reescrevendo para a outra porta):
`scripts/roteiro-zona.sh` (variáveis no cabeçalho) — 45 checagens verdes (SSO, CSS/JS/fontes/imagem, REST, GraphQL, sessão NextAuth em
`/comercial/api/auth`, proposta pública sem sessão, telas antigas sob `/comercial`, 401 sem sessão, webhook do WhatsApp
no domínio antigo), com e sem `NEXTAUTH_URL`.

---

## Parte B — Homologação com o dono (C12): checklist de 15 itens

Três dias de uso **na versão nova, sobre os dados copiados, sem trabalho real** (tudo o que for gravado no Comercial
novo durante a homologação é apagado na recópia do corte). Marcar cada item; qualquer "não" adia o corte.

1. [ ] Na Central, menu **Comercial → Oportunidades** abre já logado (login único), com o visual Avanteza, no celular e no computador.
2. [ ] O kanban de oportunidades mostra os mesmos funis, etapas e quantidades do CRM antigo (as 1.326 oportunidades: 1.307 em andamento, 19 perdidas).
3. [ ] Abrir uma oportunidade: histórico de etapas, feedbacks, tarefas e a conversa do WhatsApp do lead aparecem.
4. [ ] Mover uma oportunidade de etapa pelo arrasto; o lead correspondente muda de coluna em **Leads (SDR)**.
5. [ ] Marcar uma oportunidade como perdida com motivo; o motivo aparece no relatório/ficha.
6. [ ] **Contatos**: buscar por nome e telefone; abrir a ficha da empresa com as pessoas ligadas.
7. [ ] **Tarefas e agenda**: criar uma tarefa com prazo e um compromisso; ambos aparecem na lista e na agenda.
8. [ ] **Proposta**: criar a partir de uma oportunidade com valor, enviar, abrir o link `app.avanteza.com.br/comercial/p/…` numa janela anônima (sem login) e aceitar.
9. [ ] **Contrato**: gerar o PDF de teste, enviar para assinatura no ambiente de teste da ClickSign e ver o status voltar.
10. [ ] Oportunidade ganha cria a **entrega** com os cartões do modelo padrão; a Central (Operações → Funil de Entrega, depois da troca de `CRM_URL`) mostra a mesma entrega.
11. [ ] **Conversas**, **Leads (SDR)**, **Prospecção**, **Disparos** e **Agente** abrem sob `/comercial/…` e continuam abrindo no endereço antigo `nexo-vendedoria.vercel.app/crm/…`.
12. [ ] Uma mensagem real de teste no WhatsApp: o Vendedor IA responde normalmente (webhook no domínio antigo intacto).
13. [ ] Sair (botão de sair) leva de volta à Central; entrar de novo pelo menu não pede senha.
14. [ ] Nada estranho na Central fora de `/comercial` (Mapa, Financeiro, Operações) depois da reescrita.
15. [ ] O dono confirma a janela do corte (30 min, fora do horário comercial) e autoriza substituir o projeto `nexo-crm` por redirecionamentos (decisão D1). `DROP SCHEMA crm` **não** faz parte.

Assinatura do dono: __________________ Data: ___/___/______

---

## Parte C — Corte (C13), janela de ~30 min fora do horário comercial

Pré-requisitos: Parte B assinada; acesso ao Supabase (papel `postgres`/`SUPABASE_ACCESS_TOKEN`), à Vercel e ao GitHub.
Antes de começar, anotar: ids dos deploys atuais de `nexo-crm`, `nexo-vendedoria` e Central (para *Instant Rollback*).
Conferir também se houve acesso a `/p/` no `nexo-crm` nos últimos 30 dias (`get_runtime_logs`) — só informativo.

| # | Passo (comando exato) | Verificação | Reversão |
|---|---|---|---|
| C1 | **Congelar o CRM**: `nexo-crm` → variável `CRM_SOMENTE_LEITURA=1` → Redeploy. | `curl -X POST https://nexo-crm-tawny.vercel.app/api/login` → **423**; `GET /api/health` → 200; telas abrem (só leitura). No Vendedor IA, novos eventos ficam `PENDENTE` na `CrmEventoOutbox` (o CRM responde 423). | apagar `CRM_SOMENTE_LEITURA` + Redeploy |
| C2 | **Recópia** (apaga e copia de novo, numa transação) — em `vendedoria/`: `SUPABASE_ACCESS_TOKEN=… node scripts/comercial-copiar.mjs --refazer --sim --api-supabase kwzbbjhteanvibfqwkky` | saída sem erro; contagens impressas por tabela | `node scripts/comercial-copiar.mjs --desfazer --sim --api-supabase kwzbbjhteanvibfqwkky` (o CRM segue congelado e intacto) |
| C3 | **Conferir**: `node scripts/comercial-copiar.mjs --verificar --api-supabase kwzbbjhteanvibfqwkky` e uma 2ª cópia `node scripts/comercial-copiar.mjs --copiar --api-supabase kwzbbjhteanvibfqwkky` | `--verificar` verde (código 0); a 2ª cópia imprime `inseridas=0` em todas as tabelas | se vermelho: **parar**, C1 reverso (descongelar), investigar |
| C4 | **Backup** (fora do Supabase): GitHub → Actions → *backup-vendedoria* → *Run workflow* (dump completo criptografado) **e** dump só do CRM: `pg_dump -n crm --no-owner --no-privileges "$DIRECT_URL" \| gzip -9 \| gpg --symmetric --cipher-algo AES256 -o crm-AAAAMMDD.sql.gz.gpg`. Baixar os dois e guardar também no Drive do dono. **Restaurar uma vez** num Postgres descartável (`gpg -d … \| gunzip \| psql "$URL_DESCARTAVEL"`) e conferir as contagens da seção 1 do desenho (Contato 1.337, Oportunidade 1.326, HistoricoEtapa 1.326, Feedback 1.326, Mensagem 278…). | contagens batem no restore | nada gravado; se não bater, não seguir |
| C5 | **Ligar a ponte interna**: `nexo-vendedoria` → `COMERCIAL_NATIVO=1` → Redeploy. Os PENDENTES da outbox passam a ser tratados em processo pelo cron `/api/cron/comercial` (10 min) e pelo `/api/health`; idempotente por `eventoId` (`ComEventoIntegracao`). Para não esperar: `curl -H "Authorization: Bearer $CRON_SECRET" https://nexo-vendedoria.vercel.app/api/cron/comercial` | resposta com `eventos.enviados` ≥ 0 e `falhas: 0`; `select status, count(*) from "CrmEventoOutbox" group by 1` sem `PENDENTE` antigo; `/api/health` com `crm` sem erro; um lead de teste qualificado gera **1** oportunidade; `select "leadId","eventName",count(*) from "MetaConversionEvent" group by 1,2 having count(*)>1` → 0 linhas | `COMERCIAL_NATIVO` apagada + Redeploy (eventos voltam a ir por HTTP ao CRM, que está congelado: ficam PENDENTES até C1 reverso) |
| C6 | **Central lê as entregas do Vendedor IA**: Central → `CRM_URL=https://nexo-vendedoria.vercel.app` (`AVANTEZA_CRM_KEY` igual nos dois) → Redeploy. | Operações → Funil de Entrega lista sem erro; `GET /quadro`, `/renovacoes`, `/modelos` iguais aos de A3 | `CRM_URL` de volta para `https://nexo-crm-tawny.vercel.app` + Redeploy |
| C7 | **Trocar o código do `nexo-crm` por redirecionamentos**: num branch, `git rm -r crm/` exceto `crm/.vercelignore`; copiar o conteúdo de `crm-redirecionamentos/` (`vercel.json`, `public/`, `.vercelignore`) para `crm/`; PR + merge (Root Directory continua `crm`). **Não pausar o projeto.** | `curl -I https://nexo-crm-tawny.vercel.app/p/qualquer12345` → **308** `Location: https://app.avanteza.com.br/comercial/p/qualquer12345`; `/login` e `/` → 308 para `/comercial`; `/api/health` → 410. Deploy `READY` e **não vazio** (se tudo der 404, faltou o `crm/.vercelignore`) | *Instant Rollback* do `nexo-crm` para o deploy anotado (o CRM volta, ainda congelado) ou `git revert` do merge |
| C8 | **Central sem o CRM antigo**: tirar o atalho "CRM antigo" do Comercial (`src/lib/shell/departamentos.ts`) e o app `crm` de `SSO_APPS`. | menu sem "CRM antigo" | reverter o commit |
| C9 | **Monitoramento**: a rotina horária (CLAUDE.md) deixa de olhar o health do `nexo-crm` e o campo `crm` do health do Vendedor IA passa a refletir o tratamento nativo. Atualizar `CLAUDE.md` (seções do CRM) no mesmo dia. | `list_triggers`: a rotina existente atualizada (não criar outra) | — |

Checklist rápido de fim de corte (Apêndice B do desenho): `--verificar` verde e 2ª cópia = 0; restore conferido;
`GET https://app.avanteza.com.br/comercial/api/health` 200 e `https://nexo-vendedoria.vercel.app/api/health`
`{"status":"ok","db":"connected"}`; verificação do webhook da Meta no domínio antigo 200 e mensagem real de teste;
`/p/qualquer` antigo → 308; card Comercial da Central entra por SSO; Funil de Entrega pela API do Vendedor IA;
`MetaConversionEvent` sem duplicata.

### Reversão completa (qualquer ponto da Parte C)

Na ordem inversa: C7 (rollback do `nexo-crm`) → C6 (`CRM_URL` antigo) → C5 (`COMERCIAL_NATIVO` desligada) →
C1 (`CRM_SOMENTE_LEITURA` apagada). O schema `crm` nunca é apagado neste roteiro, então o CRM antigo volta exatamente
como estava; a outbox reenvia ao CRM os eventos que ficaram PENDENTES. O que foi gravado no Comercial novo depois do
corte fica nas tabelas `com_*` (avisar o dono antes de reverter depois de uso real).

## Depois (C14, sem pressa)

Remover `CRM_URL`/`CRM_API_KEY` do Vendedor IA e a outbox depois de 2 semanas sem divergência; `DROP SCHEMA crm` só
por decisão explícita do dono, com o backup de C4 restaurado e guardado.

## Variáveis (só nomes)

| Projeto | Variável | Quando |
|---|---|---|
| nexo-vendedoria | `COMERCIAL_URL_PUBLICA` | A1 |
| nexo-vendedoria | `AVANTEZA_CRM_KEY` (mesma da Central) | A1 |
| nexo-vendedoria | `NEXTAUTH_URL` (manter, só origem) / `AUTH_URL` (não criar com caminho) | A1 |
| nexo-vendedoria | `COMERCIAL_NATIVO=1` | C5 |
| nexo-vendedoria | `COMERCIAL_HORA_ROTINA` (opcional, padrão 7h de Brasília: rotina diária das entregas e varredura das automações) | quando quiser |
| Central | `VENDEDORIA_URL` (opcional), apagar `APP_VENDAS_URL` antigo, `COMERCIAL_ZONA` (`0` desliga os atalhos) | A4 |
| Central | `CRM_URL=https://nexo-vendedoria.vercel.app` | C6 |
| nexo-crm | `CRM_SOMENTE_LEITURA=1` | C1 |
