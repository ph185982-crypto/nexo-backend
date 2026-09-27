// Fonte única dos status de ProspectLead — rótulo, cor, etapa do funil e
// transições manuais permitidas. Usado pelas rotas e pela UI (é importável no
// client: não depende de Prisma nem de nada do servidor).

export const STATUS_PROSPECT = [
  "NOVO",
  "ENRIQUECIDO",
  "PONTUADO",
  "ANALISADO",
  "APROVADO",
  "ABORDADO",
  "RESPONDEU",
  "QUALIFICADO",
  "REUNIAO_AGENDADA",
  "DESCARTADO",
  "PERDIDO",
  "ERRO_ENVIO",
] as const;

export type StatusProspect = (typeof STATUS_PROSPECT)[number];

/** Etapas do fluxo que o usuário enxerga (o stepper do hub). */
export const ETAPAS = [
  { id: "qualificar", label: "Qualificar", descricao: "Enriquecer e pontuar com IA" },
  { id: "revisar",    label: "Revisar",    descricao: "Aprovar ou descartar" },
  { id: "abordar",    label: "Abordar",    descricao: "Prontas para o disparo" },
  { id: "conversando", label: "Em conversa", descricao: "Abordadas e respondendo" },
  { id: "ganhos",     label: "Qualificadas", descricao: "Qualificadas e reuniões agendadas" },
] as const;

export type EtapaId = (typeof ETAPAS)[number]["id"] | "encerrado";

export const STATUS_INFO: Record<StatusProspect, { label: string; cor: string; etapa: EtapaId }> = {
  NOVO:             { label: "Nova",             cor: "bg-slate-500/10 text-slate-600 dark:text-slate-300",   etapa: "qualificar" },
  ENRIQUECIDO:      { label: "Enriquecida",      cor: "bg-blue-500/10 text-blue-600 dark:text-blue-300",      etapa: "qualificar" },
  PONTUADO:         { label: "Pontuada",         cor: "bg-violet-500/10 text-violet-600 dark:text-violet-300", etapa: "qualificar" },
  ANALISADO:        { label: "Aguardando revisão", cor: "bg-amber-500/10 text-amber-600 dark:text-amber-300", etapa: "revisar" },
  APROVADO:         { label: "Aprovada",         cor: "bg-green-500/10 text-green-600 dark:text-green-300",   etapa: "abordar" },
  ERRO_ENVIO:       { label: "Falha no envio",   cor: "bg-orange-500/10 text-orange-600 dark:text-orange-300", etapa: "abordar" },
  ABORDADO:         { label: "Abordada",         cor: "bg-teal-500/10 text-teal-600 dark:text-teal-300",      etapa: "conversando" },
  RESPONDEU:        { label: "Respondeu",        cor: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-300",      etapa: "conversando" },
  QUALIFICADO:      { label: "Qualificada",      cor: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300", etapa: "ganhos" },
  REUNIAO_AGENDADA: { label: "Reunião agendada", cor: "bg-primary/10 text-primary",                          etapa: "ganhos" },
  DESCARTADO:       { label: "Descartada",       cor: "bg-red-500/10 text-red-600 dark:text-red-300",         etapa: "encerrado" },
  PERDIDO:          { label: "Perdida",          cor: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",      etapa: "encerrado" },
};

export function infoStatus(status: string) {
  return STATUS_INFO[status as StatusProspect] ?? { label: status, cor: "bg-muted text-muted-foreground", etapa: "encerrado" as EtapaId };
}

export function statusDaEtapa(etapa: EtapaId): StatusProspect[] {
  return STATUS_PROSPECT.filter((s) => STATUS_INFO[s].etapa === etapa);
}

export function isStatus(v: string): v is StatusProspect {
  return (STATUS_PROSPECT as readonly string[]).includes(v);
}

/** Ações manuais que o usuário pode aplicar (individual ou em massa). */
export const ACOES_MANUAIS = {
  aprovar:     { para: "APROVADO",   de: ["NOVO", "ENRIQUECIDO", "PONTUADO", "ANALISADO", "DESCARTADO"] },
  descartar:   { para: "DESCARTADO", de: ["NOVO", "ENRIQUECIDO", "PONTUADO", "ANALISADO", "APROVADO", "ERRO_ENVIO"] },
  revisar:     { para: "ANALISADO",  de: ["PONTUADO", "APROVADO", "DESCARTADO"] },
  reprocessar: { para: "NOVO",       de: ["ENRIQUECIDO", "PONTUADO", "ANALISADO", "APROVADO", "DESCARTADO"] },
  perdido:     { para: "PERDIDO",    de: ["ABORDADO", "RESPONDEU", "QUALIFICADO", "REUNIAO_AGENDADA"] },
} as const satisfies Record<string, { para: StatusProspect; de: readonly StatusProspect[] }>;

export type AcaoManual = keyof typeof ACOES_MANUAIS;

export function isAcaoManual(v: string): v is AcaoManual {
  return v in ACOES_MANUAIS;
}
