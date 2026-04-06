import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function POST(req: NextRequest) {
  try {
    const { agentId, message, customScript } = await req.json() as {
      agentId: string;
      message: string;
      customScript?: string;
    };

    if (!agentId || !message) {
      return NextResponse.json({ error: "agentId and message required" }, { status: 400 });
    }

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { systemPrompt: true, aiProvider: true, aiModel: true },
    });

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const scriptToTest = customScript ?? agent.systemPrompt ?? "";

    // Add test suffix so agent returns JSON + explanation of which rule triggered
    const testSystemPrompt = scriptToTest + `

--- MODO DE TESTE ---
Você está em modo de teste. Responda normalmente em JSON {"mensagens": [], "delays": []} como faria com um cliente real.
Após o JSON, adicione uma linha separada: REGRA_ATIVADA: <descreva em 1 linha qual parte do script foi usada para gerar essa resposta>
--- FIM MODO DE TESTE ---`;

    let rawResponse: string | null = null;
    const provider = (agent.aiProvider ?? "OPENAI").toUpperCase();

    if (provider === "OPENAI" && process.env.OPENAI_API_KEY) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: agent.aiModel ?? "gpt-4o-mini",
          messages: [
            { role: "system", content: testSystemPrompt },
            { role: "user", content: message },
          ],
          max_tokens: 500,
          temperature: 0.9,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        rawResponse = data.choices?.[0]?.message?.content ?? null;
      }
    }

    if (!rawResponse && process.env.OPENAI_API_KEY) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: testSystemPrompt },
            { role: "user", content: message },
          ],
          max_tokens: 500,
          temperature: 0.9,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        rawResponse = data.choices?.[0]?.message?.content ?? null;
      }
    }

    if (!rawResponse && process.env.ANTHROPIC_API_KEY) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          system: testSystemPrompt,
          messages: [{ role: "user", content: message }],
          max_tokens: 500,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { content?: Array<{ text?: string }> };
        rawResponse = data.content?.[0]?.text ?? null;
      }
    }

    if (!rawResponse) {
      return NextResponse.json({ error: "LLM indisponível" }, { status: 503 });
    }

    // Split response and rule
    const ruleMatch = rawResponse.match(/REGRA_ATIVADA:\s*(.+)/);
    const ruleActivated = ruleMatch?.[1]?.trim() ?? null;
    const ruleIdx = rawResponse.indexOf("REGRA_ATIVADA:");
    const jsonPart = (ruleIdx > -1 ? rawResponse.substring(0, ruleIdx) : rawResponse).trim();

    // Parse balloons
    let balloons: string[] = [];
    try {
      const stripped = jsonPart.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      const parsed = JSON.parse(stripped) as { mensagens?: string[] };
      if (Array.isArray(parsed.mensagens)) {
        balloons = parsed.mensagens
          .map((m: string) => m.trim())
          .filter((m: string) =>
            Boolean(m) &&
            !/^\[(FOTO|VIDEO|PASSAGEM|OPT_OUT|ESCALAR)/i.test(m)
          );
      }
    } catch {
      balloons = [jsonPart];
    }

    return NextResponse.json({ balloons, ruleActivated, raw: rawResponse });
  } catch (e) {
    console.error("[agent-config/test]", e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
