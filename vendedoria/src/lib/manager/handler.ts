// ── Manager WhatsApp Command Handler ────────────────────────────────────────
// When the owner's number (MANAGER_NUMBER) sends a message to the business
// WhatsApp, this module intercepts it, parses the command, queries the DB
// and replies with real-time stats — no AI lead flow is triggered.

import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

export const MANAGER_NUMBER =
  process.env.MANAGER_WHATSAPP_NUMBER ?? "5562984465388";

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function brasiliaHour(): number {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  ).getHours();
}

// ── Normalize BR phone: strip country code 55 and the mobile "9" prefix ────
// Makes comparison tolerant to both 12-digit (55 + DDD + 8) and 13-digit
// (55 + DDD + 9 + 8) formats that WhatsApp/Meta deliver interchangeably.
function canonicalBR(phone: string): string {
  let n = phone.replace(/\D/g, "");
  if (n.startsWith("55") && n.length >= 12) n = n.slice(2);
  if (n.length === 11 && n[2] === "9") n = n.slice(0, 2) + n.slice(3);
  return n; // always 10 digits (DDD + 8)
}

export function isManagerNumber(phone: string): boolean {
  return canonicalBR(phone) === canonicalBR(MANAGER_NUMBER);
}

// ── Stats fetchers ───────────────────────────────────────────────────────────

async function getVendasHoje() {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  return prisma.whatsappConversation.count({
    where: { etapa: "PEDIDO_CONFIRMADO", updatedAt: { gte: since } },
  });
}

async function getLeadsAtivos() {
  return prisma.lead.count({ where: { status: "OPEN" } });
}

async function getLeadsAtendidos(hours = 24) {
  const since = new Date(Date.now() - hours * 3600_000);
  return prisma.whatsappMessage.findMany({
    where: { role: "USER", sentAt: { gte: since } },
    distinct: ["conversationId"],
    select: { conversationId: true },
  }).then((r) => r.length);
}

async function getPedidosDetalhes() {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  return prisma.ownerNotification.findMany({
    where: { type: "ORDER", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { title: true, body: true, createdAt: true },
  });
}

async function getLeadsPerdidos(hours = 24) {
  const since = new Date(Date.now() - hours * 3600_000);
  return prisma.whatsappConversation.count({
    where: {
      OR: [
        { etapa: "PERDIDO", updatedAt: { gte: since } },
        { foraAreaEntrega: true, updatedAt: { gte: since } },
      ],
    },
  });
}

async function getObjecoes(hours = 24) {
  const since = new Date(Date.now() - hours * 3600_000);
  const [caro, prazo, desconfianca, concorrente] = await Promise.all([
    prisma.whatsappMessage.count({
      where: { role: "USER", sentAt: { gte: since }, content: { contains: "caro", mode: "insensitive" } },
    }),
    prisma.whatsappMessage.count({
      where: { role: "USER", sentAt: { gte: since }, content: { contains: "prazo", mode: "insensitive" } },
    }),
    prisma.whatsappMessage.count({
      where: { role: "USER", sentAt: { gte: since }, OR: [
        { content: { contains: "golpe", mode: "insensitive" } },
        { content: { contains: "confia", mode: "insensitive" } },
        { content: { contains: "real", mode: "insensitive" } },
      ]},
    }),
    prisma.whatsappMessage.count({
      where: { role: "USER", sentAt: { gte: since }, OR: [
        { content: { contains: "mercado livre", mode: "insensitive" } },
        { content: { contains: "shopee", mode: "insensitive" } },
        { content: { contains: "amazon", mode: "insensitive" } },
      ]},
    }),
  ]);
  return { caro, prazo, desconfianca, concorrente };
}

async function getNumeroClientes(limit = 10) {
  const since = new Date(Date.now() - 24 * 3600_000);
  const leads = await prisma.lead.findMany({
    where: { status: "OPEN", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { phoneNumber: true, profileName: true, createdAt: true },
  });
  return leads;
}

async function getQualidadeLeads(hours = 24) {
  const since = new Date(Date.now() - hours * 3600_000);
  const [total, quentes, perdidos, confirmados, foraArea] = await Promise.all([
    prisma.lead.count({ where: { createdAt: { gte: since } } }),
    prisma.whatsappConversation.count({
      where: { etapa: { in: ["NEGOCIANDO", "COLETANDO_DADOS", "PEDIDO_CONFIRMADO"] }, updatedAt: { gte: since } },
    }),
    prisma.whatsappConversation.count({ where: { etapa: "PERDIDO", updatedAt: { gte: since } } }),
    prisma.whatsappConversation.count({ where: { etapa: "PEDIDO_CONFIRMADO", updatedAt: { gte: since } } }),
    prisma.whatsappConversation.count({ where: { foraAreaEntrega: true, updatedAt: { gte: since } } }),
  ]);
  return { total, quentes, perdidos, confirmados, foraArea };
}

// ── LLM-powered free query — uses OPENAI_API_KEY (with ANTHROPIC as fallback) ─

async function consultarLLM(pergunta: string, contexto: string): Promise<string> {
  const systemPrompt = `Você é um assistente de vendas WhatsApp. Analise os dados do CRM e responda de forma direta e útil em português. Use emojis. Seja conciso (máx 5 linhas).`;
  const userMsg = `Dados do CRM:\n${contexto}\n\nPergunta do gestor: ${pergunta}`;

  // OpenAI (primary — always configured in this env)
  if (process.env.OPENAI_API_KEY) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 400,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMsg }],
      }),
    });
    if (res.ok) {
      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (text) return text;
    }
  }

  // Anthropic fallback
  if (process.env.ANTHROPIC_API_KEY) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    if (res.ok) {
      const data = await res.json() as { content?: Array<{ text?: string }> };
      const text = data.content?.[0]?.text?.trim();
      if (text) return text;
    }
  }

  return "❌ Nenhuma chave de IA configurada no servidor.";
}

// ── Command router ───────────────────────────────────────────────────────────

type ProviderConfig = {
  businessPhoneNumberId: string;
  accessToken?: string | null;
};

export async function handleManagerMessage(
  text: string,
  providerConfig: ProviderConfig,
  replyTo?: string
): Promise<void> {
  const { businessPhoneNumberId, accessToken } = providerConfig;
  const token = accessToken ?? undefined;
  // Reply to the wa_id that sent the message (preserves 12/13-digit format Meta gave us).
  // Fall back to MANAGER_NUMBER if the webhook didn't pass the original sender.
  const target = replyTo ?? MANAGER_NUMBER;
  const cmd = text.toLowerCase().trim();

  console.log(`[Manager] cmd="${cmd.slice(0, 60)}" → reply to ${target}`);

  const send = (msg: string) =>
    sendWhatsAppMessage(businessPhoneNumberId, target, msg, token);

  // ── vendas / pedidos ───────────────────────────────────────────────────────
  if (/vend[as]|pedid[os]|confirmad[os]|quantas vendas/i.test(cmd)) {
    const vendas = await getVendasHoje();
    const pedidos = await getPedidosDetalhes();
    let msg = `*📦 VENDAS DE HOJE*\n\n${vendas} pedido(s) confirmado(s)`;
    if (pedidos.length > 0) {
      msg += "\n\n*Detalhes:*\n" + pedidos.map((p, i) =>
        `${i + 1}. ${p.title} — ${p.createdAt.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}`
      ).join("\n");
    }
    await send(msg);
    return;
  }

  // ── leads ativos ──────────────────────────────────────────────────────────
  if (/leads|quantos leads|atend/i.test(cmd)) {
    const [ativos, atendidos] = await Promise.all([getLeadsAtivos(), getLeadsAtendidos(24)]);
    await send(
      `*👥 LEADS*\n\n` +
      `• Ativos agora: *${ativos}*\n` +
      `• Atendidos (últimas 24h): *${atendidos}*`
    );
    return;
  }

  // ── números dos clientes ──────────────────────────────────────────────────
  if (/n[uú]mero|cliente|contato|telefone/i.test(cmd)) {
    const leads = await getNumeroClientes(15);
    if (leads.length === 0) {
      await send("Nenhum lead novo nas últimas 24h.");
      return;
    }
    const lista = leads.map((l, i) =>
      `${i + 1}. ${l.profileName ?? "Sem nome"} — wa.me/${l.phoneNumber}`
    ).join("\n");
    await send(`*📱 LEADS RECENTES (24h)*\n\n${lista}`);
    return;
  }

  // ── objeções ─────────────────────────────────────────────────────────────
  if (/objeç[aã]o|objeções|reclamaç|dificuldade/i.test(cmd)) {
    const obj = await getObjecoes(24);
    await send(
      `*🚧 OBJEÇÕES (24h)*\n\n` +
      `💸 Preço caro: ${obj.caro}x\n` +
      `⏳ Prazo: ${obj.prazo}x\n` +
      `🤔 Desconfiança: ${obj.desconfianca}x\n` +
      `🛒 Concorrente: ${obj.concorrente}x`
    );
    return;
  }

  // ── perdidos ──────────────────────────────────────────────────────────────
  if (/perdid[os]|desistência|fora.area|nao.fechou/i.test(cmd)) {
    const perdidos = await getLeadsPerdidos(24);
    await send(`*❌ LEADS PERDIDOS (24h)*\n\n${perdidos} lead(s) perdidos ou fora da área`);
    return;
  }

  // ── qualidade de leads ────────────────────────────────────────────────────
  if (/qualidade|qualificad|lead.bom|lead.ruim/i.test(cmd)) {
    const q = await getQualidadeLeads(24);
    const taxaConv = q.total > 0 ? ((q.confirmados / q.total) * 100).toFixed(1) : "0";
    const taxaQuente = q.total > 0 ? ((q.quentes / q.total) * 100).toFixed(1) : "0";
    await send(
      `*🎯 QUALIDADE DOS LEADS (24h)*\n\n` +
      `• Total de leads: ${q.total}\n` +
      `• Qualificados/quentes: ${q.quentes} (${taxaQuente}%)\n` +
      `• Confirmados: ${q.confirmados} (${taxaConv}% conversão)\n` +
      `• Perdidos: ${q.perdidos}\n` +
      `• Fora da área: ${q.foraArea}`
    );
    return;
  }

  // ── resumo completo ───────────────────────────────────────────────────────
  if (/resumo|dashboard|relat|status|como.t[aá]/i.test(cmd)) {
    const [vendas, ativos, perdidos, atendidos, obj, q] = await Promise.all([
      getVendasHoje(),
      getLeadsAtivos(),
      getLeadsPerdidos(24),
      getLeadsAtendidos(24),
      getObjecoes(24),
      getQualidadeLeads(24),
    ]);
    const taxaConv = q.total > 0 ? ((vendas / q.total) * 100).toFixed(1) : "0";
    const hora = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    await send(
      `*📊 RESUMO — ${hora} (Brasília)*\n\n` +
      `📦 Vendas hoje: *${vendas}*\n` +
      `👥 Leads ativos: ${ativos}\n` +
      `💬 Atendidos (24h): ${atendidos}\n` +
      `❌ Perdidos (24h): ${perdidos}\n` +
      `🎯 Conversão: ${taxaConv}%\n\n` +
      `*Objeções:*\n` +
      `💸 Preço: ${obj.caro}x | ⏳ Prazo: ${obj.prazo}x | 🛒 Concorr.: ${obj.concorrente}x`
    );
    return;
  }

  // ── ajuda ─────────────────────────────────────────────────────────────────
  if (/ajuda|help|comando|oque.*faz|o que.*faz/i.test(cmd)) {
    await send(
      `*🤖 COMANDOS DISPONÍVEIS*\n\n` +
      `• *vendas* — pedidos confirmados hoje\n` +
      `• *leads* — quantos leads ativos\n` +
      `• *números* — whatsapp dos clientes recentes\n` +
      `• *objeções* — dificuldades do bot (24h)\n` +
      `• *perdidos* — leads que não fecharam\n` +
      `• *qualidade* — análise dos leads\n` +
      `• *resumo* — dashboard completo\n\n` +
      `Ou pergunte qualquer coisa sobre as vendas! 💬`
    );
    return;
  }

  // ── pergunta livre → LLM ─────────────────────────────────────────────────
  const [vendas, ativos, perdidos, obj] = await Promise.all([
    getVendasHoje(),
    getLeadsAtivos(),
    getLeadsPerdidos(24),
    getObjecoes(24),
  ]);
  const contexto =
    `Vendas hoje: ${vendas} | Leads ativos: ${ativos} | Perdidos 24h: ${perdidos}\n` +
    `Objeções: caro=${obj.caro} prazo=${obj.prazo} desconfiança=${obj.desconfianca} concorrente=${obj.concorrente}`;
  const resposta = await consultarLLM(text, contexto);
  await send(resposta);
}
