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
import { consolidarColunasEm5Etapas } from "@/lib/crm/pipeline-mover";

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

  // ── Colunas Kanban — funil unificado em 5 etapas ────────────────────────────
  // Era 14 colunas somando dois sub-funis sobrepostos (qualificação do SDR +
  // prospecção outbound), difícil de ler de relance. Consolidado em:
  //   Novo → Em Qualificação → Qualificado → Ganho | Perdido
  // pipeline-mover.ts canonicaliza qualquer tipo antigo (MORNO, PROPOSTA,
  // REUNIAO_AGENDADA, CONTATO_2, etc.) para uma dessas 5 antes de mover um
  // lead — nenhum outro código precisou mudar.
  //
  // Roda pra TODAS as orgs, não só esta: o CRM pode ter mais de uma
  // organização configurada (ex.: uma de prospecção outbound separada) e o
  // problema de excesso de colunas vale pra qualquer board que o usuário abra.
  const todasOrgs = await prisma.whatsappBusinessOrganization.findMany({ select: { id: true } });
  for (const o of todasOrgs) {
    await consolidarColunasEm5Etapas(o.id);
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
