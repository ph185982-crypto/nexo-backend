// Contratos (Etapa 3, F4): rotas com a ClickSign simulada, webhook (assinatura HMAC válida/inválida/repetida, sem
// segredo), automação do assinado sem duplicar ganho/CAPI/evento, evento contrato.assinado para a Central e
// importação do histórico do navegador (2× = 0).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";
import "./_comercial-sessao";
import { COOKIE_SESSAO } from "./_comercial-sessao";
import { cenario } from "./_comercial-cenario";
import { prisma } from "@/lib/prisma/client";
import { criarOportunidade } from "@/lib/comercial/funil/mover";
import { definirTransporteClickSign } from "@/lib/comercial/contratos/clicksign";
import { definirTransporteCnpj } from "@/lib/comercial/contratos/cnpj";
import { assinaturaValida } from "@/lib/comercial/contratos/webhook";
import { servicosDoContrato, statusDoEnvelope, lerValor } from "@/lib/comercial/contratos/modelo";
import { clausulasContrato, clienteDoForm, CLAUSULA_REGISTRO } from "@/lib/comercial/contratos/pdf";
import { aoAssinarContrato } from "@/lib/comercial/contratos/automacao";
import { despacharEventosCentral, gravarEventoCentral } from "@/lib/comercial/contratos/central";
import { reconciliarContratos } from "@/lib/comercial/contratos/servico";
import { importarHistorico } from "@/lib/comercial/contratos/importar";
import { GET as getLista, POST as postContrato } from "@/app/api/comercial/contratos/route";
import { GET as getContrato, POST as postAcao } from "@/app/api/comercial/contratos/[id]/route";
import { GET as getArquivo } from "@/app/api/comercial/contratos/[id]/arquivo/route";
import { GET as getPreencher } from "@/app/api/comercial/contratos/preencher/route";
import { GET as getCnpj } from "@/app/api/comercial/cnpj/route";
import { POST as postWebhook } from "@/app/api/webhooks/clicksign/route";
import { GET as getCron } from "@/app/api/cron/comercial/route";

const SEGREDO = "segredo-do-webhook-de-teste";
const PDF = Buffer.from("%PDF-1.4\n" + "conteudo de teste do contrato ".repeat(10) + "\n%%EOF");
const ASSINADO_PDF = Buffer.from("%PDF-1.7\n" + "assinado ".repeat(30) + "\n%%EOF");

// ── ClickSign simulada ───────────────────────────────────────────────────────
function clickSignFalsa() {
  const estado = { envelopes: new Map<string, string>(), chamadas: [] as string[], n: 0 };
  const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/vnd.api+json" } });
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const metodo = init?.method ?? "GET";
    estado.chamadas.push(`${metodo} ${url.replace(/^https:\/\/cs\.falsa\/api\/v3/, "")}`);
    if (url === "https://s3.falsa/assinado.pdf") return new Response(ASSINADO_PDF);
    const p = url.replace("https://cs.falsa/api/v3", "").split("?")[0];
    let m: RegExpMatchArray | null;
    if (p === "/folders" && metodo === "GET") return json({ data: [], meta: { record_count: 0 } });
    if (p === "/folders" && metodo === "POST") return json({ data: { id: `pasta-${++estado.n}` } });
    if (p === "/envelopes" && metodo === "POST") { const id = `env-${Date.now()}-${++estado.n}`; estado.envelopes.set(id, "draft"); return json({ data: { id } }); }
    if (p === "/envelopes" && metodo === "GET") return json({ data: [...estado.envelopes].map(([id, status]) => ({ id, attributes: { name: `Envelope ${id}`, status, created: new Date().toISOString() } })) });
    if ((m = p.match(/^\/envelopes\/([^/]+)\/documents$/)) && metodo === "POST") return json({ data: { id: `doc-${m[1]}` } });
    if ((m = p.match(/^\/envelopes\/([^/]+)\/documents$/))) {
      const st = estado.envelopes.get(decodeURIComponent(m[1]));
      return json({ data: [{ id: `doc-${m[1]}`, attributes: { status: st }, links: { files: { original: "https://s3.falsa/original.pdf", ...(st === "closed" ? { signed: "https://s3.falsa/assinado.pdf" } : {}) } } }] });
    }
    if (p.match(/^\/envelopes\/[^/]+\/signers$/)) return json({ data: { id: `sig-${++estado.n}` } });
    if (p.match(/^\/envelopes\/[^/]+\/requirements$/)) return json({ data: { id: `req-${++estado.n}` } });
    if (p.match(/^\/envelopes\/[^/]+\/notifications$/)) return json({ data: {} });
    if ((m = p.match(/^\/envelopes\/([^/]+)\/documents\/[^/]+$/)) && metodo === "PATCH") { estado.envelopes.set(decodeURIComponent(m[1]), "canceled"); return json({ data: {} }); }
    if ((m = p.match(/^\/envelopes\/([^/]+)$/))) {
      const id = decodeURIComponent(m[1]);
      if (metodo === "PATCH") { estado.envelopes.set(id, "running"); return json({ data: { id } }); }
      if (!estado.envelopes.has(id)) return json({ errors: [{ detail: "não encontrado" }] }, 404);
      return json({ data: { id, attributes: { name: `Envelope ${id}`, status: estado.envelopes.get(id), created: new Date().toISOString() } } });
    }
    return json({ errors: [{ detail: `rota falsa sem resposta: ${metodo} ${p}` }] }, 500);
  }) as typeof fetch;
  return { estado, f };
}

function ligarClickSign() {
  const cs = clickSignFalsa();
  process.env.CLICKSIGN_TOKEN = "token-falso";
  process.env.CLICKSIGN_BASE = "https://cs.falsa/api/v3";
  process.env.CLICKSIGN_WEBHOOK_SECRET = SEGREDO;
  delete process.env.CLICKSIGN_AUTO_SIGNER;
  definirTransporteClickSign(cs.f);
  return cs;
}

// ── Central falsa (fetch global, só para CENTRAL_URL) ────────────────────────
function centralFalsa(status = 202) {
  const recebidos: Array<{ auth: string | null; corpo: Record<string, unknown> }> = [];
  const original = globalThis.fetch;
  process.env.CENTRAL_URL = "https://central.falsa";
  process.env.AVANTEZA_EVENTS_KEY = "chave-eventos";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith("https://central.falsa/")) {
      recebidos.push({ auth: new Headers(init?.headers).get("authorization"), corpo: JSON.parse(String(init?.body)) });
      return new Response("{}", { status });
    }
    return original(input, init);
  }) as typeof fetch;
  return { recebidos, desligar: () => { globalThis.fetch = original; } };
}

const FORM = (marca: string) => ({
  modelo: "growth", plano: "ESCALE", preco: "2.500,00", pgto2: "45", cnpj: "11.222.333/0001-81", razao: `Loja ${marca} LTDA`, fantasia: `Loja ${marca}`,
  rep: "Ana Souza", email: "ana@loja.test", whats: "(62) 99999-1234", end: "Rua 1, Goiânia, GO", inicio: "2026-12-01", duracao: "12", venc: "15",
  marca: "avanteza", renov: "", garantia: false,
});

const req = (url: string, uid: string | null, init: RequestInit = {}) =>
  new Request(`http://x${url}`, { ...init, headers: { "content-type": "application/json", ...(uid ? { cookie: `${COOKIE_SESSAO}=${encodeURIComponent(uid)}` } : {}), ...(init.headers ?? {}) } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function webhook(corpo: unknown, segredo = SEGREDO, cabecalho = "content-hmac") {
  const bruto = JSON.stringify(corpo);
  const assinatura = `sha256=${createHmac("sha256", segredo).update(bruto).digest("hex")}`;
  return postWebhook(new Request("http://x/api/webhooks/clicksign", { method: "POST", body: bruto, headers: { "content-type": "application/json", [cabecalho]: assinatura, event: String((corpo as { event?: { name?: string } }).event?.name ?? "") } }));
}

async function preparar() {
  const c = await cenario();
  const dono = await prisma.user.create({ data: { name: `Vendedor ${c.marca}`, email: `contr-${c.marca}@t.local`, role: "SELLER" } });
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: `Org ${c.marca}`, documentId: "1", documentType: "CNPJ" } });
  const col = (type: string, name: string, order: number) => prisma.kanbanColumn.create({ data: { type, name, order, color: "#0b1b33", organizationId: org.id } });
  const triagem = await col("TRIAGE", "Leads", 0);
  await col("PROPOSTA_NEGOCIACAO", "Proposta", 1);
  await col("GANHO", "Ganho", 2);
  const lead = await prisma.lead.create({ data: { phoneNumber: `55${Date.now() % 1e11}`, leadOrigin: "INBOUND", ctwaClid: `CLID_${c.marca}`, organizationId: org.id, kanbanColumnId: triagem.id } });
  await prisma.comEtapa.update({ where: { id: c.proposta.id }, data: { kanbanColumnType: "PROPOSTA_NEGOCIACAO" } });
  await prisma.comEtapa.update({ where: { id: c.ganha.id }, data: { kanbanColumnType: "GANHO" } });
  await prisma.comContato.update({ where: { id: c.contato.id }, data: { documento: "11222333000181", email: "contato@loja.test", telefone: "5562999991234" } });
  const op = await criarOportunidade({ nome: `Fechamento ${c.marca}`, contatoId: c.contato.id, funilId: c.funil.id, leadId: lead.id, valorMensal: 2500 });
  const limpar = async () => {
    const contratos = await prisma.contratoEmitido.findMany({ where: { OR: [{ razaoSocial: { contains: c.marca } }, { oportunidadeId: op.id }] }, select: { id: true, envelopeId: true } });
    await prisma.centralEventoOutbox.deleteMany({ where: { eventoId: { in: contratos.map((x) => `contrato.assinado:${x.envelopeId}`) } } });
    await prisma.contratoEvento.deleteMany({ where: { contratoId: { in: contratos.map((x) => x.id) } } });
    await prisma.contratoEmitido.deleteMany({ where: { id: { in: contratos.map((x) => x.id) } } });
    await prisma.metaConversionEvent.deleteMany({ where: { leadId: lead.id } });
    await c.limpar();
    await prisma.leadStageHistory.deleteMany({ where: { leadId: lead.id } });
    await prisma.lead.deleteMany({ where: { id: lead.id } });
    await prisma.kanbanColumn.deleteMany({ where: { organizationId: org.id } });
    await prisma.whatsappBusinessOrganization.delete({ where: { id: org.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: dono.id } });
  };
  return { ...c, dono, lead, op, limpar };
}

// ── Regras puras ─────────────────────────────────────────────────────────────

test("mapa de serviços, leitura de valor, status do envelope e assinatura HMAC", () => {
  assert.deepEqual(servicosDoContrato("barbearia", "ESCALE"), ["trafego", "midias"]);
  assert.deepEqual(servicosDoContrato("growth", "BASE"), ["marketplace"]);
  assert.deepEqual(servicosDoContrato("growth", "ESCALE"), ["marketplace", "trafego"]);
  assert.deepEqual(servicosDoContrato("growth", "GROWTH"), ["marketplace", "trafego"]);
  assert.deepEqual(servicosDoContrato("growth", "MARKETPLACE"), ["marketplace"]);
  assert.deepEqual(servicosDoContrato("growth", "OUTRO"), ["marketplace"]);
  assert.equal(lerValor("1.997,90"), 1997.9);
  assert.equal(lerValor("2500"), 2500);
  assert.equal(lerValor(""), null);
  assert.equal(statusDoEnvelope("closed"), "ASSINADO");
  assert.equal(statusDoEnvelope("canceled", "RECUSADO"), "RECUSADO");
  assert.equal(statusDoEnvelope("running", "ASSINADO_PARCIAL"), "ASSINADO_PARCIAL");
  const corpo = '{"event":{"name":"close"}}';
  const hex = createHmac("sha256", "s").update(corpo).digest("hex");
  assert.ok(assinaturaValida(corpo, `sha256=${hex}`, "s"));
  assert.ok(assinaturaValida(corpo, hex, "s"), "sem o prefixo também vale");
  assert.ok(!assinaturaValida(corpo + " ", `sha256=${hex}`, "s"), "corpo reformatado não vale");
  assert.ok(!assinaturaValida(corpo, `sha256=${hex}`, "outro"));
  assert.ok(!assinaturaValida(corpo, null, "s"));
});

test("modelo de contrato traz a cláusula de registro de conversas e reuniões (LGPD) sem mexer na numeração citada", () => {
  for (const garantia of [false, true]) {
    const { cliente, sched, marca } = clienteDoForm({ ...FORM("x"), garantia });
    const cls = clausulasContrato(cliente, sched, "1 de dezembro de 2026", marca);
    const titulos = cls.map((c) => c.title);
    assert.equal(titulos[5], "Valor e forma de pagamento", "cláusula 6 continua sendo a de pagamento");
    assert.equal(titulos[8], "Rescisão", "cláusula 9 continua sendo a de rescisão");
    if (garantia) assert.equal(titulos[9], "Garantia de execução", "cláusula 10 continua sendo a garantia");
    const i = titulos.indexOf(CLAUSULA_REGISTRO.title);
    assert.ok(i > titulos.indexOf("Limitação de responsabilidade") && i < titulos.indexOf("Foro e legislação aplicável"));
    assert.match(cls[i].paras!.join(" "), /13\.709\/2018/);
    assert.match(cls[i].paras!.join(" "), /gravar ou transcrever as reuniões/);
  }
});

// ── Rotas e ClickSign simulada ───────────────────────────────────────────────

test("rotas: pré-preenche pela oportunidade, cria e envia pela ClickSign, lista, ficha, PDF, reenviar, status e cancelar", async () => {
  const p = await preparar();
  const cs = ligarClickSign();
  try {
    // 401 sem sessão
    assert.equal((await getLista(req("/api/comercial/contratos", null))).status, 401);
    const pre = await (await getPreencher(req(`/api/comercial/contratos/preencher?oportunidade=${p.op.id}`, p.dono.id))).json();
    assert.equal(pre.form.cnpj, "11.222.333/0001-81");
    assert.equal(pre.form.preco, "2.500,00");
    assert.equal(pre.form.email, "contato@loja.test");
    assert.equal(pre.form.oportunidadeId, p.op.id);

    // Formulário incompleto → 400
    const ruim = await postContrato(req("/api/comercial/contratos", p.dono.id, { method: "POST", body: JSON.stringify({ form: { razao: "" } }) }));
    assert.equal(ruim.status, 400);
    // PDF inválido → 400
    const naoPdf = await postContrato(req("/api/comercial/contratos", p.dono.id, { method: "POST", body: JSON.stringify({ form: FORM(p.marca), base64_pdf: Buffer.from("oi").toString("base64") }) }));
    assert.equal(naoPdf.status, 400);

    const r = await postContrato(req("/api/comercial/contratos", p.dono.id, { method: "POST", body: JSON.stringify({
      form: FORM(p.marca), base64_pdf: PDF.toString("base64"), oportunidadeId: p.op.id, enviar: { canal: "email", emailContratada: "contratada@avanteza.test" },
    }) }));
    assert.equal(r.status, 201);
    const criado = await r.json();
    assert.equal(criado.contrato.status, "ENVIADO");
    const c = (await prisma.contratoEmitido.findUnique({ where: { id: criado.contrato.id }, include: { arquivos: true } }))!;
    assert.equal(c.leadId, p.lead.id, "Lead herdado da oportunidade");
    assert.equal(c.contatoId, p.contato.id);
    assert.equal(Number(c.valor), 2500);
    assert.equal(c.cnpj, "11222333000181");
    assert.ok(c.envelopeId && c.documentoId);
    assert.equal(c.arquivos.length, 1);
    assert.equal(c.arquivos[0].tipo, "ORIGINAL");
    assert.equal(Buffer.from(c.arquivos[0].bytes).equals(PDF), true);
    // Mesma sequência do app antigo: envelope, documento, 2 signatários com 2 requisitos cada, ativação, notificação.
    const seq = cs.estado.chamadas.map((x) => x.replace(/env-[^/?]+/g, "E").replace(/\?.*$/, ""));
    assert.deepEqual(seq.filter((x) => !x.includes("/folders")), [
      "POST /envelopes", "POST /envelopes/E/documents",
      "POST /envelopes/E/signers", "POST /envelopes/E/requirements", "POST /envelopes/E/requirements",
      "POST /envelopes/E/signers", "POST /envelopes/E/requirements", "POST /envelopes/E/requirements",
      "PATCH /envelopes/E", "POST /envelopes/E/notifications",
    ]);

    // Enviar de novo não cria outro envelope.
    const dup = await postAcao(req(`/api/comercial/contratos/${c.id}`, p.dono.id, { method: "POST", body: JSON.stringify({ acao: "enviar" }) }), ctx(c.id));
    assert.equal(dup.status, 409);

    const lista = await (await getLista(req(`/api/comercial/contratos?oportunidade=${p.op.id}`, p.dono.id))).json();
    assert.deepEqual(lista.contratos.map((x: { id: string }) => x.id), [c.id]);
    assert.equal((await (await getLista(req(`/api/comercial/contratos?status=ASSINADO&q=${p.marca}`, p.dono.id))).json()).contratos.length, 0);
    const ficha = await (await getContrato(req(`/api/comercial/contratos/${c.id}`, p.dono.id), ctx(c.id))).json();
    assert.deepEqual(ficha.contrato.eventos.map((e: { tipo: string }) => e.tipo), ["ENVIADO"]);
    const arq = await getArquivo(req(`/api/comercial/contratos/${c.id}/arquivo`, p.dono.id), ctx(c.id));
    assert.equal(arq.headers.get("content-type"), "application/pdf");
    assert.ok(Buffer.from(await arq.arrayBuffer()).equals(PDF));

    assert.equal((await postAcao(req(`/api/comercial/contratos/${c.id}`, p.dono.id, { method: "POST", body: JSON.stringify({ acao: "reenviar" }) }), ctx(c.id))).status, 200);
    const st = await (await postAcao(req(`/api/comercial/contratos/${c.id}`, p.dono.id, { method: "POST", body: JSON.stringify({ acao: "status" }) }), ctx(c.id))).json();
    assert.equal(st.status, "ENVIADO");
    assert.equal((await postAcao(req(`/api/comercial/contratos/${c.id}`, p.dono.id, { method: "POST", body: JSON.stringify({ acao: "cancelar" }) }), ctx(c.id))).status, 200);
    assert.equal(cs.estado.envelopes.get(c.envelopeId!), "canceled");
    assert.equal((await prisma.contratoEmitido.findUnique({ where: { id: c.id } }))!.status, "CANCELADO");

    // Sem token: gera e guarda, o envio responde o erro claro.
    delete process.env.CLICKSIGN_TOKEN;
    const sem = await (await postContrato(req("/api/comercial/contratos", p.dono.id, { method: "POST", body: JSON.stringify({ form: FORM(p.marca), base64_pdf: PDF.toString("base64"), enviar: {} }) }))).json();
    assert.equal(sem.contrato.status, "ERRO");
    assert.match(sem.erroEnvio, /CLICKSIGN_TOKEN/);
    assert.equal((await prisma.contratoEmitido.findUnique({ where: { id: sem.contrato.id } }))!.status, "GERADO", "sem token nem reivindica o envio");

    // CNPJ (BrasilAPI simulada)
    definirTransporteCnpj((async () => new Response(JSON.stringify({ razao_social: "EMPRESA X", nome_fantasia: "X", cnpj: "11222333000181", municipio: "GOIANIA", uf: "GO", qsa: [] }))) as typeof fetch);
    assert.equal((await getCnpj(req("/api/comercial/cnpj?cnpj=11222333000100", p.dono.id))).status, 400, "dígito inválido");
    const cnpj = await (await getCnpj(req("/api/comercial/cnpj?cnpj=11.222.333/0001-81", p.dono.id))).json();
    assert.equal(cnpj.razao_social, "EMPRESA X");
  } finally {
    definirTransporteClickSign(null); definirTransporteCnpj(null);
    await p.limpar();
  }
});

// ── Webhook e automação ──────────────────────────────────────────────────────

test("webhook: sem segredo 503, assinatura inválida 401, válida assina, guarda o PDF e automatiza uma vez só; repetido não duplica", async () => {
  const p = await preparar();
  const cs = ligarClickSign();
  const central = centralFalsa();
  try {
    const criado = await (await postContrato(req("/api/comercial/contratos", p.dono.id, { method: "POST", body: JSON.stringify({
      form: FORM(p.marca), base64_pdf: PDF.toString("base64"), oportunidadeId: p.op.id, enviar: { canal: "email" },
    }) }))).json();
    const c = (await prisma.contratoEmitido.findUnique({ where: { id: criado.contrato.id } }))!;
    const corpo = { event: { name: "sign", data: {}, occurred_at: new Date().toISOString() }, document: { key: c.documentoId } };

    delete process.env.CLICKSIGN_WEBHOOK_SECRET;
    assert.equal((await webhook(corpo)).status, 503);
    process.env.CLICKSIGN_WEBHOOK_SECRET = SEGREDO;
    assert.equal((await webhook(corpo, "segredo-errado")).status, 401);
    assert.equal((await postWebhook(new Request("http://x", { method: "POST", body: JSON.stringify(corpo) }))).status, 401, "sem cabeçalho");
    assert.equal((await prisma.contratoEvento.count({ where: { contratoId: c.id, tipo: "sign" } })), 0, "nada gravado sem assinatura válida");

    // Um signatário assinou: parcial.
    assert.equal((await webhook(corpo)).status, 200);
    assert.equal((await prisma.contratoEmitido.findUnique({ where: { id: c.id } }))!.status, "ASSINADO_PARCIAL");
    const rep = await (await webhook(corpo)).json();
    assert.equal(rep.repetido, true, "mesmo corpo de novo: repetido");

    // Fechou (o envelope na ClickSign vira closed): ASSINADO, PDF assinado, oportunidade ganha, evento para a Central.
    cs.estado.envelopes.set(c.envelopeId!, "closed");
    const fechado = { event: { name: "auto_close", data: {}, occurred_at: new Date().toISOString() }, document: { key: c.documentoId } };
    assert.equal((await webhook(fechado, SEGREDO, "x-clicksign-signature")).status, 200);
    const depois = (await prisma.contratoEmitido.findUnique({ where: { id: c.id }, include: { arquivos: true } }))!;
    assert.equal(depois.status, "ASSINADO");
    assert.ok(depois.assinadoEm && depois.automatizadoEm);
    const assinado = depois.arquivos.find((a) => a.tipo === "ASSINADO")!;
    assert.ok(Buffer.from(assinado.bytes).equals(ASSINADO_PDF));
    assert.match(assinado.sha256, /^[0-9a-f]{64}$/);

    const op = (await prisma.comOportunidade.findUnique({ where: { id: p.op.id }, include: { motivo: true } }))!;
    assert.equal(op.status, "GANHA");
    assert.equal(op.etapaId, p.ganha.id);
    assert.equal(op.motivo?.tipo, "GANHO", "motivo de ganho padrão");
    const lead = (await prisma.lead.findUnique({ where: { id: p.lead.id }, include: { kanbanColumn: true } }))!;
    assert.equal(lead.valorContrato, 2500);
    assert.equal(lead.kanbanColumn.type, "GANHO", "o Lead anda junto pelo mover");

    // Evento contrato.assinado: exatamente o contrato combinado com a Central.
    assert.equal(central.recebidos.length, 1);
    assert.equal(central.recebidos[0].auth, "Bearer chave-eventos");
    const ev = central.recebidos[0].corpo as { id: string; tipo: string; origem: string; ocorrido_em: string; payload: Record<string, unknown> };
    assert.deepEqual(Object.keys(ev).sort(), ["id", "ocorrido_em", "origem", "payload", "tipo"]);
    assert.equal(ev.id, `contrato.assinado:${c.envelopeId}`);
    assert.equal(ev.tipo, "contrato.assinado");
    assert.equal(ev.origem, "comercial");
    assert.ok(!isNaN(Date.parse(ev.ocorrido_em)));
    assert.deepEqual(ev.payload, {
      contratoId: c.id, envelopeId: c.envelopeId, razaoSocial: `Loja ${p.marca} LTDA`, nomeFantasia: `Loja ${p.marca}`, cnpj: "11222333000181",
      representante: "Ana Souza", emailCliente: "ana@loja.test", telefoneCliente: "62999991234", modelo: "growth", plano: "ESCALE",
      servicos: ["marketplace", "trafego"], valorMensal: 2500, duracaoMeses: 12, inicioEm: "2026-12-01", vencimentoDia: 15,
      oportunidadeId: p.op.id, leadId: p.lead.id,
      ...(ev.payload.pdfUrl ? { pdfUrl: ev.payload.pdfUrl } : {}),
    });
    const outbox = await prisma.centralEventoOutbox.findUnique({ where: { eventoId: ev.id } });
    assert.equal(outbox?.status, "ENVIADO");

    // Repetições por todos os caminhos: webhook com outro corpo, automação direta, reconciliação do cron.
    await webhook({ event: { name: "document_closed", data: {}, occurred_at: new Date().toISOString() }, document: { key: c.documentoId } });
    assert.deepEqual(await aoAssinarContrato(c.id), { executou: false });
    process.env.CRON_SECRET = "cron-teste";
    assert.equal((await getCron(new Request("http://x/api/cron/comercial"))).status, 401);
    assert.equal((await getCron(new Request("http://x/api/cron/comercial", { headers: { authorization: "Bearer cron-teste" } }))).status, 200);
    const ganhos = await prisma.comHistoricoEtapa.count({ where: { oportunidadeId: p.op.id, paraTipo: "GANHA" } });
    assert.equal(ganhos, 1, "ganho uma vez só");
    const purchase = await prisma.metaConversionEvent.findMany({ where: { leadId: p.lead.id, eventName: "Purchase" } });
    assert.equal(purchase.length, 1, "Purchase da Meta uma vez só");
    assert.equal(await prisma.centralEventoOutbox.count({ where: { eventoId: ev.id } }), 1);
    assert.equal(central.recebidos.length, 1, "Central avisada uma vez só");
    assert.equal(await prisma.contratoEvento.count({ where: { contratoId: c.id, tipo: "AUTOMACAO_ASSINADO" } }), 1);
    assert.equal(await prisma.contratoArquivo.count({ where: { contratoId: c.id, tipo: "ASSINADO" } }), 1);
  } finally {
    central.desligar(); definirTransporteClickSign(null);
    await p.limpar();
  }
});

test("Central fora do ar: o evento fica no outbox e sai na retentativa; reconciliação pega webhook perdido", async () => {
  const p = await preparar();
  const cs = ligarClickSign();
  const fora = centralFalsa(503);
  try {
    const criado = await (await postContrato(req("/api/comercial/contratos", p.dono.id, { method: "POST", body: JSON.stringify({
      form: { ...FORM(p.marca), modelo: "barbearia" }, base64_pdf: PDF.toString("base64"), oportunidadeId: p.op.id, enviar: { canal: "whatsapp" },
    }) }))).json();
    const c = (await prisma.contratoEmitido.findUnique({ where: { id: criado.contrato.id } }))!;
    cs.estado.envelopes.set(c.envelopeId!, "closed");
    // Webhook perdido: só a reconciliação (enviado há mais de 10 min) descobre.
    await reconciliarContratos();
    assert.equal((await prisma.contratoEmitido.findUnique({ where: { id: c.id } }))!.status, "ENVIADO", "enviado agora: ainda não reconcilia");
    await prisma.contratoEmitido.update({ where: { id: c.id }, data: { enviadoEm: new Date(Date.now() - 11 * 60_000) } });
    const r = await reconciliarContratos({ limite: 50 });
    assert.ok(r.mudaram >= 1);
    assert.equal((await prisma.contratoEmitido.findUnique({ where: { id: c.id } }))!.status, "ASSINADO");
    const evId = `contrato.assinado:${c.envelopeId}`;
    const pend = (await prisma.centralEventoOutbox.findUnique({ where: { eventoId: evId } }))!;
    assert.equal(pend.status, "PENDENTE");
    assert.deepEqual((pend.payload as { payload: { servicos: string[] } }).payload.servicos, ["trafego", "midias"]);
    fora.desligar();
    const ok = centralFalsa(200); // 200 = repetido na Central: também conta como entregue
    try {
      await despacharEventosCentral({ agora: new Date(Date.now() + 2 * 3600_000), eventoId: evId });
      assert.equal((await prisma.centralEventoOutbox.findUnique({ where: { eventoId: evId } }))!.status, "ENVIADO");
      assert.equal(ok.recebidos.length, 1);
    } finally { ok.desligar(); }
    // 4xx (ex.: 401 chave errada, 400 inválido) não é retentado: vira FALHOU na hora.
    const ruim = centralFalsa(401);
    const idRuim = `contrato.assinado:teste-401-${p.marca}`;
    try {
      await gravarEventoCentral({ id: idRuim, tipo: "contrato.assinado", origem: "comercial", ocorrido_em: new Date().toISOString(), payload: {} });
      await despacharEventosCentral({ eventoId: idRuim });
      assert.equal((await prisma.centralEventoOutbox.findUnique({ where: { eventoId: idRuim } }))!.status, "FALHOU");
    } finally { ruim.desligar(); await prisma.centralEventoOutbox.deleteMany({ where: { eventoId: idRuim } }); }
  } finally {
    fora.desligar(); definirTransporteClickSign(null);
    await p.limpar();
  }
});

// ── Importação do histórico do navegador ─────────────────────────────────────

test("importação do histórico: idempotente (2× = 0), ZapSign só leitura, sem automação, status real com --clicksign", async () => {
  const p = await preparar();
  const cs = ligarClickSign();
  const envAssinado = `env-hist-${p.marca}`;
  cs.estado.envelopes.set(envAssinado, "closed");
  const itens = [
    { id: `h1-${p.marca}`, createdAt: "2026-10-01T12:00:00Z", filename: "a.pdf", form: FORM(p.marca), provider: "clicksign", zsToken: envAssinado, docId: `doc-${envAssinado}`, sentAt: "2026-10-01T12:01:00Z" },
    { id: `h2-${p.marca}`, createdAt: "2026-09-01T12:00:00Z", filename: "b.pdf", form: { ...FORM(p.marca), razao: `Antiga ${p.marca}` }, zsToken: `zs-${p.marca}` },
    { id: `h3-${p.marca}`, createdAt: "2026-10-05T12:00:00Z", filename: "c.pdf", form: { ...FORM(p.marca), razao: `Rascunho ${p.marca}` }, replaces: `h2-${p.marca}` },
  ];
  try {
    const r1 = await importarHistorico(itens, { clicksign: true });
    assert.equal(r1.criados, 3);
    assert.equal(r1.erros.length, 0, r1.erros.join("; "));
    assert.equal(r1.atualizados, 1);
    const r2 = await importarHistorico(itens, { clicksign: true });
    assert.equal(r2.criados, 0, "segunda execução cria 0");
    assert.equal(r2.existentes, 3);
    assert.equal(r2.daClickSign, 0);

    const todos = await prisma.contratoEmitido.findMany({ where: { razaoSocial: { contains: p.marca } }, include: { arquivos: true } });
    const por = (nome: string) => todos.find((t) => t.razaoSocial.startsWith(nome))!;
    const cs1 = por("Loja");
    assert.equal(cs1.status, "ASSINADO");
    assert.equal(cs1.origem, "IMPORTADO_NAVEGADOR");
    assert.ok(cs1.arquivos.some((a) => a.tipo === "ASSINADO"), "PDF assinado baixado");
    const zs = por("Antiga");
    assert.deepEqual([zs.provedor, zs.status, zs.envelopeId], ["zapsign", "ENVIADO", null]);
    const ras = por("Rascunho");
    assert.equal(ras.status, "GERADO");
    assert.equal(ras.substituiId, zs.id, "versão anterior ligada");
    assert.equal((ras.formJson as { _idOriginal?: string })._idOriginal, `h3-${p.marca}`);
    // Importado assinado não ganha oportunidade nem avisa a Central.
    assert.equal(await prisma.centralEventoOutbox.count({ where: { eventoId: `contrato.assinado:${envAssinado}` } }), 0);
    // ZapSign é só leitura.
    const z = await postAcao(req(`/api/comercial/contratos/${zs.id}`, p.dono.id, { method: "POST", body: JSON.stringify({ acao: "cancelar" }) }), ctx(zs.id));
    assert.equal(z.status, 409);

    // O script de linha de comando chama a mesma importação: de novo, 0 criados.
    const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hist-")), "historico.json");
    fs.writeFileSync(arq, JSON.stringify({ exportadoEm: new Date().toISOString(), total: itens.length, itens }));
    const sp = spawnSync(process.execPath, ["scripts/importar-contratos.mjs", "--arquivo", arq], { encoding: "utf8", env: process.env });
    assert.equal(sp.status, 0, sp.stderr);
    assert.equal(JSON.parse(sp.stdout).criados, 0);
  } finally {
    definirTransporteClickSign(null);
    await p.limpar();
  }
});
