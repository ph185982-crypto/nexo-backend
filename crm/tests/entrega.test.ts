import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { cenario } from "./_cenario";
import { prisma } from "@/lib/prisma";
import { criarOportunidade, moverOportunidade } from "@/lib/funil/mover";
import { calcularSaudeEntrega } from "@/lib/entrega/saude";
import { definirModeloPadrao, garantirModeloPadrao } from "@/lib/entrega/modelo";
import { criarCartao, criarUpsell, detalheEntrega, listarEntregas, moverCartao } from "@/lib/entrega/servico";
import { montarQuadro } from "@/lib/funil/quadro";
import { assinarSessao, COOKIE_SESSAO } from "@/lib/auth/sessao";
import { GET as getLista } from "@/app/api/entregas/route";
import { GET as getEntrega, PATCH as patchEntrega } from "@/app/api/entregas/[id]/route";
import { POST as postCartao } from "@/app/api/entregas/[id]/cartoes/route";
import { PATCH as patchCartao, DELETE as delCartao } from "@/app/api/entregas/[id]/cartoes/[cartaoId]/route";
import { POST as postUpsell } from "@/app/api/entregas/[id]/upsell/route";

process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-16";
const DIA = 86_400_000;

/** Modelo de teste como padrão; devolve o que restaurar depois. */
async function modeloDeTeste(marca: string) {
  const anterior = await prisma.modeloEntrega.findFirst({ where: { padrao: true } });
  const m = await prisma.modeloEntrega.create({
    data: { nome: `Modelo ${marca}`, itens: { create: [
      { titulo: "Kickoff", pilar: "COMERCIAL", prazoDias: 3, ordem: 0, checklist: [{ texto: "a", feito: true }] },
      { titulo: "Enviar acessos", pilar: "OPERACAO", prazoDias: 5, cliente: true, ordem: 1 },
      { titulo: "Sem prazo", pilar: "PRODUTO", ordem: 2 },
    ] } },
  });
  await definirModeloPadrao(m.id);
  return { m, restaurar: async () => { await prisma.modeloEntrega.deleteMany({ where: { id: m.id } }); if (anterior) await prisma.modeloEntrega.update({ where: { id: anterior.id }, data: { padrao: true } }); } };
}
async function limparEntregas(funilId: string) { await prisma.entrega.deleteMany({ where: { oportunidade: { funilId } } }); }

test("saúde da entrega: atrasos e espera do cliente pesam; progresso; renovação", () => {
  const agora = new Date("2026-11-03T12:00:00Z");
  const c = (coluna: string, alvoDias: number | null, desdeDias = 0) => ({ coluna, dataAlvo: alvoDias === null ? null : new Date(agora.getTime() + alvoDias * DIA), colunaDesdeEm: new Date(agora.getTime() - desdeDias * DIA) });
  assert.deepEqual(calcularSaudeEntrega([], null, agora), { nota: 100, rotulo: "SAUDAVEL", progresso: 0, total: 0, concluidos: 0, atrasados: 0, esperandoCliente: 0, diasParaRenovar: null, renovacaoProxima: false, porColuna: { BACKLOG: 0, ESSA_SEMANA: 0, EM_ANDAMENTO: 0, AGUARDANDO_CLIENTE: 0, CONCLUIDO: 0 } });
  const s = calcularSaudeEntrega([c("EM_ANDAMENTO", -2), c("BACKLOG", -1), c("CONCLUIDO", -30), c("AGUARDANDO_CLIENTE", 5, 9), c("AGUARDANDO_CLIENTE", 5, 3), c("BACKLOG", 10)], new Date(agora.getTime() + 45 * DIA), agora);
  assert.deepEqual([s.nota, s.rotulo, s.atrasados, s.esperandoCliente, s.progresso, s.concluidos], [100 - 24 - 6, "ATENCAO", 2, 1, 17, 1], "concluído atrasado não conta");
  assert.deepEqual([s.diasParaRenovar, s.renovacaoProxima], [45, true]);
  assert.equal(calcularSaudeEntrega([c("BACKLOG", -1), c("BACKLOG", -1), c("BACKLOG", -1), c("BACKLOG", -1), c("BACKLOG", -1)], null, agora).rotulo, "EM_RISCO");
  assert.equal(calcularSaudeEntrega(Array(12).fill(c("BACKLOG", -1)), null, agora).nota, 0, "piso em 0");
  assert.equal(calcularSaudeEntrega([c("CONCLUIDO", null)], new Date(agora.getTime() + 61 * DIA), agora).renovacaoProxima, false);
});

test("modelo padrão: criado uma vez; só um padrão por vez", async () => {
  const antes = await prisma.modeloEntrega.findFirst({ where: { padrao: true } });
  const a = await garantirModeloPadrao();
  assert.equal((await garantirModeloPadrao()).id, a.id, "idempotente");
  const marca = `m${Date.now()}`;
  const outro = await prisma.modeloEntrega.create({ data: { nome: marca } });
  try {
    await definirModeloPadrao(outro.id);
    assert.deepEqual((await prisma.modeloEntrega.findMany({ where: { padrao: true } })).map((m) => m.id), [outro.id]);
  } finally {
    await prisma.modeloEntrega.delete({ where: { id: outro.id } });
    if (antes) await definirModeloPadrao(antes.id);
  }
});

test("ganhar abre a entrega com os cartões do modelo; reabrir e ganhar de novo não duplica", async () => {
  const c = await cenario();
  const { restaurar } = await modeloDeTeste(c.marca);
  try {
    const op = await criarOportunidade({ nome: "Cliente X", contatoId: c.contato.id, funilId: c.funil.id, valorUnico: 5000, valorMensal: 2500 });
    assert.equal(await prisma.entrega.count({ where: { oportunidadeId: op.id } }), 0, "aberta não tem entrega");
    const t0 = new Date("2026-03-10T15:00:00Z");
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.ganha.id, origem: "MANUAL", quando: t0 });
    const e = (await prisma.entrega.findUnique({ where: { oportunidadeId: op.id }, include: { cartoes: { orderBy: { ordem: "asc" } } } }))!;
    assert.deepEqual([e.nome, e.contatoId, e.status, e.valorMensal.toString(), e.inicioEm.getTime()], ["Cliente X", c.contato.id, "EM_ANDAMENTO", "2500", t0.getTime()]);
    assert.equal(e.renovacaoEm!.toISOString().slice(0, 10), "2027-03-10", "renovação em 12 meses (há valor mensal)");
    assert.deepEqual(e.cartoes.map((k) => [k.titulo, k.pilar, k.coluna, k.cliente]), [["Kickoff", "COMERCIAL", "BACKLOG", false], ["Enviar acessos", "OPERACAO", "BACKLOG", true], ["Sem prazo", "PRODUTO", "BACKLOG", false]]);
    assert.deepEqual(e.cartoes.map((k) => k.dataAlvo && Math.round((k.dataAlvo.getTime() - t0.getTime()) / DIA)), [3, 5, null]);
    assert.deepEqual(e.cartoes[0].checklist, [{ texto: "a", feito: true }]);

    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.qualif.id, origem: "MANUAL" }); // reabre
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.ganha.id, origem: "MANUAL" }); // ganha de novo
    assert.equal(await prisma.entrega.count({ where: { oportunidadeId: op.id } }), 1);
    assert.equal(await prisma.entregaCartao.count({ where: { entregaId: e.id } }), 3, "cartões não duplicam");

    // sem valor mensal: sem renovação; criada já ganha também abre entrega
    const so = await criarOportunidade({ nome: "Só pontual", contatoId: c.contato.id, funilId: c.funil.id, valorUnico: 1000 });
    await moverOportunidade({ oportunidadeId: so.id, etapaId: c.ganha.id, origem: "MANUAL" });
    assert.equal((await prisma.entrega.findUnique({ where: { oportunidadeId: so.id } }))!.renovacaoEm, null);
    const direta = await criarOportunidade({ nome: "Já ganha", contatoId: c.contato.id, etapaId: c.ganha.id });
    assert.equal(await prisma.entrega.count({ where: { oportunidadeId: direta.id } }), 1);

    // perdida não abre entrega; quadro aponta a entrega da ganha
    const per = await criarOportunidade({ nome: "Perdida", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: per.id, etapaId: c.perdida.id, origem: "MANUAL" });
    assert.equal(await prisma.entrega.count({ where: { oportunidadeId: per.id } }), 0);
    const q = (await montarQuadro(c.funil.id))!;
    const ganhas = q.finalizadas.etapas.find((x) => x.tipo === "GANHA")!.oportunidades;
    assert.equal(ganhas.find((g) => g.id === op.id)!.entregaId, e.id);
    assert.equal(q.finalizadas.etapas.find((x) => x.tipo === "PERDIDA")!.oportunidades[0].entregaId, null);
  } finally { await limparEntregas(c.funil.id); await restaurar(); await c.limpar(); }
});

test("sem modelo padrão a entrega nasce vazia (e ganhar não quebra)", async () => {
  const c = await cenario();
  const anterior = await prisma.modeloEntrega.findMany({ where: { padrao: true } });
  try {
    await prisma.modeloEntrega.updateMany({ where: { padrao: true }, data: { padrao: false } });
    const op = await criarOportunidade({ nome: "Sem modelo", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.ganha.id, origem: "MANUAL" });
    assert.equal(await prisma.entregaCartao.count({ where: { entrega: { oportunidadeId: op.id } } }), 0);
  } finally { await limparEntregas(c.funil.id); for (const m of anterior) await prisma.modeloEntrega.update({ where: { id: m.id }, data: { padrao: true } }); await c.limpar(); }
});

test("cartões: criar no fim, mover entre colunas com posição, relógio e conclusão", async () => {
  const c = await cenario();
  const { restaurar } = await modeloDeTeste(c.marca);
  try {
    const op = await criarOportunidade({ nome: "Cartões", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.ganha.id, origem: "MANUAL" });
    const e = (await prisma.entrega.findUnique({ where: { oportunidadeId: op.id } }))!;
    await prisma.entregaCartao.deleteMany({ where: { entregaId: e.id } });
    const [a, b, d] = [await criarCartao({ entregaId: e.id, titulo: "A" }), await criarCartao({ entregaId: e.id, titulo: "B" }), await criarCartao({ entregaId: e.id, titulo: "D" })];
    assert.deepEqual([a.ordem, b.ordem, d.ordem], [0, 1, 2]);
    const ordem = async (coluna: string) => (await prisma.entregaCartao.findMany({ where: { entregaId: e.id, coluna }, orderBy: { ordem: "asc" } })).map((k) => [k.titulo, k.ordem]);

    await moverCartao(b.id, "EM_ANDAMENTO");
    assert.deepEqual(await ordem("BACKLOG"), [["A", 0], ["D", 1]], "coluna de origem renumerada");
    await moverCartao(d.id, "EM_ANDAMENTO", 0);
    assert.deepEqual(await ordem("EM_ANDAMENTO"), [["D", 0], ["B", 1]], "posição 0 entra na frente");
    await moverCartao(a.id, "EM_ANDAMENTO", 99);
    assert.deepEqual(await ordem("EM_ANDAMENTO"), [["D", 0], ["B", 1], ["A", 2]], "posição além do fim vai pro fim");
    await moverCartao(a.id, "EM_ANDAMENTO", 0);
    assert.deepEqual(await ordem("EM_ANDAMENTO"), [["A", 0], ["D", 1], ["B", 2]], "reordenar dentro da coluna");

    const antes = (await prisma.entregaCartao.findUnique({ where: { id: a.id } }))!.colunaDesdeEm;
    await new Promise((r) => setTimeout(r, 15));
    await moverCartao(a.id, "EM_ANDAMENTO", 1);
    assert.equal((await prisma.entregaCartao.findUnique({ where: { id: a.id } }))!.colunaDesdeEm.getTime(), antes.getTime(), "mesma coluna não reinicia o relógio");
    await moverCartao(a.id, "CONCLUIDO");
    const feito = (await prisma.entregaCartao.findUnique({ where: { id: a.id } }))!;
    assert.ok(feito.concluidoEm && feito.colunaDesdeEm > antes);
    await moverCartao(a.id, "BACKLOG");
    assert.equal((await prisma.entregaCartao.findUnique({ where: { id: a.id } }))!.concluidoEm, null, "reabrir limpa a conclusão");
    await assert.rejects(moverCartao(a.id, "OUTRA" as never), /Coluna inválida/);
    await assert.rejects(moverCartao("nao-existe", "BACKLOG"), /Cartão não encontrado/);

    const det = (await detalheEntrega(e.id))!;
    assert.equal(det.saude.total, 3);
    assert.equal(await detalheEntrega("nao-existe"), null);
    assert.equal((await listarEntregas()).find((x) => x.id === e.id)!.saude.total, 3);
  } finally { await limparEntregas(c.funil.id); await restaurar(); await c.limpar(); }
});

test("upsell abre oportunidade no funil padrão para o mesmo cliente", async () => {
  const c = await cenario(true);
  const { restaurar } = await modeloDeTeste(c.marca);
  const u = await prisma.usuario.create({ data: { nome: "Up", email: `up${c.marca}@t.local`, senhaHash: "x" } });
  try {
    const op = await criarOportunidade({ nome: "Base", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.ganha.id, origem: "MANUAL" });
    const e = (await prisma.entrega.findUnique({ where: { oportunidadeId: op.id } }))!;
    const novo = await criarUpsell(e.id, u.id);
    assert.deepEqual([novo.nome, novo.contatoId, novo.origem, novo.tags, novo.status, novo.funilId], ["Upsell — Base", c.contato.id, "Upsell", ["upsell"], "EM_ANDAMENTO", c.funil.id]);
    assert.equal(novo.responsavelId, u.id);
    await assert.rejects(criarUpsell("nao-existe", u.id), /Entrega não encontrada/);
  } finally { await limparEntregas(c.funil.id); await prisma.oportunidade.deleteMany({ where: { responsavelId: u.id } }); await prisma.usuario.delete({ where: { id: u.id } }); await restaurar(); await c.limpar(); }
});

test("rotas da entrega: sessão, validação, diagnóstico por pilar, cartões e escopo", async () => {
  const c = await cenario(true);
  const { restaurar } = await modeloDeTeste(c.marca);
  const u = await prisma.usuario.create({ data: { nome: "Ent", email: `e${c.marca}@t.local`, senhaHash: await bcrypt.hash("x", 4) } });
  const cookie = `${COOKIE_SESSAO}=${await assinarSessao(u.id, process.env.SESSION_SECRET!)}`;
  const req = (url: string, metodo = "GET", corpo?: unknown, logado = true) => new Request(`http://x${url}`, { method: metodo, headers: { "content-type": "application/json", ...(logado ? { cookie } : {}) }, ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}) });
  const p = (id: string, cartaoId?: string) => ({ params: Promise.resolve({ id, cartaoId: cartaoId ?? "" }) });
  try {
    const op1 = await criarOportunidade({ nome: "E1", contatoId: c.contato.id, funilId: c.funil.id });
    const op2 = await criarOportunidade({ nome: "E2", contatoId: c.contato.id, funilId: c.funil.id });
    for (const o of [op1, op2]) await moverOportunidade({ oportunidadeId: o.id, etapaId: c.ganha.id, origem: "MANUAL" });
    const e1 = (await prisma.entrega.findUnique({ where: { oportunidadeId: op1.id }, include: { cartoes: true } }))!;
    const e2 = (await prisma.entrega.findUnique({ where: { oportunidadeId: op2.id }, include: { cartoes: true } }))!;

    assert.equal((await getLista(req("/api/entregas", "GET", undefined, false))).status, 401);
    assert.equal((await getLista(req("/api/entregas?status=XPTO"))).status, 400);
    const lista = await (await getLista(req("/api/entregas?status=EM_ANDAMENTO"))).json();
    assert.ok(lista.entregas.some((x: { id: string }) => x.id === e1.id));
    assert.equal((await getEntrega(req(`/api/entregas/${e1.id}`), p(e1.id))).status, 200);
    assert.equal((await getEntrega(req("/api/entregas/x"), p("x"))).status, 404);

    // PATCH da entrega
    assert.equal((await patchEntrega(req(`/api/entregas/${e1.id}`, "PATCH", { status: "ARQUIVADA" }), p(e1.id))).status, 400);
    assert.equal((await patchEntrega(req(`/api/entregas/${e1.id}`, "PATCH", { renovacaoEm: "semana que vem" }), p(e1.id))).status, 400);
    assert.equal((await patchEntrega(req(`/api/entregas/${e1.id}`, "PATCH", { diagnostico: { COMERCIAL: "x".repeat(5001) } }), p(e1.id))).status, 400);
    assert.equal((await patchEntrega(req("/api/entregas/x", "PATCH", { status: "PAUSADA" }), p("x"))).status, 404);
    assert.equal((await patchEntrega(req(`/api/entregas/${e1.id}`, "PATCH", { status: "PAUSADA", renovacaoEm: "2027-06-01T00:00:00Z", diagnostico: { COMERCIAL: "Funil sem dono", INVENTADO: "ignorado" } }), p(e1.id))).status, 200);
    await patchEntrega(req(`/api/entregas/${e1.id}`, "PATCH", { diagnostico: { FINANCEIRO: "Margem de 8%" } }), p(e1.id));
    const e1b = (await prisma.entrega.findUnique({ where: { id: e1.id } }))!;
    assert.deepEqual([e1b.status, e1b.renovacaoEm!.toISOString().slice(0, 10), e1b.diagnostico], ["PAUSADA", "2027-06-01", { COMERCIAL: "Funil sem dono", FINANCEIRO: "Margem de 8%" }], "diagnóstico mescla por pilar; pilar desconhecido é descartado");

    // cartões
    assert.equal((await postCartao(req(`/api/entregas/${e1.id}/cartoes`, "POST", { titulo: "" }), p(e1.id))).status, 400);
    assert.equal((await postCartao(req(`/api/entregas/${e1.id}/cartoes`, "POST", { titulo: "x", pilar: "RH" }), p(e1.id))).status, 400);
    assert.equal((await postCartao(req("/api/entregas/x/cartoes", "POST", { titulo: "x" }), p("x"))).status, 404);
    const novo = await postCartao(req(`/api/entregas/${e1.id}/cartoes`, "POST", { titulo: "Treinar time", pilar: "OPERACAO", coluna: "ESSA_SEMANA", checklist: [{ texto: "Agendar", feito: false }] }), p(e1.id));
    assert.equal(novo.status, 201);
    const { id: cartaoId } = await novo.json();
    assert.equal((await patchCartao(req("/x", "PATCH", { coluna: "VOANDO" }), p(e1.id, cartaoId))).status, 400);
    assert.equal((await patchCartao(req("/x", "PATCH", { coluna: "EM_ANDAMENTO", posicao: -1 }), p(e1.id, cartaoId))).status, 400);
    assert.equal((await patchCartao(req("/x", "PATCH", { coluna: "CONCLUIDO", titulo: "Treino feito" }), p(e1.id, cartaoId))).status, 200);
    const k = (await prisma.entregaCartao.findUnique({ where: { id: cartaoId } }))!;
    assert.deepEqual([k.coluna, k.titulo, k.concluidoEm !== null], ["CONCLUIDO", "Treino feito", true]);
    // cartão de outra entrega não é alcançável pela URL desta
    const alheio = e2.cartoes[0].id;
    assert.equal((await patchCartao(req("/x", "PATCH", { titulo: "invadido" }), p(e1.id, alheio))).status, 404);
    assert.equal((await delCartao(req("/x", "DELETE"), p(e1.id, alheio))).status, 404);
    assert.equal((await prisma.entregaCartao.findUnique({ where: { id: alheio } }))!.titulo !== "invadido", true);
    assert.equal((await delCartao(req("/x", "DELETE"), p(e1.id, cartaoId))).status, 200);

    // upsell
    assert.equal((await postUpsell(req("/x", "POST", undefined, false), p(e1.id))).status, 401);
    assert.equal((await postUpsell(req("/x", "POST"), p("x"))).status, 404);
    const up = await postUpsell(req("/x", "POST"), p(e1.id));
    assert.equal(up.status, 201);
    assert.equal((await prisma.oportunidade.findUnique({ where: { id: (await up.json()).oportunidadeId } }))!.responsavelId, u.id);
  } finally {
    await limparEntregas(c.funil.id); await prisma.usuario.delete({ where: { id: u.id } }).catch(() => {}); await restaurar(); await c.limpar();
  }
});
