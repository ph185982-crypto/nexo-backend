// DELETE /api/admin/api-keys/:id — revoga a chave (não apaga o registro, só
// marca revogadaEm; assim o histórico de uso continua rastreável).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  try {
    await prisma.apiKey.update({ where: { id }, data: { revogadaEm: new Date() } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Chave não encontrada" }, { status: 404 });
  }
}
