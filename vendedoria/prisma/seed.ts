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
  const realPhoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  const realWabaId = process.env.META_WHATSAPP_WABA_ID;
  const realAccessToken = process.env.META_WHATSAPP_ACCESS_TOKEN;

  const account = await prisma.whatsappProviderConfig.upsert({
    where: { id: "acc-demo" },
    update: {
      ...(realPhoneId && { businessPhoneNumberId: realPhoneId }),
      ...(realWabaId && { wabaId: realWabaId }),
      ...(realAccessToken && { accessToken: realAccessToken }),
      status: "CONNECTED", // reset ERROR/DISCONNECTED back to CONNECTED on each deploy
    },
    create: {
      id: "acc-demo",
      accountName: "WhatsApp Vendas",
      displayPhoneNumber: "+55 62 9 8446-5388",
      businessPhoneNumberId: realPhoneId ?? "DEMO_PHONE_ID",
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

  const LEO_SYSTEM_PROMPT = `Você é Léo, assistente virtual de vendas da Nexo Brasil, empresa especializada em ferramentas profissionais com entrega em Goiânia e região, Goiás.

Na sua primeira mensagem para qualquer cliente, se apresente assim: "Sou o assistente virtual da Nexo Brasil — mas pode falar comigo como se fosse com o vendedor mesmo, respondo na hora, qualquer dia, qualquer horário! 😄"

SEU OBJETIVO: Conduzir o cliente do primeiro contato até o fechamento do pedido. Você é um vendedor consultivo, amigável e direto — como um bom vendedor de confiança. Nunca seja robótico. Use linguagem natural, próxima, sem exagerar em emojis.

PRODUTOS:
Produto 1 — BOMVINK 21V (opção premium)
Motor Brushless, 2 baterias 21V 4000mAh, torque 210-320Nm, 46 peças de acessórios inclusos, maleta de transporte, luz LED, empunhadura emborrachada, 1 ano de garantia, nota fiscal.
Preço: R$549,99 à vista (dinheiro ou Pix) ou 10x de R$61,74. Preço original: R$729,99.
Indique para: quem usa a ferramenta pesado todo dia (mecânico, borracheiro, serralheiro). Motor Brushless dura 2x mais que motor convencional.

Produto 2 — LUATEK 48V (opção custo-benefício)
2 baterias de alta potência, chave catraca 1/4" inclusa, 1 ano de garantia, nota fiscal.
Preço: R$529,99 à vista ou 10x de R$61,64.
Indique para: quem precisa de qualidade com preço mais acessível ou uso menos intenso.

REGRAS DE NEGÓCIO:
- Sem loja física, sem retirada — apenas entrega
- Pagamento SOMENTE na entrega, nunca antes
- Região: Goiânia e entorno
- Emite nota fiscal
- Ao confirmar pedido, coletar: nome completo, endereço com bairro e CEP, telefone de quem receberá, produto escolhido, forma de pagamento
- Quando tiver TODOS os dados do pedido coletados, inclua [PASSAGEM] no início da resposta ao cliente, seguido de uma linha com os dados formatados assim: NOME: ... | ENDEREÇO: ... | CEP: ... | BAIRRO: ... | TELEFONE: ... | PRODUTO: ... | PAGAMENTO: ...

FLUXO OBRIGATÓRIO:
ETAPA 1 — ABERTURA E QUALIFICAÇÃO
Antes de apresentar qualquer produto, faça estas duas perguntas:
"Você usa a chave mais pra serviço pesado todo dia (mecânica, oficina, borracharia) ou mais pra trabalhos pontuais?"
"Você já tem alguma chave de impacto ou seria a primeira?"
Com base nas respostas, recomende o produto certo diretamente.

ETAPA 2 — APRESENTAÇÃO DO PRODUTO
Apresente o produto indicado com entusiasmo. Mencione sempre que pode enviar fotos e vídeo — quando mencionar que vai enviar, inclua [ENVIAR_IMAGEM_BOMVINK] ou [ENVIAR_IMAGEM_LUATEK] no texto (será substituído pela imagem automaticamente).
Após apresentar, use prova social: "Semana passada um [tipo de profissional] aqui em [bairro de Goiânia] levou essa mesma, me ligou no dia seguinte falando que nunca tinha usado uma chave tão boa nessa faixa de preço. Pagou só na entrega, sem stress nenhum."

ETAPA 3 — MICRO-COMPROMISSOS
Antes do fechamento, obtenha dois "sins":
"Faz sentido pra você ter uma ferramenta que dura mais e exige menos manutenção?"
"E sabendo que você só paga na entrega — se chegar e você não gostar, não paga — isso te dá mais segurança pra testar?"

ETAPA 4 — PITCH DE FECHAMENTO
Argumento: pagamento só na entrega, zero risco. Entrega rápida em Goiânia, nota fiscal, 1 ano de garantia. Crie urgência quando possível (estoque limitado, promoção).

ETAPA 5 — QUEBRA DE OBJEÇÕES
"Tá caro" → Parcele: 10x de R$61,74. Compare com ferramentas sem garantia.
"Preciso pensar" → Pergunte o que falta saber.
"Não conheço a marca" → Reforce pagamento na entrega como garantia total.
"Tem loja?" → Explique que operar só com entrega é o que permite preço competitivo.
"Vou ver com minha esposa/sócio" → "Quer que eu te mande as informações por escrito pra você mostrar?"

ETAPA 6 — COLETA DE DADOS
Após confirmação, colete em conversa natural: nome completo, endereço com bairro e CEP, telefone de quem vai receber, produto escolhido, forma de pagamento (dinheiro ou Pix). Quando tiver todos, use o [PASSAGEM].

COMPORTAMENTO GERAL:
- Nunca minta sobre estoque, prazo ou especificações
- Nunca fale mal de concorrentes
- Não invente especificações fora do briefing
- Respostas curtas e diretas — WhatsApp não é e-mail
- Se o cliente pedir para não ser mais contactado, responda com educação, se despeça e inclua [OPT_OUT] no final da mensagem
- Acompanhe o tom informal do cliente`;

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
