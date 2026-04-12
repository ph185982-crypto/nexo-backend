import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

const CONFIGURADORA_PROMPT = `Você é especialista em configurar agentes de vendas por WhatsApp.
Ajuda Pedro a ajustar o roteiro do agente Léo da Nexo Brasil em Goiânia.

Quando Pedro descrever uma mudança:
1. Entenda o que ele quer
2. Mostre APENAS o trecho afetado — antes e depois
3. Explique em uma linha o impacto
4. Pergunte: "Posso aplicar essa mudança?"
5. Se Pedro confirmar com "sim", "pode", "aplica" ou similar:
   Responda com o prompt completo atualizado entre as tags:
   [APLICAR_PATCH:inicio]
   [conteúdo completo do novo prompt aqui]
   [APLICAR_PATCH:fim]

Regras:
- Fale em português simples, sem jargão técnico
- Faça uma pergunta por vez
- Nunca aplique mudança sem confirmação
- Nunca mostre o prompt inteiro — só o trecho relevante
- Contexto: agente vende Bomvink 21V (R$549,99) e Luatek 48V (R$529,99), entrega Goiânia e região, pagamento na entrega`;

async function callClaude(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
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
      messages: [...history, { role: "user", content: userMessage }],
      max_tokens: 800,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const { message, history = [] } = await req.json() as {
      message: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
    };

    // Fetch current prompt to include as context
    const config = await prisma.agentConfig.findFirst();
    const promptContext = config
      ? `\n\nPrompt atual do agente (v${config.promptVersion}):\n---\n${config.currentPrompt}\n---`
      : "";

    const systemWithContext = CONFIGURADORA_PROMPT + promptContext;
    const response = await callClaude(systemWithContext, history, message);
    if (!response) {
      return NextResponse.json({ error: "LLM indisponível" }, { status: 503 });
    }

    // Check for patch tag
    const patchMatch = response.match(/\[APLICAR_PATCH:inicio\]([\s\S]*?)\[APLICAR_PATCH:fim\]/i);
    let patchAplicado = false;
    let newVersion: number | undefined;

    if (patchMatch && config) {
      const newContent = patchMatch[1].trim();
      // Save current to history
      await prisma.agentPromptHistory.create({
        data: {
          content: config.currentPrompt,
          version: config.promptVersion,
          savedBy: "configuradora-ia",
        },
      });
      const updated = await prisma.agentConfig.update({
        where: { id: config.id },
        data: {
          currentPrompt: newContent,
          promptVersion: config.promptVersion + 1,
        },
      });
      patchAplicado = true;
      newVersion = updated.promptVersion;
    }

    return NextResponse.json({ response, patchAplicado, newVersion });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
