# ⚡ NEXO — Product Intelligence Platform

## O que está incluído

| Arquivo | Descrição |
|---|---|
| `frontend/nexo.jsx` | App React completo — integrado ao backend |
| `backend/main.py` | FastAPI com todos os endpoints |
| `backend/scrapers/` | AliExpress, Alibaba, 1688, Shopee, ML, Amazon BR, FB Ads, Google Trends |
| `backend/services/` | AI Scorer (Claude), Profit Calculator (câmbio ao vivo), Scheduler |
| `backend/database/db.py` | PostgreSQL + Redis — todas as tabelas |
| `backend/routers/` | Auth, Products, Trends, Ads, Gaps, Calculator, AI, Notifications, Export |
| `backend/docker-compose.yml` | Sobe tudo com 1 comando |

---

## 🚀 Como subir em 5 minutos

### 1. Backend

```bash
cd backend
cp .env.example .env
# Edite .env com suas chaves de API

# Subir banco de dados e Redis
docker-compose up postgres redis -d

# Instalar dependências
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Rodar API
uvicorn main:app --reload --port 8000
# → http://localhost:8000/docs
```

### 2. Frontend

Abra o `frontend/nexo.jsx` no Claude.ai como um Artifact, ou:

```bash
# Se tiver um projeto React/Vite:
cp frontend/nexo.jsx src/App.jsx
npm run dev
```

---

## 🔑 Chaves de API necessárias

| Chave | Onde criar | Custo |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com | ~$15/mês |
| `APIFY_TOKEN` | apify.com → Settings → API Tokens | $29/mês (Starter) |
| `SERPAPI_KEY` | serpapi.com → Dashboard | $50/mês (ou 100 grátis) |
| `SMTP_USER/PASS` | Gmail → App Passwords | Grátis |
| `TELEGRAM_BOT_TOKEN` | @BotFather no Telegram | Grátis |

**Total estimado: ~$94/mês** para operação completa.

---

## 📋 O que está funcionando

- ✅ Login e cadastro com JWT
- ✅ Scraping AliExpress, Shopee, Mercado Livre, Amazon BR via Apify
- ✅ Scraping Alibaba + 1688 via Apify
- ✅ Spy de anúncios Facebook Ads Library via Apify
- ✅ Google Trends em tempo real via SerpAPI
- ✅ Câmbio USD/BRL ao vivo via AwesomeAPI (grátis)
- ✅ Cálculo de markup, impostos, margem
- ✅ Análise de IA com Claude (scoring + estratégia + copys)
- ✅ Favoritos (salvar produtos)
- ✅ Export CSV e JSON
- ✅ Notificações por email e Telegram
- ✅ Digest diário às 8h BRT
- ✅ Scans automáticos todos os dias às 3h BRT
- ✅ Interface responsiva (desktop + mobile)
- ✅ Painel de notificações no header

---

## 🔧 Configuração de Email (Gmail)

1. Ative verificação em 2 etapas na sua conta Google
2. Acesse: myaccount.google.com → Segurança → Senhas de app
3. Crie uma senha para "NEXO"
4. Cole em `SMTP_USER=seu@gmail.com` e `SMTP_PASS=a-senha-gerada`

## 🤖 Configuração do Telegram

1. Abra o Telegram e pesquise `@BotFather`
2. Envie `/newbot` e siga as instruções
3. Copie o token recebido para `TELEGRAM_BOT_TOKEN`
4. Abra seu bot e envie `/start`
5. Acesse: `https://api.telegram.org/bot{TOKEN}/getUpdates`
6. Copie o `chat.id` e cole em Configurações na plataforma
