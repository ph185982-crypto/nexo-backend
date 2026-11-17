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
- Visual "vidro" da plataforma Avanteza (desde 2026-11-17, regra do dono que substitui a v2.0 "plana"; igual à Central): marca marinho `#0B1B33`, creme `#F5F0E6`, areia `#EAD9C2`, laranja `#FF6A1F` (preenchimento com texto marinho; como texto só `text-laranja-texto`), **Plus Jakarta Sans** (next/font, `--font-jakarta`), vidro translúcido com `backdrop-filter` e fallback sólido, sombras suaves e raios do kit (cartões 22px, diálogos 26px, campos 14px, botões em pílula), orbes de fundo, tema claro e escuro (script no `<head>`, chave `avanteza-tema`, sem escolha segue o sistema) e menu lateral recolhível (`avanteza-menu`) com gaveta no celular e atalho "Central". Tokens: `vendedoria/src/styles/avanteza-tokens.css` é **cópia** do kit `agente-bastao-iel/packages/avanteza-kit/tokens.css` (mude lá e copie; guia em `GUIA.md` do kit); `globals.css` mapeia o tema shadcn (`--card` + `--card-a` etc.) para o kit. `vendedoria/tests/marca.test.ts` confere tokens, contraste AA no pior caso do fundo nos dois temas, fonte, laranja nunca como texto sobre claro e hex só no kit (exceções listadas: marcas de terceiros e séries de gráfico). Use tokens do tema (`bg-card`, `text-foreground`, `vidro`, `vidro-forte`, `shadow-vidro/suave/brilho`), não `bg-white`/`gray-*`/hex soltos nem `hsl(var(--card))` sem o alfa. O `crm/` virou só redirecionamentos (não tem mais tela).
- Login único Avanteza ID nas duas apps: rota `/api/sso/callback`, verificador em `src/lib/avanteza-sso.ts`, Central em https://app.avanteza.com.br.
- Vercel do time é **Pro** (desde 2026-11): sem o limite de 2 crons diários do Hobby. Agendamento novo vai no `vendedoria/vercel.json` (cron da Vercel), não em GitHub Actions.
- **Comercial** (ex-CRM, incorporado ao Vendedor IA; CRM antigo desligado em 2026-11-17): páginas em `vendedoria/src/app/comercial/*`, API em `src/app/api/comercial/*`, lógica em `src/lib/comercial/*`, tabelas `com_*` no `public`. Regras: só `src/lib/comercial/funil/mover.ts` cria/move oportunidade e ele move o Lead junto pelo `aplicarMudancaDeEtapa` (testes `comercial-funil-guarda`, `comercial-mover-lead`); toda rota de `api/comercial` dá 401 sem sessão (`comercial-rotas-401`); o navegador chama a API só por `apiUrl()` de `src/lib/api-url.ts` (sob `/comercial` vira `/comercial/api/*`; `tests/api-url.test.ts` proíbe `fetch("/api…")`). Cópia dos dados do schema `crm`: `node scripts/comercial-copiar.mjs --relatorio|--copiar|--verificar|--refazer --sim|--desfazer --sim` (papel `postgres`; `--api-supabase <ref>` só lê). O CRM antigo foi desligado (ver seção crm). Endereço único (F5): `app.avanteza.com.br/comercial/*` = Vendedor IA por reescrita na Central, **sem basePath** (`assetPrefix: "/comercial"`; caminhos da zona em `src/lib/zona-comercial.ts`; webhooks seguem em `/api/webhooks/*` do domínio antigo); `NEXTAUTH_URL` fica só com a origem antiga. `COMERCIAL_NATIVO=1` ligado em produção desde o corte (eventos tratados em processo, sem HTTP ao CRM). Roteiro do corte: `vendedoria/docs/CORTE_CRM.md`; conteúdo de redirecionamentos pronto em `crm-redirecionamentos/`.
- An hourly Routine (Claude Code Remote trigger) checks `/api/health` and recent runtime errors, and alerts if something's broken. Don't recreate it — check `list_triggers` for the existing one before adding another.

## crm (DESLIGADO em 2026-11-17 — virou só redirecionamentos)

- O CRM antigo foi incorporado ao Vendedor IA (Comercial, tabelas `com_*`). A pasta `crm/` agora contém SÓ um site estático
  de redirecionamentos (`crm/vercel.json`, `crm/public/`): `/p/{token}` → 308 `https://app.avanteza.com.br/comercial/p/{token}`,
  `/api/*` → 410, o resto → 308 `https://app.avanteza.com.br/comercial`. Projeto Vercel `nexo-crm`
  (`prj_Xzk75OXp2fm02XwnOUtpr0P84mvn`, Root Directory = `crm`) **não deve ser pausado** (pausado, os links antigos param).
  Mantenha `crm/.vercelignore` (a armadilha do deploy vazio continua valendo). O código antigo está no histórico do git.
- O schema `crm` do Supabase continua intacto e congelado (`CRM_SOMENTE_LEITURA=1`); **não apagar** sem ordem explícita do dono.
  Backup lógico final conferido (30 tabelas, 5.735 linhas) feito no corte. `DROP SCHEMA crm` só por decisão separada.
- No corte: recópia `--refazer` + `--verificar` verde (41 checagens) e 2ª cópia = 0; `COMERCIAL_NATIVO=1` no Vendedor IA
  (eventos tratados em processo); Central com `CRM_URL=https://nexo-vendedoria.vercel.app` (API de entregas do Vendedor IA).
  O teste da cópia usa `vendedoria/tests/fixtures/crm-schema.prisma`. Limpeza C14 (remover `CRM_URL`/`CRM_API_KEY` e a outbox)
  depois de 2 semanas sem divergência.
- A rotina horária não deve mais checar o `/api/health` do `nexo-crm` (responde 410 por desenho).
