import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { auth } from "@/lib/auth";

type Params = { params: Promise<{ leadId: string; cardId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { cardId } = await params;
  const body = await req.json();
  const { title, description, pilar, dataAlvo, responsavel, column, order } = body;

  const updateData: Record<string, unknown> = {};
  if (title !== undefined) updateData.title = title;
  if (description !== undefined) updateData.description = description;
  if (pilar !== undefined) updateData.pilar = pilar;
  if (dataAlvo !== undefined) updateData.dataAlvo = dataAlvo ? new Date(dataAlvo) : null;
  if (responsavel !== undefined) updateData.responsavel = responsavel;
  if (column !== undefined) updateData.column = column;
  if (order !== undefined) updateData.order = order;

  const card = await prisma.deliveryCard.update({
    where: { id: cardId },
    data: updateData,
  });

  return NextResponse.json({ card });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { cardId } = await params;
  await prisma.deliveryCard.delete({ where: { id: cardId } });

  return NextResponse.json({ ok: true });
}
