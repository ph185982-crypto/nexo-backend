# nexo-backend

Vercel deploy check (read-only, no token needed — MCP server auth already wired):

- projectId: `prj_7LJPSebOwh3AguqFQb0QI2YHfrpG`
- teamId: `team_CnHo7fcjYzTZFbSiSFrNY38j`
- MCP tools: `list_deployments`, `get_deployment` (ToolSearch `select:` by name if not loaded)
- Production alias: `nexo-backend-ph185982-cryptos-projects.vercel.app`
- Never store raw Vercel API tokens here or in any repo file. If one is pasted in chat, don't use it — the MCP tools don't need it — and tell the user to revoke it.

Branches: `master` = production. `claude/prf-adaptive-study-app-xc2x76` = feature branch, merge (not rebase) into master to ship.

## nexo-vendedoria (WhatsApp CRM/SDR, in `vendedoria/`)

- projectId: `prj_DYSECpkmX38nS45UbD03wQPK4NWb`, teamId: `team_CnHo7fcjYzTZFbSiSFrNY38j`
- Production alias: `nexo-vendedoria.vercel.app` — Root Directory = `vendedoria`, deploys from `master`.
- Health check: `GET /api/health` → `{"status":"ok","db":"connected"}`. Use `mcp__Vercel__web_fetch_vercel_url` to check it and `mcp__Vercel__get_runtime_errors`/`get_deployment_build_logs` to diagnose failures — no token needed.
- **Known gotcha (bit us once, 2026-09-03):** the repo-root `.vercelignore` lists `vendedoria/` (so the *other* projects building from repo root exclude it). If `vendedoria/.vercelignore` is ever deleted, this project falls back to the root one and silently deploys an empty app — build succeeds, deployment shows `READY`, but every route 404s. Keep `vendedoria/.vercelignore` present; if this class of "READY but 404 everywhere" bug ever resurfaces, check for this first.
- Identidade visual Avanteza (paleta, Manrope/Inter) desde 2026-11-03; `vendedoria/tests/marca.test.ts` confere contraste e cores proibidas. Use tokens do tema (`bg-card`, `text-foreground`…), não `bg-white`/hex soltos — o tema padrão é o escuro.
- An hourly Routine (Claude Code Remote trigger) checks `/api/health` and recent runtime errors, and alerts if something's broken. Don't recreate it — check `list_triggers` for the existing one before adding another.

## crm (CRM Avanteza — ferramenta própria, em `crm/`)

- Next.js + Prisma, **banco próprio** (não compartilha tabelas com o `vendedoria/`); a ligação é por eventos HTTP, contrato em `crm/docs/integracao.md`. Ver `crm/README.md`.
- Vercel: projeto `nexo-crm`, projectId `prj_Xzk75OXp2fm02XwnOUtpr0P84mvn`, teamId `team_CnHo7fcjYzTZFbSiSFrNY38j` (criado 2026-11-04). Produção: `nexo-crm-tawny.vercel.app` (o nome `nexo-crm.vercel.app` já era de outra conta). Root Directory = `crm`, deploy do `master`. Health: `GET /api/health` → `{"status":"ok","db":"connected"}`.
  O acesso MCP da Vercel nas sessões do Claude **não tem permissão** para criar projeto nem ler/gravar variáveis de ambiente (403). Deploy em projeto existente funciona.
  **Banco (criado 2026-11-03):** schema `crm` dentro do projeto Supabase `nexo-vendedoria` (ref `kwzbbjhteanvibfqwkky`) — o plano gratuito não permite um 3º projeto. Usuário próprio `crm_app` (dono do schema, `search_path = crm`, sem acesso às tabelas do vendedoria em `public`). Conexão pelo pooler `aws-0-us-east-1.pooler.supabase.com`, usuário `crm_app.kwzbbjhteanvibfqwkky`, com `?schema=crm` nas duas URLs. Migrações, seed (funil Vendas, motivos, admin) e a chave "Vendedor IA" já aplicados. Este ambiente não alcança a porta do Postgres: mudanças diretas no banco vão pela API SQL do Supabase.
  O Vendedor IA tem `CRM_URL=https://nexo-crm-tawny.vercel.app` e `CRM_API_KEY` (chave "Vendedor IA") configurados; o `/api/health` dele mostra o resultado do envio no campo `crm`.
- **Mesma armadilha do vendedoria:** o `.vercelignore` da raiz lista `crm/`; se `crm/.vercelignore` for apagado, o projeto cai no da raiz e faz deploy vazio (build `READY`, todas as rotas 404). Mantenha `crm/.vercelignore`.
- Regra de código: só `crm/src/lib/funil/mover.ts` cria oportunidade ou troca a etapa dela (há teste que falha se outro arquivo fizer).
- Agente de combinados (`crm/src/lib/combinados/agente.ts`) usa o SDK da Anthropic e precisa de `ANTHROPIC_API_KEY` no projeto `nexo-crm`; sem ela as análises ficam `SEM_CHAVE`. Testes trocam o modelo por um falso (`definirModelo`).
- Reuniões do Google Meet (`crm/src/lib/google/`): precisa de `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` no `nexo-crm` (OAuth Web, consentimento Interno, Meet REST API e Calendar API ativadas, redirect `https://nexo-crm-tawny.vercel.app/api/google/callback`). Testes usam `definirTransporteGoogle` (sem rede).
- Conversas do WhatsApp: o Vendedor IA espelha no CRM as conversas dos leads que o CRM conhece (`vendedoria/src/lib/crm-externo/conversas.ts` → `POST /api/integracoes/vendedor-ia/conversas`). A extensão do Chrome foi removida (2026-11-09) — o usuário não gostou; não recriar. Número próprio do consultor: coexistência da API do WhatsApp, passo a passo em `crm/docs/integracao.md`.
