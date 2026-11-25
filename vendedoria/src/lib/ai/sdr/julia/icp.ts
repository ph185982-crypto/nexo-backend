// Regras de qualificação da Júlia — no código, não no prompt (o modelo só ajuda a ler as respostas).
//
//  • QUALIFICADO = tem loja física OU fábrica/atacado com estoque próprio E tem CNPJ ativo. Faturamento não elimina.
//  • MORNO       = tem loja/estoque, sem CNPJ.
//  • FORA        = não tem loja nem estoque próprio (começando, afiliado, revenda sem estoque, ideia).
//  • PENDENTE    = ainda não respondeu o necessário.
// Faturamento é o ATUAL, por faixa; grava o ponto médio no Lead e a resposta original na sessão.
import { parseFaturamentoMensal } from "../qualificacao";
import { sem } from "./roteiro";
import type { SDRSession } from "../types";

export type Icp = "QUALIFICADO" | "MORNO" | "FORA" | "PENDENTE";

/** 1) até 20 mil  2) 20–50 mil  3) 50–100 mil  4) acima de 100 mil;  0 = não quis dizer. */
export type Faixa = 0 | 1 | 2 | 3 | 4;
export const PONTO_MEDIO: Record<Exclude<Faixa, 0>, number> = { 1: 10_000, 2: 35_000, 3: 75_000, 4: 150_000 };
export const ROTULO_FAIXA: Record<Faixa, string> = { 0: "não informou", 1: "até 20 mil", 2: "20 a 50 mil", 3: "50 a 100 mil", 4: "acima de 100 mil" };
export const FATURAMENTO_PRIORIDADE = 50_000;

const SIM = /^(sim|s|tenho|temos|tem|possuo|possui|claro|com certeza|isso|uhum|aham|yes|ss|sim tenho|tenho sim|temos sim|tem sim|positivo)\b/;
const NAO = /^(nao|n|nada|nenhum|nenhuma|ainda nao|nunca|negativo|nao tenho|nao temos|ainda nao tenho|nem|sem)\b/;

function limpa(t: string): string {
  return sem(t).replace(/[‎‏​]/g, "").replace(/[!.,;:?)(]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Resposta curta de sim/não (null se não dá pra saber). */
export function simOuNao(texto: string): boolean | null {
  const t = limpa(texto);
  if (!t) return null;
  if (NAO.test(t)) return false;
  if (SIM.test(t)) return true;
  return null;
}

/** Faixa de faturamento a partir da resposta (número da lista, texto da faixa ou valor). null = não deu pra ler. */
export function lerFaixa(texto: string): Faixa | null {
  const t = limpa(texto);
  if (!t) return null;
  if (/^(prefiro nao|nao sei|nao quero|nao vou dizer|sem comentario|depende|varia)/.test(t)) return 0;
  const so = t.match(/^(?:opcao |opção |a |o )?([1-4])(?:\s|$|\))/);
  if (so) return Number(so[1]) as Faixa;
  if (/acima de 100|mais de 100|\b(1|um) milh|milh(ao|oes)|> ?100/.test(t)) return 4;
  if (/50 a 100|50 e 100|entre 50/.test(t)) return 3;
  if (/20 a 50|20 e 50|entre 20/.test(t)) return 2;
  if (/ate 20|menos de 20|abaixo de 20|nao fatur|ainda nao vend|zero|nada ainda/.test(t)) return 1;
  const v = parseFaturamentoMensal(texto);
  if (v === null) return null;
  return faixaDoValor(v);
}

export function faixaDoValor(v: number): Exclude<Faixa, 0> {
  if (v <= 20_000) return 1;
  if (v <= 50_000) return 2;
  if (v <= 100_000) return 3;
  return 4;
}

/** Tem loja física ou estoque próprio (fábrica/atacado)? Lê a sessão, sem chutar. */
export function lojaOuEstoque(s: Pick<SDRSession, "loja_fisica" | "tem_loja_fisica">): boolean | null {
  if (s.loja_fisica === "sim") return true;
  if (s.loja_fisica === "nao") return false;
  return null;
}

export function cnpjAtivo(s: Pick<SDRSession, "cnpj">): boolean | null {
  const t = limpa(s.cnpj ?? "");
  if (!t) return null;
  if (/(nao tem|nao tenho|sem cnpj|^nao\b|ainda nao|vou abrir|vai regularizar|em abertura|nao possui)/.test(t)) return false;
  if (/^(tem|tenho|sim|ativo|mei|ltda|eireli|slu|me\b|epp)/.test(t) || t.replace(/\D/g, "").length === 14) return true;
  return null;
}

export function classificar(s: SDRSession): Icp {
  const loja = lojaOuEstoque(s);
  if (loja === false) return "FORA";
  const cnpj = cnpjAtivo(s);
  if (loja === true && cnpj === true) return "QUALIFICADO";
  if (loja === true && cnpj === false) return "MORNO";
  return "PENDENTE";
}

export type Pergunta = "loja" | "cnpj" | "faturamento";

/** Próxima pergunta do roteiro (só as que faltam, uma por vez). null = nada a perguntar. */
export function proximaPergunta(s: SDRSession): Pergunta | null {
  if (lojaOuEstoque(s) === null) return "loja";
  if (lojaOuEstoque(s) === false) return null;
  if (cnpjAtivo(s) === null) return "cnpj";
  if (cnpjAtivo(s) === false) return null;
  if (s.faixa_faturamento === undefined && !s.faturamento_perguntado) return "faturamento";
  return null;
}

/** Faturamento a gravar no Lead (ponto médio da faixa), ou null. Nunca grava meta/esperado. */
export function faturamentoParaLead(s: SDRSession): number | null {
  const f = s.faixa_faturamento;
  return f && f > 0 ? PONTO_MEDIO[f as Exclude<Faixa, 0>] : null;
}

export function ehPrioridade(s: SDRSession): boolean {
  return (faturamentoParaLead(s) ?? 0) >= FATURAMENTO_PRIORIDADE;
}
