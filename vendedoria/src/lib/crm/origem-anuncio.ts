// Grava no lead a origem do anúncio Click-to-WhatsApp. Idempotente: o mesmo
// referral reenviado pela Meta (retry/replay do webhook) não altera nada.

import { prisma } from "@/lib/prisma/client";
import type { OrigemAnuncio } from "@/lib/meta-referral";

export type ResultadoOrigem = "criada" | "atualizada" | "inalterada";

export async function registrarOrigemAnuncio(
  leadId: string,
  conversationId: string | null,
  origem: OrigemAnuncio,
  quando: Date = new Date(),
): Promise<ResultadoOrigem> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { ctwaClid: true, adSourceId: true, leadOrigin: true },
  });
  if (!lead) return "inalterada";

  const temAnterior = Boolean(lead.ctwaClid || lead.adSourceId);
  const mudouClid = Boolean(origem.ctwaClid) && origem.ctwaClid !== lead.ctwaClid;
  const mudouAnuncio = Boolean(origem.adSourceId) && origem.adSourceId !== lead.adSourceId;
  const virouInbound = lead.leadOrigin !== "INBOUND";

  if (temAnterior && !mudouClid && !mudouAnuncio && !virouInbound) return "inalterada";

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      leadOrigin: "INBOUND",
      ...(origem.ctwaClid ? { ctwaClid: origem.ctwaClid } : {}),
      ...(origem.adSourceId ? { adSourceId: origem.adSourceId } : {}),
      ...(origem.adHeadline ? { adHeadline: origem.adHeadline } : {}),
      ...(origem.adSourceUrl ? { adSourceUrl: origem.adSourceUrl } : {}),
      adReferralAt: quando,
    },
  });
  if (conversationId) {
    await prisma.whatsappConversation.update({
      where: { id: conversationId },
      data: { leadOrigin: "INBOUND" },
    }).catch(() => {});
  }

  const descricao = temAnterior && mudouClid
    ? `Novo clique em anúncio (ctwa_clid atualizado)${origem.adHeadline ? ` — "${origem.adHeadline}"` : ""}${origem.adSourceId ? ` [anúncio ${origem.adSourceId}]` : ""}`
    : `Lead veio de anúncio Click-to-WhatsApp${origem.adHeadline ? ` — "${origem.adHeadline}"` : ""}${origem.adSourceId ? ` [anúncio ${origem.adSourceId}]` : ""}`;
  await prisma.leadActivity.create({
    data: { leadId, type: "NOTE", description: descricao, createdBy: "meta-referral" },
  }).catch(() => {});

  return temAnterior ? "atualizada" : "criada";
}
