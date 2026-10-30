// Aplica as migrações do Prisma no deploy — no lugar do antigo
// `prisma db push --accept-data-loss`, que podia apagar colunas (e dados) em
// produção sem aviso a cada build.
//
// Primeira execução num banco que já existe (criado por db push, sem a tabela
// _prisma_migrations): marca a migração baseline como aplicada SEM executar o
// SQL dela (as tabelas já estão lá) e segue com as migrações novas. Banco
// vazio (CI, testes): aplica tudo. Banco já migrado: só o que falta.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const prisma = join(raiz, "node_modules", ".bin", "prisma");
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("[db-deploy] DIRECT_URL/DATABASE_URL não definido");
  process.exit(1);
}
const BASELINE = "20260101000000_baseline";

function run(args, { input, silencioso } = {}) {
  const r = spawnSync(prisma, args, { cwd: raiz, input, encoding: "utf8", env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  if (!silencioso) {
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
  }
  return r.status === 0;
}

const existe = (sql) => run(["db", "execute", "--stdin", "--url", url], { input: sql, silencioso: true });

const temMigrations = existe('SELECT 1 FROM "_prisma_migrations" LIMIT 1');
const temTabelas = existe('SELECT 1 FROM "Lead" LIMIT 1');

if (!temMigrations && temTabelas) {
  console.log(`[db-deploy] Banco existente sem histórico de migrações — registrando baseline ${BASELINE} como aplicada (nenhum SQL executado)`);
  if (!run(["migrate", "resolve", "--applied", BASELINE])) process.exit(1);
} else if (!temTabelas) {
  console.log("[db-deploy] Banco vazio — aplicando todas as migrações");
} else {
  console.log("[db-deploy] Banco já migrado — aplicando só o que falta");
}

if (!run(["migrate", "deploy"])) process.exit(1);
console.log("[db-deploy] OK");
