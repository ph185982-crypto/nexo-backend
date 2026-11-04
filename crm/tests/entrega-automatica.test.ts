// Funil de entrega automático: gatilhos de entrega no motor de automações, conclusão/reabertura e rotina diária.
import test from "node:test";
import assert from "node:assert/strict";
import { cenario } from "./_cenario";
import { prisma } from "@/lib/prisma";
import { criarOportunidade, moverOportunidade } from "@/lib/funil/mover";
import { definirModeloPadrao } from "@/lib/entrega/modelo";
import { criarCartao, moverCartao } from "@/lib/entrega/servico";
import { rodarRotinaDeEntregas } from "@/lib/entrega/rotina";
import { validarAutomacao, camposDoGatilho } from "@/lib/automacao/modelo";
import { preencherTexto } from "@/lib/automacao/acoes";
import { processarVencidas, varrerTempo } from "@/lib/automacao/motor";
import { formParaApi, modelos } from "@/components/form-automacao";

const H = 3_600_000, DIA = 24 * H;

async function preparar(marca: string, opts: { padrao?: boolean } = {}) {
  const c = await cenario(opts.padrao ?? false);
  const anterior = await prisma.modeloEntrega.findFirst({ where: { padrao: true } });
  const modelo = await prisma.modeloEntrega.create({
    data: { nome: `Modelo ${c.marca}`, itens: { create: [
      { titulo: "Kickoff", pilar: "COMERCIAL", prazoDias: 3, ordem: 0 },
      { titulo: "Enviar acessos", pilar: "OPERACAO", prazoDias: 5, cliente: true, ordem: 1 },
      { titulo: "Mapear processos", pilar: "OPERACAO", prazoDias: 21, ordem: 2 },
    ] } },
  });
  await definirModeloPadrao(modelo.id);
  const dono = await prisma.usuario.create({ data: { nome: `Dono ${marca}`, email: `dono-${c.marca}@teste.local`, senhaHash: "x", papel: "VENDEDOR" } });
  const automacoes: string[] = [];
  const mk = async (gatilho: string, criterios: unknown[], acoes: unknown[]) => {
    // Critério de funil isola a automação deste teste de qualquer outro dado do banco.
    const a = await prisma.automacao.create({ data: { nome: `t:${c.marca}`, gatilho, criterios: [{ campo: "funilId", operador: "=", valor: c.funil.id }, ...criterios], acoes } as never });
    automacoes.push(a.id);
    return a;
  };
  /** Oportunidade ganha agora: abre a entrega com os 3 cartões do modelo. */
  const ganhar = async (nome: string, valorMensal = 0) => {
    const op = await criarOportunidade({ nome, contatoId: c.contato.id, funilId: c.funil.id, responsavelId: dono.id, valorMensal });
    await moverOportunidade({ oportunidadeId: op.id, etapaId: c.ganha.id, origem: "MANUAL" });
    const e = (await prisma.entrega.findUnique({ where: { oportunidadeId: op.id }, include: { cartoes: { orderBy: { ordem: "asc" } } } }))!;
    return { op, e, cartao: (titulo: string) => e.cartoes.find((k) => k.titulo === titulo)! };
  };
  const limpar = async () => {
    await prisma.automacao.deleteMany({ where: { id: { in: automacoes } } });
    await prisma.entrega.deleteMany({ where: { contatoId: c.contato.id } });
    await prisma.tarefa.deleteMany({ where: { responsavelId: dono.id } });
    await c.limpar();
    await prisma.usuario.delete({ where: { id: dono.id } });
    await prisma.modeloEntrega.delete({ where: { id: modelo.id } });
    if (anterior) await definirModeloPadrao(anterior.id);
  };
  return { c, dono, mk, ganhar, limpar };
}

test("validação: gatilhos de entrega exigem o critério de dias; campos de cartão só valem nos gatilhos de cartão", () => {
  const acoes = [{ tipo: "REGISTRAR_ALERTA", mensagem: "x" }];
  assert.throws(() => validarAutomacao({ nome: "a", gatilho: "ENTREGA_AGUARDANDO_CLIENTE", acoes }), /Dias aguardando o cliente/);
  assert.throws(() => validarAutomacao({ nome: "a", gatilho: "ENTREGA_RENOVACAO_PROXIMA", acoes, criterios: [{ campo: "diasParaRenovar", operador: ">=", valor: 30 }] }), /≤/);
  assert.equal(validarAutomacao({ nome: "a", gatilho: "ENTREGA_RENOVACAO_PROXIMA", acoes, criterios: [{ campo: "diasParaRenovar", operador: "<=", valor: 30 }] }).gatilho, "ENTREGA_RENOVACAO_PROXIMA");
  assert.throws(() => validarAutomacao({ nome: "a", gatilho: "OPORTUNIDADE_CRIADA", acoes, criterios: [{ campo: "notaSaude", operador: "<=", valor: 50 }] }), /não vale para o gatilho/);
  assert.throws(() => validarAutomacao({ nome: "a", gatilho: "ENTREGA_EM_RISCO", acoes, criterios: [{ campo: "diasDeAtraso", operador: ">=", valor: 2 }] }), /não vale para o gatilho/, "risco é da entrega, não de um cartão");
  assert.throws(() => validarAutomacao({ nome: "a", gatilho: "ENTREGA_CARTAO_ATRASADO", acoes, criterios: [{ campo: "pilar", operador: "=", valor: "JURIDICO" }] }), /pilar/);
  const ok = validarAutomacao({ nome: "a", gatilho: "ENTREGA_CARTAO_ATRASADO", acoes, criterios: [{ campo: "pilar", operador: "=", valor: "OPERACAO" }, { campo: "cartaoDoCliente", operador: "=", valor: "true" }, { campo: "diasDeAtraso", operador: ">=", valor: "2" }] });
  assert.deepEqual(ok.criterios.map((x) => x.valor), ["OPERACAO", true, 2]);
  assert.ok(camposDoGatilho("ENTREGA_CARTAO_CONCLUIDO").includes("pilar"));
  assert.ok(!camposDoGatilho("ENTREGA_CONCLUIDA").includes("pilar"));
  // Todo modelo pronto da tela passa na validação do servidor.
  for (const m of modelos([])) assert.doesNotThrow(() => validarAutomacao(formParaApi(m.form)), m.rotulo);
});

test("textos das ações: marcas trocadas; marca sem valor no gatilho fica como está", () => {
  const op = { nome: "Oficina — implantação", contato: { id: "c", nome: "Oficina Rocha" } };
  assert.equal(preencherTexto("Cobrar {cliente}: {cartao} há {dias} dias ({entrega})", op, { cartao: { id: "k", titulo: "Enviar acessos", responsavelId: null }, dias: 4, entrega: { id: "e", nome: "Impl." } }), "Cobrar Oficina Rocha: Enviar acessos há 4 dias (Impl.)");
  assert.equal(preencherTexto("{oportunidade} / {cartao}", op), "Oficina — implantação / {cartao}");
});

test("gatilhos de tempo da entrega: aguardando o cliente, atrasado, em risco e renovação — uma vez por fato, tarefa para o dono do cartão", async () => {
  const p = await preparar("tempo");
  try {
    const cobrar = await p.mk("ENTREGA_AGUARDANDO_CLIENTE", [{ campo: "diasAguardandoCliente", operador: ">=", valor: 3 }], [{ tipo: "CRIAR_TAREFA", titulo: "Cobrar {cliente}: {cartao} ({dias} dias)", prazoHoras: 24, prioridade: "ALTA", tipoTarefa: "WHATSAPP", esperaHoras: 0 }]);
    const atraso = await p.mk("ENTREGA_CARTAO_ATRASADO", [], [{ tipo: "REGISTRAR_ALERTA", mensagem: "Atrasado: {cartao} ({dias})", esperaHoras: 0 }]);
    const risco = await p.mk("ENTREGA_EM_RISCO", [], [{ tipo: "ADICIONAR_TAG", tag: "em-risco", esperaHoras: 0 }]);
    const renova = await p.mk("ENTREGA_RENOVACAO_PROXIMA", [{ campo: "diasParaRenovar", operador: "<=", valor: 30 }], [{ tipo: "REGISTRAR_ALERTA", mensagem: "Renova em {dias} dias", esperaHoras: 0 }]);
    const { op, e, cartao } = await p.ganhar("Entrega tempo", 3000);
    const agora = new Date();

    // Enviar acessos parado no cliente há 4 dias; Kickoff vencido há 2 dias.
    await moverCartao(cartao("Enviar acessos").id, "AGUARDANDO_CLIENTE", undefined, new Date(agora.getTime() - 4 * DIA));
    await prisma.entregaCartao.update({ where: { id: cartao("Kickoff").id }, data: { dataAlvo: new Date(agora.getTime() - 2 * DIA - H) } });

    const v = await varrerTempo(agora);
    assert.ok(v.entregasAvaliadas >= 1);
    await processarVencidas(agora);
    const tarefas = await prisma.tarefa.findMany({ where: { oportunidadeId: op.id, origem: "AUTOMACAO" } });
    assert.deepEqual(tarefas.map((t) => [t.titulo, t.responsavelId]), [[`Cobrar Empresa ${p.c.marca}: Enviar acessos (4 dias)`, p.dono.id]], "tarefa com texto preenchido, para quem cuida do cartão");
    const alertas = (await prisma.feedback.findMany({ where: { oportunidadeId: op.id, autor: "automacao" } })).map((f) => f.texto);
    assert.ok(alertas.includes("Atrasado: Kickoff (2)"), alertas.join(" | "));
    assert.equal(alertas.filter((t) => t.startsWith("Renova")).length, 0, "renovação ainda longe (12 meses)");
    assert.ok(!(await prisma.oportunidade.findUnique({ where: { id: op.id } }))!.tags.includes("em-risco"), "1 atraso (a espera de 4 dias ainda não pesa): nota 88, saudável");

    // Varrer de novo no mesmo estado: nada novo.
    await varrerTempo(agora); await processarVencidas(agora);
    assert.equal(await prisma.tarefa.count({ where: { oportunidadeId: op.id, origem: "AUTOMACAO" } }), 1);
    assert.equal(await prisma.feedback.count({ where: { oportunidadeId: op.id, texto: { startsWith: "Atrasado" } } }), 1);

    // Mudar o prazo e atrasar de novo é outro fato.
    await prisma.entregaCartao.update({ where: { id: cartao("Kickoff").id }, data: { dataAlvo: new Date(agora.getTime() - DIA - H) } });
    await varrerTempo(agora); await processarVencidas(agora);
    assert.equal(await prisma.feedback.count({ where: { oportunidadeId: op.id, texto: { startsWith: "Atrasado" } } }), 2);

    // Cinco cartões atrasados: nota 100 - 5×12 = 40, em risco. Avisa uma vez na semana.
    for (const n of [1, 2, 3, 4]) await criarCartao({ entregaId: e.id, titulo: `Extra ${n}`, dataAlvo: new Date(agora.getTime() - n * DIA) });
    await varrerTempo(agora); await processarVencidas(agora);
    assert.ok((await prisma.oportunidade.findUnique({ where: { id: op.id } }))!.tags.includes("em-risco"));
    const linhasRisco = () => prisma.automacaoExecucao.count({ where: { automacaoId: risco.id } });
    assert.equal(await linhasRisco(), 1);
    await varrerTempo(new Date(agora.getTime() + 2 * DIA)); // mesma semana… ou a seguinte, se hoje for sábado/domingo
    const semanaQueVem = new Date(agora.getTime() + 8 * DIA);
    await varrerTempo(semanaQueVem);
    assert.ok((await linhasRisco()) >= 2 && (await linhasRisco()) <= 3, "no máximo uma vez por semana");

    // Renovação a 20 dias: avisa uma vez, com os dias no texto.
    await prisma.entrega.update({ where: { id: e.id }, data: { renovacaoEm: new Date(agora.getTime() + 20 * DIA + H) } });
    await varrerTempo(agora); await varrerTempo(agora); await processarVencidas(agora);
    assert.deepEqual((await prisma.feedback.findMany({ where: { oportunidadeId: op.id, texto: { startsWith: "Renova" } } })).map((f) => f.texto), ["Renova em 21 dias"]);

    // Entrega pausada: os gatilhos de cartão e de risco param.
    await prisma.entrega.update({ where: { id: e.id }, data: { status: "PAUSADA" } });
    const antes = await prisma.automacaoExecucao.count({ where: { automacaoId: { in: [cobrar.id, atraso.id, risco.id] } } });
    await prisma.entregaCartao.update({ where: { id: cartao("Mapear processos").id }, data: { dataAlvo: new Date(agora.getTime() - DIA) } });
    await varrerTempo(new Date(agora.getTime() + 15 * DIA));
    assert.equal(await prisma.automacaoExecucao.count({ where: { automacaoId: { in: [cobrar.id, atraso.id, risco.id] } } }), antes);
    assert.ok(renova.id);
  } finally { await p.limpar(); }
});

test("espera: a ação só roda se o cartão continuar na mesma situação", async () => {
  const p = await preparar("espera");
  try {
    await p.mk("ENTREGA_AGUARDANDO_CLIENTE", [{ campo: "diasAguardandoCliente", operador: ">=", valor: 2 }], [{ tipo: "REGISTRAR_ALERTA", mensagem: "Ainda esperando {cartao}", esperaHoras: 24 }]);
    const a = await p.ganhar("Entrega espera");
    const b = await p.ganhar("Entrega espera 2");
    const agora = new Date();
    for (const x of [a, b]) await moverCartao(x.cartao("Enviar acessos").id, "AGUARDANDO_CLIENTE", undefined, new Date(agora.getTime() - 3 * DIA));
    await varrerTempo(agora);
    // O cliente de "a" respondeu antes de vencer a espera.
    await moverCartao(a.cartao("Enviar acessos").id, "EM_ANDAMENTO", undefined, new Date(agora.getTime() + H));
    await processarVencidas(new Date(agora.getTime() + 25 * H));
    assert.equal(await prisma.feedback.count({ where: { oportunidadeId: a.op.id, texto: { startsWith: "Ainda esperando" } } }), 0, "a: deixou de esperar, ignorada");
    assert.equal(await prisma.feedback.count({ where: { oportunidadeId: b.op.id, texto: "Ainda esperando Enviar acessos" } }), 1, "b: continua esperando, executada");
    const ignorada = await prisma.automacaoExecucao.findFirst({ where: { oportunidadeId: a.op.id } });
    assert.deepEqual([ignorada?.status, ignorada?.detalhe], ["IGNORADA", "O fato não valia mais depois da espera"]);
  } finally { await p.limpar(); }
});

test("cartão concluído e entrega concluída: eventos; concluir tudo fecha a entrega; reabrir um cartão reabre", async () => {
  const p = await preparar("concluir");
  try {
    await p.mk("ENTREGA_CARTAO_CONCLUIDO", [{ campo: "pilar", operador: "=", valor: "OPERACAO" }], [{ tipo: "REGISTRAR_ALERTA", mensagem: "Concluído: {cartao}", esperaHoras: 0 }]);
    await p.mk("ENTREGA_CONCLUIDA", [], [{ tipo: "CRIAR_TAREFA", titulo: "Pedir depoimento de {cliente}", prazoHoras: 72, prioridade: "NORMAL", tipoTarefa: "WHATSAPP", esperaHoras: 0 }]);
    const { op, e, cartao } = await p.ganhar("Entrega concluir");
    assert.equal((await prisma.contato.findUnique({ where: { id: p.c.contato.id } }))!.cicloDeVida, "CLIENTE", "ganhou: virou cliente");
    assert.deepEqual(e.cartoes.map((k) => k.responsavelId), [p.dono.id, p.dono.id, p.dono.id], "cartões nascem com o dono da oportunidade");

    await moverCartao(cartao("Kickoff").id, "CONCLUIDO");
    await moverCartao(cartao("Enviar acessos").id, "CONCLUIDO");
    const alertas = async () => (await prisma.feedback.findMany({ where: { oportunidadeId: op.id, autor: "automacao" } })).map((f) => f.texto);
    assert.deepEqual(await alertas(), ["Concluído: Enviar acessos"], "o critério de pilar filtra (Kickoff é comercial)");
    assert.equal((await prisma.entrega.findUnique({ where: { id: e.id } }))!.status, "EM_ANDAMENTO");

    await moverCartao(cartao("Mapear processos").id, "CONCLUIDO");
    const fechada = (await prisma.entrega.findUnique({ where: { id: e.id } }))!;
    assert.equal(fechada.status, "CONCLUIDA");
    assert.ok(fechada.concluidaEm);
    assert.deepEqual((await prisma.tarefa.findMany({ where: { oportunidadeId: op.id, origem: "AUTOMACAO" } })).map((t) => t.titulo), [`Pedir depoimento de Empresa ${p.c.marca}`]);

    // Voltou trabalho: reabre. Concluir de novo é outro fato (outra data).
    await moverCartao(cartao("Mapear processos").id, "EM_ANDAMENTO");
    assert.deepEqual(await prisma.entrega.findUnique({ where: { id: e.id }, select: { status: true, concluidaEm: true } }), { status: "EM_ANDAMENTO", concluidaEm: null });
    await moverCartao(cartao("Mapear processos").id, "CONCLUIDO", undefined, new Date(Date.now() + 1000));
    assert.equal(await prisma.tarefa.count({ where: { oportunidadeId: op.id, origem: "AUTOMACAO" } }), 2);
    assert.equal((await alertas()).filter((t) => t === "Concluído: Mapear processos").length, 2);
  } finally { await p.limpar(); }
});

test("rotina diária: dono dos cartões, 'Essa semana' uma vez só, conclusão e renovação 60 dias antes (sem duplicar)", async () => {
  const p = await preparar("rotina", { padrao: true }); // funil de teste é o padrão: a renovação abre nele
  try {
    const { op, e, cartao } = await p.ganhar("Entrega rotina", 2500);
    const agora = new Date();
    // Um cartão sem dono; Kickoff (3 dias) e Enviar acessos (5 dias) caem na semana; Mapear (21 dias) não.
    await prisma.entregaCartao.update({ where: { id: cartao("Mapear processos").id }, data: { responsavelId: null } });

    const r1 = await rodarRotinaDeEntregas(agora);
    const k = async (t: string) => (await prisma.entregaCartao.findUnique({ where: { id: cartao(t).id } }))!;
    assert.equal((await k("Mapear processos")).responsavelId, p.dono.id, "herda o dono da oportunidade");
    assert.deepEqual([(await k("Kickoff")).coluna, (await k("Enviar acessos")).coluna, (await k("Mapear processos")).coluna], ["ESSA_SEMANA", "ESSA_SEMANA", "BACKLOG"]);
    assert.ok(r1.planejados >= 2 && r1.responsaveis >= 1);
    assert.equal(r1.erros.length, 0, r1.erros.join(" | "));

    // Alguém devolve o Kickoff para o Backlog: a rotina respeita.
    await moverCartao(cartao("Kickoff").id, "BACKLOG");
    await rodarRotinaDeEntregas(agora);
    assert.equal((await k("Kickoff")).coluna, "BACKLOG");
    // Daqui a 15 dias, o Mapear entra na semana.
    await rodarRotinaDeEntregas(new Date(agora.getTime() + 15 * DIA));
    assert.equal((await k("Mapear processos")).coluna, "ESSA_SEMANA");

    // Renovação: só abre a 60 dias. Com 12 meses, nada.
    assert.equal((await prisma.entrega.findUnique({ where: { id: e.id } }))!.renovacaoOportunidadeId, null);
    const renovaEm = new Date(agora.getTime() + 50 * DIA);
    await prisma.entrega.update({ where: { id: e.id }, data: { renovacaoEm: renovaEm } });
    const [ra, rb] = await Promise.all([rodarRotinaDeEntregas(agora), rodarRotinaDeEntregas(agora)]);
    assert.ok(ra.renovacoes + rb.renovacoes >= 1);
    await rodarRotinaDeEntregas(agora);
    const ren = await prisma.oportunidade.findMany({ where: { contatoId: p.c.contato.id, tags: { has: "renovacao" } }, include: { tarefas: true } });
    assert.equal(ren.length, 1, "duas rotinas ao mesmo tempo e uma terceira depois: uma renovação só");
    assert.deepEqual([ren[0].nome, ren[0].responsavelId, ren[0].valorMensal.toString(), ren[0].finalizaEm?.getTime(), ren[0].status], ["Renovação — Entrega rotina", p.dono.id, "2500", renovaEm.getTime(), "EM_ANDAMENTO"]);
    assert.equal((await prisma.entrega.findUnique({ where: { id: e.id } }))!.renovacaoOportunidadeId, ren[0].id);
    assert.equal(ren[0].tarefas.length, 1);
    assert.equal(Math.round((ren[0].tarefas[0].prazoEm!.getTime() - agora.getTime()) / DIA), 20, "proposta pronta 30 dias antes");

    // Tudo concluído por fora da tela (ex.: antes desta rotina): a rotina fecha a entrega.
    await prisma.entregaCartao.updateMany({ where: { entregaId: e.id }, data: { coluna: "CONCLUIDO", concluidoEm: agora } });
    const r3 = await rodarRotinaDeEntregas(agora);
    assert.equal(r3.concluidas >= 1, true);
    assert.equal((await prisma.entrega.findUnique({ where: { id: e.id } }))!.status, "CONCLUIDA");
    assert.ok(op.id);
  } finally {
    await p.limpar();
  }
});
