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

## O que existe e o que falta

Existe: login (cookie HMAC, bloqueio por tentativas, usuário desativado perde acesso na hora), kanban com funis e etapas editáveis
(arrastar, motivo de ganho/perda, painel com histórico), contatos (empresa/pessoa, importação/exportação CSV, duplicados e mesclagem),
tarefas e agenda, funil de entrega pós-venda (checklists por modelo, upsell), automações (gatilho, critérios, ações com espera,
webhook com defesa SSRF), relatórios (funil cumulativo, ciclo, motivos, metas), configuração (funis, etapas, motivos, usuários,
chaves de integração), e integração com o Vendedor IA nos dois lados (eventos com outbox e reenvio).

Variáveis extras: `CRON_SECRET` (protege `/api/cron/automacoes`, que o `vercel.json` chama uma vez por dia; o varredor também roda
a cada abertura de tela e a cada evento, então o cron diário é só rede de segurança). Em produção o `next.config.ts` envia
cabeçalhos de segurança e CSP; `/api/*` responde com `no-store`.

Limites conhecidos: o detector de intenção do Vendedor IA cobre 9 dos 13 sinais (4 ficam manuais); caches de usuário ativo (10 s) e de
motivos (10 min) são por processo; `npm audit` aponta `postcss` dentro do `next` (aceito: só afeta quem processa CSS de terceiros no build, e não há versão corrigida compatível com o Next 15.5).
Falta: versão para celular e a ligação para ler/pausar a conversa do WhatsApp a partir do CRM (ver `docs/integracao.md`).
