import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Abre a entrega de uma oportunidade ganha. Chamada por funil/mover.ts dentro da mesma transação.
 * Idempotente (uma entrega por oportunidade): ganhar, reabrir e ganhar de novo não duplica.
 * Cartões vêm do modelo padrão ativo, com prazo contado a partir do início. Renovação em 12 meses se há valor mensal.
 */
export async function criarEntregaDaOportunidade(tx: Tx, oportunidadeId: string, agora: Date = new Date()) {
  const ja = await tx.comEntrega.findUnique({ where: { oportunidadeId }, select: { id: true } });
  if (ja) return { id: ja.id, criada: false };
  const op = await tx.comOportunidade.findUnique({ where: { id: oportunidadeId }, select: { nome: true, contatoId: true, valorMensal: true, responsavelId: true } });
  if (!op) throw new Error("Oportunidade não encontrada");
  const modelo = await tx.comModeloEntrega.findFirst({ where: { padrao: true, ativo: true }, include: { itens: { orderBy: { ordem: "asc" } } } });
  const mensal = Number(op.valorMensal.toString());
  const renovacaoEm = mensal > 0 ? new Date(Date.UTC(agora.getUTCFullYear() + 1, agora.getUTCMonth(), agora.getUTCDate())) : null;
  const entrega = await tx.comEntrega.create({
    data: {
      oportunidadeId, contatoId: op.contatoId, nome: op.nome, inicioEm: agora, renovacaoEm, valorMensal: op.valorMensal, modeloId: modelo?.id ?? null,
      cartoes: {
        create: (modelo?.itens ?? []).map((i, ordem) => ({
          titulo: i.titulo, descricao: i.descricao, pilar: i.pilar, ordem, cliente: i.cliente,
          dataAlvo: i.prazoDias != null ? new Date(agora.getTime() + i.prazoDias * 86_400_000) : null,
          checklist: i.checklist as Prisma.InputJsonValue, colunaDesdeEm: agora,
          // Quem vendeu cuida da entrega até alguém redistribuir os cartões.
          responsavelId: op.responsavelId,
        })),
      },
    },
  });
  // Ganhou: o contato passa a ser cliente.
  await tx.comContato.update({ where: { id: op.contatoId }, data: { cicloDeVida: "CLIENTE" } });
  return { id: entrega.id, criada: true };
}
