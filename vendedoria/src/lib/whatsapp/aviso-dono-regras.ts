// Regras puras do aviso ao dono (sem banco): quem é o Pedro e quando dá para mandar texto livre a ele.
import { dentroDaJanela } from "@/lib/followup/janela";
import { canonicalBrazilianNumber } from "./send";

export const numeroDono = (): string => process.env.OWNER_WHATSAPP_NUMBER ?? "5562984465388";
export const ehDono = (numero: string | null | undefined): boolean =>
  Boolean(numero) && canonicalBrazilianNumber(String(numero)) === canonicalBrazilianNumber(numeroDono());

/**
 * Dá para mandar texto livre ao Pedro agora? Sem histórico de conversa dele neste número, tenta (comportamento antigo);
 * com histórico, só dentro da janela de 24 h (com a margem de segurança do follow-up).
 */
export function podeMandarTexto(ultima: Date | null, agora: Date = new Date()): boolean {
  return ultima === null || dentroDaJanela(ultima, agora);
}
