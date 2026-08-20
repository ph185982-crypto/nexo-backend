import { prisma } from "@/lib/prisma/client";
import { type SDRSession, SDR_EMPTY_SESSION } from "./types";

const SDR_KEY = "sdr";

export async function loadSdrSession(conversationId: string): Promise<SDRSession> {
  const conv = await prisma.whatsappConversation.findUnique({
    where: { id: conversationId },
    select: { sessaoProspeccao: true },
  });
  const raw = (conv?.sessaoProspeccao as Record<string, unknown>) ?? {};
  const sdr = raw[SDR_KEY] as SDRSession | undefined;
  if (sdr?.mode === "SDR") return sdr;
  return { ...SDR_EMPTY_SESSION };
}

export async function saveSdrSession(
  conversationId: string,
  session: SDRSession,
): Promise<void> {
  const conv = await prisma.whatsappConversation.findUnique({
    where: { id: conversationId },
    select: { sessaoProspeccao: true },
  });
  const current = (conv?.sessaoProspeccao as Record<string, unknown>) ?? {};
  await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: {
      sessaoProspeccao: ({
        ...current,
        [SDR_KEY]: session,
      } as unknown) as import("@prisma/client").Prisma.InputJsonValue,
    },
  });
}
