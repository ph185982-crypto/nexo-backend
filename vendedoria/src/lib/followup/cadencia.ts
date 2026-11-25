// Cadência de follow-up quando o lead não responde (roteiro da Júlia, 24/11): 1º toque no dia seguinte (24 h) e
// 2º no 3º dia (72 h), que encerra. Os prazos contam sempre a partir da MESMA mensagem (a última da IA).
// O 1º toque é puxado para dentro da janela de 24 h do WhatsApp (lib/followup/janela.ts).

export const CADENCIA_HORAS = [24, 72] as const;
export const MAX_FOLLOWUPS = CADENCIA_HORAS.length;

const HORA_MS = 60 * 60 * 1000;

/** Prazo (ms após a mensagem da IA) em que o toque `step` (1..4) deve sair. */
export function prazoDoToque(step: number): number {
  const i = Math.min(Math.max(step, 1), MAX_FOLLOWUPS) - 1;
  return CADENCIA_HORAS[i] * HORA_MS;
}

/** Quando sai o toque `step`, contado a partir da mensagem da IA (`base`). Nunca no passado. */
export function dataDoToque(step: number, base: Date, agora: Date = new Date()): Date {
  const alvo = base.getTime() + prazoDoToque(step);
  return new Date(Math.max(alvo, agora.getTime() + 5 * 60 * 1000));
}
