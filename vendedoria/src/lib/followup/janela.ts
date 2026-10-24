// Janela de atendimento de 24h do WhatsApp: mensagem de texto livre só é
// entregue até 24h depois da ÚLTIMA mensagem do cliente. Fora dela a Meta
// recusa (erro 131047) e só aceita template aprovado. Antes os follow-ups 2, 3
// e 4 (24h, 48h, 72h) saíam como texto livre — fora da janela — e nunca
// chegavam, embora o sistema os contasse como enviados.

export const JANELA_MS = 24 * 60 * 60 * 1000;
/** Margem de segurança antes do fechamento da janela. */
export const MARGEM_MS = 45 * 60 * 1000;

export function fimDaJanela(ultimaMsgDoCliente: Date | null | undefined): Date | null {
  return ultimaMsgDoCliente ? new Date(ultimaMsgDoCliente.getTime() + JANELA_MS) : null;
}

/** Ainda dá para mandar texto livre agora? */
export function dentroDaJanela(ultimaMsgDoCliente: Date | null | undefined, agora: Date = new Date()): boolean {
  const fim = fimDaJanela(ultimaMsgDoCliente);
  return Boolean(fim && agora.getTime() < fim.getTime() - MARGEM_MS);
}

export interface ConfigTemplateFollowup {
  nome: string;
  idioma: string;
  /** O template tem {{1}} para o primeiro nome? */
  comNome: boolean;
}

/** Template aprovado na Meta para retomar conversa fora da janela (opcional). */
export function templateFollowup(env: Record<string, string | undefined> = process.env): ConfigTemplateFollowup | null {
  const nome = env.FOLLOWUP_TEMPLATE_NAME?.trim();
  if (!nome) return null;
  return { nome, idioma: env.FOLLOWUP_TEMPLATE_LANG?.trim() || "pt_BR", comNome: env.FOLLOWUP_TEMPLATE_COM_NOME !== "false" };
}

export type PlanoEnvio =
  | { modo: "texto" }
  | { modo: "template"; template: ConfigTemplateFollowup }
  | { modo: "sem_canal" };

/** Como este follow-up pode sair agora. */
export function planejarEnvio(
  ultimaMsgDoCliente: Date | null | undefined,
  agora: Date = new Date(),
  template: ConfigTemplateFollowup | null = templateFollowup(),
): PlanoEnvio {
  if (dentroDaJanela(ultimaMsgDoCliente, agora)) return { modo: "texto" };
  if (template) return { modo: "template", template };
  return { modo: "sem_canal" };
}

/**
 * Quando agendar o próximo toque. Sem template configurado, um toque que cairia
 * depois do fechamento da janela é puxado para ~1h antes de ela fechar — é a
 * última chance de falar com o lead sem template. Devolve null se nem isso cabe.
 */
export function proximoEnvio(
  desejado: Date,
  ultimaMsgDoCliente: Date | null | undefined,
  agora: Date = new Date(),
  temTemplate: boolean = templateFollowup() !== null,
): Date | null {
  if (temTemplate) return desejado;
  const fim = fimDaJanela(ultimaMsgDoCliente);
  if (!fim) return null;
  const limite = fim.getTime() - MARGEM_MS - 15 * 60 * 1000; // ~1h antes de fechar
  if (desejado.getTime() <= limite) return desejado;
  if (limite > agora.getTime() + 20 * 60 * 1000) return new Date(limite);
  return null;
}
