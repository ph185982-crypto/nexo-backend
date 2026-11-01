// Recuperação das conversas em que a IA falhou e o cliente ficou só com a
// mensagem de espera ("tive um probleminha… já já te respondo"). Em 30/10, com
// os créditos da OpenAI esgotados, 7 leads (4 vindos do anúncio) ficaram assim
// para sempre: a mensagem prometia resposta e ninguém respondia.
//
// Para cada conversa parada na mensagem de espera:
//  • janela de 24h da Meta aberta e ainda sem nova tentativa → a IA tenta de
//    novo responder a última mensagem do cliente (no máximo 1 vez: se falhar,
//    outra mensagem de espera é gravada e a conversa cai no caso abaixo);
//  • janela fechada ou já tentou → aviso "📞 A IA não respondeu" para o dono,
//    que aparece na tela Ligações com o link do WhatsApp (uma vez por conversa).
// Conversa assumida por humano ou lead já escalado fica de fora.

import { after } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { MENSAGEM_FALHA_SDR } from "./fallback";

const JANELA_RESPOSTA_MS = 23 * 3_600_000; // margem antes das 24h da Meta
const ESPERA_ANTES_DE_TENTAR_MS = 5 * 60_000;
export const TITULO_AVISO = "📞 A IA não respondeu";

export interface ResultadoRecuperacao {
  analisadas: number;
  reprocessadas: string[];
  avisadas: string[];
}

export async function recuperarFalhasSdr(opts: {
  agora?: Date;
  dias?: number;
  maxReprocessar?: number;
  /** Injetável nos testes; por padrão chama o SDR de verdade. */
  reprocessar?: (conversationId: string, texto: string, agent: { id: string; aiProvider?: string | null; aiModel?: string | null; sandboxMode?: boolean }, mensagemId: string) => Promise<void>;
} = {}): Promise<ResultadoRecuperacao> {
  const agora = opts.agora ?? new Date();
  const desde = new Date(agora.getTime() - (opts.dias ?? 7) * 86_400_000);
  const maxReprocessar = opts.maxReprocessar ?? 1;
  const out: ResultadoRecuperacao = { analisadas: 0, reprocessadas: [], avisadas: [] };

  const falhas = await prisma.whatsappMessage.findMany({
    where: { role: "ASSISTANT", content: MENSAGEM_FALHA_SDR, sentAt: { gte: desde } },
    select: { conversationId: true },
    distinct: ["conversationId"],
  });

  for (const { conversationId } of falhas) {
    const conv = await prisma.whatsappConversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true, humanTakeover: true,
        lead: { select: { id: true, status: true, profileName: true, phoneNumber: true, organizationId: true } },
        provider: { select: { agent: { select: { id: true, kind: true, status: true, systemPrompt: true, aiProvider: true, aiModel: true, sandboxMode: true } } } },
      },
    });
    if (!conv?.lead || conv.humanTakeover || conv.lead.status === "ESCALATED" || conv.lead.status === "BLOCKED") continue;

    const [ultimaIa, ultimaCliente] = await Promise.all([
      prisma.whatsappMessage.findFirst({ where: { conversationId, role: "ASSISTANT" }, orderBy: { sentAt: "desc" }, select: { content: true, sentAt: true } }),
      prisma.whatsappMessage.findFirst({ where: { conversationId, role: "USER" }, orderBy: { sentAt: "desc" }, select: { id: true, content: true, sentAt: true } }),
    ]);
    // Já houve resposta de verdade depois da falha (IA ou pessoa): nada a fazer.
    if (!ultimaIa || ultimaIa.content !== MENSAGEM_FALHA_SDR || !ultimaCliente) continue;
    out.analisadas++;

    const esperas = await prisma.whatsappMessage.count({
      where: { conversationId, role: "ASSISTANT", content: MENSAGEM_FALHA_SDR, sentAt: { gte: ultimaCliente.sentAt } },
    });
    const janelaAberta = agora.getTime() - ultimaCliente.sentAt.getTime() < JANELA_RESPOSTA_MS;
    const agent = conv.provider?.agent;
    const sdrAtivo = agent?.kind === "AI" && agent.status === "ACTIVE" && Boolean(agent.systemPrompt?.trimStart().startsWith("[SDR]"));
    const podeTentar = janelaAberta && sdrAtivo && esperas < 2 && agora.getTime() - ultimaIa.sentAt.getTime() >= ESPERA_ANTES_DE_TENTAR_MS;

    if (podeTentar && out.reprocessadas.length < maxReprocessar) {
      const reprocessar = opts.reprocessar ?? (await import("./agent")).processSdrResponse;
      try {
        await reprocessar(conversationId, ultimaCliente.content, agent!, ultimaCliente.id);
        out.reprocessadas.push(conversationId);
      } catch (e) {
        console.error(`[SDR] Nova tentativa falhou | conv=${conversationId}:`, e);
      }
      continue;
    }
    if (podeTentar) continue; // fica para a próxima rodada

    // Janela fechada ou já tentou: avisa o dono uma vez por mensagem do cliente.
    const jaAvisado = await prisma.ownerNotification.count({
      where: { conversationId, title: { startsWith: TITULO_AVISO }, createdAt: { gte: ultimaCliente.sentAt } },
    });
    if (jaAvisado > 0) continue;
    const nome = conv.lead.profileName?.trim() || conv.lead.phoneNumber;
    await prisma.ownerNotification.create({
      data: {
        type: "ESCALATION",
        title: `${TITULO_AVISO} — fale com ${nome}`,
        body:
          `A IA falhou ao responder e o cliente ficou só com a mensagem de espera.\n` +
          `Última mensagem dele (${ultimaCliente.sentAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}): "${ultimaCliente.content.slice(0, 300)}"\n` +
          (janelaAberta ? "A nova tentativa automática também falhou." : "Passou a janela de 24h do WhatsApp: a IA não pode mais escrever — responda pelo seu WhatsApp."),
        organizationId: conv.lead.organizationId,
        leadId: conv.lead.id,
        conversationId,
      },
    });
    out.avisadas.push(conversationId);
  }
  return out;
}

// ─── Gatilho oportunista (mesmo modelo do follow-up: health de hora em hora e telas do CRM) ──
const INTERVALO_RECUPERACAO_MS = 10 * 60_000;
let ultimaRecuperacao = 0;

export function acionarRecuperacaoSePreciso(origem: string, opts: { forcar?: boolean } = {}): "acionado" | "throttle" {
  const agora = Date.now();
  if (!opts.forcar && agora - ultimaRecuperacao < INTERVALO_RECUPERACAO_MS) return "throttle";
  ultimaRecuperacao = agora;
  const trabalho = async () => {
    try {
      const r = await recuperarFalhasSdr();
      if (r.reprocessadas.length || r.avisadas.length) {
        console.log(`[SDR] Recuperação de falhas | origem=${origem} reprocessadas=${r.reprocessadas.length} avisadas=${r.avisadas.length}`);
      }
    } catch (e) {
      console.error(`[SDR] Recuperação de falhas | origem=${origem} falhou:`, e);
    }
  };
  try {
    after(trabalho); // fora do caminho da resposta
  } catch {
    void trabalho(); // sem escopo de requisição (scripts)
  }
  return "acionado";
}

/** Só para testes: zera o throttle. */
export function _resetRecuperacao(): void { ultimaRecuperacao = 0; }
