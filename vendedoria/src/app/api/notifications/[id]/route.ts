import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";

// PATCH { read: boolean } — marca uma notificação como tratada (ou reabre).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { read?: boolean };
  const n = await prisma.ownerNotification.update({ where: { id }, data: { read: body.read ?? true } }).catch(() => null);
  if (!n) return NextResponse.json({ error: "não encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true, id: n.id, read: n.read });
}
