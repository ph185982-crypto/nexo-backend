import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

const CONFIGURATOR_SYSTEM_PROMPT = `Você é um especialista em configurar agentes de vendas por WhatsApp. Seu trabalho é conversar com Pedro, dono da Nexo Brasil, e ajudá-lo a ajustar o roteiro de atendimento do agente Pedro que atende os clientes dele.

Quando Pedro descrever algo que quer mudar, você deve:
1. Entender exatamente o que ele quer
2. Traduzir isso em uma instrução clara para o sistema
3. Mostrar como o agente vai se comportar após a mudança com um exemplo prático
4. Pedir confirmação antes de aplicar usando o formato: [CONFIRMAR_MUDANÇA: "descrição curta da mudança"]

Quando Pedro confirmar uma mudança, responda com o novo trecho de script no formato:
[APLICAR_SCRIPT_TRECHO]
<trecho do script corrigido aqui>
[FIM_TRECHO]

Quando Pedro pedir para adicionar um produto, colete: nome, preço à vista, preço parcelado, parcelas, principais benefícios.

Fale de forma simples e direta, sem termos técnicos. Pedro não é programador.
Quando precisar de mais informações, faça uma pergunta de cada vez.
Nunca aplique uma mudança sem mostrar o preview e pedir confirmação.
Use linguagem casual e amigável — "opa", "certo", "entendi", "legal".`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: NextRequest) {
  try {
    const { messages, agentId } = await req.json() as {
      messages: ChatMessage[];
      agentId?: string;
    };

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: "messages required" }, { status: 400 });
    }

    // Get current script for context
    let scriptContext = "";
    if (agentId) {
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { systemPrompt: true, displayName: true, aiProvider: true, aiModel: true },
      });
      if (agent?.systemPrompt) {
        scriptContext = `\n\nSCRIPT ATUAL DO AGENTE:\n\`\`\`\n${agent.systemPrompt.substring(0, 2000)}\n\`\`\``;
      }
    }

    const systemPrompt = CONFIGURATOR_SYSTEM_PROMPT + scriptContext;

    // Try OpenAI first, then Anthropic
    const history = messages.slice(0, -1);
    const lastMessage = messages[messages.length - 1].content;

    let response: string | null = null;

    if (process.env.OPENAI_API_KEY) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            ...history.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: lastMessage },
          ],
          max_tokens: 600,
          temperature: 0.7,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        response = data.choices?.[0]?.message?.content ?? null;
      }
    }

    if (!response && process.env.ANTHROPIC_API_KEY) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          system: systemPrompt,
          messages: [...history, { role: "user", content: lastMessage }],
          max_tokens: 600,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { content?: Array<{ text?: string }> };
        response = data.content?.[0]?.text ?? null;
      }
    }

    if (!response) {
      return NextResponse.json({ error: "LLM indisponível" }, { status: 503 });
    }

    return NextResponse.json({ response });
  } catch (e) {
    console.error("[agent-config/chat]", e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
