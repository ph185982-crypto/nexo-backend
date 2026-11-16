// Entrada de linha de comando da importação (chamada por scripts/importar-contratos.mjs). Só contagens e erros.
import fs from "node:fs";
import { prisma } from "@/lib/prisma/client";
import { importarHistorico, lerArquivoHistorico } from "./importar";

async function main() {
  const args = process.argv.slice(2);
  const arquivo = args[args.indexOf("--arquivo") + 1];
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL não definido"); return 2; }
  const itens = lerArquivoHistorico(JSON.parse(fs.readFileSync(arquivo, "utf8")));
  const r = await importarHistorico(itens, { clicksign: args.includes("--clicksign") });
  console.log(JSON.stringify({ ...r, erros: r.erros.length }, null, 2));
  for (const e of r.erros) console.error("erro:", e);
  return r.erros.length ? 1 : 0;
}

main().then(async (c) => { await prisma.$disconnect(); process.exit(c); }, async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
