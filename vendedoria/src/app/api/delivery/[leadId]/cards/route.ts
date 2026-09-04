import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { auth } from "@/lib/auth";

type Params = { params: Promise<{ leadId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { leadId } = await params;
  const diagnosis = await prisma.clientDiagnosis.findUnique({ where: { leadId } });
  if (!diagnosis) return NextResponse.json({ cards: [] });

  const cards = await prisma.deliveryCard.findMany({
    where: { diagnosisId: diagnosis.id },
    orderBy: [{ column: "asc" }, { order: "asc" }],
  });

  return NextResponse.json({ cards });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { leadId } = await params;
  const diagnosis = await prisma.clientDiagnosis.findUnique({ where: { leadId } });
  if (!diagnosis) return NextResponse.json({ error: "Diagnosis not found" }, { status: 404 });

  const body = await req.json();
  const { title, description, pilar, dataAlvo, responsavel, column } = body;

  const lastInColumn = await prisma.deliveryCard.findFirst({
    where: { diagnosisId: diagnosis.id, column: column ?? "BACKLOG" },
    orderBy: { order: "desc" },
  });

  const card = await prisma.deliveryCard.create({
    data: {
      diagnosisId: diagnosis.id,
      title: title || "Novo card",
      description,
      pilar: pilar || "COMERCIAL",
      dataAlvo: dataAlvo ? new Date(dataAlvo) : null,
      responsavel: responsavel || "PEDRO",
      column: column || "BACKLOG",
      order: (lastInColumn?.order ?? -1) + 1,
    },
  });

  return NextResponse.json({ card }, { status: 201 });
}
