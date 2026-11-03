import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { cenario } from "./_cenario";
import { prisma } from "@/lib/prisma";
import { criarOportunidade, moverOportunidade } from "@/lib/funil/mover";
import { listarMotivos } from "@/lib/funil/motivos";
import { auditoria, definirMeta, funilPorEtapa, ganhosEPerdas, kpis, metasDoAno, ranking } from "@/lib/relatorios/consultas";
import { lerPeriodo } from "@/lib/relatorios/periodo";
import { assinarSessao, COOKIE_SESSAO } from "@/lib/auth/sessao";
import { GET as getRel } from "@/app/api/relatorios/[tipo]/route";
import { GET as getMetas, PUT as putMeta } from "@/app/api/metas/route";

process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-16";
const DIA = 86_400_000;

test("período: mês atual por padrão, datas em Brasília, fim inclusivo e limites", () => {
  const p = lerPeriodo(null, null, new Date("2026-11-15T12:00:00Z"));
  assert.deepEqual([p.de.toISOString(), p.ate.toISOString()], ["2026-11-01T03:00:00.000Z", "2026-12-01T03:00:00.000Z"]);
  const j = lerPeriodo(null, null, new Date("2026-12-01T01:00:00Z")); // 30/11 22h em Brasília ainda é novembro
  assert.equal(j.de.toISOString(), "2026-11-01T03:00:00.000Z");
  const q = lerPeriodo("2026-03-10", "2026-03-12");
  assert.deepEqual([q.de.toISOString(), q.ate.toISOString()], ["2026-03-10T03:00:00.000Z", "2026-03-13T03:00:00.000Z"], "ate inclusivo");
  for (const [de, ate, re] of [["2026-02-30", "2026-03-01", /inválida/], ["ontem", "2026-03-01", /inválida/], ["2026-03-10", null, /Informe de e ate/], ["2026-03-10", "2026-03-09", /depois de/], ["2024-01-01", "2026-03-01", /400 dias/]] as const) {
    assert.throws(() => lerPeriodo(de, ate), re, `${de} ${ate}`);
  }
});

/** Três oportunidades do mês: A ganha (R$ 10 mil + 1 mil/mês, motivo), B perdida (R$ 4 mil, sem motivo), C em andamento quente. */
async function massa(c: Awaited<ReturnType<typeof cenario>>, resp: string | null) {
  const motivos = await listarMotivos();
  const venda = motivos.find((m) => m.tipo === "GANHO")!, preco = motivos.find((m) => m.tipo === "PERDA" && m.nome === "Preço")!;
  const mk = (nome: string, valorUnico: number, valorMensal = 0, probabilidade: string | null = null) => criarOportunidade({ nome, contatoId: c.contato.id, funilId: c.funil.id, valorUnico, valorMensal, probabilidade, responsavelId: resp });
  const A = await mk("A", 10_000, 1_000), B = await mk("B", 4_000), C = await mk("C", 6_000, 0, "QUENTE"), D = await mk("D", 2_000, 0, "RISCO_ALTO");
  await moverOportunidade({ oportunidadeId: A.id, etapaId: c.qualif.id, origem: "MANUAL" });
  await moverOportunidade({ oportunidadeId: A.id, etapaId: c.proposta.id, origem: "MANUAL" });
  await moverOportunidade({ oportunidadeId: A.id, etapaId: c.ganha.id, origem: "MANUAL", motivoId: venda.id });
  await moverOportunidade({ oportunidadeId: B.id, etapaId: c.qualif.id, origem: "MANUAL" });
  await moverOportunidade({ oportunidadeId: B.id, etapaId: c.perdida.id, origem: "MANUAL" });
  await moverOportunidade({ oportunidadeId: C.id, etapaId: c.qualif.id, origem: "MANUAL" });
  return { A, B, C, D, venda, preco };
}
const mesAtual = () => lerPeriodo(null, null);

test("KPIs: contagens, valores, hit rate, ticket, ciclo e previsão ponderada", async () => {
  const c = await cenario();
  try {
    const { A } = await massa(c, null);
    await prisma.oportunidade.update({ where: { id: A.id }, data: { criadoEm: new Date(Date.now() - 10 * DIA) } });
    const k = await kpis({ de: new Date(Date.now() - 30 * DIA), ate: new Date(Date.now() + DIA) }, c.funil.id);
    assert.deepEqual([k.criadas.quantidade, k.criadas.valor], [4, 10_000 + 1_000 + 4_000 + 6_000 + 2_000]);
    assert.deepEqual([k.ganhas.quantidade, k.ganhas.valor, k.ganhas.valorUnico, k.ganhas.valorMensal], [1, 11_000, 10_000, 1_000]);
    assert.deepEqual([k.perdidas.quantidade, k.perdidas.valor], [1, 4_000]);
    assert.deepEqual([k.emAndamento.quantidade, k.emAndamento.valor], [2, 8_000]);
    assert.equal(k.hitRate, 0.5);
    assert.equal(k.ticketMedio, 11_000);
    assert.ok(Math.abs(k.cicloMedioDias! - 10) < 0.01, "ciclo = criada → ganha");
    assert.deepEqual([k.previsao.total, k.previsao.ponderada], [8_000, 6_000 * 0.8 + 2_000 * 0.05]);
    // período vazio: sem divisão por zero
    const vazio = await kpis({ de: new Date("2020-01-01"), ate: new Date("2020-02-01") }, c.funil.id);
    assert.deepEqual([vazio.hitRate, vazio.ticketMedio, vazio.cicloMedioDias, vazio.criadas.quantidade], [null, null, null, 0]);
  } finally { await c.limpar(); }
});

test("funil por etapa: entraram, conversão entre abertas, tempo médio, agora", async () => {
  const c = await cenario();
  try {
    const { A } = await massa(c, null);
    // A ficou 2 dias em Qualificação
    const hq = (await prisma.historicoEtapa.findFirst({ where: { oportunidadeId: A.id, paraEtapaNome: "Qualificação" } }))!;
    await prisma.historicoEtapa.update({ where: { id: hq.id }, data: { entrouEm: new Date(Date.now() - 4 * DIA), saiuEm: new Date(Date.now() - 2 * DIA) } });
    const r = (await funilPorEtapa(mesAtual(), c.funil.id))!;
    const por = Object.fromEntries(r.etapas.map((e) => [e.nome, e]));
    assert.deepEqual([por.Leads.entraram, por["Qualificação"].entraram, por["Proposta e negociação"].entraram, por.Ganha.entraram, por.Perdida.entraram], [4, 3, 1, 1, 1]);
    assert.equal(por.Contrato, undefined, "este cenário não tem etapa Contrato");
    assert.equal(por.Leads.conversaoParaProxima, 3 / 4);
    assert.equal(por["Qualificação"].conversaoParaProxima, 1 / 3);
    assert.equal(por["Proposta e negociação"].conversaoParaProxima, null, "última aberta não tem próxima");
    assert.equal(por.Ganha.conversaoParaProxima, null, "ganha/perdida são desfechos");
    assert.ok(por["Qualificação"].diasMedios! > 0 && por["Qualificação"].diasMedios! < 3);
    assert.deepEqual([por["Qualificação"].agora, por["Qualificação"].valorAgora, por.Leads.agora], [1, 6_000, 1]);
    assert.deepEqual([r.entradas, r.ganhas, r.conversaoTotal], [4, 1, 0.25]);

    // Salto: oportunidade que vai de Leads direto a Ganha conta como tendo chegado a Qualificação e Proposta.
    const salto = await criarOportunidade({ nome: "Salto", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: salto.id, etapaId: c.ganha.id, origem: "MANUAL" });
    const r2 = (await funilPorEtapa(mesAtual(), c.funil.id))!;
    const por2 = Object.fromEntries(r2.etapas.map((e) => [e.nome, e]));
    assert.deepEqual([por2.Leads.entraram, por2["Qualificação"].entraram, por2["Proposta e negociação"].entraram, por2.Ganha.entraram], [5, 4, 2, 2]);
    assert.equal(por2.Leads.conversaoParaProxima, 4 / 5, "o salto não derruba a conversão");
    for (const e of r2.etapas) if (e.conversaoParaProxima !== null) assert.ok(e.conversaoParaProxima <= 1, `${e.nome} ≤ 100%`);
    assert.deepEqual([r2.entradas, r2.ganhas, r2.conversaoTotal], [5, 2, 0.4]);
    assert.equal(await funilPorEtapa(mesAtual(), "nao-existe"), null);
    const vazio = (await funilPorEtapa({ de: new Date("2020-01-01"), ate: new Date("2020-02-01") }, c.funil.id))!;
    assert.deepEqual([vazio.entradas, vazio.conversaoTotal, vazio.etapas[0].conversaoParaProxima], [0, null, null]);
  } finally { await c.limpar(); }
});

test("ganhos e perdas por motivo; ranking por responsável", async () => {
  const c = await cenario();
  const u = await prisma.usuario.create({ data: { nome: "Vendedora", email: `r${c.marca}@t.local`, senhaHash: "x" } });
  try {
    const { venda } = await massa(c, u.id);
    await prisma.oportunidade.updateMany({ where: { funilId: c.funil.id, nome: "C" }, data: { responsavelId: null } });
    const g = await ganhosEPerdas(mesAtual(), c.funil.id);
    assert.deepEqual(g.ganhas, { total: 1, semMotivo: 0, linhas: [{ motivo: venda.nome, quantidade: 1, valor: 11_000 }] });
    assert.deepEqual(g.perdidas, { total: 1, semMotivo: 1, linhas: [{ motivo: "Sem motivo registrado", quantidade: 1, valor: 4_000 }] });
    const rk = await ranking(mesAtual(), c.funil.id);
    assert.deepEqual(rk.map((l) => [l.nome, l.criadas, l.ganhas, l.perdidas, l.valorGanho, l.hitRate]), [["Vendedora", 3, 1, 1, 11_000, 0.5], ["Sem responsável", 1, 0, 0, 0, null]]);
  } finally { await prisma.oportunidade.deleteMany({ where: { funilId: c.funil.id } }); await prisma.usuario.delete({ where: { id: u.id } }); await c.limpar(); }
});

test("metas: meta zero é SEM META (nunca 100%); realizado por mês e por tipo; escopo", async () => {
  const c = await cenario();
  const ano = new Date().getUTCFullYear(), mes = new Date(Date.now() - 3 * 3_600_000).getUTCMonth() + 1;
  try {
    await massa(c, null);
    const total = await metasDoAno(ano, c.funil.id, "TOTAL");
    assert.equal(total.length, 12);
    assert.deepEqual([total[mes - 1].meta, total[mes - 1].atingimento, total[mes - 1].realizado], [null, null, 11_000], "sem meta definida: sem percentual");
    assert.deepEqual(total.filter((m) => m.mes !== mes).map((m) => [m.meta, m.realizado, m.atingimento]).filter((x) => x[1] !== 0 || x[0] !== null), []);
    await definirMeta({ escopo: c.funil.id, ano, mes, tipo: "TOTAL", valor: 22_000 });
    assert.equal((await metasDoAno(ano, c.funil.id, "TOTAL"))[mes - 1].atingimento, 0.5);
    await definirMeta({ escopo: c.funil.id, ano, mes, tipo: "TOTAL", valor: 5_000 });
    assert.equal((await metasDoAno(ano, c.funil.id, "TOTAL"))[mes - 1].atingimento, 11_000 / 5_000, "passar da meta passa de 100%");
    assert.equal(await prisma.meta.count({ where: { escopo: c.funil.id } }), 1, "redefinir atualiza, não duplica");
    assert.equal((await metasDoAno(ano, c.funil.id, "UNICO"))[mes - 1].realizado, 10_000);
    assert.equal((await metasDoAno(ano, c.funil.id, "MENSAL"))[mes - 1].realizado, 1_000);
    assert.equal((await metasDoAno(ano, c.funil.id, "UNICO"))[mes - 1].meta, null, "meta de outro tipo não vaza");
    await definirMeta({ escopo: c.funil.id, ano, mes, tipo: "TOTAL", valor: 0 });
    assert.deepEqual([await prisma.meta.count({ where: { escopo: c.funil.id } }), (await metasDoAno(ano, c.funil.id, "TOTAL"))[mes - 1].atingimento], [0, null], "valor 0 remove: volta a sem meta");
    assert.equal((await metasDoAno(ano - 1, c.funil.id, "TOTAL")).every((m) => m.realizado === 0), true, "outro ano não mistura");
  } finally { await prisma.meta.deleteMany({ where: { escopo: c.funil.id } }); await c.limpar(); }
});

test("auditoria: quem, quando, de → para, origem; filtros e nome do ator", async () => {
  const c = await cenario();
  const u = await prisma.usuario.create({ data: { nome: "Auditora", email: `au${c.marca}@t.local`, senhaHash: "x" } });
  try {
    const op = await criarOportunidade({ nome: "Aud", contatoId: c.contato.id, funilId: c.funil.id, ator: u.id });
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.qualif.id, origem: "INTEGRACAO", ator: "vendedor-ia" });
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.proposta.id, origem: "AUTOMACAO", ator: "automacao", motivo: "Automação: x" });
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.ganha.id, origem: "MANUAL", ator: u.id });
    const l = await auditoria(mesAtual(), { funilId: c.funil.id });
    assert.deepEqual(l.map((x) => [x.ator, x.origem, x.para.split(" · ")[1]]), [["Auditora", "MANUAL", "Ganha"], ["Automação", "AUTOMACAO", "Proposta e negociação"], ["Vendedor IA", "INTEGRACAO", "Qualificação"], ["Auditora", "CRIACAO", "Leads"]]);
    assert.equal(l[0].de, `${c.funil.nome} · Proposta e negociação`);
    assert.equal(l[3].de, null, "criação não tem origem");
    assert.deepEqual((await auditoria(mesAtual(), { funilId: c.funil.id, origem: "AUTOMACAO" })).map((x) => x.motivo), ["Automação: x"]);
    assert.equal((await auditoria(mesAtual(), { funilId: c.funil.id, limite: 2 })).length, 2);
    assert.equal((await auditoria({ de: new Date("2020-01-01"), ate: new Date("2020-02-01") }, { funilId: c.funil.id })).length, 0);
  } finally { await c.limpar(); await prisma.usuario.delete({ where: { id: u.id } }); }
});

test("rotas: sessão, período inválido, tipo desconhecido, funil, metas validadas", async () => {
  const c = await cenario();
  const u = await prisma.usuario.create({ data: { nome: "Rel", email: `rel${c.marca}@t.local`, senhaHash: await bcrypt.hash("x", 4) } });
  const cookie = `${COOKIE_SESSAO}=${await assinarSessao(u.id, process.env.SESSION_SECRET!)}`;
  const req = (url: string, metodo = "GET", corpo?: unknown, logado = true) => new Request(`http://x${url}`, { method: metodo, headers: { "content-type": "application/json", ...(logado ? { cookie } : {}) }, ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}) });
  const p = (tipo: string) => ({ params: Promise.resolve({ tipo }) });
  const ano = new Date().getUTCFullYear();
  try {
    await massa(c, null);
    assert.equal((await getRel(req("/x", "GET", undefined, false), p("kpis"))).status, 401);
    assert.equal((await getRel(req("/x"), p("balanco"))).status, 400);
    assert.equal((await getRel(req("/x?de=2026-13-01&ate=2026-12-01"), p("kpis"))).status, 400);
    assert.equal((await getRel(req("/x?de=2026-01-01"), p("kpis"))).status, 400);
    assert.equal((await getRel(req("/x"), p("funil"))).status, 400, "funil exige funilId");
    assert.equal((await getRel(req("/x?funilId=nao-existe"), p("funil"))).status, 404);
    const k = await (await getRel(req(`/x?funilId=${c.funil.id}`), p("kpis"))).json();
    assert.deepEqual([k.criadas.quantidade, k.ganhas.valor, k.hitRate], [4, 11_000, 0.5]);
    for (const t of ["ganhos-perdas", "ranking", "auditoria"]) assert.equal((await getRel(req(`/x?funilId=${c.funil.id}`), p(t))).status, 200, t);
    assert.equal((await (await getRel(req(`/x?funilId=${c.funil.id}`), p("funil"))).json()).entradas, 4);

    assert.equal((await getMetas(req("/api/metas", "GET", undefined, false))).status, 401);
    assert.equal((await getMetas(req("/api/metas?ano=abc"))).status, 400);
    assert.equal((await getMetas(req(`/api/metas?ano=${ano}&tipo=XYZ`))).status, 400);
    assert.equal((await getMetas(req(`/api/metas?ano=${ano}&escopo=nao-existe`))).status, 400);
    for (const corpo of [{ ano, mes: 13, valor: 1 }, { ano, mes: 1, valor: -5 }, { ano, mes: 1, valor: "muito" }, { ano: 1999, mes: 1, valor: 1 }, { ano, mes: 1, valor: 1, tipo: "X" }, { ano, mes: 1, valor: 1, escopo: "nao-existe" }]) assert.equal((await putMeta(req("/api/metas", "PUT", corpo))).status, 400, JSON.stringify(corpo));
    assert.equal((await putMeta(req("/api/metas", "PUT", { ano, mes: 6, valor: 30_000, escopo: c.funil.id }))).status, 200);
    const m = await (await getMetas(req(`/api/metas?ano=${ano}&escopo=${c.funil.id}`))).json();
    assert.deepEqual([m.meses.length, m.meses[5].meta, m.meses[5].atingimento === null || typeof m.meses[5].atingimento === "number"], [12, 30_000, true]);
  } finally { await prisma.meta.deleteMany({ where: { escopo: c.funil.id } }); await prisma.usuario.delete({ where: { id: u.id } }).catch(() => {}); await c.limpar(); }
});
