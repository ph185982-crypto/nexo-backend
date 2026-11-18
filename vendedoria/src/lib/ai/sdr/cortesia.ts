// Mensagens que não pedem resposta: reação (👍 numa mensagem), emoji solto e cortesias de
// despedida ("ok", "obrigado", "até logo"). Depois que o lead agendou a ligação e a IA se
// despediu, responder a isso é ruído — e, pior, o modelo corretamente devolve `messages: []`
// (nada a dizer), que o sistema tratava como falha: o lead recebia "tive um probleminha" e o
// dono um alerta falso (caso LYON DIESEL, 17/11/2026).

export const TEXTO_REACAO = "[Reação a mensagem]";

const PALAVRAS = new Set([
  "ok", "okay", "blz", "beleza", "certo", "combinado", "fechado", "valeu", "vlw", "show", "top", "perfeito", "otimo",
  "obrigado", "obrigada", "obg", "brigado", "brigada", "muito", "tmj", "tchau", "ate", "logo", "amanha", "la", "entao",
  "isso", "tudo", "bem", "claro", "pode", "deixar", "anotado", "aguardo", "esperando",
]);

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** true se a mensagem é só uma reação, emoji ou cortesia curta — nada a responder. */
export function ehApenasCortesia(texto: string): boolean {
  const t = texto.trim();
  if (!t) return true;
  if (t === TEXTO_REACAO) return true;
  // Sem letras nem números (só emoji/pontuação): "👍", "🙏🙏", "!!"
  const limpo = semAcento(t.toLowerCase()).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!limpo) return true;
  const palavras = limpo.split(" ");
  return palavras.length <= 5 && palavras.every((p) => PALAVRAS.has(p));
}
