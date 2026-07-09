import { prisma } from "@/lib/prisma/client";
import { getBrasiliaNow } from "../config";

export async function salvarInformacao(args: Record<string, unknown>): Promise<string> {
  const chave = args.chave as string;
  const valor = args.valor as string;
  const categoria = (args.categoria as string) ?? "outros";

  await prisma.contextoPedro.upsert({
    where: { chave },
    update: {
      valor,
      categoria,
      atualizado_em: getBrasiliaNow(),
    },
    create: {
      chave,
      valor,
      categoria,
    },
  });

  return `Informacao salva: "${chave}" = "${valor}" (categoria: ${categoria})`;
}
