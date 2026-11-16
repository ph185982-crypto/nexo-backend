// Importa o histórico do app Contratos antigo (localStorage "nexo_history_v1" exportado pelo Cowork, ver
// docs/PROMPT_COWORK_EXPORTAR_CONTRATOS.md) para as tabelas de contratos do Comercial.
//
//   node scripts/importar-contratos.mjs --arquivo historico-contratos-<host>.json [--clicksign]
//
// Idempotente: rodar de novo cria 0 (chave: envelopeId da ClickSign ou o id original do histórico).
// --clicksign: consulta cada envelope importado (status real e PDF assinado) e traz os 50 envelopes mais recentes
// da conta que não estão em nenhum histórico (precisa de CLICKSIGN_TOKEN no ambiente).
// Itens do ZapSign entram como provedor "zapsign", só leitura. Importados não disparam a automação do assinado.
// Conexão: DATABASE_URL. Não imprime dados de clientes, só contagens e erros. Lógica em
// src/lib/comercial/contratos/importar.ts (carregada pelo tsx).
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const i = args.indexOf("--arquivo");
if (i < 0 || !args[i + 1]) {
  console.error("Uso: node scripts/importar-contratos.mjs --arquivo <historico.json> [--clicksign]");
  process.exit(2);
}
args[i + 1] = path.resolve(args[i + 1]); // o processo filho roda na raiz do app
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// O tsx resolve "@/…" pelo tsconfig do app; a lógica fica em TypeScript (testada em tests/contratos-importar.test.ts).
const r = spawnSync(path.join(raiz, "node_modules", ".bin", "tsx"), [path.join(raiz, "src", "lib", "comercial", "contratos", "importar-cli.ts"), ...args], { cwd: raiz, stdio: "inherit", env: process.env });
process.exit(r.status ?? 1);
