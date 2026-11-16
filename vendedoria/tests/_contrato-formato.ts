// Formato (só os caminhos das chaves, sem valores) de respostas JSON — base do teste de contrato da API de entregas.
// O mesmo arquivo de referência é conferido por crm/tests/integracao-avanteza.test.ts (enquanto o CRM existir):
// as duas implementações (CRM antigo e Vendedor IA) precisam devolver exatamente as mesmas chaves.
import { join } from "node:path";

export function formato(v: unknown, caminho = "", saida = new Set<string>()): Set<string> {
  if (Array.isArray(v)) { saida.add(`${caminho}[]`); for (const x of v) formato(x, `${caminho}[]`, saida); }
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { saida.add(`${caminho}.${k}`); formato(x, `${caminho}.${k}`, saida); }
  return saida;
}

/** npm test roda em vendedoria/. */
export const ARQUIVO_CONTRATO = join(process.cwd(), "tests", "fixtures", "contrato-entregas.json");
