import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

function parseAIResponse(raw: string): { mensagens: string[]; delays: number[] } {
  const parts = raw.split(/---+\s*(\d+)s?\s*---+/);
  const mensagens: string[] = [];
  const delays: number[] = [];
  if (parts.length === 1) {
    raw.split(/\n{2,}/).forEach((p) => { if (p.trim()) { mensagens.push(p.trim()); delays.push(0); } });
  } else {
    mensagens.push(parts[0].trim());
    delays.push(0);
    for (let i = 1; i < parts.length; i += 2) {
      const delay = parseInt(parts[i] ?? "0", 10) * 1000;
      const txt = parts[i + 1]?.trim();
      if (txt) { mensagens.push(txt); delays.push(delay); }
    }
  }
  return { mensagens: mensagens.filter(Boolean), delays };
}

async function callLLM(systemPrompt: string, userMessage: string): Promise<string | null> {
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
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        max_tokens: 400,
      }),
    });
    if (res.ok) {
      const d = await res.json() as { content?: Array<{ text?: string }> };
      return d.content?.[0]?.text ?? null;
    }
  }
  if (process.env.GOOGLE_AI_API_KEY) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.9 },
      }),
    });
    if (res.ok) {
      const d = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      return d.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json() as { message: string };
    const config = await prisma.agentConfig.findFirst();
    if (!config) {
      return NextResponse.json({ error: "AgentConfig não encontrado" }, { status: 404 });
    }

    const raw = await callLLM(config.currentPrompt, message);
    if (!raw) {
      return NextResponse.json({ error: "LLM indisponível" }, { status: 503 });
    }

    const { mensagens, delays } = parseAIResponse(raw);
    // Strip internal flags before returning
    const clean = mensagens.map((m) =>
      m.replace(/\[PASSAGEM\]\s*\{[\s\S]*?\}/gi, "")
        .replace(/\[OPT_OUT\]/gi, "")
        .replace(/\[AGENDAR:[^\]]+\]/gi, "")
        .replace(/\[CEP_CLIENTE:[^\]]+\]/gi, "")
        .replace(/\[(FOTO|VIDEO)_[A-Z0-9_]+\]/gi, "")
        .trim()
    ).filter(Boolean);

    return NextResponse.json({ messages: clean, delays, rawFull: raw });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
