// Follow-up do roteiro da Júlia: 1º toque no dia seguinte e 2º no 3º dia (encerra e vai para "Perdido", motivo "Sem
// resposta"). Nada para Fora/Morno/passado ao Pedro. A retomada única da resposta automática também sai por aqui.
import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "@/lib/whatsapp/send";
import { planejarEnvio } from "@/lib/followup/janela";
import { dataDoToque } from "@/lib/followup/cadencia";
import { buscarSlotsLigacao } from "@/lib/agenda/reuniao";
import { moverLeadPorTipo } from "@/lib/crm/pipeline-mover";
import { MOTIVO } from "@/lib/crm/motivos";
import type { SDRSession } from "../types";
import { saveSdrSession } from "../session";
import { classificar } from "./icp";
import { planoFollowup, primeiroNome } from "./motor";

export interface ItemFollowup {
  id: string; conversationId: string; step: number; leadName: string | null; phoneNumber: string; phoneNumberId: string; accessToken: string | null; aiMessageAt: Date;
}

export async function followupJulia(fu: ItemFollowup, sessao: SDRSession, ultimaDoCliente: Date | null, token: string | undefined, agora: Date = new Date()): Promise<"enviado" | "encerrado"> {
  const conv = await prisma.whatsappConversation.findUnique({
    where: { id: fu.conversationId },
    select: { leadId: true, lead: { select: { profileName: true } }, provider: { select: { organizationId: true } } },
  });
  if (!conv) {
    await prisma.conversationFollowUp.update({ where: { id: fu.id }, data: { status: "DONE" } }).catch(() => {});
    return "encerrado";
  }
  const slots = classificar(sessao) === "QUALIFICADO" && fu.step <= 1 && !sessao.auto_resposta
    ? await buscarSlotsLigacao(conv.provider.organizationId, 2, agora).catch(() => []) : [];
  const plano = planoFollowup(sessao, fu.step, slots, conv.lead?.profileName ?? fu.leadName);
  if (plano.acao === "pular") {
    await prisma.conversationFollowUp.update({ where: { id: fu.id }, data: { status: "DONE" } }).catch(() => {});
    return "encerrado";
  }

  // Janela de 24 h: texto livre dentro dela; fora, template aprovado (se houver); sem canal, não manda.
  const envio = planejarEnvio(ultimaDoCliente, agora);
  let enviou = false;
  try {
    if (envio.modo === "texto" && plano.texto) {
      const wamid = await sendWhatsAppMessage(fu.phoneNumberId, fu.phoneNumber, plano.texto, token);
      await prisma.whatsappMessage.create({ data: { content: plano.texto, type: "TEXT", role: "ASSISTANT", sentAt: agora, status: "SENT", conversationId: fu.conversationId, ...(wamid ? { wamid } : {}) } });
      enviou = true;
    } else if (envio.modo === "template" && !plano.perdido) {
      const nome = primeiroNome(sessao, conv.lead?.profileName ?? fu.leadName) ?? "tudo bem";
      const components = envio.template.comNome ? [{ type: "body", parameters: [{ type: "text", text: nome }] }] : [];
      const wamid = await sendWhatsAppTemplate(fu.phoneNumberId, fu.phoneNumber, envio.template.nome, envio.template.idioma, components, token);
      await prisma.whatsappMessage.create({ data: { content: `📤 Follow-up ${fu.step} (template "${envio.template.nome}")`, type: "TEXT", role: "ASSISTANT", sentAt: agora, status: "SENT", conversationId: fu.conversationId, ...(wamid ? { wamid } : {}) } });
      enviou = true;
    }
  } catch (e) {
    console.error(`[Júlia] Follow-up ${fu.step} não saiu | conv=${fu.conversationId}:`, e instanceof Error ? e.message : e);
  }

  await saveSdrSession(fu.conversationId, plano.sessao).catch(() => {});
  if (plano.perdido && conv.leadId) {
    await moverLeadPorTipo(conv.leadId, conv.provider.organizationId, "LOST", "Sem resposta depois dos 2 follow-ups", undefined,
      { motivoEncerramento: MOTIVO.SEM_RESPOSTA, ator: "AI_AGENT", origem: "IA" });
  }
  if (plano.encerrar) {
    await prisma.conversationFollowUp.update({ where: { id: fu.id }, data: { status: "DONE", step: fu.step + 1 } });
  } else {
    // 2º toque no 3º dia (72 h da última mensagem da Júlia). Fora da janela: template ou só "Perdido".
    await prisma.conversationFollowUp.update({ where: { id: fu.id }, data: { step: fu.step + 1, nextSendAt: dataDoToque(fu.step + 1, fu.aiMessageAt, agora) } });
  }
  console.log(`[Júlia] Follow-up ${fu.step} ${enviou ? "enviado" : "sem canal"}${plano.perdido ? " → Perdido" : ""} | conv=${fu.conversationId}`);
  return enviou ? "enviado" : "encerrado";
}
