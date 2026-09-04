import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

// GET /api/prospeccao/disparo-config/:organizationId
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await params;
  let config = await prisma.disparoConfig.findUnique({ where: { organizationId } });
  if (!config) {
    config = await prisma.disparoConfig.create({ data: { organizationId } });
  }
  return NextResponse.json(config);
}

// PATCH /api/prospeccao/disparo-config/:organizationId
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await params;
  const body = await req.json() as Partial<{
    limiteDiarioAtual: number;
    incrementoSemanal: number;
    limiteMaximoDiario: number;
    janelaInicioHora: number;
    janelaFimHora: number;
    diasSemana: number[];
    pausadoManualmente: boolean;
    motivoPausa: string | null;
    diasEntreTentativas: number;
    maxTentativasContato: number;
  }>;

  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

  const data: Record<string, unknown> = {};
  if (body.limiteDiarioAtual   !== undefined) data.limiteDiarioAtual   = clamp(body.limiteDiarioAtual, 1, 250);
  if (body.incrementoSemanal   !== undefined) data.incrementoSemanal   = clamp(body.incrementoSemanal, 0, 50);
  if (body.limiteMaximoDiario  !== undefined) data.limiteMaximoDiario  = clamp(body.limiteMaximoDiario, 1, 250);
  if (body.janelaInicioHora    !== undefined) data.janelaInicioHora    = clamp(body.janelaInicioHora, 0, 23);
  if (body.janelaFimHora       !== undefined) data.janelaFimHora       = clamp(body.janelaFimHora, 1, 24);
  if (body.diasSemana          !== undefined) data.diasSemana          = body.diasSemana.filter((d) => d >= 0 && d <= 6);
  if (body.pausadoManualmente  !== undefined) data.pausadoManualmente  = body.pausadoManualmente;
  if (body.motivoPausa         !== undefined) data.motivoPausa         = body.motivoPausa;
  if (body.diasEntreTentativas !== undefined) data.diasEntreTentativas = clamp(body.diasEntreTentativas, 1, 30);
  if (body.maxTentativasContato !== undefined) data.maxTentativasContato = clamp(body.maxTentativasContato, 1, 5);

  const config = await prisma.disparoConfig.upsert({
    where:  { organizationId },
    update: data,
    create: { organizationId, ...data },
  });

  return NextResponse.json(config);
}
