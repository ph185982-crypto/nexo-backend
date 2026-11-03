import test from "node:test";
import assert from "node:assert/strict";
import { cenario } from "./_cenario";
import { criarOportunidade, moverOportunidade } from "@/lib/funil/mover";
import { prisma } from "@/lib/prisma";
import { listarMotivos, motivoIdPorNome, MOTIVO } from "@/lib/funil/motivos";
import { montarQuadro } from "@/lib/funil/quadro";
import { codigoOportunidade } from "@/lib/funil/encerramento";

test("criar abre a primeira linha do histórico na etapa de entrada", async () => {
  const c = await cenario();
  try {
    const op = await criarOportunidade({ nome: "A", contatoId: c.contato.id, funilId: c.funil.id, ator: "u1" });
    assert.equal(op.etapaId, c.leads.id, "entra na primeira etapa aberta");
    assert.equal(op.status, "EM_ANDAMENTO");
    const h = await c.historico(op.id);
    assert.deepEqual(h.map((x) => [x.paraEtapaNome, x.origem, x.ator, x.saiuEm]), [["Leads", "CRIACAO", "u1", null]]);
    assert.equal(h[0].entrouEm.getTime(), op.etapaDesdeEm.getTime());
    assert.match(codigoOportunidade(op.numero, op.criadoEm), /^\d{8}\/\d{4}$/);
  } finally { await c.limpar(); }
});

test("mover fecha a etapa anterior, abre a nova e reinicia o relógio; mesma etapa não faz nada", async () => {
  const c = await cenario();
  try {
    const op = await criarOportunidade({ nome: "B", contatoId: c.contato.id, funilId: c.funil.id });
    const t1 = new Date(Date.now() + 60_000);
    const r = await moverOportunidade({ oportunidadeId: op.id, etapaId: c.qualif.id, origem: "MANUAL", ator: "u1", motivo: "qualificou", quando: t1 });
    assert.equal(r.mudou, true);
    assert.equal(r.de?.etapaNome, "Leads");
    const h = await c.historico(op.id);
    assert.equal(h.length, 2);
    assert.equal(h[0].saiuEm?.getTime(), t1.getTime());
    assert.deepEqual([h[1].deEtapaNome, h[1].paraEtapaNome, h[1].origem, h[1].motivo, h[1].saiuEm], ["Leads", "Qualificação", "MANUAL", "qualificou", null]);
    const dep = (await c.prisma.oportunidade.findUnique({ where: { id: op.id } }))!;
    assert.equal(dep.etapaId, c.qualif.id);
    assert.equal(dep.etapaDesdeEm.getTime(), t1.getTime());
    assert.equal(dep.ultimaAtividadeEm.getTime(), t1.getTime());
    assert.equal(dep.encerradaEm, null);

    assert.equal((await moverOportunidade({ oportunidadeId: op.id, etapaId: c.qualif.id, origem: "MANUAL" })).mudou, false);
    assert.equal((await c.historico(op.id)).length, 2);
    await assert.rejects(moverOportunidade({ oportunidadeId: op.id, etapaId: "nao-existe", origem: "MANUAL" }), /Etapa não encontrada/);
    await assert.rejects(moverOportunidade({ oportunidadeId: "nao-existe", etapaId: c.qualif.id, origem: "MANUAL" }), /Oportunidade não encontrada/);
  } finally { await c.limpar(); }
});

test("oportunidade sem linha aberta ganha uma linha de reconstrução ao mudar de etapa", async () => {
  const c = await cenario();
  try {
    const op = await criarOportunidade({ nome: "C", contatoId: c.contato.id, funilId: c.funil.id });
    await c.prisma.historicoEtapa.deleteMany({ where: { oportunidadeId: op.id } });
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.qualif.id, origem: "MANUAL" });
    const h = await c.historico(op.id);
    assert.deepEqual(h.map((x) => [x.paraEtapaNome, x.origem, x.saiuEm !== null]), [["Leads", "IMPORTACAO", true], ["Qualificação", "MANUAL", false]]);
    assert.equal(h[0].entrouEm.getTime(), op.etapaDesdeEm.getTime());
  } finally { await c.limpar(); }
});

test("ganho e perda: motivo do catálogo, validação e limpeza ao reabrir", async () => {
  const c = await cenario();
  try {
    const motivos = await listarMotivos();
    assert.ok(motivos.length >= 15);
    assert.equal((await listarMotivos()).length, motivos.length, "catálogo padrão é idempotente");
    const preco = motivos.find((m) => m.tipo === "PERDA" && m.nome === "Preço")!;
    const venda = motivos.find((m) => m.tipo === "GANHO")!;

    const op = await criarOportunidade({ nome: "D", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.perdida.id, origem: "MANUAL", motivoId: preco.id, motivoDetalhe: "  achou caro  " });
    let o = (await c.prisma.oportunidade.findUnique({ where: { id: op.id }, include: { motivo: true } }))!;
    assert.deepEqual([o.status, o.motivo?.nome, o.motivoDetalhe], ["PERDIDA", "Preço", "achou caro"]);
    assert.ok(o.encerradaEm);

    // perdida → ganha: o motivo de perda não vale mais
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.ganha.id, origem: "MANUAL" });
    o = (await c.prisma.oportunidade.findUnique({ where: { id: op.id }, include: { motivo: true } }))!;
    assert.deepEqual([o.status, o.motivoId, o.motivoDetalhe], ["GANHA", null, null]);

    // motivo de perda numa etapa de ganho: ignorado
    const b = await criarOportunidade({ nome: "E", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: b.id, etapaId: c.ganha.id, origem: "MANUAL", motivoId: preco.id });
    assert.equal((await c.prisma.oportunidade.findUnique({ where: { id: b.id } }))!.motivoId, null);

    // motivo desativado: ignorado
    await c.prisma.motivoEncerramento.update({ where: { id: venda.id }, data: { ativo: false } });
    const d = await criarOportunidade({ nome: "F", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: d.id, etapaId: c.ganha.id, origem: "MANUAL", motivoId: venda.id });
    assert.equal((await c.prisma.oportunidade.findUnique({ where: { id: d.id } }))!.motivoId, null);
    assert.equal(await motivoIdPorNome("GANHO", venda.nome), null);
    await c.prisma.motivoEncerramento.update({ where: { id: venda.id }, data: { ativo: true } });

    // reabrir limpa o encerramento
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.qualif.id, origem: "MANUAL" });
    o = (await c.prisma.oportunidade.findUnique({ where: { id: op.id }, include: { motivo: true } }))!;
    assert.deepEqual([o.status, o.encerradaEm, o.motivoId], ["EM_ANDAMENTO", null, null]);
    assert.ok(await motivoIdPorNome("PERDA", MOTIVO.FORA_ICP));
  } finally { await c.limpar(); }
});

test("mover entre funis troca o funil e registra os dois nomes no histórico", async () => {
  const c = await cenario();
  const c2 = await cenario();
  try {
    const op = await criarOportunidade({ nome: "G", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c2.qualif.id, origem: "AUTOMACAO", ator: "automacao" });
    const dep = (await c.prisma.oportunidade.findUnique({ where: { id: op.id } }))!;
    assert.equal(dep.funilId, c2.funil.id);
    const h = await c.historico(op.id);
    assert.deepEqual([h[1].deFunilNome, h[1].paraFunilNome], [c.funil.nome, c2.funil.nome]);
    await c.prisma.oportunidade.update({ where: { id: op.id }, data: { funilId: c.funil.id, etapaId: c.leads.id } }); // devolve p/ limpeza
  } finally { await c.limpar(); await c2.limpar(); }
});

test("quadro: etapas abertas com totais e finalizadas só do mês", async () => {
  const c = await cenario();
  try {
    const a = await criarOportunidade({ nome: "Q1", contatoId: c.contato.id, funilId: c.funil.id, valorUnico: 1000, valorMensal: 200 });
    const b = await criarOportunidade({ nome: "Q2", contatoId: c.contato.id, funilId: c.funil.id, valorUnico: 500 });
    await moverOportunidade({ oportunidadeId: b.id, etapaId: c.qualif.id, origem: "MANUAL" });
    const g = await criarOportunidade({ nome: "Q3", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: g.id, etapaId: c.ganha.id, origem: "MANUAL" });
    const velha = await criarOportunidade({ nome: "Q4", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: velha.id, etapaId: c.perdida.id, origem: "MANUAL", quando: new Date("2024-01-15T12:00:00Z") });

    const q = (await montarQuadro(c.funil.id))!;
    assert.deepEqual(q.etapas.map((e) => [e.nome, e.quantidade, e.total]), [["Leads", 1, 1200], ["Qualificação", 1, 500], ["Proposta e negociação", 0, 0]]);
    assert.equal(q.etapas[0].oportunidades[0].id, a.id);
    assert.deepEqual(q.finalizadas.etapas.map((e) => [e.nome, e.quantidade]), [["Ganha", 1], ["Perdida", 0]], "a perdida de 2024 fica fora do mês");
    assert.equal(await montarQuadro("nao-existe"), null);
  } finally { await c.limpar(); }
});

test("quadro: 'Finalizadas do mês' é o mês de Brasília (mesmo critério dos relatórios)", async () => {
  const c = await cenario();
  try {
    const op = await criarOportunidade({ nome: "Novembro", contatoId: c.contato.id, funilId: c.funil.id });
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.ganha.id, origem: "MANUAL", quando: new Date("2026-11-15T15:00:00Z") });
    // 01/12 01:00 UTC = 30/11 22:00 em Brasília: ainda é novembro. Em UTC já seria dezembro e a ganha de novembro sumiria.
    const q = (await montarQuadro(c.funil.id, new Date("2026-12-01T01:00:00Z")))!;
    assert.equal(q.finalizadas.mes, "2026-11");
    assert.equal(q.finalizadas.etapas.find((e) => e.tipo === "GANHA")!.quantidade, 1);
    const dez = (await montarQuadro(c.funil.id, new Date("2026-12-01T04:00:00Z")))!; // 01:00 em Brasília: dezembro
    assert.equal(dez.finalizadas.mes, "2026-12");
    assert.equal(dez.finalizadas.etapas.find((e) => e.tipo === "GANHA")!.quantidade, 0);
  } finally { await prisma.entrega.deleteMany({ where: { oportunidade: { funilId: c.funil.id } } }); await c.limpar(); }
});

test("catálogo padrão de motivos é gravado uma vez por processo, não a cada leitura", async () => {
  await listarMotivos(); // garante o estado "já gravado" neste processo
  const alvo = await prisma.motivoEncerramento.findUnique({ where: { tipo_nome: { tipo: "PERDA", nome: "Contato inválido ou spam" } } });
  assert.ok(alvo);
  await prisma.motivoEncerramento.delete({ where: { id: alvo.id } });
  try {
    await listarMotivos(); await listarMotivos("PERDA"); await motivoIdPorNome("PERDA", MOTIVO.FORA_ICP);
    assert.equal(await prisma.motivoEncerramento.count({ where: { tipo: "PERDA", nome: "Contato inválido ou spam" } }), 0, "as leituras seguintes não regravam o catálogo");
  } finally { await prisma.motivoEncerramento.create({ data: { tipo: alvo.tipo, nome: alvo.nome, ordem: alvo.ordem } }); }
});
