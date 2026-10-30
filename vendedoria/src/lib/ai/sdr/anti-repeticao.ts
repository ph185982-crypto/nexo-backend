// Barreiras contra a IA repetir o que já disse ao lead — mensagens idênticas,
// a mesma pergunta de novo, ou um "o especialista vai te ligar" quando o
// handoff nem aconteceu.

export function normalizarTexto(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface BalaoSdr { text: string; delay: number }

/** Remove os balões cujo texto já foi enviado ao lead nas últimas mensagens da IA. */
export function filtrarRepetidas<T extends { text: string }>(balões: T[], enviadasAntes: string[]): T[] {
  const vistas = new Set(enviadasAntes.map(normalizarTexto).filter(Boolean));
  const saida: T[] = [];
  for (const b of balões) {
    const n = normalizarTexto(b.text);
    if (!n || vistas.has(n)) continue;
    vistas.add(n); // também evita o mesmo balão duas vezes na mesma resposta
    saida.push(b);
  }
  return saida;
}

const FECHAMENTO = /(especialista vai|fundador vai|vamos deixar agendado|deixar agendado|te chamarmos|te chamar amanha|vai te ligar|te ligar|te passar pro|te passar para|passar pro nosso)/;

/** O texto promete ligação/encaminhamento ao especialista? */
export function pareceFechamento(texto: string): boolean {
  return FECHAMENTO.test(normalizarTexto(texto));
}

/**
 * As N últimas mensagens da IA, em ordem cronológica. `recentMessages` chega em
 * ordem cronológica (o agente faz reverse() do findMany desc) — por isso é
 * slice(-n), não slice(0, n): com slice(0, n) o filtro olhava as mensagens mais
 * ANTIGAS da janela e deixava passar a mesma pergunta 4 vezes seguidas (28/10).
 */
export function ultimasDaIA(mensagens: Array<{ role: string; content: string }>, n = 8): string[] {
  return mensagens.filter((m) => m.role === "ASSISTANT").slice(-n).map((m) => m.content);
}
