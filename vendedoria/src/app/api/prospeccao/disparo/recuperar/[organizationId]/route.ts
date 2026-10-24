// GET  /api/prospeccao/disparo/recuperar/:orgId — quantos leads estão marcados
//      como abordados mas NUNCA receberam a mensagem (falha da conta na Meta).
// POST — devolve esses leads para a fila (APROVADO, tentativas zeradas).

import { NextRequest, NextResponse } from "next/server";
import { exigirAcesso } from "@/lib/prospeccao/guard";
import { recuperarLeadsNaoEntregues } from "@/lib/prospeccao/entrega";

export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ organizationId: string }> }) {
  const negado = await exigirAcesso(req);
  if (negado) return negado;
  const { organizationId } = await params;
  return NextResponse.json(await recuperarLeadsNaoEntregues(organizationId, false));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ organizationId: string }> }) {
  const negado = await exigirAcesso(req);
  if (negado) return negado;
  const { organizationId } = await params;
  return NextResponse.json(await recuperarLeadsNaoEntregues(organizationId, true));
}
