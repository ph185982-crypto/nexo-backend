// Endpoint /api/integracoes/avanteza/metricas: autenticação, escopo (só Avanteza), privacidade (só agregados)
// e a matemática dos blocos. As partes com banco rodam com DATABASE_URL (Postgres local descartável).
import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const temBanco = Boolean(process.env.DATABASE_URL);
const D = (s: string) => new Date(`${s}T00:00:00Z`);

test("chave: sem variável = 503; ausente/errada = 401; certa = ok; tamanhos diferentes não quebram", async () => {
  const { conferirChave } = await import("@/lib/integracoes/avanteza-metricas");
  assert.equal(conferirChave("Bearer x", undefined), "sem-chave-configurada");
  assert.equal(conferirChave("Bearer x", "  "), "sem-chave-configurada");
  assert.equal(conferirChave(null, "segredo-longo-123"), "nao-autorizado");
  assert.equal(conferirChave("Basic segredo-longo-123", "segredo-longo-123"), "nao-autorizado");
  assert.equal(conferirChave("Bearer errada", "segredo-longo-123"), "nao-autorizado");
  assert.equal(conferirChave("Bearer segredo-longo-1234", "segredo-longo-123"), "nao-autorizado");
  assert.equal(conferirChave("Bearer segredo-longo-123", "segredo-longo-123"), "ok");
  assert.equal(conferirChave("bearer segredo-longo-123", "segredo-longo-123"), "ok");
});

test("intervalo: datas válidas, ordem, limite de 366 dias; anterior tem o mesmo tamanho; limites em Brasília", async () => {
  const m = await import("@/lib/integracoes/avanteza-metricas");
  assert.equal(m.validarIntervalo(null, "2026-01-02").ok, false);
  assert.equal(m.validarIntervalo("2026-02-31", "2026-03-02").ok, false);
  assert.equal(m.validarIntervalo("2026-03-05", "2026-03-02").ok, false);
  assert.equal(m.validarIntervalo("2025-01-01", "2026-12-31").ok, false);
  const v = m.validarIntervalo("2026-03-01", "2026-03-10");
  assert.ok(v.ok);
  if (!v.ok) return;
  const ant = m.periodoAnteriorDias(v.de, v.ate);
  assert.equal(ant.dias, 10);
  assert.equal(ant.de.toISOString().slice(0, 10), "2026-02-19");
  assert.equal(ant.ate.toISOString().slice(0, 10), "2026-02-28");
  const l = m.limitesBrasilia(v.de, v.ate);
  assert.equal(l.gte.toISOString(), "2026-03-01T03:00:00.000Z");
  assert.equal(l.lt.toISOString(), "2026-03-11T03:00:00.000Z");
  assert.equal(m.diaBrasilia(new Date("2026-03-02T02:59:00Z")), "2026-03-01", "23h59 de Brasília ainda é o dia anterior");
  assert.equal(m.diaBrasilia(new Date("2026-03-02T03:00:00Z")), "2026-03-02");
});

test("middleware: só a rota de métricas entra na lista pública (e não vaza para vizinhas)", async () => {
  const { rotaPublica, decidirAcessoApi } = await import("@/lib/auth/rotas-publicas");
  assert.equal(rotaPublica("/api/integracoes/avanteza/metricas"), true);
  assert.equal(rotaPublica("/api/integracoes/avanteza/metricas-outra"), false);
  assert.equal(rotaPublica("/api/integracoes/avanteza"), false);
  assert.equal(rotaPublica("/api/integracoes/vendedor-ia/conversas"), false);
  assert.equal(decidirAcessoApi("/api/integracoes/avanteza/metricas", false, { get: () => null }), "permitir");
});

function req(qs: string, auth?: string) {
  return new NextRequest(`http://localhost/api/integracoes/avanteza/metricas${qs}`, { headers: auth ? { authorization: auth } : {} });
}

test("rota: 503 sem variável, 401 com chave errada, 400 com período inválido", async () => {
  const { GET } = await import("@/app/api/integracoes/avanteza/metricas/route");
  const antes = process.env.AVANTEZA_METRICS_KEY;
  try {
    delete process.env.AVANTEZA_METRICS_KEY;
    assert.equal((await GET(req("?from=2026-01-01&to=2026-01-02", "Bearer qualquer"))).status, 503);
    process.env.AVANTEZA_METRICS_KEY = "chave-de-teste-nao-real";
    const r401 = await GET(req("?from=2026-01-01&to=2026-01-02", "Bearer errada"));
    assert.equal(r401.status, 401);
    assert.equal(r401.headers.get("cache-control"), "no-store");
    assert.equal((await GET(req("?from=2026-01-01&to=2026-01-02"))).status, 401);
    assert.equal((await GET(req("?from=ontem&to=hoje", "Bearer chave-de-teste-nao-real"))).status, 400);
    assert.equal((await GET(req("", "Bearer chave-de-teste-nao-real"))).status, 400);
  } finally {
    if (antes === undefined) delete process.env.AVANTEZA_METRICS_KEY; else process.env.AVANTEZA_METRICS_KEY = antes;
  }
});

test("banco: só escopo Avanteza, só agregados, matemática dos blocos, previstos e contratos", { skip: !temBanco }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const { registrarCriacaoLead, aplicarMudancaDeEtapa } = await import("@/lib/crm/historico-etapa");
  const { calcularMetricas } = await import("@/lib/integracoes/avanteza-metricas");
  const { GET } = await import("@/app/api/integracoes/avanteza/metricas/route");
  const marca = `m${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const NOME_SECRETO = `Fulana-${marca}`;
  const FONE = `5562${Math.floor(10000000 + Math.random() * 89999999)}`;
  const org = await prisma.whatsappBusinessOrganization.create({ data: { name: marca, documentId: "1", documentType: "CNPJ" } });
  const mkCol = (name: string, type: string, order: number) => prisma.kanbanColumn.create({ data: { name, type, order, color: "#000", organizationId: org.id } });
  const novos = await mkCol("Novos", "TRIAGE", 0);
  const ganho = await mkCol("Ganho", "GANHO", 1);
  const perdido = await mkCol("Perdido", "LOST", 2);
  const env = { AVANTEZA_METRICS_ORG_ID: org.id } as unknown as NodeJS.ProcessEnv;
  // período isolado de qualquer dado real/antigo do banco de teste
  const [de, ate] = [D("2031-03-01"), D("2031-03-10")];
  const criados: { leads: string[]; tx: string[]; rp: string[]; cp: string[]; ct: string[] } = { leads: [], tx: [], rp: [], cp: [], ct: [] };
  const lead = async (when: string, col = novos, extra: Record<string, unknown> = {}) => {
    const l = await prisma.lead.create({ data: { phoneNumber: FONE, profileName: NOME_SECRETO, leadOrigin: "INBOUND", organizationId: org.id, kanbanColumnId: col.id, createdAt: new Date(when), etapaDesdeEm: new Date(when), ...extra } });
    criados.leads.push(l.id);
    await registrarCriacaoLead({ leadId: l.id, coluna: col });
    return l;
  };
  try {
    // 4 leads novos no período (um deles criado às 01h UTC de 11/03 = 22h de 10/03 em Brasília → conta no dia 10)
    const a = await lead("2031-03-02T15:00:00Z");
    const b = await lead("2031-03-03T15:00:00Z");
    await lead("2031-03-05T15:00:00Z");
    await lead("2031-03-11T01:00:00Z");
    await lead("2031-03-11T04:00:00Z"); // 01h de Brasília de 11/03: fora
    await lead("2031-02-25T15:00:00Z"); // período anterior (1 lead)
    // a vira cliente (R$ 3.000), b é perdido
    await aplicarMudancaDeEtapa({ leadId: a.id, coluna: ganho, origem: "MANUAL", quando: new Date("2031-03-04T15:00:00Z") });
    await prisma.lead.update({ where: { id: a.id }, data: { valorContrato: 3000 } });
    await aplicarMudancaDeEtapa({ leadId: b.id, coluna: perdido, origem: "MANUAL", quando: new Date("2031-03-06T15:00:00Z") });

    const tx = (tipo: string, valor: number, cat: string, negocio: string, dia: string, confirmado = true) =>
      prisma.transacao.create({ data: { tipo, valor, descricao: `${NOME_SECRETO} lançamento`, categoria: cat, tipo_negocio: negocio, data_transacao: D(dia), mes: dia.slice(0, 7), confirmado } }).then((t) => criados.tx.push(t.id));
    await tx("receita", 5000, "Mensalidade", "nexo", "2031-03-03");
    await tx("receita", 700, "Mensalidade", "vendedoria", "2031-03-04"); // legado = Avanteza
    await tx("receita", 9999, "Salário", "pessoal", "2031-03-04"); // pessoal: nunca entra
    await tx("receita", 8888, "Outro", "lukaizen", "2031-03-04"); // outros: nunca entra
    await tx("despesa", 1200, "Anúncios", "nexo", "2031-03-05");
    await tx("despesa", 300, "Software", "nexo", "2031-03-06");
    await tx("despesa", 4444, "Mercado", "pessoal", "2031-03-06");
    await tx("despesa", 777, "Software", "nexo", "2031-03-07", false); // não confirmada: fora
    await tx("receita", 100, "Mensalidade", "nexo", "2031-02-20"); // anterior

    const base = await calcularMetricas(D("2031-01-01"), D("2031-01-02"), env); // só para medir o retrato de hoje antes
    const ct = await prisma.contratoReceita.create({ data: { descricao: `${NOME_SECRETO} contrato`, cliente: NOME_SECRETO, tipo_negocio: "nexo", modo: "recorrente", valor_parcela: 1500, dia_vencimento: 5, data_inicio: D("2031-03-05") } });
    const ctPessoal = await prisma.contratoReceita.create({ data: { descricao: "pessoal", tipo_negocio: "pessoal", modo: "recorrente", valor_parcela: 100, dia_vencimento: 5, data_inicio: D("2031-03-05") } });
    criados.ct.push(ct.id, ctPessoal.id);

    const m = await calcularMetricas(de, ate, env);

    // Leads e conversão
    assert.equal(m.atual.leads.novos, 4);
    assert.equal(m.anterior.leads.novos, 1);
    assert.equal(m.atual.leads.ganhos, 1);
    assert.equal(m.atual.leads.perdidos, 1);
    assert.deepEqual(m.atual.leads.porEtapa.map((e) => [e.tipo, e.quantidade]).sort(), [["GANHO", 1], ["LOST", 1], ["TRIAGE", 2]]);
    assert.equal(m.atual.conversao.taxaPct, 25);
    assert.equal(m.atual.vendas.quantidade, 1);
    assert.equal(m.atual.vendas.valor, 3000);
    assert.equal(m.atual.vendas.ticketMedio, 3000);
    assert.equal(m.atual.faturamento.vendido, 3000);
    // Financeiro: pessoal, outros e não confirmado ficam de fora
    assert.equal(m.atual.financeiro.receitas, 5700);
    assert.equal(m.atual.financeiro.despesas, 1500);
    assert.equal(m.atual.financeiro.resultado, 4200);
    assert.deepEqual(m.atual.financeiro.despesasPorCategoria, [{ categoria: "Anúncios", valor: 1200 }, { categoria: "Software", valor: 300 }]);
    assert.equal(m.anterior.financeiro.receitas, 100);
    // Contratos novos (o pessoal não conta)
    assert.equal(m.atual.faturamento.contratosRecorrentesNovos, 1);
    assert.equal(m.atual.faturamento.valorMensalRecorrenteNovo, 1500);
    // Séries diárias cobrem todos os dias, com o fuso de Brasília
    assert.equal(m.atual.series.length, 10);
    assert.equal(m.atual.series[9].data, "2031-03-10");
    assert.equal(m.atual.series[9].leadsNovos, 1, "lead das 22h de Brasília cai no dia 10");
    assert.equal(m.atual.series[3].ganhos, 1);
    assert.equal(m.atual.series[3].vendas, 3000);
    assert.equal(m.atual.series[2].receitas, 5000);
    assert.equal(m.atual.series.reduce((s, p) => s + p.leadsNovos, 0), 4);
    // Escopo declarado
    assert.equal(m.escopo.financeiro, "avanteza");
    assert.ok(m.escopo.excluido.includes("pessoal"));

    // Previstos e contratos: o retrato muda exatamente pelo que criamos (pessoal/sem tipo não contam)
    const rp = (valor: number, dias: number, negocio: string | null, status = "pendente", contrato?: string) => {
      const d = new Date(Date.now() + dias * 86_400_000);
      return prisma.receitaPrevistaMax.create({ data: { descricao: "x", valor, data_prevista: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), tipo_negocio: negocio, status, contrato_id: contrato ?? null, parcela_numero: contrato ? 1 : null } }).then((r) => criados.rp.push(r.id));
    };
    await rp(1000, 10, "nexo"); await rp(2000, 45, "nexo"); await rp(500, 5, "nexo", "recebida");
    await rp(900, 10, null); await rp(800, 10, "pessoal");
    await rp(1500, 20, "nexo", "pendente", ct.id);
    await rp(300, -3, "nexo", "atrasada");
    const cp = (valor: number, dias: number, negocio: string) => {
      const d = new Date(Date.now() + dias * 86_400_000);
      return prisma.contaPagarMax.create({ data: { descricao: "y", valor, data_vencimento: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), tipo_negocio: negocio } }).then((r) => criados.cp.push(r.id));
    };
    await cp(400, 7, "nexo"); await cp(6000, 7, "pessoal");
    const depois = await calcularMetricas(D("2031-01-01"), D("2031-01-02"), env);
    const dR = (k: "total" | "quantidade" | "proximos30" | "proximos60" | "proximos90") => Math.round((depois.previstos.aReceber[k] - base.previstos.aReceber[k]) * 100) / 100;
    assert.equal(dR("total"), 4500);
    assert.equal(dR("quantidade"), 3);
    assert.equal(dR("proximos30"), 2500);
    assert.equal(dR("proximos60"), 4500);
    assert.equal(depois.previstos.aReceber.atrasado.total - base.previstos.aReceber.atrasado.total, 300);
    assert.equal(depois.previstos.aReceber.deContratos.total - base.previstos.aReceber.deContratos.total, 1500);
    assert.equal(depois.previstos.aPagar.total - base.previstos.aPagar.total, 400);
    assert.equal(depois.contratos.ativos - base.contratos.ativos, 1);
    assert.equal(depois.contratos.valorMensalRecorrente - base.contratos.valorMensalRecorrente, 1500);

    // Pela rota: 200 com a chave, e o corpo NUNCA contém nome nem telefone
    process.env.AVANTEZA_METRICS_KEY = "chave-de-teste-nao-real";
    process.env.AVANTEZA_METRICS_ORG_ID = org.id;
    const res = await GET(req("?from=2031-03-01&to=2031-03-10", "Bearer chave-de-teste-nao-real"));
    assert.equal(res.status, 200);
    const texto = await res.text();
    assert.ok(!texto.includes(NOME_SECRETO) && !texto.includes(FONE) && !texto.includes("Salário"), "nada de nome, telefone ou dado pessoal");
    assert.equal(JSON.parse(texto).atual.leads.novos, 4);
  } finally {
    delete process.env.AVANTEZA_METRICS_KEY;
    delete process.env.AVANTEZA_METRICS_ORG_ID;
    await prisma.transacao.deleteMany({ where: { id: { in: criados.tx } } });
    await prisma.receitaPrevistaMax.deleteMany({ where: { id: { in: criados.rp } } });
    await prisma.contaPagarMax.deleteMany({ where: { id: { in: criados.cp } } });
    await prisma.contratoReceita.deleteMany({ where: { id: { in: criados.ct } } });
    await prisma.historicoFinanceiro.deleteMany({ where: { entidade_id: { in: [...criados.tx, ...criados.rp, ...criados.cp, ...criados.ct] } } });
    await prisma.leadActivity.deleteMany({ where: { leadId: { in: criados.leads } } });
    await prisma.metaConversionEvent.deleteMany({ where: { leadId: { in: criados.leads } } });
    await prisma.lead.deleteMany({ where: { id: { in: criados.leads } } });
    await prisma.kanbanColumn.deleteMany({ where: { organizationId: org.id } });
    await prisma.whatsappBusinessOrganization.deleteMany({ where: { id: org.id } });
  }
});

test("a rota só lê: nenhum create/update/delete nem migração no módulo", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["src/lib/integracoes/avanteza-metricas.ts", "src/app/api/integracoes/avanteza/metricas/route.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /prisma\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\$executeRaw|\$queryRawUnsafe/, f);
    assert.doesNotMatch(src, /migrarVendedoriaParaNexo|garantirParcelasContratos/, f);
  }
});
