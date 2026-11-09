// Espelha no CRM Avanteza as conversas do WhatsApp dos leads que o CRM conhece (contrato: crm/docs/integracao.md).
// Sem extensão e sem importação manual: o que entra e sai pelo número do Vendedor IA vai sozinho para a ficha.
//
// Primeira vez de uma conversa: pergunta ao CRM se conhece o lead (envio sem mensagens). Se não conhece,
// a conversa fica IGNORADA e nada do conteúdo sai daqui — até o lead virar evento do CRM (eventos.ts reabre).
// NUNCA lança: o atendimento não pode cair por causa do CRM.
import { prisma } from "@/lib/prisma/client";
import { crmConfigurado } from "./eventos";

const JANELA_MS = 2 * 86_400_000; // conversas com mensagem do cliente nos últimos 2 dias
const HISTORICO_INICIAL_MS = 30 * 86_400_000; // na primeira vez, até 30 dias de histórico
const MAX_MENSAGENS = 500;
const TIMEOUT_MS = 8_000;

type Resposta = { status: "PROCESSADO" | "CONHECIDO" | "IGNORADO" };

async function postar(corpo: unknown): Promise<Resposta | null> {
  const base = process.env.CRM_URL?.trim().replace(/\/+$/, "");
  const chave = process.env.CRM_API_KEY?.trim();
  if (!base || !chave) return null;
  try {
    const r = await fetch(`${base}/api/integracoes/vendedor-ia/conversas`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${chave}` },
      body: JSON.stringify(corpo), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) return null;
    return (await r.json()) as Resposta;
  } catch {
    return null;
  }
}

/** Texto que o CRM grava: mídia sem legenda vira um rótulo legível. */
function textoDaMensagem(m: { content: string; type: string; caption: string | null }): string {
  const t = m.content?.trim();
  if (t) return m.caption && !t.includes(m.caption) ? `${t} "${m.caption}"` : t;
  const rotulo: Record<string, string> = { IMAGE: "[Imagem]", AUDIO: "[Áudio]", VIDEO: "[Vídeo]", DOCUMENT: "[Documento]" };
  return m.caption ? `${rotulo[m.type] ?? "[Mídia]"} "${m.caption}"` : rotulo[m.type] ?? "[Mídia]";
}

/** Sincroniza uma conversa. Devolve o que aconteceu (para teste e log). */
export async function sincronizarConversaCrm(conversaId: string, agora = new Date()): Promise<"enviada" | "nada" | "ignorada" | "falhou" | "desligado"> {
  if (!crmConfigurado()) return "desligado";
  try {
    const c = await prisma.whatsappConversation.findUnique({
      where: { id: conversaId },
      select: { id: true, crmStatus: true, crmSincronizadoAte: true, profileName: true, lead: { select: { id: true, phoneNumber: true, profileName: true } } },
    });
    if (!c || c.crmStatus === "IGNORADO") return "ignorada";
    const lead = { leadId: c.lead.id, telefone: c.lead.phoneNumber, nome: c.lead.profileName ?? c.profileName ?? null };

    if (c.crmStatus !== "ATIVO") {
      const r = await postar({ ...lead, mensagens: [] });
      if (!r) return "falhou";
      if (r.status === "IGNORADO") {
        await prisma.whatsappConversation.update({ where: { id: c.id }, data: { crmStatus: "IGNORADO" } });
        return "ignorada";
      }
      await prisma.whatsappConversation.update({ where: { id: c.id }, data: { crmStatus: "ATIVO" } });
    }

    const desde = c.crmSincronizadoAte ?? new Date(agora.getTime() - HISTORICO_INICIAL_MS);
    const msgs = await prisma.whatsappMessage.findMany({
      where: { conversationId: c.id, sentAt: { gt: desde } }, orderBy: { sentAt: "asc" }, take: MAX_MENSAGENS,
      select: { id: true, content: true, type: true, caption: true, role: true, sentAt: true },
    });
    if (!msgs.length) return "nada";
    const r = await postar({
      ...lead,
      mensagens: msgs.map((m) => ({ id: m.id, deMim: m.role !== "USER", autor: m.role === "USER" ? lead.nome ?? "Cliente" : "Vendedor IA", texto: textoDaMensagem(m).slice(0, 10_000), em: m.sentAt.toISOString() })),
    });
    if (!r) return "falhou";
    if (r.status === "IGNORADO") {
      await prisma.whatsappConversation.update({ where: { id: c.id }, data: { crmStatus: "IGNORADO" } });
      return "ignorada";
    }
    await prisma.whatsappConversation.update({ where: { id: c.id }, data: { crmSincronizadoAte: msgs[msgs.length - 1].sentAt } });
    return "enviada";
  } catch (e) {
    console.error("[CRM-externo] Falha ao sincronizar conversa:", e);
    return "falhou";
  }
}

/** Rodada: conversas recentes ainda não ignoradas. Chamada pelo webhook (depois da resposta) e pelo health. */
export async function sincronizarConversasCrm(o: { limite?: number; orcamentoMs?: number; agora?: Date } = {}) {
  const res = { enviadas: 0, ignoradas: 0, falhas: 0 };
  if (!crmConfigurado()) return res;
  const agora = o.agora ?? new Date();
  const inicio = Date.now();
  const conversas = await prisma.whatsappConversation.findMany({
    where: { lastMessageAt: { gte: new Date(agora.getTime() - JANELA_MS) }, OR: [{ crmStatus: null }, { crmStatus: "ATIVO" }] },
    orderBy: { lastMessageAt: "desc" }, take: o.limite ?? 10, select: { id: true },
  }).catch(() => []);
  for (const c of conversas) {
    if (o.orcamentoMs !== undefined && Date.now() - inicio >= o.orcamentoMs) break;
    const r = await sincronizarConversaCrm(c.id, agora);
    if (r === "enviada") res.enviadas++;
    else if (r === "ignorada") res.ignoradas++;
    else if (r === "falhou") { res.falhas++; break; } // CRM fora do ar: tenta na próxima rodada
  }
  return res;
}

/** O lead virou evento do CRM: as conversas dele voltam a ser perguntadas. */
export async function reabrirConversasDoLead(leadId: string) {
  await prisma.whatsappConversation.updateMany({ where: { leadId, crmStatus: "IGNORADO" }, data: { crmStatus: null } }).catch(() => {});
}
