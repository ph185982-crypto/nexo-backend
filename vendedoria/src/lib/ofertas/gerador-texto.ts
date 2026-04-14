export interface DadosTexto {
  nome: string;
  precoVenda: number;
  precoDesconto: number;
  parcelamento: number;
}

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const SYSTEM_PROMPT = `Você é um especialista em copywriting para vendas de ferramentas no WhatsApp.
Crie legendas curtas, impactantes e persuasivas em português brasileiro.
Use emojis estrategicamente. Seja direto ao ponto. Máximo 5 linhas.
Tom: animado, confiante, urgente (escassez/oferta por tempo limitado).`;

function userPrompt(dados: DadosTexto): string {
  return `Crie uma legenda de oferta para WhatsApp para o produto:

Nome: ${dados.nome}
Preço original: ${fmt(dados.precoVenda)}
Preço com desconto: ${fmt(dados.precoDesconto)}
Parcelamento: 10x de ${fmt(dados.parcelamento)} sem juros

Inclua: nome do produto, preço com desconto, parcelamento, urgência para chamar no WhatsApp.
Não inclua hashtags. Seja conciso (máximo 5 linhas).`;
}

function fallbackTexto(dados: DadosTexto): string {
  return `🔧 *${dados.nome}*

💥 De ${fmt(dados.precoVenda)} por apenas *${fmt(dados.precoDesconto)}*
💳 Ou em 10x de *${fmt(dados.parcelamento)}* sem juros

⚡ Oferta por tempo limitado! Chame agora no WhatsApp e garanta o seu! 📲`;
}

export async function gerarTextoOferta(dados: DadosTexto): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[gerarTexto] ANTHROPIC_API_KEY não configurada — usando fallback");
    return fallbackTexto(dados);
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt(dados) }],
        max_tokens: 300,
        temperature: 0.8,
      }),
    });

    if (!res.ok) {
      console.error("[gerarTexto] Anthropic error:", await res.text());
      return fallbackTexto(dados);
    }

    const data = await res.json() as { content?: Array<{ text?: string }> };
    const texto = data.content?.[0]?.text?.trim();
    if (!texto) return fallbackTexto(dados);

    console.log(`[gerarTexto] Caption gerada para "${dados.nome}"`);
    return texto;
  } catch (err) {
    console.error("[gerarTexto] erro:", err);
    return fallbackTexto(dados);
  }
}
