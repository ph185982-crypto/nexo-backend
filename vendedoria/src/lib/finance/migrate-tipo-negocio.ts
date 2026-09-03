import { prisma } from "@/lib/prisma/client";

const FLAG_KEY = "migrou_vendedoria_para_nexo";

// Renomeia o valor legado "vendedoria" pra "nexo" em todas as tabelas
// financeiras do Max. Idempotente e guardado por flag em ContextoPedro —
// seguro pra chamar em todo carregamento do dashboard/toda mensagem do Max.
export async function migrarVendedoriaParaNexo(): Promise<void> {
  const ja = await prisma.contextoPedro.findUnique({ where: { chave: FLAG_KEY } });
  if (ja) return;

  await prisma.$transaction([
    prisma.transacao.updateMany({
      where: { tipo_negocio: "vendedoria" },
      data: { tipo_negocio: "nexo" },
    }),
    prisma.contaPagarMax.updateMany({
      where: { tipo_negocio: "vendedoria" },
      data: { tipo_negocio: "nexo" },
    }),
    prisma.receitaPrevistaMax.updateMany({
      where: { tipo_negocio: "vendedoria" },
      data: { tipo_negocio: "nexo" },
    }),
    prisma.metaFinanceiraMax.updateMany({
      where: { tipo_negocio: "vendedoria" },
      data: { tipo_negocio: "nexo" },
    }),
  ]);

  await prisma.contextoPedro.upsert({
    where: { chave: FLAG_KEY },
    create: { chave: FLAG_KEY, valor: new Date().toISOString() },
    update: { valor: new Date().toISOString() },
  });
}
