/**
 * GET /api/sdr/bootstrap?secret=<CRON_SECRET>
 * Configura a org Nexo Brasil SDR no banco usando as variáveis de ambiente
 * já presentes na Vercel. Idempotente — seguro chamar várias vezes.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { buildSdrSystemPrompt } from "@/lib/ai/sdr/prompt";
import { SDR_EMPTY_SESSION } from "@/lib/ai/sdr/types";

const ORG_NAME = "Nexo Brasil SDR";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
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
  const existingCol = await prisma.kanbanColumn.findFirst({ where: { organizationId: org.id } });
  if (!existingCol) {
    await prisma.kanbanColumn.createMany({
      data: [
        { name: "Novos", order: 0, type: "TRIAGE", isSystemDefault: true, isDefaultEntry: true, organizationId: org.id, color: "#6B7280" },
        { name: "Em qualificação", order: 1, type: "CUSTOM", organizationId: org.id, color: "#3B82F6" },
        { name: "Qualificados", order: 2, type: "CUSTOM", organizationId: org.id, color: "#10B981" },
        { name: "Mornos", order: 3, type: "CUSTOM", organizationId: org.id, color: "#F59E0B" },
        { name: "Handoff enviado", order: 4, type: "ESCALATED", isSystemDefault: true, organizationId: org.id, color: "#8B5CF6" },
        { name: "Fora do ICP", order: 5, type: "LOST", isSystemDefault: true, organizationId: org.id, color: "#EF4444" },
      ],
    });
    console.log("[SDR Bootstrap] Colunas Kanban criadas");
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
