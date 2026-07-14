import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listAccounts, createAccount } from "@/lib/finance/repository";

export async function GET(req: NextRequest) {
  const __session = await auth();
  if (!__session?.user || (__session.user as { role?: string }).role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const organizationId = new URL(req.url).searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });
  const accounts = await listAccounts(organizationId);
  return NextResponse.json(accounts);
}

export async function POST(req: NextRequest) {
  const __session = await auth();
  if (!__session?.user || (__session.user as { role?: string }).role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json() as {
    organizationId?: string;
    name?: string;
    accountType?: string;
    profileId?: string;
    balance?: number;
    creditLimit?: number;
    closingDay?: number;
    dueDay?: number;
    color?: string;
    icon?: string;
  };
  if (!body.organizationId || !body.name || !body.accountType) {
    return NextResponse.json({ error: "organizationId, name, accountType required" }, { status: 400 });
  }
  const account = await createAccount(body.organizationId, {
    name: body.name,
    accountType: body.accountType,
    profileId: body.profileId,
    balance: body.balance,
    creditLimit: body.creditLimit,
    closingDay: body.closingDay,
    dueDay: body.dueDay,
    color: body.color,
    icon: body.icon,
  });
  return NextResponse.json(account, { status: 201 });
}
