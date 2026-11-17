// Busca global da Central no Comercial: GET /api/integracoes/avanteza/busca (Bearer AVANTEZA_CRM_KEY).
// Autenticação, prefixo público exato, acento/caixa, termo literal (% e _), limites, tipos e nada sensível no detalhe.
import test from "node:test";
import assert from "node:assert/strict";
import { cenario } from "./_comercial-cenario";
import { prisma } from "@/lib/prisma/client";
import { criarOportunidade } from "@/lib/comercial/funil/mover";
import { decidirAcessoApi } from "@/lib/auth/rotas-publicas";
import { normalizarBusca, padraoLiteral } from "@/lib/comercial/integracao/busca";
import { GET } from "@/app/api/integracoes/avanteza/busca/route";

const CHAVE = "chave-de-teste-avanteza-busca-0123456789";
const rq = (qs: string, chave: string | null = CHAVE) =>
  new Request(`http://x/api/integracoes/avanteza/busca?${qs}`, { headers: chave ? { authorization: `Bearer ${chave}` } : {} });
type Item = { id: string; titulo: string; detalhe?: string; caminho: string };
const buscar = async (qs: string) => { const r = await GET(rq(qs)); assert.equal(r.status, 200, qs); return (await r.json()) as Record<string, Item[]>; };

async function preparar() {
  const c = await cenario();
  const m = c.marca;
  await prisma.comContato.update({ where: { id: c.contato.id }, data: { nome: `Padaria São João ${m}`, telefone: "5562999991234", email: `fin-${m}@exemplo.com.br`, documento: "11222333000181" } });
  const pessoa = await prisma.comContato.create({ data: { tipo: "PESSOA", nome: `Márcia Lima ${m}`, cargo: "Sócia", empresaId: c.contato.id, telefone: "5562988110099", email: `marcia-${m}@exemplo.com.br` } });
  const op = await criarOportunidade({ nome: `Expansão 100%_total ${m}`, contatoId: c.contato.id, funilId: c.funil.id, valorMensal: 2500 });
  const op2 = await criarOportunidade({ nome: `Expansão 100 total ${m}`, contatoId: c.contato.id, funilId: c.funil.id, valorUnico: 900 });
  const contrato = await prisma.contratoEmitido.create({ data: {
    modelo: "growth", plano: "ESCALE", razaoSocial: `Padaria São João ${m} LTDA`, nomeFantasia: `Padaria São João ${m}`, cnpj: "11222333000181",
    representante: "Márcia Lima", emailCliente: `marcia-${m}@exemplo.com.br`, telefoneCliente: "62988110099", valor: 2500, duracaoMeses: 12,
    inicioEm: new Date(), vencimentoDia: 15, filename: "x.pdf", formJson: {}, status: "ASSINADO", assinadoEm: new Date("2026-11-10T12:00:00Z"),
  } });
  const limpar = async () => {
    await prisma.contratoEmitido.delete({ where: { id: contrato.id } });
    await prisma.comContato.delete({ where: { id: pessoa.id } }).catch(() => {});
    await c.limpar();
  };
  return { ...c, pessoa, op, op2, contrato, limpar };
}

test("autenticação: 503 sem variável ou curta, 401 sem/errada, e o prefixo público é exato", async () => {
  delete process.env.AVANTEZA_CRM_KEY;
  assert.equal((await GET(rq("q=ab"))).status, 503);
  process.env.AVANTEZA_CRM_KEY = "curta";
  assert.equal((await GET(rq("q=ab"))).status, 503);
  process.env.AVANTEZA_CRM_KEY = CHAVE;
  for (const ch of [null, "errada", CHAVE + "x", CHAVE.slice(0, -1)]) assert.equal((await GET(rq("q=ab", ch))).status, 401);
  const h = { get: () => null };
  const passa = (p: string) => decidirAcessoApi(p, false, h) === "permitir";
  assert.ok(passa("/api/integracoes/avanteza/busca"));
  assert.ok(passa("/comercial/api/integracoes/avanteza/busca"));
  assert.ok(!passa("/api/integracoes/avanteza/buscax"), "prefixo exato");
  assert.ok(!passa("/api/integracoes/avanteza/outra"));
});

test("parâmetros: q de 2 a 80, limite 1..10 (padrão 5), tipos válidos — 400 no resto", async () => {
  process.env.AVANTEZA_CRM_KEY = CHAVE;
  for (const qs of ["q=a", `q=${"a".repeat(81)}`, "q=abc&limite=0", "q=abc&limite=11", "q=abc&limite=2.5", "q=abc&limite=x", "q=abc&tipos=leads", "q=abc&tipos=contatos,senhas"]) {
    assert.equal((await GET(rq(qs))).status, 400, qs);
  }
  const r = await buscar("q=zzzz-nada-assim&tipos=contatos");
  assert.deepEqual(Object.keys(r), ["contatos"], "só os tipos pedidos");
  assert.deepEqual(Object.keys(await buscar("q=zzzz-nada-assim")).sort(), ["contatos", "contratos", "oportunidades"]);
  assert.equal(normalizarBusca("  Ação  São "), "acao sao");
  assert.equal(padraoLiteral("100%_a\\b"), "%100\\%\\_a\\\\b%");
});

test("acha ignorando acento e caixa; caminhos das telas reais; nada sensível no detalhe", async () => {
  process.env.AVANTEZA_CRM_KEY = CHAVE;
  const p = await preparar();
  try {
    const r = await buscar(`q=${encodeURIComponent(`padaria sao joao ${p.marca}`)}`);
    const ct = r.contatos.find((i) => i.id === p.contato.id)!;
    assert.ok(ct, "contato achado sem acento");
    assert.equal(ct.caminho, `/comercial/contatos/${p.contato.id}`);
    assert.equal(ct.detalhe, "Empresa");
    const ctr = r.contratos.find((i) => i.id === p.contrato.id)!;
    assert.ok(ctr, "contrato achado");
    assert.equal(ctr.caminho, `/comercial/contratos?abrir=${p.contrato.id}`);
    assert.match(ctr.detalhe!, /^Assinado · assinado em 10\/11\/2026$/);
    const ops = r.oportunidades.filter((i) => [p.op.id, p.op2.id].includes(i.id));
    assert.equal(ops.length, 2, "oportunidade pelo nome do contato");
    for (const o of ops) assert.equal(o.caminho, `/comercial/oportunidades?funil=${p.funil.id}&abrir=${o.id}`);
    assert.match(ops.find((o) => o.id === p.op.id)!.detalhe!, /Leads · R\$\s?2\.500,00\/mês/);

    const pessoa = (await buscar(`q=${encodeURIComponent(`MARCIA LIMA ${p.marca}`)}&tipos=contatos`)).contatos;
    assert.equal(pessoa[0]?.id, p.pessoa.id, "caixa e acento ignorados");
    assert.equal(pessoa[0].detalhe, `Sócia · Padaria São João ${p.marca}`);

    const tudo = JSON.stringify([r, pessoa]);
    for (const sensivel of ["5562999991234", "999991234", "5562988110099", "@exemplo.com.br", "11222333000181", "11.222.333"]) assert.ok(!tudo.includes(sensivel), `vazou ${sensivel}`);
    for (const lista of Object.values(r)) for (const i of lista) {
      assert.ok(i.titulo.length >= 1 && i.titulo.length <= 200);
      assert.ok(!i.detalhe || i.detalhe.length <= 200);
      assert.ok(i.caminho.startsWith("/comercial/"));
      assert.deepEqual(Object.keys(i).sort(), i.detalhe === undefined ? ["caminho", "id", "titulo"] : ["caminho", "detalhe", "id", "titulo"]);
    }
  } finally { await p.limpar(); }
});

test("termo literal: % e _ não viram curinga; limite por tipo", async () => {
  process.env.AVANTEZA_CRM_KEY = CHAVE;
  const p = await preparar();
  try {
    const lit = (await buscar(`q=${encodeURIComponent(`100%_total ${p.marca}`)}&tipos=oportunidades`)).oportunidades.map((o) => o.id);
    assert.deepEqual(lit, [p.op.id], "só o nome com '100%_total' literal");
    const curinga = (await buscar(`q=${encodeURIComponent("%")}${encodeURIComponent("%")}&tipos=oportunidades`)).oportunidades;
    assert.ok(!curinga.some((o) => o.id === p.op2.id), "'%%' não casa tudo");
    const um = await buscar(`q=${encodeURIComponent(p.marca)}&limite=1`);
    for (const t of ["oportunidades", "contatos", "contratos"]) assert.ok(um[t].length <= 1, t);
    assert.equal((await buscar(`q=${encodeURIComponent(p.marca)}&tipos=oportunidades`)).oportunidades.length, 2, "padrão 5 por tipo");
  } finally { await p.limpar(); }
});

test("rápido: responde em menos de 1 s", async () => {
  process.env.AVANTEZA_CRM_KEY = CHAVE;
  const t0 = Date.now();
  await buscar("q=empresa&limite=10");
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
});

test.after(async () => { await prisma.$disconnect(); });
