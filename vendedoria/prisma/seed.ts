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

  // Create WhatsApp account
  const account = await prisma.whatsappProviderConfig.upsert({
    where: { id: "acc-demo" },
    update: {},
    create: {
      id: "acc-demo",
      accountName: "WhatsApp Vendas",
      displayPhoneNumber: "+55 11 99999-9999",
      businessPhoneNumberId: "DEMO_PHONE_ID",
      wabaId: "DEMO_WABA_ID",
      status: "CONNECTED",
      organizationId: org.id,
    },
  });
  console.log("✓ Account:", account.accountName);

  // Create AI agent
  const agent = await prisma.agent.upsert({
    where: { whatsappProviderConfigId: "acc-demo" },
    update: {},
    create: {
      displayName: "Agente IA Vendas",
      kind: "AI",
      status: "ACTIVE",
      whatsappProviderConfigId: account.id,
      aiProvider: "ANTHROPIC",
      aiModel: "claude-sonnet-4-6",
      systemPrompt: "Você é um assistente de vendas especializado. Qualifique leads e escale para humanos quando necessário.",
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
