// Quando o lead pede uma pessoa ou demonstra que a conversa com a IA travou,
// a IA sai de cena NA HORA: humano assume, dono é avisado, follow-ups param.
// Em 28/10 uma lead escreveu "tá parecendo um robô" e a IA respondeu com a
// mesma pergunta pela 7ª vez — nenhuma regra olhava para isso.

const normalizar = (t: string): string =>
  t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

const PEDIDO_HUMANO = [
  /falar com (o |a |um |uma )?(pedro|humano|pessoa|atendente|vendedor|dono|responsavel|gerente|alguem|gente de verdade)/,
  /quero (um |uma )?(atendente|humano|pessoa|vendedor)/,
  /(chama|me passa|passa pro|passa para|transfere|transfira) (o |a |um |uma |pro |para o )?(pedro|dono|atendente|gerente|alguem|humano|responsavel)/,
  /(e|eh|é) (um )?(robo|bot|inteligencia artificial)\b/,
  /\b(robo|bot)\b/,
  /inteligencia artificial/,
  /nao (estou|to|tou) entendendo/,
  /(nao|n) entendi nada/,
  /(voce|vc) (nao|n) (esta|ta) (entendendo|lendo|me ouvindo)/,
  /(ja|já) (te )?(falei|disse|respondi) (isso )?(duas|tres|varias|mil) vezes/,
  /(ja|já) (te )?(falei|disse|respondi)\b.*\b(de novo|outra vez|novamente)/,
  /(para|pare) de (repetir|perguntar)/,
  /mesma pergunta/,
  /(repetindo|repete|repetiu) (a )?(mesma|pergunta)/,
  /(atendimento|conversa) (automatic[oa]|robotizad[oa])/,
];

export type MotivoHumano = "pediu_humano" | "frustrado";

/** O lead pediu uma pessoa ou mostrou que a IA travou? */
export function detectarPedidoHumano(mensagem: string): MotivoHumano | null {
  const m = normalizar(mensagem);
  if (m.length < 3) return null;
  if (PEDIDO_HUMANO.slice(0, 3).some((r) => r.test(m))) return "pediu_humano";
  if (PEDIDO_HUMANO.slice(3).some((r) => r.test(m))) return "frustrado";
  return null;
}

/** Resposta curta e honesta para o lead quando a IA sai de cena. */
export function mensagemDeTransferencia(motivo: MotivoHumano, nome?: string | null): string {
  const n = nome?.trim() ? `${nome.trim().split(/\s+/)[0]}, ` : "";
  return motivo === "frustrado"
    ? `${n}desculpa a confusão por aqui 🙏 Vou te passar direto pro Pedro, ele continua a conversa com você pessoalmente`
    : `${n}claro! Vou te passar pro Pedro, ele continua daqui com você`;
}
