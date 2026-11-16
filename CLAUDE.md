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
- Identidade visual Avanteza v2.0 (desde 2026-11-15, também no `crm/`): marinho `#0B1B33`, creme `#F5F0E6`, areia `#EAD9C2`, laranja `#FF6A1F` (só ação principal/foco, como preenchimento com texto marinho), Manrope em tudo, raio de 6px, sem sombras nem degradês. **O tema padrão é o claro** (o escuro segue opcional, em marinho). `vendedoria/tests/marca.test.ts` e `crm/tests/marca.test.ts` conferem contraste e o que é proibido. Use tokens do tema (`bg-card`, `text-foreground`… no vendedoria; `bg-marinho`, `text-suave`… no crm), não `bg-white`/`gray-*`/hex soltos.
- Login único Avanteza ID nas duas apps: rota `/api/sso/callback`, verificador em `src/lib/avanteza-sso.ts`, Central em https://app.avanteza.com.br.
- Vercel do time é **Pro** (desde 2026-11): sem o limite de 2 crons diários do Hobby. Agendamento novo vai no `vendedoria/vercel.json` (cron da Vercel), não em GitHub Actions.
- **Comercial** (ex-CRM, em migração para dentro do Vendedor IA — Etapa 3 do plano): páginas em `vendedoria/src/app/comercial/*`, API em `src/app/api/comercial/*`, lógica em `src/lib/comercial/*`, tabelas `com_*` no `public`. Regras: só `src/lib/comercial/funil/mover.ts` cria/move oportunidade e ele move o Lead junto pelo `aplicarMudancaDeEtapa` (testes `comercial-funil-guarda`, `comercial-mover-lead`); toda rota de `api/comercial` dá 401 sem sessão (`comercial-rotas-401`); o navegador chama a API só por `apiUrl()` de `src/lib/api-url.ts` (sob `/comercial` vira `/comercial/api/*`; `tests/api-url.test.ts` proíbe `fetch("/api…")`). Cópia dos dados do schema `crm`: `node scripts/comercial-copiar.mjs --relatorio|--copiar|--verificar|--refazer --sim|--desfazer --sim` (papel `postgres`; `--api-supabase <ref>` só lê). O CRM antigo continua no ar até o corte. Endereço único (F5): `app.avanteza.com.br/comercial/*` = Vendedor IA por reescrita na Central, **sem basePath** (`assetPrefix: "/comercial"`; caminhos da zona em `src/lib/zona-comercial.ts`; webhooks seguem em `/api/webhooks/*` do domínio antigo); `NEXTAUTH_URL` fica só com a origem antiga. Flags prontas e desligadas: `COMERCIAL_NATIVO=1` (eventos tratados em processo, sem HTTP ao CRM) e, no `crm/`, `CRM_SOMENTE_LEITURA=1` (423). Roteiro do corte: `vendedoria/docs/CORTE_CRM.md`; conteúdo de redirecionamentos pronto em `crm-redirecionamentos/`.
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
- Reuniões do Google Meet (`crm/src/lib/google/`): credenciais OAuth salvas pelo administrador em Configuração → Google (tabela `Configuracao`, segredo cifrado; já cadastradas em produção em 2026-11-09) ou, se existirem, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` no `nexo-crm`, que valem mais (OAuth Web, consentimento Interno, Meet REST API e Calendar API ativadas, redirect `https://nexo-crm-tawny.vercel.app/api/google/callback`). Testes usam `definirTransporteGoogle` (sem rede).
- Conversas do WhatsApp: o Vendedor IA espelha no CRM as conversas dos leads que o CRM conhece (`vendedoria/src/lib/crm-externo/conversas.ts` → `POST /api/integracoes/vendedor-ia/conversas`). A extensão do Chrome foi removida (2026-11-09) — o usuário não gostou; não recriar. Número próprio do consultor: coexistência da API do WhatsApp, passo a passo em `crm/docs/integracao.md`.
