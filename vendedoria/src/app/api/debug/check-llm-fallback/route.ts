import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { callAnthropic, callGemini, callOpenAI } from "@/lib/ai/llm-client";

/**
 * TEMPORARY — diagnóstico read-only: testa cada provider de LLM com um
 * prompt trivial pra saber quais chaves existem e funcionam de verdade,
 * sem tocar em nenhuma conversa real de cliente. DELETE após o uso.
 */
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const prompt = "Responda apenas com a palavra: ok";
  const [openai, anthropic, gemini] = await Promise.all([
    process.env.OPENAI_API_KEY
      ? callOpenAI("Você é um teste.", [], prompt, "gpt-4o-mini", { maxTokens: 5 }).then((r) => ({ configured: true, ok: !!r, resposta: r }))
      : Promise.resolve({ configured: false, ok: false, resposta: null }),
    process.env.ANTHROPIC_API_KEY
      ? callAnthropic("Você é um teste.", [], prompt, "claude-haiku-4-5-20251001", { maxTokens: 5 }).then((r) => ({ configured: true, ok: !!r, resposta: r }))
      : Promise.resolve({ configured: false, ok: false, resposta: null }),
    process.env.GOOGLE_AI_API_KEY
      ? callGemini("Você é um teste.", [], prompt, "gemini-2.0-flash-lite", { maxTokens: 5 }).then((r) => ({ configured: true, ok: !!r, resposta: r }))
      : Promise.resolve({ configured: false, ok: false, resposta: null }),
  ]);

  return NextResponse.json({ openai, anthropic, gemini });
}
