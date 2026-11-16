// Ponte interna (F5/C10): com COMERCIAL_NATIVO=1 os eventos que iam por HTTP ao CRM antigo são tratados em
// processo pelo Comercial (com_*), idempotentes por eventoId; com a flag desligada nada muda (HTTP, como antes).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { cenario as cenarioComercial } from "./_comercial-cenario";

const temBanco = Boolean(process.env.DATABASE_URL);

async function crmFalso() {
  const recebidos: unknown[] = [];
  const s = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => { recebidos.push(JSON.parse(b || "{}")); res.writeHead(200, { "content-type": "application/json" }); res.end('{"status":"PROCESSADO"}'); });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, recebidos, fechar: () => new Promise<void>((r) => s.close(() => r())) };
}

async function leadComColunas(marca: string) {
  const { prisma } = await import("@/lib/prisma/client");
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: marca, documentId: "1", documentType: "CNPJ" } });
  const defs: Array<[string, string]> = [["Novos", "TRIAGE"], ["Qualificados", "PROPOSTA_NEGOCIACAO"], ["Perdido", "LOST"], ["Ganho", "GANHO"]];
  for (const [i, [name, type]] of defs.entries()) await prisma.kanbanColumn.create({ data: { name, order: i, type, color: "#000", organizationId: org.id, isDefaultEntry: type === "TRIAGE" } });
  const novos = (await prisma.kanbanColumn.findFirst({ where: { organizationId: org.id, type: "TRIAGE" } }))!;
  const lead = await prisma.lead.create({ data: { phoneNumber: `5562${Math.floor(Math.random() * 1e8)}`, leadOrigin: "INBOUND", profileName: `Maria ${marca}`, empresa: `Loja ${marca}`, organizationId: org.id, kanbanColumnId: novos.id, adHeadline: "Anúncio" } });
  const limpar = async () => {
    const ops = await prisma.comOportunidade.findMany({ where: { leadId: lead.id }, select: { id: true } });
    await prisma.comEntrega.deleteMany({ where: { oportunidadeId: { in: ops.map((o) => o.id) } } });
    await prisma.comTarefa.deleteMany({ where: { oportunidadeId: { in: ops.map((o) => o.id) } } });
    await prisma.comOportunidade.deleteMany({ where: { leadId: lead.id } });
    await prisma.comContato.deleteMany({ where: { OR: [{ leadId: lead.id }, { nome: `Loja ${marca}` }] } });
    await prisma.comEventoIntegracao.deleteMany({ where: { eventoId: { contains: lead.id } } });
    await prisma.crmEventoOutbox.deleteMany({ where: { leadId: lead.id } });
    await prisma.leadActivity.deleteMany({ where: { leadId: lead.id } });
    await prisma.metaConversionEvent.deleteMany({ where: { leadId: lead.id } });
    await prisma.leadStageHistory.deleteMany({ where: { leadId: lead.id } });
    await prisma.clientDiagnosis.deleteMany({ where: { leadId: lead.id } });
    await prisma.lead.deleteMany({ where: { organizationId: org.id } });
    await prisma.motivoEncerramento.deleteMany({ where: { organizationId: org.id } });
    await prisma.kanbanColumn.deleteMany({ where: { organizationId: org.id } });
    await prisma.whatsappBusinessOrganization.delete({ where: { id: org.id } });
  };
  return { prisma, org, lead, limpar };
}

const restaurarEnv = (k: string[]) => { const antes = Object.fromEntries(k.map((x) => [x, process.env[x]])); return () => { for (const [x, v] of Object.entries(antes)) if (v === undefined) delete process.env[x]; else process.env[x] = v; }; };

test("flags: nativo liga os eventos mesmo sem CRM_URL; espelho de conversas só no modo HTTP", async () => {
  const { comercialNativo, eventosComercialAtivos, crmConfigurado } = await import("@/lib/crm-externo/eventos");
  assert.equal(comercialNativo({} as never), false);
  assert.equal(comercialNativo({ COMERCIAL_NATIVO: "1" } as never), true);
  assert.equal(comercialNativo({ COMERCIAL_NATIVO: "true" } as never), false, "só o valor 1 liga");
  assert.equal(eventosComercialAtivos({ COMERCIAL_NATIVO: "1" } as never), true);
  assert.equal(eventosComercialAtivos({ CRM_URL: "http://x", CRM_API_KEY: "k" } as never), true);
  assert.equal(eventosComercialAtivos({} as never), false);
  assert.equal(crmConfigurado({ COMERCIAL_NATIVO: "1" } as never), false);
});

test("flag desligada: tudo como antes (HTTP ao CRM antigo; nada nas tabelas com_*)", { skip: !temBanco }, async () => {
  const volta = restaurarEnv(["COMERCIAL_NATIVO", "CRM_URL", "CRM_API_KEY", "META_CAPI_DRY_RUN"]);
  const { emitirEventoCrm } = await import("@/lib/crm-externo/eventos");
  const { despacharOutboxCrm } = await import("@/lib/crm-externo/outbox");
  const marca = `pn${Date.now()}`;
  const c = await leadComColunas(marca);
  const crm = await crmFalso();
  try {
    delete process.env.COMERCIAL_NATIVO; delete process.env.CRM_URL; delete process.env.CRM_API_KEY;
    assert.equal(await emitirEventoCrm({ tipo: "lead.qualificado", leadId: c.lead.id }), "desligado", "sem flag e sem CRM: nada");
    process.env.CRM_URL = crm.url; process.env.CRM_API_KEY = "avz_live_teste";
    assert.equal(await emitirEventoCrm({ tipo: "lead.qualificado", leadId: c.lead.id, chave: `q:${c.lead.id}` }), "enfileirado");
    await despacharOutboxCrm();
    for (let i = 0; i < 50 && crm.recebidos.length === 0; i++) await new Promise((r) => setTimeout(r, 40));
    assert.equal(crm.recebidos.length, 1, "foi por HTTP");
    assert.equal((await c.prisma.crmEventoOutbox.findUnique({ where: { eventoId: `q:${c.lead.id}` } }))!.status, "ENVIADO");
    assert.equal(await c.prisma.comOportunidade.count({ where: { leadId: c.lead.id } }), 0, "o Comercial nativo não foi tocado");
    assert.equal(await c.prisma.comEventoIntegracao.count({ where: { eventoId: `q:${c.lead.id}` } }), 0);
  } finally { await crm.fechar(); volta(); await c.limpar(); }
});

test("flag ligada: qualificado → oportunidade em processo, idempotente por eventoId; ganho sem duplicar CAPI; sem HTTP", { skip: !temBanco }, async () => {
  const volta = restaurarEnv(["COMERCIAL_NATIVO", "CRM_URL", "CRM_API_KEY", "META_CAPI_DRY_RUN"]);
  process.env.META_CAPI_DRY_RUN = "true";
  const { definirAgendadorNativo, emitirEventoCrm } = await import("@/lib/crm-externo/eventos");
  const { despacharOutboxCrm } = await import("@/lib/crm-externo/outbox");
  const { moverLeadPorTipo } = await import("@/lib/crm/pipeline-mover");
  const { sincronizarConversaCrm } = await import("@/lib/crm-externo/conversas");
  const com = await cenarioComercial(true); // funil padrão de teste (vence o semeado)
  const marca = `pn${Date.now()}`;
  const c = await leadComColunas(marca);
  const crm = await crmFalso();
  const agendados: Array<() => Promise<unknown>> = [];
  definirAgendadorNativo((t) => { agendados.push(t); });
  const rodarAgendados = async () => { while (agendados.length) await agendados.shift()!(); };
  try {
    process.env.COMERCIAL_NATIVO = "1";
    process.env.CRM_URL = crm.url; process.env.CRM_API_KEY = "avz_live_teste"; // mesmo configurado, o nativo não usa HTTP

    // pipeline-mover emite lead.qualificado, move o Lead e só DEPOIS (agendado) o Comercial trata o evento
    assert.equal(await moverLeadPorTipo(c.lead.id, c.org.id, "QUALIFICADO", "ok", undefined, { dadosCrm: { empresa: `Loja ${marca}` } }), true);
    assert.equal(agendados.length, 1, "entrega agendada para depois da resposta, não no meio do movimento do Lead");
    assert.equal(await c.prisma.comOportunidade.count({ where: { leadId: c.lead.id } }), 0, "ainda não tratado");
    await rodarAgendados();
    const ops = await c.prisma.comOportunidade.findMany({ where: { leadId: c.lead.id }, include: { etapa: true } });
    assert.equal(ops.length, 1);
    assert.ok((await c.prisma.comFunil.findUniqueOrThrow({ where: { id: ops[0].funilId } })).padrao, "funil padrão");
    assert.match(ops[0].etapa.nome, /Qualifica/);
    const ev = await c.prisma.crmEventoOutbox.findFirst({ where: { leadId: c.lead.id, tipo: "lead.qualificado" } });
    assert.equal(ev!.status, "ENVIADO", "a outbox segue como trilha");
    assert.equal((await c.prisma.comEventoIntegracao.findUnique({ where: { eventoId: ev!.eventoId } }))!.status, "PROCESSADO");

    // idempotência: o mesmo eventoId reaplicado (ex.: replay dos PENDENTES no corte) não cria outra oportunidade
    await c.prisma.crmEventoOutbox.update({ where: { id: ev!.id }, data: { status: "PENDENTE", proximaTentativaEm: new Date(0) } });
    assert.deepEqual(await despacharOutboxCrm(), { enviados: 1, falhas: 0, adiados: 0 });
    assert.equal(await c.prisma.comOportunidade.count({ where: { leadId: c.lead.id } }), 1, "eventoId repetido = DUPLICADO");
    // mesma intenção com outra chave (outra hora) também não abre outra: 1 oportunidade em andamento por lead
    assert.equal(await emitirEventoCrm({ tipo: "lead.qualificado", leadId: c.lead.id, chave: `outra:${c.lead.id}` }), "enfileirado");
    await rodarAgendados();
    assert.equal(await c.prisma.comOportunidade.count({ where: { leadId: c.lead.id } }), 1);

    // evento inválido é definitivo (como o 400 do CRM)
    await c.prisma.crmEventoOutbox.create({ data: { eventoId: `x:${c.lead.id}`, tipo: "lead.escalado", leadId: c.lead.id, payload: { eventoId: "curto", tipo: "lead.escalado" } } });
    assert.deepEqual(await despacharOutboxCrm(), { enviados: 0, falhas: 1, adiados: 0 });

    // ganho: oportunidade GANHA, CAPI sem duplicata (MetaConversionEvent único por lead e evento)
    assert.equal(await moverLeadPorTipo(c.lead.id, c.org.id, "GANHO", "fechou"), true);
    await rodarAgendados();
    const op = await c.prisma.comOportunidade.findUniqueOrThrow({ where: { id: ops[0].id } });
    assert.equal(op.status, "GANHA");
    const capi = await c.prisma.metaConversionEvent.groupBy({ by: ["eventName"], where: { leadId: c.lead.id }, _count: true });
    for (const g of capi) assert.equal(g._count, 1, `CAPI ${g.eventName} sem duplicata`);
    // reaplicar o ganho também não duplica
    const ganho = await c.prisma.crmEventoOutbox.findFirst({ where: { leadId: c.lead.id, tipo: "lead.ganho" } });
    await c.prisma.crmEventoOutbox.update({ where: { id: ganho!.id }, data: { status: "PENDENTE", proximaTentativaEm: new Date(0) } });
    await despacharOutboxCrm();
    const capi2 = await c.prisma.metaConversionEvent.groupBy({ by: ["eventName"], where: { leadId: c.lead.id }, _count: true });
    assert.deepEqual(capi2, capi);

    assert.equal(crm.recebidos.length, 0, "nenhuma chamada HTTP ao CRM antigo no modo nativo");
    const conv = await c.prisma.whatsappConversation.findFirst({ where: { leadId: c.lead.id }, select: { id: true } });
    if (conv) assert.equal(await sincronizarConversaCrm(conv.id), "desligado", "sem espelho de conversas no modo nativo");
  } finally {
    definirAgendadorNativo(null);
    await crm.fechar(); volta(); await c.limpar(); await com.limpar().catch(() => {});
  }
});
