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
