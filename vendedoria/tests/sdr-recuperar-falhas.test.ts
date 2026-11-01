// Conversas em que a IA falhou (30/10, créditos esgotados) e o cliente ficou só
// com a mensagem de espera: nova tentativa dentro da janela, aviso para o dono
// fora dela — e nada para quem já foi respondido ou está com humano.
import test from "node:test";
import assert from "node:assert/strict";

const temBanco = Boolean(process.env.DATABASE_URL);

test("recuperação de falhas da IA: tenta de novo na janela, avisa fora dela, ignora quem já foi atendido", { skip: !temBanco, timeout: 60_000 }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const { recuperarFalhasSdr, TITULO_AVISO } = await import("@/lib/ai/sdr/recuperar-falhas");
  const { MENSAGEM_FALHA_SDR } = await import("@/lib/ai/sdr/fallback");
  const { listarLigacoes } = await import("@/lib/crm/ligacoes");

  const AGORA = new Date();
  const h = (horas: number) => new Date(AGORA.getTime() - horas * 3_600_000);
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: `r${Date.now()}`, documentId: "1", documentType: "CNPJ", tipo: "PROSPECCAO" } });
  const col = await prisma.kanbanColumn.create({ data: { name: "Novos", order: 0, type: "TRIAGE", color: "#000", organizationId: org.id, isDefaultEntry: true } });
  const cfg = await prisma.whatsappProviderConfig.create({ data: { organizationId: org.id, businessPhoneNumberId: `PN${Date.now()}`, accountName: "t", displayPhoneNumber: "1", accessToken: "x" } });
  const agent = await prisma.agent.create({ data: { displayName: "SDR", kind: "AI", status: "ACTIVE", systemPrompt: "[SDR] teste", whatsappProviderConfigId: cfg.id } });

  let n = 0;
  async function conversa(nome: string, msgs: Array<[role: "USER" | "ASSISTANT", texto: string, horasAtras: number]>, extra: { humanTakeover?: boolean } = {}) {
    const phone = `55629000${String(++n).padStart(5, "0")}`;
    const lead = await prisma.lead.create({ data: { phoneNumber: phone, profileName: nome, leadOrigin: "INBOUND", organizationId: org.id, kanbanColumnId: col.id } });
    const conv = await prisma.whatsappConversation.create({ data: { customerWhatsappBusinessId: phone, leadOrigin: "INBOUND", leadId: lead.id, whatsappProviderConfigId: cfg.id, humanTakeover: extra.humanTakeover ?? false } });
    for (const [role, content, horas] of msgs) {
      await prisma.whatsappMessage.create({ data: { content, role, type: "TEXT", sentAt: h(horas), conversationId: conv.id } });
    }
    return conv.id;
  }

  const foraDaJanela = await conversa("Carla", [["USER", "Vi o anúncio e quero estruturar minha loja", 40], ["ASSISTANT", MENSAGEM_FALHA_SDR, 40]]);
  const naJanela = await conversa("Val", [["USER", "Quero saber como funciona", 2], ["ASSISTANT", MENSAGEM_FALHA_SDR, 1.9]]);
  const jaRespondida = await conversa("Kelly", [["USER", "oi", 40], ["ASSISTANT", MENSAGEM_FALHA_SDR, 40], ["ASSISTANT", "Oi Kelly, tudo bem?", 39]]);
  const comHumano = await conversa("Anderson", [["USER", "oi", 40], ["ASSISTANT", MENSAGEM_FALHA_SDR, 40]], { humanTakeover: true });
  const esgotada = await conversa("Mirian", [["USER", "oi", 3], ["ASSISTANT", MENSAGEM_FALHA_SDR, 2.9], ["ASSISTANT", MENSAGEM_FALHA_SDR, 2]]);

  const chamadas: Array<[string, string, string]> = [];
  try {
    const r = await recuperarFalhasSdr({ agora: AGORA, reprocessar: async (c, t, a) => { chamadas.push([c, t, a.id]); } });
    assert.deepEqual(r.reprocessadas, [naJanela], "nova tentativa só na janela aberta");
    assert.deepEqual(chamadas, [[naJanela, "Quero saber como funciona", agent.id]]);
    assert.deepEqual(new Set(r.avisadas), new Set([foraDaJanela, esgotada]));
    assert.ok(!r.avisadas.includes(jaRespondida) && !r.avisadas.includes(comHumano));

    // Avisa uma vez só
    const r2 = await recuperarFalhasSdr({ agora: AGORA, maxReprocessar: 0, reprocessar: async () => {} });
    assert.equal(r2.avisadas.length, 0, "não duplica o aviso");

    // Aparece na tela Ligações, com o lead
    const { pendentes } = await listarLigacoes(org.id);
    const nomes = pendentes.filter((p) => p.titulo.startsWith(TITULO_AVISO)).map((p) => p.nome).sort();
    assert.deepEqual(nomes, ["Carla", "Mirian"]);
    const carla = pendentes.find((p) => p.nome === "Carla");
    assert.equal(carla?.conversationId, foraDaJanela);
    assert.match(carla?.resumo ?? "", /janela de 24h/);
  } finally {
    await prisma.ownerNotification.deleteMany({ where: { organizationId: org.id } });
    await prisma.whatsappMessage.deleteMany({ where: { conversation: { whatsappProviderConfigId: cfg.id } } });
    await prisma.whatsappConversation.deleteMany({ where: { whatsappProviderConfigId: cfg.id } });
    await prisma.lead.deleteMany({ where: { organizationId: org.id } });
    await prisma.agent.delete({ where: { id: agent.id } });
    await prisma.whatsappProviderConfig.delete({ where: { id: cfg.id } });
    await prisma.kanbanColumn.deleteMany({ where: { organizationId: org.id } });
    await prisma.whatsappBusinessOrganization.delete({ where: { id: org.id } });
  }
});
