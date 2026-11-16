// Dia no fuso de Brasília (UTC-3, sem horário de verão desde 2019).
const BRT_MS = 3 * 3_600_000;

export function limitesDoDia(agora: Date = new Date()): { inicio: Date; fim: Date } {
  const local = new Date(agora.getTime() - BRT_MS);
  const inicio = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + BRT_MS);
  return { inicio, fim: new Date(inicio.getTime() + 86_400_000) };
}

export function somarRecorrencia(data: Date, recorrencia: string): Date {
  const d = new Date(data);
  if (recorrencia === "DIARIA") d.setUTCDate(d.getUTCDate() + 1);
  else if (recorrencia === "SEMANAL") d.setUTCDate(d.getUTCDate() + 7);
  else if (recorrencia === "MENSAL") d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}
