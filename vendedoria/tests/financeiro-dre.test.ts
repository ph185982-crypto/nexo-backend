// Aba DRE do financeiro (30/10): classificação das categorias, a demonstração
// em cascata, análises e o relatório lido do banco.
import test from "node:test";
import assert from "node:assert/strict";
import {
  agruparLinhas, analiseVertical, chaveCategoria, classificar, classificarPadrao, dreParaCsv, ESTRUTURA_DRE,
  gerarInsights, GRUPOS_DRE, montarDre, variacaoPct, valoresVazios,
  type LinhaAgregada, type MapaClassificacao,
} from "@/lib/finance/dre";

const temBanco = Boolean(process.env.DATABASE_URL);

test("chaveCategoria ignora acento, caixa e espaços", () => {
  assert.equal(chaveCategoria("  Cartão  de crédito "), "cartao de credito");
  assert.equal(chaveCategoria("Renda Variável"), "renda variavel");
});

test("classificação padrão das categorias reais do extrato", () => {
  const casos: Array<["receita" | "despesa", string, string]> = [
    ["receita", "Receita Prevista", "receita_operacional"],
    ["receita", "Renda Variável", "receita_operacional"],
    ["receita", "Salário", "receita_operacional"],
    ["receita", "Rendimentos", "receita_financeira"],
    ["receita", "Outros", "receita_outras"],
    ["despesa", "Alimentação", "pessoais"],
    ["despesa", "Transporte", "pessoais"],
    ["despesa", "Saúde", "pessoais"],
    ["despesa", "Vestuário", "pessoais"],
    ["despesa", "Lazer", "pessoais"],
    ["despesa", "Assinaturas", "tecnologia"],
    ["despesa", "Moradia", "ocupacao"],
    ["despesa", "Dívidas/Parcelas", "financeiras"],
    ["despesa", "Cartão de crédito ", "financeiras"],
    ["despesa", "Negócios", "administrativas"],
    ["despesa", "Outros", "administrativas"],
    ["despesa", "Tráfego pago", "marketing"],
    ["despesa", "DAS MEI", "deducoes"],
    ["despesa", "Imposto de renda", "impostos_resultado"],
    ["despesa", "Fornecedor", "custos"],
    ["despesa", "Pró-labore", "pessoal"],
  ];
  for (const [tipo, cat, esperado] of casos) {
    assert.equal(classificarPadrao(tipo, cat), esperado, `${tipo}/${cat}`);
  }
});

test("classificação manual vence o padrão, mas só se o grupo for do mesmo tipo", () => {
  const mapa: MapaClassificacao = new Map([
    ["despesa|negocios", "marketing"],
    ["despesa|alimentacao", "receita_operacional"], // inválido: grupo de receita numa despesa
  ]);
  assert.deepEqual(classificar("despesa", "Negócios", mapa), { grupo: "marketing", origem: "manual" });
  assert.deepEqual(classificar("despesa", "Alimentação", mapa), { grupo: "pessoais", origem: "padrao" });
});

test("todo grupo tem tipo e a estrutura cobre cada grupo exatamente uma vez", () => {
  const usados = ESTRUTURA_DRE.flatMap((l) => l.grupos ?? []);
  assert.equal(new Set(usados).size, usados.length, "grupo repetido na estrutura");
  assert.deepEqual([...usados].sort(), GRUPOS_DRE.map((g) => g.key).sort(), "grupo fora da estrutura");
});

test("DRE em cascata: bruta → líquida → bruto → operacional → líquido → caixa", () => {
  const v = valoresVazios();
  v.receita_operacional = 10_000;
  v.receita_outras = 500;
  v.deducoes = 600; // 10.500 - 600 = 9.900 líquida
  v.custos = 2_900; // lucro bruto 7.000
  v.pessoal = 1_000;
  v.marketing = 1_500;
  v.tecnologia = 300;
  v.ocupacao = 400;
  v.administrativas = 200;
  v.pessoais = 100; // operacionais 3.500 → operacional 3.500
  v.receita_financeira = 50;
  v.financeiras = 250; // antes impostos 3.300
  v.impostos_resultado = 300; // líquido 3.000
  v.investimentos = 1_000; // caixa 2.000
  const d = montarDre(v);
  assert.equal(d.receitaBruta, 10_500);
  assert.equal(d.receitaLiquida, 9_900);
  assert.equal(d.lucroBruto, 7_000);
  assert.equal(d.despesasOperacionais, 3_500);
  assert.equal(d.resultadoOperacional, 3_500);
  assert.equal(d.resultadoAntesImpostos, 3_300);
  assert.equal(d.resultadoLiquido, 3_000);
  assert.equal(d.sobraCaixa, 2_000);
  assert.equal(d.totalSaidas, 600 + 2_900 + 3_500 + 250 + 300);
  assert.equal(d.margemLiquida, 30.3); // 3000/9900
  assert.equal(d.margemBruta, 70.7);
});

test("sem receita: margens nulas e prejuízo", () => {
  const v = valoresVazios();
  v.pessoais = 800;
  const d = montarDre(v);
  assert.equal(d.resultadoLiquido, -800);
  assert.equal(d.margemLiquida, null);
  assert.equal(analiseVertical(800, d.receitaLiquida), null);
});

test("agruparLinhas soma categorias que só diferem em acento/caixa e separa previsto de realizado", () => {
  const linhas: LinhaAgregada[] = [
    { tipo: "despesa", categoria: "Alimentação", total: 100, quantidade: 2 },
    { tipo: "despesa", categoria: "alimentacao", total: 50, quantidade: 1 },
    { tipo: "despesa", categoria: "Moradia", total: 1_000, quantidade: 1, previsto: true },
    { tipo: "receita", categoria: "Salário", total: 3_000, quantidade: 1 },
  ];
  const { valores, porGrupo } = agruparLinhas(linhas);
  assert.equal(valores.pessoais, 150);
  assert.equal(porGrupo.pessoais.length, 1);
  assert.equal(porGrupo.pessoais[0].quantidade, 3);
  assert.equal(valores.ocupacao, 1_000);
  assert.equal(porGrupo.ocupacao[0].previsto, true);
  assert.equal(valores.receita_operacional, 3_000);
});

test("variação percentual e análise vertical", () => {
  assert.equal(variacaoPct(150, 100), 50);
  assert.equal(variacaoPct(50, 100), -50);
  assert.equal(variacaoPct(0, 0), 0);
  assert.equal(variacaoPct(10, 0), null);
  assert.equal(variacaoPct(-50, -100), 50);
  assert.equal(analiseVertical(250, 1000), 25);
});

test("insights: lucro, prejuízo e período vazio", () => {
  const lucro = valoresVazios();
  lucro.receita_operacional = 1_000;
  lucro.pessoais = 400;
  const prej = valoresVazios();
  prej.receita_operacional = 1_000;
  prej.pessoal = 1_500;
  const vazio = montarDre(valoresVazios());

  const a = gerarInsights({ atual: montarDre(lucro), anterior: montarDre(prej), serie: [], rotuloAnterior: "setembro de 2026" });
  assert.ok(a.some((t) => t.includes("Resultado líquido positivo")));
  assert.ok(a.some((t) => t.includes("Maior grupo de saída: Dia a dia e pessoais")));
  assert.ok(a.some((t) => t.includes("melhorou")));

  const b = gerarInsights({ atual: montarDre(prej), anterior: vazio, serie: [], rotuloAnterior: "x" });
  assert.ok(b.some((t) => t.startsWith("Prejuízo de")));
  assert.ok(!b.some((t) => t.includes("vs x")), "sem base anterior não compara");

  const c = gerarInsights({ atual: vazio, anterior: vazio, serie: [], rotuloAnterior: "x" });
  assert.deepEqual(c, ["Nenhum lançamento no período com os filtros atuais."]);
});

test("CSV: separador ;, vírgula decimal, BOM e categorias abertas", () => {
  const { valores, porGrupo } = agruparLinhas([
    { tipo: "receita", categoria: "Salário", total: 1234.5, quantidade: 1 },
    { tipo: "despesa", categoria: 'Mercado "grande"', total: 200, quantidade: 1 },
  ]);
  const d = montarDre(valores);
  const csv = dreParaCsv({ titulo: "t", periodoLabel: "Outubro", anteriorLabel: "Setembro", atual: d, anterior: montarDre(valoresVazios()), porGrupo });
  assert.ok(csv.startsWith("﻿"));
  assert.ok(csv.includes("1234,50"));
  assert.ok(csv.includes('"      Mercado ""grande"""'));
  assert.ok(csv.includes('"= Resultado líquido"'));
});

test("relatório do banco: realizado, projetado, escopo e classificação manual (sem alterar lançamentos)", { skip: !temBanco, timeout: 60_000 }, async () => {
  const { prisma } = await import("@/lib/prisma/client");
  const { montarRelatorioDre, definirClassificacao, listarClassificacoes } = await import("@/lib/finance/dre-dados");
  const { resolverPeriodo } = await import("@/lib/finance/periodo");
  const D = (s: string) => new Date(`${s}T00:00:00Z`);
  const tag = `dre-test-${Date.now()}`;
  const mes = "2031-03"; // futuro distante: não colide com dado real
  const mk = (tipo: string, valor: number, categoria: string, tipo_negocio: string, dia = "2031-03-10") =>
    prisma.transacao.create({ data: { tipo, valor, descricao: tag, categoria, tipo_negocio, data_transacao: D(dia), mes: dia.slice(0, 7) } });

  const criadas = [
    await mk("receita", 10_000, "Receita Prevista", "nexo"),
    await mk("despesa", 1_000, "Tráfego pago", "nexo"),
    await mk("despesa", 2_000, `Negócios ${tag}`, "nexo"),
    await mk("despesa", 500, "Alimentação", "pessoal"),
    await mk("receita", 4_000, "Salário", "pessoal"),
    await mk("receita", 5_000, "Receita Prevista", "nexo", "2031-02-10"), // mês anterior
  ];
  const conta = await prisma.contaPagarMax.create({ data: { descricao: tag, valor: 700, data_vencimento: D("2031-03-20"), categoria: "Assinaturas", tipo_negocio: "nexo" } });
  const prevista = await prisma.receitaPrevistaMax.create({ data: { descricao: tag, valor: 3_000, data_prevista: D("2031-03-25"), tipo_negocio: "nexo" } });
  const contagemAntes = await prisma.transacao.count();
  const hoje = D("2031-03-15");
  const periodo = resolverPeriodo({ mes }, hoje);

  try {
    const nexo = await montarRelatorioDre(periodo, "nexo", hoje);
    const r = nexo.realizado.atual;
    assert.equal(r.receitaBruta, 10_000);
    assert.equal(r.grupos.marketing, 1_000);
    assert.equal(r.grupos.administrativas, 2_000); // categoria desconhecida → administrativas
    assert.equal(r.resultadoLiquido, 7_000);
    assert.equal(nexo.realizado.anterior.receitaBruta, 5_000);
    assert.equal(nexo.serie.length, 12);
    assert.equal(nexo.serie[11].mes, mes);
    assert.equal(nexo.serie[11].resultadoLiquido, 7_000);
    assert.equal(nexo.acumuladoAno.ano, 2031);

    // Projetado soma a receita prevista (3.000) e a conta a pagar (700, Tecnologia)
    assert.equal(nexo.projetado.atual.receitaBruta, 13_000);
    assert.equal(nexo.projetado.atual.grupos.tecnologia, 700);
    assert.equal(nexo.projetado.previsto.receitas, 3_000);
    assert.equal(nexo.projetado.previsto.despesas, 700);

    // Escopo "pessoal" não enxerga a Nexo
    const pessoal = await montarRelatorioDre(periodo, "pessoal", hoje);
    assert.equal(pessoal.realizado.atual.receitaBruta, 4_000);
    assert.equal(pessoal.realizado.atual.grupos.pessoais, 500);

    // Classificação manual: "Negócios <tag>" passa para Custos; reverte para o padrão depois
    await definirClassificacao("despesa", `Negócios ${tag}`, "custos");
    const manual = await montarRelatorioDre(periodo, "nexo", hoje);
    assert.equal(manual.realizado.atual.custos, 2_000);
    assert.equal(manual.realizado.atual.lucroBruto, 8_000);
    assert.equal(manual.realizado.atual.resultadoLiquido, 7_000, "o resultado final não muda, só a linha");
    const item = (await listarClassificacoes()).find((i) => i.categoria === `Negócios ${tag}`);
    assert.equal(item?.origem, "manual");

    // Grupo de outro tipo é recusado
    await assert.rejects(() => definirClassificacao("despesa", "Qualquer", "receita_operacional"), /não é de despesa/);

    await definirClassificacao("despesa", `Negócios ${tag}`, null);
    const padrao = await montarRelatorioDre(periodo, "nexo", hoje);
    assert.equal(padrao.realizado.atual.custos, 0);

    // Nenhum lançamento foi criado ou apagado pela DRE
    assert.equal(await prisma.transacao.count(), contagemAntes);

    // A mudança de classificação ficou no livro-razão
    const hist = await prisma.historicoFinanceiro.count({ where: { entidade: "DreClassificacaoMax" } });
    assert.ok(hist >= 2, `histórico da classificação: ${hist}`);
  } finally {
    await prisma.dreClassificacaoMax.deleteMany({ where: { categoria: { contains: tag.toLowerCase() } } });
    await prisma.transacao.deleteMany({ where: { id: { in: criadas.map((c) => c.id) } } });
    await prisma.contaPagarMax.delete({ where: { id: conta.id } });
    await prisma.receitaPrevistaMax.delete({ where: { id: prevista.id } });
  }
});
