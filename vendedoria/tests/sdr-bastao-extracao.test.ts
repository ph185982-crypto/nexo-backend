// Caso Eloisa/LYON DIESEL e Daniela (17/11/2026): o lead respondeu tudo, a IA escreveu a despedida
// ("vou te conectar com o Pedro…"), mas um campo (CNPJ) não foi gravado na sessão. O portão bloqueava o
// bastão e a despedida saía assim mesmo — o Pedro nunca soube do lead. Agora o dado é recuperado da conversa.
import test from "node:test";
import assert from "node:assert/strict";
import { pareceFechamento } from "@/lib/ai/sdr/anti-repeticao";
import { validarExtracao } from "@/lib/ai/sdr/extrair-sessao";

process.env.OWNER_WHATSAPP_NUMBER = "5562900000001";
const temBanco = Boolean(process.env.DATABASE_URL);

test("fechamento: reconhece as frases que a DeepSeek escreve; conversa normal não é fechamento", () => {
  for (const t of [
    "Vou te conectar com o Pedro, fundador da Avanteza — foi ele quem estruturou a operação de mais de 600 empresas",
    "Já salva o contato dele aí: 📲 Pedro | Avanteza: 62 98446-5388",
    "Ele te chama amanhã de manhã pra confirmar o horário com você",
    "Vou te passar pro Pedro, fundador da Avanteza",
  ]) assert.equal(pareceFechamento(t), true, t);
  for (const t of [
    "Oi, tudo bem?", "Vi que você veio pelo nosso anúncio", "Qual o nome da sua empresa?",
    "A gente ajuda empresas a crescer na Shopee e no Mercado Livre, já trabalhamos com bastante negócio aqui no Brasil",
    "Mais ou menos quanto o negócio fatura por mês? E a empresa tem CNPJ?", "Perfeito, ficou combinado então",
  ]) assert.equal(pareceFechamento(t), false, t);
});

test("extração: só aceita o que foi pedido e em formato válido", () => {
  assert.deepEqual(validarExtracao({ cnpj: "tem", empresa: "CleoArt", nome: "Cleonice" }, ["cnpj"]), { cnpj: "tem" }, "ignora o que não foi pedido");
  assert.deepEqual(validarExtracao({ cnpj: "Não tem" }, ["cnpj"]), { cnpj: "nao tem" });
  assert.deepEqual(validarExtracao({ cnpj: "talvez", loja_fisica: "sim" }, ["cnpj", "loja_fisica"]), { loja_fisica: "sim" });
  assert.deepEqual(validarExtracao({ nome: "Loja X 123" }, ["nome"]), {}, "nome que não parece de pessoa é descartado");
  assert.deepEqual(validarExtracao({ problema_principal: "vende pouco" }, ["dor"]), {}, "dor curta demais");
  assert.deepEqual(validarExtracao({ problema_principal: "loja física vende pouco e quer ir pro online" }, ["dor"]), { problema_principal: "loja física vende pouco e quer ir pro online" });
  assert.deepEqual(validarExtracao(null, ["cnpj"]), {});
  assert.deepEqual(validarExtracao({ cnpj: null }, ["cnpj"]), {});
});

test("SDR: despedida escrita pelo modelo com CNPJ não gravado → recupera da conversa e o bastão sai", { skip: !temBanco, timeout: 90_000 }, async () => {
  process.env.SDR_DEBOUNCE_MS = "0";
  process.env.DEEPSEEK_API_KEY = "chave-falsa-de-teste";
  process.env.OPENAI_API_KEY = "fake-openai-key";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  process.env.META_CAPI_DRY_RUN = "true";

  let extracoes = 0;
  const enviados: string[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("api.deepseek.com")) {
      const corpo = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
      if (corpo.messages[0].content.startsWith("Você extrai dados")) {
        extracoes++;
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ cnpj: "tem" }) } }] }), { status: 200 });
      }
      // O modelo escreve a despedida, mas com action=continue e sem gravar o CNPJ.
      const r = {
        messages: [{ text: "Vou te conectar com o Pedro, fundador da Avanteza", delay: 0 }, { text: "Já salva o contato dele aí", delay: 0 }],
        updateSession: {}, action: "continue",
      };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(r) } }] }), { status: 200 });
    }
    if (u.includes("graph.facebook.com")) {
      const corpo = init?.body ? JSON.parse(String(init.body)) as { text?: { body?: string }; to?: string } : {};
      if (corpo.text?.body) enviados.push(`${corpo.to}: ${corpo.text.body}`);
      return new Response(JSON.stringify({ messages: [{ id: `wamid.B${Math.random()}` }], success: true }), { status: 200 });
    }
    if (u.includes("googleapis.com")) return new Response("{}", { status: 401 });
    return fetchOriginal(url, init);
  }) as typeof fetch;

  const { prisma } = await import("@/lib/prisma/client");
  const { processSdrResponse } = await import("@/lib/ai/sdr/agent");
  const { saveSdrSession } = await import("@/lib/ai/sdr/session");
  const { SDR_EMPTY_SESSION } = await import("@/lib/ai/sdr/types");
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: `b${Date.now()}`, documentId: "1", documentType: "CNPJ", tipo: "PROSPECCAO" } });
  for (const [i, [name, type]] of ([["Novos", "TRIAGE"], ["Em qualificação", "CUSTOM"], ["Handoff enviado", "ESCALATED"], ["Fora do ICP", "LOST"]] as const).entries()) {
    await prisma.kanbanColumn.create({ data: { name, order: i, type, color: "#000", organizationId: org.id, isDefaultEntry: i === 0 } });
  }
  const col = (await prisma.kanbanColumn.findFirst({ where: { organizationId: org.id, type: "TRIAGE" } }))!;
  const cfg = await prisma.whatsappProviderConfig.create({ data: { organizationId: org.id, businessPhoneNumberId: `PB${Date.now()}`, accessToken: "fake-wa-token", accountName: "t", displayPhoneNumber: "1" } });
  const lead = await prisma.lead.create({ data: { phoneNumber: "5562977778888", profileName: "Eloisa", leadOrigin: "INBOUND", organizationId: org.id, kanbanColumnId: col.id } });
  const conv = await prisma.whatsappConversation.create({ data: { customerWhatsappBusinessId: "5562977778888", leadOrigin: "INBOUND", leadId: lead.id, whatsappProviderConfigId: cfg.id } });
  // Tudo respondido, exceto o CNPJ, que o lead disse por texto e o modelo não gravou.
  await saveSdrSession(conv.id, {
    ...SDR_EMPTY_SESSION, mode: "SDR", nome: "Eloisa", empresa: "LYON DIESEL", segmento: "cosméticos",
    problema_principal: "loja física vende pouco e quer migrar para o online", faturamento_total: "54 reais no primeiro dia",
    loja_fisica: "sim", tem_loja_fisica: true, disponibilidade: "amanhã às 9h", status: "em_qualificacao", etapa: "qualificacao",
  });
  const hist: Array<[string, string]> = [
    ["USER", "Sim tem cnpj na verdade tenho uma loja física com estoque e presencial não vendo muito não"],
    ["ASSISTANT", "Qual o melhor dia e horário pra você?"],
  ];
  for (const [i, [role, content]] of hist.entries()) {
    await prisma.whatsappMessage.create({ data: { id: `wamid.H${Date.now()}${i}`, content, type: "TEXT", role: role as "USER" | "ASSISTANT", sentAt: new Date(Date.now() - 60_000 + i * 1000), conversationId: conv.id } });
  }
  const msgId = `wamid.B${Date.now()}`;
  await prisma.whatsappMessage.create({ data: { id: msgId, content: "Poderia ser amanhã às 9 horas", type: "TEXT", role: "USER", sentAt: new Date(), conversationId: conv.id } });

  try {
    await processSdrResponse(conv.id, "Poderia ser amanhã às 9 horas", { id: "a", aiProvider: "OPENAI", aiModel: "gpt-4o" }, msgId);
    assert.ok(extracoes >= 1, "leu a conversa para recuperar o dado que faltava");
    const l = await prisma.lead.findUnique({ where: { id: lead.id }, include: { kanbanColumn: true } });
    assert.equal(l?.status, "ESCALATED", "o handoff foi executado");
    assert.ok(enviados.some((m) => m.startsWith("5562900000001")), `o Pedro recebeu o bastão: ${enviados.join(" | ")}`);
    assert.ok(enviados.some((m) => m.startsWith("5562977778888") && /Pedro/.test(m)), "o lead recebeu o fechamento");
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

test("follow-up: completa a sessão pela conversa — não pergunta o nome de quem já se apresentou (Luciana, Rosângela)", { timeout: 30_000 }, async () => {
  process.env.DEEPSEEK_API_KEY = "chave-falsa-de-teste";
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    if (String(url).includes("api.deepseek.com")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ nome: "Luciana", cnpj: "tem", segmento: "cintos no atacado" }) } }] }), { status: 200 });
    }
    return fetchOriginal(url);
  }) as typeof fetch;
  try {
    const { completarSessaoPelaConversa } = await import("@/lib/ai/sdr/extrair-sessao");
    const { promptFollowupSdr } = await import("@/lib/followup/conteudo");
    const { SDR_EMPTY_SESSION } = await import("@/lib/ai/sdr/types");
    // O modelo não gravou o nome nem o CNPJ, que a lead disse por texto.
    const sessao = { ...SDR_EMPTY_SESSION, mode: "SDR" as const, status: "em_qualificacao" as const };
    const antes = promptFollowupSdr(1, 3, sessao);
    assert.match(antes, /o nome da pessoa/, "sem completar, o acompanhamento mandaria perguntar o nome");
    const { sessao: completa, preenchidos } = await completarSessaoPelaConversa(sessao, [
      { role: "user", content: "Me chamo Luciana" }, { role: "assistant", content: "Prazer, Luciana. E o que você vende hoje?" },
      { role: "user", content: "Cintos no atacado" }, { role: "user", content: "Sim tem cnpj" },
    ]);
    assert.deepEqual(preenchidos.sort(), ["cnpj", "nome", "segmento"]);
    assert.equal(completa.nome, "Luciana");
    assert.equal(completa.cnpj, "tem");
    const depois = promptFollowupSdr(1, 3, completa);
    assert.doesNotMatch(depois, /o nome da pessoa/, "completada, não manda mais perguntar o nome");
    assert.match(depois, /nome: Luciana/);
    assert.match(depois, /NUNCA pergunte o nome/);
    // Sessão completa não gera chamada
    const completaDeNovo = await completarSessaoPelaConversa({ ...completa, empresa: "X", problema_principal: "vende pouco no atacado e quer crescer", faturamento_total: "20 mil", loja_fisica: "nao", disponibilidade: "hoje" }, []);
    assert.deepEqual(completaDeNovo.preenchidos, []);
  } finally { globalThis.fetch = fetchOriginal; }
});
