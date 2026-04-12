import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const leadWithTags = await prisma.lead.findUnique({
    where: { id },
    include: { tags: { include: { tag: true } } },
  });
  return NextResponse.json(leadWithTags?.tags ?? []);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { name, color = "#6B7280" } = await req.json() as { name: string; color?: string };
    if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });

    // Find or create a Tag with this name
    let tag = await prisma.tag.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
    if (!tag) {
      tag = await prisma.tag.create({ data: { name, color, kind: "CUSTOM" } });
    }

    // Link to lead (upsert to avoid duplicates)
    await prisma.leadTag.upsert({
      where: { leadId_tagId: { leadId: id, tagId: tag.id } },
      update: {},
      create: { leadId: id, tagId: tag.id },
    });

    return NextResponse.json({ leadId: id, tag });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
