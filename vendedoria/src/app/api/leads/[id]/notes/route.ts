import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { auth } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await auth())?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const { content } = await req.json() as { content: string };
    if (!content?.trim()) {
      return NextResponse.json({ error: "content required" }, { status: 400 });
    }
    const note = await prisma.leadNote.create({
      data: {
        leadId: id,
        content: content.trim(),
        createdBy: session.user.name ?? session.user.email ?? undefined,
      },
    });
    return NextResponse.json(note);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
