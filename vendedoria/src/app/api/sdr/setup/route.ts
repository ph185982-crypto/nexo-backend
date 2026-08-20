/**
 * POST /api/sdr/setup
 * Cria (ou retorna existente) a organização Nexo Brasil SDR no banco.
 *
 * Body JSON esperado:
 * {
 *   "secret": "<CRON_SECRET>",          ← autenticação
 *   "businessPhoneNumberId": "...",     ← ID do telefone no painel Meta
 *   "wabaId": "...",                    ← WhatsApp Business Account ID
 *   "accessToken": "EAAbrI...",         ← Token Meta para o número SDR
 *   "displayPhoneNumber": "+55 62 98446-5388"  ← opcional, display only
 * }
 *
 * Idempotente: pode ser chamado várias vezes sem duplicar registros.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { buildSdrSystemPrompt } from "@/lib/ai/sdr/prompt";
import { SDR_EMPTY_SESSION } from "@/lib/ai/sdr/types";

const ORG_NAME = "Nexo Brasil SDR";
const ORG_DOCUMENT = "00000000000000"; // substituir pelo CNPJ real

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    secret?: string;
    businessPhoneNumberId?: string;
    wabaId?: string;
    accessToken?: string;
    displayPhoneNumber?: string;
  };

  if (body.secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!body.businessPhoneNumberId) {
    return NextResponse.json({ error: "businessPhoneNumberId é obrigatório" }, { status: 400 });
  }

  // ── 1. Organização ──────────────────────────────────────────────────────────
  let org = await prisma.whatsappBusinessOrganization.findFirst({
    where: { name: ORG_NAME },
    include: { accounts: { include: { agent: true } } },
  });

  if (!org) {
    org = await prisma.whatsappBusinessOrganization.create({
      data: {
        name: ORG_NAME,
        documentId: ORG_DOCUMENT,
        documentType: "CNPJ",
        status: "ACTIVE",
        tipo: "PROSPECCAO",
      },
      include: { accounts: { include: { agent: true } } },
    });
    console.log("[SDR Setup] Organização criada:", org.id);
  }

  // ── 2. Colunas Kanban ───────────────────────────────────────────────────────
  const existingColumns = await prisma.kanbanColumn.findFirst({
    where: { organizationId: org.id },
  });

  if (!existingColumns) {
    await prisma.kanbanColumn.createMany({
      data: [
        { name: "Novos", order: 0, type: "TRIAGE", isSystemDefault: true, isDefaultEntry: true, organizationId: org.id, color: "#6B7280" },
        { name: "Em qualificação", order: 1, type: "CUSTOM", organizationId: org.id, color: "#3B82F6" },
        { name: "Qualificados", order: 2, type: "CUSTOM", organizationId: org.id, color: "#10B981" },
        { name: "Mornos (nutrição)", order: 3, type: "CUSTOM", organizationId: org.id, color: "#F59E0B" },
        { name: "Handoff enviado", order: 4, type: "ESCALATED", isSystemDefault: true, organizationId: org.id, color: "#8B5CF6" },
        { name: "Fora do ICP", order: 5, type: "LOST", isSystemDefault: true, organizationId: org.id, color: "#EF4444" },
      ],
    });
    console.log("[SDR Setup] Colunas Kanban criadas");
  }

  // ── 3. Provider config ──────────────────────────────────────────────────────
  let providerConfig = await prisma.whatsappProviderConfig.findFirst({
    where: {
      organizationId: org.id,
      businessPhoneNumberId: body.businessPhoneNumberId,
    },
    include: { agent: true },
  });

  if (!providerConfig) {
    providerConfig = await prisma.whatsappProviderConfig.create({
      data: {
        accountName: ORG_NAME,
        displayPhoneNumber: body.displayPhoneNumber ?? "+55 62 98446-5388",
        businessPhoneNumberId: body.businessPhoneNumberId,
        wabaId: body.wabaId,
        accessToken: body.accessToken,
        status: "CONNECTED",
        organizationId: org.id,
      },
      include: { agent: true },
    });
    console.log("[SDR Setup] Provider config criado:", providerConfig.id);
  } else if (body.accessToken || body.wabaId) {
    // Atualiza token/wabaId se fornecido
    providerConfig = await prisma.whatsappProviderConfig.update({
      where: { id: providerConfig.id },
      data: {
        ...(body.accessToken ? { accessToken: body.accessToken } : {}),
        ...(body.wabaId ? { wabaId: body.wabaId } : {}),
      },
      include: { agent: true },
    });
  }

  // ── 4. Agent ────────────────────────────────────────────────────────────────
  const sdrPrompt = buildSdrSystemPrompt(SDR_EMPTY_SESSION);

  if (!providerConfig.agent) {
    await prisma.agent.create({
      data: {
        displayName: "SDR Nexo Brasil",
        kind: "AI",
        status: "ACTIVE",
        sandboxMode: false,
        whatsappProviderConfigId: providerConfig.id,
        systemPrompt: sdrPrompt,
        aiProvider: "OPENAI",
        aiModel: "gpt-4o",
        escalationThreshold: 3,
      },
    });
    console.log("[SDR Setup] Agente SDR criado");
  } else {
    // Atualiza o prompt com a versão mais recente
    await prisma.agent.update({
      where: { id: providerConfig.agent.id },
      data: { systemPrompt: sdrPrompt },
    });
    console.log("[SDR Setup] Prompt do agente SDR atualizado");
  }

  return NextResponse.json({
    ok: true,
    orgId: org.id,
    providerId: providerConfig.id,
    message: "SDR Nexo Brasil configurado com sucesso",
  });
}
