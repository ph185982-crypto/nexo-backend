// GET /api/max/diag — diagnóstico do agente Max (requer Bearer CRON_SECRET)
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { chatCompletion } from "@/lib/max/openai";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  // Check each Max table
  const tables = [
    { name: "transacao", fn: () => prisma.transacao.count() },
    { name: "conversaMax", fn: () => prisma.conversaMax.count() },
    { name: "contextoPedro", fn: () => prisma.contextoPedro.count() },
    { name: "lembreteMax", fn: () => prisma.lembreteMax.count() },
    { name: "dividaMax", fn: () => prisma.dividaMax.count() },
    { name: "metaFinanceiraMax", fn: () => prisma.metaFinanceiraMax.count() },
    { name: "receitaPrevistaMax", fn: () => prisma.receitaPrevistaMax.count() },
    { name: "tarefaMax", fn: () => prisma.tarefaMax.count() },
    { name: "alertaEnviadoMax", fn: () => prisma.alertaEnviadoMax.count() },
    { name: "contaPagarMax", fn: () => prisma.contaPagarMax.count() },
    { name: "orcamentoMax", fn: () => prisma.orcamentoMax.count() },
    { name: "webhookEventMax", fn: () => prisma.webhookEventMax.count() },
  ];

  for (const t of tables) {
    try {
      results[t.name] = await t.fn();
    } catch (e) {
      results[t.name] = `ERRO: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // Test OpenAI
  try {
    const r = await chatCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "responda só: ok" }],
      max_tokens: 5,
    });
    results["openai"] = r.choices[0]?.message?.content ?? "sem resposta";
  } catch (e) {
    results["openai"] = `ERRO: ${e instanceof Error ? e.message : String(e)}`;
  }

  return NextResponse.json(results);
}
