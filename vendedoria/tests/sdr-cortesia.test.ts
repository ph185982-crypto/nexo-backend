// Caso LYON DIESEL (17/11/2026): depois do handoff o lead mandou uma reação e "Até logo";
// o modelo devolveu `messages: []` (nada a dizer) e o sistema tratou como falha — o lead
// recebeu "tive um probleminha" e o dono um alerta falso. Agora: sem resposta e sem alerta.
import test from "node:test";
import assert from "node:assert/strict";
import { ehApenasCortesia, TEXTO_REACAO } from "@/lib/ai/sdr/cortesia";

process.env.OWNER_WHATSAPP_NUMBER = "5562900000001";
const temBanco = Boolean(process.env.DATABASE_URL);

test("cortesia: reação, emoji e despedidas curtas; perguntas e respostas de verdade não", () => {
  for (const t of [TEXTO_REACAO, "👍", "🙏🙏", "Ok", "Ok obrigado", "Até logo", "ate amanhã", "Valeu!", "Muito obrigada", "blz, combinado", "Perfeito, obrigado!", "  "]) {
    assert.equal(ehApenasCortesia(t), true, `deveria ser cortesia: "${t}"`);
  }
  for (const t of ["Qual o preço?", "Pode ser às 10h", "Não, prefiro à tarde", "obrigado mas quanto custa", "Bom dia", "sim", "ok mas e se eu não puder amanhã de manhã", "Quero mudar o horário"]) {
    assert.equal(ehApenasCortesia(t), false, `NÃO deveria ser cortesia: "${t}"`);
  }
});

test("SDR: reação e 'Até logo' depois do handoff não chamam a IA, não mandam 'probleminha' e não alertam o dono", { skip: !temBanco, timeout: 60_000 }, async () => {
  process.env.SDR_DEBOUNCE_MS = "0";
  process.env.OPENAI_API_KEY = "fake-openai-key";
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;

  let chamadasIA = 0;
  const enviados: string[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("api.openai.com")) {
      chamadasIA++;
      // O modelo "corretamente" não tem nada a dizer depois da despedida.
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ messages: [], updateSession: {}, action: "continue" }) } }] }), { status: 200 });
    }
    if (u.includes("graph.facebook.com")) {
      const corpo = init?.body ? JSON.parse(String(init.body)) as { text?: { body?: string }; to?: string } : {};
      if (corpo.text?.body) enviados.push(`${corpo.to}: ${corpo.text.body}`);
      return new Response(JSON.stringify({ messages: [{ id: `wamid.C${Math.random()}` }] }), { status: 200 });
    }
    return fetchOriginal(url, init);
  }) as typeof fetch;

  const { prisma } = await import("@/lib/prisma/client");
  const { processSdrResponse } = await import("@/lib/ai/sdr/agent");
  const { saveSdrSession } = await import("@/lib/ai/sdr/session");
  const { SDR_EMPTY_SESSION } = await import("@/lib/ai/sdr/types");
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: `c${Date.now()}`, documentId: "1", documentType: "CNPJ", tipo: "PROSPECCAO" } });
  await prisma.kanbanColumn.create({ data: { name: "Novos", order: 0, type: "TRIAGE", color: "#000", organizationId: org.id, isDefaultEntry: true } });
  const col = (await prisma.kanbanColumn.findFirst({ where: { organizationId: org.id } }))!;
  const cfg = await prisma.whatsappProviderConfig.create({ data: { organizationId: org.id, businessPhoneNumberId: `PC${Date.now()}`, accountName: "t", displayPhoneNumber: "1", accessToken: "fake-wa-token" } });
  const lead = await prisma.lead.create({ data: { phoneNumber: "5562955556666", profileName: "Eloisa", leadOrigin: "INBOUND", organizationId: org.id, kanbanColumnId: col.id } });
  const conv = await prisma.whatsappConversation.create({ data: { customerWhatsappBusinessId: "5562955556666", leadOrigin: "INBOUND", leadId: lead.id, whatsappProviderConfigId: cfg.id } });
  await saveSdrSession(conv.id, { ...SDR_EMPTY_SESSION, mode: "SDR", nome: "Eloisa", status: "handoff_enviado", etapa: "humano_assumiu" });

  const agent = { id: "a", aiProvider: "OPENAI", aiModel: "gpt-4o" };
  const msg = async (texto: string, i: number) => {
    const id = `wamid.C${Date.now()}${i}`;
    await prisma.whatsappMessage.create({ data: { id, content: texto, type: "TEXT", role: "USER", sentAt: new Date(Date.now() + i), conversationId: conv.id } });
    await processSdrResponse(conv.id, texto, agent, id);
  };
  try {
    await msg(TEXTO_REACAO, 1);
    await msg("Até logo", 2);
    await msg("Ok obrigado", 3);
    assert.equal(chamadasIA, 0, "nem chamou o modelo");
    assert.equal(enviados.length, 0, `nada enviado ao lead: ${enviados.join(" | ")}`);
    assert.equal(await prisma.whatsappMessage.count({ where: { conversationId: conv.id, role: "ASSISTANT" } }), 0, "sem 'tive um probleminha'");
    assert.equal(await prisma.ownerNotification.count({ where: { leadId: lead.id } }), 0, "sem alerta falso para o dono");

    // Pergunta de verdade depois do handoff continua indo para o modelo
    await msg("Posso mudar o horário?", 4);
    assert.ok(chamadasIA >= 1, "pergunta real ainda chega ao modelo");
  } finally {
    globalThis.fetch = fetchOriginal;
    await prisma.conversationFollowUp.deleteMany({ where: { conversationId: conv.id } });
    await prisma.whatsappMessage.deleteMany({ where: { conversationId: conv.id } });
    await prisma.whatsappConversation.delete({ where: { id: conv.id } });
    await prisma.leadActivity.deleteMany({ where: { leadId: lead.id } });
    await prisma.ownerNotification.deleteMany({ where: { organizationId: org.id } });
    await prisma.lead.delete({ where: { id: lead.id } });
    await prisma.whatsappProviderConfig.delete({ where: { id: cfg.id } });
    await prisma.kanbanColumn.deleteMany({ where: { organizationId: org.id } });
    await prisma.whatsappBusinessOrganization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
});
