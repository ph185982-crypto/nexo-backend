# CRM Avanteza

Funil de vendas, contatos e (em breve) entrega. Ferramenta própria da Avanteza, **separada do Vendedor IA**
(`../vendedoria`), com banco próprio e ligação por eventos (ver [docs/integracao.md](docs/integracao.md)).

Identidade visual: azul `#2448FF`, laranja `#FF7043`, branco quente `#F6F5F0`, grafite `#18191D`, cinza `#686A73`;
Manrope (títulos) e Inter (texto). As cores vivem só em `src/app/globals.css`; componentes usam tokens do Tailwind.
O laranja é **preenchimento com texto grafite**, nunca texto (contraste 2,5:1 sobre claro). `tests/marca.test.ts` protege isso.
Logo: `public/brand/` (arquivo enviado pela marca; `avanteza-logo-original.webp` é o original intacto).

## Rodar local

```bash
cp .env.example .env        # preencha DATABASE_URL, DIRECT_URL, SESSION_SECRET, SEED_ADMIN_EMAIL
npm install
npx prisma migrate deploy
SEED_DEMO=true npm run db:seed    # usuário, funil "Vendas", motivos e 5 oportunidades fictícias
npm run dev                       # http://localhost:3100
npm test                          # precisa de DATABASE_URL e SESSION_SECRET
```

## Regras do projeto

- **Só `src/lib/funil/mover.ts` cria oportunidade ou troca a etapa dela.** Cada troca grava, numa transação, a etapa,
  o relógio da etapa, o encerramento (ganha/perdida e motivo) e uma linha em `HistoricoEtapa`. É isso que permite medir
  conversão por etapa, tempo parado e ciclo de vendas. `tests/funil-guarda.test.ts` lê o código e falha se alguém escrever
  etapa/funil/status direto.
- **A natureza da etapa é dado da etapa** (`ABERTA`, `GANHA`, `PERDIDA`), não o nome. Dá para criar funis novos sem mexer no código.
- **Toda rota `/api/*` exige login** (cookie assinado), exceto `/api/login`, `/api/health` e `/api/integracoes/*`
  (esta valida a chave de serviço). O login bloqueia após 10 falhas por e-mail ou 30 por IP em 15 minutos.
- **Schema muda por migração**: edite `prisma/schema.prisma`, rode `npm run db:migrate:new -- --name descricao` e commite `prisma/migrations/`.

## Deploy (Vercel)

Projeto próprio com **Root Directory = `crm`**. Variáveis: `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`,
`NEXT_PUBLIC_VENDEDOR_IA_URL`. O build aplica as migrações (`scripts/db-deploy.mjs`).
Primeiro acesso: rode `npm run db:seed` uma vez contra o banco de produção com `SEED_ADMIN_EMAIL` (e, de preferência,
`SEED_ADMIN_SENHA`; se faltar, o seed gera uma senha e mostra uma única vez).

> Armadilha já vista no `vendedoria/`: o `.vercelignore` da **raiz** lista as pastas dos outros projetos. Por isso `crm/.vercelignore`
> precisa existir (senão o projeto cai no da raiz e faz deploy vazio, com build `READY` e todas as rotas 404), e o da raiz lista `crm/`.

## Funil de entrega automático

Ao ganhar uma oportunidade, a entrega abre com os cartões do modelo padrão, já com o dono da oportunidade como
responsável, e o contato vira **Cliente**. Daí em diante:

- **Rotina diária** (`src/lib/entrega/rotina.ts`, roda no cron e em "Executar agora", sem configurar nada):
  cartão sem dono herda o responsável; cartão do Backlog com prazo em até 7 dias vai para "Essa semana" (uma vez:
  se alguém o devolver, a rotina respeita); entrega com tudo concluído é fechada; **60 dias antes da renovação**
  abre a oportunidade "Renovação — …" no funil padrão, com o valor mensal e tarefa para a proposta 30 dias antes.
- **Concluir e reabrir** (`src/lib/entrega/ciclo.ts`): o último cartão concluído fecha a entrega; um cartão que sai
  de "Concluído" a reabre.
- **Gatilhos de entrega nas automações**: cartão atrasado, aguardando o cliente há N dias, cliente em risco
  (nota de saúde abaixo de 50, no máximo um aviso por semana), renovação em até N dias, cartão concluído e entrega
  concluída. Critérios extras: nota de saúde, dias para renovar, pilar, dias de atraso, dias aguardando, cartão do
  cliente. As ações agem sobre a oportunidade ganha; a tarefa vai para quem cuida do cartão; os textos aceitam
  `{cliente}`, `{oportunidade}`, `{entrega}`, `{cartao}` e `{dias}`. Com espera, a ação só roda se o fato continuar
  verdadeiro (ex.: o cartão ainda está esperando o cliente). Há modelos prontos na tela de Automações.

## Ficha do cliente, combinados e agente

Clicar numa oportunidade abre a **ficha** (janela grande): no topo, **Editar**, **Prorrogar**, **Perder** e **Ganhar**; à esquerda,
valores, **Resumo da IA** (situação, próximos passos e riscos, gerado sob pedido), dados e histórico de etapas; abas **Linha do tempo**
(feedbacks; edições ficam registradas com o antes e o depois), **Combinados**, **Produtos**, **Tarefas** e **Conversa (WhatsApp)**.
Parada há 14 dias ou mais, a ficha mostra o alerta.

- **Produtos** (`src/lib/oportunidades/produtos.ts`): catálogo em Configuração → Produtos (único ou mensal). Com produtos, o valor da
  oportunidade é a soma das linhas (quantidade × valor − desconto %), por recorrência; sem produtos, digita-se em Editar.
- **Propostas** (`src/lib/propostas/`): aba Propostas na ficha. Nasce dos produtos (cópia: editar produto depois não muda a
  proposta), com textos padrão em Configuração → Produtos. Rascunho se edita; enviada, ganha o link público `/p/{token}`
  (sem login) em que o cliente lê, baixa em PDF e aceita ou recusa. Abertura, aceite e recusa vão para a linha do tempo e
  para os Avisos; aceite marca o sinal "Sinal de fechamento" e a probabilidade Quente. Versão nova substitui a anterior.
- **Funil**: busca, filtros (responsável, probabilidade, tag, situação), modo **Lista** ordenável e **Exportar** (CSV do que está na tela).
- **Busca global** (Ctrl+K) e **Avisos** (tarefas atrasadas/de hoje, oportunidades atrasadas ou paradas, combinados vencidos, sugestões
  do agente, reuniões sem cliente) ficam no topo da barra lateral.

- **Combinado** (`src/lib/combinados/`) é o que foi prometido, por nós ou pelo cliente, com prazo. Aceito, vira o item
  de trabalho certo: antes de fechar, tarefa (ou compromisso, se for reunião com data); depois de ganhar, cartão da
  entrega. Ao ganhar, os combinados pendentes viram cartões. Concluir o cartão ou a tarefa cumpre o combinado.
- **Agente** (`agente.ts`, modelo `claude-opus-5-5`, saída validada por esquema): lê cada feedback escrito, cada
  trecho novo de conversa e cada transcrição colada ("Analisar transcrição ou texto"), e devolve **sugestões** —
  combinado novo, item aberto já entregue, ou prazo novo — com o trecho de evidência. Nada entra sem a pessoa aceitar.
  Roda depois da resposta (`after`); o que sobrar, o cron pega. Precisa de `ANTHROPIC_API_KEY`.
- **Conversas**: as do WhatsApp do Vendedor IA chegam sozinhas na ficha (só de quem o CRM conhece) e o agente lê cada
  conversa quando ela para por 30 minutos (contrato em `docs/integracao.md`, inclusive como ligar o seu próprio número do
  WhatsApp Business em coexistência). Conversa de outro número: importe o `.txt` do "Exportar conversa" na aba Conversa.

## Reuniões do Google Meet

Cada usuário conecta a própria conta Google em **Configuração → Google (reuniões)** (Workspace com transcrição do Meet
ligada). O CRM lê a Agenda e as transcrições (`calendar.readonly`, `meetings.space.readonly`; refresh token cifrado):
depois de cada reunião encerrada com transcrição, acha o evento pelo código da sala, o cliente pelo e-mail dos
convidados (contato com o mesmo e-mail) e manda a transcrição para o agente (fonte `REUNIAO`), com um registro na linha
do tempo. Reunião sem cliente identificado fica na lista para vincular com um clique. Sincroniza ao abrir uma ficha
(no máximo a cada 10 min), no cron diário e em "Sincronizar agora". Código em `src/lib/google/`. A API do Meet guarda
as falas por 30 dias.

## O que existe e o que falta

Existe: login (cookie HMAC, bloqueio por tentativas, usuário desativado perde acesso na hora), kanban com funis e etapas editáveis
(arrastar, motivo de ganho/perda, painel com histórico), contatos (empresa/pessoa, importação/exportação CSV, duplicados e mesclagem),
tarefas e agenda, funil de entrega pós-venda (checklists por modelo, upsell, rotina e gatilhos automáticos), automações (gatilho, critérios, ações com espera,
webhook com defesa SSRF), relatórios (funil cumulativo, ciclo, motivos, metas), configuração (funis, etapas, motivos, usuários,
chaves de integração), e integração com o Vendedor IA nos dois lados (eventos com outbox e reenvio).

Variáveis extras: `CRON_SECRET` (protege `/api/cron/automacoes`, que o `vercel.json` chama uma vez por dia; o varredor também roda
a cada abertura de tela e a cada evento, então o cron diário é só rede de segurança). Em produção o `next.config.ts` envia
cabeçalhos de segurança e CSP; `/api/*` responde com `no-store`.

Limites conhecidos: o detector de intenção do Vendedor IA cobre 9 dos 13 sinais (4 ficam manuais); caches de usuário ativo (10 s) e de
motivos (10 min) são por processo; `npm audit` aponta `postcss` dentro do `next` (aceito: só afeta quem processa CSS de terceiros no build, e não há versão corrigida compatível com o Next 15.5).
Falta: versão para celular e a ligação para ler/pausar a conversa do WhatsApp a partir do CRM (ver `docs/integracao.md`).
