/**
 * Seed NEXO — pivô da ferramenta para prospecção B2B da Nexo Assessoria.
 *
 * Idempotente: pode rodar quantas vezes precisar.
 *
 * O que faz:
 *  1. Upsert da org "Nexo Assessoria" (tipo PROSPECCAO, ACTIVE)
 *  2. Reaponta o provider WhatsApp REAL (phone_id 1009631782242056) para a org Nexo
 *  3. Desativa a org VENDAS antiga e remove o provider placeholder
 *  4. Cria as 9 colunas do funil Nexo
 *  5. Agente "SDR Nexo" com prompt de prospecção consultiva (sandbox ligado)
 *  6. AiConfig + DisparoConfig
 *
 * Uso: npx tsx prisma/seed-nexo.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REAL_PHONE_NUMBER_ID = "1009631782242056";

// Funil de vendas em 6 entradas (5 estágios ativos + Perdido):
const FUNIL_NEXO: Array<{ name: string; type: string; color: string; isDefaultEntry?: boolean }> = [
  { name: "Leads",                 type: "TRIAGE",              color: "#6b7280", isDefaultEntry: true },
  { name: "Qualificação",          type: "EM_QUALIFICACAO",     color: "#3b82f6" },
  { name: "Proposta e Negociação", type: "PROPOSTA_NEGOCIACAO", color: "#f59e0b" },
  { name: "Contrato",              type: "CONTRATO",            color: "#8b5cf6" },
  { name: "Ganho",                 type: "GANHO",               color: "#22c55e" },
  { name: "Perdido",               type: "LOST",                color: "#ef4444" },
];

const SDR_NEXO_PROMPT = `Você é o SDR da Nexo, assessoria especializada em fazer empresas venderem nos maiores marketplaces do Brasil (Mercado Livre, Shopee, Amazon, Magalu).
Seu papel: prospecção consultiva B2B via WhatsApp — nunca venda agressiva.

SOBRE A NEXO:
- Assessoria ponta a ponta: criação e otimização de contas, anúncios, precificação, logística e escala de vendas em marketplaces.
- Atende desde quem nunca vendeu online até quem já vende e quer crescer.
- Clientes fortes nos segmentos de moda, varejo, ferragens e marcenaria.

OBJETIVO: qualificar o lead e agendar uma reunião online de diagnóstico gratuito (30 min, Google Meet) com o especialista da Nexo.

QUALIFICAÇÃO (colete naturalmente, UMA pergunta por vez):
1. Tipo de negócio e o que vende (moda, varejo, ferragens, marcenaria...)
2. Se já vende em marketplace hoje (qual? como está o resultado?)
3. Porte/faturamento aproximado (faixa, sem pressionar)
4. Principal dor: falta de tempo, não sabe operar, anúncios ruins, margem apertada, logística

CONDUTA:
- Mensagens curtas (1-3 linhas), tom humano e direto, sem parecer robô.
- Mostre valor com exemplos: lojas físicas que dobraram o faturamento vendendo online com gestão profissional.
- Quando o lead demonstrar interesse E você já souber o tipo de negócio e a dor principal, emita [QUALIFICADO].
- Para agendar: ofereça os slots de agenda disponíveis fornecidos no contexto.
- Quando o lead confirmar data e hora, emita [REUNIAO_AGENDADA].
- Se pedir para não ser contatado, agradeça com educação e emita [OPT_OUT].

NUNCA:
- Prometa resultados garantidos.
- Fale de preço da assessoria por mensagem — valores só na reunião de diagnóstico.
- Insista após 2 objeções seguidas do mesmo tipo.
- Envie mensagens longas ou em formato de lista/panfleto.`;

async function main() {
  console.log("[Seed Nexo] Iniciando pivô para Nexo Assessoria...");

  // ── 1. Org Nexo ──────────────────────────────────────────────────────────────
  let org = await prisma.whatsappBusinessOrganization.findFirst({
    where: { name: "Nexo Assessoria" },
  });
  if (!org) {
    // Reaproveita a org de prospecção antiga se existir (renomeia), senão cria
    const antiga = await prisma.whatsappBusinessOrganization.findFirst({
      where: { name: "Nexos Brasil — Prospecção" },
    });
    if (antiga) {
      org = await prisma.whatsappBusinessOrganization.update({
        where: { id: antiga.id },
        data: { name: "Nexo Assessoria", tipo: "PROSPECCAO", status: "ACTIVE" },
      });
      console.log(`[Seed Nexo] Org antiga de prospecção renomeada: ${org.id}`);
    } else {
      org = await prisma.whatsappBusinessOrganization.create({
        data: {
          name:         "Nexo Assessoria",
          documentId:   "00000000000191",
          documentType: "CNPJ",
          status:       "ACTIVE",
          tipo:         "PROSPECCAO",
        },
      });
      console.log(`[Seed Nexo] Org criada: ${org.id}`);
    }
  } else {
    org = await prisma.whatsappBusinessOrganization.update({
      where: { id: org.id },
      data: { tipo: "PROSPECCAO", status: "ACTIVE" },
    });
    console.log(`[Seed Nexo] Org já existe: ${org.id}`);
  }

  // ── 2. Reapontar o provider REAL para a org Nexo ─────────────────────────────
  const realProvider = await prisma.whatsappProviderConfig.findFirst({
    where: { businessPhoneNumberId: REAL_PHONE_NUMBER_ID },
  });
  if (!realProvider) {
    console.error(`[Seed Nexo] ⚠️ Provider real (${REAL_PHONE_NUMBER_ID}) não encontrado! Configure-o primeiro.`);
  } else if (realProvider.organizationId !== org.id) {
    await prisma.whatsappProviderConfig.update({
      where: { id: realProvider.id },
      data: { organizationId: org.id, accountName: "Nexo Assessoria" },
    });
    console.log(`[Seed Nexo] Provider real ${realProvider.id} reapontado para a org Nexo`);
  } else {
    console.log(`[Seed Nexo] Provider real já pertence à org Nexo`);
  }

  // ── 3. Desativar org VENDAS + remover provider placeholder ──────────────────
  const vendasOrgs = await prisma.whatsappBusinessOrganization.updateMany({
    where: { tipo: "VENDAS", status: "ACTIVE" },
    data: { status: "INACTIVE" },
  });
  if (vendasOrgs.count > 0) console.log(`[Seed Nexo] ${vendasOrgs.count} org(s) VENDAS desativada(s)`);

  const placeholder = await prisma.whatsappProviderConfig.findFirst({
    where: { businessPhoneNumberId: "PLACEHOLDER_PHONE_NUMBER_ID" },
    include: { agent: true },
  });
  if (placeholder) {
    // Remove agente e provider placeholder (nunca receberam mensagens reais)
    if (placeholder.agent) await prisma.agent.delete({ where: { id: placeholder.agent.id } }).catch(() => {});
    await prisma.whatsappProviderConfig.delete({ where: { id: placeholder.id } }).catch(async () => {
      await prisma.whatsappProviderConfig.update({
        where: { id: placeholder.id },
        data: { status: "DISCONNECTED" },
      });
    });
    console.log(`[Seed Nexo] Provider placeholder removido/desativado`);
  }

  // ── 4. Funil Nexo ────────────────────────────────────────────────────────────
  // Remove flag default de colunas antigas para garantir entrada única
  await prisma.kanbanColumn.updateMany({
    where: { organizationId: org.id, isDefaultEntry: true },
    data: { isDefaultEntry: false },
  });

  for (let i = 0; i < FUNIL_NEXO.length; i++) {
    const col = FUNIL_NEXO[i];
    const existing = await prisma.kanbanColumn.findFirst({
      where: { organizationId: org.id, type: col.type },
    });
    if (existing) {
      await prisma.kanbanColumn.update({
        where: { id: existing.id },
        data: { name: col.name, order: i, color: col.color, isDefaultEntry: !!col.isDefaultEntry },
      });
    } else {
      await prisma.kanbanColumn.create({
        data: {
          name:            col.name,
          order:           i,
          type:            col.type,
          color:           col.color,
          isDefaultEntry:  !!col.isDefaultEntry,
          isSystemDefault: true,
          organizationId:  org.id,
        },
      });
    }
  }
  // Remove qualquer coluna QUALIFICADO legada (migrada para PROPOSTA_NEGOCIACAO)
  const colunaQualificado = await prisma.kanbanColumn.findFirst({
    where: { organizationId: org.id, type: "QUALIFICADO" },
  });
  if (colunaQualificado) {
    const colunaAlvo = await prisma.kanbanColumn.findFirst({
      where: { organizationId: org.id, type: "PROPOSTA_NEGOCIACAO" },
    });
    if (colunaAlvo) {
      await prisma.lead.updateMany({ where: { kanbanColumnId: colunaQualificado.id }, data: { kanbanColumnId: colunaAlvo.id } });
      await prisma.kanbanColumn.delete({ where: { id: colunaQualificado.id } }).catch(() => {});
      console.log(`[Seed Nexo] Coluna QUALIFICADO migrada para PROPOSTA_NEGOCIACAO`);
    }
  }
  console.log(`[Seed Nexo] Funil com ${FUNIL_NEXO.length} colunas criado/atualizado`);

  // ── 5. Agente SDR Nexo no provider real ──────────────────────────────────────
  if (realProvider) {
    const agent = await prisma.agent.findUnique({
      where: { whatsappProviderConfigId: realProvider.id },
    });
    if (agent) {
      await prisma.agent.update({
        where: { id: agent.id },
        data: {
          displayName:  "SDR Nexo",
          kind:         "AI",
          status:       "ACTIVE",
          sandboxMode:  true, // desligar só após teste E2E
          systemPrompt: SDR_NEXO_PROMPT,
          aiProvider:   "OPENAI",
          aiModel:      "gpt-4o",
        },
      });
      console.log(`[Seed Nexo] Agente atualizado → SDR Nexo (sandbox ON)`);
    } else {
      await prisma.agent.create({
        data: {
          displayName:              "SDR Nexo",
          kind:                     "AI",
          status:                   "ACTIVE",
          sandboxMode:              true,
          whatsappProviderConfigId: realProvider.id,
          systemPrompt:             SDR_NEXO_PROMPT,
          aiProvider:               "OPENAI",
          aiModel:                  "gpt-4o",
          escalationThreshold:      3,
        },
      });
      console.log(`[Seed Nexo] Agente SDR Nexo criado (sandbox ON)`);
    }
  }

  // ── 6. AiConfig + DisparoConfig ──────────────────────────────────────────────
  await prisma.aiConfig.upsert({
    where:  { organizationId: org.id },
    update: { tomDeVoz: "consultivo", objetivoVenda: "qualificar" },
    create: {
      organizationId:        org.id,
      usarEmoji:             true,
      usarReticencias:       false,
      nivelVenda:            "medio",
      tomDeVoz:              "consultivo",
      objetivoVenda:         "qualificar",
      nivelUrgencia:         2,
      matrizObjecoes:        [],
      restricoes:            [],
      followUpIntervalos:    [4, 24, 48, 72],
      followUpMaxTentativas: 3,
    },
  });

  await prisma.disparoConfig.upsert({
    where:  { organizationId: org.id },
    update: {},
    create: {
      organizationId:     org.id,
      limiteDiarioAtual:  15,
      incrementoSemanal:  10,
      limiteMaximoDiario: 100,
      janelaInicioHora:   9,
      janelaFimHora:      18,
      diasSemana:         [1, 2, 3, 4, 5],
    },
  });
  console.log(`[Seed Nexo] AiConfig + DisparoConfig ok`);

  console.log(`\n[Seed Nexo] ✅ Concluído!`);
  console.log(`Org Nexo: ${org.id}`);
  console.log(`\nPróximos passos:`);
  console.log(`  1. Configurar GOOGLE_PLACES_API_KEY no .env (sourcing)`);
  console.log(`  2. Conectar Google Calendar em Configurações > Integrações`);
  console.log(`  3. Criar template HSM aprovado na Meta e cadastrar em Prospecções > Disparo`);
  console.log(`  4. Desligar sandboxMode do agente após teste E2E`);
}

main()
  .catch((e) => {
    console.error("[Seed Nexo] Erro:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
