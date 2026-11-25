// Efeitos do roteiro da Júlia no banco/WhatsApp: passagem para o Pedro (ligação marcada), aviso ao Pedro no formato
// novo, pós-passagem (foto uma vez, troca de horário), tag "Prioridade" e agendamento do follow-up.
import { aplicarPersona, carregarPersona } from "./persona";
import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage, sendWhatsAppVideo } from "@/lib/whatsapp/send";
import { moverLeadPorTipo } from "@/lib/crm/pipeline-mover";
import { cancelFollowUpJobs } from "@/lib/queue/followup-queue";
import { emitirEventoCrm } from "@/lib/crm-externo/eventos";
import { buscarSlotsLigacao, marcarReuniao, remarcarLigacao, slotLivre } from "@/lib/agenda/reuniao";
import { rotuloSlot } from "@/lib/agenda/slots";
import { dataDoToque } from "@/lib/followup/cadencia";
import { proximoEnvio } from "@/lib/followup/janela";
import type { SDRSession } from "../types";
import { saveSdrSession } from "../session";
import { dadosParaEventoCrm, sincronizarQualificacaoNoLead } from "../sincronizar-crm";
import { ROTULO_FAIXA, ehPrioridade } from "./icp";
import { primeiroNome, turnoPosPassagem } from "./motor";
import { textosConfirmacao, textosHorarioOcupado, textosSemHorario } from "./roteiro";

export interface Provedor { businessPhoneNumberId: string; accessToken: string | null; organizationId: string }
export interface LeadRef { id: string; phoneNumber: string; profileName: string | null }

/** Vídeo de depoimentos (enviado pelo dono em 25/11; arquivo em public/midia). VIDEO_DEPOIMENTOS_URL na Vercel troca;
 * VIDEO_DEPOIMENTOS_URL=desligado deixa a confirmação sem vídeo. */
export const VIDEO_DEPOIMENTOS_PADRAO = "https://nexo-vendedoria.vercel.app/midia/depoimentos-avanteza.mp4";
export const videoDepoimentos = (): string | null => {
  const v = process.env.VIDEO_DEPOIMENTOS_URL?.trim();
  if (v?.toLowerCase() === "desligado") return null;
  return v || VIDEO_DEPOIMENTOS_PADRAO;
};

/** Manda os balões e grava cada um na conversa. Falha num balão não derruba os outros. */
export async function enviarBaloes(conversationId: string, p: Provedor, para: string, textos: string[], citar?: string, sandbox = false): Promise<void> {
  if (sandbox) return;
  const persona = await carregarPersona();
  textos = textos.map((t) => aplicarPersona(t, persona));
  for (let i = 0; i < textos.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1200));
    try {
      const wamid = await sendWhatsAppMessage(p.businessPhoneNumberId, para, textos[i], p.accessToken ?? undefined, i === 0 ? citar : undefined);
      await prisma.whatsappMessage.create({ data: { wamid, content: textos[i], type: "TEXT", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId } }).catch(() => {});
    } catch (e) {
      console.error("[Júlia] Falha ao enviar balão:", e instanceof Error ? e.message : e);
    }
  }
}

/** Aviso ao Pedro, no formato pedido pelo dono (24/11). */
export function formatarAvisoPedro(lead: LeadRef & { adHeadline?: string | null; adSourceId?: string | null }, s: SDRSession, rotuloHorario: string | null): string {
  const nome = (s.nome || lead.profileName || "sem nome").trim();
  const faixa = s.faixa_faturamento !== undefined ? ROTULO_FAIXA[s.faixa_faturamento] : "não informado";
  const marketplace = s.marketplace_atual?.length ? s.marketplace_atual.join(", ") : "não";
  const frase = (s.frase_chave || s.problema_principal || "").trim();
  return [
    `🔥 Qualificado: ${nome} – ${s.empresa?.trim() || "empresa não informada"} (${s.segmento?.trim() || "segmento não informado"})`,
    `Faturamento: ${faixa} | CNPJ: sim | Loja/estoque: ${s.tipo_estoque || "sim"}`,
    `Marketplace hoje: ${marketplace}`,
    `Frase dele: "${frase || "—"}"`,
    `Ligação: ${rotuloHorario ?? "a combinar (agenda cheia)"} | Anúncio: ${lead.adHeadline?.trim() || lead.adSourceId || "—"}`,
    `WhatsApp: +${lead.phoneNumber}`,
  ].join("\n");
}

async function notificar(texto: string, p: Provedor, leadId: string, conversationId: string): Promise<void> {
  const { notificarHandoff } = await import("../agent");
  await notificarHandoff(texto, p.businessPhoneNumberId, p.accessToken ?? undefined, p.organizationId, leadId, conversationId);
}

/** Tag "Prioridade" no lead (faturamento ≥ 50 mil). */
export async function marcarPrioridade(leadId: string, organizationId: string): Promise<void> {
  let tag = await prisma.tag.findFirst({ where: { name: "Prioridade", OR: [{ organizationId }, { organizationId: null }] } });
  tag ??= await prisma.tag.create({ data: { name: "Prioridade", color: "#FF6A1F", kind: "HOT", organizationId } });
  await prisma.leadTag.upsert({ where: { leadId_tagId: { leadId, tagId: tag.id } }, create: { leadId, tagId: tag.id }, update: {} });
}

/** Follow-up do roteiro: 1º toque no dia seguinte (dentro da janela de 24 h). `ate` força o horário (resposta automática). */
export async function agendarFollowup(conversationId: string, p: Provedor, lead: LeadRef, agora: Date, ate?: Date): Promise<void> {
  const nextSendAt = ate ?? proximoEnvio(dataDoToque(1, agora, agora), agora, agora) ?? dataDoToque(1, agora, agora);
  await prisma.conversationFollowUp.upsert({
    where: { conversationId },
    update: { step: 1, status: "ACTIVE", aiMessageAt: agora, nextSendAt, leadName: lead.profileName ?? null },
    create: { conversationId, step: 1, status: "ACTIVE", aiMessageAt: agora, nextSendAt, leadName: lead.profileName ?? null, phoneNumber: lead.phoneNumber, phoneNumberId: p.businessPhoneNumberId, accessToken: p.accessToken ?? undefined },
  });
}

export async function encerrarFollowups(conversationId: string): Promise<void> {
  await prisma.conversationFollowUp.updateMany({ where: { conversationId, status: "ACTIVE" }, data: { status: "DONE" } }).catch(() => {});
  await cancelFollowUpJobs(conversationId).catch(() => {});
}

/**
 * Passagem para o Pedro: marca a ligação (CalendarEvent "Ligação Avanteza – [nome]"), confirma ao lead com os 3 produtos e
 * o vídeo, liga humanTakeover SEMPRE, move para "Ligação marcada" e avisa o Pedro. Devolve a sessão final, ou null se o
 * horário acabou de ser ocupado (aí já reofereceu outros horários ao lead).
 */
export async function efetivarPassagem(a: {
  conversationId: string; sessao: SDRSession; slotIso: string | null; lead: LeadRef; provedor: Provedor; citar?: string; sandbox?: boolean; agora?: Date;
}): Promise<SDRSession | null> {
  const { conversationId, lead, provedor: p } = a;
  const agora = a.agora ?? new Date();
  let s = { ...a.sessao };
  const nome = primeiroNome(s, lead.profileName);
  const inicio = a.slotIso ? new Date(a.slotIso) : null;

  // Outro lead pegou o horário entre a oferta e a escolha: reoferece.
  if (inicio && !(await slotLivre(p.organizationId, inicio))) {
    const novos = await buscarSlotsLigacao(p.organizationId, 2, agora).catch(() => []);
    if (novos.length) {
      await enviarBaloes(conversationId, p, lead.phoneNumber, textosHorarioOcupado(novos[0].label, novos[1]?.label ?? null), a.citar, a.sandbox);
      s = { ...s, slots_oferecidos: novos.map((x) => x.iso), ultima_pergunta: "horario", horario_reuniao: undefined };
      await saveSdrSession(conversationId, s).catch(() => {});
      return null;
    }
  }

  // Reivindica a passagem (só uma execução leva) e tira a IA da conversa ANTES de qualquer envio.
  const claim = await prisma.lead.updateMany({ where: { id: lead.id, status: { notIn: ["ESCALATED", "BLOCKED"] } }, data: { status: "ESCALATED", lastActivityAt: agora } }).catch(() => ({ count: 0 }));
  if (claim.count === 0) return s;
  await prisma.whatsappConversation.update({ where: { id: conversationId }, data: { humanTakeover: true, aiLockUntil: null } }).catch((e) => console.error("[Júlia] Falha ao ligar humanTakeover:", e));

  let rotulo: string | null = null;
  if (inicio) {
    try {
      const r = await marcarReuniao({
        organizationId: p.organizationId, leadId: lead.id, inicio, nome: (s.nome || lead.profileName || lead.phoneNumber).trim(),
        empresa: s.empresa, telefone: lead.phoneNumber, resumo: formatarAvisoPedro(lead, s, rotuloSlot(inicio, agora)), ligacao: true,
      });
      s.reuniao_evento_id = r.eventoId;
      rotulo = rotuloSlot(inicio, agora);
      await prisma.lead.update({ where: { id: lead.id }, data: { reuniaoEm: inicio } }).catch(() => {});
    } catch (e) {
      console.error("[Júlia] Falha ao marcar a ligação:", e);
    }
  }
  s = { ...s, status: "handoff_enviado", etapa: "ligacao_marcada", horario_reuniao: inicio?.toISOString(), ultima_pergunta: undefined };
  await saveSdrSession(conversationId, s).catch(() => {});

  // Lead: confirmação + 3 produtos + vídeo (ou, sem horário, o Pedro combina direto).
  const video = videoDepoimentos();
  if (rotulo) {
    await enviarBaloes(conversationId, p, lead.phoneNumber, textosConfirmacao(rotulo, Boolean(video)), a.citar, a.sandbox);
    if (video && !a.sandbox) {
      await sendWhatsAppVideo(p.businessPhoneNumberId, lead.phoneNumber, video, undefined, p.accessToken ?? undefined).catch((e) => console.error("[Júlia] Vídeo de depoimentos não saiu:", e));
      await prisma.whatsappMessage.create({ data: { content: "[Vídeo de depoimentos]", type: "VIDEO", role: "ASSISTANT", sentAt: new Date(), status: "SENT", conversationId, mediaUrl: video } }).catch(() => {});
    }
  } else {
    await enviarBaloes(conversationId, p, lead.phoneNumber, textosSemHorario(nome), a.citar, a.sandbox);
  }

  // CRM: "Ligação marcada", compromisso, atividade; follow-ups param.
  await moverLeadPorTipo(lead.id, p.organizationId, "ESCALATED", rotulo ? `Ligação marcada pela Júlia: ${rotulo}` : "Qualificado — Pedro combina o horário", "QUALIFICADO", { dadosCrm: dadosParaEventoCrm(s) });
  if (inicio && rotulo) await emitirEventoCrm({ tipo: "reuniao.agendada", leadId: lead.id, reuniaoEm: inicio.toISOString(), dados: dadosParaEventoCrm(s) });
  await prisma.leadActivity.create({ data: { leadId: lead.id, type: "STATUS_CHANGE", description: rotulo ? `Ligação marcada com o Pedro: ${rotulo}` : "Qualificado e passado ao Pedro (sem horário livre)", createdBy: "AI_AGENT" } }).catch(() => {});
  await encerrarFollowups(conversationId);
  await sincronizarQualificacaoNoLead(lead.id, s).catch(() => {});
  if (ehPrioridade(s)) await marcarPrioridade(lead.id, p.organizationId).catch(() => {});

  // Pedro: aviso no formato novo (WhatsApp com a janela aberta; senão fica pendente + push + CRM).
  if (!a.sandbox) {
    const l = await prisma.lead.findUnique({ where: { id: lead.id }, select: { adHeadline: true, adSourceId: true } }).catch(() => null);
    await notificar(formatarAvisoPedro({ ...lead, ...(l ?? {}) }, s, rotulo), p, lead.id, conversationId);
  }
  console.log(`[Júlia] Passagem feita | lead=${lead.id} | ligação=${rotulo ?? "a combinar"}`);
  return s;
}

/**
 * Depois da passagem: só responde foto (uma vez) e troca de horário. Devolve true se tratou a mensagem (sempre true:
 * fora as 2 exceções, a Júlia fica em silêncio).
 */
export async function tratarPosPassagem(a: {
  conversationId: string; sessao: SDRSession; mensagem: string; lead: LeadRef; provedor: Provedor; citar?: string; sandbox?: boolean;
}): Promise<void> {
  const { conversationId, lead, provedor: p } = a;
  const precisaAgenda = a.sessao.etapa === "remarcando" || /hor|remarc|reagend|outro dia|n[aã]o (vou )?(consigo|posso|d[aá])|adiar|mudar|trocar/i.test(a.mensagem);
  const slots = precisaAgenda ? await buscarSlotsLigacao(p.organizationId, 3).catch(() => []) : [];
  const out = turnoPosPassagem({ sessao: a.sessao, mensagem: a.mensagem, slotsLivres: slots });

  if (out.acao === "silencio") return;
  if (out.acao === "recebi_foto") {
    // várias fotos chegam juntas (um webhook por foto): só a primeira execução responde
    try { await prisma.alertaEnviadoMax.create({ data: { chave: `julia-recebi-foto:${conversationId}` } }); } catch { return; }
    await enviarBaloes(conversationId, p, lead.phoneNumber, out.mensagens, a.citar, a.sandbox);
    await saveSdrSession(conversationId, out.sessao).catch(() => {});
    return;
  }
  if (out.acao === "oferecer_novos_horarios") {
    await enviarBaloes(conversationId, p, lead.phoneNumber, out.mensagens, a.citar, a.sandbox);
    await saveSdrSession(conversationId, out.sessao).catch(() => {});
    return;
  }
  // remarcar
  const inicio = new Date(out.slotEscolhido!);
  if (!(await slotLivre(p.organizationId, inicio, a.sessao.reuniao_evento_id))) {
    const novos = await buscarSlotsLigacao(p.organizationId, 2).catch(() => []);
    if (novos.length) {
      await enviarBaloes(conversationId, p, lead.phoneNumber, textosHorarioOcupado(novos[0].label, novos[1]?.label ?? null), a.citar, a.sandbox);
      await saveSdrSession(conversationId, { ...a.sessao, slots_oferecidos: novos.map((x) => x.iso), etapa: "remarcando" }).catch(() => {});
    }
    return;
  }
  const nomeCompleto = (a.sessao.nome || lead.profileName || lead.phoneNumber).trim();
  const r = await remarcarLigacao({
    organizationId: p.organizationId, leadId: lead.id, inicio, nome: nomeCompleto, empresa: a.sessao.empresa, telefone: lead.phoneNumber,
    resumo: formatarAvisoPedro(lead, out.sessao, rotuloSlot(inicio)), eventoAnteriorId: a.sessao.reuniao_evento_id,
  }).catch((e) => { console.error("[Júlia] Falha ao remarcar:", e); return null; });
  const rotulo = rotuloSlot(inicio);
  const s: SDRSession = { ...out.sessao, reuniao_evento_id: r?.eventoId ?? a.sessao.reuniao_evento_id, horario_reuniao: inicio.toISOString(), etapa: "ligacao_marcada" };
  await saveSdrSession(conversationId, s).catch(() => {});
  await prisma.lead.update({ where: { id: lead.id }, data: { reuniaoEm: inicio } }).catch(() => {});
  await enviarBaloes(conversationId, p, lead.phoneNumber, textosConfirmacao(rotulo, false).slice(0, 1), a.citar, a.sandbox);
  if (!a.sandbox) await notificar(`🔁 Ligação remarcada: ${nomeCompleto}${a.sessao.empresa ? ` – ${a.sessao.empresa}` : ""}\nNovo horário: ${rotulo}\nWhatsApp: +${lead.phoneNumber}`, p, lead.id, conversationId);
}
