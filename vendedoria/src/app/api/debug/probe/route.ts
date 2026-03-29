/**
 * TEMPORARY — REMOVE AFTER USE
 * Testa OpenAI/Gemini diretamente + mostra estado do banco
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const testKey = url.searchParams.get("testkey");
  const openaiKey = url.searchParams.get("openaikey");

  // Test OpenAI if key provided
  let openaiResult: string | null = null;
  let openaiError: string | null = null;
  const oKey = openaiKey ?? process.env.OPENAI_API_KEY;
  if (oKey) {
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${oKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 20,
          messages: [{ role: "user", content: "Responda apenas: FUNCIONANDO" }],
        }),
      });
      const data = await r.json() as any;
      if (r.ok) openaiResult = data.choices?.[0]?.message?.content ?? "vazio";
      else openaiError = `HTTP ${r.status}: ${JSON.stringify(data).slice(0, 200)}`;
    } catch (e) { openaiError = String(e); }
  }

  // Test Gemini
  const apiKey = testKey ?? process.env.GOOGLE_AI_API_KEY;
  let geminiResult: string | null = null;
  let geminiError: string | null = null;
  if (apiKey) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Responda apenas: OK" }] }] }) }
      );
      const data = await r.json() as any;
      if (r.ok) geminiResult = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "vazio";
      else geminiError = `HTTP ${r.status}: ${JSON.stringify(data).slice(0, 100)}`;
    } catch (e) { geminiError = String(e); }
  }

  const [leads, messages] = await Promise.all([prisma.lead.count(), prisma.whatsappMessage.count()]);
  const lastMessages = await prisma.whatsappMessage.findMany({
    orderBy: { sentAt: "desc" }, take: 3,
    select: { role: true, content: true, sentAt: true },
  });

  return NextResponse.json({
    db: { leads, messages, lastMessages },
    openai: { ok: !!openaiResult, result: openaiResult, error: openaiError },
    gemini: { ok: !!geminiResult, result: geminiResult, error: geminiError },
  });
}
