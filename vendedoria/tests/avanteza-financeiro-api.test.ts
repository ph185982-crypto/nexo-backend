// API de serviço do financeiro (/api/integracoes/avanteza/financeiro/*): autenticação, validação (zod), separação
// Empresa × Pessoal, reaproveitamento das regras do Max/tela e os achados da revisão das despesas.
// As partes com banco rodam com DATABASE_URL (Postgres local descartável) e usam um mês isolado (2032-05).
import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const temBanco = Boolean(process.env.DATABASE_URL);
const CHAVE = "chave-financeiro-de-teste-nao-real";
const BASE = "http://localhost/api/integracoes/avanteza/financeiro";

async function chamar(metodo: string, caminho: string, opts: { corpo?: unknown; chave?: string | null } = {}) {
  const { tratarFinanceiro } = await import("@/lib/integracoes/avanteza-financeiro");
  const headers: Record<string, string> = {};
  if (opts.chave !== null) headers.authorization = `Bearer ${opts.chave ?? CHAVE}`;
  if (opts.corpo !== undefined) headers["content-type"] = "application/json";
  const req = new NextRequest(`${BASE}/${caminho}`, { method: metodo, headers, ...(opts.corpo !== undefined ? { body: JSON.stringify(opts.corpo) } : {}) });
  const seg = caminho.split("?")[0].split("/");
  const r = await tratarFinanceiro(req, seg, { AVANTEZA_FINANCE_KEY: CHAVE } as unknown as NodeJS.ProcessEnv);
  return { status: r.status, corpo: (await r.json()) as any, cache: r.headers.get("cache-control") };
}

test("chave: 503 sem variável, 401 ausente/errada, comparação em tempo constante", async () => {
  const { conferirChaveFinanceiro, tratarFinanceiro } = await import("@/lib/integracoes/avanteza-financeiro");
  assert.equal(conferirChaveFinanceiro("Bearer x", {} as NodeJS.ProcessEnv), "sem-chave-configurada");
  assert.equal(conferirChaveFinanceiro(null, { AVANTEZA_FINANCE_KEY: CHAVE } as unknown as NodeJS.ProcessEnv), "nao-autorizado");
  assert.equal(conferirChaveFinanceiro("Bearer errada", { AVANTEZA_FINANCE_KEY: CHAVE } as unknown as NodeJS.ProcessEnv), "nao-autorizado");
  assert.equal(conferirChaveFinanceiro(`Bearer ${CHAVE}`, { AVANTEZA_FINANCE_KEY: CHAVE } as unknown as NodeJS.ProcessEnv), "ok");
  // a chave das MÉTRICAS não abre o financeiro
  const sem = await tratarFinanceiro(new NextRequest(`${BASE}/categorias?escopo=empresa`, { headers: { authorization: `Bearer ${CHAVE}` } }), ["categorias"], { AVANTEZA_METRICS_KEY: CHAVE } as unknown as NodeJS.ProcessEnv);
  assert.equal(sem.status, 503);
  const errada = await chamar("GET", "categorias?escopo=empresa", { chave: "outra" });
  assert.equal(errada.status, 401);
  assert.equal(errada.cache, "no-store");
  assert.equal((await chamar("GET", "categorias?escopo=empresa", { chave: null })).status, 401);
});

test("middleware: só o prefixo do financeiro entra na lista pública; o contexto de serviço não vaza", async () => {
  const { rotaPublica } = await import("@/lib/auth/rotas-publicas");
  assert.equal(rotaPublica("/api/integracoes/avanteza/financeiro/transacoes"), true);
  assert.equal(rotaPublica("/api/integracoes/avanteza/financeiro-x"), false);
  assert.equal(rotaPublica("/api/financeiro/transacoes"), false, "as rotas da tela continuam fechadas");
  const { servicoAtivo, emServico } = await import("@/lib/finance/servico");
  assert.equal(servicoAtivo(), false);
  assert.equal(await emServico(async () => servicoAtivo()), true);
  assert.equal(servicoAtivo(), false);
});

test("rotas: casamento por método e caminho; validação zod rejeita escopo ausente/'todos', campos extras e valores ruins", async () => {
  const { casarRota } = await import("@/lib/integracoes/avanteza-financeiro");
  assert.equal(casarRota("GET", ["transacoes"]).rota?.modulo, "transacoes");
  assert.equal(casarRota("PATCH", ["transacoes", "abc-1"]).id, "abc-1");
  assert.equal(casarRota("PUT", ["transacoes"]).metodoNaoPermitido, true);
  assert.equal(casarRota("GET", ["nada"]).rota, undefined);
  assert.equal(casarRota("PATCH", ["transacoes", "..%2Fx"]).rota, undefined, "id fora do padrão não casa");
  assert.equal((await chamar("GET", "transacoes")).status, 400, "escopo obrigatório");
  assert.equal((await chamar("GET", "transacoes?escopo=todos")).status, 400, "nunca 'todos'");
  assert.equal((await chamar("GET", "transacoes?escopo=empresa&x=1")).status, 400, "parâmetro desconhecido");
  assert.equal((await chamar("GET", "nao-existe?escopo=empresa")).status, 404);
  assert.equal((await chamar("DELETE", "categorias?escopo=empresa")).status, 405);
  assert.equal((await chamar("POST", "transacoes?escopo=empresa", { corpo: { tipo: "despesa", valor: -5, descricao: "x", categoria: "y" } })).status, 400);
  assert.equal((await chamar("POST", "transacoes?escopo=empresa", { corpo: { tipo: "despesa", valor: 5, descricao: "x", categoria: "y", tipo_negocio: "pessoal" } })).status, 400, "o cliente não escolhe o negócio");
  assert.equal((await chamar("POST", "transacoes?escopo=empresa", { corpo: { tipo: "despesa", valor: 5, descricao: "x", categoria: "y", data_transacao: "31/05/2032" } })).status, 400);
  assert.equal((await chamar("GET", "metas?escopo=empresa")).status, 404, "metas de poupança são só do pessoal");
  const ruim = await chamar("POST", "receitas?escopo=empresa", { corpo: { modo: "parcelada", descricao: "x", data_prevista: "2032-05-10", meses: 3 } });
  assert.equal(ruim.status, 400);
  assert.ok(Array.isArray(ruim.corpo.campos), "a resposta lista os campos, nunca os valores");
});

test("banco: Empresa × Pessoal isolados, reclassificação, confirmar, conta paga e receita recebida viram extrato", { skip: !temBanco }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const marca = `T${Date.now()}`;
  const criados = { tx: [] as string[], cp: [] as string[], rp: [] as string[] };
  try {
    // Empresa: criada pela API (o negócio vem do escopo, não do corpo)
    const e1 = await chamar("POST", "transacoes?escopo=empresa", { corpo: { tipo: "despesa", valor: 120.5, descricao: `${marca} anúncio`, categoria: "Assinaturas", data_transacao: "2032-05-10" } });
    assert.equal(e1.status, 201);
    assert.equal(e1.corpo.tipo_negocio, "nexo");
    assert.equal(e1.corpo.mes, "2032-05");
    criados.tx.push(e1.corpo.id);
    const e2 = await chamar("POST", "transacoes?escopo=empresa", { corpo: { tipo: "receita", valor: 1000, descricao: `${marca} mensalidade`, categoria: "Mensalidade", data_transacao: "2032-05-31" } });
    criados.tx.push(e2.corpo.id);
    const p1 = await chamar("POST", "transacoes?escopo=pessoal", { corpo: { tipo: "despesa", valor: 300, descricao: `${marca} mercado`, categoria: "Mercado", data_transacao: "2032-05-11" } });
    assert.equal(p1.corpo.tipo_negocio, "pessoal");
    criados.tx.push(p1.corpo.id);

    const lista = async (escopo: string) => (await chamar("GET", `transacoes?escopo=${escopo}&texto=${marca}&pageSize=50`)).corpo.transacoes.map((t: any) => t.id).sort();
    assert.deepEqual(await lista("empresa"), [e1.corpo.id, e2.corpo.id].sort());
    assert.deepEqual(await lista("pessoal"), [p1.corpo.id]);

    // id de outro escopo = 404 (não edita nem apaga às cegas)
    assert.equal((await chamar("PATCH", `transacoes/${p1.corpo.id}?escopo=empresa`, { corpo: { valor: 1 } })).status, 404);
    assert.equal((await chamar("DELETE", `transacoes/${p1.corpo.id}?escopo=empresa`)).status, 404);

    // Resumo do mês isolado: só a empresa
    const r = await chamar("GET", "resumo?escopo=empresa&mes=2032-05");
    assert.equal(r.status, 200);
    assert.equal(r.corpo.escopo, "nexo");
    assert.equal(r.corpo.receitas, 1000);
    assert.equal(r.corpo.despesas, 120.5);
    const rp = await chamar("GET", "resumo?escopo=pessoal&mes=2032-05");
    assert.equal(rp.corpo.despesas, 300);
    assert.equal((await chamar("GET", "dre?escopo=empresa&mes=2032-05")).status, 200);

    // Reclassificar o pessoal para a empresa: sai de um escopo e entra no outro (com a mesma regra da tela)
    const mv = await chamar("PATCH", `transacoes/${p1.corpo.id}?escopo=pessoal`, { corpo: { tipo_negocio: "nexo" } });
    assert.equal(mv.status, 200);
    assert.equal(mv.corpo.tipo_negocio, "nexo");
    assert.equal((await chamar("GET", "resumo?escopo=empresa&mes=2032-05")).corpo.despesas, 420.5);
    // O livro-razão (HistoricoFinanceiro) registrou a alteração: antes pessoal, depois nexo
    const hist = await prisma.historicoFinanceiro.findMany({ where: { entidade: "Transacao", entidade_id: p1.corpo.id, acao: "atualizado" } });
    assert.equal(hist.length, 1);
    assert.equal((hist[0].antes as any).tipo_negocio, "pessoal");
    assert.equal((hist[0].depois as any).tipo_negocio, "nexo");

    // Lançamento não confirmado não entra no resumo; confirmar entra
    const nc = await prisma.transacao.create({ data: { tipo: "despesa", valor: 77, descricao: `${marca} nc`, categoria: "Assinaturas", tipo_negocio: "nexo", data_transacao: new Date("2032-05-12T00:00:00Z"), mes: "2032-05", confirmado: false } });
    criados.tx.push(nc.id);
    assert.equal((await chamar("GET", "resumo?escopo=empresa&mes=2032-05")).corpo.despesas, 420.5);
    assert.equal((await chamar("POST", `transacoes/${nc.id}/confirmar?escopo=empresa`)).status, 200);
    assert.equal((await chamar("GET", "resumo?escopo=empresa&mes=2032-05")).corpo.despesas, 497.5);

    // Conta a pagar: criada no escopo, paga → vira Transacao (despesa) no mesmo escopo
    const c = await chamar("POST", "contas?escopo=empresa", { corpo: { descricao: `${marca} hospedagem`, valor: 50, data_vencimento: "2032-05-15", categoria: "Assinaturas" } });
    assert.equal(c.status, 201);
    criados.cp.push(c.corpo.id);
    assert.deepEqual((await chamar("GET", "contas?escopo=pessoal&status=pendente")).corpo.filter((x: any) => x.id === c.corpo.id), []);
    assert.equal((await chamar("GET", "contas?escopo=empresa&status=pendente")).corpo.filter((x: any) => x.id === c.corpo.id).length, 1);
    const pago = await chamar("PATCH", `contas/${c.corpo.id}?escopo=empresa`, { corpo: { acao: "pagar" } });
    assert.equal(pago.status, 200);
    criados.tx.push(pago.corpo.transacao_id);
    const txPaga = await prisma.transacao.findUnique({ where: { id: pago.corpo.transacao_id } });
    assert.equal(txPaga?.tipo, "despesa");
    assert.equal(txPaga?.tipo_negocio, "nexo");

    // Receita prevista: baixa só lança a entrada na confirmação, e só uma vez
    const rc = await chamar("POST", "receitas?escopo=empresa", { corpo: { modo: "avulsa", descricao: `${marca} projeto`, valor: 900, data_prevista: "2032-05-20", cliente: "Cliente X" } });
    assert.equal(rc.status, 201);
    criados.rp.push(rc.corpo.id);
    assert.equal((await chamar("GET", "resumo?escopo=empresa&mes=2032-05")).corpo.receitas, 1000, "prevista ainda não é receita");
    assert.equal((await chamar("PATCH", `receitas/${rc.corpo.id}?escopo=pessoal`, { corpo: { acao: "confirmar" } })).status, 404);
    assert.equal((await chamar("PATCH", `receitas/${rc.corpo.id}?escopo=empresa`, { corpo: { acao: "confirmar" } })).status, 200);
    assert.equal((await chamar("PATCH", `receitas/${rc.corpo.id}?escopo=empresa`, { corpo: { acao: "confirmar" } })).status, 409, "confirmar duas vezes não duplica");
    const txs = await prisma.transacao.findMany({ where: { descricao: `Receita: ${marca} projeto` } });
    assert.equal(txs.length, 1);
    criados.tx.push(...txs.map((t) => t.id));
    assert.equal(txs[0].tipo_negocio, "nexo");

    // Reclassificar receita prevista em aberto (vazio = pessoal)
    const rp2 = await chamar("POST", "receitas?escopo=pessoal", { corpo: { modo: "avulsa", descricao: `${marca} bico`, valor: 10, data_prevista: "2032-05-21" } });
    criados.rp.push(rp2.corpo.id);
    assert.equal((await chamar("PATCH", `receitas/${rp2.corpo.id}?escopo=pessoal`, { corpo: { acao: "editar", tipo_negocio: "nexo" } })).status, 200);
    assert.equal((await chamar("GET", "receitas?escopo=empresa&mes=2032-05")).corpo.receitas.filter((x: any) => x.id === rp2.corpo.id).length, 1);

    // Categorias do escopo
    const cat = await chamar("GET", "categorias?escopo=empresa");
    assert.ok(cat.corpo.despesas.includes("Assinaturas"));
    assert.ok(!cat.corpo.despesas.includes("Mercado") || (await prisma.transacao.count({ where: { tipo_negocio: "nexo", categoria: "Mercado" } })) > 0);

    // Exclusão grava o antes no livro-razão
    assert.equal((await chamar("DELETE", `transacoes/${e2.corpo.id}?escopo=empresa`)).status, 200);
    assert.equal((await prisma.historicoFinanceiro.count({ where: { entidade: "Transacao", entidade_id: e2.corpo.id, acao: "excluido" } })), 1);
  } finally {
    await prisma.transacao.deleteMany({ where: { id: { in: criados.tx } } });
    await prisma.contaPagarMax.deleteMany({ where: { id: { in: criados.cp } } });
    await prisma.receitaPrevistaMax.deleteMany({ where: { id: { in: criados.rp } } });
  }
});

test("banco (despesas): sem data o lançamento cai no dia de Brasília; Max não duplica ao confirmar/pagar duas vezes", { skip: !temBanco }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const { gerenciarReceitaPrevista, gerenciarContaPagar } = await import("@/lib/max/tools/gestao");
  const { getBrasiliaDateOnly, formatMesUTC } = await import("@/lib/max/config");
  const marca = `M${Date.now()}`;
  const ids = { tx: [] as string[], cp: [] as string[], rp: [] as string[] };
  try {
    const sem = await chamar("POST", "transacoes?escopo=empresa", { corpo: { tipo: "despesa", valor: 1, descricao: `${marca} sem data`, categoria: "Teste" } });
    ids.tx.push(sem.corpo.id);
    assert.equal(new Date(sem.corpo.data_transacao).toISOString().slice(0, 10), getBrasiliaDateOnly().toISOString().slice(0, 10));
    assert.equal(sem.corpo.mes, formatMesUTC(getBrasiliaDateOnly()));

    const rp = await prisma.receitaPrevistaMax.create({ data: { descricao: `${marca} prevista`, valor: 40, data_prevista: new Date("2032-06-01T00:00:00Z") } });
    ids.rp.push(rp.id);
    await gerenciarReceitaPrevista({ acao: "confirmar", id: rp.id });
    const msg = await gerenciarReceitaPrevista({ acao: "confirmar", id: rp.id });
    assert.match(msg, /ja foi confirmada/);
    const txs = await prisma.transacao.findMany({ where: { descricao: `${marca} prevista` } });
    assert.equal(txs.length, 1, "uma entrada só, não em dobro");
    assert.equal(txs[0].tipo_negocio, "pessoal", "receita prevista sem negócio = pessoal (mesma regra da tela)");
    ids.tx.push(...txs.map((t) => t.id));

    const cp = await prisma.contaPagarMax.create({ data: { descricao: `${marca} conta`, valor: 25, data_vencimento: new Date("2032-06-02T00:00:00Z"), tipo_negocio: "nexo" } });
    ids.cp.push(cp.id);
    await gerenciarContaPagar({ acao: "pagar", id: cp.id });
    assert.match(await gerenciarContaPagar({ acao: "pagar", id: cp.id }), /ja esta paga/);
    const txc = await prisma.transacao.findMany({ where: { descricao: `${marca} conta` } });
    assert.equal(txc.length, 1, "uma despesa só, não em dobro");
    ids.tx.push(...txc.map((t) => t.id));
  } finally {
    await prisma.transacao.deleteMany({ where: { id: { in: ids.tx } } });
    await prisma.contaPagarMax.deleteMany({ where: { id: { in: ids.cp } } });
    await prisma.receitaPrevistaMax.deleteMany({ where: { id: { in: ids.rp } } });
  }
});
