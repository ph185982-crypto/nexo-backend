// Perfil de comunicação do lead, medido nas mensagens dele — para a IA espelhar
// o jeito de falar (tamanho, formalidade, emoji, áudio) em vez de um tom fixo.

export interface PerfilComunicacao {
  tamanho: "curto" | "medio" | "longo";
  formalidade: "informal" | "neutro" | "formal";
  usaEmoji: boolean;
  usaAudio: boolean;
  abreviacoes: boolean;
  instrucao: string;
}

const ABREV = /\b(vc|vcs|tb|tbm|pq|blz|td|tmj|kkk+|rs+|msg|q|n|ss|sim sim|obg|vlw|mt|mto|eh)\b/i;
const FORMAL = /\b(senhor|senhora|prezad|cordialmente|atenciosamente|bom dia|boa tarde|boa noite|gostaria|poderia|por gentileza|grato|grata)\b/i;

export function perfilComunicacao(mensagensDoLead: string[]): PerfilComunicacao | null {
  const msgs = mensagensDoLead.map((m) => m.trim()).filter(Boolean).slice(-8);
  if (msgs.length === 0) return null;

  const audios = msgs.filter((m) => m.startsWith("[Áudio")).length;
  const textos = msgs.filter((m) => !m.startsWith("["));
  const base = textos.length ? textos : msgs;
  const media = base.reduce((s, m) => s + m.length, 0) / base.length;
  const tamanho = media < 35 ? "curto" : media < 140 ? "medio" : "longo";
  const usaEmoji = base.some((m) => /\p{Extended_Pictographic}/u.test(m));
  const abreviacoes = base.some((m) => ABREV.test(m));
  const formais = base.filter((m) => FORMAL.test(m)).length;
  const formalidade = formais >= Math.max(1, base.length / 2) && !abreviacoes ? "formal" : abreviacoes ? "informal" : "neutro";
  const usaAudio = audios > 0;

  const partes: string[] = [];
  partes.push(
    tamanho === "curto" ? "O lead escreve CURTO: responda curto também (frases bem diretas, no máximo 2 balões)."
      : tamanho === "longo" ? "O lead escreve mensagens longas e detalhadas: pode explicar um pouco mais, mas sem textão."
      : "O lead escreve em tamanho médio: mantenha 2 a 3 balões curtos.",
  );
  partes.push(
    formalidade === "formal" ? "Ele é formal: trate com mais cordialidade, sem gírias nem abreviações."
      : formalidade === "informal" ? "Ele é informal e usa abreviações: pode ser mais solto (\"vc\", \"tá\"), sem forçar gíria."
      : "Tom neutro e próximo.",
  );
  if (usaEmoji) partes.push("Ele usa emoji: pode usar 1 emoji quando fizer sentido.");
  else partes.push("Ele não usa emoji: evite emoji.");
  if (usaAudio) partes.push("Ele manda áudio: responda de forma conversada, como quem ouviu, e retome o ponto principal do que ele falou.");

  return { tamanho, formalidade, usaEmoji, usaAudio, abreviacoes, instrucao: partes.join(" ") };
}
