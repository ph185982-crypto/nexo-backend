import { NextRequest, NextResponse } from "next/server";
import { listTransactions, createTransaction, markTransactionPaid } from "@/lib/finance/repository";
import { prisma } from "@/lib/prisma/client";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const organizationId = url.searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });

  const transactions = await listTransactions(organizationId, {
    type: (url.searchParams.get("type") as "RECEITA" | "DESPESA") ?? undefined,
    status: (url.searchParams.get("status") as "PENDENTE" | "PAGO" | "VENCIDO" | "CANCELADO") ?? undefined,
    profileId: url.searchParams.get("profileId") ?? undefined,
    accountId: url.searchParams.get("accountId") ?? undefined,
    month: url.searchParams.get("month") ?? undefined,
    limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
  });
  return NextResponse.json(transactions);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    organizationId?: string;
    type?: string;
    amount?: number;
    description?: string;
    status?: string;
    dueDate?: string;
    paidAt?: string;
    profileId?: string;
    accountId?: string;
    categoryId?: string;
    competencia?: string;
    notes?: string;
    action?: "mark_paid";
    id?: string;
  };

  if (!body.organizationId) {
    return NextResponse.json({ error: "organizationId required" }, { status: 400 });
  }

  // Mark as paid action
  if (body.action === "mark_paid" && body.id) {
    const tx = await markTransactionPaid(body.id, body.paidAt ? new Date(body.paidAt) : new Date());
    return NextResponse.json(tx);
  }

  if (!body.type || !body.amount || !body.description) {
    return NextResponse.json({ error: "type, amount, description required" }, { status: 400 });
  }
  if (!["RECEITA", "DESPESA"].includes(body.type)) {
    return NextResponse.json({ error: "type must be RECEITA or DESPESA" }, { status: 400 });
  }

  const transaction = await createTransaction(body.organizationId, {
    type: body.type as "RECEITA" | "DESPESA",
    amount: body.amount,
    description: body.description,
    status: (body.status as "PENDENTE" | "PAGO") ?? "PENDENTE",
    dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
    paidAt: body.paidAt ? new Date(body.paidAt) : undefined,
    profileId: body.profileId,
    accountId: body.accountId,
    categoryId: body.categoryId,
    competencia: body.competencia,
    notes: body.notes,
  });
  return NextResponse.json(transaction, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.financialTransaction.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
