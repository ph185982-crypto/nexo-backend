// Ligação de diagnóstico marcada pelo SDR: horários livres (Google Agenda quando
// conectado + eventos já marcados no CRM) e criação da reunião.

import { prisma } from "@/lib/prisma/client";
import { buscarOcupados, criarEventoReuniao } from "@/lib/integrations/google-calendar";
import { gerarSlots, DURACAO_REUNIAO_MIN, rotuloSlot, type Intervalo, type Slot } from "./slots";

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
}): Promise<ReuniaoMarcada> {
  const fim = new Date(p.inicio.getTime() + DURACAO_REUNIAO_MIN * 60_000);
  const existente = await prisma.calendarEvent.findFirst({
    where: { leadId: p.leadId, status: "SCHEDULED", startTime: p.inicio },
  });
  if (existente) {
    return { eventoId: existente.id, inicio: p.inicio, label: rotuloSlot(p.inicio), meetLink: existente.googleMeetLink ?? undefined, noGoogle: existente.provider === "GOOGLE" };
  }

  const titulo = `Diagnóstico Nexo — ${p.empresa?.trim() || p.nome}`;
  const google = await criarEventoReuniao({
    nomeNegocio: p.empresa?.trim() || p.nome,
    telefone: p.telefone,
    dataHoraInicio: p.inicio,
    duracaoMinutos: DURACAO_REUNIAO_MIN,
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
