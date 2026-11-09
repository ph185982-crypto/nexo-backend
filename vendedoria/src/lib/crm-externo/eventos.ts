// Emite eventos do Vendedor IA para o CRM Avanteza (contrato: crm/docs/integracao.md).
// Grava no outbox e tenta enviar na hora; se o CRM estiver fora do ar, o health e os
// próximos eventos reenviam. NUNCA lança: o atendimento não pode cair por causa do CRM.
import { prisma } from "@/lib/prisma/client";
import { despacharOutboxCrm } from "./outbox";
import { detectarIntencoes } from "./intencoes";
import { reabrirConversasDoLead } from "./conversas";

export type TipoEventoCrm = "lead.qualificado" | "lead.escalado" | "reuniao.agendada" | "lead.perdido" | "lead.ganho" | "intencao.detectada";

export function crmConfigurado(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.CRM_URL?.trim() && env.CRM_API_KEY?.trim());
}

/**
 * Evento que a entrada do lead numa etapa representa. `tipo` pode ser o tipo pedido ao
 * pipeline-mover (QUALIFICADO, LOST…) ou o tipo da coluna (arrasto manual). REUNIAO_AGENDADA
 * fica de fora de propósito: o SDR emite reuniao.agendada à parte, com o horário.
 */
export function tipoEventoDaEtapa(tipo: string): TipoEventoCrm | null {
  switch (tipo) {
    case "QUALIFICADO": case "PROPOSTA": case "PROPOSTA_NEGOCIACAO": return "lead.qualificado";
    case "ESCALATED": return "lead.escalado";
    case "LOST": case "DESCARTADO": case "JUNK": return "lead.perdido";
    case "GANHO": return "lead.ganho";
    default: return null;
  }
}

export interface EmitirEvento {
  tipo: TipoEventoCrm;
  leadId: string;
  motivo?: string | null;
  reuniaoEm?: string | null;
  intencao?: string | null;
  texto?: string | null;
  /** Dados do lead que valem mais que o banco (ex.: sessão do SDR, ainda não sincronizada). */
  dados?: Partial<Record<"nome" | "empresa" | "segmento" | "faturamentoMensal" | "dorPrincipal" | "scoreSdr", unknown>>;
  /** Chave de idempotência; sem ela, cada chamada é um evento novo. */
  chave?: string;
}

export async function emitirEventoCrm(e: EmitirEvento): Promise<"enfileirado" | "desligado" | "duplicado" | "erro"> {
  if (!crmConfigurado()) return "desligado";
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: e.leadId },
      select: { id: true, phoneNumber: true, profileName: true, email: true, empresa: true, segmento: true, faturamentoMensal: true, dorPrincipal: true, scoreSdr: true, leadOrigin: true, adSourceId: true, adHeadline: true },
    });
    if (!lead) return "erro";
    const so = <T,>(v: T | null | undefined) => (v === null || v === undefined || v === "" ? undefined : v);
    const dados = e.dados ?? {};
    const eventoId = e.chave ?? `${e.tipo}:${e.leadId}:${Date.now().toString(36)}`;
    const payload = {
      eventoId, tipo: e.tipo, ocorridoEm: new Date().toISOString(),
      ...(e.motivo ? { motivo: e.motivo } : {}), ...(e.reuniaoEm ? { reuniaoEm: e.reuniaoEm } : {}),
      ...(e.intencao ? { intencao: e.intencao } : {}), ...(e.texto ? { texto: e.texto.slice(0, 500) } : {}),
      lead: {
        id: lead.id, telefone: lead.phoneNumber,
        nome: so(dados.nome) ?? so(lead.profileName), email: so(lead.email),
        empresa: so(dados.empresa) ?? so(lead.empresa), segmento: so(dados.segmento) ?? so(lead.segmento),
        faturamentoMensal: so(dados.faturamentoMensal) ?? so(lead.faturamentoMensal), dorPrincipal: so(dados.dorPrincipal) ?? so(lead.dorPrincipal),
        scoreSdr: so(dados.scoreSdr) ?? so(lead.scoreSdr),
        origem: lead.adSourceId || lead.adHeadline ? "Click-to-WhatsApp" : lead.leadOrigin === "OUTBOUND" ? "Prospecção ativa" : "WhatsApp",
      },
    };
    try {
      await prisma.crmEventoOutbox.create({ data: { eventoId, tipo: e.tipo, leadId: e.leadId, payload } });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") return "duplicado";
      throw err;
    }
    void despacharOutboxCrm({ limite: 5 }).catch(() => {});
    await reabrirConversasDoLead(e.leadId); // o CRM vai conhecer o lead: a conversa passa a ser espelhada
    return "enfileirado";
  } catch (err) {
    console.error("[CRM-externo] Falha ao enfileirar evento:", err);
    return "erro";
  }
}

/** Intenções da mensagem do lead → eventos (no máximo um por lead, sinal e dia). */
export async function emitirIntencoesDaMensagem(leadId: string, mensagem: string): Promise<number> {
  if (!crmConfigurado()) return 0;
  const hoje = new Date().toISOString().slice(0, 10);
  let n = 0;
  for (const intencao of detectarIntencoes(mensagem)) {
    const r = await emitirEventoCrm({ tipo: "intencao.detectada", leadId, intencao, texto: mensagem, chave: `intencao.detectada:${leadId}:${intencao}:${hoje}` });
    if (r === "enfileirado") n++;
  }
  return n;
}
