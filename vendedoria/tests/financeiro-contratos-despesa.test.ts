// Contratos de despesa (04/11): parcelas geradas sozinhas, cronograma do Fernando, entrada
// da MRV, sem duplicar conta lançada à mão, encerrar/editar, contratos iniciais e limites de gasto.
import test from "node:test";
import assert from "node:assert/strict";
import {
  descricaoDaConta, parcelasDoPeriodo, validarNovoContrato, valorDaParcela, vencimentoDeParcela,
} from "@/lib/finance/contratos-despesa";
import { CONTRATOS_INICIAIS } from "@/lib/finance/contratos-despesa-iniciais";
import { nivelDoOrcamento } from "@/lib/finance/orcamentos";
import { montarMensagemOrcamentos } from "@/lib/max/crons/orcamentos-alerta";

const temBanco = Boolean(process.env.DATABASE_URL);
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

const base = { valor_parcela: 450, entrada: null, entrada_data: null, cronograma: null, data_inicio: D("2026-11-01"), dia_vencimento: 1, parcelas_total: 13 };

test("cronograma do Fernando: 450 nas 11 primeiras, 371,04 e 293,47 no fim; total 5.614,51", () => {
  const c = { ...base, cronograma: { "12": 371.04, "13": 293.47 } };
  assert.equal(valorDaParcela(c, 1), 450);
  assert.equal(valorDaParcela(c, 11), 450);
  assert.equal(valorDaParcela(c, 12), 371.04);
  assert.equal(valorDaParcela(c, 13), 293.47);
  let total = 0;
  for (let n = 1; n <= 13; n++) total += valorDaParcela(c, n);
  assert.equal(Math.round(total * 100) / 100, 5614.51);
  assert.equal(iso(vencimentoDeParcela(c, 13)), "2027-11-01");
});

test("parcelasDoPeriodo: contrato longo (388x) só entrega o período pedido, com a numeração certa", () => {
  const caixa = { ...base, valor_parcela: 650, parcelas_total: 388, data_inicio: D("2026-12-01") };
  const p = parcelasDoPeriodo(caixa, "2026-11", "2027-01");
  assert.deepEqual(p.map((x) => [x.numero, iso(x.vencimento)]), [[1, "2026-12-01"], [2, "2027-01-01"]]);
  // 5 anos depois: a parcela do mês é a 61
  const depois = parcelasDoPeriodo(caixa, "2031-12", "2031-12");
  assert.deepEqual(depois.map((x) => x.numero), [61]);
  // nunca passa do total
  assert.equal(parcelasDoPeriodo(caixa, "2060-01", "2060-12").length, 0);
});

test("entrada da MRV entra como parcela 0 só no mês dela, e a 1ª parcela vem depois", () => {
  const mrv = { ...base, valor_parcela: 518.25, parcelas_total: 84, data_inicio: D("2026-12-01"), entrada: 769.01, entrada_data: D("2026-11-09") };
  const nov = parcelasDoPeriodo(mrv, "2026-11", "2026-12");
  assert.deepEqual(nov.map((x) => [x.numero, x.valor, iso(x.vencimento)]), [[0, 769.01, "2026-11-09"], [1, 518.25, "2026-12-01"]]);
  assert.equal(descricaoDaConta({ descricao: "MRV", parcelas_total: 84 }, 0), "MRV — entrada");
  assert.equal(descricaoDaConta({ descricao: "MRV", parcelas_total: 84 }, 3), "MRV — parcela 3/84");
  assert.equal(descricaoDaConta({ descricao: "Internet", parcelas_total: null }, 3), "Internet");
  // 769,01 + 84 × 518,25 = total da proposta
  assert.equal(Math.round((769.01 + 84 * 518.25) * 100) / 100, 44302.01);
});

test("dia 30 vira o último dia de fevereiro", () => {
  const agua = { ...base, parcelas_total: null, data_inicio: D("2026-11-30"), dia_vencimento: 30 };
  assert.equal(iso(parcelasDoPeriodo(agua, "2027-02", "2027-02")[0].vencimento), "2027-02-28");
});

test("validação: nome, valor, data, dia, quantidade, negócio e cronograma", () => {
  const ok = { descricao: "Carro", valor_parcela: 334, primeiro_vencimento: "2026-12-01" };
  assert.equal(validarNovoContrato(ok).dia_vencimento, 1);
  assert.throws(() => validarNovoContrato({ ...ok, descricao: " " }), /nome/);
  assert.throws(() => validarNovoContrato({ ...ok, valor_parcela: 0 }), /maior que zero/);
  assert.throws(() => validarNovoContrato({ ...ok, primeiro_vencimento: "2026-02-31" }), /inválida/);
  assert.throws(() => validarNovoContrato({ ...ok, dia_vencimento: 32 }), /dia de vencimento/);
  assert.throws(() => validarNovoContrato({ ...ok, parcelas_total: 0 }), /quantidade/);
  assert.throws(() => validarNovoContrato({ ...ok, tipo_negocio: "xyz" }), /Negócio/);
  assert.throws(() => validarNovoContrato({ ...ok, entrada: 100 }), /data de vencimento da entrada/);
  assert.throws(() => validarNovoContrato({ ...ok, parcelas_total: 3, cronograma: { "4": 100 } }), /fora do contrato/);
  assert.equal(validarNovoContrato({ ...ok, parcelas_total: null }).parcelas_total, null);
});

test("contratos iniciais: valores combinados e nomes únicos", () => {
  const por = Object.fromEntries(CONTRATOS_INICIAIS.map((c) => [c.descricao, c]));
  assert.equal(new Set(CONTRATOS_INICIAIS.map((c) => c.descricao.toLowerCase())).size, CONTRATOS_INICIAIS.length);
  assert.equal(por["MRV — proposta 84x"].entrada, 769.01);
  assert.equal(por["MRV — proposta 84x"].valor_parcela, 518.25);
  assert.equal(por["MRV — proposta 84x"].parcelas_total, 84);
  assert.equal(por["Parcela caixa"].parcelas_total, 388);
  assert.equal(por["Parcela caixa"].saldo_devedor, 117040.52);
  assert.equal(por["Internet"].valor_parcela, 79.9);
  assert.equal(por["Água"].estimada, true);
  assert.equal(por["Energia"].estimada, true);
  assert.equal(por["Parcela carro (Fábio)"].valor_parcela, 334);
  for (const c of CONTRATOS_INICIAIS) validarNovoContrato(c); // todos passam na validação
});

test("limites de gasto: 80% alerta, 100% estoura; mensagem", () => {
  assert.equal(nivelDoOrcamento(790, 1000), "ok");
  assert.equal(nivelDoOrcamento(800, 1000), "alerta");
  assert.equal(nivelDoOrcamento(1000, 1000), "estourado");
  assert.equal(nivelDoOrcamento(50, 0), "ok");
  const m = montarMensagemOrcamentos([
    { categoria: "Cartão de crédito", gasto: 1100, limite: 1000, nivel: "estourado" },
    { categoria: "Alimentação", gasto: 420, limite: 500, nivel: "alerta" },
  ]);
  assert.match(m, /🔴 Cartão de crédito: estourou o limite \(110%\)/);
  assert.match(m, /🟡 Alimentação: chegou a 84% do limite/);
});

test("contas geradas: mês atual + seguinte, idempotente, sem duplicar manual, encerrar e editar", { skip: !temBanco, timeout: 90_000 }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const { garantirContasDeContratos, editarContratoDespesa, encerrarContratoDespesa, listarContratosDespesa } = await import("@/lib/finance/contratos-despesa");
  const tag = `ct-${Date.now()}`;
  const HOJE = D("2031-05-04");
  const mk = (descricao: string, extra: Record<string, unknown> = {}) =>
    prisma.contratoDespesa.create({
      data: { descricao: `${tag} ${descricao}`, categoria: "Casa", tipo_negocio: "pessoal", valor_parcela: 100, dia_vencimento: 1, data_inicio: D("2031-05-01"), ...extra },
    });

  const longo = await mk("longo", { parcelas_total: 388, valor_parcela: 650 });
  const agua = await mk("agua", { estimada: true, valor_parcela: 200, dia_vencimento: 30, data_inicio: D("2031-05-30") });
  const manual = await mk("manual", { valor_parcela: 79.9, dia_vencimento: 10, data_inicio: D("2031-05-10") });
  const fernando = await mk("fernando", { parcelas_total: 3, valor_parcela: 450, cronograma: { "3": 293.47 } });
  // conta lançada à mão em maio com o mesmo nome do contrato "manual": não pode duplicar
  const legada = await prisma.contaPagarMax.create({ data: { descricao: `${tag} manual`, valor: 79.9, data_vencimento: D("2031-05-10"), categoria: "Casa", tipo_negocio: "pessoal" } });

  try {
    const n1 = await garantirContasDeContratos(HOJE);
    const contas = await prisma.contaPagarMax.findMany({ where: { contrato_id: { in: [longo.id, agua.id, manual.id, fernando.id] } }, orderBy: [{ data_vencimento: "asc" }] });
    const de = (id: string) => contas.filter((c) => c.contrato_id === id);

    // 388x: só maio e junho, não 388 linhas
    assert.deepEqual(de(longo.id).map((c) => [c.parcela_numero, iso(c.data_vencimento), c.valor]), [[1, "2031-05-01", 650], [2, "2031-06-01", 650]]);
    assert.equal(de(longo.id)[0].descricao, `${tag} longo — parcela 1/388`);
    assert.equal(de(longo.id)[0].parcelas_total, 388);
    // água: estimada, sem fim
    assert.ok(de(agua.id).length === 2 && de(agua.id).every((c) => c.estimada === true));
    // "manual": maio já existe à mão → não duplica; a conta antiga é adotada (parcela 1) e junho é gerado
    assert.deepEqual(de(manual.id).map((c) => [c.parcela_numero, iso(c.data_vencimento)]), [[1, "2031-05-10"], [2, "2031-06-10"]]);
    assert.equal(de(manual.id)[0].id, legada.id, "a conta lançada à mão virou a parcela 1");
    assert.equal(await prisma.contaPagarMax.count({ where: { descricao: `${tag} manual` } }), 2, "sem duplicar");
    // Fernando: parcela 3 só quando chegar o mês dela
    assert.deepEqual(de(fernando.id).map((c) => c.parcela_numero), [1, 2]);
    assert.ok(n1 >= 7);

    // idempotente
    assert.equal(await garantirContasDeContratos(HOJE), 0);
    // mês seguinte: entra a parcela 3 do Fernando, com o valor do cronograma
    await garantirContasDeContratos(D("2031-06-04"));
    const p3 = await prisma.contaPagarMax.findFirst({ where: { contrato_id: fernando.id, parcela_numero: 3 } });
    assert.equal(p3?.valor, 293.47);
    assert.equal(iso(p3!.data_vencimento), "2031-07-01");
    // e nunca passa do total
    await garantirContasDeContratos(D("2031-12-04"));
    assert.equal(await prisma.contaPagarMax.count({ where: { contrato_id: fernando.id } }), 3);

    // pagar uma parcela e listar o progresso
    const primeira = (await prisma.contaPagarMax.findFirst({ where: { contrato_id: longo.id, parcela_numero: 1 } }))!;
    await prisma.contaPagarMax.update({ where: { id: primeira.id }, data: { status: "paga" } });
    const lista = (await listarContratosDespesa()).find((c) => c.id === longo.id)!;
    assert.equal(lista.pagas, 1);
    assert.equal(lista.restantes, 387);
    assert.equal(lista.valor_restante, Math.round(387 * 650 * 100) / 100);
    assert.equal(lista.proxima?.numero, 2);

    // editar o valor: vale para as pendentes que estavam no valor antigo, não para a paga
    await editarContratoDespesa(longo.id, { valor_parcela: 700 });
    const aposEdicao = await prisma.contaPagarMax.findMany({ where: { contrato_id: longo.id }, orderBy: { parcela_numero: "asc" } });
    assert.equal(aposEdicao[0].valor, 650, "a parcela paga não muda");
    assert.ok(aposEdicao.slice(1).every((c) => c.valor === 700), "as pendentes passam para o valor novo");
    await assert.rejects(() => editarContratoDespesa(longo.id, { valor_parcela: -1 }), /maior que zero/);

    // encerrar: cancela só as pendentes futuras; a paga fica; não gera mais
    const pendentesAntes = await prisma.contaPagarMax.count({ where: { contrato_id: longo.id, status: "pendente", data_vencimento: { gt: D("2031-05-15") } } });
    assert.ok(pendentesAntes >= 2);
    const r = await encerrarContratoDespesa(longo.id, D("2031-05-15"));
    assert.equal(r.canceladas, pendentesAntes);
    const apos = await prisma.contaPagarMax.findMany({ where: { contrato_id: longo.id }, orderBy: { parcela_numero: "asc" } });
    assert.equal(apos[0].status, "paga");
    assert.ok(apos.slice(1).every((c) => c.status === "cancelada"));
    const total = apos.length;
    await garantirContasDeContratos(D("2032-07-04"));
    assert.equal(await prisma.contaPagarMax.count({ where: { contrato_id: longo.id } }), total, "encerrado não gera mais");

    // livro-razão: a edição e o encerramento ficaram no histórico
    assert.ok(await prisma.historicoFinanceiro.count({ where: { entidade: "ContratoDespesa", entidade_id: longo.id } }) >= 2);
  } finally {
    const ids = (await prisma.contratoDespesa.findMany({ where: { descricao: { startsWith: tag } }, select: { id: true } })).map((c) => c.id);
    await prisma.contaPagarMax.deleteMany({ where: { OR: [{ contrato_id: { in: ids } }, { id: legada.id }] } });
    await prisma.contratoDespesa.deleteMany({ where: { id: { in: ids } } });
  }
});

test("contratos iniciais entram uma vez só e desligam a recorrência da conta antiga", { skip: !temBanco, timeout: 90_000 }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const { semearContratosDespesaIniciais } = await import("@/lib/finance/contratos-despesa-iniciais");
  const nomes = CONTRATOS_INICIAIS.map((c) => c.descricao);
  const antes = await prisma.contratoDespesa.count({ where: { descricao: { in: nomes } } });
  const marca = await prisma.alertaEnviadoMax.findUnique({ where: { chave: "seed-contratos-despesa-v1" } });
  if (antes > 0 || marca) return; // banco já semeado (dev): não mexe

  const legada = await prisma.contaPagarMax.create({ data: { descricao: "Fernando", valor: 450, data_vencimento: D("2031-01-11"), categoria: "Divida", tipo_negocio: "pessoal", recorrente: true, frequencia: "mensal" } });
  try {
    const r1 = await semearContratosDespesaIniciais();
    assert.equal(r1.criados, CONTRATOS_INICIAIS.length);
    assert.equal((await semearContratosDespesaIniciais()).criados, 0, "segunda chamada não faz nada");
    assert.equal(await prisma.contratoDespesa.count({ where: { descricao: { in: nomes } } }), CONTRATOS_INICIAIS.length);
    assert.equal((await prisma.contaPagarMax.findUnique({ where: { id: legada.id } }))?.recorrente, false);
    // o usuário apaga um: não volta
    const mrv = await prisma.contratoDespesa.findFirst({ where: { descricao: "MRV — proposta 84x" } });
    await prisma.contratoDespesa.update({ where: { id: mrv!.id }, data: { status: "encerrado" } });
    await semearContratosDespesaIniciais();
    assert.equal((await prisma.contratoDespesa.findUnique({ where: { id: mrv!.id } }))?.status, "encerrado");
  } finally {
    const ids = (await prisma.contratoDespesa.findMany({ where: { descricao: { in: nomes } }, select: { id: true } })).map((c) => c.id);
    await prisma.contaPagarMax.deleteMany({ where: { OR: [{ contrato_id: { in: ids } }, { id: legada.id }] } });
    await prisma.contratoDespesa.deleteMany({ where: { id: { in: ids } } });
    await prisma.alertaEnviadoMax.deleteMany({ where: { chave: "seed-contratos-despesa-v1" } });
  }
});

test("limite de gasto: soma as grafias da categoria, avisa a 80% e de novo a 100%, uma vez cada", { skip: !temBanco, timeout: 60_000 }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const { avisarOrcamentos } = await import("@/lib/max/crons/orcamentos-alerta");
  const tag = `orc${Date.now()}`;
  const categoria = `Cartão ${tag}`;
  const AGORA = new Date("2031-03-15T15:00:00Z"); // 12h em Brasília
  const orc = await prisma.orcamentoMax.create({ data: { categoria, limite_mensal: 1000 } });
  const tx = async (cat: string, valor: number) =>
    prisma.transacao.create({ data: { tipo: "despesa", valor, descricao: tag, categoria: cat, tipo_negocio: "pessoal", data_transacao: D("2031-03-10"), mes: "2031-03" } });
  const entregas: string[] = [];
  const entregar = async (a: { mensagem: string }) => { entregas.push(a.mensagem); return { whatsapp: true, notificacao: true }; };
  const nossas = () => entregas.filter((m) => m.includes(tag));

  try {
    // grafias diferentes da mesma categoria somam: 500 + 400 = 900 (90%)
    await tx(categoria, 500);
    await tx(`CARTÃO ${tag} `, 400);
    assert.equal((await avisarOrcamentos({ agora: new Date("2031-03-15T05:00:00Z"), entregar })).situacao, "fora-do-horario");
    await avisarOrcamentos({ agora: AGORA, entregar });
    assert.equal(nossas().length, 1);
    assert.match(nossas()[0], /chegou a 90% do limite/);
    // mesma rodada de novo: não repete
    await avisarOrcamentos({ agora: AGORA, entregar });
    assert.equal(nossas().length, 1);
    // passou de 100%: aviso novo, de "estourou"
    await tx(categoria, 200);
    await avisarOrcamentos({ agora: AGORA, entregar });
    assert.equal(nossas().length, 2);
    assert.match(nossas()[1], /estourou o limite \(110%\)/);
    await avisarOrcamentos({ agora: AGORA, entregar });
    assert.equal(nossas().length, 2);
  } finally {
    await prisma.alertaEnviadoMax.deleteMany({ where: { chave: { in: [`orc-80-${categoria}-2031-03`, `orc-estourado-${categoria}-2031-03`] } } });
    await prisma.transacao.deleteMany({ where: { descricao: tag } });
    await prisma.orcamentoMax.delete({ where: { id: orc.id } });
  }
});
