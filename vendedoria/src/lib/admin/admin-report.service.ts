import { adminRepository } from "@/lib/admin/admin.repository";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

// ─── LLM helper ───────────────────────────────────────────────────────────────

async function consultarLLM(pergunta: string, contexto: string): Promise<string | null> {
  const systemPrompt = `Você é um assistente de vendas WhatsApp. Analise os dados do CRM e responda de forma direta e útil em português. Use emojis. Seja conciso (máx 5 linhas).`;
  const userMsg = `Dados do CRM:\n${contexto}\n\nPergunta do gestor: ${pergunta}`;

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

  return null;
}

// ─── Report builder ───────────────────────────────────────────────────────────

export async function buildDailyReport(label: "13h" | "18h"): Promise<string> {
  const hora = new Date().toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });

  const [vendas, ativos, perdidos, atendidos, obj, qualidade] = await Promise.all([
    adminRepository.getVendasHoje(),
    adminRepository.getLeadsAtivos(),
    adminRepository.getLeadsPerdidos(24),
    adminRepository.getLeadsAtendidos(24),
    adminRepository.getObjecoes(24),
    adminRepository.getQualidadeLeads(24),
  ]);

  const taxaConv =
    qualidade.total > 0 ? ((vendas.confirmadas / qualidade.total) * 100).toFixed(1) : "0";

  const objecoesMap = {
    "💸 Preço": obj.caro,
    "⏳ Prazo": obj.prazo,
    "🤔 Desconfiança": obj.desconfianca,
    "🛒 Concorrente": obj.concorrente,
  };
  const topEntry = Object.entries(objecoesMap).sort((a, b) => b[1] - a[1])[0];
  const topObjecao =
    topEntry[1] > 0 ? `${topEntry[0]} (${topEntry[1]}x)` : "nenhuma registrada";

  return (
    `*📊 RELATÓRIO ${label} — ${hora} (Brasília)*\n\n` +
    `📦 Vendas hoje: *${vendas.confirmadas}*\n` +
    `👥 Leads ativos: ${ativos}\n` +
    `💬 Atendidos (24h): ${atendidos}\n` +
    `❌ Perdidos (24h): ${perdidos}\n` +
    `🎯 Conversão: ${taxaConv}%\n\n` +
    `*Objeção principal:* ${topObjecao}\n` +
    `Preço: ${obj.caro}x | Prazo: ${obj.prazo}x | Concorr.: ${obj.concorrente}x`
  );
}

// ─── Send report to admin ─────────────────────────────────────────────────────

export async function sendDailyReport(label: "13h" | "18h"): Promise<void> {
  const [report, provider, bastaoNumber] = await Promise.all([
    buildDailyReport(label),
    adminRepository.getProviderConfig(),
    adminRepository.getBastaoNumber(),
  ]);

  if (!provider) {
    console.warn("[AdminReport] No WhatsApp provider configured — skipping report");
    return;
  }

  await sendWhatsAppMessage(
    provider.businessPhoneNumberId,
    bastaoNumber,
    report,
    provider.accessToken ?? undefined,
  );
  console.log(`[AdminReport] ${label} report sent to ${bastaoNumber}`);
}

// ─── Free-form query via LLM ──────────────────────────────────────────────────

export async function handleFreeQuery(text: string): Promise<string> {
  const [vendas, ativos, perdidos, obj] = await Promise.all([
    adminRepository.getVendasHoje(),
    adminRepository.getLeadsAtivos(),
    adminRepository.getLeadsPerdidos(24),
    adminRepository.getObjecoes(24),
  ]);

  const contexto =
    `Vendas hoje: ${vendas.confirmadas} | Leads ativos: ${ativos} | Perdidos 24h: ${perdidos}\n` +
    `Objeções: caro=${obj.caro} prazo=${obj.prazo} desconfiança=${obj.desconfianca} concorrente=${obj.concorrente}`;

  const resposta = await consultarLLM(text, contexto);
  return resposta ?? "❌ Nenhuma chave de IA configurada no servidor.";
}
