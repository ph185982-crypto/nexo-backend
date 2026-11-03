// Regra pura (sem banco): o que uma etapa significa para o negócio.
// Compartilhada entre servidor e tela.

export type NaturezaEtapa = "ABERTA" | "GANHA" | "PERDIDA";
export type TipoMotivo = "GANHO" | "PERDA";
export type StatusOportunidade = "EM_ANDAMENTO" | "GANHA" | "PERDIDA";

/** Tipo de motivo que a etapa pede; null se a etapa não encerra o negócio. */
export function tipoMotivoDaEtapa(natureza: string): TipoMotivo | null {
  if (natureza === "GANHA") return "GANHO";
  if (natureza === "PERDIDA") return "PERDA";
  return null;
}

export function statusDaEtapa(natureza: string): StatusOportunidade {
  if (natureza === "GANHA") return "GANHA";
  if (natureza === "PERDIDA") return "PERDIDA";
  return "EM_ANDAMENTO";
}

/** Código exibido da oportunidade: número com 8 dígitos / ano de criação. */
export function codigoOportunidade(numero: number, criadoEm: Date): string {
  return `${String(numero).padStart(8, "0")}/${criadoEm.getUTCFullYear()}`;
}

export function diasDesde(data: Date | string | null | undefined, agora: Date = new Date()): number {
  if (!data) return 0;
  return Math.max(0, Math.floor((agora.getTime() - new Date(data).getTime()) / 86_400_000));
}
