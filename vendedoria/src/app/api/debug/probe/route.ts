/**
 * TEMPORARY — REMOVE AFTER USE
 * Testa Gemini diretamente + mostra estado do banco
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET() {
  // 1. Estado do banco
  const [leads, messages] = await Promise.all([prisma.lead.count(), prisma.whatsappMessage.count()]);
  const lastMessages = await prisma.whatsappMessage.findMany({
    orderBy: { sentAt: "desc" }, take: 3,
    select: { role: true, content: true, sentAt: true },
  });

  // 2. Teste direto Gemini
  let geminiResult: string | null = null;
  let geminiError: string | null = null;
  const apiKey = process.env.GOOGLE_AI_API_KEY;

  if (apiKey) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: "Responda apenas: FUNCIONANDO" }] }],
          }),
        }
      );
      const data = await r.json() as any;
      if (r.ok) {
        geminiResult = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "resposta vazia";
      } else {
        geminiError = `HTTP ${r.status}: ${JSON.stringify(data)}`;
      }
    } catch (e) {
      geminiError = String(e);
    }
  } else {
    geminiError = "GOOGLE_AI_API_KEY não definida";
  }

  return NextResponse.json({
    db: { leads, messages, lastMessages },
    gemini: { ok: !!geminiResult, result: geminiResult, error: geminiError },
  });
}
