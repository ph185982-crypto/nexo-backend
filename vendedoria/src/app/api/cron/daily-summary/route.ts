import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

/**
 * GET /api/cron/daily-summary
 * Analisa todas as conversas das últimas 24h e envia resumo ao dono às 8h.
 * Chamado por cron job (vercel.json ou Render cron) — protegido por CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000); // últimas 24h

  // ── Coleta estatísticas das últimas 24h ───────────────────────────────────
  const [
    novasConversas,
    mensagensUsuario,
    pedidosConfirmados,
    escalados,
    perdidos,
    foraArea,
    followupsSent,
  ] = await Promise.all([
    // Novas conversas iniciadas
    prisma.whatsappConversation.count({
      where: { createdAt: { gte: since } },
    }),
    // Total de mensagens de clientes
    prisma.whatsappMessage.count({
      where: { role: "USER", sentAt: { gte: since } },
    }),
    // Pedidos confirmados (etapa PEDIDO_CONFIRMADO alcançada hoje)
    prisma.whatsappConversation.count({
      where: { etapa: "PEDIDO_CONFIRMADO", updatedAt: { gte: since } },
    }),
    // Leads escalados
    prisma.lead.count({
      where: { status: "ESCALATED", updatedAt: { gte: since } },
    }),
    // Leads perdidos / fora de área
    prisma.whatsappConversation.count({
      where: { etapa: "PERDIDO", updatedAt: { gte: since } },
    }),
    // Clientes fora da área de entrega
    prisma.whatsappConversation.count({
      where: { foraAreaEntrega: true, updatedAt: { gte: since } },
    }),
    // Follow-ups enviados
    prisma.whatsappMessage.count({
      where: { role: "ASSISTANT", sentAt: { gte: since } },
    }),
  ]);

  // ── Pedidos do dia (detalhes para o resumo) ───────────────────────────────
  const pedidosDetalhes = await prisma.ownerNotification.findMany({
    where: { type: "ORDER", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { title: true, body: true, createdAt: true },
  });

  // ── Objeções de preço mais frequentes ────────────────────────────────────
  const msgsCaro = await prisma.whatsappMessage.count({
    where: {
      role: "USER",
      sentAt: { gte: since },
      content: { contains: "caro" },
    },
  });

  // ── Conversas ativas (não confirmadas, não perdidas) ─────────────────────
  const conversasAtivas = await prisma.whatsappConversation.count({
    where: {
      isActive: true,
      etapa: { notIn: ["PEDIDO_CONFIRMADO", "PERDIDO"] },
      foraAreaEntrega: false,
      humanTakeover: false,
      lastMessageAt: { gte: new Date(now.getTime() - 48 * 60 * 60 * 1000) },
    },
  });

  // ── Gerar análise com LLM (resumo inteligente) ────────────────────────────
  const statsText =
    `📊 DADOS DAS ÚLTIMAS 24H:\n` +
    `• Novas conversas: ${novasConversas}\n` +
    `• Msgs de clientes: ${mensagensUsuario}\n` +
    `• Pedidos confirmados: ${pedidosConfirmados}\n` +
    `• Escalados para humano: ${escalados}\n` +
    `• Perdidos/Desistências: ${perdidos}\n` +
    `• Fora da área de entrega: ${foraArea}\n` +
    `• Objeções de preço ("caro"): ${msgsCaro}\n` +
    `• Conversas ativas em andamento: ${conversasAtivas}\n`;

  let insights = "";
  try {
    insights = await generateInsights(statsText, pedidosDetalhes);
  } catch (e) {
    console.error("[DailySummary] LLM insights failed:", e);
    insights = "⚠️ Análise automática indisponível hoje.";
  }

  // ── Montar mensagem final ─────────────────────────────────────────────────
  const dateStr = now.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const pedidosListText = pedidosDetalhes.length > 0
    ? `\n\n📦 *PEDIDOS DE HOJE:*\n` + pedidosDetalhes.map((p, i) =>
        `${i + 1}. ${p.title}`
      ).join("\n")
    : "\n\n📦 *PEDIDOS DE HOJE:* nenhum pedido confirmado";

  const summaryMsg =
    `*🤖 RESUMO DIÁRIO — NEXO BRASIL*\n` +
    `_${dateStr}_\n\n` +
    statsText +
    pedidosListText +
    `\n\n💡 *ANÁLISE DA IA:*\n${insights}`;

  // ── Enviar para o dono ────────────────────────────────────────────────────
  const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER ?? "5562984465388";

  // Busca qualquer providerConfig para usar o token/phoneNumberId
  const provider = await prisma.whatsappProviderConfig.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (!provider) {
    console.error("[DailySummary] Nenhum providerConfig encontrado — não foi possível enviar resumo");
    return NextResponse.json({ ok: false, error: "No provider config" });
  }

  try {
    await sendWhatsAppMessage(
      provider.businessPhoneNumberId,
      ownerNumber,
      summaryMsg,
      provider.accessToken ?? undefined,
    );
    console.log(`[DailySummary] Resumo enviado para ${ownerNumber}`);
  } catch (e) {
    console.error("[DailySummary] Falha ao enviar resumo:", e);
    return NextResponse.json({ ok: false, error: String(e) });
  }

  return NextResponse.json({
    ok: true,
    stats: {
      novasConversas,
      mensagensUsuario,
      pedidosConfirmados,
      escalados,
      perdidos,
      foraArea,
      conversasAtivas,
    },
  });
}

async function generateInsights(
  stats: string,
  pedidos: Array<{ title: string; body: string; createdAt: Date }>
): Promise<string> {
  const pedidosContext = pedidos.length > 0
    ? `\nPedidos confirmados:\n${pedidos.map((p) => `- ${p.title}`).join("\n")}`
    : "\nNenhum pedido confirmado hoje.";

  const prompt = `Você é um analista de vendas. Analise os dados abaixo de um bot de vendas WhatsApp e gere 3-4 insights práticos e acionáveis em português.

${stats}${pedidosContext}

Responda com bullets curtos (máx 2 linhas cada). Foque em: o que está funcionando, o que pode melhorar, alertas importantes.`;

  // Tenta providers em ordem
  if (process.env.ANTHROPIC_API_KEY) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (res.ok) {
      const data = await res.json() as { content?: Array<{ text?: string }> };
      const text = data.content?.[0]?.text?.trim();
      if (text) return text;
    }
  }

  if (process.env.GOOGLE_AI_API_KEY) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 300 } }),
      }
    );
    if (res.ok) {
      const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) return text;
    }
  }

  // Fallback: resumo sem LLM
  const taxa = stats.includes("Pedidos confirmados: 0")
    ? "Taxa de conversão: 0% hoje."
    : "Houve pedidos confirmados hoje ✅";
  return `• ${taxa}\n• Monitore os leads escalados para retomar atendimento.\n• Continue acompanhando objeções de preço para ajustar argumentação.`;
}
