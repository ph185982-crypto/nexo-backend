/**
 * Financial AI Agent — WhatsApp integration for personal/business finance.
 *
 * Handles two flows:
 * 1. Image proof → Claude Vision extracts payment info → matches account → records transaction
 * 2. Text command → financial overview, manual entries, queries
 */

import { getMediaUrl, downloadMedia } from "@/lib/whatsapp/media";
import {
  getFinancialOverview,
  listProfiles,
  listAccounts,
  listRecurringBills,
  listInstallmentPlans,
  listTransactions,
  createTransaction,
  createAccount,
  createRecurringBill,
  createInstallmentPlan,
  findAccountByName,
  findCategoryByName,
  createCategory,
  getActivePendingProofSession,
  createProofSession,
  updateProofSession,
  seedDefaultCategories,
  markTransactionPaid,
} from "./repository";

// ─── Image proof analysis ──────────────────────────────────────────────────────

async function analyzePaymentProof(
  imageBuffer: Buffer,
  mimeType: string
): Promise<{
  description: string;
  amount?: number;
  beneficiary?: string;
  date?: string;
  paymentMethod?: string;
  bank?: string;
  type?: "RECEITA" | "DESPESA";
}> {
  const mediaTypeMap: Record<string, string> = {
    "image/jpeg": "image/jpeg",
    "image/jpg": "image/jpeg",
    "image/png": "image/png",
    "image/webp": "image/webp",
  };
  const safeType = mediaTypeMap[mimeType.toLowerCase()] ?? "image/jpeg";

  // Check image size — Anthropic accepts up to ~3.75MB base64
  const base64 = imageBuffer.toString("base64");
  const base64SizeMB = base64.length / 1024 / 1024;
  console.log(`[FinancialAgent] Imagem: ${imageBuffer.length} bytes raw, ${base64SizeMB.toFixed(2)}MB base64, type=${safeType}`);

  if (base64SizeMB > 3.5) {
    throw new Error(`Imagem muito grande (${base64SizeMB.toFixed(1)}MB base64). WhatsApp deveria comprimir — tente novamente.`);
  }

  const prompt = `Analise este comprovante financeiro brasileiro e extraia as informações. Responda APENAS em JSON com este formato:
{
  "description": "descrição curta (ex: Conta de luz CEMIG, PIX Nubank, Parcela empréstimo CEF)",
  "amount": 123.45,
  "beneficiary": "Nome da empresa/pessoa destinatária",
  "date": "DD/MM/AAAA",
  "paymentMethod": "PIX | Boleto | Cartão | Transferência | Débito",
  "bank": "nome do banco se visível",
  "type": "DESPESA ou RECEITA"
}

Se não conseguir identificar algum campo, omita-o. Responda SOMENTE o JSON válido, sem markdown, sem explicações.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: safeType, data: base64 } },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[FinancialAgent] Anthropic API error ${res.status}:`, errBody);
    throw new Error(`Anthropic API ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find((b) => b.type === "text")?.text ?? "";
  console.log(`[FinancialAgent] Anthropic response:`, text.slice(0, 300));

  if (!text) throw new Error("Anthropic retornou resposta vazia");

  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned);
    return parsed;
  } catch {
    // Tenta extrair JSON de dentro do texto
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
    }
    console.warn("[FinancialAgent] Não conseguiu parsear JSON:", text.slice(0, 200));
    return { description: "Comprovante financeiro", type: "DESPESA" };
  }
}

// ─── Text command processing ───────────────────────────────────────────────────

async function generateOverviewText(organizationId: string): Promise<string> {
  const [overview, profiles] = await Promise.all([
    getFinancialOverview(organizationId),
    listProfiles(organizationId),
  ]);

  const pfProfile = profiles.find((p) => p.personType === "PESSOA_FISICA");
  const pjProfile = profiles.find((p) => p.personType === "PESSOA_JURIDICA");

  let msg = `*💰 SITUAÇÃO FINANCEIRA — ${overview.mes.toUpperCase()}*\n\n`;

  if (pfProfile) msg += `*👤 Pessoa Física*\n`;
  if (pjProfile) msg += `*🏢 Pessoa Jurídica*\n`;

  msg += `\n📈 *Receitas pagas:* R$ ${fmt(overview.totalReceitas)}\n`;
  msg += `📉 *Despesas pagas:* R$ ${fmt(overview.totalDespesas)}\n`;
  msg += `${overview.saldoMes >= 0 ? "✅" : "🔴"} *Saldo do mês:* R$ ${fmt(overview.saldoMes)}\n`;

  if (overview.totalVencidas > 0) {
    msg += `\n⚠️ *${overview.qtdVencidas} conta(s) vencida(s):* R$ ${fmt(overview.totalVencidas)}\n`;
  }
  if (overview.totalPendentes > 0) {
    msg += `⏰ *A vencer:* R$ ${fmt(overview.totalPendentes)}\n`;
  }

  if (overview.recurring.length > 0) {
    msg += `\n🔄 *Recorrentes mensais:*\n`;
    for (const r of overview.recurring) {
      msg += `• ${r.name}: R$ ${fmt(r.amount)} (dia ${r.dueDay})\n`;
    }
    msg += `*Total recorrente:* R$ ${fmt(overview.totalRecorrentes)}\n`;
  }

  if (overview.installments.length > 0) {
    msg += `\n🏦 *Parcelamentos ativos:*\n`;
    for (const i of overview.installments) {
      msg += `• ${i.name}: R$ ${fmt(i.installmentValue)}/mês (${i.paidCount}/${i.installmentCount} pagas) — Restante: R$ ${fmt(i.valorRestante)}\n`;
    }
  }

  const compromissoMensal = overview.totalRecorrentes + overview.totalParcelamentos;
  if (compromissoMensal > 0) {
    msg += `\n💳 *Compromisso mensal fixo:* R$ ${fmt(compromissoMensal)}\n`;
  }

  msg += `\n_Enviado pelo Nexo Financeiro_ 🤖`;
  return msg;
}

function fmt(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Text intent parser ───────────────────────────────────────────────────────

type FinancialIntent =
  | { kind: "overview" }
  | { kind: "list_transactions"; filter?: string }
  | { kind: "list_recurring" }
  | { kind: "list_installments" }
  | { kind: "unknown"; reply: string };

function detectIntent(text: string): FinancialIntent {
  const t = text.toLowerCase().trim();

  if (/overview|situação|como.*(tô|tou|estou|está|estamos)|financ|relat|resumo financ|saldo/i.test(t)) {
    return { kind: "overview" };
  }
  if (/recorrent|mensalidade|conta fixa|contas fixas/i.test(t)) {
    return { kind: "list_recurring" };
  }
  if (/parcelament|parcela|empréstimo|cartão|fatura/i.test(t)) {
    return { kind: "list_installments" };
  }
  if (/transações|lançamentos|extrato|histórico/i.test(t)) {
    return { kind: "list_transactions" };
  }
  return {
    kind: "unknown",
    reply:
      `*🤖 Agente Financeiro*\n\n` +
      `Comandos disponíveis:\n` +
      `• *overview* — situação financeira completa\n` +
      `• *recorrentes* — contas mensais fixas\n` +
      `• *parcelamentos* — empréstimos e cartões\n` +
      `• *extrato* — últimos lançamentos\n` +
      `• _Envie um comprovante_ (foto) para lançar automaticamente`,
  };
}

// ─── Proof session conversation state machine ─────────────────────────────────

async function handleConfirmationReply(
  text: string,
  session: Awaited<ReturnType<typeof getActivePendingProofSession>>,
  organizationId: string
): Promise<string> {
  if (!session) return "";

  const t = text.toLowerCase().trim();
  const isYes = /^(sim|s|yes|confirma|confirmar|certo|ok|isso|correto|pode)$/i.test(t);
  const isNo = /^(não|nao|n|no|errado|incorreto|cancela|cancelar)$/i.test(t);

  if (session.status === "AWAITING_CONFIRM") {
    const pending = session.pendingData as Record<string, unknown>;

    if (isYes) {
      const tx = await createTransaction(organizationId, {
        type: (pending.type as "RECEITA" | "DESPESA") ?? "DESPESA",
        amount: (pending.amount as number) ?? 0,
        description: (pending.description as string) ?? "Lançamento via comprovante",
        status: "PAGO",
        paidAt: new Date(),
        accountId: pending.accountId as string | undefined,
        categoryId: pending.categoryId as string | undefined,
        proofMediaId: session.mediaId,
        proofMediaUrl: session.mediaUrl ?? undefined,
        notes: pending.notes as string | undefined,
      });

      await updateProofSession(session.id, { status: "COMPLETED", transactionId: tx.id });

      return (
        `✅ *Lançado com sucesso!*\n\n` +
        `📝 ${tx.description}\n` +
        `💰 R$ ${fmt(tx.amount)}\n` +
        `📊 Tipo: ${tx.type === "RECEITA" ? "Receita" : "Despesa"}\n` +
        `🗓️ Data: ${new Date().toLocaleDateString("pt-BR")}`
      );
    }

    if (isNo) {
      await updateProofSession(session.id, { status: "REJECTED" });
      return "❌ Lançamento cancelado. Me manda o comprovante novamente quando quiser.";
    }

    // If responding with category/account info
    return await handleCategoryReply(text, session, organizationId);
  }

  if (session.status === "AWAITING_CATEGORY") {
    return await handleCategoryReply(text, session, organizationId);
  }

  return "";
}

async function handleCategoryReply(
  text: string,
  session: Awaited<ReturnType<typeof getActivePendingProofSession>>,
  organizationId: string
): Promise<string> {
  if (!session) return "";
  const pending = (session.pendingData as Record<string, unknown>) ?? {};

  // Try to match category by name
  let category = await findCategoryByName(organizationId, text);
  if (!category) {
    // Create new category based on user's reply
    const type = (pending.type as "RECEITA" | "DESPESA") ?? "DESPESA";
    category = await createCategory(organizationId, {
      name: text.trim(),
      type,
      icon: type === "RECEITA" ? "💰" : "📦",
    });
  }

  // Try to match or create account
  let account = pending.accountId
    ? await prismaFindAccount(pending.accountId as string)
    : null;

  if (!account) {
    const accs = await listAccounts(organizationId);
    if (accs.length > 0) account = accs[0];
    else {
      const newAcc = await createAccount(organizationId, {
        name: "Conta Principal",
        accountType: "CORRENTE",
      });
      account = newAcc;
    }
  }

  const tx = await createTransaction(organizationId, {
    type: (pending.type as "RECEITA" | "DESPESA") ?? "DESPESA",
    amount: (pending.amount as number) ?? 0,
    description: (pending.description as string) ?? text.trim(),
    status: "PAGO",
    paidAt: new Date(),
    accountId: account?.id,
    categoryId: category.id,
    proofMediaId: session.mediaId,
    proofMediaUrl: session.mediaUrl ?? undefined,
  });

  await updateProofSession(session.id, { status: "COMPLETED", transactionId: tx.id });

  return (
    `✅ *Lançado como "${category.name}"!*\n\n` +
    `📝 ${tx.description}\n` +
    `💰 R$ ${fmt(tx.amount)}\n` +
    `🗂️ Categoria: ${category.name}\n` +
    `🏦 Conta: ${account?.name ?? "Principal"}\n` +
    `🗓️ ${new Date().toLocaleDateString("pt-BR")}`
  );
}

// Quick helper (avoids a full import of prisma just for one lookup)
async function prismaFindAccount(id: string) {
  const { prisma } = await import("@/lib/prisma/client");
  return prisma.financialAccount.findUnique({ where: { id } });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type FinancialMessageContext = {
  organizationId: string;
  phoneNumber: string;
  providerConfig: {
    businessPhoneNumberId: string;
    accessToken?: string | null;
  };
};

/**
 * Handle a text message from the owner in financial context.
 * Returns the response text to send back via WhatsApp.
 */
export async function handleFinancialTextMessage(
  text: string,
  ctx: FinancialMessageContext
): Promise<string> {
  await seedDefaultCategories(ctx.organizationId);

  // Check if there's an active proof session waiting for reply
  const activeSession = await getActivePendingProofSession(ctx.organizationId, ctx.phoneNumber);
  if (activeSession) {
    const reply = await handleConfirmationReply(text, activeSession, ctx.organizationId);
    if (reply) return reply;
  }

  const intent = detectIntent(text);

  switch (intent.kind) {
    case "overview":
      return generateOverviewText(ctx.organizationId);

    case "list_recurring": {
      const bills = await listRecurringBills(ctx.organizationId);
      if (bills.length === 0) {
        return "Nenhuma conta recorrente cadastrada ainda. Me manda um comprovante para eu cadastrar!";
      }
      let msg = `*🔄 CONTAS RECORRENTES*\n\n`;
      for (const b of bills) {
        const profile = b.profile?.personType === "PESSOA_JURIDICA" ? " [PJ]" : " [PF]";
        msg += `• *${b.name}*${b.profile ? profile : ""} — R$ ${fmt(b.amount)} (dia ${b.dueDay})\n`;
      }
      const total = bills.reduce((s, b) => s + b.amount, 0);
      msg += `\n*Total: R$ ${fmt(total)}/mês*`;
      return msg;
    }

    case "list_installments": {
      const plans = await listInstallmentPlans(ctx.organizationId);
      if (plans.length === 0) {
        return "Nenhum parcelamento ativo. Use o painel para cadastrar empréstimos e cartões.";
      }
      let msg = `*🏦 PARCELAMENTOS ATIVOS*\n\n`;
      for (const p of plans) {
        const remaining = p.installmentCount - p.paidCount;
        msg += `• *${p.name}*\n  R$ ${fmt(p.installmentValue)}/mês × ${remaining} restantes\n  Total restante: R$ ${fmt(remaining * p.installmentValue)}\n\n`;
      }
      return msg.trim();
    }

    case "list_transactions": {
      const txs = await listTransactions(ctx.organizationId, { limit: 10 });
      if (txs.length === 0) return "Nenhum lançamento encontrado.";
      let msg = `*📋 ÚLTIMOS LANÇAMENTOS*\n\n`;
      for (const t of txs) {
        const icon = t.type === "RECEITA" ? "📈" : "📉";
        msg += `${icon} ${t.description} — R$ ${fmt(t.amount)} (${t.status})\n`;
      }
      return msg;
    }

    default:
      return intent.reply;
  }
}

/**
 * Handle an image (payment proof) from the owner.
 * Downloads the image, analyzes it with Claude Vision, and starts the
 * confirmation flow.
 */
export async function handleFinancialImageProof(
  mediaId: string,
  mimeType: string,
  ctx: FinancialMessageContext
): Promise<string> {
  await seedDefaultCategories(ctx.organizationId);

  const token = ctx.providerConfig.accessToken ?? process.env.META_WHATSAPP_ACCESS_TOKEN;
  if (!token) return "❌ Token de acesso não configurado.";

  // Download image from Meta
  let imageBuffer: Buffer;
  let mediaUrl: string | undefined;
  try {
    mediaUrl = await getMediaUrl(mediaId, token);
    imageBuffer = await downloadMedia(mediaUrl, token);
  } catch (err) {
    console.error("[FinancialAgent] Erro ao baixar imagem:", err);
    return "❌ Não consegui baixar o comprovante. Tente novamente.";
  }

  // Create proof session
  const session = await createProofSession(ctx.organizationId, {
    phoneNumber: ctx.phoneNumber,
    mediaId,
    mediaUrl,
  });

  // Analyze with Claude Vision
  let extracted: Awaited<ReturnType<typeof analyzePaymentProof>>;
  try {
    extracted = await analyzePaymentProof(imageBuffer, mimeType);
  } catch (err) {
    console.error("[FinancialAgent] Erro na análise de imagem:", err);
    await updateProofSession(session.id, { status: "REJECTED" });
    return "❌ Não consegui analisar o comprovante. Tente com uma foto mais nítida.";
  }

  const description = extracted.description ?? "Pagamento";
  const amount = extracted.amount ?? 0;
  const type = extracted.type ?? "DESPESA";

  // Try to match an existing account
  const allAccounts = await listAccounts(ctx.organizationId);
  let matchedAccount = null;
  if (extracted.beneficiary) {
    matchedAccount = await findAccountByName(ctx.organizationId, extracted.beneficiary);
  }
  if (!matchedAccount && allAccounts.length === 1) {
    matchedAccount = allAccounts[0];
  }

  // Try to match category
  let matchedCategory = null;
  for (const keyword of [description, extracted.beneficiary ?? ""]) {
    if (keyword) {
      matchedCategory = await findCategoryByName(ctx.organizationId, keyword);
      if (matchedCategory) break;
    }
  }

  const pendingData = {
    type,
    amount,
    description,
    beneficiary: extracted.beneficiary,
    date: extracted.date,
    paymentMethod: extracted.paymentMethod,
    bank: extracted.bank,
    accountId: matchedAccount?.id,
    categoryId: matchedCategory?.id,
    notes: extracted.bank ? `Banco: ${extracted.bank}` : undefined,
  };

  if (amount > 0) {
    // We have enough info — ask for confirmation
    await updateProofSession(session.id, {
      status: "AWAITING_CONFIRM",
      extractedText: description,
      extractedData: extracted as Record<string, unknown>,
      pendingData: pendingData as Record<string, unknown>,
    });

    let reply = `📄 *Comprovante identificado!*\n\n`;
    reply += `📝 *${description}*\n`;
    reply += `💰 *Valor:* R$ ${fmt(amount)}\n`;
    reply += `📊 *Tipo:* ${type === "RECEITA" ? "Receita" : "Despesa"}\n`;
    if (extracted.beneficiary) reply += `👤 *Beneficiário:* ${extracted.beneficiary}\n`;
    if (extracted.date) reply += `🗓️ *Data:* ${extracted.date}\n`;
    if (extracted.paymentMethod) reply += `💳 *Forma:* ${extracted.paymentMethod}\n`;
    if (matchedAccount) reply += `🏦 *Conta:* ${matchedAccount.name}\n`;
    if (matchedCategory) reply += `🗂️ *Categoria:* ${matchedCategory.name}\n`;
    reply += `\n*Confirma o lançamento? (sim/não)*`;
    return reply;
  }

  // Could not extract amount — ask for more info
  await updateProofSession(session.id, {
    status: "AWAITING_CATEGORY",
    extractedText: description,
    extractedData: extracted as Record<string, unknown>,
    pendingData: { ...pendingData, type } as Record<string, unknown>,
  });

  return (
    `📄 Recebi o comprovante, mas não consegui identificar o valor.\n\n` +
    `O que é esse pagamento? Informe a *categoria* (ex: Água e Luz, Internet, Empréstimo) ` +
    `e o *valor* se souber (ex: "Conta de luz R$ 185,00").`
  );
}

/**
 * Quick check: should this manager message be routed to the financial agent?
 * Returns true if it looks like a financial command or is an image.
 */
export function isFinancialMessage(text: string, hasImage: boolean): boolean {
  if (hasImage) return true;
  return /financ|receita|despesa|overview|extrato|recorrent|parcelament|lançar|saldo|conta|pagamento|comprovante/i.test(
    text
  );
}
