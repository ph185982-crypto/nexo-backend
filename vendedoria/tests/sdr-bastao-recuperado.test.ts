// Bastão atrasado (17–18/11/2026): leads que a IA deixou esperando a ligação do Pedro, mas cujo
// handoff nunca saiu. A recuperação escala o lead, avisa o Pedro e NÃO escreve ao lead.
import test from "node:test";
import assert from "node:assert/strict";

process.env.OWNER_WHATSAPP_NUMBER = "5562900000001";
const temBanco = Boolean(process.env.DATABASE_URL);

test("bastão recuperado: escala, avisa o Pedro com o aviso de atraso, não escreve ao lead e não duplica", { skip: !temBanco, timeout: 90_000 }, async () => {
  process.env.DEEPSEEK_API_KEY = "chave-falsa-de-teste";
  process.env.META_CAPI_DRY_RUN = "true";
  const enviados: string[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("api.deepseek.com")) {
      // Extração: o lead disse que tem CNPJ.
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ cnpj: "tem" }) } }] }), { status: 200 });
    }
    if (u.includes("graph.facebook.com")) {
      const corpo = init?.body ? JSON.parse(String(init.body)) as { text?: { body?: string }; to?: string } : {};
      if (corpo.text?.body) enviados.push(`${corpo.to}: ${corpo.text.body}`);
      return new Response(JSON.stringify({ messages: [{ id: `wamid.R${Math.random()}` }], success: true }), { status: 200 });
    }
    return fetchOriginal(url, init);
  }) as typeof fetch;

  const { prisma } = await import("@/lib/prisma/client");
  const { passarBastaoRecuperado } = await import("@/lib/ai/sdr/agent");
  const { loadSdrSession, saveSdrSession } = await import("@/lib/ai/sdr/session");
  const { SDR_EMPTY_SESSION } = await import("@/lib/ai/sdr/types");
  const { recuperarBastoesPerdidos } = await import("@/lib/ai/sdr/bastoes-perdidos");
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: `r${Date.now()}`, documentId: "1", documentType: "CNPJ", tipo: "PROSPECCAO" } });
  for (const [i, [name, type]] of ([["Novos", "TRIAGE"], ["Em qualificação", "CUSTOM"], ["Handoff enviado", "ESCALATED"], ["Fora do ICP", "LOST"]] as const).entries()) {
    await prisma.kanbanColumn.create({ data: { name, order: i, type, color: "#000", organizationId: org.id, isDefaultEntry: i === 0 } });
  }
  const col = (await prisma.kanbanColumn.findFirst({ where: { organizationId: org.id, type: "TRIAGE" } }))!;
  const cfg = await prisma.whatsappProviderConfig.create({ data: { organizationId: org.id, businessPhoneNumberId: `PR${Date.now()}`, accessToken: "fake-wa-token", accountName: "t", displayPhoneNumber: "1" } });
  const lead = await prisma.lead.create({ data: { phoneNumber: "5562966667777", profileName: "Eloisa", leadOrigin: "INBOUND", organizationId: org.id, kanbanColumnId: col.id } });
  const conv = await prisma.whatsappConversation.create({ data: { customerWhatsappBusinessId: "5562966667777", leadOrigin: "INBOUND", leadId: lead.id, whatsappProviderConfigId: cfg.id } });
  await saveSdrSession(conv.id, {
    ...SDR_EMPTY_SESSION, mode: "SDR", nome: "Eloisa", empresa: "LYON DIESEL", segmento: "cosméticos",
    problema_principal: "loja física vende pouco e quer migrar para o online", faturamento_total: "54 reais",
    loja_fisica: "sim", tem_loja_fisica: true, disponibilidade: "amanhã às 9h", status: "em_qualificacao", etapa: "qualificacao",
  });
  await prisma.whatsappMessage.create({ data: { id: `wamid.R1${Date.now()}`, content: "Sim tem cnpj", type: "TEXT", role: "USER", sentAt: new Date(Date.now() - 5 * 60_000), conversationId: conv.id } });
  await prisma.whatsappMessage.create({ data: { id: `wamid.R2${Date.now()}`, content: "Vou te conectar com o Pedro, fundador da Avanteza", type: "TEXT", role: "ASSISTANT", sentAt: new Date(Date.now() - 4 * 60_000), conversationId: conv.id } });

  try {
    const r = await passarBastaoRecuperado(lead.id);
    assert.equal(r.ok, true, r.motivo);
    const l = await prisma.lead.findUnique({ where: { id: lead.id }, include: { kanbanColumn: true } });
    assert.equal(l?.status, "ESCALATED");
    assert.equal(l?.kanbanColumn.name, "Handoff enviado");
    const bastao = enviados.find((m) => m.startsWith("5562900000001"));
    assert.ok(bastao && /BASTÃO ATRASADO/.test(bastao) && /LYON DIESEL/.test(bastao) && /CNPJ tem/.test(bastao), `bastão ao Pedro: ${bastao}`);
    assert.ok(!enviados.some((m) => m.startsWith("5562966667777")), "nada é escrito ao lead");
    assert.equal(await prisma.ownerNotification.count({ where: { leadId: lead.id, type: "ESCALATION" } }), 1);
    assert.equal((await loadSdrSession(conv.id)).status, "handoff_enviado");

    const de_novo = await passarBastaoRecuperado(lead.id);
    assert.equal(de_novo.ok, false, "segunda vez não duplica");
    assert.equal(await prisma.ownerNotification.count({ where: { leadId: lead.id, type: "ESCALATION" } }), 1);

    // Job único: roda uma vez; se algo falhar de verdade, libera a marca para tentar de novo.
    await prisma.alertaEnviadoMax.deleteMany({ where: { chave: "bastoes-perdidos-2026-11-18-v1" } });
    const chamadas: string[] = [];
    const lista = [{ id: "a", nome: "A" }, { id: "b", nome: "B" }];
    const primeira = await recuperarBastoesPerdidos(lista, async (id) => { chamadas.push(id); return { ok: true, motivo: "escalado" }; });
    assert.equal(primeira.length, 2);
    assert.deepEqual(await recuperarBastoesPerdidos(lista, async (id) => { chamadas.push(id); return { ok: true, motivo: "x" }; }), [], "não roda de novo");
    assert.deepEqual(chamadas, ["a", "b"]);

    await prisma.alertaEnviadoMax.deleteMany({ where: { chave: "bastoes-perdidos-2026-11-18-v1" } });
    const err = console.error; console.error = () => {};
    await recuperarBastoesPerdidos(lista, async () => { throw new Error("falhou"); });
    console.error = err;
    const retentativa = await recuperarBastoesPerdidos(lista, async () => ({ ok: false, motivo: "handoff já realizado" }));
    assert.equal(retentativa.length, 2, "marca liberada depois de falha real");
    assert.equal(await prisma.alertaEnviadoMax.count({ where: { chave: "bastoes-perdidos-2026-11-18-v1" } }), 1, "'já escalado' não é falha: a marca fica");
  } finally {
    globalThis.fetch = fetchOriginal;
    await prisma.alertaEnviadoMax.deleteMany({ where: { chave: "bastoes-perdidos-2026-11-18-v1" } });
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
