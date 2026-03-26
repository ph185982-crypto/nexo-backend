# PROMPT — Agente de Setup Completo do VendedorIA

Cole este prompt em uma nova sessão do Claude Code para executar todas as configurações automaticamente.

---

## CONTEXTO

Você está dentro do projeto VendedorIA localizado em:
`C:\Users\ph185\Downloads\nexo-v3-corrigido\.claude\worktrees\clever-hermann\vendedoria`

Este é um CRM SaaS para WhatsApp com agente de IA, construído em Next.js 15 + Prisma + PostgreSQL rodando via Docker.

As credenciais já estão configuradas no `.env`:
- `META_WHATSAPP_ACCESS_TOKEN` — token permanente do Facebook/Meta (já preenchido)
- `GOOGLE_AI_API_KEY` — chave do Google Gemini (já preenchida)
- `META_WHATSAPP_VERIFY_TOKEN` = `vendedoria_webhook_2025`

## TAREFAS

Execute todas as tarefas abaixo em ordem. Não pule nenhuma. Confirme cada etapa antes de avançar.

---

### TAREFA 1 — Garantir que o sistema está rodando

```bash
cd "C:\Users\ph185\Downloads\nexo-v3-corrigido\.claude\worktrees\clever-hermann\vendedoria"
docker compose ps
```

Se os containers NÃO estiverem rodando (`Up`), execute:
```bash
docker compose up -d
```

Aguarde 20 segundos e verifique os logs:
```bash
docker compose logs app --tail=20
```

Confirme que aparece `✓ Ready` nos logs antes de prosseguir.

---

### TAREFA 2 — Testar o login na plataforma

Acesse http://localhost:3001 no navegador.

Credenciais padrão:
- **Email:** `admin@vendedoria.com`
- **Senha:** `admin123`

Se o login não funcionar (erro de sessão/host), verifique se `AUTH_TRUST_HOST=true` está no `docker-compose.yml`. Se não estiver, adicione na seção `environment` do serviço `app` e execute:
```bash
docker compose down && docker compose up -d
```

---

### TAREFA 3 — Iniciar o tunnel Cloudflare para URL pública

O binário `cloudflared.exe` já está na pasta do projeto. Execute:

```bash
cd "C:\Users\ph185\Downloads\nexo-v3-corrigido\.claude\worktrees\clever-hermann\vendedoria"
./cloudflared.exe tunnel --url http://localhost:3001 --no-autoupdate
```

Aguarde até aparecer a linha:
```
Your quick Tunnel has been created! Visit it at: https://XXXX.trycloudflare.com
```

**Anote a URL** — ela será usada nos próximos passos.
Formato: `https://XXXX.trycloudflare.com`

---

### TAREFA 4 — Configurar o Webhook no Meta Developers

1. Acesse https://developers.facebook.com → Meus Apps → selecione o app VendedorIA
2. Vá em **WhatsApp → Configuração**
3. Na seção **Webhooks**, clique em **Editar**
4. Preencha:
   - **URL de callback:** `https://XXXX.trycloudflare.com/api/webhooks/whatsapp`
   - **Token de verificação:** `vendedoria_webhook_2025`
5. Clique em **Verificar e salvar**
6. Após verificar, clique em **Assinar** no campo `messages`

---

### TAREFA 5 — Cadastrar o Provider WhatsApp no painel

1. Acesse http://localhost:3001 → login com `admin@vendedoria.com / admin123`
2. Vá em **Configurações → Providers** (ou **WhatsApp**)
3. Clique em **Novo Provider**
4. Preencha:
   - **Nome:** `WhatsApp Principal`
   - **Phone Number ID:** (copie do painel Meta → WhatsApp → Configuração da API)
   - **Access Token:** `EAAcNazmVPQ8BQZBr0tv2v8aYD5e3dI11tr3AL58d6b03VVAg2MkzIi7ZAQVZCb2RBLsyEDSJgx7Uv29mZCIejP8bZCL1Ct1WK1ElowZCRV8TiiTuyVxCWT2Gp29Fca9vJdZBzGKo8kNc0vFzyLadfLGbPr8jdmA9QCWuVVDs7fr06B8reHokZBADDdetRZAWy4lJkaQZDZD`
5. Salve

---

### TAREFA 6 — Criar e ativar o Agente de IA

1. No painel, vá em **Agentes** → **Novo Agente**
2. Preencha:
   - **Nome:** `Assistente VendedorIA`
   - **Provider IA:** `GOOGLE` (Gemini)
   - **Provider WhatsApp:** selecione o criado na Tarefa 5
   - **System Prompt:** `Você é um assistente de vendas profissional e amigável. Responda sempre em português brasileiro. Seja conciso e objetivo. Quando identificar alto interesse do cliente, escale para um humano.`
3. Ative o agente (status → **ACTIVE**)

---

### TAREFA 7 — Testar o fluxo completo

No painel Meta Developers → WhatsApp → Configuração da API:
1. Adicione seu número pessoal como **número de teste**
2. Envie uma mensagem de WhatsApp para o número do app
3. Verifique no painel VendedorIA (seção **Conversas**) se a mensagem apareceu
4. Aguarde a resposta automática da IA (até 10 segundos)

Se a IA não responder, verifique os logs:
```bash
docker compose logs app --tail=50 | grep -E "AI|agent|webhook|error" -i
```

---

### TAREFA 8 — Verificar APIs conectadas

Execute no terminal para confirmar que todas as APIs respondem:

```bash
# Testar Google Gemini
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyBnqdYTBoGsQ-EQK9_eerflCUVer5mLTx8" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Gemini OK -', len(d.get('models',[])), 'modelos disponíveis')"

# Testar Meta WhatsApp API
curl -s -H "Authorization: Bearer EAAcNazmVPQ8BQZBr0tv2v8aYD5e3dI11tr3AL58d6b03VVAg2MkzIi7ZAQVZCb2RBLsyEDSJgx7Uv29mZCIejP8bZCL1Ct1WK1ElowZCRV8TiiTuyVxCWT2Gp29Fca9vJdZBzGKo8kNc0vFzyLadfLGbPr8jdmA9QCWuVVDs7fr06B8reHokZBADDdetRZAWy4lJkaQZDZD" "https://graph.facebook.com/v20.0/me" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Meta OK - ID:', d.get('id','erro'))"

# Testar app local
curl -s -o /dev/null -w "App local: HTTP %{http_code}\n" http://localhost:3001/api/auth/providers
```

Todos devem retornar OK. Se algum falhar, relate o erro com o output completo.

---

### TAREFA 9 — Status final

Após completar todas as tarefas, reporte:
1. URL pública do tunnel ativo
2. Resultado dos testes de API (Tarefa 8)
3. Screenshot ou confirmação do painel com agente ACTIVE
4. Confirmação de que mensagem de teste foi recebida e respondida

---

## ARQUITETURA RESUMIDA

| Componente | Tecnologia | Status |
|---|---|---|
| Frontend + API | Next.js 15 App Router | Docker porta 3001 |
| Banco de dados | PostgreSQL 16 | Docker porta 5433 |
| IA Principal | Google Gemini (google-generative-ai) | Configurado |
| IA Fallback | Anthropic Claude / OpenAI GPT | Chaves opcionais |
| Transcrição áudio | OpenAI Whisper | Requer OPENAI_API_KEY |
| WhatsApp | Meta Business API Graph v20.0 | Token configurado |
| Tunnel HTTPS | Cloudflare Quick Tunnel | cloudflared.exe na pasta |

## CREDENCIAIS CONFIGURADAS

| Variável | Valor |
|---|---|
| `META_WHATSAPP_ACCESS_TOKEN` | Token permanente — já no .env |
| `GOOGLE_AI_API_KEY` | AIzaSyBnq... — já no .env |
| `META_WHATSAPP_VERIFY_TOKEN` | `vendedoria_webhook_2025` |
| Login admin | `admin@vendedoria.com` / `admin123` |
