import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const notes = await prisma.leadNote.findMany({
    where: { leadId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(notes);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { content } = await req.json() as { content: string };
    if (!content?.trim()) {
      return NextResponse.json({ error: "content required" }, { status: 400 });
    }
    const note = await prisma.leadNote.create({ data: { leadId: id, content } });
    return NextResponse.json(note);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
