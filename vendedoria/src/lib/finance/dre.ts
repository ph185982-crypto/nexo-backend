// DRE gerencial (Demonstração do Resultado) do financeiro — funções puras,
// sem Prisma, usadas no servidor (API) e no navegador (tabela, gráficos, CSV).
//
// Regime de caixa: a DRE "realizada" soma o que está no extrato (Transacao).
// Cada categoria do extrato cai em um grupo da DRE — por padrão pela palavra-
// chave (classificarPadrao) e, quando o usuário mudou à mão na aba DRE, pela
// tabela DreClassificacaoMax. Nenhum lançamento é alterado: só a leitura muda.

export type TipoLancamento = "receita" | "despesa";

export const GRUPOS_DRE = [
  { key: "receita_operacional", tipo: "receita", label: "Receita operacional",           descricao: "Serviços, vendas, contratos e salário" },
  { key: "receita_outras",      tipo: "receita", label: "Outras receitas",               descricao: "Reembolsos, prêmios e entradas eventuais" },
  { key: "receita_financeira",  tipo: "receita", label: "Receitas financeiras",          descricao: "Rendimentos, juros recebidos e cashback" },
  { key: "deducoes",            tipo: "despesa", label: "Deduções da receita",           descricao: "Impostos sobre vendas (DAS), taxas de plataforma e devoluções" },
  { key: "custos",              tipo: "despesa", label: "Custos diretos",                descricao: "Mercadorias, fornecedores, frete e insumos da entrega" },
  { key: "pessoal",             tipo: "despesa", label: "Pessoal",                       descricao: "Salários, pró-labore, freelancers e encargos" },
  { key: "marketing",           tipo: "despesa", label: "Marketing e vendas",            descricao: "Anúncios, tráfego pago e comissões" },
  { key: "tecnologia",          tipo: "despesa", label: "Tecnologia e assinaturas",      descricao: "Software, internet, telefone e hospedagem" },
  { key: "ocupacao",            tipo: "despesa", label: "Ocupação e utilidades",         descricao: "Aluguel, condomínio, água, luz e moradia" },
  { key: "administrativas",     tipo: "despesa", label: "Administrativas e gerais",      descricao: "Contabilidade, escritório e o que não tem grupo próprio" },
  { key: "pessoais",            tipo: "despesa", label: "Dia a dia e pessoais",          descricao: "Alimentação, transporte, saúde, lazer e vestuário" },
  { key: "financeiras",         tipo: "despesa", label: "Despesas financeiras",          descricao: "Juros, tarifas, parcelas de dívidas e cartão" },
  { key: "impostos_resultado",  tipo: "despesa", label: "Impostos sobre o resultado",    descricao: "IRPJ, CSLL e imposto de renda" },
  { key: "investimentos",       tipo: "despesa", label: "Investimentos e não operacionais", descricao: "Equipamentos, aplicações, reservas e transferências" },
] as const;

export type GrupoDre = (typeof GRUPOS_DRE)[number]["key"];
export type OrigemClassificacao = "padrao" | "manual";

export const DESPESAS_OPERACIONAIS: readonly GrupoDre[] = [
  "pessoal", "marketing", "tecnologia", "ocupacao", "administrativas", "pessoais",
];

export function grupoInfo(g: GrupoDre) {
  return GRUPOS_DRE.find((x) => x.key === g)!;
}

export function ehGrupoDre(v: unknown): v is GrupoDre {
  return typeof v === "string" && GRUPOS_DRE.some((g) => g.key === v);
}

export function gruposDoTipo(tipo: TipoLancamento) {
  return GRUPOS_DRE.filter((g) => g.tipo === tipo);
}

/** Chave da categoria: minúsculas, sem acento, espaços normalizados. */
export function chaveCategoria(categoria: string): string {
  return categoria
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function chaveClassificacao(tipo: TipoLancamento, categoria: string): string {
  return `${tipo}|${chaveCategoria(categoria)}`;
}

// ─── Classificação padrão por palavra-chave (sempre sobre a chave normalizada) ──

const REGRAS_RECEITA: ReadonlyArray<readonly [RegExp, GrupoDre]> = [
  [/rendiment|juros|invest|dividend|cashback|aplicac|poupanc|\bcdb\b|tesouro|rentabil/, "receita_financeira"],
  [/\boutr|reembols|presente|premi|eventual|doac|venda de (bem|item|usado)/, "receita_outras"],
];

// A ordem importa: a primeira regra que bater vence.
const REGRAS_DESPESA: ReadonlyArray<readonly [RegExp, GrupoDre]> = [
  [/\birpf\b|\birpj\b|\bcsll\b|imposto de renda|\bir\b/, "impostos_resultado"],
  [/impost|tribut|^das\b|\bdas[- ]?(mei|simples)\b|simples nacional|\bmei\b|taxa de venda|taxa d[aeo]s? (marketplace|plataforma|shopee|mercado livre)|devolu|estorno|nota fiscal|\bnf\b|\biss\b|\bicms\b|\bpis\b|cofins/, "deducoes"],
  [/custo|\bcmv\b|mercadoria|fornecedor|frete|embalag|insumo|materia[- ]prima|\bproduto/, "custos"],
  [/salari|pro[- ]?labore|freelanc|funcionari|folha|\binss\b|\bfgts\b|encargo|terceiriz|colaborador|\brh\b|vale[- ]/, "pessoal"],
  [/marketing|anunci|\bads\b|trafego|\bmidia\b|publicidad|propaganda|impulsion|patrocin|comiss|influenc/, "marketing"],
  [/assinatur|software|\bsaas\b|internet|telefon|celular|hospedag|dominio|ferramenta|tecnolog|\bapi\b|openai|anthropic|vercel|google|\bmeta\b|nuvem|cloud|streaming|\bchip\b/, "tecnologia"],
  [/moradia|aluguel|condomin|\bagua\b|\bluz\b|energia|\bgas\b|iptu|escritori|coworking|\bsala\b|limpeza|manutencao/, "ocupacao"],
  [/divida|parcela|emprestimo|financiamento|juros|tarifa|cartao|\bbanco\b|\biof\b|multa|cheque|consorcio|anuidade/, "financeiras"],
  [/alimenta|\bmercado\b(?! livre)|supermercado|restaurante|ifood|lanche|padaria|lazer|vestuari|roupa|saude|farmac|medic|academia|beleza|barbe|salao|\bpet\b|educa|curso|escola|faculdade|viagem|presente|transporte|combustiv|gasolina|\buber\b|\b99\b|estacionamento|pedagio|onibus|\bcarro\b|\bmoto\b|cinema/, "pessoais"],
  [/investimento|aplicac|reserva|poupanc|\bcdb\b|tesouro|\bacoes\b|cripto|bitcoin|equipamento|maquina|computador|notebook|transferencia|aporte/, "investimentos"],
];

export function classificarPadrao(tipo: TipoLancamento, categoria: string): GrupoDre {
  const chave = chaveCategoria(categoria);
  const regras = tipo === "receita" ? REGRAS_RECEITA : REGRAS_DESPESA;
  for (const [re, grupo] of regras) if (re.test(chave)) return grupo;
  return tipo === "receita" ? "receita_operacional" : "administrativas";
}

/** Mapa de classificações manuais: chaveClassificacao(tipo, categoria) → grupo. */
export type MapaClassificacao = ReadonlyMap<string, GrupoDre>;

export function classificar(
  tipo: TipoLancamento,
  categoria: string,
  mapa?: MapaClassificacao,
): { grupo: GrupoDre; origem: OrigemClassificacao } {
  const manual = mapa?.get(chaveClassificacao(tipo, categoria));
  if (manual && grupoInfo(manual).tipo === tipo) return { grupo: manual, origem: "manual" };
  return { grupo: classificarPadrao(tipo, categoria), origem: "padrao" };
}

// ─── Agrupamento das linhas do extrato nos grupos da DRE ────────────────────────

export interface LinhaAgregada {
  tipo: TipoLancamento;
  categoria: string;
  total: number;
  quantidade: number;
  /** true = ainda não aconteceu (receita prevista em aberto / conta a pagar pendente) */
  previsto?: boolean;
}

export interface ItemCategoria {
  categoria: string;
  total: number;
  quantidade: number;
  previsto: boolean;
}

export type ValoresPorGrupo = Record<GrupoDre, number>;
export type CategoriasPorGrupo = Record<GrupoDre, ItemCategoria[]>;

const arred = (n: number) => Math.round(n * 100) / 100;
const arred1 = (n: number) => Math.round(n * 10) / 10;

export function valoresVazios(): ValoresPorGrupo {
  return Object.fromEntries(GRUPOS_DRE.map((g) => [g.key, 0])) as ValoresPorGrupo;
}

export function agruparLinhas(
  linhas: LinhaAgregada[],
  mapa?: MapaClassificacao,
): { valores: ValoresPorGrupo; porGrupo: CategoriasPorGrupo } {
  const valores = valoresVazios();
  const porGrupo = Object.fromEntries(GRUPOS_DRE.map((g) => [g.key, [] as ItemCategoria[]])) as unknown as CategoriasPorGrupo;
  const itens = new Map<string, ItemCategoria & { grupo: GrupoDre }>();

  for (const l of linhas) {
    if (l.tipo !== "receita" && l.tipo !== "despesa") continue;
    const { grupo } = classificar(l.tipo, l.categoria, mapa);
    const previsto = Boolean(l.previsto);
    const chave = `${chaveClassificacao(l.tipo, l.categoria)}|${previsto ? "p" : "r"}`;
    const atual = itens.get(chave);
    if (atual) {
      atual.total += l.total;
      atual.quantidade += l.quantidade;
    } else {
      itens.set(chave, { categoria: l.categoria.trim(), total: l.total, quantidade: l.quantidade, previsto, grupo });
    }
    valores[grupo] += l.total;
  }

  for (const it of itens.values()) {
    porGrupo[it.grupo].push({ categoria: it.categoria, total: arred(it.total), quantidade: it.quantidade, previsto: it.previsto });
  }
  for (const g of GRUPOS_DRE) {
    valores[g.key] = arred(valores[g.key]);
    porGrupo[g.key].sort((a, b) => b.total - a.total);
  }
  return { valores, porGrupo };
}

// ─── A demonstração em si ───────────────────────────────────────────────────────

export interface Dre {
  grupos: ValoresPorGrupo;
  receitaBruta: number;
  deducoes: number;
  receitaLiquida: number;
  custos: number;
  lucroBruto: number;
  despesasOperacionais: number;
  resultadoOperacional: number;
  receitasFinanceiras: number;
  despesasFinanceiras: number;
  resultadoAntesImpostos: number;
  impostos: number;
  resultadoLiquido: number;
  investimentos: number;
  sobraCaixa: number;
  /** Tudo que sai antes de investimentos (deduções + custos + operacionais + financeiras + impostos). */
  totalSaidas: number;
  /** Margens em % da receita líquida; null quando não há receita líquida. */
  margemBruta: number | null;
  margemOperacional: number | null;
  margemLiquida: number | null;
}

export function montarDre(v: Partial<ValoresPorGrupo>): Dre {
  const grupos = valoresVazios();
  for (const g of GRUPOS_DRE) grupos[g.key] = arred(v[g.key] ?? 0);

  const receitaBruta = grupos.receita_operacional + grupos.receita_outras;
  const deducoes = grupos.deducoes;
  const receitaLiquida = receitaBruta - deducoes;
  const custos = grupos.custos;
  const lucroBruto = receitaLiquida - custos;
  const despesasOperacionais = DESPESAS_OPERACIONAIS.reduce((a, k) => a + grupos[k], 0);
  const resultadoOperacional = lucroBruto - despesasOperacionais;
  const receitasFinanceiras = grupos.receita_financeira;
  const despesasFinanceiras = grupos.financeiras;
  const resultadoAntesImpostos = resultadoOperacional + receitasFinanceiras - despesasFinanceiras;
  const impostos = grupos.impostos_resultado;
  const resultadoLiquido = resultadoAntesImpostos - impostos;
  const investimentos = grupos.investimentos;
  const sobraCaixa = resultadoLiquido - investimentos;
  const totalSaidas = deducoes + custos + despesasOperacionais + despesasFinanceiras + impostos;
  const margem = (x: number) => (receitaLiquida > 0 ? arred1((x / receitaLiquida) * 100) : null);

  return {
    grupos,
    receitaBruta: arred(receitaBruta),
    deducoes: arred(deducoes),
    receitaLiquida: arred(receitaLiquida),
    custos: arred(custos),
    lucroBruto: arred(lucroBruto),
    despesasOperacionais: arred(despesasOperacionais),
    resultadoOperacional: arred(resultadoOperacional),
    receitasFinanceiras: arred(receitasFinanceiras),
    despesasFinanceiras: arred(despesasFinanceiras),
    resultadoAntesImpostos: arred(resultadoAntesImpostos),
    impostos: arred(impostos),
    resultadoLiquido: arred(resultadoLiquido),
    investimentos: arred(investimentos),
    sobraCaixa: arred(sobraCaixa),
    totalSaidas: arred(totalSaidas),
    margemBruta: margem(lucroBruto),
    margemOperacional: margem(resultadoOperacional),
    margemLiquida: margem(resultadoLiquido),
  };
}

export type CampoDre = Exclude<keyof Dre, "grupos" | "totalSaidas" | "margemBruta" | "margemOperacional" | "margemLiquida">;

export interface LinhaEstrutura {
  campo: CampoDre;
  label: string;
  /** "" (receita bruta), "(−)", "(+)" ou "=" */
  prefixo: "" | "(−)" | "(+)" | "=";
  nivel: "grupo" | "subtotal" | "total";
  /** Grupos que compõem a linha — permite abrir e ver as categorias. */
  grupos?: readonly GrupoDre[];
  /** Margem que acompanha a linha (em % da receita líquida). */
  margem?: "margemBruta" | "margemOperacional" | "margemLiquida";
  /** Linha de saída: crescer é ruim (inverte a cor da variação). */
  saida: boolean;
}

/** Ordem e composição das linhas — a tabela, o CSV e os testes leem daqui. */
export const ESTRUTURA_DRE: readonly LinhaEstrutura[] = [
  { campo: "receitaBruta",           label: "Receita bruta",                    prefixo: "",    nivel: "subtotal", grupos: ["receita_operacional", "receita_outras"], saida: false },
  { campo: "deducoes",               label: "Deduções da receita",              prefixo: "(−)", nivel: "grupo",    grupos: ["deducoes"], saida: true },
  { campo: "receitaLiquida",         label: "Receita líquida",                  prefixo: "=",   nivel: "total",    saida: false },
  { campo: "custos",                 label: "Custos diretos",                   prefixo: "(−)", nivel: "grupo",    grupos: ["custos"], saida: true },
  { campo: "lucroBruto",             label: "Lucro bruto",                      prefixo: "=",   nivel: "total",    margem: "margemBruta", saida: false },
  { campo: "despesasOperacionais",   label: "Despesas operacionais",            prefixo: "(−)", nivel: "subtotal", grupos: DESPESAS_OPERACIONAIS, saida: true },
  { campo: "resultadoOperacional",   label: "Resultado operacional",            prefixo: "=",   nivel: "total",    margem: "margemOperacional", saida: false },
  { campo: "receitasFinanceiras",    label: "Receitas financeiras",             prefixo: "(+)", nivel: "grupo",    grupos: ["receita_financeira"], saida: false },
  { campo: "despesasFinanceiras",    label: "Despesas financeiras",             prefixo: "(−)", nivel: "grupo",    grupos: ["financeiras"], saida: true },
  { campo: "resultadoAntesImpostos", label: "Resultado antes dos impostos",     prefixo: "=",   nivel: "total",    saida: false },
  { campo: "impostos",               label: "Impostos sobre o resultado",       prefixo: "(−)", nivel: "grupo",    grupos: ["impostos_resultado"], saida: true },
  { campo: "resultadoLiquido",       label: "Resultado líquido",                prefixo: "=",   nivel: "total",    margem: "margemLiquida", saida: false },
  { campo: "investimentos",          label: "Investimentos e não operacionais", prefixo: "(−)", nivel: "grupo",    grupos: ["investimentos"], saida: true },
  { campo: "sobraCaixa",             label: "Sobra de caixa",                   prefixo: "=",   nivel: "total",    saida: false },
];

// ─── Análises ──────────────────────────────────────────────────────────────────

/** Análise vertical: participação da linha na receita líquida (%). */
export function analiseVertical(valor: number, receitaLiquida: number): number | null {
  return receitaLiquida > 0 ? arred1((valor / receitaLiquida) * 100) : null;
}

/** Análise horizontal: variação % sobre o período anterior. null = sem base. */
export function variacaoPct(atual: number, anterior: number): number | null {
  if (anterior === 0) return atual === 0 ? 0 : null;
  return Math.round(((atual - anterior) / Math.abs(anterior)) * 1000) / 10;
}

export interface PontoSerie {
  mes: string;
  label: string;
  receitaLiquida: number;
  saidas: number;
  resultadoLiquido: number;
  margemBruta: number | null;
  margemOperacional: number | null;
  margemLiquida: number | null;
}

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function labelMesCurto(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return `${MESES_CURTOS[m - 1]}/${String(y).slice(2)}`;
}

export function resumoDoMes(mes: string, dre: Dre): PontoSerie {
  return {
    mes,
    label: labelMesCurto(mes),
    receitaLiquida: dre.receitaLiquida,
    saidas: dre.totalSaidas,
    resultadoLiquido: dre.resultadoLiquido,
    margemBruta: dre.margemBruta,
    margemOperacional: dre.margemOperacional,
    margemLiquida: dre.margemLiquida,
  };
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtPct = (p: number) => `${Math.abs(p).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/** Leitura automática da DRE em frases curtas (sem LLM — regra pura). */
export function gerarInsights(args: { atual: Dre; anterior: Dre; serie: PontoSerie[]; rotuloAnterior: string }): string[] {
  const { atual, anterior, serie, rotuloAnterior } = args;
  const out: string[] = [];

  if (atual.receitaBruta === 0 && atual.totalSaidas === 0 && atual.investimentos === 0) {
    return ["Nenhum lançamento no período com os filtros atuais."];
  }

  if (atual.receitaLiquida <= 0) {
    out.push(`Sem receita líquida no período: todas as saídas (${BRL.format(atual.totalSaidas)}) viraram prejuízo.`);
  } else if (atual.resultadoLiquido >= 0) {
    const m = atual.margemLiquida ?? 0;
    out.push(
      `Resultado líquido positivo de ${BRL.format(atual.resultadoLiquido)} — margem de ${fmtPct(m)}: de cada R$ 100 de receita líquida sobraram ${BRL.format(m)}.`,
    );
    out.push(`Folga: a receita pode cair até ${fmtPct(m)} (${BRL.format(atual.resultadoLiquido)}) antes de dar prejuízo.`);
  } else {
    const excesso = (Math.abs(atual.resultadoLiquido) / atual.receitaLiquida) * 100;
    out.push(
      `Prejuízo de ${BRL.format(Math.abs(atual.resultadoLiquido))}: as saídas superaram a receita líquida em ${fmtPct(excesso)}. ` +
        `Para fechar no zero, a receita precisaria ser ${BRL.format(atual.receitaLiquida + Math.abs(atual.resultadoLiquido))} — ou cortar ${BRL.format(Math.abs(atual.resultadoLiquido))} de saídas.`,
    );
  }

  const saidas = GRUPOS_DRE
    .filter((g) => g.tipo === "despesa" && g.key !== "investimentos" && atual.grupos[g.key] > 0)
    .sort((a, b) => atual.grupos[b.key] - atual.grupos[a.key]);
  if (saidas.length > 0) {
    const maior = saidas[0];
    const av = analiseVertical(atual.grupos[maior.key], atual.receitaLiquida);
    const parte = atual.totalSaidas > 0 ? (atual.grupos[maior.key] / atual.totalSaidas) * 100 : 0;
    out.push(
      `Maior grupo de saída: ${maior.label} (${BRL.format(atual.grupos[maior.key])}, ${fmtPct(parte)} de tudo que saiu` +
        (av != null ? `, ${fmtPct(av)} da receita líquida).` : ").") ,
    );
  }

  if (atual.custos > 0 && atual.margemBruta != null) {
    out.push(`Margem bruta de ${fmtPct(atual.margemBruta)}: os custos diretos consomem ${fmtPct(100 - atual.margemBruta)} da receita líquida.`);
  }

  const temAnterior = anterior.receitaBruta > 0 || anterior.totalSaidas > 0;
  if (temAnterior) {
    const vr = variacaoPct(atual.receitaLiquida, anterior.receitaLiquida);
    if (vr != null && vr !== 0) {
      out.push(`Receita líquida ${vr > 0 ? "subiu" : "caiu"} ${fmtPct(vr)} vs ${rotuloAnterior} (${BRL.format(anterior.receitaLiquida)} → ${BRL.format(atual.receitaLiquida)}).`);
    }
    const dif = arred(atual.resultadoLiquido - anterior.resultadoLiquido);
    if (dif !== 0) {
      out.push(`Resultado líquido ${dif > 0 ? "melhorou" : "piorou"} ${BRL.format(Math.abs(dif))} vs ${rotuloAnterior} (${BRL.format(anterior.resultadoLiquido)} → ${BRL.format(atual.resultadoLiquido)}).`);
    }
  }

  const passados = serie.slice(0, -1).filter((p) => p.receitaLiquida > 0 || p.saidas > 0);
  if (passados.length >= 2) {
    const media = arred(passados.reduce((a, p) => a + p.resultadoLiquido, 0) / passados.length);
    out.push(
      `Média dos últimos ${passados.length} meses com movimento: resultado líquido de ${BRL.format(media)} — o período está ${atual.resultadoLiquido >= media ? "acima" : "abaixo"} da média.`,
    );
  }

  if (atual.investimentos > 0) {
    out.push(`Investimentos e não operacionais: ${BRL.format(atual.investimentos)} fora do resultado — sobra de caixa de ${BRL.format(atual.sobraCaixa)}.`);
  }

  return out;
}

// ─── Exportação CSV (Excel pt-BR: ponto e vírgula e vírgula decimal) ────────────

const csvNum = (n: number) => n.toFixed(2).replace(".", ",");
const csvPct = (p: number | null) => (p == null ? "" : p.toFixed(1).replace(".", ","));
const csvTxt = (s: string) => `"${s.replace(/"/g, '""')}"`;

export function dreParaCsv(args: {
  titulo: string;
  periodoLabel: string;
  anteriorLabel: string;
  atual: Dre;
  anterior: Dre;
  porGrupo: CategoriasPorGrupo;
}): string {
  const { titulo, periodoLabel, anteriorLabel, atual, anterior, porGrupo } = args;
  const linhas: string[] = [];
  linhas.push(csvTxt(titulo));
  linhas.push(["Linha", periodoLabel, "AV %", anteriorLabel, "Variação %"].map(csvTxt).join(";"));

  for (const l of ESTRUTURA_DRE) {
    const v = atual[l.campo];
    const a = anterior[l.campo];
    linhas.push([csvTxt(`${l.prefixo} ${l.label}`.trim()), csvNum(v), csvPct(analiseVertical(v, atual.receitaLiquida)), csvNum(a), csvPct(variacaoPct(v, a))].join(";"));
    if (l.margem && atual[l.margem] != null) {
      linhas.push([csvTxt(`   Margem (${l.label.toLowerCase()}) %`), csvPct(atual[l.margem]), "", csvPct(anterior[l.margem]), ""].join(";"));
    }
    if (!l.grupos) continue;
    for (const g of l.grupos) {
      if (l.grupos.length > 1) {
        linhas.push([csvTxt(`   ${grupoInfo(g).label}`), csvNum(atual.grupos[g]), csvPct(analiseVertical(atual.grupos[g], atual.receitaLiquida)), csvNum(anterior.grupos[g]), csvPct(variacaoPct(atual.grupos[g], anterior.grupos[g]))].join(";"));
      }
      for (const it of porGrupo[g]) {
        linhas.push([csvTxt(`      ${it.categoria}${it.previsto ? " (previsto)" : ""}`), csvNum(it.total), csvPct(analiseVertical(it.total, atual.receitaLiquida)), "", ""].join(";"));
      }
    }
  }
  return "﻿" + linhas.join("\r\n") + "\r\n";
}

// ─── Formato da resposta da API (compartilhado com a tela) ─────────────────────

export interface ItemClassificacao {
  tipo: TipoLancamento;
  categoria: string;
  chave: string;
  grupo: GrupoDre;
  origem: OrigemClassificacao;
  total: number;
  quantidade: number;
}

export interface RelatorioDre {
  periodo: { tipo: string; mes: string | null; de: string; ate: string; label: string };
  anterior: { label: string };
  competencia: { mesAtual: string; ehMesAtual: boolean };
  escopo: "todos" | "nexo" | "pessoal";
  /** Regime de caixa: só o que está no extrato. */
  realizado: { atual: Dre; anterior: Dre; porGrupo: CategoriasPorGrupo };
  /** Realizado + receitas previstas em aberto + contas a pagar pendentes do período. */
  projetado: {
    atual: Dre;
    porGrupo: CategoriasPorGrupo;
    previsto: { receitas: number; receitasQtd: number; despesas: number; despesasQtd: number };
  };
  /** Últimos 12 meses (realizado), terminando no mês do período. */
  serie: PontoSerie[];
  acumuladoAno: { ano: number; ate: string; meses: number; dre: Dre };
  classificacao: ItemClassificacao[];
  insights: string[];
}
