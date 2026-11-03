// Cria uma chave de serviço para um sistema que chama o CRM (ex.: Vendedor IA).
// Uso: npm run chave:criar -- "Vendedor IA"
// A chave inteira é mostrada uma vez; o banco guarda só o hash. Guarde-a como segredo no sistema que vai chamar.
import { prisma } from "../src/lib/prisma";
import { gerarChave } from "../src/lib/integracao/chave";

async function main() {
  const nome = process.argv[2]?.trim();
  if (!nome) throw new Error('Uso: npm run chave:criar -- "Nome do sistema"');
  const { chave, prefixo, hash } = gerarChave();
  await prisma.chaveIntegracao.create({ data: { nome, prefixo, hash } });
  console.log(`Chave criada para "${nome}". Copie agora; ela não será mostrada de novo:\n\n${chave}\n`);
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
