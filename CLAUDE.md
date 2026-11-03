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
- An hourly Routine (Claude Code Remote trigger) checks `/api/health` and recent runtime errors, and alerts if something's broken. Don't recreate it — check `list_triggers` for the existing one before adding another.

## crm (CRM Avanteza — ferramenta própria, em `crm/`)

- Next.js + Prisma, **banco próprio** (não compartilha tabelas com o `vendedoria/`); a ligação é por eventos HTTP, contrato em `crm/docs/integracao.md`. Ver `crm/README.md`.
- Vercel: projeto **ainda não criado**. Ao criar: Root Directory = `crm`, variáveis em `crm/.env.example`. (Quando existir, registrar aqui `projectId` e o alias, como no vendedoria.)
- **Mesma armadilha do vendedoria:** o `.vercelignore` da raiz lista `crm/`; se `crm/.vercelignore` for apagado, o projeto cai no da raiz e faz deploy vazio (build `READY`, todas as rotas 404). Mantenha `crm/.vercelignore`.
- Regra de código: só `crm/src/lib/funil/mover.ts` cria oportunidade ou troca a etapa dela (há teste que falha se outro arquivo fizer).
