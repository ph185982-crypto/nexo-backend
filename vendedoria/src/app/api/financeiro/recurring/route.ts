import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listRecurringBills, createRecurringBill } from "@/lib/finance/repository";
import { prisma } from "@/lib/prisma/client";

export async function GET(req: NextRequest) {
  const __session = await auth();
  if (!__session?.user || (__session.user as { role?: string }).role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const organizationId = new URL(req.url).searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });
  const bills = await listRecurringBills(organizationId);
  return NextResponse.json(bills);
}

export async function POST(req: NextRequest) {
  const __session = await auth();
  if (!__session?.user || (__session.user as { role?: string }).role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json() as {
    organizationId?: string;
    name?: string;
    amount?: number;
    dueDay?: number;
    profileId?: string;
    categoryId?: string;
    startDate?: string;
    endDate?: string;
  };
  if (!body.organizationId || !body.name || !body.amount || !body.dueDay) {
    return NextResponse.json({ error: "organizationId, name, amount, dueDay required" }, { status: 400 });
  }
  const bill = await createRecurringBill(body.organizationId, {
    name: body.name,
    amount: body.amount,
    dueDay: body.dueDay,
    profileId: body.profileId,
    categoryId: body.categoryId,
    startDate: body.startDate ? new Date(body.startDate) : undefined,
    endDate: body.endDate ? new Date(body.endDate) : undefined,
  });
  return NextResponse.json(bill, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const __session = await auth();
  if (!__session?.user || (__session.user as { role?: string }).role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.recurringBill.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ success: true });
}
