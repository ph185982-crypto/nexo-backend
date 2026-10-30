// P0.1 (30/10): a IA travava numa pergunta e repetia até o lead desistir.
// Cobre: detecção de pedido de humano/frustração, janela do filtro de repetição,
// "não tenho loja" contando como resposta, prompt pedindo os campos do portão,
// e a saída de emergência de ponta a ponta (IA sem nada novo → Pedro assume).
import test from "node:test";
import assert from "node:assert/strict";

process.env.OWNER_WHATSAPP_NUMBER = "5562900000001";
const temBanco = Boolean(process.env.DATABASE_URL);

test("detecta pedido de humano e frustração; ignora conversa normal", async () => {
  const { detectarPedidoHumano, mensagemDeTransferencia } = await import("@/lib/ai/sdr/humano");
  assert.equal(detectarPedidoHumano("Pedro que eu não estou entendendo, tá parecendo um robô que tá conversando comigo"), "frustrado");
  assert.equal(detectarPedidoHumano("quero falar com uma pessoa"), "pediu_humano");
  assert.equal(detectarPedidoHumano("me passa pro Pedro por favor"), "pediu_humano");
  assert.equal(detectarPedidoHumano("já te falei isso duas vezes"), "frustrado");
  assert.equal(detectarPedidoHumano("isso é um bot?"), "frustrado");
  assert.equal(detectarPedidoHumano("Vendo botas e sandálias, faturo uns 30 mil"), null);
  assert.equal(detectarPedidoHumano("cheguei em casa e ia te responder"), null);
  assert.equal(detectarPedidoHumano("Sim"), null);
  assert.match(mensagemDeTransferencia("frustrado", "Ana Gabriella"), /^Ana, desculpa/);
});

test("janela do filtro usa as ÚLTIMAS mensagens da IA (não as primeiras)", async () => {
  const { ultimasDaIA } = await import("@/lib/ai/sdr/anti-repeticao");
  const msgs = [
    { role: "ASSISTANT", content: "velha 1" }, { role: "USER", content: "oi" },
    { role: "ASSISTANT", content: "velha 2" }, { role: "ASSISTANT", content: "nova 1" }, { role: "ASSISTANT", content: "nova 2" },
  ];
  assert.deepEqual(ultimasDaIA(msgs, 2), ["nova 1", "nova 2"]);
});

test("'não tenho loja física' conta como resposta no portão; prompt pede os campos do portão", async () => {
  const { faltandoParaHandoff } = await import("@/lib/ai/sdr/handoff-gate");
  const { SDR_EMPTY_SESSION } = await import("@/lib/ai/sdr/types");
  const { buildSdrSystemPrompt } = await import("@/lib/ai/sdr/prompt");
  const s = { ...SDR_EMPTY_SESSION, nome: "Ana Gabriella", empresa: "VG Injetados", segmento: "peças", faturamento_total: "30 mil", cnpj: "tem",
    problema_principal: "quer vender na Shopee e Mercado Livre, mas não obteve sucesso", loja_fisica: "nao" as const };
  assert.ok(!faltandoParaHandoff(s).includes("loja_fisica"), "loja_fisica=nao não é pendência");
  const prompt = buildSdrSystemPrompt(SDR_EMPTY_SESSION, "Ana");
  for (const campo of ['"empresa"', '"loja_fisica"', '"horario_reuniao"', '"segmento"', '"cnpj"']) assert.ok(prompt.includes(campo), `prompt sem ${campo}`);
  assert.match(prompt, /NUNCA pergunte de novo/);
});

async function fixture(prisma: Awaited<typeof import("@/lib/prisma/client")>["prisma"], sufixo: string, sdr: Record<string, unknown>) {
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: `h${sufixo}${Date.now()}`, documentId: "1", documentType: "CNPJ", tipo: "PROSPECCAO" } });
  for (const [i, [name, type]] of ([["Novos", "TRIAGE"], ["Em qualificação", "CUSTOM"], ["Handoff enviado", "ESCALATED"]] as const).entries()) {
    await prisma.kanbanColumn.create({ data: { name, order: i, type, color: "#000", organizationId: org.id, isDefaultEntry: i === 0 } });
  }
  const col = (await prisma.kanbanColumn.findFirst({ where: { organizationId: org.id, type: "TRIAGE" } }))!;
  const cfg = await prisma.whatsappProviderConfig.create({ data: { organizationId: org.id, businessPhoneNumberId: `PH${sufixo}${Date.now()}`, accountName: "t", displayPhoneNumber: "1", accessToken: "fake-wa-token" } });
  const phone = `55629${sufixo}0000`.slice(0, 13);
  const lead = await prisma.lead.create({ data: { phoneNumber: phone, profileName: "Ana Gabriella", leadOrigin: "INBOUND", organizationId: org.id, kanbanColumnId: col.id } });
  const conv = await prisma.whatsappConversation.create({ data: { customerWhatsappBusinessId: phone, leadOrigin: "INBOUND", leadId: lead.id, whatsappProviderConfigId: cfg.id, sessaoProspeccao: { sdr: { mode: "SDR", nome: "Ana Gabriella", ...sdr } } } });
  const limpar = async () => {
    await prisma.conversationFollowUp.deleteMany({ where: { conversationId: conv.id } });
    await prisma.whatsappMessage.deleteMany({ where: { conversationId: conv.id } });
    await prisma.whatsappConversation.delete({ where: { id: conv.id } });
    await prisma.leadActivity.deleteMany({ where: { leadId: lead.id } });
    await prisma.ownerNotification.deleteMany({ where: { organizationId: org.id } });
    await prisma.lead.delete({ where: { id: lead.id } });
    await prisma.whatsappProviderConfig.delete({ where: { id: cfg.id } });
    await prisma.kanbanColumn.deleteMany({ where: { organizationId: org.id } });
    await prisma.whatsappBusinessOrganization.delete({ where: { id: org.id } });
  };
  return { org, lead, conv, phone, limpar };
}

function fetchFalso(enviados: string[], respostaIA: () => unknown, contador: { n: number }) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("api.openai.com")) {
      contador.n++;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(respostaIA()) } }] }), { status: 200 });
    }
    if (u.includes("graph.facebook.com")) {
      const corpo = init?.body ? JSON.parse(String(init.body)) as { text?: { body?: string }; to?: string } : {};
      if (corpo.text?.body) enviados.push(`${corpo.to}: ${corpo.text.body}`);
      return new Response(JSON.stringify({ messages: [{ id: `wamid.H${Math.random()}` }] }), { status: 200 });
    }
    return original(url, init);
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

test("caso Ana (28/10): IA sem resposta nova → Pedro assume, lead escalado, follow-up cancelado", { skip: !temBanco, timeout: 60_000 }, async () => {
  process.env.SDR_DEBOUNCE_MS = "0";
  process.env.OPENAI_API_KEY = "fake-openai-key";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  const { prisma } = await import("@/lib/prisma/client");
  const { processSdrResponse } = await import("@/lib/ai/sdr/agent");
  const f = await fixture(prisma, "71", { cnpj: "sim", faturamento_total: "30 mil", tem_loja_fisica: false, problema_principal: "quer vender na Shopee e Mercado Livre, mas não obteve sucesso", etapa: "handoff", status: "em_qualificacao", canais_atuais: ["sandálias"] });
  const enviados: string[] = [];
  const contador = { n: 0 };
  // O modelo insiste na mesma pergunta que a IA já fez duas vezes.
  const restaurar = fetchFalso(enviados, () => ({ messages: [{ text: "Qual o nome da sua empresa?", delay: 0 }], updateSession: {}, action: "continue" }), contador);
  const t0 = Date.now() - 60_000;
  const seq = [
    ["ASSISTANT", "Qual o nome da empresa ou loja e se você tem loja física?"], ["USER", "Das peças de moto Vg injetados"],
    ["ASSISTANT", "Qual o nome da sua empresa?"], ["USER", "O cnpj Vg injetados"],
    ["ASSISTANT", "Qual o nome da sua empresa?"],
  ] as const;
  for (const [i, [role, content]] of seq.entries()) {
    await prisma.whatsappMessage.create({ data: { content, type: "TEXT", role, sentAt: new Date(t0 + i * 1000), conversationId: f.conv.id } });
  }
  await prisma.conversationFollowUp.create({ data: { conversationId: f.conv.id, step: 1, status: "ACTIVE", aiMessageAt: new Date(), nextSendAt: new Date(Date.now() + 3_600_000), phoneNumber: f.phone, phoneNumberId: "x" } });
  const msgId = `wamid.H71${Date.now()}`;
  await prisma.whatsappMessage.create({ data: { id: msgId, content: "https://www.instagram.com/vg_injetados", type: "TEXT", role: "USER", sentAt: new Date(), conversationId: f.conv.id } });
  try {
    await processSdrResponse(f.conv.id, "https://www.instagram.com/vg_injetados", { id: "a", aiProvider: "OPENAI", aiModel: "gpt-4o" }, msgId);
    const paraLead = enviados.filter((m) => m.startsWith(f.phone));
    assert.equal(paraLead.length, 1, `lead deveria receber só a transferência: ${JSON.stringify(paraLead)}`);
    assert.match(paraLead[0], /Pedro/);
    assert.ok(!paraLead[0].includes("nome da sua empresa"), "não repete a pergunta");
    const conv = await prisma.whatsappConversation.findUnique({ where: { id: f.conv.id } });
    assert.equal(conv?.humanTakeover, true);
    const l = await prisma.lead.findUnique({ where: { id: f.lead.id }, include: { kanbanColumn: true } });
    assert.equal(l?.status, "ESCALATED");
    assert.equal(l?.kanbanColumn.name, "Handoff enviado");
    const n = await prisma.ownerNotification.findFirst({ where: { leadId: f.lead.id, type: "ESCALATION" } });
    assert.ok(n && /IA TRAVOU/.test(n.body) && /Vg injetados/.test(n.body), n?.body);
    const fu = await prisma.conversationFollowUp.findUnique({ where: { conversationId: f.conv.id } });
    assert.equal(fu?.status, "DONE");
  } finally {
    restaurar();
    await f.limpar();
  }
});

test("lead escreve 'tá parecendo um robô' → humano assume antes de chamar a IA", { skip: !temBanco, timeout: 60_000 }, async () => {
  process.env.SDR_DEBOUNCE_MS = "0";
  process.env.OPENAI_API_KEY = "fake-openai-key";
  const { prisma } = await import("@/lib/prisma/client");
  const { processSdrResponse } = await import("@/lib/ai/sdr/agent");
  const f = await fixture(prisma, "72", { status: "em_qualificacao", etapa: "descoberta" });
  const enviados: string[] = [];
  const contador = { n: 0 };
  const restaurar = fetchFalso(enviados, () => ({ messages: [{ text: "nunca deveria ser chamado", delay: 0 }], updateSession: {}, action: "continue" }), contador);
  const texto = "Pedro que eu não estou entendendo, tá parecendo um robô que tá conversando comigo";
  const msgId = `wamid.H72${Date.now()}`;
  await prisma.whatsappMessage.create({ data: { id: msgId, content: texto, type: "TEXT", role: "USER", sentAt: new Date(), conversationId: f.conv.id } });
  try {
    await processSdrResponse(f.conv.id, texto, { id: "a", aiProvider: "OPENAI", aiModel: "gpt-4o" }, msgId);
    assert.equal(contador.n, 0, "IA não é chamada");
    const paraLead = enviados.filter((m) => m.startsWith(f.phone));
    assert.equal(paraLead.length, 1);
    assert.match(paraLead[0], /desculpa a confusão/);
    const conv = await prisma.whatsappConversation.findUnique({ where: { id: f.conv.id } });
    assert.equal(conv?.humanTakeover, true);
    assert.ok(await prisma.ownerNotification.findFirst({ where: { leadId: f.lead.id, type: "ESCALATION" } }));
    assert.ok(enviados.some((m) => m.startsWith("5562900000001") && /FRUSTRAÇÃO/.test(m)), "Pedro avisado no WhatsApp");
    await prisma.$disconnect();
  } finally {
    restaurar();
    await f.limpar();
  }
});
