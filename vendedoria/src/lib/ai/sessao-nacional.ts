import { prisma } from '@/lib/prisma/client';

export async function atualizarSessaoNacional(
  conversationId: string,
  dados: Record<string, unknown>
): Promise<void> {
  const conversa = await prisma.whatsappConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, sessaoNacional: true },
  });
  if (!conversa) return;

  const sessaoAtual = (conversa.sessaoNacional as Record<string, unknown>) || {};

  await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: { sessaoNacional: { ...sessaoAtual, ...dados } as import('@prisma/client').Prisma.InputJsonValue },
  });
}

export async function buscarSessaoNacional(
  conversationId: string
): Promise<Record<string, unknown>> {
  const conversa = await prisma.whatsappConversation.findUnique({
    where: { id: conversationId },
    select: { sessaoNacional: true },
  });
  return (conversa?.sessaoNacional as Record<string, unknown>) || {};
}

export async function limparSessaoNacional(
  conversationId: string
): Promise<void> {
  await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: { sessaoNacional: {} },
  });
}
