// GET /api/max/health — diagnóstico aberto do Max (testa o provedor de IA + último erro real)
// Somente leitura + um teste barato (max_tokens 5). Rota pública: nunca devolve chave, nem prefixo.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { chatCompletion } from "@/lib/max/openai";
import { deepseekAtivo } from "@/lib/ai/deepseek";

export async function GET() {
  const out: Record<string, unknown> = {};

  // Fonte da chave OpenAI (mascarada)
  const cred = await prisma.integrationCredential.findUnique({
    where: { provider: "OPENAI" }, select: { refreshToken: true },
  }).catch(() => null);
  const envKey = process.env.OPENAI_API_KEY;
  const key = cred?.refreshToken ?? envKey;
  out.chaveOpenAI = { fonte: cred?.refreshToken ? "banco" : envKey ? "env" : "AUSENTE", configurada: Boolean(key) };
  out.provedorDoMax = deepseekAtivo() ? "deepseek" : "openai";

  // Último erro real registrado pelo Max
  const erro = await prisma.contextoPedro.findUnique({
    where: { chave: "max-ultimo-erro" }, select: { valor: true, atualizado_em: true },
  }).catch(() => null);
  out.ultimoErroMax = erro ? { erro: erro.valor, quando: erro.atualizado_em } : null;

  // Teste direto do OpenAI (revela chave inválida / quota / rate limit)
  try {
    const r = await chatCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "responda só: ok" }],
      max_tokens: 5,
    });
    out.testeIA = { ok: true, resposta: r.choices[0]?.message?.content ?? "(vazio)" };
  } catch (e) {
    out.testeIA = { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(out);
}
