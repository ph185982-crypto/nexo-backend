export interface DadosTexto {
  nome: string;
  precoVenda: number;
  precoDesconto: number;
  parcelamento: number;
}

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const SYSTEM_PROMPT = `Você é especialista em copywriting para vendas de ferramentas/produtos no WhatsApp.
Siga EXATAMENTE este formato na resposta (não adicione nada além disso):

🔧 *[NOME DO PRODUTO]*

[Explicação técnica do produto em 1-2 linhas — foque em potência, uso, benefício]

💰 *Preço especial: [preço com desconto]*
💳 10x de *[parcelamento]* sem juros
🚚 Frete grátis p/ Goiânia e região!

Condições: Pix, cartão ou dinheiro na entrega

👇 Comenta *"eu quero"* e garanta agora!`;

function userPrompt(dados: DadosTexto): string {
  return `Produto: ${dados.nome}
Preço especial: ${fmt(dados.precoDesconto)}
Parcelamento: 10x de ${fmt(dados.parcelamento)} sem juros

Gere a legenda seguindo exatamente o formato do sistema.`;
}

function fallbackTexto(dados: DadosTexto): string {
  return (
    `🔧 *${dados.nome}*\n\n` +
    `Ferramenta profissional de alta performance. Ideal para uso doméstico e industrial com eficiência e durabilidade.\n\n` +
    `💰 *Preço especial: ${fmt(dados.precoDesconto)}*\n` +
    `💳 10x de *${fmt(dados.parcelamento)}* sem juros\n` +
    `🚚 Frete grátis p/ Goiânia e região!\n\n` +
    `Condições: Pix, cartão ou dinheiro na entrega\n\n` +
    `👇 Comenta *"eu quero"* e garanta agora!`
  );
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
