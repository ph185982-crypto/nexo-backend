// DRE gerencial (Demonstração do Resultado) do financeiro — funções puras,
// sem Prisma, usadas no servidor (API) e no navegador (tabela, gráficos, CSV).
//
// Regime de caixa: a DRE "realizada" soma o que está no extrato (Transacao).
// Cada LANÇAMENTO cai numa linha da DRE, nesta ordem de prioridade:
//   1. o lançamento foi movido à mão na aba DRE;
//   2. a categoria foi classificada à mão na aba DRE;
//   3. a descrição bate numa regra (ex.: "Salário da Layane" → Pessoal,
//      "Saneago" → Ocupação, "empréstimo com Fernando" → não operacional);
//   4. a categoria bate numa regra (ex.: "Assinaturas" → Tecnologia);
//   5. sobra: receita operacional / despesas administrativas.
// A descrição vem antes da categoria porque as categorias do extrato são
// genéricas ("Dívidas/Parcelas" guarda água, internet, cartão e até salário).
// Nenhum lançamento é alterado: só a leitura muda.

export type TipoLancamento = "receita" | "despesa";

export const GRUPOS_DRE = [
  { key: "receita_operacional",     tipo: "receita", label: "Receita operacional",              descricao: "Serviços, vendas, contratos e salário" },
  { key: "receita_outras",          tipo: "receita", label: "Outras receitas",                  descricao: "Reembolsos, prêmios e entradas eventuais" },
  { key: "receita_financeira",      tipo: "receita", label: "Receitas financeiras",             descricao: "Rendimentos, juros recebidos e cashback" },
  { key: "receita_nao_operacional", tipo: "receita", label: "Entradas não operacionais",        descricao: "Empréstimos recebidos, aportes, resgates e transferências — entram no caixa, não no resultado" },
  { key: "deducoes",                tipo: "despesa", label: "Deduções da receita",              descricao: "Impostos sobre vendas (DAS), taxas de plataforma e devoluções" },
  { key: "custos",                  tipo: "despesa", label: "Custos diretos",                   descricao: "Mercadorias, fornecedores, frete e insumos da entrega" },
  { key: "pessoal",                 tipo: "despesa", label: "Pessoal",                          descricao: "Salários, pró-labore, freelancers e encargos" },
  { key: "marketing",               tipo: "despesa", label: "Marketing e vendas",               descricao: "Anúncios, tráfego pago e comissões" },
  { key: "tecnologia",              tipo: "despesa", label: "Tecnologia e assinaturas",         descricao: "Software, internet, telefone e hospedagem" },
  { key: "ocupacao",                tipo: "despesa", label: "Ocupação e utilidades",            descricao: "Aluguel, condomínio, água, luz e moradia" },
  { key: "administrativas",         tipo: "despesa", label: "Administrativas e gerais",         descricao: "Contabilidade, escritório e o que não tem grupo próprio" },
  { key: "pessoais",                tipo: "despesa", label: "Dia a dia e pessoais",             descricao: "Alimentação, transporte, saúde, lazer e vestuário" },
  { key: "financeiras",             tipo: "despesa", label: "Despesas financeiras",             descricao: "Juros, multas, IOF, tarifas e anuidades" },
  { key: "impostos_resultado",      tipo: "despesa", label: "Impostos sobre o resultado",       descricao: "IRPJ, CSLL e imposto de renda" },
  { key: "dividas",                 tipo: "despesa", label: "Pagamento de dívidas e cartões",   descricao: "Faturas de cartão, parcelas de financiamento e empréstimos pagos — saem do caixa, não do resultado" },
  { key: "investimentos",           tipo: "despesa", label: "Investimentos",                    descricao: "Equipamentos, aplicações, reservas e aportes" },
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

// ─── Regras por palavra-chave (sempre sobre o texto normalizado) ───────────────

type Regras = ReadonlyArray<readonly [RegExp, GrupoDre]>;

// Descrição do lançamento — só termos inequívocos; a primeira que bater vence.
const DESCRICAO_RECEITA: Regras = [
  [/emprestimo|emprestad|aporte|resgate|transferencia (entre|de conta|propria)|devolucao de emprestimo/, "receita_nao_operacional"],
  [/rendiment|juros|dividend|cashback/, "receita_financeira"],
  [/reembols|estorno/, "receita_outras"],
];

const DESCRICAO_DESPESA: Regras = [
  [/\bjuros\b|\bmulta\b|\biof\b|tarifa|anuidade/, "financeiras"],
  [/salari|pro[- ]?labore|freela|diaria|folha de pagamento|\binss\b|\bfgts\b/, "pessoal"],
  [/trafego|anuncio|\bads\b|impulsion|patrocin|influenc/, "marketing"],
  [/saneago|sabesp|copasa|equatorial|\benel\b|cemig|copel|celesc|energia|\bluz\b|conta de agua|^agua\b|\bagua\b|condomin|aluguel|iptu|\bgas\b/, "ocupacao"],
  [/internet|telefone|celular (plano|conta)|plano (de )?celular|\bvivo\b|\bclaro\b|\btim\b|hospedag|dominio|claude|chatgpt|openai|anthropic|vercel|google workspace|canva|notion|assinatura/, "tecnologia"],
  [/gasolina|etanol|combustiv|\buber\b|\b99\b|pedagio|estacionamento|detran|ipva|licenciamento|onibus|passagem/, "pessoais"],
  [/fatura|\bcartao\b|parcela|financiamento|emprestimo|consorcio|\bmrv\b|acordo|divida/, "dividas"],
  [/investiment|aplicac|poupanc|\bcdb\b|tesouro|cripto|bitcoin|reserva de emergencia/, "investimentos"],
];

// Categoria — usada quando a descrição não diz nada específico.
const CATEGORIA_RECEITA: Regras = [
  [/rendiment|juros|invest|dividend|cashback|aplicac|poupanc|\bcdb\b|tesouro|rentabil/, "receita_financeira"],
  [/emprestimo|aporte|transferencia/, "receita_nao_operacional"],
  [/\boutr|reembols|presente|premi|eventual|doac|venda de (bem|item|usado)/, "receita_outras"],
];

const CATEGORIA_DESPESA: Regras = [
  [/\birpf\b|\birpj\b|\bcsll\b|imposto de renda|\bir\b/, "impostos_resultado"],
  [/impost|tribut|^das\b|\bdas[- ]?(mei|simples)\b|simples nacional|\bmei\b|taxa de venda|taxa d[aeo]s? (marketplace|plataforma|shopee|mercado livre)|devolu|estorno|nota fiscal|\bnf\b|\biss\b|\bicms\b|\bpis\b|cofins/, "deducoes"],
  [/custo|\bcmv\b|mercadoria|fornecedor|frete|embalag|insumo|materia[- ]prima|\bproduto/, "custos"],
  [/salari|pro[- ]?labore|freelanc|funcionari|folha|\binss\b|\bfgts\b|encargo|terceiriz|colaborador|\brh\b|vale[- ]/, "pessoal"],
  [/marketing|anunci|\bads\b|trafego|\bmidia\b|publicidad|propaganda|impulsion|patrocin|comiss|influenc/, "marketing"],
  [/assinatur|software|\bsaas\b|internet|telefon|celular|hospedag|dominio|ferramenta|tecnolog|\bapi\b|nuvem|cloud|streaming|\bchip\b/, "tecnologia"],
  [/moradia|\bcasa\b|aluguel|condomin|\bagua\b|\bluz\b|energia|\bgas\b|iptu|escritori|coworking|\bsala\b|limpeza|manutencao/, "ocupacao"],
  [/juros|tarifa|\biof\b|multa|anuidade|\bbanco\b/, "financeiras"],
  [/divida|parcela|emprestimo|financiamento|cartao|consorcio|cheque/, "dividas"],
  [/alimenta|\bmercado\b(?! livre)|supermercado|restaurante|ifood|lanche|padaria|lazer|vestuari|roupa|saude|farmac|medic|academia|beleza|barbe|salao|\bpet\b|educa|curso|escola|faculdade|viagem|presente|transporte|combustiv|gasolina|\buber\b|\b99\b|estacionamento|pedagio|onibus|\bcarro\b|\bmoto\b|cinema/, "pessoais"],
  [/investimento|aplicac|reserva|poupanc|\bcdb\b|tesouro|\bacoes\b|cripto|bitcoin|equipamento|maquina|computador|notebook|aporte/, "investimentos"],
];

function aplicar(regras: Regras, texto: string): GrupoDre | null {
  for (const [re, grupo] of regras) if (re.test(texto)) return grupo;
  return null;
}

/** Linha da DRE só pela categoria (padrão do editor de categorias). */
export function classificarPadrao(tipo: TipoLancamento, categoria: string): GrupoDre {
  const g = aplicar(tipo === "receita" ? CATEGORIA_RECEITA : CATEGORIA_DESPESA, chaveCategoria(categoria));
  return g ?? (tipo === "receita" ? "receita_operacional" : "administrativas");
}

/** Linha da DRE pela descrição do lançamento — null quando ela não diz nada específico. */
export function classificarPorDescricao(tipo: TipoLancamento, descricao: string | null | undefined): GrupoDre | null {
  if (!descricao) return null;
  return aplicar(tipo === "receita" ? DESCRICAO_RECEITA : DESCRICAO_DESPESA, chaveCategoria(descricao));
}

/**
 * Mapa de classificações manuais:
 *  • `${tipo}|${chaveCategoria}`          → grupo de uma categoria inteira
 *  • `${tipo}|#l:${idDoLancamento}`       → grupo de um lançamento específico
 */
export type MapaClassificacao = ReadonlyMap<string, GrupoDre>;

export const PREFIXO_LANCAMENTO = "#l:";
export const chaveLancamento = (id: string) => `${PREFIXO_LANCAMENTO}${id}`;

export type OrigemLancamento = "lancamento" | "categoria" | "descricao" | "padrao";

/** Classificação de uma categoria inteira (editor de categorias). */
export function classificar(
  tipo: TipoLancamento,
  categoria: string,
  mapa?: MapaClassificacao,
): { grupo: GrupoDre; origem: OrigemClassificacao } {
  const manual = mapa?.get(chaveClassificacao(tipo, categoria));
  if (manual && grupoInfo(manual).tipo === tipo) return { grupo: manual, origem: "manual" };
  return { grupo: classificarPadrao(tipo, categoria), origem: "padrao" };
}

/** Classificação de um lançamento — a regra completa (ver topo do arquivo). */
export function classificarLancamento(
  l: { tipo: TipoLancamento; categoria: string; descricao?: string | null; id?: string | null },
  mapa?: MapaClassificacao,
): { grupo: GrupoDre; origem: OrigemLancamento } {
  const doTipo = (g: GrupoDre | undefined | null): g is GrupoDre => !!g && grupoInfo(g).tipo === l.tipo;
  const doLancamento = l.id ? mapa?.get(`${l.tipo}|${chaveLancamento(l.id)}`) : undefined;
  if (doTipo(doLancamento)) return { grupo: doLancamento, origem: "lancamento" };
  const daCategoria = mapa?.get(chaveClassificacao(l.tipo, l.categoria));
  if (doTipo(daCategoria)) return { grupo: daCategoria, origem: "categoria" };
  const daDescricao = classificarPorDescricao(l.tipo, l.descricao);
  if (daDescricao) return { grupo: daDescricao, origem: "descricao" };
  return { grupo: classificarPadrao(l.tipo, l.categoria), origem: "padrao" };
}

// ─── Agrupamento das linhas do extrato nos grupos da DRE ────────────────────────

export interface LinhaAgregada {
  tipo: TipoLancamento;
  categoria: string;
  total: number;
  quantidade: number;
  /** true = ainda não aconteceu (receita prevista em aberto / conta a pagar pendente) */
  previsto?: boolean;
  /** Presentes quando a linha é um lançamento só (permite classificar pela descrição e mover). */
  id?: string;
  descricao?: string | null;
  data?: string;
}

export interface ItemLancamento {
  id: string | null;
  descricao: string;
  data: string | null;
  valor: number;
  origem: OrigemLancamento;
  previsto: boolean;
}

export interface ItemCategoria {
  categoria: string;
  total: number;
  quantidade: number;
  previsto: boolean;
  /** Lançamentos desta categoria que caíram neste grupo (maiores primeiro). */
  lancamentos: ItemLancamento[];
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
    const { grupo, origem } = classificarLancamento(l, mapa);
    const previsto = Boolean(l.previsto);
    const chave = `${grupo}|${chaveClassificacao(l.tipo, l.categoria)}|${previsto ? "p" : "r"}`;
    let it = itens.get(chave);
    if (!it) {
      it = { categoria: l.categoria.trim(), total: 0, quantidade: 0, previsto, grupo, lancamentos: [] };
      itens.set(chave, it);
    }
    it.total += l.total;
    it.quantidade += l.quantidade;
    if (l.descricao != null || l.id) {
      it.lancamentos.push({ id: l.id ?? null, descricao: (l.descricao ?? "").trim() || l.categoria, data: l.data ?? null, valor: arred(l.total), origem, previsto });
    }
    valores[grupo] += l.total;
  }

  for (const it of itens.values()) {
    it.lancamentos.sort((a, b) => b.valor - a.valor);
    porGrupo[it.grupo].push({ categoria: it.categoria, total: arred(it.total), quantidade: it.quantidade, previsto: it.previsto, lancamentos: it.lancamentos });
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
  /** Abaixo do resultado: amortização de dívidas, investimentos e entradas não operacionais. */
  dividas: number;
  investimentos: number;
  entradasNaoOperacionais: number;
  sobraCaixa: number;
  /** Tudo que entra no resultado como saída (deduções + custos + operacionais + financeiras + impostos). */
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
  const dividas = grupos.dividas;
  const investimentos = grupos.investimentos;
  const entradasNaoOperacionais = grupos.receita_nao_operacional;
  const sobraCaixa = resultadoLiquido - dividas - investimentos + entradasNaoOperacionais;
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
    dividas: arred(dividas),
    investimentos: arred(investimentos),
    entradasNaoOperacionais: arred(entradasNaoOperacionais),
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
  { campo: "dividas",                label: "Pagamento de dívidas e cartões",   prefixo: "(−)", nivel: "grupo",    grupos: ["dividas"], saida: true },
  { campo: "investimentos",          label: "Investimentos",                    prefixo: "(−)", nivel: "grupo",    grupos: ["investimentos"], saida: true },
  { campo: "entradasNaoOperacionais", label: "Entradas não operacionais",       prefixo: "(+)", nivel: "grupo",    grupos: ["receita_nao_operacional"], saida: false },
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

  if (atual.receitaBruta === 0 && atual.totalSaidas === 0 && atual.investimentos === 0 && atual.dividas === 0 && atual.entradasNaoOperacionais === 0) {
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
    .filter((g) => g.tipo === "despesa" && g.key !== "investimentos" && g.key !== "dividas" && atual.grupos[g.key] > 0)
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

  const foraDoResultado: string[] = [];
  if (atual.dividas > 0) foraDoResultado.push(`${BRL.format(atual.dividas)} em dívidas e cartões`);
  if (atual.investimentos > 0) foraDoResultado.push(`${BRL.format(atual.investimentos)} em investimentos`);
  if (atual.entradasNaoOperacionais > 0) foraDoResultado.push(`${BRL.format(atual.entradasNaoOperacionais)} de entradas não operacionais (empréstimos, aportes)`);
  if (foraDoResultado.length > 0) {
    out.push(`Fora do resultado, mas no caixa: ${foraDoResultado.join(", ")} — sobra de caixa de ${BRL.format(atual.sobraCaixa)}.`);
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
