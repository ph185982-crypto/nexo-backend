// Aviso de véspera das contas a pagar: um dia antes do vencimento o Max (o agente
// de IA do financeiro) avisa o dono pelo WhatsApp, e também grava uma notificação
// no CRM e manda push, porque o WhatsApp só aceita texto livre dentro de 24h da
// última mensagem do dono ao bot.
//
// Por que existe: o aviso "conta vence amanhã" já estava escrito em alertas.ts,
// mas esse cron (/api/cron/max) nunca foi agendado — nem na Vercel (plano Hobby,
// 2 crons) nem no GitHub Actions — e a tabela de alertas enviados está vazia. Este
// módulo roda só o aviso das contas, sem ligar de uma vez o briefing, o
// fechamento do dia e os demais envios do Max.
//
// Garantias:
//  • Uma vez por conta e por vencimento (AlertaEnviadoMax). Mudar a data da
//    conta gera um aviso novo; reabrir a tela não repete.
//  • Só de 8h às 21h (Brasília). Quem vence cedo de manhã é avisado na véspera.
//  • Se nenhum canal entregar, a trava é liberada e a próxima rodada tenta de novo.

import { after } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { getOwnerProvider, MAX_OWNER_NUMBER, resolveToken } from "../config";

export const chaveVespera = (contaId: string, vencimentoISO: string) => `conta-vespera-${contaId}-${vencimentoISO}`;

const HORA_INICIO = 8;
const HORA_FIM = 21;
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export interface ItemVespera {
  descricao: string;
  valor: number;
  categoria: string;
}

/** Partes de data/hora em Brasília de um instante qualquer. */
export function partesBrasilia(d: Date): { dia: string; hora: number } {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return { dia: `${get("year")}-${get("month")}-${get("day")}`, hora: Number(get("hour")) };
}

/** O dia seguinte (YYYY-MM-DD) como meia-noite UTC, igual ao formato das colunas @db.Date. */
export function amanhaComoData(diaHoje: string): Date {
  const [y, m, d] = diaHoje.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1));
}

export function montarMensagemVespera(itens: ItemVespera[], amanha: Date): string {
  const dia = amanha.toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "2-digit" });
  const total = itens.reduce((a, i) => a + i.valor, 0);
  if (itens.length === 1) {
    const i = itens[0];
    return `⏰ Amanhã (${dia}) vence uma conta:\n\n• ${i.descricao} — ${BRL.format(i.valor)}${i.categoria ? ` (${i.categoria})` : ""}\n\nQuando pagar, marque como paga na tela Contas.`;
  }
  const linhas = itens.map((i) => `• ${i.descricao} — ${BRL.format(i.valor)}`).join("\n");
  return `⏰ Amanhã (${dia}) vencem ${itens.length} contas:\n\n${linhas}\n\nTotal: ${BRL.format(total)}\nQuando pagar, marque como paga na tela Contas.`;
}

export interface EntregaVespera {
  whatsapp: boolean;
  notificacao: boolean;
}

/** Entrega por WhatsApp (Max), notificação no CRM e push. Injetável nos testes. */
export type Entregador = (mensagem: string, itens: ItemVespera[]) => Promise<EntregaVespera>;

export const entregarPorTodosOsCanais: Entregador = async (mensagem, itens) => {
  const provider = await getOwnerProvider().catch(() => null);
  const out: EntregaVespera = { whatsapp: false, notificacao: false };

  if (provider) {
    try {
      await sendWhatsAppMessage(provider.businessPhoneNumberId, MAX_OWNER_NUMBER, `🔔 Max de olho:\n\n${mensagem}`, resolveToken(provider.accessToken));
      out.whatsapp = true;
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      const janela = /131047|24.?hour|re-?engagement/i.test(erro);
      console.error(`[Max] Aviso de conta não saiu pelo WhatsApp${janela ? " (janela de 24h fechada — mande qualquer mensagem ao Max para reabrir)" : ""}:`, erro);
    }
  }

  const organizationId = provider?.organizationId
    ?? (await prisma.whatsappBusinessOrganization.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } }).catch(() => null))?.id;
  if (organizationId) {
    out.notificacao = await prisma.ownerNotification
      .create({
        data: {
          type: "INFO",
          title: itens.length === 1 ? `⏰ Conta vence amanhã — ${itens[0].descricao}` : `⏰ ${itens.length} contas vencem amanhã`,
          body: mensagem,
          organizationId,
        },
      })
      .then(() => true)
      .catch((e) => { console.error("[Max] Falha ao gravar a notificação da conta:", e); return false; });
  }

  try {
    const { sendPushToAll } = await import("@/lib/push/notificar");
    await sendPushToAll({
      title: itens.length === 1 ? "⏰ Conta vence amanhã" : `⏰ ${itens.length} contas vencem amanhã`,
      body: itens.map((i) => `${i.descricao} ${BRL.format(i.valor)}`).join(" · ").slice(0, 180),
      url: "/crm/financeiro",
      tag: "contas-vespera",
    });
  } catch (e) {
    console.error("[Max] Falha ao enviar o push da conta:", e);
  }
  return out;
};

export interface ResultadoVespera {
  /** "fora-do-horario" | "nada" | "avisado" | "sem-canal" */
  situacao: "fora-do-horario" | "nada" | "avisado" | "sem-canal";
  contas: number;
  entrega?: EntregaVespera;
}

export async function avisarContasDeAmanha(opts: { agora?: Date; entregar?: Entregador } = {}): Promise<ResultadoVespera> {
  const agora = opts.agora ?? new Date();
  const { dia, hora } = partesBrasilia(agora);
  if (hora < HORA_INICIO || hora >= HORA_FIM) return { situacao: "fora-do-horario", contas: 0 };

  const amanha = amanhaComoData(dia);
  const vencimento = amanha.toISOString().slice(0, 10);
  const contas = await prisma.contaPagarMax.findMany({
    where: { status: "pendente", data_vencimento: amanha },
    orderBy: { valor: "desc" },
  });
  if (contas.length === 0) return { situacao: "nada", contas: 0 };

  // Trava por conta: só avisa as que ainda não foram avisadas para este vencimento.
  const novas: typeof contas = [];
  const chaves: string[] = [];
  for (const c of contas) {
    const chave = chaveVespera(c.id, vencimento);
    try {
      await prisma.alertaEnviadoMax.create({ data: { chave } });
      novas.push(c);
      chaves.push(chave);
    } catch { /* já avisada */ }
  }
  if (novas.length === 0) return { situacao: "nada", contas: 0 };

  const itens: ItemVespera[] = novas.map((c) => ({ descricao: c.descricao, valor: c.valor, categoria: c.categoria }));
  const entrega = await (opts.entregar ?? entregarPorTodosOsCanais)(montarMensagemVespera(itens, amanha), itens);
  if (!entrega.whatsapp && !entrega.notificacao) {
    // Nada chegou ao dono: libera a trava para a próxima rodada tentar de novo.
    await prisma.alertaEnviadoMax.deleteMany({ where: { chave: { in: chaves } } }).catch(() => {});
    return { situacao: "sem-canal", contas: novas.length, entrega };
  }
  console.log(`[Max] Aviso de véspera enviado | contas=${novas.length} whatsapp=${entrega.whatsapp} notificacao=${entrega.notificacao}`);
  return { situacao: "avisado", contas: novas.length, entrega };
}

// ─── Gatilho oportunista (mesmo modelo dos follow-ups): health, telas do CRM e cron de 10 min ──
const INTERVALO_MS = 10 * 60_000;
let ultimaRodada = 0;

export function acionarAvisoContasSePreciso(origem: string, opts: { forcar?: boolean } = {}): "acionado" | "throttle" {
  const agora = Date.now();
  if (!opts.forcar && agora - ultimaRodada < INTERVALO_MS) return "throttle";
  ultimaRodada = agora;
  const trabalho = async () => {
    try {
      await avisarContasDeAmanha();
    } catch (e) {
      console.error(`[Max] Aviso de véspera | origem=${origem} falhou:`, e);
    }
  };
  try {
    after(trabalho);
  } catch {
    void trabalho();
  }
  return "acionado";
}

/** Só para testes: zera o throttle. */
export function _resetAvisoContas(): void { ultimaRodada = 0; }
