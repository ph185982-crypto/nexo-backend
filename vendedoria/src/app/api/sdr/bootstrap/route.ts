/**
 * GET /api/sdr/bootstrap?secret=<CRON_SECRET>
 * Configura a org Nexo Brasil SDR no banco usando as variáveis de ambiente
 * já presentes na Vercel. Idempotente — seguro chamar várias vezes.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { buildSdrSystemPrompt } from "@/lib/ai/sdr/prompt";
import { SDR_EMPTY_SESSION } from "@/lib/ai/sdr/types";
import { auth } from "@/lib/auth";

const ORG_NAME = "Nexo Brasil SDR";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  const authorizedBySecret = !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
  const authorizedBySession = !authorizedBySecret && !!(await auth())?.user;
  if (!authorizedBySecret && !authorizedBySession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? "";
  const wabaId = process.env.META_WHATSAPP_WABA_ID;
  const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId) {
    return NextResponse.json(
      { error: "META_WHATSAPP_PHONE_NUMBER_ID não configurado" },
      { status: 500 },
    );
  }

  // ── Organização ─────────────────────────────────────────────────────────────
  let org = await prisma.whatsappBusinessOrganization.findFirst({
    where: { name: ORG_NAME },
  });

  if (!org) {
    org = await prisma.whatsappBusinessOrganization.create({
      data: {
        name: ORG_NAME,
        documentId: "00000000000000",
        documentType: "CNPJ",
        status: "ACTIVE",
        tipo: "PROSPECCAO",
      },
    });
    console.log("[SDR Bootstrap] Org criada:", org.id);
  }

  // ── Colunas Kanban ───────────────────────────────────────────────────────────
  // Base (triagem/escalação manual/perda) + funil automático usado por
  // pipeline-mover.ts (disparo de prospecção, follow-ups e handoff da IA:
  // [QUALIFICADO] → PROPOSTA, [REUNIAO_AGENDADA] → REUNIAO_AGENDADA, etc).
  // Loop idempotente: cria só o que faltar, sem tocar em colunas já existentes
  // (preserva customizações feitas pelo usuário via CRM).
  const existingCol = await prisma.kanbanColumn.findFirst({ where: { organizationId: org.id } });
  const desiredColumns = [
    { name: "Novos", order: 0, type: "TRIAGE", isSystemDefault: true, isDefaultEntry: true, color: "#6B7280" },
    { name: "Em qualificação", order: 1, type: "CUSTOM", color: "#3B82F6" },
    { name: "Qualificados", order: 2, type: "CUSTOM", color: "#10B981" },
    { name: "Mornos", order: 3, type: "CUSTOM", color: "#F59E0B" },
    { name: "Handoff enviado", order: 4, type: "ESCALATED", isSystemDefault: true, color: "#8B5CF6" },
    { name: "Fora do ICP", order: 5, type: "LOST", isSystemDefault: true, color: "#EF4444" },
    // ── Funil automático (pipeline-mover.ts) ──────────────────────────────────
    { name: "1º Contato",       order: 6,  type: "CONTATO_1",       color: "#0EA5E9" },
    { name: "2º Contato",       order: 7,  type: "CONTATO_2",       color: "#0EA5E9" },
    { name: "3º Contato",       order: 8,  type: "CONTATO_3",       color: "#0EA5E9" },
    { name: "Proposta",         order: 9,  type: "PROPOSTA",        color: "#14B8A6" },
    { name: "Reunião Agendada", order: 10, type: "REUNIAO_AGENDADA", color: "#6366F1" },
    { name: "Em Contrato",      order: 11, type: "CONTRATO",        color: "#A855F7" },
    { name: "Ganho",            order: 12, type: "GANHO",           color: "#22C55E" },
  ];
  if (!existingCol) {
    await prisma.kanbanColumn.createMany({
      data: desiredColumns.map((c) => ({ ...c, organizationId: org.id })),
    });
    console.log("[SDR Bootstrap] Colunas Kanban criadas");
  } else {
    // Org já bootstrapada antes — garante que os tipos do funil automático existem
    const existingTypes = new Set(
      (await prisma.kanbanColumn.findMany({ where: { organizationId: org.id }, select: { type: true } }))
        .map((c) => c.type),
    );
    const missing = desiredColumns.filter((c) => !existingTypes.has(c.type));
    if (missing.length > 0) {
      await prisma.kanbanColumn.createMany({
        data: missing.map((c) => ({ ...c, organizationId: org.id })),
      });
      console.log(`[SDR Bootstrap] Colunas Kanban do funil automático adicionadas: ${missing.map((c) => c.type).join(", ")}`);
    }
  }

  // ── Provider config ──────────────────────────────────────────────────────────
  let provider = await prisma.whatsappProviderConfig.findFirst({
    where: { organizationId: org.id },
    include: { agent: true },
  });

  if (!provider) {
    provider = await prisma.whatsappProviderConfig.create({
      data: {
        accountName: "Nexo Brasil",
        displayPhoneNumber: "+55 62 98446-5388",
        businessPhoneNumberId: phoneNumberId,
        wabaId,
        accessToken,
        status: "CONNECTED",
        organizationId: org.id,
      },
      include: { agent: true },
    });
    console.log("[SDR Bootstrap] Provider criado:", provider.id);
  } else {
    // Mantém token atualizado
    provider = await prisma.whatsappProviderConfig.update({
      where: { id: provider.id },
      data: { accessToken, wabaId, businessPhoneNumberId: phoneNumberId },
      include: { agent: true },
    });
  }

  // ── Agente SDR ───────────────────────────────────────────────────────────────
  const sdrPrompt = buildSdrSystemPrompt(SDR_EMPTY_SESSION);

  if (!provider.agent) {
    await prisma.agent.create({
      data: {
        displayName: "SDR Nexo Brasil",
        kind: "AI",
        status: "ACTIVE",
        sandboxMode: false,
        whatsappProviderConfigId: provider.id,
        systemPrompt: sdrPrompt,
        aiProvider: "OPENAI",
        aiModel: "gpt-4o",
        escalationThreshold: 3,
      },
    });
    console.log("[SDR Bootstrap] Agente SDR criado");
  } else {
    await prisma.agent.update({
      where: { id: provider.agent.id },
      data: { systemPrompt: sdrPrompt, status: "ACTIVE" },
    });
    console.log("[SDR Bootstrap] Prompt do agente SDR atualizado");
  }

  return NextResponse.json({
    ok: true,
    orgId: org.id,
    providerId: provider.id,
    phoneNumberId,
    message: "SDR Nexo Brasil configurado ✓",
  });
}
