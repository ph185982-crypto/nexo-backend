// Fluxo do SDR de ponta a ponta com a IA e a Meta SIMULADAS (fetch falso):
// o modelo tenta passar um lead fora do ICP — o código barra, pede para refazer,
// e nada de "o Pedro vai te ligar" chega ao lead nem ao Pedro.
import test from "node:test";
import assert from "node:assert/strict";

// Lido na carga do módulo do agente — precisa estar definido antes de qualquer import dele.
process.env.OWNER_WHATSAPP_NUMBER = "5562900000001";

const temBanco = Boolean(process.env.DATABASE_URL);

test("SDR: handoff de lead fora do ICP é barrado e vira nutrição", { skip: !temBanco, timeout: 60_000 }, async () => {
  process.env.SDR_DEBOUNCE_MS = "0";
  process.env.OPENAI_API_KEY = "fake-openai-key";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  process.env.META_CAPI_DRY_RUN = "true";

  const enviadosMeta: string[] = [];
  const respostasIA = [
    // 1ª resposta: o modelo tenta encerrar com handoff (lead fatura R$ 5 mil, sem loja)
    { messages: [{ text: "Maravilha, ficou combinado", delay: 0 }, { text: "O Pedro vai te ligar amanhã", delay: 0 }],
      updateSession: { nome: "Geovana Martins", empresa: "Gê Acessórios", segmento: "acessórios", faturamento_total: "5 mil por mês",
        loja_fisica: "nao", tem_loja_fisica: false, cnpj: "tem", problema_principal: "Vendeu na Shopee um mês e depois parou de vender" },
      action: "handoff" },
    // 2ª (após a correção do sistema): nutrição educada
    { messages: [{ text: "Entendi seu momento, Geovana", delay: 0 }, { text: "Posso te mandar uns conteúdos que ajudam a voltar a vender", delay: 0 }],
      updateSession: {}, action: "nurture" },
  ];
  let chamadasIA = 0;
  const promptsIA: string[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("api.openai.com")) {
      const corpo = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
      promptsIA.push(corpo.messages[0].content);
      const r = respostasIA[Math.min(chamadasIA++, respostasIA.length - 1)];
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(r) } }] }), { status: 200 });
    }
    if (u.includes("graph.facebook.com")) {
      const corpo = init?.body ? JSON.parse(String(init.body)) as { text?: { body?: string }; to?: string } : {};
      if (corpo.text?.body) enviadosMeta.push(`${corpo.to}: ${corpo.text.body}`);
      return new Response(JSON.stringify({ messages: [{ id: `wamid.T${Math.random()}` }], success: true }), { status: 200 });
    }
    return fetchOriginal(url, init);
  }) as typeof fetch;

  const { prisma } = await import("@/lib/prisma/client");
  const { processSdrResponse } = await import("@/lib/ai/sdr/agent");
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: `f${Date.now()}`, documentId: "1", documentType: "CNPJ", tipo: "PROSPECCAO" } });
  for (const [i, [name, type]] of ([["Novos", "TRIAGE"], ["Em qualificação", "CUSTOM"], ["Qualificados", "CUSTOM"], ["Mornos", "CUSTOM"], ["Handoff enviado", "ESCALATED"], ["Fora do ICP", "LOST"]] as const).entries()) {
    await prisma.kanbanColumn.create({ data: { name, order: i, type, color: "#000", organizationId: org.id, isDefaultEntry: i === 0 } });
  }
  const col = (await prisma.kanbanColumn.findFirst({ where: { organizationId: org.id, type: "TRIAGE" } }))!;
  const cfg = await prisma.whatsappProviderConfig.create({ data: { organizationId: org.id, businessPhoneNumberId: `PN${Date.now()}`, accountName: "t", displayPhoneNumber: "1", accessToken: "fake-wa-token" } });
  const lead = await prisma.lead.create({ data: { phoneNumber: "5562933334444", profileName: "Geovana Martins", leadOrigin: "INBOUND", organizationId: org.id, kanbanColumnId: col.id } });
  const conv = await prisma.whatsappConversation.create({ data: { customerWhatsappBusinessId: "5562933334444", leadOrigin: "INBOUND", leadId: lead.id, whatsappProviderConfigId: cfg.id } });
  const msgId = `wamid.IN${Date.now()}`;
  await prisma.whatsappMessage.create({ data: { id: msgId, content: "é isso, faturo uns 5 mil por mês e não tenho loja física", type: "TEXT", role: "USER", sentAt: new Date(), conversationId: conv.id } });

  try {
    await processSdrResponse(conv.id, "é isso, faturo uns 5 mil por mês e não tenho loja física", { id: "a", aiProvider: "OPENAI", aiModel: "gpt-4o" }, msgId);

    assert.equal(chamadasIA, 2, "pediu para o modelo refazer a resposta");
    assert.match(promptsIA[1], /NÃO faça handoff/);
    const paraLead = enviadosMeta.filter((m) => m.startsWith("5562933334444"));
    assert.ok(paraLead.some((m) => /conteúdos/.test(m)), "lead recebeu a resposta refeita");
    assert.ok(!enviadosMeta.some((m) => /Pedro vai te ligar|NOVO LEAD/.test(m)), "nada de handoff para o lead nem para o Pedro");

    const l = await prisma.lead.findUnique({ where: { id: lead.id }, include: { kanbanColumn: true } });
    assert.notEqual(l?.status, "ESCALATED");
    assert.equal(l?.kanbanColumn.name, "Mornos");
    assert.equal(l?.icpStatus, "FORA");
    assert.equal(l?.empresa, "Gê Acessórios");
    assert.equal(await prisma.ownerNotification.count({ where: { leadId: lead.id, type: "ESCALATION" } }), 0);
    // nutrição agendada dentro da janela de 24h (sem template configurado)
    const fu = await prisma.conversationFollowUp.findUnique({ where: { conversationId: conv.id } });
    assert.ok(fu && fu.nextSendAt.getTime() < Date.now() + 24 * 3_600_000, "follow-up cabe na janela");
  } finally {
    globalThis.fetch = fetchOriginal;
    await prisma.conversationFollowUp.deleteMany({ where: { conversationId: conv.id } });
    await prisma.whatsappMessage.deleteMany({ where: { conversationId: conv.id } });
    await prisma.whatsappConversation.delete({ where: { id: conv.id } });
    await prisma.leadActivity.deleteMany({ where: { leadId: lead.id } });
    await prisma.metaConversionEvent.deleteMany({ where: { leadId: lead.id } });
    await prisma.ownerNotification.deleteMany({ where: { organizationId: org.id } });
    await prisma.lead.delete({ where: { id: lead.id } });
    await prisma.whatsappProviderConfig.delete({ where: { id: cfg.id } });
    await prisma.kanbanColumn.deleteMany({ where: { organizationId: org.id } });
    await prisma.whatsappBusinessOrganization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
});

test("SDR: lead no ICP que escolheu horário → ligação marcada, card movido, bastão completo pro Pedro", { skip: !temBanco, timeout: 60_000 }, async () => {
  process.env.SDR_DEBOUNCE_MS = "0";
  process.env.OPENAI_API_KEY = "fake-openai-key";
  const { gerarSlots } = await import("@/lib/agenda/slots");
  const slot = gerarSlots()[0];

  const enviados: string[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("api.openai.com")) {
      const r = { messages: [{ text: `Fechado então, ${slot.label}`, delay: 0 }, { text: "O Pedro, fundador da Nexo, vai te ligar no horário", delay: 0 }],
        updateSession: { nome: "Rafael Lima", empresa: "RL Autopeças", segmento: "autopeças", faturamento_total: "80 mil por mês",
          loja_fisica: "sim", tem_loja_fisica: true, cnpj: "tem", problema_principal: "Loja vende bem mas no Mercado Livre não passa de 10 pedidos por mês",
          horario_reuniao: slot.iso, score: 90 },
        action: "handoff" };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(r) } }] }), { status: 200 });
    }
    if (u.includes("graph.facebook.com")) {
      const corpo = init?.body ? JSON.parse(String(init.body)) as { text?: { body?: string }; to?: string } : {};
      if (corpo.text?.body) enviados.push(`${corpo.to}: ${corpo.text.body}`);
      return new Response(JSON.stringify({ messages: [{ id: `wamid.Q${Math.random()}` }] }), { status: 200 });
    }
    if (u.includes("googleapis.com")) return new Response("{}", { status: 401 });
    return fetchOriginal(url, init);
  }) as typeof fetch;

  const { prisma } = await import("@/lib/prisma/client");
  const { processSdrResponse } = await import("@/lib/ai/sdr/agent");
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: `g${Date.now()}`, documentId: "1", documentType: "CNPJ", tipo: "PROSPECCAO" } });
  for (const [i, [name, type]] of ([["Novos", "TRIAGE"], ["Qualificados", "CUSTOM"], ["Handoff enviado", "ESCALATED"], ["Reunião Agendada", "REUNIAO_AGENDADA"]] as const).entries()) {
    await prisma.kanbanColumn.create({ data: { name, order: i, type, color: "#000", organizationId: org.id, isDefaultEntry: i === 0 } });
  }
  const col = (await prisma.kanbanColumn.findFirst({ where: { organizationId: org.id, type: "TRIAGE" } }))!;
  const cfg = await prisma.whatsappProviderConfig.create({ data: { organizationId: org.id, businessPhoneNumberId: `PQ${Date.now()}`, accountName: "t", displayPhoneNumber: "1", accessToken: "fake-wa-token" } });
  const lead = await prisma.lead.create({ data: { phoneNumber: "5562955556666", profileName: "Rafa 🚗", leadOrigin: "INBOUND", organizationId: org.id, kanbanColumnId: col.id } });
  const conv = await prisma.whatsappConversation.create({ data: { customerWhatsappBusinessId: "5562955556666", leadOrigin: "INBOUND", leadId: lead.id, whatsappProviderConfigId: cfg.id } });
  const msgId = `wamid.IQ${Date.now()}`;
  await prisma.whatsappMessage.create({ data: { id: msgId, content: "pode ser nesse primeiro horário", type: "TEXT", role: "USER", sentAt: new Date(), conversationId: conv.id } });

  try {
    await processSdrResponse(conv.id, "pode ser nesse primeiro horário", { id: "a", aiProvider: "OPENAI", aiModel: "gpt-4o" }, msgId);
    const l = await prisma.lead.findUnique({ where: { id: lead.id }, include: { kanbanColumn: true } });
    assert.equal(l?.status, "ESCALATED");
    assert.equal(l?.kanbanColumn.name, "Reunião Agendada");
    assert.equal(l?.profileName, "Rafael Lima");
    assert.equal(l?.icpStatus, "QUALIFICADO");
    assert.equal(l?.reuniaoEm?.toISOString(), slot.iso);
    const ev = await prisma.calendarEvent.findFirst({ where: { leadId: lead.id } });
    assert.equal(ev?.startTime.toISOString(), slot.iso);
    assert.equal(ev?.provider, "LOCAL"); // Google não conectado no teste
    const bastao = enviados.find((m) => m.startsWith("5562900000001"));
    assert.ok(bastao && /LIGAÇÃO MARCADA/.test(bastao) && /RL Autopeças/.test(bastao) && /80\.000/.test(bastao), bastao);
  } finally {
    globalThis.fetch = fetchOriginal;
    await prisma.calendarEvent.deleteMany({ where: { leadId: lead.id } });
    await prisma.conversationFollowUp.deleteMany({ where: { conversationId: conv.id } });
    await prisma.whatsappMessage.deleteMany({ where: { conversationId: conv.id } });
    await prisma.whatsappConversation.delete({ where: { id: conv.id } });
    await prisma.leadActivity.deleteMany({ where: { leadId: lead.id } });
    await prisma.metaConversionEvent.deleteMany({ where: { leadId: lead.id } });
    await prisma.ownerNotification.deleteMany({ where: { organizationId: org.id } });
    await prisma.lead.delete({ where: { id: lead.id } });
    await prisma.whatsappProviderConfig.delete({ where: { id: cfg.id } });
    await prisma.kanbanColumn.deleteMany({ where: { organizationId: org.id } });
    await prisma.whatsappBusinessOrganization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
});
