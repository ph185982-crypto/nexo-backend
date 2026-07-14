// Memória longa do Max: resume as conversas do dia em ContextoPedro
// (chave resumo-YYYY-MM-DD, mantém os últimos 7 dias). Como o prompt injeta
// toda a ContextoPedro, os resumos viram memória de longo prazo sem estourar tokens.

import { prisma } from "@/lib/prisma/client";
import { chatCompletion } from "../openai";
import { MAX_CHAT_MODEL, MAX_OWNER_NUMBER } from "../config";

export async function resumirDia(hojeStr: string): Promise<boolean> {
  const inicioDia = new Date(`${hojeStr}T00:00:00-03:00`);
  const fimDia = new Date(`${hojeStr}T23:59:59-03:00`);

  const conversas = await prisma.conversaMax.findMany({
    where: { numero: MAX_OWNER_NUMBER, criado_em: { gte: inicioDia, lte: fimDia } },
    orderBy: { criado_em: "asc" },
    select: { role: true, content: true },
  });

  if (conversas.length < 4) return false; // dia sem movimento relevante

  const transcript = conversas
    .map((c) => `${c.role === "user" ? "Pedro" : "Max"}: ${c.content.slice(0, 300)}`)
    .join("\n")
    .slice(0, 12_000);

  const result = await chatCompletion({
    model: MAX_CHAT_MODEL,
    messages: [
      {
        role: "system",
        content:
          "Resuma o dia de conversas entre Pedro e seu assistente Max em NO MAXIMO 500 caracteres. " +
          "Foque em: decisoes tomadas, valores financeiros relevantes, compromissos assumidos, " +
          "preferencias reveladas e pendencias. Formato: frases curtas separadas por ponto e virgula. " +
          "Sem introducao, sem markdown.",
      },
      { role: "user", content: transcript },
    ],
    max_tokens: 220,
  });

  const resumo = result.choices[0]?.message?.content?.trim();
  if (!resumo) return false;

  await prisma.contextoPedro.upsert({
    where:  { chave: `resumo-${hojeStr}` },
    update: { valor: resumo.slice(0, 600), categoria: "rotina" },
    create: { chave: `resumo-${hojeStr}`, valor: resumo.slice(0, 600), categoria: "rotina" },
  });

  // Retenção: mantém só os últimos 7 resumos diários
  const antigos = await prisma.contextoPedro.findMany({
    where: { chave: { startsWith: "resumo-" } },
    orderBy: { chave: "desc" },
    skip: 7,
    select: { chave: true },
  });
  if (antigos.length > 0) {
    await prisma.contextoPedro.deleteMany({
      where: { chave: { in: antigos.map((a) => a.chave) } },
    });
  }

  console.log(`[Memória] Resumo do dia ${hojeStr} salvo (${resumo.length} chars)`);
  return true;
}
