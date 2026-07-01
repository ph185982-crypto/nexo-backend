/**
 * Seed script — cria org "Nexos Brasil — Prospecção" com agente B2B
 *
 * Uso: npx ts-node -r tsconfig-paths/register scripts/seed-nexos-prospeccao.ts
 *
 * Variáveis de ambiente necessárias: DATABASE_URL
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("[Seed] Iniciando criação da org Nexos Brasil — Prospecção...");

  // ── 1. Criar ou encontrar organização ────────────────────────────────────────
  let org = await prisma.whatsappBusinessOrganization.findFirst({
    where: { name: "Nexos Brasil — Prospecção" },
  });

  if (!org) {
    org = await prisma.whatsappBusinessOrganization.create({
      data: {
        name:         "Nexos Brasil — Prospecção",
        documentId:   "00000000000000",
        documentType: "CNPJ",
        status:       "ACTIVE",
        tipo:         "PROSPECCAO",
      },
    });
    console.log(`[Seed] Org criada: ${org.id}`);
  } else {
    // Garante que tipo está correto caso org já exista
    org = await prisma.whatsappBusinessOrganization.update({
      where: { id: org.id },
      data: { tipo: "PROSPECCAO" },
    });
    console.log(`[Seed] Org já existe: ${org.id} — tipo atualizado para PROSPECCAO`);
  }

  // ── 2. Criar KanbanColumn padrão se não existir ──────────────────────────────
  let kanbanEntry = await prisma.kanbanColumn.findFirst({
    where: { organizationId: org.id, isDefaultEntry: true },
  });

  if (!kanbanEntry) {
    kanbanEntry = await prisma.kanbanColumn.create({
      data: {
        name:           "Triagem",
        order:          0,
        type:           "TRIAGE",
        isSystemDefault: true,
        isDefaultEntry:  true,
        organizationId:  org.id,
        color:           "#6B7280",
      },
    });
    console.log(`[Seed] KanbanColumn criada: ${kanbanEntry.id}`);
  }

  // ── 3. Criar WhatsappProviderConfig (placeholder — preencher via CRM) ────────
  let providerConfig = await prisma.whatsappProviderConfig.findFirst({
    where: { organizationId: org.id },
  });

  if (!providerConfig) {
    providerConfig = await prisma.whatsappProviderConfig.create({
      data: {
        accountName:            "Nexos Brasil Prospecção",
        displayPhoneNumber:     "+55 62 0000-0000",
        businessPhoneNumberId:  "PLACEHOLDER_PHONE_NUMBER_ID",
        wabaId:                 "PLACEHOLDER_WABA_ID",
        accessToken:            null,
        status:                 "DISCONNECTED",
        organizationId:         org.id,
      },
    });
    console.log(`[Seed] WhatsappProviderConfig criado: ${providerConfig.id}`);
  }

  // ── 4. Criar Agent ───────────────────────────────────────────────────────────
  const existingAgent = await prisma.agent.findUnique({
    where: { whatsappProviderConfigId: providerConfig.id },
  });

  if (!existingAgent) {
    await prisma.agent.create({
      data: {
        displayName:             "Agente Nexos Prospecção",
        kind:                    "AI",
        status:                  "ACTIVE",
        sandboxMode:             true,
        whatsappProviderConfigId: providerConfig.id,
        systemPrompt:            "[PLACEHOLDER] — defina o prompt de prospecção B2B via CRM > Agente",
        aiProvider:              "OPENAI",
        aiModel:                 "gpt-4o",
        escalationThreshold:     3,
      },
    });
    console.log(`[Seed] Agent criado`);
  } else {
    console.log(`[Seed] Agent já existe: ${existingAgent.id}`);
  }

  // ── 5. Criar AiConfig ────────────────────────────────────────────────────────
  const existingAiConfig = await prisma.aiConfig.findUnique({
    where: { organizationId: org.id },
  });

  if (!existingAiConfig) {
    await prisma.aiConfig.create({
      data: {
        organizationId:       org.id,
        usarEmoji:            true,
        usarReticencias:      true,
        nivelVenda:           "medio",
        tomDeVoz:             "consultivo",
        arquetipoIA:          null,
        objetivoVenda:        "qualificar",
        nivelUrgencia:        3,
        matrizObjecoes:       [],
        restricoes:           [],
        followUpIntervalos:   [4, 24, 48, 72],
        followUpMaxTentativas: 4,
      },
    });
    console.log(`[Seed] AiConfig criada`);
  } else {
    console.log(`[Seed] AiConfig já existe`);
  }

  console.log("\n[Seed] ✅ Concluído com sucesso!");
  console.log(`\nOrg ID: ${org.id}`);
  console.log(`\nPróximos passos:`);
  console.log(`  1. Configurar businessPhoneNumberId e accessToken no WhatsappProviderConfig`);
  console.log(`  2. Definir systemPrompt do agente via CRM > Agente`);
  console.log(`  3. Configurar env vars GOOGLE_CALENDAR_* para integração de agenda`);
  console.log(`  4. Desativar sandboxMode quando pronto para produção`);
}

main()
  .catch((e) => {
    console.error("[Seed] Erro:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
