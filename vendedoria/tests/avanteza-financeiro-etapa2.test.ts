// API de serviço do financeiro, Etapa 2: projeção de caixa, orçamentos, dívidas, contratos de despesa e histórico/restauração.
// Tudo por escopo (empresa × pessoal), sem vazar valores pessoais na empresa. Partes com banco rodam com DATABASE_URL.
import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const temBanco = Boolean(process.env.DATABASE_URL);
const CHAVE = "chave-financeiro-de-teste-nao-real";
const BASE = "http://localhost/api/integracoes/avanteza/financeiro";

async function chamar(metodo: string, caminho: string, corpo?: unknown) {
  const { tratarFinanceiro } = await import("@/lib/integracoes/avanteza-financeiro");
  const headers: Record<string, string> = { authorization: `Bearer ${CHAVE}` };
  if (corpo !== undefined) headers["content-type"] = "application/json";
  const req = new NextRequest(`${BASE}/${caminho}`, { method: metodo, headers, ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}) });
  const r = await tratarFinanceiro(req, caminho.split("?")[0].split("/"), { AVANTEZA_FINANCE_KEY: CHAVE } as unknown as NodeJS.ProcessEnv);
  return { status: r.status, corpo: (await r.json()) as any };
}

test("rotas novas: escopo obrigatório, orçamentos e dívidas só no pessoal, validação zod", async () => {
  const { casarRota } = await import("@/lib/integracoes/avanteza-financeiro");
  assert.equal(casarRota("GET", ["projecao"]).rota?.modulo, "projecao");
  assert.equal(casarRota("POST", ["historico", "abc-1", "restaurar"]).id, "abc-1");
  assert.equal(casarRota("PATCH", ["contratos-despesa", "x1"]).rota?.entidade, "contratoDespesa");
  assert.equal(casarRota("DELETE", ["contratos-despesa", "x1"]).metodoNaoPermitido, true, "contrato de despesa nunca é apagado");
  assert.equal((await chamar("GET", "projecao")).status, 400, "projeção exige escopo");
  assert.equal((await chamar("GET", "projecao?escopo=todos")).status, 400, "nunca 'todos'");
  assert.equal((await chamar("GET", "projecao?escopo=empresa&dias=abc")).status, 400);
  assert.equal((await chamar("GET", "orcamentos?escopo=empresa")).status, 404);
  assert.equal((await chamar("GET", "dividas?escopo=empresa")).status, 404);
  assert.equal((await chamar("PATCH", "dividas/abc?escopo=empresa", { acao: "quitar" })).status, 404);
  assert.equal((await chamar("POST", "orcamentos?escopo=pessoal", { categoria: "x", limite_mensal: -1 })).status, 400);
  assert.equal((await chamar("POST", "orcamentos?escopo=pessoal", { categoria: "x", limite_mensal: 10, extra: 1 })).status, 400);
  assert.equal((await chamar("PATCH", "dividas/abc?escopo=pessoal", { acao: "pagar_parcela" })).status, 400, "pagar parcela exige valor");
  assert.equal((await chamar("POST", "contratos-despesa?escopo=empresa", { descricao: "x", valor_parcela: 10, primeiro_vencimento: "2032-05-10", tipo_negocio: "pessoal" })).status, 400, "o cliente não escolhe o negócio");
  assert.equal((await chamar("POST", "contratos-despesa?escopo=empresa", { descricao: "x", valor_parcela: 10, primeiro_vencimento: "10/05/2032" })).status, 400);
  assert.equal((await chamar("GET", "historico?escopo=empresa&acao=apagado")).status, 400);
});

test("histórico: regra de escopo em JS (pura)", async () => {
  const { escopoDoHistorico, ENTIDADES_DO_ESCOPO } = await import("@/lib/finance/historico-escopo");
  assert.equal(escopoDoHistorico("Transacao", null, { tipo_negocio: "nexo" }), "nexo");
  assert.equal(escopoDoHistorico("Transacao", { tipo_negocio: "pessoal" }, null), "pessoal", "excluída: vale o 'antes'");
  assert.equal(escopoDoHistorico("Transacao", { tipo_negocio: "pessoal" }, { tipo_negocio: "nexo" }), "nexo", "reclassificada: vale o 'depois'");
  assert.equal(escopoDoHistorico("Transacao", null, { tipo_negocio: "lukaizen" }), null);
  assert.equal(escopoDoHistorico("Transacao", null, { tipo_negocio: null }), null, "lançamento sem negócio não é de ninguém");
  assert.equal(escopoDoHistorico("ReceitaPrevistaMax", null, { tipo_negocio: null }), "pessoal", "receita prevista vazia = pessoal");
  assert.equal(escopoDoHistorico("DividaMax", null, { valor_total: 10 }), "pessoal");
  assert.equal(escopoDoHistorico("OrcamentoMax", { categoria: "x" }, null), "pessoal");
  assert.equal(escopoDoHistorico("DreClassificacaoMax", null, { grupo: "x" }), null);
  assert.equal(escopoDoHistorico("FinancialTransaction", null, {}), null);
  assert.ok(!ENTIDADES_DO_ESCOPO.nexo.includes("DividaMax") && ENTIDADES_DO_ESCOPO.pessoal.includes("DividaMax"));
});

test("banco: projeção por escopo, sem vazar o pessoal na empresa", { skip: !temBanco }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const marca = `PJ${Date.now()}`;
  const amanha = new Date(Date.now() - 3 * 3_600_000 + 86_400_000);
  const dataAmanha = amanha.toISOString().slice(0, 10);
  const ids = { cp: [] as string[], rp: [] as string[] };
  try {
    const ce = await prisma.contaPagarMax.create({ data: { descricao: `${marca} conta empresa`, valor: 1234.56, data_vencimento: new Date(`${dataAmanha}T00:00:00Z`), tipo_negocio: "nexo" } });
    const cp = await prisma.contaPagarMax.create({ data: { descricao: `${marca} conta pessoal`, valor: 999.99, data_vencimento: new Date(`${dataAmanha}T00:00:00Z`), tipo_negocio: "pessoal" } });
    ids.cp.push(ce.id, cp.id);
    const rp = await prisma.receitaPrevistaMax.create({ data: { descricao: `${marca} receita vazia`, valor: 500, data_prevista: new Date(`${dataAmanha}T00:00:00Z`), tipo_negocio: null } });
    ids.rp.push(rp.id);
    const e = (await chamar("GET", "projecao?escopo=empresa&dias=10")).corpo;
    const p = (await chamar("GET", "projecao?escopo=pessoal&dias=10")).corpo;
    const eventos = (j: any) => j.dias.flatMap((d: any) => d.eventos).join("|");
    assert.equal(e.escopo, "nexo");
    assert.equal(p.escopo, "pessoal");
    assert.equal(e.dias.length, 10);
    assert.match(eventos(e), new RegExp(`${marca} conta empresa`));
    assert.doesNotMatch(eventos(e), new RegExp(`${marca} conta pessoal|${marca} receita vazia`), "nada do pessoal na empresa");
    assert.match(eventos(p), new RegExp(`${marca} conta pessoal`));
    assert.match(eventos(p), new RegExp(`${marca} receita vazia`), "receita prevista sem negócio vale pessoal");
    assert.doesNotMatch(eventos(p), new RegExp(`${marca} conta empresa`));
    // O dia seguinte muda por: -gasto médio + receitas − contas daquele dia (conferido na MESMA resposta: o banco de teste é
    // compartilhado com outros arquivos de teste rodando em paralelo, então não dá para comparar com uma linha de base).
    const efeitoDia1 = (j: any) => {
      const ev = j.dias[1].eventos.map((t: string) => /^(Receita|Conta): .* R\$(-?[\d.]+)$/.exec(t)!).map((m: RegExpExecArray) => (m[1] === "Receita" ? 1 : -1) * Number(m[2]));
      return { efeito: Math.round((j.dias[1].saldo - j.dias[0].saldo + j.burn_rate) * 100) / 100, soma: Math.round(ev.reduce((a: number, x: number) => a + x, 0) * 100) / 100 };
    };
    for (const j of [e, p]) assert.ok(Math.abs(efeitoDia1(j).efeito - efeitoDia1(j).soma) <= 0.011, "saldo(d) = saldo(d-1) − gasto médio + eventos do dia");
    assert.ok(e.dias[1].eventos.includes(`Conta: ${marca} conta empresa R$1234.56`));
    assert.ok(p.dias[1].eventos.includes(`Conta: ${marca} conta pessoal R$999.99`) && p.dias[1].eventos.includes(`Receita: ${marca} receita vazia R$500.00`));
  } finally {
    await prisma.contaPagarMax.deleteMany({ where: { id: { in: ids.cp } } });
    await prisma.receitaPrevistaMax.deleteMany({ where: { id: { in: ids.rp } } });
  }
});

test("banco: orçamentos e dívidas (pessoal) com a mesma regra da tela", { skip: !temBanco }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const marca = `OR${Date.now()}`;
  const hoje = new Date(Date.now() - 3 * 3_600_000);
  const tx: string[] = [];
  let divida = "";
  try {
    const nova = await chamar("POST", "orcamentos?escopo=pessoal", { categoria: marca, limite_mensal: 200.555 });
    assert.equal(nova.status, 201);
    assert.equal(nova.corpo.limite_mensal, 200.56, "arredonda como a tela");
    const atualiza = await chamar("POST", "orcamentos?escopo=pessoal", { categoria: marca, limite_mensal: 300 });
    assert.equal(atualiza.corpo.limite_mensal, 300, "mesma categoria = atualiza");
    // Gasto do mês: pessoal conta, empresa NÃO entra no orçamento pessoal
    const mes = hoje.toISOString().slice(0, 7);
    const t1 = await prisma.transacao.create({ data: { tipo: "despesa", valor: 40, descricao: `${marca} p`, categoria: marca, tipo_negocio: "pessoal", data_transacao: new Date(hoje.toISOString().slice(0, 10)), mes } });
    const t2 = await prisma.transacao.create({ data: { tipo: "despesa", valor: 90, descricao: `${marca} e`, categoria: marca, tipo_negocio: "nexo", data_transacao: new Date(hoje.toISOString().slice(0, 10)), mes } });
    tx.push(t1.id, t2.id);
    const lista = await chamar("GET", "orcamentos?escopo=pessoal");
    assert.equal(lista.status, 200);
    assert.equal(lista.corpo.find((o: any) => o.categoria === marca).gasto_atual, 40);
    assert.equal((await chamar("DELETE", `orcamentos?escopo=pessoal&categoria=${encodeURIComponent(marca)}`)).status, 200);
    assert.equal((await chamar("DELETE", `orcamentos?escopo=pessoal&categoria=${encodeURIComponent(marca)}`)).status, 404);
    assert.equal((await chamar("DELETE", `orcamentos?escopo=empresa&categoria=x`)).status, 404);

    // Dívidas
    const d = await prisma.dividaMax.create({ data: { descricao: `${marca} divida`, valor_total: 1000, valor_pago: 100, parcela_mensal: 100 } });
    divida = d.id;
    const ld = await chamar("GET", "dividas?escopo=pessoal");
    const item = ld.corpo.find((x: any) => x.id === d.id);
    assert.deepEqual([item.restante, item.progresso], [900, 10]);
    assert.equal((await chamar("PATCH", `dividas/${d.id}?escopo=pessoal`, { acao: "pagar_parcela", valor: 5000 })).status, 400, "parcela maior que o restante");
    const pg = await chamar("PATCH", `dividas/${d.id}?escopo=pessoal`, { acao: "pagar_parcela", valor: 250.5 });
    assert.equal(pg.status, 200);
    assert.equal(pg.corpo.valor_pago, 350.5);
    const lanc = await prisma.transacao.findMany({ where: { descricao: `Parcela: ${marca} divida` } });
    assert.equal(lanc.length, 1, "a parcela vira despesa pessoal no extrato");
    assert.equal(lanc[0].tipo_negocio, "pessoal");
    tx.push(...lanc.map((l) => l.id));
    const q = await chamar("PATCH", `dividas/${d.id}?escopo=pessoal`, { acao: "quitar" });
    assert.equal(q.corpo.status, "quitada");
    assert.equal((await chamar("GET", "dividas?escopo=pessoal")).corpo.some((x: any) => x.id === d.id), false, "quitada sai da lista de ativas");
    assert.equal((await chamar("PATCH", `dividas/id-que-nao-existe?escopo=pessoal`, { acao: "quitar" })).status, 404);
  } finally {
    await prisma.orcamentoMax.deleteMany({ where: { categoria: marca } });
    await prisma.transacao.deleteMany({ where: { id: { in: tx } } });
    if (divida) await prisma.dividaMax.deleteMany({ where: { id: divida } });
  }
});

test("banco: contratos de despesa por escopo (criar, editar, encerrar, reativar, reclassificar; id de outro escopo = 404)", { skip: !temBanco }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const marca = `CD${Date.now()}`;
  const criados: string[] = [];
  try {
    const hoje = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
    const c1 = await chamar("POST", "contratos-despesa?escopo=empresa", { descricao: `${marca} hospedagem`, valor_parcela: 89.9, parcelas_total: 12, primeiro_vencimento: hoje, categoria: "Assinaturas" });
    assert.equal(c1.status, 201);
    assert.equal(c1.corpo.contrato.tipo_negocio, "nexo");
    criados.push(c1.corpo.contrato.id);
    const c2 = await chamar("POST", "contratos-despesa?escopo=pessoal", { descricao: `${marca} carro`, valor_parcela: 1500, primeiro_vencimento: hoje });
    assert.equal(c2.corpo.contrato.tipo_negocio, "pessoal");
    criados.push(c2.corpo.contrato.id);
    assert.equal((await chamar("POST", "contratos-despesa?escopo=empresa", { descricao: `${marca} HOSPEDAGEM`, valor_parcela: 1, primeiro_vencimento: hoje })).status, 400, "nome repetido");
    const nomes = async (e: string) => (await chamar("GET", `contratos-despesa?escopo=${e}`)).corpo.contratos.filter((c: any) => c.descricao.startsWith(marca)).map((c: any) => c.descricao).sort();
    assert.deepEqual(await nomes("empresa"), [`${marca} hospedagem`]);
    assert.deepEqual(await nomes("pessoal"), [`${marca} carro`]);
    const [id1, id2] = criados;
    assert.equal((await chamar("PATCH", `contratos-despesa/${id2}?escopo=empresa`, { acao: "encerrar" })).status, 404, "contrato pessoal não é editável pela empresa");
    const ed = await chamar("PATCH", `contratos-despesa/${id1}?escopo=empresa`, { acao: "editar", valor_parcela: 99.9 });
    assert.equal(ed.status, 200);
    assert.equal(ed.corpo.valor_parcela, 99.9);
    const contas = await prisma.contaPagarMax.findMany({ where: { contrato_id: id1, status: "pendente" } });
    assert.ok(contas.length > 0 && contas.every((c) => c.valor === 99.9 && c.tipo_negocio === "nexo"), "o novo valor vale para as contas pendentes, no escopo do contrato");
    const enc = await chamar("PATCH", `contratos-despesa/${id1}?escopo=empresa`, { acao: "encerrar" });
    assert.equal(enc.status, 200);
    assert.equal((await chamar("GET", "contratos-despesa?escopo=empresa")).corpo.contratos.find((c: any) => c.id === id1).status, "encerrado");
    assert.equal((await chamar("PATCH", `contratos-despesa/${id1}?escopo=empresa`, { acao: "reativar" })).status, 200);
    const mv = await chamar("PATCH", `contratos-despesa/${id1}?escopo=empresa`, { acao: "editar", tipo_negocio: "pessoal" });
    assert.equal(mv.corpo.tipo_negocio, "pessoal");
    assert.deepEqual(await nomes("empresa"), [], "reclassificado sai da empresa");
    assert.equal((await chamar("PATCH", `contratos-despesa/${id1}?escopo=empresa`, { acao: "editar", valor_parcela: 5 })).status, 404);
    assert.equal((await chamar("PATCH", `contratos-despesa/${id1}?escopo=pessoal`, { acao: "editar" })).status, 400, "editar sem campos");
  } finally {
    await prisma.contaPagarMax.deleteMany({ where: { contrato_id: { in: criados } } });
    await prisma.contratoDespesa.deleteMany({ where: { id: { in: criados } } });
  }
});

test("banco: histórico por escopo e restauração (filtro do Prisma = regra em JS; só restaura o que é do escopo)", { skip: !temBanco }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const { escopoDoHistorico } = await import("@/lib/finance/historico-escopo");
  const marca = `HI${Date.now()}`;
  const tx: string[] = [];
  try {
    const mk = async (escopo: string, valor: number, desc: string) => (await chamar("POST", `transacoes?escopo=${escopo}`, { tipo: "despesa", valor, descricao: `${marca} ${desc}`, categoria: "Teste", data_transacao: "2032-05-10" })).corpo;
    const e = await mk("empresa", 11.11, "empresa");
    const p = await mk("pessoal", 22.22, "pessoal");
    const mov = await mk("pessoal", 33.33, "movido");
    tx.push(e.id, p.id, mov.id);
    await chamar("PATCH", `transacoes/${mov.id}?escopo=pessoal`, { tipo_negocio: "nexo" });
    await chamar("DELETE", `transacoes/${e.id}?escopo=empresa`);
    await chamar("DELETE", `transacoes/${p.id}?escopo=pessoal`);

    const hist = async (escopo: string, extra = "") => (await chamar("GET", `historico?escopo=${escopo}&q=${marca}&pageSize=100${extra}`)).corpo;
    const he = await hist("empresa");
    const hp = await hist("pessoal");
    const ids = (h: any) => new Set(h.itens.map((i: any) => i.entidade_id));
    assert.ok(ids(he).has(e.id) && ids(he).has(mov.id));
    assert.ok(!ids(he).has(p.id), "nada do pessoal na empresa");
    assert.ok(ids(hp).has(p.id));
    assert.ok(!ids(hp).has(e.id), "nada da empresa no pessoal");
    // a linha movida pertence ao escopo onde está hoje: nos dois lados só as entradas cujo retrato mais recente é daquele lado
    for (const item of he.itens) assert.equal(escopoDoHistorico(item.entidade, item.antes, item.depois), "nexo");
    for (const item of hp.itens) assert.equal(escopoDoHistorico(item.entidade, item.antes, item.depois), "pessoal");
    assert.ok(he.entidades.includes("Transacao") && !he.entidades.includes("DividaMax"));
    assert.equal((await hist("empresa", "&acao=excluido")).itens.every((i: any) => i.acao === "excluido"), true);

    // restaurar: o item excluído da empresa só volta pela empresa
    const exclEmp = he.itens.find((i: any) => i.entidade_id === e.id && i.acao === "excluido");
    assert.equal(exclEmp.restauravel, true);
    assert.equal((await chamar("POST", `historico/${exclEmp.id}/restaurar?escopo=pessoal`)).status, 404, "outro escopo: 404");
    assert.equal((await prisma.transacao.findUnique({ where: { id: e.id } })), null);
    const ok = await chamar("POST", `historico/${exclEmp.id}/restaurar?escopo=empresa`);
    assert.equal(ok.status, 200);
    const volta = await prisma.transacao.findUnique({ where: { id: e.id } });
    assert.equal(volta?.valor, 11.11);
    assert.equal(volta?.tipo_negocio, "nexo");
    assert.equal((await chamar("POST", `historico/${exclEmp.id}/restaurar?escopo=empresa`)).status, 409, "já existe");
    assert.equal((await chamar("POST", `historico/id-inexistente/restaurar?escopo=empresa`)).status, 404);
    // não restauravel (já restaurado)
    const depois = (await hist("empresa")).itens.find((i: any) => i.id === exclEmp.id);
    assert.equal(depois.restauravel, false);
  } finally {
    await prisma.transacao.deleteMany({ where: { id: { in: tx } } });
  }
});
