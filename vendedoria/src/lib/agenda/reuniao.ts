// Ligação de diagnóstico marcada pelo SDR: horários livres (Google Agenda quando
// conectado + eventos já marcados no CRM) e criação da reunião.

import { prisma } from "@/lib/prisma/client";
import { buscarOcupados, criarEventoReuniao } from "@/lib/integrations/google-calendar";
import { gerarSlots, gerarSlotsLigacao, DURACAO_REUNIAO_MIN, DURACAO_LIGACAO_MIN, rotuloSlot, type Intervalo, type Slot } from "./slots";

async function ocupadosDaOrg(organizationId: string, agora: Date): Promise<Intervalo[]> {
  const fim = new Date(agora.getTime() + 15 * 86_400_000);
  const [google, locais] = await Promise.all([
    buscarOcupados(agora, fim).catch(() => null),
    prisma.calendarEvent.findMany({
      where: { organizationId, status: "SCHEDULED", startTime: { gte: new Date(agora.getTime() - 3_600_000), lte: fim } },
      select: { startTime: true, endTime: true },
    }).catch(() => []),
  ]);
  return [...(google ?? []), ...locais.map((e) => ({ start: e.startTime.getTime(), end: e.endTime.getTime() }))];
}

/** Os 2 próximos horários livres da agenda de ligação da Júlia (12:15 e 18:30, seg a sex). */
export async function buscarSlotsLigacao(organizationId: string, quantidade = 2, agora: Date = new Date()): Promise<Slot[]> {
  return gerarSlotsLigacao({ agora, ocupados: await ocupadosDaOrg(organizationId, agora), quantidade });
}

/** O horário ainda está livre? (outro lead pode ter pegado entre a oferta e a escolha) */
export async function slotLivre(organizationId: string, inicio: Date, ignorarEventoId?: string | null): Promise<boolean> {
  const fim = inicio.getTime() + DURACAO_LIGACAO_MIN * 60_000;
  const choque = await prisma.calendarEvent.findFirst({
    where: { organizationId, status: "SCHEDULED", startTime: { lt: new Date(fim) }, endTime: { gt: inicio }, ...(ignorarEventoId ? { id: { not: ignorarEventoId } } : {}) },
    select: { id: true },
  }).catch(() => null);
  return !choque;
}

/** Próximos horários livres, descontando a agenda do Google e as ligações já marcadas no CRM. */
export async function buscarSlotsReuniao(organizationId: string, quantidade = 4): Promise<Slot[]> {
  const agora = new Date();
  const fim = new Date(agora.getTime() + 14 * 86_400_000);
  const [google, locais] = await Promise.all([
    buscarOcupados(agora, fim).catch(() => null),
    prisma.calendarEvent.findMany({
      where: { organizationId, status: "SCHEDULED", startTime: { gte: agora, lte: fim } },
      select: { startTime: true, endTime: true },
    }).catch(() => []),
  ]);
  const ocupados: Intervalo[] = [
    ...(google ?? []),
    ...locais.map((e) => ({ start: e.startTime.getTime(), end: e.endTime.getTime() })),
  ];
  return gerarSlots({ agora, ocupados, quantidade });
}

export interface ReuniaoMarcada {
  eventoId: string;
  inicio: Date;
  label: string;
  meetLink?: string;
  noGoogle: boolean;
}

/**
 * Cria a ligação: sempre um CalendarEvent no CRM (aparece em Calendário) e, se o
 * Google Agenda estiver conectado, o evento lá também (com Meet). Idempotente:
 * se o lead já tem ligação marcada nesse horário, devolve a existente.
 */
export async function marcarReuniao(p: {
  organizationId: string;
  leadId: string;
  providerConfigId?: string | null;
  inicio: Date;
  nome: string;
  empresa?: string | null;
  telefone: string;
  resumo: string;
  /** Ligação da Júlia: 20 min e título "Ligação Avanteza – [nome]". */
  ligacao?: boolean;
}): Promise<ReuniaoMarcada> {
  const duracaoMin = p.ligacao ? DURACAO_LIGACAO_MIN : DURACAO_REUNIAO_MIN;
  const fim = new Date(p.inicio.getTime() + duracaoMin * 60_000);
  const existente = await prisma.calendarEvent.findFirst({
    where: { leadId: p.leadId, status: "SCHEDULED", startTime: p.inicio },
  });
  if (existente) {
    return { eventoId: existente.id, inicio: p.inicio, label: rotuloSlot(p.inicio), meetLink: existente.googleMeetLink ?? undefined, noGoogle: existente.provider === "GOOGLE" };
  }

  const titulo = p.ligacao ? `Ligação Avanteza – ${p.nome}` : `Diagnóstico Avanteza — ${p.empresa?.trim() || p.nome}`;
  const google = await criarEventoReuniao({
    nomeNegocio: p.empresa?.trim() || p.nome,
    telefone: p.telefone,
    dataHoraInicio: p.inicio,
    duracaoMinutos: duracaoMin,
    descricao: `${p.resumo}\n\nWhatsApp: +${p.telefone}`,
    generateMeet: true,
  }).catch(() => null);

  const evento = await prisma.calendarEvent.create({
    data: {
      title: titulo,
      description: p.resumo,
      startTime: p.inicio,
      endTime: fim,
      provider: google ? "GOOGLE" : "LOCAL",
      externalEventId: google?.eventId ?? null,
      googleMeetLink: google?.meetLink ?? null,
      organizationId: p.organizationId,
      leadId: p.leadId,
      whatsappProviderConfigId: p.providerConfigId ?? null,
    },
  });
  return { eventoId: evento.id, inicio: p.inicio, label: rotuloSlot(p.inicio), meetLink: google?.meetLink, noGoogle: Boolean(google) };
}

/** Remarca: cancela a ligação anterior do lead e cria a nova. */
export async function remarcarLigacao(p: Parameters<typeof marcarReuniao>[0] & { eventoAnteriorId?: string | null }): Promise<ReuniaoMarcada> {
  if (p.eventoAnteriorId) {
    await prisma.calendarEvent.updateMany({ where: { id: p.eventoAnteriorId, leadId: p.leadId }, data: { status: "CANCELLED" } }).catch(() => {});
  }
  return marcarReuniao({ ...p, ligacao: true });
}
