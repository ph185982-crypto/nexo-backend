// GET  /api/admin/api-keys — lista as chaves (sem o valor, só metadados)
// POST /api/admin/api-keys — cria uma chave nova; a chave em texto puro só
//      aparece nesta resposta, uma vez.
//
// Cada chave dá acesso total de ADMIN à API GraphQL e à API de Prospecção —
// pensado para conectar o sistema a ferramentas externas (o MCP server deste
// repo, outro agente de IA, uma automação).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";
import { gerarChaveApi } from "@/lib/auth/api-key";

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const chaves = await prisma.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, nome: true, prefixo: true, ultimoUsoEm: true, revogadaEm: true, createdAt: true },
  });
  return NextResponse.json(chaves);
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as { nome?: string };
  const nome = (body.nome ?? "").trim() || "Sem nome";

  const { chave, prefixo, hash } = gerarChaveApi();
  const registro = await prisma.apiKey.create({
    data: { nome, prefixo, hash },
    select: { id: true, nome: true, prefixo: true, createdAt: true },
  });

  // A única vez que o valor completo é devolvido — o front avisa o usuário
  // pra copiar agora, porque depois só o prefixo fica visível.
  return NextResponse.json({ ...registro, chave }, { status: 201 });
}
