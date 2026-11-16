# VendedorIA — CRM Inteligente para WhatsApp

Plataforma SaaS completa com agente de IA para gestão de leads e vendas via WhatsApp.

## Stack

- **Next.js 15** com App Router e Turbopack
- **GraphQL** com Apollo Server 4 + Apollo Client 3
- **TailwindCSS** + componentes shadcn/ui
- **PostgreSQL** com Prisma ORM
- **NextAuth.js v5** (autenticação session-based)
- **IA**: OpenAI GPT-4o ou Anthropic Claude Sonnet

## Início Rápido

### 1. Instalar dependências

```bash
cd vendedoria
npm install
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
# Edite .env com suas credenciais
```

Variáveis obrigatórias:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/vendedoria"
NEXTAUTH_SECRET="gere-um-secret-seguro-aqui"
```

### 3. Configurar banco de dados

```bash
# Criar tabelas
npm run db:push

# Popular com dados de exemplo
npm run db:seed
```

### 4. Iniciar em desenvolvimento

```bash
npm run dev
```

Acesse: http://localhost:3000

**Credenciais padrão:** `admin@vendedoria.com` / `admin123`

## Login único (Avanteza ID)

A tela de login tem "Entrar com Avanteza" (ação principal), que leva à Central (`AVANTEZA_HUB_URL`, padrão
`https://app.avanteza.com.br`) em `/sso/authorize?app=vendas&return=<caminho>`. A Central devolve em
`/api/sso/callback?token=<JWT>`; a rota chama `signIn("avanteza-sso", { token })` e o segundo provider Credentials
do NextAuth (`src/lib/auth/index.ts` → `src/lib/auth/sso.ts`) confere o token com `src/lib/avanteza-sso.ts`
(ES256, chave pública do JWKS da Central, emissor, `aud = vendas`, validade de 60 s) e acha o usuário pelo e-mail ou
cria na primeira entrada (`admin` → ADMIN; os demais → SELLER; senha aleatória que ninguém vê). Quem já existe não
muda de papel. A sessão é a mesma do login por senha (JWT do NextAuth), e e-mail e senha continuam como reserva.
O cabeçalho tem o atalho "Central" (`/api/sso/central`). Testes: `tests/sso.test.ts`.

## Métricas para a Central (Dashboards)

`GET /api/integracoes/avanteza/metricas?from=YYYY-MM-DD&to=YYYY-MM-DD` com `Authorization: Bearer <AVANTEZA_METRICS_KEY>`
devolve **só agregados** (leads, funil, vendas, receitas/despesas, previstos, contratos e séries diárias) do escopo
**Avanteza** — nunca o pessoal. Somente leitura; sem a variável responde 503. Contrato e definições em
`docs/integracao-avanteza.md`. Testes: `tests/avanteza-metricas.test.ts`.

## Identidade visual (Avanteza v2.0)

- **Paleta**: marinho `#0B1B33` (texto, barra lateral, botão padrão), creme `#F5F0E6` (fundo), areia `#EAD9C2` (bordas e
  pílulas secundárias), laranja `#FF6A1F` (só ação principal, foco e destaque — hover `#E85A12`), branco nos cartões,
  texto secundário `#55637A`, perigo `#DC2626`. Os valores vivem em `src/app/globals.css` (blocos `:root` e `.dark`).
- **Tema**: o **claro é o padrão**. O escuro continua disponível pelo botão do cabeçalho (fundo marinho, superfícies
  `#132A4C`, texto creme; o botão padrão inverte para creme com texto marinho).
- **Fonte**: Manrope em tudo. **Forma**: raio de 6px (`rounded-lg`/`rounded-md`; pílula = `rounded-full`), bordas de 1px,
  sem sombras e sem degradês.
- **Como usar nos componentes**: tokens do tema (`bg-card`, `bg-background`, `text-foreground`, `text-muted-foreground`,
  `border-border`, `bg-primary text-primary-foreground`, `bg-secondary`), nunca `bg-white`, `gray-*`/`slate-*` ou hex
  solto. Ação principal da tela: `<Button variant="destaque">` (laranja com **texto marinho** — texto claro sobre laranja
  não passa em contraste). Superfícies que são marinho nos dois temas usam `bg-marinho text-creme`.
- **Cores de estado** (verde, vermelho, âmbar, azul do Tailwind) continuam para status; no claro use o tom 700 no texto
  (`text-green-700 dark:text-green-400`).
- **Logotipo**: `src/components/ui/logo.tsx` ("avanteza" com o quadrado laranja no lugar do ponto). Nome do app na
  interface: "Vendedor IA · Avanteza".
- `tests/marca.test.ts` confere paleta, contraste AA, tema padrão, sombras, degradês, cantos e restos da identidade anterior.

## Estrutura do Projeto

```
vendedoria/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── graphql/       # Apollo Server endpoint
│   │   │   ├── auth/          # NextAuth handlers
│   │   │   └── webhooks/      # WhatsApp webhook
│   │   ├── crm/               # Área protegida
│   │   │   ├── page.tsx       # Dashboard
│   │   │   ├── lead/kanban/   # Kanban de leads
│   │   │   ├── agents/chat/   # Chat WhatsApp
│   │   │   ├── calendar/      # Agenda
│   │   │   ├── campaigns/     # Lista de campanhas
│   │   │   ├── campaign/      # Nova + Detalhe campanha
│   │   │   ├── work-units/    # Unidades
│   │   │   └── professionals/ # Profissionais
│   │   └── login/             # Página de login
│   ├── components/
│   │   ├── ui/                # shadcn/ui components
│   │   ├── layout/            # Sidebar + Header
│   │   └── crm/               # Lead modal, etc
│   ├── graphql/
│   │   ├── schema/            # typeDefs GraphQL
│   │   └── resolvers/         # Resolvers Apollo
│   └── lib/
│       ├── prisma/            # Prisma client
│       ├── auth/              # NextAuth config
│       ├── graphql/           # Apollo Client
│       ├── ai/                # Agente de IA
│       └── whatsapp/          # WhatsApp API
├── prisma/
│   ├── schema.prisma          # Modelos do banco
│   └── seed.ts                # Dados iniciais
└── .env.example
```

## Funcionalidades

### Dashboard
- Métricas em tempo real: leads, conversas, documentos, escalações
- Filtros por conta WhatsApp e período (Hoje/7d/15d/30d)

### Kanban de Leads
- 9 colunas configuráveis com scroll infinito
- Cards com avatar, nome, telefone, origem e tags
- Modal de detalhe com atividades, escalações e conversas

### Chat WhatsApp
- Interface estilo WhatsApp com bolhas de mensagem
- Lista de conversas com última mensagem e tags
- Envio de mensagens com polling automático

### Agenda
- Vista de calendário mensal e lista
- Criação de agendamentos com profissional e unidade
- Integração com Google Calendar e Meet

### Campanhas
- Criação wizard multi-step com upload CSV/XLSX
- Configuração de delays, horários e modo de envio
- Dashboard de progresso com gráficos

### Agente de IA
- Processamento automático de mensagens recebidas
- Integração com OpenAI GPT-4o ou Anthropic Claude
- Escalação automática para vendedor humano
- System prompt configurável por agente

## Webhook WhatsApp

Configure na Meta Business:
1. URL: `https://seu-dominio.com/api/webhooks/whatsapp`
2. Token de verificação: valor de `META_WHATSAPP_VERIFY_TOKEN`
3. Campos: `messages`

## Variáveis de Ambiente Completas

```env
# Banco de Dados
DATABASE_URL="postgresql://..."

# NextAuth
NEXTAUTH_URL="https://seu-dominio.com"
NEXTAUTH_SECRET="secret-seguro"

# WhatsApp Business API
META_WHATSAPP_VERIFY_TOKEN="token-verificacao"
META_WHATSAPP_ACCESS_TOKEN="EAAxxxxx..."
META_WHATSAPP_APP_SECRET="app-secret"

# Google Calendar
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."

# IA (escolha um)
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."
```

## Deploy (Vercel + Supabase)

1. Crie um banco no [Supabase](https://supabase.com)
2. Configure variáveis no Vercel
3. `npm run build` (gera Prisma client + build Next.js)
4. Execute migrações: `npx prisma migrate deploy`
5. Execute seed: `npm run db:seed`
