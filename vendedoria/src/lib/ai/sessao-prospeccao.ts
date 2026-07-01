import { prisma } from '@/lib/prisma/client';

export interface SessaoProspeccao {
  tipoNegocio?: string;
  urgencia?: string;
  dataHoraPreferida?: string; // ISO string
  sinalOportunidade?: string;
  nomeContato?: string;
  empresaNome?: string;
  notas?: string;
}

export async function atualizarSessaoProspeccao(
  conversationId: string,
  dados: Partial<SessaoProspeccao>,
): Promise<void> {
  const conversa = await prisma.whatsappConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, sessaoProspeccao: true },
  });
  if (!conversa) return;

  const sessaoAtual = (conversa.sessaoProspeccao as Record<string, unknown>) || {};

  await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: {
      sessaoProspeccao: {
        ...sessaoAtual,
        ...(dados as Record<string, unknown>),
      } as import('@prisma/client').Prisma.InputJsonValue,
    },
  });
}

export async function buscarSessaoProspeccao(
  conversationId: string,
): Promise<SessaoProspeccao> {
  const conversa = await prisma.whatsappConversation.findUnique({
    where: { id: conversationId },
    select: { sessaoProspeccao: true },
  });
  return ((conversa?.sessaoProspeccao as SessaoProspeccao) ?? {});
}

export async function limparSessaoProspeccao(
  conversationId: string,
): Promise<void> {
  await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: { sessaoProspeccao: {} },
  });
}
