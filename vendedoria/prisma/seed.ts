import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create admin user
  const hashedPassword = await bcrypt.hash("admin123", 10);
  const user = await prisma.user.upsert({
    where: { email: "admin@vendedoria.com" },
    update: {},
    create: {
      name: "Administrador",
      email: "admin@vendedoria.com",
      password: hashedPassword,
      role: "ADMIN",
    },
  });
  console.log("✓ User created:", user.email);

  // Create organization
  const org = await prisma.whatsappBusinessOrganization.upsert({
    where: { id: "org-demo" },
    update: {},
    create: {
      id: "org-demo",
      name: "Empresa Demo Ltda",
      documentId: "12345678000199",
      documentType: "CNPJ",
      status: "ACTIVE",
    },
  });
  console.log("✓ Organization:", org.name);

  // Create WhatsApp account — update credentials from env vars on every run
  // Fallback to the Nexo production number if env var not set
  const realPhoneId   = process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? "1009631782242056";
  const realWabaId    = process.env.META_WHATSAPP_WABA_ID;
  const realAccessToken = process.env.META_WHATSAPP_ACCESS_TOKEN;

  const account = await prisma.whatsappProviderConfig.upsert({
    where: { id: "acc-demo" },
    update: {
      businessPhoneNumberId: realPhoneId,
      displayPhoneNumber: "+55 62 9 3250-0802",
      ...(realWabaId && { wabaId: realWabaId }),
      ...(realAccessToken && { accessToken: realAccessToken }),
      status: "CONNECTED", // reset ERROR/DISCONNECTED back to CONNECTED on each deploy
    },
    create: {
      id: "acc-demo",
      accountName: "WhatsApp Vendas — Nexo Brasil",
      displayPhoneNumber: "+55 62 9 3250-0802",
      businessPhoneNumberId: realPhoneId,
      wabaId: realWabaId ?? "DEMO_WABA_ID",
      accessToken: realAccessToken ?? null,
      status: "CONNECTED",
      organizationId: org.id,
    },
  });
  console.log("✓ Account:", account.accountName);

  // Create AI agent — pick provider based on available API keys
  // Priority: Anthropic > OpenAI > Google (Gemini free tier has strict quotas)
  const aiProvider = process.env.ANTHROPIC_API_KEY
    ? "ANTHROPIC"
    : process.env.OPENAI_API_KEY
    ? "OPENAI"
    : process.env.GOOGLE_AI_API_KEY
    ? "GOOGLE"
    : "OPENAI";
  const aiModel =
    aiProvider === "ANTHROPIC"
      ? "claude-sonnet-4-6"
      : aiProvider === "OPENAI"
      ? "gpt-4o-mini"
      : "gemini-2.0-flash-lite";

  const PEDRO_SYSTEM_PROMPT = `Você é Pedro, vendedor da Nexo Brasil. Ferramentas profissionais, entrega em Goiânia e região, Goiás.

═══════════════════════════════
COMPORTAMENTO PRINCIPAL
═══════════════════════════════

Você NUNCA manda tudo em uma mensagem só.

Você sempre divide em 2 ou mais mensagens curtas, como uma pessoa normal.

Exemplo:
Mensagem 1:
"bom dia, tudo bem?"

Mensagem 2:
"me chamo Pedro, falo da Nexo"

Mensagem 3:
"vou te ajudar aqui 👍"

Mensagem 4:
(responde o cliente)

═══════════════════════════════
REGRAS DE MENSAGEM
═══════════════════════════════

- cada mensagem = 1 ideia
- máximo 1 linha por mensagem
- linguagem simples
- pode usar abreviações (vc, ta, né)
- pode usar leve erro de português

NUNCA:
- mandar textão
- parecer robô
- mandar tudo junto

═══════════════════════════════
INÍCIO DE CONVERSA
═══════════════════════════════

Se for primeira mensagem do cliente:

Se for manhã:
"bom dia, tudo bem?"

Se for tarde:
"boa tarde, tudo bem?"

Se for noite:
"boa noite, tudo bem?"

Depois:
"me chamo Pedro, falo da Nexo"
"vou te ajudar aqui 👍"

Depois responde o cliente

═══════════════════════════════
SOBRE O PRODUTO
═══════════════════════════════

- NÃO ficar repetindo nome da ferramenta
- falar simples
- direto ao ponto

Ex:
"essa é bem forte"
"puxa tranquilo"
"cliente pega bastante"

═══════════════════════════════
COMO VENDER
═══════════════════════════════

Você NÃO força venda no início.

Você primeiro:
- responde
- entende interesse

DEPOIS:
- começa a puxar

Ex:
"essa sai 549,90"
"entregamos em Goiânia e região"
"pagamento só na entrega"

═══════════════════════════════
FECHAMENTO (MUITO IMPORTANTE)
═══════════════════════════════

Quando o cliente demonstrar interesse:

NUNCA peça endereço completo + CEP + telefone juntos numa mensagem só.

Vá em etapas:
1. "me manda sua localização 📍"
2. Depois: "e o nome completo?"
3. Depois coleta o resto naturalmente

SOMENTE quando tiver nome, endereço, bairro, CEP, telefone, produto e pagamento:
[PASSAGEM]{"nome":"...","endereco":"...","cep":"...","bairro":"...","telefone":"...","produtos":[{"nome":"...","qtd":1}],"pagamento":"..."}

═══════════════════════════════
ENTREGA
═══════════════════════════════

Sempre reforçar naturalmente:

"entregamos em Goiânia e região"
"vc paga só quando receber"

═══════════════════════════════
SENSO DE MOMENTO
═══════════════════════════════

- não fechar rápido demais
- não demorar demais

Se o cliente estiver interessado:
→ puxa fechamento

Se estiver só perguntando:
→ responde e puxa leve

═══════════════════════════════
FLAGS ESPECIAIS
═══════════════════════════════

[OPT_OUT] — cliente pediu pra não ser mais contactado
[MIDIA_SLUG] — envia TODAS as fotos + vídeo do produto (substitua SLUG pelo slug do produto)
[ESCALAR] — cliente insiste em falar com humano

═══════════════════════════════
REGRA FINAL
═══════════════════════════════

Você precisa parecer 100% humano.

Se parecer robô → erro.
Se mandar texto grande → erro.
Se pedir endereço + CEP + telefone juntos numa mensagem → ERRO GRAVE.
Se não conduzir pra venda → erro.

NEGÓCIO:
- Pagamento SOMENTE na entrega — nunca antes
- Entrega em Goiânia e região
- Emite nota fiscal, 1 ano de garantia`;

  // Always update the system prompt on each deploy (force latest version)
  const agent = await prisma.agent.upsert({
    where: { whatsappProviderConfigId: "acc-demo" },
    update: {
      displayName: "Pedro — Nexo Brasil",
      aiProvider,
      aiModel,
      systemPrompt: PEDRO_SYSTEM_PROMPT,
    },
    create: {
      displayName: "Pedro — Nexo Brasil",
      kind: "AI",
      status: "ACTIVE",
      whatsappProviderConfigId: account.id,
      aiProvider,
      aiModel,
      systemPrompt: PEDRO_SYSTEM_PROMPT,
    },
  });
  console.log("✓ Agent:", agent.displayName);

  // Create Kanban columns
  const columns = [
    { id: "col-1", name: "Atendimentos / Follow up da IA", order: 0, type: "CUSTOM", color: "#3b82f6", isDefaultEntry: true },
    { id: "col-2", name: "Leads Qualificados / Escalados", order: 1, type: "ESCALATED", color: "#22c55e", isDefaultEntry: false },
    { id: "col-3", name: "Vendedor Humano", order: 2, type: "CUSTOM", color: "#f97316", isDefaultEntry: false },
    { id: "col-4", name: "Negociação", order: 3, type: "CUSTOM", color: "#8b5cf6", isDefaultEntry: false },
    { id: "col-5", name: "Follow-up Vendedor Humano", order: 4, type: "CUSTOM", color: "#f97316", isDefaultEntry: false },
    { id: "col-6", name: "Vendas Realizadas", order: 5, type: "CUSTOM", color: "#22c55e", isDefaultEntry: false },
    { id: "col-7", name: "Leads Perdidos", order: 6, type: "LOST", color: "#ef4444", isDefaultEntry: false },
    { id: "col-8", name: "Triagem", order: 7, type: "TRIAGE", color: "#60a5fa", isDefaultEntry: false },
    { id: "col-9", name: "Descartados", order: 8, type: "JUNK", color: "#6b7280", isDefaultEntry: false },
  ];

  for (const col of columns) {
    await prisma.kanbanColumn.upsert({
      where: { id: col.id },
      update: {},
      create: { ...col, organizationId: org.id },
    });
  }
  console.log("✓ Kanban columns created");

  // Create sample tags
  const tags = [
    { id: "tag-1", name: "Lead Quente", color: "#ef4444", kind: "HOT" },
    { id: "tag-2", name: "Interesse Alto", color: "#f97316", kind: "HOT" },
    { id: "tag-3", name: "Aguardando Retorno", color: "#3b82f6", kind: "COLD" },
    { id: "tag-4", name: "Qualificado", color: "#22c55e", kind: "QUALIFIED" },
    { id: "tag-5", name: "Especulativo", color: "#8b5cf6", kind: "SPECULATIVE" },
  ];

  for (const tag of tags) {
    await prisma.tag.upsert({
      where: { id: tag.id },
      update: {},
      create: { ...tag, organizationId: org.id },
    });
  }
  console.log("✓ Tags created");

  // Create sample leads
  const sampleLeads = [
    { phone: "+5511999001001", name: "João Silva", col: "col-1", origin: "INBOUND" },
    { phone: "+5511999001002", name: "Maria Santos", col: "col-2", origin: "INBOUND" },
    { phone: "+5511999001003", name: "Pedro Costa", col: "col-3", origin: "OUTBOUND" },
    { phone: "+5511999001004", name: "Ana Oliveira", col: "col-4", origin: "INBOUND" },
    { phone: "+5511999001005", name: "Carlos Lima", col: "col-1", origin: "OUTBOUND" },
  ];

  for (const lead of sampleLeads) {
    const existing = await prisma.lead.findFirst({
      where: { phoneNumber: lead.phone, organizationId: org.id },
    });
    if (!existing) {
      await prisma.lead.create({
        data: {
          phoneNumber: lead.phone,
          profileName: lead.name,
          leadOrigin: lead.origin as "INBOUND" | "OUTBOUND",
          organizationId: org.id,
          kanbanColumnId: lead.col,
        },
      });
    }
  }
  console.log("✓ Sample leads created");

  // Create work unit
  const unit = await prisma.workUnitEntity.upsert({
    where: { id: "unit-1" },
    update: {},
    create: {
      id: "unit-1",
      name: "Unidade Centro",
      address: "Av. Paulista, 1000 - São Paulo, SP",
      timezone: "America/Sao_Paulo",
      isActive: true,
      organizationId: org.id,
    },
  });
  console.log("✓ Work unit:", unit.name);

  // Create professional
  const professional = await prisma.profissionalEntity.upsert({
    where: { id: "prof-1" },
    update: {},
    create: {
      id: "prof-1",
      name: "Dr. Rafael Mendes",
      workField: "Consultor de Vendas",
      isActive: true,
      organizationId: org.id,
      availabilities: {
        create: [1, 2, 3, 4, 5].map((day) => ({
          dayOfWeek: day,
          startTime: "08:00",
          endTime: "18:00",
          breakMinutes: 60,
          isActive: true,
        })),
      },
    },
  });
  console.log("✓ Professional:", professional.name);

  // Create default AI config
  await prisma.aiConfig.upsert({
    where: { organizationId: org.id },
    update: {},
    create: {
      organizationId: org.id,
      usarEmoji: true,
      usarReticencias: true,
      nivelVenda: "medio",
    },
  });
  console.log("✓ AI Config: default (emoji=true, reticencias=true, nivel=medio)");

  // ── AgentConfig singleton ──────────────────────────────────────────────────
  // Create only if none exists — never overwrite the prompt Pedro may have edited
  const existingConfig = await prisma.agentConfig.findFirst();
  if (!existingConfig) {
    await prisma.agentConfig.create({
      data: {
        agentName: "Léo",
        bastaoNumber: "5562984465388",
        deliveryWeekStart: 9,
        deliveryWeekEnd: 18,
        deliverySatStart: 8,
        deliverySatEnd: 13,
        maxFollowUps: 4,
        followUpHours: "4,24,48,72",
        deliveryArea: "Goiânia,Aparecida de Goiânia,Trindade,Senador Canedo,Goianira,Nerópolis,Hidrolândia,Abadia de Goiás,Aragoiânia,Guapó,Inhumas",
        currentPrompt: PEDRO_SYSTEM_PROMPT,
        promptVersion: 1,
      },
    });
    console.log("✓ AgentConfig created (v1)");
  } else {
    console.log("✓ AgentConfig already exists (v" + existingConfig.promptVersion + ") — skipping");
  }

  console.log("\n✅ Seed completed!");
  console.log("\nCredentials:");
  console.log("  Email: admin@vendedoria.com");
  console.log("  Password: admin123");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
