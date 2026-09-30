// Carimbo inicial do livro-razão: lançamentos que já existiam antes do histórico
// ser ligado ganham uma entrada "criado" (com a data de criação original), para
// o histórico ficar completo desde o primeiro registro. Roda uma vez, é
// idempotente (só grava para ids que ainda não têm entrada) e guardado por flag.

import { prisma } from "@/lib/prisma/client";

const FLAG = "historico_financeiro_inicial_v1";
const LOTE = 500;

const MODELOS = ["Transacao", "ReceitaPrevistaMax", "ContaPagarMax", "DividaMax", "MetaFinanceiraMax"] as const;

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function carimbarHistoricoInicial(): Promise<void> {
  const ja = await prisma.contextoPedro.findUnique({ where: { chave: FLAG } });
  if (ja) return;

  for (const modelo of MODELOS) {
    const del = (prisma as any)[modelo.charAt(0).toLowerCase() + modelo.slice(1)];
    const comHistorico = new Set(
      (await prisma.historicoFinanceiro.findMany({ where: { entidade: modelo }, distinct: ["entidade_id"], select: { entidade_id: true } }))
        .map((h) => h.entidade_id),
    );

    let cursor: string | undefined;
    for (;;) {
      const linhas: any[] = await del.findMany({
        take: LOTE,
        orderBy: { id: "asc" },
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (linhas.length === 0) break;
      cursor = linhas[linhas.length - 1].id;

      const novas = linhas.filter((l) => !comHistorico.has(String(l.id)));
      if (novas.length) {
        // createMany direto no modelo do histórico (não passa pelo middleware de auditoria)
        await prisma.historicoFinanceiro.createMany({
          data: novas.map((l) => ({
            entidade: modelo,
            entidade_id: String(l.id),
            acao: "criado",
            antes: undefined,
            depois: JSON.parse(JSON.stringify(l)),
            criado_em: l.criado_em ?? new Date(),
          })),
        });
      }
      if (linhas.length < LOTE) break;
    }
  }

  await prisma.contextoPedro.upsert({
    where: { chave: FLAG },
    create: { chave: FLAG, valor: new Date().toISOString() },
    update: { valor: new Date().toISOString() },
  });
}
