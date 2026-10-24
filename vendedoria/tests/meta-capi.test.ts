// Testes da API de Conversões. A parte de payload é pura; a de envio usa o
// Postgres (DATABASE_URL) e um fetch falso — nunca chama a Meta de verdade.
import test from "node:test";
import assert from "node:assert/strict";
import { lerConfigCapi, montarCorpoEvento, enviarEventoMeta, GRAPH_VERSION_PADRAO } from "@/lib/meta-capi";

const ENV_BASE: Record<string, string> = {
  META_CAPI_TOKEN: "FAKE_TOKEN_NAO_E_REAL",
  META_DATASET_ID: "2274583730043159",
  META_WABA_ID: "3170296709806629",
  META_PAGE_ID: "716013528269008",
};
const LEAD = { id: "lead_1", ctwaClid: "CLID_ABC", valorContrato: null };

test("payload LeadSubmitted: formato da documentação (data[], business_messaging, whatsapp)", () => {
  const corpo = montarCorpoEvento(lerConfigCapi(ENV_BASE), LEAD, "LeadSubmitted", 1_790_000_000_123) as { data: Array<Record<string, unknown>> };
  assert.equal(corpo.data.length, 1);
  const ev = corpo.data[0];
  assert.equal(ev.event_name, "LeadSubmitted");
  assert.equal(ev.event_time, 1_790_000_000);
  assert.equal(ev.event_id, "lead_1:LeadSubmitted");
  assert.equal(ev.action_source, "business_messaging");
  assert.equal(ev.messaging_channel, "whatsapp");
  assert.deepEqual(ev.user_data, { whatsapp_business_account_id: "3170296709806629", ctwa_clid: "CLID_ABC" });
  assert.equal(ev.custom_data, undefined);
});

test("payload Purchase: custom_data com valor do contrato ou padrão 2497", () => {
  const cfg = lerConfigCapi(ENV_BASE);
  const padrao = montarCorpoEvento(cfg, LEAD, "Purchase") as { data: Array<{ custom_data: unknown }> };
  assert.deepEqual(padrao.data[0].custom_data, { currency: "BRL", value: 2497 });
  const real = montarCorpoEvento(cfg, { ...LEAD, valorContrato: 5800 }, "Purchase") as { data: Array<{ custom_data: unknown }> };
  assert.deepEqual(real.data[0].custom_data, { currency: "BRL", value: 5800 });
  const outroPadrao = montarCorpoEvento(lerConfigCapi({ ...ENV_BASE, META_PURCHASE_DEFAULT_VALUE: "3000" }), LEAD, "Purchase") as { data: Array<{ custom_data: unknown }> };
  assert.deepEqual(outroPadrao.data[0].custom_data, { currency: "BRL", value: 3000 });
});

test("page_id só vai com META_CAPI_SEND_PAGE_ID=true; test_event_code só quando definido; token nunca no corpo", () => {
  const sem = montarCorpoEvento(lerConfigCapi(ENV_BASE), LEAD, "LeadSubmitted");
  assert.equal(JSON.stringify(sem).includes("page_id"), false);
  assert.equal("test_event_code" in sem, false);
  const com = montarCorpoEvento(lerConfigCapi({ ...ENV_BASE, META_CAPI_SEND_PAGE_ID: "true", META_TEST_EVENT_CODE: "TEST123" }), LEAD, "LeadSubmitted") as Record<string, unknown>;
  assert.equal(com.test_event_code, "TEST123");
  assert.equal(JSON.stringify(com).includes("716013528269008"), true);
  assert.equal(JSON.stringify(com).includes("FAKE_TOKEN_NAO_E_REAL"), false);
});

test("config: versão padrão e dry-run", () => {
  assert.equal(lerConfigCapi({}).graphVersion, GRAPH_VERSION_PADRAO);
  assert.equal(lerConfigCapi({ META_GRAPH_VERSION: "v24.0" }).graphVersion, "v24.0");
  assert.equal(lerConfigCapi({}).dryRun, false);
  assert.equal(lerConfigCapi({ META_CAPI_DRY_RUN: "true" }).dryRun, true);
});

// ── Envio (precisa de banco) ────────────────────────────────────────────────
const temBanco = Boolean(process.env.DATABASE_URL);

test("envio: dry-run, dedupe, filtros, retentativas, falha, sem config, reenvio", { skip: !temBanco }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const marca = `t${Date.now()}`;
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: marca, documentId: "1", documentType: "CNPJ" } });
  const col = await prisma.kanbanColumn.create({ data: { name: "Novos", order: 0, type: "TRIAGE", color: "#000", organizationId: org.id } });
  const mk = (extra: Record<string, unknown> = {}) =>
    prisma.lead.create({
      data: { phoneNumber: `55${Math.floor(Math.random() * 1e9)}`, leadOrigin: "INBOUND", organizationId: org.id, kanbanColumnId: col.id, ctwaClid: "CLID_" + marca, ...extra },
    });
  const leitura = (leadId: string, ev: string) => prisma.metaConversionEvent.findUnique({ where: { leadId_eventName: { leadId, eventName: ev } } });

  try {
    // 1) DRY_RUN: grava o payload, não chama a rede, e não duplica
    const a = await mk();
    let chamadas = 0;
    const fetchFalso = (async () => { chamadas++; throw new Error("não deveria chamar a rede"); }) as unknown as typeof fetch;
    const dry = { ...ENV_BASE, META_CAPI_DRY_RUN: "true" };
    assert.equal((await enviarEventoMeta(a.id, "LeadSubmitted", { env: dry, fetchImpl: fetchFalso })).resultado, "DRY_RUN");
    assert.equal(chamadas, 0);
    const linha = await leitura(a.id, "LeadSubmitted");
    assert.equal(linha?.status, "DRY_RUN");
    assert.equal(linha?.eventId, `${a.id}:LeadSubmitted`);
    assert.equal(JSON.stringify(linha?.payload).includes("FAKE_TOKEN_NAO_E_REAL"), false);
    assert.equal((await enviarEventoMeta(a.id, "LeadSubmitted", { env: dry })).resultado, "JA_REGISTRADO");
    assert.equal(await prisma.metaConversionEvent.count({ where: { leadId: a.id } }), 1);

    // 2) Filtros: OUTBOUND e lead sem ctwa_clid são ignorados (sem criar linha)
    const out = await mk({ leadOrigin: "OUTBOUND" });
    const semClid = await mk({ ctwaClid: null });
    assert.equal((await enviarEventoMeta(out.id, "Purchase", { env: dry })).resultado, "IGNORADO");
    assert.equal((await enviarEventoMeta(semClid.id, "Purchase", { env: dry })).resultado, "IGNORADO");
    assert.equal(await prisma.metaConversionEvent.count({ where: { leadId: { in: [out.id, semClid.id] } } }), 0);

    // 3) Envio real simulado: 500, depois 200 → SENT na 2ª tentativa; token só na URL
    const b = await mk({ valorContrato: 4200 });
    const urls: string[] = [];
    const corpos: string[] = [];
    let n = 0;
    const flaky = (async (url: string, init: RequestInit) => {
      urls.push(url); corpos.push(String(init.body)); n++;
      return n === 1
        ? new Response("erro interno", { status: 500 })
        : new Response(JSON.stringify({ events_received: 1, messages: [], fbtrace_id: "x" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await enviarEventoMeta(b.id, "Purchase", { env: ENV_BASE, fetchImpl: flaky, esperasMs: [1, 1] });
    assert.deepEqual([r.resultado, (r as { tentativas: number }).tentativas], ["SENT", 2]);
    assert.ok(urls[0].startsWith(`https://graph.facebook.com/${GRAPH_VERSION_PADRAO}/2274583730043159/events?access_token=`));
    assert.equal(corpos[0].includes("FAKE_TOKEN_NAO_E_REAL"), false);
    const enviada = await leitura(b.id, "Purchase");
    assert.equal(enviada?.status, "SENT");
    assert.ok(enviada?.sentAt);
    assert.equal(JSON.stringify(enviada?.payload).includes("FAKE_TOKEN_NAO_E_REAL"), false);
    assert.equal((JSON.parse(corpos[0]) as { data: Array<{ custom_data: { value: number } }> }).data[0].custom_data.value, 4200);

    // 4) 3 falhas → FAILED, sem vazar o token na resposta gravada
    const c = await mk();
    const sempreCai = (async (url: string) => { throw new Error(`falha de rede em ${url}`); }) as unknown as typeof fetch;
    const f = await enviarEventoMeta(c.id, "LeadSubmitted", { env: ENV_BASE, fetchImpl: sempreCai, esperasMs: [1, 1] });
    assert.deepEqual([f.resultado, (f as { tentativas: number }).tentativas], ["FAILED", 3]);
    const falha = await leitura(c.id, "LeadSubmitted");
    assert.equal(falha?.status, "FAILED");
    assert.equal(falha?.resposta?.includes("FAKE_TOKEN_NAO_E_REAL"), false);
    assert.ok(falha?.resposta?.includes("[token]"));

    // 5) 4xx não tenta de novo (400 → 1 tentativa)
    const d = await mk();
    let q = 0;
    const ruim = (async () => { q++; return new Response(JSON.stringify({ error: { message: "Invalid parameter" } }), { status: 400 }); }) as unknown as typeof fetch;
    const r400 = await enviarEventoMeta(d.id, "LeadSubmitted", { env: ENV_BASE, fetchImpl: ruim, esperasMs: [1, 1] });
    assert.equal(q, 1);
    assert.equal(r400.resultado, "FAILED");

    // 6) Sem config → SKIPPED_NO_CONFIG; depois de configurar, o reenvio funciona
    const e = await mk();
    assert.equal((await enviarEventoMeta(e.id, "LeadSubmitted", { env: {} })).resultado, "SKIPPED_NO_CONFIG");
    assert.equal((await enviarEventoMeta(e.id, "LeadSubmitted", { env: ENV_BASE })).resultado, "JA_REGISTRADO"); // sem reenviar=true não repete
    const ok200 = (async () => new Response(JSON.stringify({ events_received: 1 }), { status: 200 })) as unknown as typeof fetch;
    assert.equal((await enviarEventoMeta(e.id, "LeadSubmitted", { env: ENV_BASE, fetchImpl: ok200, reenviar: true })).resultado, "SENT");

    // 7) Meta aceitou 2xx mas events_received=0 → FAILED
    const g = await mk();
    const zero = (async () => new Response(JSON.stringify({ events_received: 0 }), { status: 200 })) as unknown as typeof fetch;
    assert.equal((await enviarEventoMeta(g.id, "Purchase", { env: ENV_BASE, fetchImpl: zero, esperasMs: [1] })).resultado, "FAILED");
  } finally {
    const leads = await prisma.lead.findMany({ where: { organizationId: org.id }, select: { id: true } });
    await prisma.metaConversionEvent.deleteMany({ where: { leadId: { in: leads.map((l) => l.id) } } });
    await prisma.leadActivity.deleteMany({ where: { leadId: { in: leads.map((l) => l.id) } } });
    await prisma.lead.deleteMany({ where: { organizationId: org.id } });
    await prisma.kanbanColumn.deleteMany({ where: { organizationId: org.id } });
    await prisma.whatsappBusinessOrganization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
});

test("origem do anúncio: grava, não duplica no replay, atualiza clid novo", { skip: !temBanco }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const { registrarOrigemAnuncio } = await import("@/lib/crm/origem-anuncio");
  const marca = `o${Date.now()}`;
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: marca, documentId: "1", documentType: "CNPJ" } });
  const col = await prisma.kanbanColumn.create({ data: { name: "Novos", order: 0, type: "TRIAGE", color: "#000", organizationId: org.id } });
  const lead = await prisma.lead.create({ data: { phoneNumber: "5562999990000", leadOrigin: "OUTBOUND", organizationId: org.id, kanbanColumnId: col.id } });
  const atividades = () => prisma.leadActivity.count({ where: { leadId: lead.id } });
  const origem = { ctwaClid: "CLID_1", adSourceId: "AD_1", adSourceType: "ad", adHeadline: "Título", adBody: null, adSourceUrl: "https://fb.me/x" };
  try {
    assert.equal(await registrarOrigemAnuncio(lead.id, null, origem, new Date("2026-10-10T12:00:00Z")), "criada");
    let l = await prisma.lead.findUnique({ where: { id: lead.id } });
    assert.deepEqual([l?.ctwaClid, l?.adSourceId, l?.adHeadline, l?.leadOrigin], ["CLID_1", "AD_1", "Título", "INBOUND"]);
    assert.equal(await atividades(), 1);

    assert.equal(await registrarOrigemAnuncio(lead.id, null, origem), "inalterada"); // replay do webhook
    assert.equal(await atividades(), 1);

    assert.equal(await registrarOrigemAnuncio(lead.id, null, { ...origem, ctwaClid: "CLID_2" }), "atualizada");
    l = await prisma.lead.findUnique({ where: { id: lead.id } });
    assert.equal(l?.ctwaClid, "CLID_2");
    assert.equal(await atividades(), 2);
  } finally {
    await prisma.leadActivity.deleteMany({ where: { leadId: lead.id } });
    await prisma.lead.delete({ where: { id: lead.id } });
    await prisma.kanbanColumn.deleteMany({ where: { organizationId: org.id } });
    await prisma.whatsappBusinessOrganization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
});
