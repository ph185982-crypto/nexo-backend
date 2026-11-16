import test from "node:test";
import assert from "node:assert/strict";
import { cenario } from "./_cenario";
import { prisma } from "@/lib/prisma";
import { criarOportunidade, moverOportunidade } from "@/lib/funil/mover";
import { definirModeloPadrao } from "@/lib/entrega/modelo";
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
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Teste de contrato com o Vendedor IA (F5/C7): o Vendedor IA serve a mesma API lendo com_*. As chaves de cada resposta
// ficam em vendedoria/tests/fixtures/contrato-entregas.json; GERAR_CONTRATO=1 regrava a partir DESTE teste (a referência
// é o CRM), sem a variável o teste confere. vendedoria/tests/avanteza-entregas-api.test.ts confere o mesmo arquivo.
const ARQUIVO_CONTRATO = join(process.cwd(), "..", "vendedoria", "tests", "fixtures", "contrato-entregas.json");
function formato(v: unknown, caminho = "", saida = new Set<string>()): Set<string> {
  if (Array.isArray(v)) { saida.add(`${caminho}[]`); for (const x of v) formato(x, `${caminho}[]`, saida); }
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { saida.add(`${caminho}.${k}`); formato(x, `${caminho}.${k}`, saida); }
  return saida;
}
const formas: Record<string, string[]> = {};
async function guardar(nome: string, r: Response) {
  const corpo = await r.clone().json();
  formas[nome] = [...formato(corpo)].sort();
  return corpo;
}

const CHAVE = "chave-de-teste-avanteza-0123456789";
const DIA = 86_400_000;
const rq = (metodo: string, corpo?: unknown, chave: string | null = CHAVE, url = "http://x/api/integracoes/avanteza/entregas") =>
  new Request(url, { method: metodo, headers: { ...(chave ? { authorization: `Bearer ${chave}` } : {}), "content-type": "application/json" }, ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }) });
const ctx = <T extends object>(p: T) => ({ params: Promise.resolve(p) });

test("autenticação: 503 sem variável, 401 sem/errada, 200 com a chave certa; chave não aparece na resposta", async () => {
  delete process.env.AVANTEZA_CRM_KEY;
  assert.equal((await getLista(rq("GET"))).status, 503, "sem AVANTEZA_CRM_KEY a API fica desligada");
  process.env.AVANTEZA_CRM_KEY = "curta";
  assert.equal((await getLista(rq("GET"))).status, 503, "chave curta demais não vale");
  process.env.AVANTEZA_CRM_KEY = CHAVE;
  assert.equal((await getLista(rq("GET", undefined, null))).status, 401);
  assert.equal((await getLista(rq("GET", undefined, "errada"))).status, 401);
  assert.equal((await getLista(rq("GET", undefined, CHAVE + "x"))).status, 401);
  assert.equal((await getLista(rq("GET", undefined, CHAVE.slice(0, -1)))).status, 401);
  const r = await getLista(rq("GET"));
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(await r.json()).includes(CHAVE));
  // Toda rota recusa sem chave.
  for (const h of [getQuadro, getRenovacoes, getGatilhos, getUsuarios, getModelos, postRotina]) assert.equal((await h(rq("GET", undefined, null))).status, 401);
  assert.equal((await getEntrega(rq("GET", undefined, null), ctx({ id: "x" }))).status, 401);
  assert.equal((await postCartao(rq("POST", { titulo: "a" }, null), ctx({ id: "x" }))).status, 401);
  assert.equal((await delCartao(rq("DELETE", undefined, null), ctx({ id: "x", cartaoId: "y" }))).status, 401);
});

test("middleware: só o prefixo de entregas é público; o resto de /api/integracoes/avanteza exige sessão", async () => {
  process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-16";
  const passa = async (p: string) => (await middleware(new NextRequest(`http://x${p}`))).headers.get("x-middleware-next") === "1";
  assert.equal(await passa("/api/integracoes/avanteza/entregas"), true);
  assert.equal(await passa("/api/integracoes/avanteza/entregas/quadro"), true);
  assert.equal(await passa("/api/integracoes/vendedor-ia/eventos"), true);
  assert.equal(await passa("/api/integracoes/avanteza/outra"), false);
  assert.equal(await passa("/api/integracoes/qualquer"), false);
  assert.equal(await passa("/api/entregas"), false);
});

test("fluxo completo: quadro, abrir/mover/criar/editar/apagar cartão, concluir, renovação, modelos, upsell", async () => {
  process.env.AVANTEZA_CRM_KEY = CHAVE;
  const c = await cenario(true);
  const anterior = await prisma.modeloEntrega.findFirst({ where: { padrao: true } });
  const modelo = await prisma.modeloEntrega.create({ data: { nome: `Modelo ${c.marca}`, itens: { create: [{ titulo: "Kickoff", pilar: "COMERCIAL", prazoDias: -3, ordem: 0 }, { titulo: "Acessos", pilar: "OPERACAO", prazoDias: 5, cliente: true, ordem: 1 }] } } });
  await definirModeloPadrao(modelo.id);
  const user = await prisma.usuario.create({ data: { nome: `Admin ${c.marca}`, email: `${c.marca}@x.test`, senhaHash: "x", papel: "ADMIN" } });
  try {
    const op = await criarOportunidade({ nome: `Plano ${c.marca}`, contatoId: c.contato.id, funilId: c.funil.id, valorMensal: 1500, ator: "teste" });
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.ganha.id, origem: "MANUAL" });
    const entrega = await prisma.entrega.findUniqueOrThrow({ where: { oportunidadeId: op.id } });
    const E = ctx({ id: entrega.id });

    // lista e quadro
    const lista = await (await getLista(rq("GET"))).json();
    await guardar("lista", await getLista(rq("GET", undefined, CHAVE, "http://x/a?status=EM_ANDAMENTO")));
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
    assert.equal((await (await getQuadro(quadroUrl(`responsavelId=${user.id}`))).json()).entregas.length, 0, "filtro de cartão tira entrega sem cartão correspondente");
    assert.equal((await (await getQuadro(rq("GET", undefined, CHAVE, `http://x/q?q=${encodeURIComponent(c.marca.toUpperCase())}`))).json()).entregas.length, 1, "busca por nome do cliente, sem diferenciar maiúsculas");
    const ruim = await getQuadro(quadroUrl("pilar=XYZ"));
    assert.equal(ruim.status, 400);
    await guardar("erro", ruim);

    // abrir cartão
    const { id: idKick } = kick;
    const aberto = await guardar("cartao", await getCartao(rq("GET"), ctx({ id: entrega.id, cartaoId: idKick })));
    assert.equal(aberto.titulo, "Kickoff");
    assert.equal(aberto.entrega.contato.id, c.contato.id);
    assert.ok(aberto.historico.length >= 1);
    assert.equal((await getCartao(rq("GET"), ctx({ id: entrega.id, cartaoId: "naoexiste" }))).status, 404);
    assert.equal((await getCartao(rq("GET"), ctx({ id: "outra", cartaoId: idKick }))).status, 404, "cartão de outra entrega não abre");

    // mover cartão: mesma regra do CRM (planejado, colunaDesdeEm), responsável, edição
    const P = (corpo: unknown, cartaoId = idKick) => patchCartao(rq("PATCH", corpo), ctx({ id: entrega.id, cartaoId }));
    const mov = await P({ coluna: "EM_ANDAMENTO", responsavelId: user.id, titulo: "Kickoff com o dono" });
    assert.equal(mov.status, 200);
    await guardar("ok", mov);
    let k = await prisma.entregaCartao.findUniqueOrThrow({ where: { id: idKick } });
    assert.deepEqual([k.coluna, k.responsavelId, k.titulo], ["EM_ANDAMENTO", user.id, "Kickoff com o dono"]);
    assert.ok(k.planejadoEm, "mudar de coluna marca como planejado, como no CRM");
    assert.equal((await P({ coluna: "VOANDO" })).status, 400);
    assert.equal((await P({ responsavelId: "inexistente" })).status, 400);
    assert.equal((await P({ pilar: "NADA" })).status, 400);
    assert.equal((await P({}, "naoexiste")).status, 404);
    k = await prisma.entregaCartao.findUniqueOrThrow({ where: { id: idKick } });
    assert.equal(k.coluna, "EM_ANDAMENTO", "pedido inválido não grava nada");
    assert.equal((await P({ responsavelId: null, checklist: [{ texto: "a", feito: true }, { texto: "b" }] })).status, 200);
    k = await prisma.entregaCartao.findUniqueOrThrow({ where: { id: idKick } });
    assert.equal(k.responsavelId, null);
    assert.equal((await (await getQuadro(quadroUrl())).json()).cartoes.find((x: { id: string }) => x.id === idKick).checklist.feitos, 1);

    // criar cartão
    const novo = await postCartao(rq("POST", { titulo: "Relatório mensal", pilar: "MARKETING", coluna: "ESSA_SEMANA", dataAlvo: new Date(Date.now() + 3 * DIA).toISOString(), responsavelId: user.id }), E);
    assert.equal(novo.status, 201);
    const idNovo = (await guardar("novoCartao", novo)).id as string;
    assert.equal((await postCartao(rq("POST", { titulo: "" }), E)).status, 400);
    assert.equal((await postCartao(rq("POST", { titulo: "x" }), ctx({ id: "nada" }))).status, 404);
    assert.equal((await postCartao(rq("POST", [1]), E)).status, 400, "corpo precisa ser objeto");

    // concluir todos os cartões → entrega conclui sozinha (ciclo do CRM); reabrir ao tirar de Concluído
    for (const cid of [idKick, idNovo, quadro.cartoes.find((x: { titulo: string }) => x.titulo === "Acessos").id]) await P({ coluna: "CONCLUIDO" }, cid);
    assert.equal((await prisma.entrega.findUniqueOrThrow({ where: { id: entrega.id } })).status, "CONCLUIDA");
    await P({ coluna: "BACKLOG" }, idNovo);
    assert.equal((await prisma.entrega.findUniqueOrThrow({ where: { id: entrega.id } })).status, "EM_ANDAMENTO", "cartão que volta reabre a entrega");

    // editar/concluir entrega
    const renova = new Date(Date.now() + 30 * DIA).toISOString();
    assert.equal((await patchEntrega(rq("PATCH", { renovacaoEm: renova, diagnostico: { MARKETING: "Anúncios sem pixel", INEXISTENTE: "x" } }), E)).status, 200);
    const det = await guardar("entrega", await getEntrega(rq("GET"), E));
    assert.equal(det.diagnostico.MARKETING, "Anúncios sem pixel");
    assert.equal(det.diagnostico.INEXISTENTE, undefined);
    assert.equal(det.cartoes[0].responsavel === null || typeof det.cartoes[0].responsavel.id === "string", true);
    assert.equal((await patchEntrega(rq("PATCH", { status: "ZZZ" }), E)).status, 400);
    assert.equal((await patchEntrega(rq("PATCH", { renovacaoEm: "ontem?" }), E)).status, 400);
    assert.equal((await patchEntrega(rq("PATCH", {}), ctx({ id: "nada" }))).status, 404);

    // renovações próximas
    const ren = await (await getRenovacoes(rq("GET", undefined, CHAVE, "http://x/r?dias=60"))).json();
    const minha = ren.renovacoes.find((r: { entregaId: string }) => r.entregaId === entrega.id);
    assert.ok(minha && minha.diasParaRenovar <= 30 && minha.renovacaoOportunidadeId === null);
    formas.renovacoes = [...formato({ renovacoes: [minha] })].sort();
    assert.equal((await getRenovacoes(rq("GET", undefined, CHAVE, "http://x/r?dias=9999"))).status, 400);
    // rotina abre a oportunidade de renovação (via mover.ts) e é idempotente
    const rot = await guardar("rotina", await postRotina(rq("POST")));
    assert.ok(rot.renovacoes >= 1);
    const depois = await prisma.entrega.findUniqueOrThrow({ where: { id: entrega.id } });
    assert.ok(depois.renovacaoOportunidadeId && !depois.renovacaoOportunidadeId.startsWith("reservando"));
    const ren2 = (await (await getRenovacoes(rq("GET", undefined, CHAVE, "http://x/r"))).json()).renovacoes.find((r: { entregaId: string }) => r.entregaId === entrega.id);
    assert.equal(ren2.renovacaoOportunidadeId, depois.renovacaoOportunidadeId);
    const rot2 = await (await postRotina(rq("POST"))).json();
    assert.equal((await prisma.oportunidade.count({ where: { nome: `Renovação — ${entrega.nome}` } })), 1, "segunda rodada não abre outra renovação");
    assert.equal(typeof rot2.erros, "number");

    // concluir pela API
    assert.equal((await postConcluir(rq("POST"), E)).status, 200);
    assert.equal((await prisma.entrega.findUniqueOrThrow({ where: { id: entrega.id } })).status, "CONCLUIDA");
    assert.equal((await postConcluir(rq("POST"), ctx({ id: "nada" }))).status, 404);

    // upsell abre oportunidade por mover.ts
    const up = await postUpsell(rq("POST"), E);
    assert.equal(up.status, 201);
    assert.ok(await prisma.oportunidade.findUnique({ where: { id: (await guardar("upsell", up)).oportunidadeId } }));
    assert.equal((await postUpsell(rq("POST"), ctx({ id: "nada" }))).status, 404);

    // apagar cartão
    assert.equal((await delCartao(rq("DELETE"), ctx({ id: entrega.id, cartaoId: idNovo }))).status, 200);
    assert.equal((await delCartao(rq("DELETE"), ctx({ id: entrega.id, cartaoId: idNovo }))).status, 404);

    // modelos
    const mods = await (await getModelos(rq("GET"))).json();
    assert.ok(mods.modelos.some((m: { id: string; padrao: boolean; itens: unknown[] }) => m.id === modelo.id && m.padrao && m.itens.length === 2));
    formas.modelos = [...formato({ modelos: [mods.modelos.find((m: { id: string }) => m.id === modelo.id)] })].sort();
    const outro = await prisma.modeloEntrega.create({ data: { nome: `Outro ${c.marca}` } });
    try {
      assert.equal((await patchModelo(rq("PATCH", { padrao: true }), ctx({ modeloId: outro.id }))).status, 200);
      assert.deepEqual((await prisma.modeloEntrega.findMany({ where: { padrao: true } })).map((m) => m.id), [outro.id]);
      assert.equal((await patchModelo(rq("PATCH", { ativo: false }), ctx({ modeloId: outro.id }))).status, 200);
      assert.equal((await patchModelo(rq("PATCH", {}), ctx({ modeloId: "nada" }))).status, 404);
    } finally { await prisma.modeloEntrega.delete({ where: { id: outro.id } }); }

    // usuários e gatilhos
    const us = await guardar("usuarios", await getUsuarios(rq("GET")));
    assert.ok(us.usuarios.some((u: { id: string }) => u.id === user.id));
    assert.deepEqual(Object.keys(us.usuarios[0]).sort(), ["id", "nome"], "só id e nome");
    const aut = await prisma.automacao.create({ data: { nome: `Aut ${c.marca}`, gatilho: "ENTREGA_CARTAO_ATRASADO" } });
    try {
      const g = await (await getGatilhos(rq("GET"))).json();
      assert.equal(g.gatilhos.length, 6);
      assert.equal(g.automacoes.find((a: { id: string }) => a.id === aut.id).rotuloGatilho, "Entrega: cartão atrasado");
      formas.gatilhos = [...formato({ gatilhos: g.gatilhos, automacoes: [g.automacoes.find((a: { id: string }) => a.id === aut.id)] })].sort();
    } finally { await prisma.automacao.delete({ where: { id: aut.id } }); }

    // Contrato com o Vendedor IA (só se o repositório tiver vendedoria/ ao lado).
    if (process.env.GERAR_CONTRATO === "1") writeFileSync(ARQUIVO_CONTRATO, JSON.stringify(formas, null, 2) + "\n");
    else if (existsSync(ARQUIVO_CONTRATO)) {
      const referencia = JSON.parse(readFileSync(ARQUIVO_CONTRATO, "utf8")) as Record<string, string[]>;
      assert.deepEqual(Object.keys(formas).sort(), Object.keys(referencia).sort());
      for (const nome of Object.keys(referencia)) assert.deepEqual(formas[nome], referencia[nome], `formato de "${nome}" mudou: regrave com GERAR_CONTRATO=1 e confira o Vendedor IA`);
    }
  } finally {
    await prisma.oportunidade.deleteMany({ where: { nome: { contains: c.marca } } });
    await prisma.entrega.deleteMany({ where: { oportunidade: { funilId: c.funil.id } } });
    await prisma.modeloEntrega.deleteMany({ where: { id: modelo.id } });
    if (anterior) await prisma.modeloEntrega.update({ where: { id: anterior.id }, data: { padrao: true } });
    await prisma.usuario.delete({ where: { id: user.id } });
    await c.limpar();
  }
});
