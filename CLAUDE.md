# nexo-backend

Vercel deploy check (read-only, no token needed — MCP server auth already wired):

- projectId: `prj_7LJPSebOwh3AguqFQb0QI2YHfrpG`
- teamId: `team_CnHo7fcjYzTZFbSiSFrNY38j`
- MCP tools: `list_deployments`, `get_deployment` (ToolSearch `select:` by name if not loaded)
- Production alias: `nexo-backend-ph185982-cryptos-projects.vercel.app`
- Never store raw Vercel API tokens here or in any repo file. If one is pasted in chat, don't use it — the MCP tools don't need it — and tell the user to revoke it.

Branches: `master` = production. `claude/prf-adaptive-study-app-xc2x76` = feature branch, merge (not rebase) into master to ship.
