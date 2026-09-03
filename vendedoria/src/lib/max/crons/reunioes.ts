// Lembrete pré-reunião: 1h antes, envia WhatsApp ao lead com o horário e o link do Meet.
// Roda a cada minuto via /api/cron/max; dedup por evento em AlertaEnviadoMax.

import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { resolveToken } from "../config";

export async function lembrarReunioes(): Promise<number> {
  const agora = new Date();
  const em55min = new Date(agora.getTime() + 55 * 60_000);
  const em65min = new Date(agora.getTime() + 65 * 60_000);

  const eventos = await prisma.calendarEvent.findMany({
    where: {
      status: "SCHEDULED",
      leadId: { not: null },
      startTime: { gte: em55min, lte: em65min },
    },
    include: { lead: { select: { phoneNumber: true, profileName: true, organizationId: true } } },
  });

  let enviados = 0;

  for (const ev of eventos) {
    if (!ev.lead?.phoneNumber) continue;

    // Dedup: 1 lembrete por evento
    try {
      await prisma.alertaEnviadoMax.create({ data: { chave: `pre-reuniao-${ev.id}` } });
    } catch {
      continue; // já lembrado
    }

    const provider = await prisma.whatsappProviderConfig.findFirst({
      where: { organizationId: ev.lead.organizationId },
    });
    if (!provider) continue;

    const horaLocal = ev.startTime.toLocaleTimeString("pt-BR", {
      timeZone: ev.timezone || "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    });

    const nome = ev.lead.profileName?.split(" ")[0];
    const texto = [
      `Oi${nome ? ` ${nome}` : ""}! Passando pra lembrar da nossa reunião daqui a pouco, às ${horaLocal}.`,
      ev.googleMeetLink ? `Link da chamada: ${ev.googleMeetLink}` : null,
      `Qualquer imprevisto, me avisa por aqui que a gente reagenda. Até já!`,
    ].filter(Boolean).join("\n\n");

    try {
      await sendWhatsAppMessage(
        provider.businessPhoneNumberId,
        ev.lead.phoneNumber,
        texto,
        resolveToken(provider.accessToken),
      );
      enviados++;
      console.log(`[Reuniões] Lembrete enviado | evento=${ev.id} | lead=${ev.leadId}`);
    } catch (e) {
      console.error(`[Reuniões] Falha no lembrete | evento=${ev.id}:`, e);
    }
  }

  return enviados;
}
