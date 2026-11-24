// Entrega garantida dos avisos ao dono (bastão do SDR) pelo WhatsApp.
//
// Por que existe (22/11/2026): a Meta ACEITA o envio de texto livre para o número do Pedro (HTTP 200, com wamid) e só
// depois manda o status "failed" pelo webhook quando a janela de 24 h dele com o bot está fechada (o Pedro conversa com o
// Max quase todo dia, mas não sempre). O código tratava o 200 como "entregue": o Marles (21/11, 21h) e a Neusa (19/11)
// viraram ESCALATED, o CRM mostrou "Novo lead escalado" e o WhatsApp do Pedro nunca recebeu nada.
//
// Agora:
//  • Cada bastão é um OwnerNotification (ESCALATION). Ele só conta como enviado depois de sair com a janela aberta
//    (marca `aviso-dono:enviado:<id>` em max_alertas_enviados) — sem mudança de schema.
//  • Janela fechada: não manda texto (a Meta descartaria). O aviso fica PENDENTE; se houver template aprovado
//    (OWNER_ALERT_TEMPLATE_NAME), manda um "você tem leads novos" (no máximo 1 por hora) para o Pedro responder e abrir a janela.
//  • Assim que o Pedro manda QUALQUER mensagem ao número (ex.: um gasto para o Max), os pendentes saem na hora.
//  • Status "failed" da Meta para um aviso já enviado: a marca é desfeita e ele volta a ser pendente.
import { prisma } from "@/lib/prisma/client";
import { dentroDaJanela } from "@/lib/followup/janela";
import { brazilianNumberVariants, sendWhatsAppMessage, sendWhatsAppTemplate } from "./send";

import { numeroDono, ehDono, podeMandarTexto } from "./aviso-dono-regras";
export { numeroDono, ehDono, podeMandarTexto };

// Avisos criados antes disto já foram tratados à mão (não reenvia a semana inteira ao ligar a correção).
export const AVISOS_DESDE = new Date("2026-11-19T00:00:00Z");
const JANELA_PENDENTES_MS = 7 * 24 * 3600 * 1000;

export const chaveEnviado = (id: string) => `aviso-dono:enviado:${id}`;
export const chaveWamid = (wamid: string, id: string) => `aviso-dono:wamid:${wamid}:${id}`;
const prefixoWamid = (wamid: string) => `aviso-dono:wamid:${wamid}:`;

/** Última mensagem que o Pedro mandou para este número de WhatsApp (null = nunca conversou aqui / não achou). */
export async function ultimaMensagemDoDono(providerId: string): Promise<Date | null> {
  const m = await prisma.whatsappMessage.findFirst({
    where: { role: "USER", conversation: { whatsappProviderConfigId: providerId, lead: { phoneNumber: { in: brazilianNumberVariants(numeroDono()) } } } },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  return m?.sentAt ?? null;
}


type Provedor = { id: string; businessPhoneNumberId: string; accessToken: string | null };
async function provedorPorNumero(phoneNumberId: string): Promise<Provedor | null> {
  return prisma.whatsappProviderConfig.findFirst({ where: { businessPhoneNumberId: phoneNumberId }, select: { id: true, businessPhoneNumberId: true, accessToken: true } });
}

async function marcarEnviado(notificacaoId: string, wamid: string | undefined): Promise<void> {
  await prisma.alertaEnviadoMax.create({ data: { chave: chaveEnviado(notificacaoId) } }).catch(() => {});
  if (wamid) await prisma.alertaEnviadoMax.create({ data: { chave: chaveWamid(wamid, notificacaoId) } }).catch(() => {});
}

// Template opcional para "acordar" o Pedro quando a janela está fechada (no máximo 1 por hora).
async function pingTemplate(p: Provedor, agora: Date): Promise<boolean> {
  const nome = process.env.OWNER_ALERT_TEMPLATE_NAME?.trim();
  if (!nome) return false;
  const hora = agora.toISOString().slice(0, 13);
  try { await prisma.alertaEnviadoMax.create({ data: { chave: `aviso-dono:ping:${hora}` } }); } catch { return false; }
  try {
    await sendWhatsAppTemplate(p.businessPhoneNumberId, numeroDono(), nome, process.env.OWNER_ALERT_TEMPLATE_LANG?.trim() || "pt_BR", [], p.accessToken ?? undefined);
    return true;
  } catch (e) {
    console.error("[AvisoDono] Template de aviso falhou:", e instanceof Error ? e.message : e);
    return false;
  }
}

export type ResultadoAviso = { whatsappOk: boolean; pendente: boolean; janelaFechada: boolean; erroWhatsapp?: string; template?: boolean };

/** Entrega um aviso (já gravado como OwnerNotification) ao WhatsApp do Pedro, ou deixa pendente. */
export async function entregarAvisoAoDono(
  notificacaoId: string | null,
  texto: string,
  phoneNumberId: string,
  token: string | undefined,
  agora: Date = new Date(),
): Promise<ResultadoAviso> {
  const p = await provedorPorNumero(phoneNumberId).catch(() => null);
  const ultima = p ? await ultimaMensagemDoDono(p.id).catch(() => null) : null;
  if (!podeMandarTexto(ultima, agora)) {
    const template = p ? await pingTemplate(p, agora) : false;
    console.warn(`[AvisoDono] Janela do Pedro fechada (última msg ${ultima?.toISOString()}) — aviso ${notificacaoId} fica pendente${template ? " (template enviado)" : ""}`);
    return { whatsappOk: false, pendente: true, janelaFechada: true, template };
  }
  try {
    const wamid = await sendWhatsAppMessage(phoneNumberId, numeroDono(), texto, token);
    if (notificacaoId) await marcarEnviado(notificacaoId, wamid);
    return { whatsappOk: true, pendente: false, janelaFechada: false };
  } catch (e) {
    const erroWhatsapp = e instanceof Error ? e.message : String(e);
    const janelaFechada = /131047|24.?hour|re-?engagement/i.test(erroWhatsapp);
    console.error("[AvisoDono] Falha ao enviar aviso ao Pedro:", erroWhatsapp);
    return { whatsappOk: false, pendente: true, janelaFechada, erroWhatsapp };
  }
}

/** Avisos de bastão que ainda não saíram (mais antigos primeiro). */
export async function avisosPendentes(agora: Date = new Date()) {
  const desde = new Date(Math.max(AVISOS_DESDE.getTime(), agora.getTime() - JANELA_PENDENTES_MS));
  const avisos = await prisma.ownerNotification.findMany({
    // só bastão de LEAD (tem leadId): alertas de operação (saldo da IA etc.) não são bastão e já saem por push
    where: { type: "ESCALATION", leadId: { not: null }, createdAt: { gte: desde } },
    orderBy: { createdAt: "asc" },
    select: { id: true, body: true, createdAt: true, leadId: true },
    take: 30,
  });
  if (!avisos.length) return [];
  const feitos = await prisma.alertaEnviadoMax.findMany({ where: { chave: { in: avisos.map((a) => chaveEnviado(a.id)) } }, select: { chave: true } });
  const ok = new Set(feitos.map((f) => f.chave));
  return avisos.filter((a) => !ok.has(chaveEnviado(a.id)));
}

const quando = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Manda os avisos pendentes se a janela do Pedro estiver aberta. Chamado quando ele escreve e no tráfego do webhook. */
export async function entregarPendentes(phoneNumberId: string, token: string | undefined, agora: Date = new Date()): Promise<number> {
  const p = await provedorPorNumero(phoneNumberId).catch(() => null);
  if (!p) return 0;
  const ultima = await ultimaMensagemDoDono(p.id).catch(() => null);
  if (!ultima || !dentroDaJanela(ultima, agora)) return 0;
  const pendentes = await avisosPendentes(agora);
  let n = 0;
  for (const a of pendentes.slice(0, 10)) {
    // Reivindica antes de mandar: dois webhooks ao mesmo tempo não mandam o mesmo bastão duas vezes.
    try { await prisma.alertaEnviadoMax.create({ data: { chave: chaveEnviado(a.id) } }); } catch { continue; }
    try {
      const wamid = await sendWhatsAppMessage(phoneNumberId, numeroDono(), `⏰ Bastão que não tinha chegado no seu WhatsApp (lead escalado em ${quando(a.createdAt)}):\n\n${a.body}`, token ?? p.accessToken ?? undefined);
      if (wamid) await prisma.alertaEnviadoMax.create({ data: { chave: chaveWamid(wamid, a.id) } }).catch(() => {});
      n++;
    } catch (e) {
      await prisma.alertaEnviadoMax.deleteMany({ where: { chave: chaveEnviado(a.id) } }).catch(() => {});
      console.error("[AvisoDono] Pendente não saiu:", e instanceof Error ? e.message : e);
      break;
    }
  }
  if (n) console.log(`[AvisoDono] ${n} bastão(ões) pendente(s) entregue(s) ao Pedro`);
  return n;
}

/** Status "failed" da Meta para um aviso que contávamos como enviado: volta a ser pendente. */
export async function statusDeAviso(wamid: string, status: string, codigoErro?: number | string | null): Promise<boolean> {
  if (status !== "failed") return false;
  const m = await prisma.alertaEnviadoMax.findFirst({ where: { chave: { startsWith: prefixoWamid(wamid) } }, select: { chave: true } });
  if (!m) return false;
  const id = m.chave.slice(prefixoWamid(wamid).length);
  await prisma.alertaEnviadoMax.deleteMany({ where: { chave: { in: [chaveEnviado(id), m.chave] } } });
  console.error(`[AvisoDono] ⚠️ Meta não entregou o bastão ${id} ao Pedro (erro ${codigoErro ?? "?"}) — volta para a fila e sai quando ele escrever`);
  return true;
}
