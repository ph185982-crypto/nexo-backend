// Conteúdo dos follow-ups do SDR (B2B — consultoria de marketplace da Nexo).
// O objetivo de cada toque é destravar o próximo passo: a informação que falta
// ou a ligação com o Pedro. Nada de "estoque acabando" (texto de e-commerce que
// saía como reserva antes).

import type { SDRSession } from "@/lib/ai/sdr/types";
import { faltandoParaHandoff, PERGUNTA_POR_ITEM, pareceNomeDePessoa } from "@/lib/ai/sdr/handoff-gate";
import { avaliarQualificacao } from "@/lib/ai/sdr/qualificacao";

export function primeiroNome(nome: string | null | undefined): string | null {
  if (!pareceNomeDePessoa(nome)) return null;
  return (nome ?? "").trim().split(/\s+/)[0];
}

/** Prompt para o LLM escrever o follow-up a partir do que o SDR já sabe. */
export function promptFollowupSdr(step: number, totalSteps: number, s: SDRSession | null): string {
  const faltando = s ? faltandoParaHandoff(s) : [];
  const contexto = s ? [
    s.nome && `nome: ${s.nome}`,
    s.empresa && `empresa: ${s.empresa}`,
    s.segmento && `segmento: ${s.segmento}`,
    s.problema_principal && `dor que ele contou: ${s.problema_principal}`,
    s.faturamento_total && `faturamento: ${s.faturamento_total}`,
  ].filter(Boolean).join(" | ") : "";
  const noIcp = s ? avaliarQualificacao({ ...s, tem_loja_fisica: s.loja_fisica === "sim" ? true : s.loja_fisica === "nao" ? false : s.tem_loja_fisica }).qualificado : false;
  const objetivo = noIcp
    ? "Ele já está no perfil: convide direto para a ligação de 20 min com o Pedro, fundador da Nexo, e pergunte o melhor dia e horário (hoje ou amanhã). Não faça nenhuma outra pergunta."
    : faltando.length
      ? `O próximo passo é descobrir ${PERGUNTA_POR_ITEM[faltando[0]]}.`
      : "O próximo passo é ele escolher um horário para a ligação de 20 min com o Pedro, fundador da Nexo.";
  const tom = step === 1 ? "toque leve, retomando exatamente o ponto em que a conversa parou"
    : step >= totalSteps ? "último toque: sem pressão, deixe a porta aberta e diga que pode chamar quando quiser"
    : step === 2 ? "traga um ganho concreto ligado à dor dele (sem inventar números)"
    : "prova social curta (a Nexo já estruturou mais de 600 empresas na Shopee e no Mercado Livre)";

  return `Você é do time da Nexo Brasil (consultoria que faz empresas crescerem na Shopee e no Mercado Livre)
e está retomando no WhatsApp uma conversa com um lojista que parou de responder.

Escreva UMA mensagem curta (no máximo 2 frases), natural, no tom que ele usou na conversa.
Etapa ${step} de ${totalSteps}: ${tom}.
${contexto ? `O que já sabemos: ${contexto}.` : ""}
${objetivo}
Termine com UMA pergunta simples de responder.

Regras: não fale preço; não prometa resultado; não use "prezado", "certamente", negrito ou listas;
não repita uma pergunta que ele já respondeu nem a última que a Nexo fez na conversa (traga um ângulo novo); não fale de estoque nem de promoção.
Responda só com a mensagem.`;
}

/** Reserva quando nenhum LLM responde — neutra e B2B. */
export function fallbackFollowupSdr(step: number, totalSteps: number, nome: string | null): string {
  const n = primeiroNome(nome);
  const oi = n ? `${n}, ` : "";
  if (step >= totalSteps) return `${oi}não vou mais te incomodar por aqui. Quando fizer sentido olhar a Shopee e o Mercado Livre do seu negócio, é só me chamar`;
  if (step === 1) return `${oi}conseguiu ver minha última mensagem? Fico no aguardo pra gente seguir`;
  if (step === 2) return `${oi}consigo te mostrar em 20 minutos onde estão as vendas que seu negócio pode buscar no marketplace. Quer que eu veja um horário pra você?`;
  return `${oi}a gente já estruturou mais de 600 empresas na Shopee e no Mercado Livre. Faz sentido a gente conversar essa semana?`;
}
