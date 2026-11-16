// API de serviço do Funil de Entrega para a Central (F5/C7): o MESMO contrato do CRM antigo
// (crm/docs/integracao-avanteza.md), agora lendo as tabelas com_*. Porta de crm/tests/integracao-avanteza.test.ts
// + teste de contrato: as chaves de cada resposta têm de ser exatamente as do CRM (tests/fixtures/contrato-entregas.json,
// gravado pelo teste do CRM com GERAR_CONTRATO=1).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cenario } from "./_comercial-cenario";
import { ARQUIVO_CONTRATO, formato } from "./_contrato-formato";
import { prisma } from "@/lib/prisma/client";
import { criarOportunidade, moverOportunidade } from "@/lib/comercial/funil/mover";
import { definirModeloPadrao } from "@/lib/comercial/entrega/modelo";
import { decidirAcessoApi } from "@/lib/auth/rotas-publicas";
import { GET as getLista } from "@/app/api/integracoes/avanteza/entregas/route";
import { GET as getQuadro } from "@/app/api/integracoes/avanteza/entregas/quadro/route";
import { GET as getRenovacoes } from "@/app/api/integracoes/avanteza/entregas/renovacoes/route";
import { GET as getGatilhos } from "@/app/api/integracoes/avanteza/entregas/gatilhos/route";
import { GET as getUsuarios } from "@/app/api/integracoes/avanteza/entregas/usuarios/route";
import { GET as getModelos } from "@/app/api/integracoes/avanteza/entregas/modelos/route";
import { PATCH as patchModelo } from "@/app/api/integracoes/avanteza/entregas/modelos/[modeloId]/route";
import { POST as postRotina } from "@/app/api/integracoes/avanteza/entregas/rotina/route";
import { GET as getEntrega, PATCH as patchEntrega } from "@/app/api/integracoes/avanteza/entregas/[id]/route";
import { POST as postConcluir } from "@/app/api/integracoes/avanteza/entregas/[id]/concluir/route";
import { POST as postUpsell } from "@/app/api/integracoes/avanteza/entregas/[id]/upsell/route";
import { POST as postCartao } from "@/app/api/integracoes/avanteza/entregas/[id]/cartoes/route";
import { GET as getCartao, PATCH as patchCartao, DELETE as delCartao } from "@/app/api/integracoes/avanteza/entregas/[id]/cartoes/[cartaoId]/route";

const CHAVE = "chave-de-teste-avanteza-0123456789";
const DIA = 86_400_000;
const rq = (metodo: string, corpo?: unknown, chave: string | null = CHAVE, url = "http://x/api/integracoes/avanteza/entregas") =>
  new Request(url, { method: metodo, headers: { ...(chave ? { authorization: `Bearer ${chave}` } : {}), "content-type": "application/json" }, ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }) });
const ctx = <T extends object>(p: T) => ({ params: Promise.resolve(p) });

/** Formato das respostas, pelo nome do passo (o mesmo nome no teste do CRM). */
const formas: Record<string, string[]> = {};
async function guardar(nome: string, r: Response) {
  const corpo = await r.clone().json();
  formas[nome] = [...formato(corpo)].sort();
  return corpo;
}

test("autenticação: 503 sem variável, 401 sem/errada, 200 com a chave certa; chave não aparece na resposta", async () => {
  delete process.env.AVANTEZA_CRM_KEY;
  assert.equal((await getLista(rq("GET"))).status, 503, "sem AVANTEZA_CRM_KEY a API fica desligada");
  process.env.AVANTEZA_CRM_KEY = "curta";
  assert.equal((await getLista(rq("GET"))).status, 503, "chave curta demais não vale");
  process.env.AVANTEZA_CRM_KEY = CHAVE;
  for (const ch of [null, "errada", CHAVE + "x", CHAVE.slice(0, -1)]) assert.equal((await getLista(rq("GET", undefined, ch))).status, 401);
  const r = await getLista(rq("GET"));
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(await r.json()).includes(CHAVE));
  for (const h of [getQuadro, getRenovacoes, getGatilhos, getUsuarios, getModelos, postRotina]) assert.equal((await h(rq("GET", undefined, null))).status, 401);
  assert.equal((await getEntrega(rq("GET", undefined, null), ctx({ id: "x" }))).status, 401);
  assert.equal((await postCartao(rq("POST", { titulo: "a" }, null), ctx({ id: "x" }))).status, 401);
  assert.equal((await delCartao(rq("DELETE", undefined, null), ctx({ id: "x", cartaoId: "y" }))).status, 401);
});

test("middleware: só o prefixo de entregas é público; o resto de /api/integracoes/avanteza exige sessão", () => {
  const h = { get: () => null };
  const passa = (p: string) => decidirAcessoApi(p, false, h) === "permitir";
  assert.equal(passa("/api/integracoes/avanteza/entregas"), true);
  assert.equal(passa("/api/integracoes/avanteza/entregas/quadro"), true);
  assert.equal(passa("/api/integracoes/avanteza/entregas/x/cartoes/y"), true);
  assert.equal(passa("/api/integracoes/avanteza/entregasx"), false, "prefixo exato");
  assert.equal(passa("/api/integracoes/avanteza/outra"), false);
  assert.equal(passa("/api/comercial/entregas"), false);
});

test("fluxo completo (com_*) e contrato: mesmas chaves do CRM em todas as respostas", async () => {
  process.env.AVANTEZA_CRM_KEY = CHAVE;
  const c = await cenario(true);
  const anterior = await prisma.comModeloEntrega.findFirst({ where: { padrao: true } });
  const modelo = await prisma.comModeloEntrega.create({ data: { nome: `Modelo ${c.marca}`, itens: { create: [{ titulo: "Kickoff", pilar: "COMERCIAL", prazoDias: -3, ordem: 0 }, { titulo: "Acessos", pilar: "OPERACAO", prazoDias: 5, cliente: true, ordem: 1 }] } } });
  await definirModeloPadrao(modelo.id);
  const user = await prisma.user.create({ data: { name: `Admin ${c.marca}`, email: `${c.marca}@x.test`, role: "ADMIN" } });
  try {
    const op = await criarOportunidade({ nome: `Plano ${c.marca}`, contatoId: c.contato.id, funilId: c.funil.id, valorMensal: 1500, ator: "teste" });
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.ganha.id, origem: "MANUAL" });
    const entrega = await prisma.comEntrega.findUniqueOrThrow({ where: { oportunidadeId: op.id } });
    const E = ctx({ id: entrega.id });

    const lista = await guardar("lista", await getLista(rq("GET", undefined, CHAVE, `http://x/a?status=EM_ANDAMENTO`)));
    assert.ok(lista.entregas.some((e: { id: string }) => e.id === entrega.id));
    assert.equal((await getLista(rq("GET", undefined, CHAVE, "http://x/a?status=INVALIDO"))).status, 400);
    const quadroUrl = (qs = "") => rq("GET", undefined, CHAVE, `http://x/q?entregaId=${entrega.id}&${qs}`);
    const quadro = await guardar("quadro", await getQuadro(quadroUrl()));
    assert.equal(quadro.entregas.length, 1);
    assert.equal(quadro.cartoes.length, 2);
    assert.equal(quadro.colunas.length, 5);
    assert.equal(quadro.pilares.length, 6);
    const kick = quadro.cartoes.find((x: { titulo: string }) => x.titulo === "Kickoff");
    assert.ok(kick.diasDeAtraso >= 1, "prazo no passado = atrasado");
    assert.equal(quadro.indicadores.atrasados, 1);
    assert.equal(quadro.indicadores.mrr, 1500);
    assert.equal((await (await getQuadro(quadroUrl("pilar=OPERACAO"))).json()).cartoes.length, 1);
    assert.equal((await (await getQuadro(quadroUrl("atrasados=1"))).json()).cartoes.length, 1);
    assert.equal((await (await getQuadro(quadroUrl("responsavelId=sem"))).json()).cartoes.length, 2);
    assert.equal((await (await getQuadro(quadroUrl(`responsavelId=${user.id}`))).json()).entregas.length, 0);
    assert.equal((await (await getQuadro(rq("GET", undefined, CHAVE, `http://x/q?q=${encodeURIComponent(c.marca.toUpperCase())}`))).json()).entregas.length, 1);
    const ruim = await getQuadro(quadroUrl("pilar=XYZ"));
    assert.equal(ruim.status, 400);
    await guardar("erro", ruim);

    const { id: idKick } = kick;
    const aberto = await guardar("cartao", await getCartao(rq("GET"), ctx({ id: entrega.id, cartaoId: idKick })));
    assert.equal(aberto.titulo, "Kickoff");
    assert.equal(aberto.entrega.contato.id, c.contato.id);
    assert.ok(aberto.historico.length >= 1);
    assert.equal((await getCartao(rq("GET"), ctx({ id: entrega.id, cartaoId: "naoexiste" }))).status, 404);
    assert.equal((await getCartao(rq("GET"), ctx({ id: "outra", cartaoId: idKick }))).status, 404);

    const P = (corpo: unknown, cartaoId = idKick) => patchCartao(rq("PATCH", corpo), ctx({ id: entrega.id, cartaoId }));
    const mov = await P({ coluna: "EM_ANDAMENTO", responsavelId: user.id, titulo: "Kickoff com o dono" });
    assert.equal(mov.status, 200);
    await guardar("ok", mov);
    let k = await prisma.comEntregaCartao.findUniqueOrThrow({ where: { id: idKick } });
    assert.deepEqual([k.coluna, k.responsavelId, k.titulo], ["EM_ANDAMENTO", user.id, "Kickoff com o dono"]);
    assert.ok(k.planejadoEm);
    assert.equal((await P({ coluna: "VOANDO" })).status, 400);
    assert.equal((await P({ responsavelId: "inexistente" })).status, 400);
    assert.equal((await P({ pilar: "NADA" })).status, 400);
    assert.equal((await P({}, "naoexiste")).status, 404);
    k = await prisma.comEntregaCartao.findUniqueOrThrow({ where: { id: idKick } });
    assert.equal(k.coluna, "EM_ANDAMENTO", "pedido inválido não grava nada");
    assert.equal((await P({ responsavelId: null, checklist: [{ texto: "a", feito: true }, { texto: "b" }] })).status, 200);
    assert.equal((await (await getQuadro(quadroUrl())).json()).cartoes.find((x: { id: string }) => x.id === idKick).checklist.feitos, 1);

    const novo = await postCartao(rq("POST", { titulo: "Relatório mensal", pilar: "MARKETING", coluna: "ESSA_SEMANA", dataAlvo: new Date(Date.now() + 3 * DIA).toISOString(), responsavelId: user.id }), E);
    assert.equal(novo.status, 201);
    const idNovo = (await guardar("novoCartao", novo)).id as string;
    assert.equal((await postCartao(rq("POST", { titulo: "" }), E)).status, 400);
    assert.equal((await postCartao(rq("POST", { titulo: "x" }), ctx({ id: "nada" }))).status, 404);
    assert.equal((await postCartao(rq("POST", [1]), E)).status, 400, "corpo precisa ser objeto");

    for (const cid of [idKick, idNovo, quadro.cartoes.find((x: { titulo: string }) => x.titulo === "Acessos").id]) await P({ coluna: "CONCLUIDO" }, cid);
    assert.equal((await prisma.comEntrega.findUniqueOrThrow({ where: { id: entrega.id } })).status, "CONCLUIDA");
    await P({ coluna: "BACKLOG" }, idNovo);
    assert.equal((await prisma.comEntrega.findUniqueOrThrow({ where: { id: entrega.id } })).status, "EM_ANDAMENTO", "cartão que volta reabre a entrega");

    const renova = new Date(Date.now() + 30 * DIA).toISOString();
    assert.equal((await patchEntrega(rq("PATCH", { renovacaoEm: renova, diagnostico: { MARKETING: "Anúncios sem pixel", INEXISTENTE: "x" } }), E)).status, 200);
    const det = await guardar("entrega", await getEntrega(rq("GET"), E));
    assert.equal(det.diagnostico.MARKETING, "Anúncios sem pixel");
    assert.equal(det.diagnostico.INEXISTENTE, undefined);
    assert.equal((await patchEntrega(rq("PATCH", { status: "ZZZ" }), E)).status, 400);
    assert.equal((await patchEntrega(rq("PATCH", { renovacaoEm: "ontem?" }), E)).status, 400);
    assert.equal((await patchEntrega(rq("PATCH", {}), ctx({ id: "nada" }))).status, 404);

    const ren = await (await getRenovacoes(rq("GET", undefined, CHAVE, "http://x/r?dias=60"))).json();
    const minha = ren.renovacoes.find((r: { entregaId: string }) => r.entregaId === entrega.id);
    assert.ok(minha && minha.diasParaRenovar <= 30 && minha.renovacaoOportunidadeId === null);
    formas.renovacoes = [...formato({ renovacoes: [minha] })].sort();
    assert.equal((await getRenovacoes(rq("GET", undefined, CHAVE, "http://x/r?dias=9999"))).status, 400);
    const rot = await guardar("rotina", await postRotina(rq("POST")));
    assert.ok(rot.renovacoes >= 1);
    const depois = await prisma.comEntrega.findUniqueOrThrow({ where: { id: entrega.id } });
    assert.ok(depois.renovacaoOportunidadeId && !depois.renovacaoOportunidadeId.startsWith("reservando"));
    const rot2 = await (await postRotina(rq("POST"))).json();
    assert.equal(await prisma.comOportunidade.count({ where: { nome: `Renovação — ${entrega.nome}` } }), 1, "segunda rodada não abre outra renovação");
    assert.equal(typeof rot2.erros, "number");

    assert.equal((await postConcluir(rq("POST"), E)).status, 200);
    assert.equal((await prisma.comEntrega.findUniqueOrThrow({ where: { id: entrega.id } })).status, "CONCLUIDA");
    assert.equal((await postConcluir(rq("POST"), ctx({ id: "nada" }))).status, 404);

    const up = await postUpsell(rq("POST"), E);
    assert.equal(up.status, 201);
    const upCorpo = await guardar("upsell", up);
    assert.ok(await prisma.comOportunidade.findUnique({ where: { id: upCorpo.oportunidadeId } }));
    assert.equal((await postUpsell(rq("POST"), ctx({ id: "nada" }))).status, 404);

    assert.equal((await delCartao(rq("DELETE"), ctx({ id: entrega.id, cartaoId: idNovo }))).status, 200);
    assert.equal((await delCartao(rq("DELETE"), ctx({ id: entrega.id, cartaoId: idNovo }))).status, 404);

    const mods = await (await getModelos(rq("GET"))).json();
    const meu = mods.modelos.find((m: { id: string }) => m.id === modelo.id);
    assert.ok(meu && meu.padrao && meu.itens.length === 2);
    formas.modelos = [...formato({ modelos: [meu] })].sort();
    const outro = await prisma.comModeloEntrega.create({ data: { nome: `Outro ${c.marca}` } });
    try {
      assert.equal((await patchModelo(rq("PATCH", { padrao: true }), ctx({ modeloId: outro.id }))).status, 200);
      assert.deepEqual((await prisma.comModeloEntrega.findMany({ where: { padrao: true } })).map((m) => m.id), [outro.id]);
      assert.equal((await patchModelo(rq("PATCH", { ativo: false }), ctx({ modeloId: outro.id }))).status, 200);
      assert.equal((await patchModelo(rq("PATCH", {}), ctx({ modeloId: "nada" }))).status, 404);
    } finally { await prisma.comModeloEntrega.delete({ where: { id: outro.id } }); }

    const us = await guardar("usuarios", await getUsuarios(rq("GET")));
    assert.ok(us.usuarios.some((u: { id: string }) => u.id === user.id));
    assert.deepEqual(Object.keys(us.usuarios[0]).sort(), ["id", "nome"], "só id e nome");
    const aut = await prisma.comAutomacao.create({ data: { nome: `Aut ${c.marca}`, gatilho: "ENTREGA_CARTAO_ATRASADO" } as never });
    try {
      const g = await (await getGatilhos(rq("GET"))).json();
      assert.equal(g.gatilhos.length, 6);
      const minhaAut = g.automacoes.find((a: { id: string }) => a.id === aut.id);
      assert.equal(minhaAut.rotuloGatilho, "Entrega: cartão atrasado");
      formas.gatilhos = [...formato({ gatilhos: g.gatilhos, automacoes: [minhaAut] })].sort();
    } finally { await prisma.comAutomacao.delete({ where: { id: aut.id } }); }

    // Contrato: chave por chave, igual ao CRM.
    const referencia = JSON.parse(readFileSync(ARQUIVO_CONTRATO, "utf8")) as Record<string, string[]>;
    assert.deepEqual(Object.keys(formas).sort(), Object.keys(referencia).sort(), "mesmos passos do teste do CRM");
    for (const nome of Object.keys(referencia)) assert.deepEqual(formas[nome], referencia[nome], `formato de "${nome}" diferente do CRM`);
  } finally {
    await prisma.comEntrega.deleteMany({ where: { oportunidade: { funilId: c.funil.id } } });
    await prisma.comOportunidade.deleteMany({ where: { nome: { contains: c.marca } } });
    await c.limpar().catch(() => {});
    await prisma.comModeloEntrega.deleteMany({ where: { id: modelo.id } });
    if (anterior) await prisma.comModeloEntrega.update({ where: { id: anterior.id }, data: { padrao: true } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
});
