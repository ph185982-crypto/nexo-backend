// Fluxo rápido do SDR: coletar → qualificar → ligação com o Pedro. O prompt pede,
// mas o modelo se distraía com perguntas fora do roteiro (ex.: "experiência em
// marketplace") mesmo com o lead já qualificado — e o lead esfriava. Aqui o
// código escolhe a próxima pergunta, juntando até 2 itens pendentes numa só.

import type { Slot } from "@/lib/agenda/slots";
import type { ItemHandoff } from "./handoff-gate";

const FRAGMENTO: Record<ItemHandoff, string> = {
  nome: "qual seu nome",
  empresa: "qual o nome da empresa ou loja",
  segmento: "o que você vende",
  dor: "o que mais trava suas vendas hoje",
  faturamento: "mais ou menos quanto o negócio fatura por mês",
  loja_fisica: "se você tem loja física",
  cnpj: "se a empresa tem CNPJ",
  horario: "qual o melhor dia e horário pra uma ligação de 20 min com o Pedro, nosso fundador",
};

/** Maiúscula inicial + interrogação. */
function frase(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1) + "?";
}

/** Uma única pergunta natural cobrindo os 1–2 primeiros itens que faltam. */
export function perguntaCombinada(pendentes: ItemHandoff[], slots: Slot[] = []): string {
  if (pendentes.length === 0) return "";
  const [a, b] = pendentes;
  if (a === "horario") {
    return slots.length >= 2
      ? `Fechou. Qual fica melhor pra uma ligação de 20 min com o Pedro, nosso fundador: ${slots[0].label} ou ${slots[1].label}?`
      : frase(FRAGMENTO.horario);
  }
  if (b && b !== "horario") return frase(`${FRAGMENTO[a]} e ${FRAGMENTO[b]}`);
  return frase(FRAGMENTO[a]);
}

/** O lead fez uma pergunta que merece resposta do modelo? */
export function leadPerguntou(mensagem: string): boolean {
  return mensagem.includes("?");
}

export interface Balao { text: string; delay: number }

/**
 * Lead já no perfil e ainda faltam dados: mantém, no máximo, a 1ª reação curta do
 * modelo e troca o resto pela próxima pergunta do roteiro.
 */
export function forcarProximoPasso(mensagens: Balao[], pendentes: ItemHandoff[], slots: Slot[]): Balao[] {
  const pergunta = perguntaCombinada(pendentes, slots);
  if (!pergunta) return mensagens;
  const reacao = mensagens.find((m) => m.text.length <= 90 && !m.text.includes("?"));
  return [...(reacao ? [{ text: reacao.text, delay: 0 }] : []), { text: pergunta, delay: reacao ? 1500 : 0 }];
}
