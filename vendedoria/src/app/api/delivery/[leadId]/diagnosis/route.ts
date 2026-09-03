import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { auth } from "@/lib/auth";

type Params = { params: Promise<{ leadId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { leadId } = await params;
  const diagnosis = await prisma.clientDiagnosis.findUnique({
    where: { leadId },
    include: { cards: { orderBy: [{ column: "asc" }, { order: "asc" }] } },
  });

  return NextResponse.json({ diagnosis });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { leadId } = await params;

  const existing = await prisma.clientDiagnosis.findUnique({ where: { leadId } });
  if (existing) return NextResponse.json({ diagnosis: existing });

  const diagnosis = await prisma.clientDiagnosis.create({
    data: { leadId },
  });

  return NextResponse.json({ diagnosis }, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { leadId } = await params;
  const body = await req.json();

  const existing = await prisma.clientDiagnosis.findUnique({ where: { leadId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.isFinalized) return NextResponse.json({ error: "Diagnosis already finalized" }, { status: 400 });

  const {
    comercialData, produtoData, marketingData,
    operacaoData, financeiroData, priorizacaoData,
    finalize,
  } = body;

  const updateData: Record<string, unknown> = {};
  if (comercialData !== undefined) updateData.comercialData = comercialData;
  if (produtoData !== undefined) updateData.produtoData = produtoData;
  if (marketingData !== undefined) updateData.marketingData = marketingData;
  if (operacaoData !== undefined) updateData.operacaoData = operacaoData;
  if (financeiroData !== undefined) updateData.financeiroData = financeiroData;
  if (priorizacaoData !== undefined) updateData.priorizacaoData = priorizacaoData;

  if (finalize) {
    updateData.isFinalized = true;
    updateData.finalizedAt = new Date();
  }

  const diagnosis = await prisma.clientDiagnosis.update({
    where: { leadId },
    data: updateData,
  });

  // Auto-generate Backlog cards from Block 6 priorização items
  if (finalize && Array.isArray(priorizacaoData ?? existing.priorizacaoData)) {
    const items = (priorizacaoData ?? existing.priorizacaoData) as Array<{
      pilar: string; acao: string; dataAlvo?: string; responsavel: string;
    }>;
    if (items.length > 0) {
      await prisma.deliveryCard.deleteMany({
        where: { diagnosisId: diagnosis.id, column: "BACKLOG" },
      });
      await prisma.deliveryCard.createMany({
        data: items.map((item, i) => ({
          diagnosisId: diagnosis.id,
          title: item.acao || `Prioridade ${i + 1}`,
          pilar: item.pilar || "COMERCIAL",
          dataAlvo: item.dataAlvo ? new Date(item.dataAlvo) : null,
          responsavel: item.responsavel || "PEDRO",
          column: "BACKLOG",
          order: i,
        })),
      });
    }
  }

  const updated = await prisma.clientDiagnosis.findUnique({
    where: { leadId },
    include: { cards: { orderBy: [{ column: "asc" }, { order: "asc" }] } },
  });

  return NextResponse.json({ diagnosis: updated });
}
