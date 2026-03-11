# 🚀 NEXO — Guia de Deploy

## ⚠️ Ponto mais importante

O frontend (nexo.jsx) roda no navegador do usuário.
Quando ele faz uma requisição ao backend, precisa de uma **URL pública com HTTPS**.

`fetch("http://localhost:8000")` só funciona se o usuário estiver
rodando o backend na **própria máquina**. Para usar como SaaS, precisa de servidor.

---

## Opção A — Railway (mais fácil, ~$5/mês)

```bash
# 1. Instale o Railway CLI
npm install -g @railway/cli

# 2. Entre no diretório do backend
cd backend

# 3. Login e deploy
railway login
railway new
railway up

# 4. Adicione PostgreSQL e Redis
railway add postgresql
railway add redis

# 5. Configure variáveis de ambiente no dashboard railway.app
# ANTHROPIC_API_KEY, APIFY_TOKEN, SERPAPI_KEY, SECRET_KEY

# 6. Pegue a URL pública gerada (ex: https://nexo-production.up.railway.app)
# 7. Abra nexo.jsx e troque a linha:
#    const API = "http://localhost:8000"
#    por:
#    const API = "https://nexo-production.up.railway.app"
```

## Opção B — Docker local (para usar só você na mesma máquina)

```bash
cd backend
cp .env.example .env
# Preencha as chaves no .env

docker-compose up -d
# Backend em: http://localhost:8000
# Docs em:    http://localhost:8000/docs

# Frontend: abra nexo.jsx aqui no Claude.ai como Artifact
# Já aponta para localhost:8000 — funciona se backend estiver rodando
```

## Opção C — VPS (DigitalOcean/Contabo, ~$6/mês)

```bash
# Na VPS:
git clone <seu-repo> nexo
cd nexo/backend
cp .env.example .env
# Preencha .env

# Instalar Docker
curl -fsSL https://get.docker.com | sh

# Subir
docker-compose up -d

# Configurar nginx com SSL (Let's Encrypt)
# Apontar api.seudominio.com para o servidor
# Trocar API = "http://localhost:8000" no frontend pela URL real
```

---

## Primeiro usuário

Após subir o backend, crie seu usuário pela tela de cadastro do frontend,
ou via API:

```bash
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Seu Nome","email":"seu@email.com","password":"suasenha123"}'
```

## Primeiro scan de produtos

```bash
# Obtenha o token do login
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -d "username=seu@email.com&password=suasenha123" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# Dispare um scan
curl -X POST http://localhost:8000/api/products/scan \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"keywords":["mini projector portable","hair dryer brush rotating","massage gun"],"min_markup":3.0}'
```

---

## Bugs corrigidos nesta versão (v3)

| Bug | Descrição | Fix |
|---|---|---|
| DB singleton quebrado | Cada router criava instância com pool=None | Pool agora é module-level, compartilhado |
| bcrypt bloqueava event loop | hashpw() síncrono em async def | Wrapped em asyncio.to_thread() |
| Rota /favorites conflito | Declarada depois de /{product_id} | Movida para antes |
| email-validator faltando | EmailStr sem dependência | Adicionado ao requirements.txt |
| CORS bloqueava requisições | Origens fixas | ALLOWED_ORIGINS=* em dev |
| Erro de rede silencioso | fetch falhava sem mensagem clara | Mensagem de erro útil adicionada |
