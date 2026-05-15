# ShopeeBoost AI

Aplicação web full-stack que gera assets de produto otimizados para a Shopee usando Inteligência Artificial.

**O que faz:**
- Analisa a foto do produto com GPT-4o Vision
- Gera título SEO com as palavras-chave mais buscadas na Shopee (máx 120 caracteres)
- Gera descrição persuasiva com emojis, bullets e CTA (mínimo 300 palavras)
- Gera 6 imagens profissionais com DALL-E 3: principal, lifestyle, detalhes, benefícios, destaque e embalagem
- Download individual ou em ZIP de todas as imagens

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React + Vite + TailwindCSS |
| Backend | Node.js + Express |
| IA (texto) | GPT-4o (com Vision) |
| IA (imagens) | DALL-E 3 |
| Deploy Frontend | Netlify |
| Deploy Backend | Render |

---

## Rodando Localmente

### Pré-requisitos

- Node.js 18+
- Uma conta e API Key na OpenAI (com acesso ao GPT-4o e DALL-E 3)

### Backend

```bash
cd shopee-boost-ai/backend
npm install
cp .env.example .env
# Edite .env com as suas configurações
npm run dev
```

O servidor sobe em `http://localhost:3001`.

### Frontend

```bash
cd shopee-boost-ai/frontend
npm install
cp .env.example .env
# Edite .env: VITE_API_URL=http://localhost:3001
npm run dev
```

O frontend sobe em `http://localhost:5173`.

---

## Variáveis de Ambiente

### Backend (`backend/.env`)

```env
PORT=3001
FRONTEND_URL=https://seu-frontend.netlify.app
```

> A OpenAI API Key é enviada pelo usuário via frontend no header `x-openai-key` — o backend a usa apenas durante a requisição e **nunca a armazena**.

### Frontend (`frontend/.env`)

```env
VITE_API_URL=https://seu-backend.onrender.com
```

---

## Deploy

### Backend → Render

1. Crie uma conta em [render.com](https://render.com)
2. Clique em **New > Web Service**
3. Conecte o repositório GitHub
4. Configure:
   - **Root Directory:** `shopee-boost-ai/backend`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Environment:** Node
5. Adicione variáveis de ambiente:
   - `PORT` = `3001`
   - `FRONTEND_URL` = URL do seu Netlify (adicionar após o deploy do frontend)
6. Clique em **Deploy**
7. Copie a URL gerada (ex: `https://shopee-boost-ai.onrender.com`)

### Frontend → Netlify

1. Crie uma conta em [netlify.com](https://netlify.com)
2. Clique em **Add new site > Import an existing project**
3. Conecte o repositório GitHub
4. Configure:
   - **Base directory:** `shopee-boost-ai/frontend`
   - **Build command:** `npm run build`
   - **Publish directory:** `shopee-boost-ai/frontend/dist`
5. Adicione variável de ambiente:
   - `VITE_API_URL` = URL do seu Render (ex: `https://shopee-boost-ai.onrender.com`)
6. Clique em **Deploy site**
7. Copie a URL gerada e atualize `FRONTEND_URL` no Render

---

## Como Usar

1. Acesse o frontend no navegador
2. Cole sua **OpenAI API Key** (começa com `sk-`) no campo indicado
3. Faça upload da **foto do produto** (JPG, PNG, WEBP — até 10MB)
4. Preencha o **título** e a **descrição** originais do produto
5. Clique em **"Gerar Assets para Shopee"**
6. Aguarde ~1-2 minutos (análise + geração de 6 imagens)
7. Copie o título e a descrição otimizados
8. Baixe as imagens individualmente ou em ZIP

---

## Arquitetura

```
shopee-boost-ai/
├── frontend/               # React + Vite
│   ├── src/
│   │   ├── App.jsx
│   │   └── components/
│   │       ├── UploadForm.jsx      # Formulário com drag & drop
│   │       ├── ResultPanel.jsx     # Painel de resultados
│   │       ├── ImageGrid.jsx       # Grid 2x3 com download
│   │       └── LoadingOverlay.jsx  # Overlay com progresso
│   └── ...
└── backend/                # Node.js + Express
    ├── server.js
    ├── routes/
    │   └── generate.js     # POST /api/generate
    └── services/
        ├── textService.js  # GPT-4o: título + descrição
        └── imageService.js # DALL-E 3: 6 imagens
```

## Segurança

- A API Key da OpenAI é enviada pelo usuário via header HTTP e usada apenas durante a requisição
- O backend **nunca armazena** a API Key
- CORS configurado para aceitar apenas o domínio do frontend
- Upload de imagem limitado a 10MB e somente tipos de imagem
