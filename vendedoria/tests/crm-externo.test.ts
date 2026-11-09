import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { detectarIntencoes } from "@/lib/crm-externo/intencoes";

const temBanco = Boolean(process.env.DATABASE_URL);

test("intenções: detecta o que importa e não marca falso positivo", () => {
  const casos: Array<[string, string[]]> = [
    ["Achei muito caro, o valor está alto", ["OBJECAO_PRECO"]],
    ["Isso fica fora do meu orçamento", ["OBJECAO_PRECO"]],
    ["Vou pensar e depois eu te falo", ["DECISAO_ADIADA"]],
    ["Preciso disso urgente, o mais rápido possível", ["URGENCIA_DECLARADA"]],
    ["Eu sou o dono, quem decide sou eu", ["DECISOR_IDENTIFICADO"]],
    ["Quero contratar! Pode mandar o contrato", ["SINAL_FECHAMENTO"]],
    ["Já uso outra consultoria hoje", ["CONCORRENTE_IDENTIFICADO"]],
    ["Posso investir uns 5 mil por mês", ["BUDGET_SINALIZADO"]],
    ["Faz sentido, gostei da proposta", ["PROVA_VALOR_ACEITA"]],
    ["Meu maior problema é o estoque", ["DOR_CONFIRMADA"]],
    ["Sou o dono, tá caro e vou pensar", ["OBJECAO_PRECO", "DECISAO_ADIADA"]], // no máximo 2, na ordem das regras
    // falsos positivos que NÃO podem disparar
    ["Tenho um carro velho na loja", []],
    ["Já tenho CNPJ e loja física", []],
    ["Não quero gastar muito agora", []],
    ["Bom dia, tudo bem?", []],
    ["ok", []], ["", []],
  ];
  for (const [msg, esperado] of casos) assert.deepEqual(detectarIntencoes(msg), esperado, msg);
  assert.deepEqual(detectarIntencoes("CARO demais, QUERO CONTRATAR"), ["OBJECAO_PRECO", "SINAL_FECHAMENTO"], "ignora caixa e acento");
  assert.deepEqual(detectarIntencoes("x".repeat(3000)), [], "mensagem enorme é ignorada");
});

test("mapeamento de etapa para evento e configuração", async () => {
  const { tipoEventoDaEtapa, crmConfigurado } = await import("@/lib/crm-externo/eventos");
  const esperado: Record<string, string | null> = {
    QUALIFICADO: "lead.qualificado", PROPOSTA: "lead.qualificado", PROPOSTA_NEGOCIACAO: "lead.qualificado", ESCALATED: "lead.escalado",
    LOST: "lead.perdido", DESCARTADO: "lead.perdido", JUNK: "lead.perdido", GANHO: "lead.ganho",
    REUNIAO_AGENDADA: null, EM_QUALIFICACAO: null, TRIAGE: null, CONTRATO: null, CUSTOM: null,
  };
  for (const [k, v] of Object.entries(esperado)) assert.equal(tipoEventoDaEtapa(k), v, k);
  assert.equal(crmConfigurado({ CRM_URL: "http://x", CRM_API_KEY: "k" } as never), true);
  assert.equal(crmConfigurado({ CRM_URL: "http://x" } as never), false);
  assert.equal(crmConfigurado({ CRM_URL: " ", CRM_API_KEY: "k" } as never), false);
  const { esperaAposTentativa } = await import("@/lib/crm-externo/outbox");
  assert.deepEqual([1, 2, 3, 7, 8, 20].map((n) => esperaAposTentativa(n) / 60_000), [1, 5, 30, 1440, 1440, 1440]);
});

/** Servidor que imita o CRM: responde o que o teste mandar e guarda o que recebeu. */
async function crmFalso(respostas: number[]) {
  const recebidos: Array<{ auth: string | undefined; corpo: Record<string, unknown> }> = [];
  const servidor = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => {
      recebidos.push({ auth: req.headers.authorization, corpo: JSON.parse(b || "{}") });
      const status = respostas.length > 1 ? respostas.shift()! : respostas[0];
      res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(status === 200 ? { status: "PROCESSADO" } : { erro: "falhou" }));
    });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`, recebidos, fechar: () => new Promise<void>((r) => servidor.close(() => r())) };
}

async function cenario() {
  const { prisma } = await import("@/lib/prisma/client");
  const marca = `c${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: marca, documentId: "1", documentType: "CNPJ" } });
  const defs: Array<[string, string]> = [["Novos", "TRIAGE"], ["Qualificados", "PROPOSTA_NEGOCIACAO"], ["Handoff", "ESCALATED"], ["Reunião", "REUNIAO_AGENDADA"], ["Perdido", "LOST"], ["Ganho", "GANHO"]];
  for (const [i, [name, type]] of defs.entries()) await prisma.kanbanColumn.create({ data: { name, order: i, type, color: "#000", organizationId: org.id, isDefaultEntry: type === "TRIAGE" } });
  const novos = (await prisma.kanbanColumn.findFirst({ where: { organizationId: org.id, type: "TRIAGE" } }))!;
  const lead = await prisma.lead.create({ data: { phoneNumber: `5562${Math.floor(Math.random() * 1e8)}`, leadOrigin: "INBOUND", profileName: "João", organizationId: org.id, kanbanColumnId: novos.id, adHeadline: "Anúncio X" } });
  const limpar = async () => {
    await prisma.crmEventoOutbox.deleteMany({ where: { leadId: lead.id } });
    await prisma.leadActivity.deleteMany({ where: { leadId: lead.id } });
    await prisma.metaConversionEvent.deleteMany({ where: { leadId: lead.id } });
    await prisma.lead.deleteMany({ where: { organizationId: org.id } });
    await prisma.motivoEncerramento.deleteMany({ where: { organizationId: org.id } });
    await prisma.kanbanColumn.deleteMany({ where: { organizationId: org.id } });
    await prisma.whatsappBusinessOrganization.delete({ where: { id: org.id } });
  };
  return { prisma, org, lead, limpar };
}
const esperar = async (cond: () => Promise<boolean>, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 40)); } return false; };

test("outbox: desligado não grava; envio ok marca ENVIADO com chave e payload", { skip: !temBanco }, async () => {
  const { emitirEventoCrm } = await import("@/lib/crm-externo/eventos");
  const { despacharOutboxCrm } = await import("@/lib/crm-externo/outbox");
  const c = await cenario();
  const crm = await crmFalso([200]);
  try {
    delete process.env.CRM_URL; delete process.env.CRM_API_KEY;
    assert.equal(await emitirEventoCrm({ tipo: "lead.qualificado", leadId: c.lead.id }), "desligado");
    assert.equal(await c.prisma.crmEventoOutbox.count({ where: { leadId: c.lead.id } }), 0);

    process.env.CRM_URL = crm.url + "/"; process.env.CRM_API_KEY = "avz_live_teste";
    assert.equal(await emitirEventoCrm({ tipo: "lead.qualificado", leadId: c.lead.id, dados: { empresa: "Oficina Rocha", faturamentoMensal: 60000, nome: "João da Oficina" }, chave: `k:${c.lead.id}` }), "enfileirado");
    assert.equal(await emitirEventoCrm({ tipo: "lead.qualificado", leadId: c.lead.id, chave: `k:${c.lead.id}` }), "duplicado");
    assert.ok(await esperar(async () => (await c.prisma.crmEventoOutbox.findFirst({ where: { leadId: c.lead.id } }))?.status === "ENVIADO"), "enviado em segundo plano");

    assert.equal(crm.recebidos.length, 1);
    assert.equal(crm.recebidos[0].auth, "Bearer avz_live_teste");
    const ev = crm.recebidos[0].corpo as { eventoId: string; tipo: string; lead: Record<string, unknown> };
    assert.deepEqual([ev.eventoId, ev.tipo], [`k:${c.lead.id}`, "lead.qualificado"]);
    assert.deepEqual([ev.lead.id, ev.lead.empresa, ev.lead.faturamentoMensal, ev.lead.nome, ev.lead.origem], [c.lead.id, "Oficina Rocha", 60000, "João da Oficina", "Click-to-WhatsApp"], "dados da sessão valem mais que o banco");
    assert.deepEqual(await despacharOutboxCrm(), { enviados: 0, falhas: 0, adiados: 0 }, "nada pendente");
  } finally { await crm.fechar(); delete process.env.CRM_URL; delete process.env.CRM_API_KEY; await c.limpar(); }
});

test("outbox: 500 reagenda e reenvia; 400 é definitivo; esgota tentativas; envio paralelo não duplica", { skip: !temBanco }, async () => {
  const { despacharOutboxCrm, MAX_TENTATIVAS } = await import("@/lib/crm-externo/outbox");
  const c = await cenario();
  const crm = await crmFalso([500, 500, 200]);
  const novo = (eventoId: string) => c.prisma.crmEventoOutbox.create({ data: { eventoId: `${eventoId}:${c.lead.id}`, tipo: "lead.escalado", leadId: c.lead.id, payload: { eventoId: `${eventoId}:${c.lead.id}`, tipo: "lead.escalado", lead: { id: c.lead.id } } } });
  const ler = (eventoId: string) => c.prisma.crmEventoOutbox.findUnique({ where: { eventoId: `${eventoId}:${c.lead.id}` } });
  try {
    process.env.CRM_URL = crm.url; process.env.CRM_API_KEY = "avz_live_teste";
    await novo("a");
    const t0 = new Date();
    assert.deepEqual(await despacharOutboxCrm({ agora: t0 }), { enviados: 0, falhas: 0, adiados: 1 });
    let a = (await ler("a"))!;
    assert.deepEqual([a.status, a.tentativas, a.ultimoErro?.startsWith("HTTP 500")], ["PENDENTE", 1, true]);
    assert.equal(a.proximaTentativaEm.getTime(), t0.getTime() + 60_000, "espera de 1 minuto");
    assert.deepEqual(await despacharOutboxCrm({ agora: new Date(t0.getTime() + 30_000) }), { enviados: 0, falhas: 0, adiados: 0 }, "ainda não venceu");
    await despacharOutboxCrm({ agora: new Date(t0.getTime() + 61_000) });
    a = (await ler("a"))!;
    assert.deepEqual([a.status, a.tentativas], ["PENDENTE", 2]);
    assert.deepEqual(await despacharOutboxCrm({ agora: new Date(t0.getTime() + 61_000 + 5 * 60_000 + 1000) }), { enviados: 1, falhas: 0, adiados: 0 });
    a = (await ler("a"))!;
    assert.deepEqual([a.status, a.tentativas, a.ultimoErro, a.enviadoEm !== null], ["ENVIADO", 3, null, true]);
    assert.equal(new Set(crm.recebidos.map((r) => r.corpo.eventoId)).size, 1, "mesmo eventoId em todas as tentativas");
  } finally { await crm.fechar(); }

  const crm400 = await crmFalso([400]);
  try {
    process.env.CRM_URL = crm400.url;
    await novo("b");
    assert.deepEqual(await despacharOutboxCrm(), { enviados: 0, falhas: 1, adiados: 0 });
    assert.deepEqual([(await ler("b"))!.status, (await ler("b"))!.tentativas], ["FALHOU", 1]);
    assert.equal(crm400.recebidos.length, 1, "400 não é reenviado");
  } finally { await crm400.fechar(); }

  const crm503 = await crmFalso([503]);
  try {
    process.env.CRM_URL = crm503.url;
    await novo("c");
    let agora = new Date();
    for (let i = 0; i < MAX_TENTATIVAS; i++) { await despacharOutboxCrm({ agora }); agora = new Date(agora.getTime() + 2 * 86_400_000); }
    const cc = (await ler("c"))!;
    assert.deepEqual([cc.status, cc.tentativas], ["FALHOU", MAX_TENTATIVAS]);
    assert.equal(crm503.recebidos.length, MAX_TENTATIVAS);
  } finally { await crm503.fechar(); }

  const crmOk = await crmFalso([200]);
  try {
    process.env.CRM_URL = crmOk.url;
    await novo("d");
    const [r1, r2] = await Promise.all([despacharOutboxCrm(), despacharOutboxCrm()]);
    assert.equal(r1.enviados + r2.enviados, 1, "duas rodadas simultâneas: um envio só");
    assert.equal(crmOk.recebidos.length, 1);
    // CRM fora do ar (conexão recusada) também reagenda
    await crmOk.fechar();
    await novo("e");
    assert.deepEqual(await despacharOutboxCrm(), { enviados: 0, falhas: 0, adiados: 1 });
  } finally { delete process.env.CRM_URL; delete process.env.CRM_API_KEY; await c.limpar(); }
});

test("ganchos: moverLeadPorTipo emite qualificado/escalado/perdido; reunião não duplica; intenção deduplica por dia", { skip: !temBanco }, async () => {
  process.env.META_CAPI_DRY_RUN = "true";
  const { moverLeadPorTipo } = await import("@/lib/crm/pipeline-mover");
  const { emitirIntencoesDaMensagem } = await import("@/lib/crm-externo/eventos");
  const c = await cenario();
  const crm = await crmFalso([200]);
  const tipos = async () => (await c.prisma.crmEventoOutbox.findMany({ where: { leadId: c.lead.id }, orderBy: { criadoEm: "asc" } })).map((e) => e.tipo);
  try {
    process.env.CRM_URL = crm.url; process.env.CRM_API_KEY = "avz_live_teste";
    assert.equal(await moverLeadPorTipo(c.lead.id, c.org.id, "QUALIFICADO", "ok", undefined, { dadosCrm: { empresa: "Oficina Rocha", dorPrincipal: "margem" } }), true);
    assert.deepEqual(await tipos(), ["lead.qualificado"]);
    const q = (await c.prisma.crmEventoOutbox.findFirst({ where: { tipo: "lead.qualificado", leadId: c.lead.id } }))!.payload as { lead: { empresa: string; dorPrincipal: string } };
    assert.deepEqual([q.lead.empresa, q.lead.dorPrincipal], ["Oficina Rocha", "margem"]);

    // No mapa canônico REUNIAO_AGENDADA e ESCALATED resolvem para a mesma coluna de QUALIFICADO:
    // o movimento é no-op (false), mas o aviso de escalada TEM que sair (segue a intenção, não a coluna).
    assert.equal(await moverLeadPorTipo(c.lead.id, c.org.id, "REUNIAO_AGENDADA"), false);
    assert.deepEqual(await tipos(), ["lead.qualificado"], "REUNIAO_AGENDADA não emite evento genérico (o SDR manda reuniao.agendada com horário)");
    assert.equal(await moverLeadPorTipo(c.lead.id, c.org.id, "ESCALATED"), false, "mesma coluna");
    assert.deepEqual(await tipos(), ["lead.qualificado", "lead.escalado"], "escalada sai mesmo sem mudar de coluna");
    await moverLeadPorTipo(c.lead.id, c.org.id, "ESCALATED");
    assert.deepEqual(await tipos(), ["lead.qualificado", "lead.escalado"], "repetição na mesma hora colapsa");
    assert.equal(await moverLeadPorTipo(c.lead.id, c.org.id, "LOST", "fora", undefined, { motivoEncerramento: "Fora do perfil (ICP)" }), true);
    assert.deepEqual(await tipos(), ["lead.qualificado", "lead.escalado", "lead.perdido"]);
    const perdido = (await c.prisma.crmEventoOutbox.findFirst({ where: { tipo: "lead.perdido", leadId: c.lead.id } }))!.payload as { motivo: string };
    assert.equal(perdido.motivo, "Fora do perfil (ICP)");

    // intenção: 1 por (lead, sinal, dia); mensagem sem sinal não gera nada
    assert.equal(await emitirIntencoesDaMensagem(c.lead.id, "tá caro, vou pensar"), 2);
    assert.equal(await emitirIntencoesDaMensagem(c.lead.id, "tá caro de novo"), 0, "mesmo sinal no mesmo dia");
    assert.equal(await emitirIntencoesDaMensagem(c.lead.id, "bom dia"), 0);
    const ints = await c.prisma.crmEventoOutbox.findMany({ where: { tipo: "intencao.detectada", leadId: c.lead.id } });
    assert.deepEqual(ints.map((e) => (e.payload as { intencao: string }).intencao).sort(), ["DECISAO_ADIADA", "OBJECAO_PRECO"]);
    assert.ok(await esperar(async () => (await c.prisma.crmEventoOutbox.count({ where: { leadId: c.lead.id, status: "ENVIADO" } })) === 5), "tudo entregue ao CRM falso");
  } finally { await crm.fechar(); delete process.env.CRM_URL; delete process.env.CRM_API_KEY; await c.limpar(); }
});

test("outbox: orçamento de tempo e timeout curto — CRM travado não prende quem despacha", { skip: !temBanco }, async () => {
  const { despacharOutboxCrm } = await import("@/lib/crm-externo/outbox");
  const c = await cenario();
  // Servidor que aceita e nunca responde.
  const sockets = new Set<import("node:net").Socket>();
  const travado = http.createServer(() => {});
  travado.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise<void>((r) => travado.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(travado.address() as AddressInfo).port}`;
  try {
    process.env.CRM_URL = url; process.env.CRM_API_KEY = "avz_live_teste";
    for (const id of ["t1", "t2", "t3"]) {
      await c.prisma.crmEventoOutbox.create({ data: { eventoId: `${id}:${c.lead.id}`, tipo: "lead.escalado", leadId: c.lead.id, payload: { eventoId: `${id}:${c.lead.id}`, tipo: "lead.escalado", lead: { id: c.lead.id } } } });
    }
    const t = Date.now();
    const r = await despacharOutboxCrm({ timeoutMs: 300, orcamentoMs: 400 });
    const gasto = Date.now() - t;
    assert.ok(gasto < 1500, `volta no prazo (levou ${gasto}ms)`);
    assert.equal(r.adiados, 2, "só 2 de 3 começaram: o orçamento cortou o resto");
    const pend = await c.prisma.crmEventoOutbox.findMany({ where: { leadId: c.lead.id }, orderBy: { eventoId: "asc" } });
    assert.deepEqual(pend.map((p) => [p.status, p.tentativas]), [["PENDENTE", 1], ["PENDENTE", 1], ["PENDENTE", 0]], "o que não começou fica intocado para a próxima rodada");
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => travado.close(() => r()));
    delete process.env.CRM_URL; delete process.env.CRM_API_KEY; await c.limpar();
  }
});

test("SDR: o gancho de intenção roda antes do debounce (rajada não perde sinal)", async () => {
  const { readFileSync } = await import("node:fs");
  const fonte = readFileSync("src/lib/ai/sdr/agent.ts", "utf8");
  const corpo = fonte.slice(fonte.indexOf("async function runSdrResponse("));
  const gancho = corpo.indexOf("emitirIntencoesDaMensagem(");
  const espera = corpo.indexOf("setTimeout(r, DEBOUNCE_MS)");
  assert.ok(gancho > 0 && espera > 0, "os dois pontos existem");
  assert.ok(gancho < espera, "gancho vem antes do debounce");
});

test("motivos: catálogo padrão é garantido uma vez por organização (cache) e recriado se for outra", { skip: !temBanco }, async () => {
  const { garantirMotivosPadrao, listarMotivos } = await import("@/lib/crm/motivos");
  const c = await cenario();
  try {
    await garantirMotivosPadrao(c.org.id);
    const n = await c.prisma.motivoEncerramento.count({ where: { organizationId: c.org.id } });
    assert.ok(n >= 15, "catálogo criado");
    // Apaga por fora: dentro da validade do cache, não é recriado (prova que o cache evita o INSERT).
    await c.prisma.motivoEncerramento.deleteMany({ where: { organizationId: c.org.id } });
    await garantirMotivosPadrao(c.org.id);
    assert.equal(await c.prisma.motivoEncerramento.count({ where: { organizationId: c.org.id } }), 0, "segunda chamada não toca o banco");
    // Outra organização não é afetada pelo cache da primeira.
    const outra = await c.prisma.whatsappBusinessOrganization.create({ data: { name: `o${Date.now()}`, documentId: "2", documentType: "CNPJ" } });
    try {
      assert.ok((await listarMotivos(outra.id)).length >= 15, "organização nova recebe o catálogo");
    } finally {
      await c.prisma.motivoEncerramento.deleteMany({ where: { organizationId: outra.id } });
      await c.prisma.whatsappBusinessOrganization.delete({ where: { id: outra.id } });
    }
  } finally { await c.limpar(); }
});

test("conversas: pergunta antes de mandar; lead desconhecido fica IGNORADO sem conteúdo; conhecido manda só o que é novo; evento reabre", { skip: !temBanco }, async () => {
  const { sincronizarConversaCrm, sincronizarConversasCrm } = await import("@/lib/crm-externo/conversas");
  const { emitirEventoCrm } = await import("@/lib/crm-externo/eventos");
  const c = await cenario();
  const prov = await c.prisma.whatsappProviderConfig.create({ data: { accountName: "t", displayPhoneNumber: "1", businessPhoneNumberId: `pn-${c.org.id}`, organizationId: c.org.id } });
  const conv = await c.prisma.whatsappConversation.create({ data: { customerWhatsappBusinessId: c.lead.phoneNumber, leadOrigin: "INBOUND", leadId: c.lead.id, whatsappProviderConfigId: prov.id, lastMessageAt: new Date() } });
  const msg = (seg: number, role: string, content: string, extra: Record<string, unknown> = {}) => c.prisma.whatsappMessage.create({ data: { content, type: "TEXT", role, sentAt: new Date(Date.now() - 600_000 + seg * 1000), conversationId: conv.id, ...extra } });
  // CRM falso: conhece o lead só a partir do 3º pedido
  let conhece = false, recusar = false;
  const recebidos: Array<Record<string, unknown>> = [];
  const http = await import("node:http");
  const servidor = http.createServer((req, res) => {
    let b = ""; req.on("data", (x) => (b += x));
    req.on("end", () => {
      const corpo = JSON.parse(b || "{}");
      if (!req.url?.endsWith("/conversas")) { res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); return; } // evento do outbox
      recebidos.push(corpo);
      if (recusar && (corpo.mensagens as unknown[]).length) { res.writeHead(400, { "content-type": "application/json" }); res.end('{"erro":"Mensagem 1 sem texto"}'); return; }
      const status = !conhece ? "IGNORADO" : (corpo.mensagens as unknown[]).length ? "PROCESSADO" : "CONHECIDO";
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ status }));
    });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  try {
    process.env.CRM_URL = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`; process.env.CRM_API_KEY = "avz_live_teste";
    await msg(1, "USER", "Quero saber da consultoria");
    await msg(2, "ASSISTANT", "Claro! Qual o faturamento?");
    assert.equal(await sincronizarConversaCrm(conv.id), "ignorada");
    assert.deepEqual(recebidos.map((r) => (r.mensagens as unknown[]).length), [0], "só perguntou: nenhum conteúdo saiu");
    assert.equal((await c.prisma.whatsappConversation.findUnique({ where: { id: conv.id } }))!.crmStatus, "IGNORADO");
    assert.equal(await sincronizarConversaCrm(conv.id), "ignorada", "não pergunta de novo");
    assert.equal(recebidos.length, 1);

    // o lead vira evento do CRM: reabre e passa a mandar
    conhece = true;
    assert.equal(await emitirEventoCrm({ tipo: "lead.qualificado", leadId: c.lead.id, chave: `q:${c.lead.id}` }), "enfileirado");
    assert.equal((await c.prisma.whatsappConversation.findUnique({ where: { id: conv.id } }))!.crmStatus, null);
    const antes = recebidos.length;
    assert.equal(await sincronizarConversaCrm(conv.id), "enviada");
    const lote = recebidos.slice(antes).filter((r) => (r.mensagens as unknown[] | undefined)?.length);
    assert.equal(lote.length, 1);
    const ms = lote[0].mensagens as Array<{ deMim: boolean; texto: string; autor: string }>;
    assert.deepEqual(ms.map((m) => [m.deMim, m.texto]), [[false, "Quero saber da consultoria"], [true, "Claro! Qual o faturamento?"]]);
    assert.equal(lote[0].leadId, c.lead.id);
    assert.equal(await sincronizarConversaCrm(conv.id), "nada", "nada novo");
    await msg(30, "USER", "", { type: "IMAGE", caption: "nosso faturamento" });
    const n = recebidos.length;
    assert.deepEqual(await sincronizarConversasCrm({ limite: 50 }), { enviadas: 1, ignoradas: 0, falhas: 0 });
    const ultimo = recebidos.slice(n).find((r) => (r.mensagens as unknown[]).length)!;
    assert.deepEqual((ultimo.mensagens as Array<{ texto: string }>).map((m) => m.texto), ['[Imagem] "nosso faturamento"'], "só a nova, mídia com rótulo");
    // CRM recusa o lote (400): a marca avança para a conversa não travar
    recusar = true;
    const recusada = await msg(40, "USER", "algo que o CRM recusa");
    assert.equal(await sincronizarConversaCrm(conv.id), "nada");
    assert.equal((await c.prisma.whatsappConversation.findUnique({ where: { id: conv.id } }))!.crmSincronizadoAte?.getTime(), recusada.sentAt.getTime());
  } finally {
    await new Promise<void>((r) => servidor.close(() => r()));
    delete process.env.CRM_URL; delete process.env.CRM_API_KEY;
    await c.prisma.whatsappMessage.deleteMany({ where: { conversationId: conv.id } });
    await c.prisma.whatsappConversation.deleteMany({ where: { leadId: c.lead.id } });
    await c.prisma.whatsappProviderConfig.delete({ where: { id: prov.id } });
    await c.limpar();
  }
});

test("coexistência: eco do app WhatsApp Business vira mensagem do consultor e tira a IA da conversa", { skip: !temBanco }, async () => {
  const { createHmac } = await import("node:crypto");
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/webhooks/whatsapp/route");
  const c = await cenario();
  const prov = await c.prisma.whatsappProviderConfig.create({ data: { accountName: "consultor", displayPhoneNumber: "1", businessPhoneNumberId: `pn-eco-${c.org.id}`, organizationId: c.org.id } });
  process.env.META_WHATSAPP_APP_SECRET = "segredo-teste";
  const enviar = (value: unknown) => {
    const body = JSON.stringify({ entry: [{ id: "waba", changes: [{ field: "smb_message_echoes", value }] }] });
    const sig = "sha256=" + createHmac("sha256", "segredo-teste").update(body).digest("hex");
    return POST(new NextRequest("http://x/api/webhooks/whatsapp", { method: "POST", body, headers: { "x-hub-signature-256": sig, "x-nexo-webhook-retry": "1" } }));
  };
  const ts = String(Math.floor(Date.now() / 1000));
  const eco = { id: `wamid.eco.${c.org.id}`, from: "1", to: c.lead.phoneNumber, timestamp: ts, type: "text", text: { body: "Te mando o contrato hoje" } };
  try {
    await enviar({ metadata: { phone_number_id: prov.businessPhoneNumberId }, message_echoes: [eco] });
    await enviar({ metadata: { phone_number_id: prov.businessPhoneNumberId }, message_echoes: [eco] }); // repetido: ignora
    const conv = await c.prisma.whatsappConversation.findFirstOrThrow({ where: { leadId: c.lead.id, whatsappProviderConfigId: prov.id } });
    assert.equal(conv.humanTakeover, true);
    const msgs = await c.prisma.whatsappMessage.findMany({ where: { conversationId: conv.id } });
    assert.deepEqual(msgs.map((m) => [m.role, m.content, m.wamid]), [["ASSISTANT", "Te mando o contrato hoje", eco.id]]);
    // número sem cadastro: não faz nada
    await enviar({ metadata: { phone_number_id: "desconhecido" }, message_echoes: [{ ...eco, id: "outro" }] });
    assert.equal(await c.prisma.whatsappMessage.count({ where: { id: "outro" } }), 0);
  } finally {
    delete process.env.META_WHATSAPP_APP_SECRET;
    await c.prisma.whatsappMessage.deleteMany({ where: { conversation: { leadId: c.lead.id } } });
    await c.prisma.whatsappConversation.deleteMany({ where: { leadId: c.lead.id } });
    await c.prisma.whatsappProviderConfig.delete({ where: { id: prov.id } });
    await c.limpar();
  }
});
