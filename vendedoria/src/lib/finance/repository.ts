import { prisma } from "@/lib/prisma/client";

export type TransactionType = "RECEITA" | "DESPESA";
export type TransactionStatus = "PENDENTE" | "PAGO" | "VENCIDO" | "CANCELADO";
export type PersonType = "PESSOA_FISICA" | "PESSOA_JURIDICA";

// ─── Financial Overview ────────────────────────────────────────────────────────

export async function getFinancialOverview(organizationId: string) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const [receitas, despesas, pendentes, vencidas, installments, recurring] = await Promise.all([
    // Receitas pagas no mês
    prisma.financialTransaction.aggregate({
      where: { organizationId, type: "RECEITA", status: "PAGO", paidAt: { gte: startOfMonth, lte: endOfMonth } },
      _sum: { amount: true },
    }),
    // Despesas pagas no mês
    prisma.financialTransaction.aggregate({
      where: { organizationId, type: "DESPESA", status: "PAGO", paidAt: { gte: startOfMonth, lte: endOfMonth } },
      _sum: { amount: true },
    }),
    // A vencer (pendentes com dueDate futura)
    prisma.financialTransaction.aggregate({
      where: { organizationId, status: "PENDENTE", dueDate: { gt: now } },
      _sum: { amount: true },
      _count: true,
    }),
    // Vencidas (pendentes com dueDate passada)
    prisma.financialTransaction.aggregate({
      where: { organizationId, status: "PENDENTE", dueDate: { lt: now } },
      _sum: { amount: true },
      _count: true,
    }),
    // Planos de parcelamento ativos
    prisma.installmentPlan.findMany({
      where: { organizationId, isActive: true },
      select: { name: true, installmentValue: true, installmentCount: true, paidCount: true, competenciaStart: true },
    }),
    // Contas recorrentes ativas
    prisma.recurringBill.findMany({
      where: { organizationId, isActive: true },
      select: { name: true, amount: true, dueDay: true },
    }),
  ]);

  const totalReceitas = receitas._sum.amount ?? 0;
  const totalDespesas = despesas._sum.amount ?? 0;
  const saldoMes = totalReceitas - totalDespesas;
  const totalPendentes = pendentes._sum.amount ?? 0;
  const totalVencidas = vencidas._sum.amount ?? 0;
  const totalRecorrentes = recurring.reduce((acc, r) => acc + r.amount, 0);
  const totalParcelamentos = installments.reduce((acc, i) => {
    const remaining = i.installmentCount - i.paidCount;
    return acc + (remaining > 0 ? i.installmentValue : 0);
  }, 0);

  return {
    mes: `${now.toLocaleString("pt-BR", { month: "long" })}/${now.getFullYear()}`,
    totalReceitas,
    totalDespesas,
    saldoMes,
    totalPendentes,
    totalVencidas,
    qtdVencidas: vencidas._count,
    totalRecorrentes,
    totalParcelamentos,
    installments: installments.map((i) => ({
      ...i,
      remaining: i.installmentCount - i.paidCount,
      valorRestante: (i.installmentCount - i.paidCount) * i.installmentValue,
    })),
    recurring,
  };
}

// ─── Profiles ─────────────────────────────────────────────────────────────────

export async function listProfiles(organizationId: string) {
  return prisma.financialProfile.findMany({
    where: { organizationId },
    include: {
      accounts: { where: { isActive: true }, select: { id: true, name: true, accountType: true, balance: true } },
      _count: { select: { transactions: true, recurringBills: true, installmentPlans: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function createProfile(organizationId: string, data: {
  name: string;
  personType: PersonType;
  cpfCnpj?: string;
}) {
  return prisma.financialProfile.create({ data: { organizationId, ...data } });
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

export async function listAccounts(organizationId: string) {
  return prisma.financialAccount.findMany({
    where: { organizationId, isActive: true },
    include: {
      profile: { select: { id: true, name: true, personType: true } },
      _count: { select: { transactions: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function findAccountByName(organizationId: string, name: string) {
  return prisma.financialAccount.findFirst({
    where: { organizationId, name: { contains: name, mode: "insensitive" }, isActive: true },
  });
}

export async function createAccount(organizationId: string, data: {
  name: string;
  accountType: string;
  profileId?: string;
  balance?: number;
  creditLimit?: number;
  closingDay?: number;
  dueDay?: number;
  color?: string;
  icon?: string;
}) {
  return prisma.financialAccount.create({ data: { organizationId, ...data } });
}

// ─── Categories ───────────────────────────────────────────────────────────────

export async function listCategories(organizationId: string) {
  return prisma.financialCategory.findMany({
    where: { organizationId },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
}

export async function findCategoryByName(organizationId: string, name: string) {
  return prisma.financialCategory.findFirst({
    where: { organizationId, name: { contains: name, mode: "insensitive" } },
  });
}

export async function createCategory(organizationId: string, data: {
  name: string;
  type: TransactionType;
  icon?: string;
  color?: string;
}) {
  return prisma.financialCategory.create({ data: { organizationId, ...data } });
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export async function listTransactions(organizationId: string, filters?: {
  type?: TransactionType;
  status?: TransactionStatus;
  profileId?: string;
  accountId?: string;
  month?: string; // "2025-05"
  limit?: number;
}) {
  const where: Record<string, unknown> = { organizationId };
  if (filters?.type) where.type = filters.type;
  if (filters?.status) where.status = filters.status;
  if (filters?.profileId) where.profileId = filters.profileId;
  if (filters?.accountId) where.accountId = filters.accountId;
  if (filters?.month) {
    const [year, month] = filters.month.split("-").map(Number);
    where.createdAt = {
      gte: new Date(year, month - 1, 1),
      lt: new Date(year, month, 1),
    };
  }

  return prisma.financialTransaction.findMany({
    where,
    include: {
      profile: { select: { name: true, personType: true } },
      account: { select: { name: true, accountType: true } },
      category: { select: { name: true, icon: true, color: true } },
    },
    orderBy: { createdAt: "desc" },
    take: filters?.limit ?? 100,
  });
}

export async function createTransaction(organizationId: string, data: {
  type: TransactionType;
  amount: number;
  description: string;
  status?: TransactionStatus;
  dueDate?: Date;
  paidAt?: Date;
  profileId?: string;
  accountId?: string;
  categoryId?: string;
  competencia?: string;
  proofMediaId?: string;
  proofMediaUrl?: string;
  recurringBillId?: string;
  installmentPlanId?: string;
  installmentNumber?: number;
  notes?: string;
}) {
  return prisma.financialTransaction.create({
    data: { organizationId, ...data },
    include: {
      profile: { select: { name: true, personType: true } },
      account: { select: { name: true } },
      category: { select: { name: true } },
    },
  });
}

export async function markTransactionPaid(id: string, paidAt = new Date()) {
  return prisma.financialTransaction.update({
    where: { id },
    data: { status: "PAGO", paidAt },
  });
}

// ─── Recurring Bills ──────────────────────────────────────────────────────────

export async function listRecurringBills(organizationId: string) {
  return prisma.recurringBill.findMany({
    where: { organizationId, isActive: true },
    include: {
      profile: { select: { name: true, personType: true } },
      category: { select: { name: true, icon: true } },
    },
    orderBy: { dueDay: "asc" },
  });
}

export async function createRecurringBill(organizationId: string, data: {
  name: string;
  amount: number;
  dueDay: number;
  profileId?: string;
  categoryId?: string;
  startDate?: Date;
  endDate?: Date;
}) {
  return prisma.recurringBill.create({
    data: { organizationId, startDate: new Date(), ...data },
  });
}

// ─── Installment Plans ────────────────────────────────────────────────────────

export async function listInstallmentPlans(organizationId: string) {
  return prisma.installmentPlan.findMany({
    where: { organizationId, isActive: true },
    include: {
      profile: { select: { name: true, personType: true } },
      account: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function createInstallmentPlan(organizationId: string, data: {
  name: string;
  totalAmount: number;
  installmentCount: number;
  installmentValue: number;
  competenciaStart: string;
  profileId?: string;
  accountId?: string;
}) {
  return prisma.installmentPlan.create({
    data: { organizationId, ...data },
  });
}

export async function incrementInstallmentPaid(id: string) {
  return prisma.installmentPlan.update({
    where: { id },
    data: { paidCount: { increment: 1 } },
  });
}

// ─── Proof Sessions ───────────────────────────────────────────────────────────

export async function getActivePendingProofSession(organizationId: string, phoneNumber: string) {
  return prisma.financialProofSession.findFirst({
    where: {
      organizationId,
      phoneNumber,
      status: { in: ["IDENTIFIED", "AWAITING_CONFIRM", "AWAITING_CATEGORY"] },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function createProofSession(organizationId: string, data: {
  phoneNumber: string;
  mediaId: string;
  mediaUrl?: string;
}) {
  return prisma.financialProofSession.create({
    data: { organizationId, status: "PENDING", ...data },
  });
}

export async function updateProofSession(id: string, data: {
  status?: string;
  extractedText?: string;
  extractedData?: Record<string, unknown>;
  pendingData?: Record<string, unknown>;
  transactionId?: string;
  mediaUrl?: string;
}) {
  return prisma.financialProofSession.update({
    where: { id },
    data: {
      ...(data.status !== undefined && { status: data.status }),
      ...(data.extractedText !== undefined && { extractedText: data.extractedText }),
      ...(data.extractedData !== undefined && { extractedData: data.extractedData as object }),
      ...(data.pendingData !== undefined && { pendingData: data.pendingData as object }),
      ...(data.transactionId !== undefined && { transactionId: data.transactionId }),
      ...(data.mediaUrl !== undefined && { mediaUrl: data.mediaUrl }),
    },
  });
}

// ─── Seed default categories ──────────────────────────────────────────────────

export async function seedDefaultCategories(organizationId: string) {
  const defaults: Array<{ name: string; type: TransactionType; icon: string; color: string }> = [
    { name: "Moradia", type: "DESPESA", icon: "🏠", color: "#6366f1" },
    { name: "Água e Luz", type: "DESPESA", icon: "💡", color: "#f59e0b" },
    { name: "Internet", type: "DESPESA", icon: "📡", color: "#3b82f6" },
    { name: "Alimentação", type: "DESPESA", icon: "🍽️", color: "#10b981" },
    { name: "Transporte", type: "DESPESA", icon: "🚗", color: "#8b5cf6" },
    { name: "Saúde", type: "DESPESA", icon: "🏥", color: "#ef4444" },
    { name: "Empréstimo", type: "DESPESA", icon: "🏦", color: "#dc2626" },
    { name: "Cartão de Crédito", type: "DESPESA", icon: "💳", color: "#7c3aed" },
    { name: "Lazer", type: "DESPESA", icon: "🎮", color: "#ec4899" },
    { name: "Educação", type: "DESPESA", icon: "📚", color: "#0891b2" },
    { name: "Outros", type: "DESPESA", icon: "📦", color: "#6b7280" },
    { name: "Salário", type: "RECEITA", icon: "💰", color: "#059669" },
    { name: "Freelance", type: "RECEITA", icon: "💼", color: "#0284c7" },
    { name: "Investimentos", type: "RECEITA", icon: "📈", color: "#16a34a" },
    { name: "Outros Recebimentos", type: "RECEITA", icon: "🎁", color: "#7c3aed" },
  ];

  const existing = await prisma.financialCategory.count({ where: { organizationId } });
  if (existing > 0) return;

  await prisma.financialCategory.createMany({
    data: defaults.map((d) => ({ ...d, organizationId })),
    skipDuplicates: true,
  });
}
