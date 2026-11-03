// Aplica as migrações do Prisma no deploy — no lugar do antigo
// `prisma db push --accept-data-loss`, que podia apagar colunas (e dados) em
// produção sem aviso a cada build.
//
// Banco vazio (CI, testes): aplica tudo. Banco já migrado: só o que falta.
// Sem baseline nem `db push`: o CRM nasceu com migrações.
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
function run(args, { input, silencioso } = {}) {
  const r = spawnSync(prisma, args, { cwd: raiz, input, encoding: "utf8", env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  if (!silencioso) {
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
  }
  return r.status === 0;
}

if (!run(["migrate", "deploy"])) process.exit(1);
console.log("[db-deploy] OK");
