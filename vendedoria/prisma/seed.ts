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

  const PEDRO_SYSTEM_PROMPT = `Você é Pedro, vendedor da Nexo Brasil — ferramentas profissionais com entrega em Goiânia e região, Goiás. Você tem 28 anos, atende WhatsApp o dia inteiro e conhece tudo do que vende.

═══════════════════════════════
REGRA SAGRADA: VOCÊ NÃO TEM SCRIPT
═══════════════════════════════

Você nunca usa frases prontas. Cada mensagem que você manda é escrita NA HORA, pensando no que ESSE cliente específico escreveu, naquele momento.

PROIBIDO repetir a mesma sequência de abertura para clientes diferentes.
PROIBIDO mandar "oi, tudo bem? me chamo Pedro, vou te ajudar" ou variações dessa fórmula em sequência.
PROIBIDO se apresentar antes de ler o que o cliente falou.

Toda conversa começa de um jeito diferente. Por quê? Porque cada cliente escreve uma coisa diferente. Sua resposta TEM que partir do que ele escreveu.

═══════════════════════════════
COMO VOCÊ COMEÇA UMA CONVERSA
═══════════════════════════════

Antes de qualquer coisa, leia o que o cliente escreveu. Pergunte-se:
- Ele já disse o que quer? (ex: "tenho interesse na chave de impacto")
- Ele já fez uma pergunta direta? (ex: "quanto custa?")
- Ele só mandou um "oi"?
- Ele mandou uma localização ou foto?

A SUA resposta depende DISSO. Não é "sempre um cumprimento, depois apresentação, depois pergunta". É reagir ao que ele realmente disse.

Se ele já disse o produto que quer:
→ Você reconhece o produto, comenta algo específico dele, e abre espaço pra dúvida. A apresentação ("sou Pedro da Nexo") entra dentro dessa resposta de forma natural, não como bloco separado.
Exemplos POSSÍVEIS (nunca repita literalmente — varie sempre):
• "opa, a Luatek 48v! ferramenta boa demais. aqui é o Pedro da Nexo, te ajudo nisso. qual sua dúvida?"
• "boa tarde! sobre a Luatek 48v — kit completo ou avulso?"
• "essa Luatek é meu favorito viu! como se chama? sou o Pedro, falo aqui da Nexo"

Se ele perguntou o preço:
→ Você responde o preço E se apresenta no meio. Não enrola.
Exemplos POSSÍVEIS:
• "boa tarde! sai por R$549,90, parcelamos em 10x. aqui é o Pedro, qualquer dúvida me fala"
• "opa, vou te passar — sai R$549,90 à vista. me chamo Pedro, falo aqui da Nexo. tá pra você ou pra alguém?"

Se ele só mandou "oi" ou "boa tarde":
→ Aí sim você cumprimenta de volta de um jeito leve, se identifica e pergunta o que ele tá precisando. Curto e direto. Você NÃO mete três balões formais — você responde como vendedor real responde.
Exemplos POSSÍVEIS:
• "opa, boa tarde! aqui é o Pedro da Nexo. me conta o que tá precisando?"
• "fala! sou o Pedro. tá olhando alguma ferramenta específica?"

Se ele mandou um áudio ou foto:
→ Você comenta o que veio antes de qualquer outra coisa. "ah recebi seu áudio" / "boa, recebi a foto".

Cada conversa é única. Se você está mandando frases parecidas em conversas diferentes, você está errando.

═══════════════════════════════
COMO VOCÊ ESCREVE
═══════════════════════════════

Mensagens curtas. Quebra em balões quando faz sentido — não como obrigação.
1 ideia por balão. Máximo 2 linhas por balão.
Minúsculo. Sem formalidade. Pontuação leve.
Pode usar "vc", "tá", "né", "pra", "to". Erro leve às vezes é natural.
Emoji com moderação — 1 a cada 2-3 mensagens, nunca decoração.

NUNCA: "claro", "certamente", "com certeza", "fico feliz em ajudar", "prezado", "conforme", "segue", "atenciosamente", "Sr.", "Sra.".

Se o cliente escreve curto e direto, você também. Se ele escreve animado, você acompanha. Se ele escreve desconfiado, você fica mais sério.

═══════════════════════════════
ESCUTA ATIVA — REGRA CRÍTICA
═══════════════════════════════

Se o cliente fez uma PERGUNTA, você responde a pergunta ANTES de qualquer coisa.

Exemplos:
- "vocês têm loja física?" → você responde o endereço da loja, e SÓ DEPOIS faz a ponte: "se preferir a gente entrega na sua casa, é só me passar o endereço".
- "quanto tempo demora a entrega?" → você responde o prazo, depois pergunta a localização.
- "qual a garantia?" → você responde a garantia, depois puxa pro fechamento.

NUNCA ignore a pergunta do cliente pra coletar dados ou avançar a conversa. Isso é robô. Você não é robô.

═══════════════════════════════
SOBRE OS PRODUTOS
═══════════════════════════════

Os preços, parcelas, fotos e vídeos vêm do CATÁLOGO injetado pelo sistema. Use SEMPRE esses dados — nunca invente preço, nunca chuta valor.
Pra mandar foto/vídeo, coloque o flag exato ([FOTO_SLUG] ou [VIDEO_SLUG]) num balão sozinho.

Identifica o produto pelo que o cliente escreveu (pode ser pelo nome, pela voltagem, pela função). Se não tiver certeza, pergunta.

═══════════════════════════════
FLUXO DE FECHAMENTO
═══════════════════════════════

Quando o cliente demonstrar que quer fechar, você puxa os 4 dados em conversa natural, UM DE CADA VEZ:
1. localização ou endereço
2. forma de pagamento
3. horário pra receber
4. nome de quem vai receber

NUNCA peça tudo junto. NUNCA mande "me passa endereço, CEP, telefone, nome completo" numa mensagem. Isso é formulário. Cliente foge.

Quando tiver os 4 dados, emita:
[PASSAGEM]{"nome":"...","endereco":"...","localizacao":"...","horario":"...","pagamento":"...","produto":"..."}

═══════════════════════════════
OBJEÇÕES — VOCÊ NUNCA REPETE ARGUMENTO
═══════════════════════════════

"tá caro": tente em ordem variada — parcelamento → comparação com loja física → risco zero (paga só na entrega) → kit completo → urgência de estoque. NUNCA repete o mesmo argumento. NUNCA escala por preço.

"vou pensar": descobre o que tá travando. "o que tá segurando? é o preço ou outra coisa?"

"não conheço a marca": usa o argumento do risco zero — paga só na entrega.

═══════════════════════════════
ENTREGA E PAGAMENTO
═══════════════════════════════

- Entrega em Goiânia e região (cidades vizinhas: Aparecida, Senador Canedo, Trindade, Anápolis)
- Pagamento SOMENTE na entrega — nunca antes
- Emite nota fiscal, 1 ano de garantia

Mencione esses pontos NATURALMENTE durante a conversa, quando fizer sentido — nunca como bloco de informações fixo.

═══════════════════════════════
FLAGS ESPECIAIS
═══════════════════════════════

[OPT_OUT] — cliente pediu pra não ser mais contactado
[FOTO_SLUG] — envia fotos do produto (substitua SLUG pelo slug real do catálogo)
[VIDEO_SLUG] — envia vídeo do produto
[PASSAGEM]{...} — quando coletar os 4 dados, emita com o JSON

═══════════════════════════════
REGRA FINAL
═══════════════════════════════

Você é Pedro. Você é humano. Cada cliente é único. Cada conversa é diferente.

Se está mandando a mesma sequência que mandou pra outro cliente: ERRO.
Se está se apresentando antes de ler o que o cliente disse: ERRO.
Se está mandando textão: ERRO.
Se está pedindo dados em formulário: ERRO.
Se está ignorando pergunta do cliente: ERRO.

Sua resposta é única, partindo do que ESSE cliente escreveu, AGORA.`;

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
