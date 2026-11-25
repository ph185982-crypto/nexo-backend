// Lembretes 1 h antes da ligação marcada pela Júlia: para o lead ("o Pedro te liga hoje às …") e para o Pedro (nome,
// empresa, faixa, link da conversa). Roda no cron de 10 em 10 min (/api/cron/lembretes) e na rotina horária.
// Cada lembrete sai uma vez (marca em max_alertas_enviados). Janela de 24 h do lead fechada: template
// LEMBRETE_TEMPLATE_NAME (parâmetros: nome, hora) se existir; sem template, não manda (e o Pedro é avisado).
import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "@/lib/whatsapp/send";
import { dentroDaJanela } from "@/lib/followup/janela";
import { horaBRT } from "@/lib/agenda/slots";
import { loadSdrSession } from "../session";
import { ROTULO_FAIXA } from "./icp";
import { primeiroNome } from "./motor";
import { textoLembreteLead } from "./roteiro";

const BASE_CRM = () => (process.env.CRM_PUBLIC_URL || "https://nexo-vendedoria.vercel.app").replace(/\/$/, "");

async function marcar(chave: string): Promise<boolean> {
  try { await prisma.alertaEnviadoMax.create({ data: { chave } }); return true; } catch { return false; }
}

export async function enviarLembretesLigacao(agora: Date = new Date()): Promise<{ lead: number; pedro: number }> {
  const eventos = await prisma.calendarEvent.findMany({
    where: { status: "SCHEDULED", leadId: { not: null }, title: { startsWith: "Ligação Avanteza" }, startTime: { gt: agora, lte: new Date(agora.getTime() + 65 * 60_000) } },
    select: { id: true, startTime: true, leadId: true, lead: { select: { id: true, phoneNumber: true, profileName: true, empresa: true } } },
    take: 20,
  });
  let nLead = 0, nPedro = 0;
  for (const e of eventos) {
    if (!e.lead) continue;
    const conv = await prisma.whatsappConversation.findFirst({
      where: { leadId: e.lead.id }, orderBy: { lastMessageAt: "desc" },
      select: { id: true, provider: { select: { businessPhoneNumberId: true, accessToken: true } } },
    });
    if (!conv?.provider) continue;
    const s = await loadSdrSession(conv.id).catch(() => null);
    const nome = s ? primeiroNome(s, e.lead.profileName) : null;
    const hora = horaBRT(e.startTime);
    const token = conv.provider.accessToken ?? undefined;

    if (await marcar(`lembrete-lead:${e.id}`)) {
      const ultima = await prisma.whatsappMessage.findFirst({ where: { conversationId: conv.id, role: "USER" }, orderBy: { sentAt: "desc" }, select: { sentAt: true } });
      const texto = textoLembreteLead(nome, hora);
      try {
        if (dentroDaJanela(ultima?.sentAt ?? null, agora)) {
          const wamid = await sendWhatsAppMessage(conv.provider.businessPhoneNumberId, e.lead.phoneNumber, texto, token);
          await prisma.whatsappMessage.create({ data: { wamid, content: texto, type: "TEXT", role: "ASSISTANT", sentAt: agora, status: "SENT", conversationId: conv.id } }).catch(() => {});
          nLead++;
        } else if (process.env.LEMBRETE_TEMPLATE_NAME?.trim()) {
          const params = [{ type: "text", text: nome ?? "tudo bem" }, { type: "text", text: hora }];
          const wamid = await sendWhatsAppTemplate(conv.provider.businessPhoneNumberId, e.lead.phoneNumber, process.env.LEMBRETE_TEMPLATE_NAME.trim(), process.env.LEMBRETE_TEMPLATE_LANG?.trim() || "pt_BR", [{ type: "body", parameters: params }], token);
          await prisma.whatsappMessage.create({ data: { wamid, content: `📤 Lembrete da ligação (template) — ${texto}`, type: "TEXT", role: "ASSISTANT", sentAt: agora, status: "SENT", conversationId: conv.id } }).catch(() => {});
          nLead++;
        } else {
          console.warn(`[Júlia] Lembrete do lead não saiu: janela de 24 h fechada e sem LEMBRETE_TEMPLATE_NAME | lead=${e.lead.id}`);
        }
      } catch (err) {
        console.error("[Júlia] Lembrete do lead falhou:", err instanceof Error ? err.message : err);
      }
    }

    if (await marcar(`lembrete-pedro:${e.id}`)) {
      const faixa = s?.faixa_faturamento !== undefined ? ROTULO_FAIXA[s.faixa_faturamento] : "faixa não informada";
      const texto = `⏰ Daqui a 1 h (${hora}): ligação com ${(s?.nome || e.lead.profileName || "lead").trim()} – ${e.lead.empresa || s?.empresa || "empresa não informada"} (${faixa})\nWhatsApp: +${e.lead.phoneNumber}\nConversa: ${BASE_CRM()}/crm/conversations?id=${conv.id}`;
      const { entregarAvisoAoDono } = await import("@/lib/whatsapp/aviso-dono");
      await entregarAvisoAoDono(null, texto, conv.provider.businessPhoneNumberId, token).catch(() => null);
      const { sendPushToAll } = await import("@/lib/push/notificar");
      await sendPushToAll({ title: `⏰ Ligação às ${hora}`, body: texto.split("\n")[0].slice(0, 180), url: `/crm/conversations?id=${conv.id}`, tag: `lembrete-${e.id}` }).catch(() => {});
      nPedro++;
    }
  }
  return { lead: nLead, pedro: nPedro };
}
