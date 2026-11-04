// Contrato de uma automação: gatilho → critérios (todos precisam valer) → ações em sequência, cada uma com espera opcional.
import { ErroEntrada, escolha, texto, textoOpc } from "@/lib/validar";
import { PRIORIDADES, TIPOS_TAREFA } from "@/lib/atividades/constantes";
import { PILARES } from "@/lib/entrega/constantes";

export const GATILHOS = [
  "OPORTUNIDADE_CRIADA", "OPORTUNIDADE_MOVIDA", "OPORTUNIDADE_GANHA", "OPORTUNIDADE_PERDIDA", "OPORTUNIDADE_ESTAGNADA", "OPORTUNIDADE_SEM_INTERACAO",
  "ENTREGA_CARTAO_ATRASADO", "ENTREGA_AGUARDANDO_CLIENTE", "ENTREGA_EM_RISCO", "ENTREGA_RENOVACAO_PROXIMA", "ENTREGA_CARTAO_CONCLUIDO", "ENTREGA_CONCLUIDA",
] as const;
export type Gatilho = (typeof GATILHOS)[number];
export const ROTULO_GATILHO: Record<Gatilho, string> = {
  OPORTUNIDADE_CRIADA: "Oportunidade criada", OPORTUNIDADE_MOVIDA: "Oportunidade mudou de etapa", OPORTUNIDADE_GANHA: "Oportunidade ganha",
  OPORTUNIDADE_PERDIDA: "Oportunidade perdida", OPORTUNIDADE_ESTAGNADA: "Parada na etapa", OPORTUNIDADE_SEM_INTERACAO: "Sem interação",
  ENTREGA_CARTAO_ATRASADO: "Entrega: cartão atrasado", ENTREGA_AGUARDANDO_CLIENTE: "Entrega: aguardando o cliente",
  ENTREGA_EM_RISCO: "Entrega: cliente em risco", ENTREGA_RENOVACAO_PROXIMA: "Entrega: renovação chegando",
  ENTREGA_CARTAO_CONCLUIDO: "Entrega: cartão concluído", ENTREGA_CONCLUIDA: "Entrega concluída",
};
/** Gatilhos de tempo: não há evento, a varredura agendada procura o que se encaixa. */
export const GATILHOS_DE_TEMPO: readonly Gatilho[] = ["OPORTUNIDADE_ESTAGNADA", "OPORTUNIDADE_SEM_INTERACAO", "ENTREGA_CARTAO_ATRASADO", "ENTREGA_AGUARDANDO_CLIENTE", "ENTREGA_EM_RISCO", "ENTREGA_RENOVACAO_PROXIMA"];
/** Gatilhos do funil de entrega. As ações agem sobre a oportunidade ganha que abriu a entrega. */
export const GATILHOS_DE_ENTREGA: readonly Gatilho[] = ["ENTREGA_CARTAO_ATRASADO", "ENTREGA_AGUARDANDO_CLIENTE", "ENTREGA_EM_RISCO", "ENTREGA_RENOVACAO_PROXIMA", "ENTREGA_CARTAO_CONCLUIDO", "ENTREGA_CONCLUIDA"];
/** Gatilhos de entrega que falam de um cartão (os outros falam da entrega inteira). */
export const GATILHOS_DE_CARTAO: readonly Gatilho[] = ["ENTREGA_CARTAO_ATRASADO", "ENTREGA_AGUARDANDO_CLIENTE", "ENTREGA_CARTAO_CONCLUIDO"];
export const ehGatilhoDeEntrega = (g: string) => (GATILHOS_DE_ENTREGA as readonly string[]).includes(g);

export const CAMPOS = [
  "etapaId", "funilId", "probabilidade", "origem", "valorTotal", "tag", "diasNaEtapa", "diasSemAtividade", "semResponsavel",
  "notaSaude", "diasParaRenovar", "pilar", "diasDeAtraso", "diasAguardandoCliente", "cartaoDoCliente",
] as const;
export type Campo = (typeof CAMPOS)[number];
export const ROTULO_CAMPO: Record<Campo, string> = {
  etapaId: "Etapa", funilId: "Funil", probabilidade: "Probabilidade", origem: "Origem", valorTotal: "Valor total (R$)", tag: "Tag",
  diasNaEtapa: "Dias na etapa", diasSemAtividade: "Dias sem atividade", semResponsavel: "Sem responsável",
  notaSaude: "Nota de saúde da entrega (0–100)", diasParaRenovar: "Dias para a renovação", pilar: "Pilar do cartão",
  diasDeAtraso: "Dias de atraso do cartão", diasAguardandoCliente: "Dias aguardando o cliente", cartaoDoCliente: "Cartão depende do cliente",
};
/** Campos que só existem em gatilhos de entrega (da entrega inteira) e só em gatilhos de cartão. */
export const CAMPOS_DE_ENTREGA: readonly Campo[] = ["notaSaude", "diasParaRenovar"];
export const CAMPOS_DE_CARTAO: readonly Campo[] = ["pilar", "diasDeAtraso", "diasAguardandoCliente", "cartaoDoCliente"];
/** Campos que o formulário oferece para o gatilho escolhido. */
export function camposDoGatilho(g: Gatilho): Campo[] {
  if (!ehGatilhoDeEntrega(g)) return CAMPOS.filter((c) => !CAMPOS_DE_ENTREGA.includes(c) && !CAMPOS_DE_CARTAO.includes(c));
  return CAMPOS.filter((c) => !CAMPOS_DE_CARTAO.includes(c) || (GATILHOS_DE_CARTAO as readonly string[]).includes(g));
}
export type Operador = "=" | "!=" | ">=" | "<=";
export const OPERADORES_DO_CAMPO: Record<Campo, readonly Operador[]> = {
  etapaId: ["=", "!="], funilId: ["=", "!="], probabilidade: ["=", "!="], origem: ["=", "!="], tag: ["=", "!="],
  valorTotal: [">=", "<=", "="], diasNaEtapa: [">=", "<="], diasSemAtividade: [">=", "<="], semResponsavel: ["="],
  notaSaude: ["<=", ">="], diasParaRenovar: ["<=", ">="], pilar: ["=", "!="], diasDeAtraso: [">=", "<="], diasAguardandoCliente: [">=", "<="], cartaoDoCliente: ["="],
};
export const CAMPOS_NUMERICOS: readonly Campo[] = ["valorTotal", "diasNaEtapa", "diasSemAtividade", "notaSaude", "diasParaRenovar", "diasDeAtraso", "diasAguardandoCliente"];
export const CAMPOS_SIM_NAO: readonly Campo[] = ["semResponsavel", "cartaoDoCliente"];
const NUMERICOS = CAMPOS_NUMERICOS;
/** Textos das ações aceitam estas marcas, trocadas na hora de executar. */
export const MARCAS_DE_TEXTO = ["{cliente}", "{oportunidade}", "{entrega}", "{cartao}", "{dias}"] as const;

export interface Criterio { campo: Campo; operador: Operador; valor: string | number | boolean }

export const TIPOS_ACAO = ["CRIAR_TAREFA", "MOVER_ETAPA", "ADICIONAR_TAG", "REGISTRAR_ALERTA", "DISPARAR_WEBHOOK"] as const;
export type TipoAcao = (typeof TIPOS_ACAO)[number];
export const ROTULO_ACAO: Record<TipoAcao, string> = { CRIAR_TAREFA: "Criar tarefa", MOVER_ETAPA: "Mover de etapa", ADICIONAR_TAG: "Adicionar tag", REGISTRAR_ALERTA: "Registrar alerta na linha do tempo", DISPARAR_WEBHOOK: "Chamar um endereço (webhook)" };

export type Acao =
  | { tipo: "CRIAR_TAREFA"; titulo: string; prazoHoras: number; prioridade: string; tipoTarefa: string; esperaHoras: number }
  | { tipo: "MOVER_ETAPA"; etapaId: string; esperaHoras: number }
  | { tipo: "ADICIONAR_TAG"; tag: string; esperaHoras: number }
  | { tipo: "REGISTRAR_ALERTA"; mensagem: string; esperaHoras: number }
  | { tipo: "DISPARAR_WEBHOOK"; url: string; esperaHoras: number };

export const MAX_AUTOMACOES_ATIVAS = 100;
export const MAX_ACOES = 10;
export const MAX_CRITERIOS = 10;
const MAX_ESPERA_HORAS = 24 * 365;

const inteiro = (v: unknown, campo: string, min: number, max: number, padrao: number): number => {
  if (v === undefined || v === null || v === "") return padrao;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ErroEntrada(`${campo} deve ser um inteiro entre ${min} e ${max}`);
  return n;
};

export function normalizarTag(t: string): string {
  return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export function validarCriterio(c: unknown): Criterio {
  const o = (c ?? {}) as Record<string, unknown>;
  const campo = escolha(o.campo, "campo do critério", CAMPOS);
  const operador = escolha(o.operador, "operador do critério", OPERADORES_DO_CAMPO[campo]);
  if (CAMPOS_SIM_NAO.includes(campo)) return { campo, operador, valor: o.valor === true || o.valor === "true" };
  if ((NUMERICOS as readonly string[]).includes(campo)) {
    const n = Number(o.valor);
    if (o.valor === "" || o.valor === null || o.valor === undefined || !Number.isFinite(n) || n < 0 || n > 1e12) throw new ErroEntrada(`valor de "${ROTULO_CAMPO[campo]}" deve ser um número`);
    return { campo, operador, valor: n };
  }
  if (campo === "pilar") return { campo, operador, valor: escolha(o.valor, "pilar do cartão", PILARES) };
  return { campo, operador, valor: texto(o.valor, `valor de "${ROTULO_CAMPO[campo]}"`, { min: 1, max: 100 }) };
}

export function validarAcao(a: unknown): Acao {
  const o = (a ?? {}) as Record<string, unknown>;
  const tipo = escolha(o.tipo, "tipo da ação", TIPOS_ACAO);
  const esperaHoras = inteiro(o.esperaHoras, "Espera (horas)", 0, MAX_ESPERA_HORAS, 0);
  switch (tipo) {
    case "CRIAR_TAREFA":
      return { tipo, titulo: texto(o.titulo, "Título da tarefa", { min: 1, max: 200 }), prazoHoras: inteiro(o.prazoHoras, "Prazo da tarefa (horas)", 0, MAX_ESPERA_HORAS, 24), prioridade: escolha(o.prioridade, "prioridade", PRIORIDADES, "NORMAL"), tipoTarefa: escolha(o.tipoTarefa, "tipo da tarefa", TIPOS_TAREFA, "TAREFA"), esperaHoras };
    case "MOVER_ETAPA":
      return { tipo, etapaId: texto(o.etapaId, "Etapa de destino", { min: 1, max: 60 }), esperaHoras };
    case "ADICIONAR_TAG": {
      const tag = normalizarTag(texto(o.tag, "Tag", { min: 1, max: 40 }));
      if (!tag) throw new ErroEntrada("Tag inválida");
      return { tipo, tag, esperaHoras };
    }
    case "REGISTRAR_ALERTA":
      return { tipo, mensagem: texto(o.mensagem, "Mensagem do alerta", { min: 1, max: 500 }), esperaHoras };
    case "DISPARAR_WEBHOOK": {
      const url = texto(o.url, "Endereço do webhook", { min: 1, max: 500 });
      let u: URL;
      try { u = new URL(url); } catch { throw new ErroEntrada("Endereço do webhook inválido"); }
      if (u.protocol !== "https:") throw new ErroEntrada("O webhook precisa usar https");
      if (u.username || u.password) throw new ErroEntrada("O endereço do webhook não pode ter usuário e senha");
      return { tipo, url: u.toString(), esperaHoras };
    }
  }
}

/** Critério obrigatório de cada gatilho de tempo (sem ele a automação valeria para tudo). */
export const criterioExigido = (g: Gatilho): { campo: Campo; operador: Operador } | null => EXIGIDO[g] ?? null;
const EXIGIDO: Partial<Record<Gatilho, { campo: Campo; operador: Operador }>> = {
  OPORTUNIDADE_ESTAGNADA: { campo: "diasNaEtapa", operador: ">=" },
  OPORTUNIDADE_SEM_INTERACAO: { campo: "diasSemAtividade", operador: ">=" },
  ENTREGA_AGUARDANDO_CLIENTE: { campo: "diasAguardandoCliente", operador: ">=" },
  ENTREGA_RENOVACAO_PROXIMA: { campo: "diasParaRenovar", operador: "<=" },
};

export interface AutomacaoValidada { nome: string; descricao: string | null; ativo: boolean; gatilho: Gatilho; criterios: Criterio[]; acoes: Acao[] }

export function validarAutomacao(corpo: unknown): AutomacaoValidada {
  const o = (corpo ?? {}) as Record<string, unknown>;
  const gatilho = escolha(o.gatilho, "gatilho", GATILHOS);
  const criterios = (Array.isArray(o.criterios) ? o.criterios : []).map(validarCriterio);
  const acoes = (Array.isArray(o.acoes) ? o.acoes : []).map(validarAcao);
  if (criterios.length > MAX_CRITERIOS) throw new ErroEntrada(`No máximo ${MAX_CRITERIOS} critérios`);
  if (acoes.length === 0) throw new ErroEntrada("Inclua ao menos uma ação");
  if (acoes.length > MAX_ACOES) throw new ErroEntrada(`No máximo ${MAX_ACOES} ações`);
  // Gatilho de tempo sem limite de dias dispararia para tudo que está em andamento.
  const exigido = EXIGIDO[gatilho];
  if (exigido && !criterios.some((c) => c.campo === exigido.campo && c.operador === exigido.operador)) {
    throw new ErroEntrada(`${ROTULO_GATILHO[gatilho]} exige o critério "${ROTULO_CAMPO[exigido.campo]}" com "${exigido.operador === ">=" ? "≥" : "≤"}"`);
  }
  const permitidos = camposDoGatilho(gatilho);
  const fora = criterios.find((c) => !permitidos.includes(c.campo));
  if (fora) throw new ErroEntrada(`O critério "${ROTULO_CAMPO[fora.campo]}" não vale para o gatilho "${ROTULO_GATILHO[gatilho]}"`);
  return { nome: texto(o.nome, "Nome", { min: 1, max: 120 }), descricao: textoOpc(o.descricao, "Descrição", 1000), ativo: o.ativo !== false, gatilho, criterios, acoes };
}
