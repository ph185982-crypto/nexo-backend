import { NextRequest, NextResponse } from "next/server";
import {
  listInstallmentPlans,
  createInstallmentPlan,
  createTransaction,
  incrementInstallmentPaid,
} from "@/lib/finance/repository";
import { prisma } from "@/lib/prisma/client";

export async function GET(req: NextRequest) {
  const organizationId = new URL(req.url).searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });
  const plans = await listInstallmentPlans(organizationId);
  return NextResponse.json(plans);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    organizationId?: string;
    name?: string;
    totalAmount?: number;
    installmentCount?: number;
    installmentValue?: number;
    competenciaStart?: string;
    profileId?: string;
    accountId?: string;
    action?: "pay_installment";
    id?: string;
    competencia?: string;
  };
  if (!body.organizationId) {
    return NextResponse.json({ error: "organizationId required" }, { status: 400 });
  }

  // Pay one installment action
  if (body.action === "pay_installment" && body.id) {
    const plan = await prisma.installmentPlan.findUnique({ where: { id: body.id } });
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

    const [tx] = await Promise.all([
      createTransaction(body.organizationId, {
        type: "DESPESA",
        amount: plan.installmentValue,
        description: `${plan.name} — Parcela ${plan.paidCount + 1}/${plan.installmentCount}`,
        status: "PAGO",
        paidAt: new Date(),
        installmentPlanId: plan.id,
        installmentNumber: plan.paidCount + 1,
        competencia: body.competencia,
        accountId: plan.accountId ?? undefined,
        profileId: plan.profileId ?? undefined,
      }),
      incrementInstallmentPaid(body.id),
    ]);

    const updated = await prisma.installmentPlan.findUnique({ where: { id: body.id } });
    if (updated && updated.paidCount >= updated.installmentCount) {
      await prisma.installmentPlan.update({ where: { id: body.id }, data: { isActive: false } });
    }

    return NextResponse.json({ transaction: tx, plan: updated });
  }

  if (!body.name || !body.totalAmount || !body.installmentCount || !body.installmentValue || !body.competenciaStart) {
    return NextResponse.json({ error: "name, totalAmount, installmentCount, installmentValue, competenciaStart required" }, { status: 400 });
  }
  const plan = await createInstallmentPlan(body.organizationId, {
    name: body.name,
    totalAmount: body.totalAmount,
    installmentCount: body.installmentCount,
    installmentValue: body.installmentValue,
    competenciaStart: body.competenciaStart,
    profileId: body.profileId,
    accountId: body.accountId,
  });
  return NextResponse.json(plan, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.installmentPlan.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ success: true });
}
