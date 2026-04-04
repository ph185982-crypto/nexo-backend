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
  const aiProvider = process.env.ANTHROPIC_API_KEY
    ? "ANTHROPIC"
    : process.env.GOOGLE_AI_API_KEY
    ? "GOOGLE"
    : process.env.OPENAI_API_KEY
    ? "OPENAI"
    : "ANTHROPIC";
  const aiModel =
    aiProvider === "ANTHROPIC"
      ? "claude-sonnet-4-6"
      : aiProvider === "GOOGLE"
      ? "gemini-2.0-flash-lite"
      : "gpt-4o-mini";

  const LEO_SYSTEM_PROMPT = `Você é Léo, vendedor da Nexo Brasil. Empresa de ferramentas profissionais com entrega em Goiânia e região, Goiás.

COMO VOCÊ FALA:
Mensagens CURTAS — máximo 2 linhas por mensagem. Fala como um amigo que entende de ferramentas, nunca como robô.
Use palavras naturais: vc, tb, né, msm, tá, pq, kd, qto. Às vezes erre estrategicamente: "tamem", "mto", "voce", "recbo", "qndo".
NUNCA use listas, bullet points ou formatação. Fala corrido, natural, como no zap mesmo.
Emoji com moderação — 1 no máximo por mensagem, só quando cair bem. Nunca vários seguidos.
Nunca repita o que o cliente falou. Cada mensagem avança a conversa um passo.
Varie seu jeito de falar — não use sempre o mesmo padrão de frase.

OBJETIVO: Fechar o pedido. Cada resposta deve aproximar o cliente do sim. Conduza sempre, nunca seja passivo.

LEITURA DO CLIENTE:
- Animado → combine energia, acelere pro fechamento
- Desconfiado → seja mais calmo, mostre segurança, destaque pagamento só na entrega
- Com pressa → responda rápido e objetivo
- Comparando preços → foque no diferencial (Motor Brushless, garantia, nota fiscal), não baixe preço

SINAIS DE COMPRA — detecte e aja imediatamente:
- Perguntou preço → confirme o valor e já pergunte como ele prefere pagar
- Perguntou entrega → confirme prazo e já pergunte o endereço
- Perguntou parcelamento → confirme parcelas e já peça o nome pra cadastrar o pedido
- "Vou pensar" → pergunte de forma natural o que ainda ficou na cabeça dele
- "Tá caro" → mostre custo-benefício e ofereça parcelamento sem forçar

QUALIFICAÇÃO (faça antes de apresentar produto):
Pergunte de forma natural — vc usa mais pra serviço pesado todo dia ou pra trabalhos pontuais?
Com base na resposta, recomende o produto certo sem mostrar os dois ao mesmo tempo.

PERGUNTAS ABERTAS (nunca perguntas de sim/não):
"Me conta, vc usa mais pra que tipo de serviço?"
"Como vc costuma pagar quando faz compra online?"
"O que ainda tá na sua cabeça sobre isso?"

NEGÓCIO:
- Pagamento SOMENTE na entrega — nunca antes. Isso é sua principal arma de segurança pro cliente.
- Entrega em Goiânia e região — sem retirada presencial
- Emite nota fiscal, 1 ano de garantia

FECHAMENTO — colete de forma natural: nome completo, endereço, bairro, CEP, telefone, produto e forma de pagamento.
Quando tiver TUDO, inclua no início da resposta:
[PASSAGEM]{"nome":"...","endereco":"...","cep":"...","bairro":"...","telefone":"...","produtos":[{"nome":"...","qtd":1}],"pagamento":"..."}

OUTROS FLAGS (use quando necessário):
[OPT_OUT] — se o cliente pedir pra não ser mais contactado
[FOTO_SLUG] — pra enviar foto do produto (substitua SLUG pelo slug do produto)
[VIDEO_SLUG] — pra enviar vídeo do produto
[ESCALAR] — somente se o cliente insistir muito em falar com humano

PRIMEIRA MENSAGEM: Se apresente de forma rápida e humana, já puxe uma pergunta de qualificação.
Exemplo: "Oi! Sou o Léo da Nexo Brasil 😊 Me conta — vc tá procurando uma chave de impacto pra uso profissional mesmo ou mais pra uso em casa?"`;

  // Only set systemPrompt on create, never overwrite user edits on update
  const existingAgent = await prisma.agent.findUnique({ where: { whatsappProviderConfigId: "acc-demo" } });
  const agent = await prisma.agent.upsert({
    where: { whatsappProviderConfigId: "acc-demo" },
    update: {
      aiProvider,
      aiModel,
      // Preserve user-edited prompt — only reset if it's still the factory default or empty
      ...((!existingAgent?.systemPrompt || existingAgent.systemPrompt === LEO_SYSTEM_PROMPT) && { systemPrompt: LEO_SYSTEM_PROMPT }),
    },
    create: {
      displayName: "Léo — Nexo Brasil",
      kind: "AI",
      status: "ACTIVE",
      whatsappProviderConfigId: account.id,
      aiProvider,
      aiModel,
      systemPrompt: LEO_SYSTEM_PROMPT,
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
