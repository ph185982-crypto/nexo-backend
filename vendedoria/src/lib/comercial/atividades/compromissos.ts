// Compromissos do Comercial moram na agenda única do Vendedor IA (CalendarEvent), com oportunidadeId/contatoId.
// Este módulo traduz o vocabulário do CRM (assunto, início, AGENDADO…) para o do CalendarEvent e de volta.
import type { CalendarAttendee, CalendarEvent } from "@prisma/client";
import { prisma } from "@/lib/prisma/client";
import { organizacaoComercial } from "@/lib/comercial/organizacao";

export const TIPOS_COMPROMISSO = ["REUNIAO", "LIGACAO", "VISITA", "OUTRO"] as const;

const STATUS_PARA_EVENTO: Record<string, string> = { AGENDADO: "SCHEDULED", REALIZADO: "COMPLETED", CANCELADO: "CANCELLED" };
const STATUS_DO_EVENTO: Record<string, string> = { SCHEDULED: "AGENDADO", COMPLETED: "REALIZADO", CANCELLED: "CANCELADO" };
export const statusParaEvento = (s: string) => STATUS_PARA_EVENTO[s] ?? "SCHEDULED";
export const statusDoEvento = (s: string) => STATUS_DO_EVENTO[s] ?? "AGENDADO";

type EventoCom = CalendarEvent & {
  attendees?: CalendarAttendee[];
  contato?: { id: string; nome: string } | null;
  oportunidade?: { id: string; nome: string } | null;
  responsavel?: { name: string | null } | null;
};

/** CalendarEvent → compromisso no formato do Comercial (o mesmo que as telas do CRM usavam). */
export function paraCompromisso(e: EventoCom) {
  return {
    id: e.id, assunto: e.title, tipo: e.tipo ?? "REUNIAO", inicio: e.startTime, fim: e.endTime, local: e.location, descricao: e.description,
    status: statusDoEvento(e.status), participantes: (e.attendees ?? []).map((a) => a.email ?? a.name), origem: e.origem ?? "MANUAL",
    responsavelId: e.responsavelId, contatoId: e.contatoId, oportunidadeId: e.oportunidadeId, criadoEm: e.createdAt,
    contato: e.contato ?? null, oportunidade: e.oportunidade ?? null, responsavel: e.responsavel ? { nome: e.responsavel.name ?? "" } : null,
  };
}
export type Compromisso = ReturnType<typeof paraCompromisso>;

export async function criarCompromisso(n: {
  assunto: string; tipo?: string; inicio: Date; fim: Date; local?: string | null; descricao?: string | null; participantes?: string[];
  responsavelId?: string | null; contatoId?: string | null; oportunidadeId?: string | null; origem?: "MANUAL" | "INTEGRACAO";
}) {
  if (n.fim <= n.inicio) throw new Error("O fim precisa ser depois do início");
  let contatoId = n.contatoId ?? null;
  let leadId: string | null = null;
  if (n.oportunidadeId) {
    const op = await prisma.comOportunidade.findUnique({ where: { id: n.oportunidadeId }, select: { contatoId: true, leadId: true } });
    contatoId ??= op?.contatoId ?? null;
    leadId = op?.leadId ?? null;
  }
  const e = await prisma.calendarEvent.create({
    data: {
      title: n.assunto, tipo: n.tipo ?? "REUNIAO", startTime: n.inicio, endTime: n.fim, location: n.local ?? null, description: n.descricao ?? null,
      status: "SCHEDULED", provider: "LOCAL", organizationId: await organizacaoComercial(), leadId,
      responsavelId: n.responsavelId ?? null, contatoId, oportunidadeId: n.oportunidadeId ?? null, origem: n.origem ?? "MANUAL",
      attendees: { create: (n.participantes ?? []).map((email) => ({ name: email, email })) },
    },
    include: { attendees: true },
  });
  return paraCompromisso(e);
}

/** Compromissos do Comercial no intervalo (os eventos do SDR, sem oportunidade nem contato, ficam de fora). */
export async function listarCompromissos(de: Date, ate: Date, responsavelId?: string | null) {
  const eventos = await prisma.calendarEvent.findMany({
    where: {
      startTime: { gte: de, lt: ate }, status: { not: "CANCELLED" }, OR: [{ oportunidadeId: { not: null } }, { contatoId: { not: null } }, { origem: { not: null } }],
      ...(responsavelId ? { responsavelId } : {}),
    },
    orderBy: { startTime: "asc" }, take: 500,
    include: { attendees: true, contato: { select: { id: true, nome: true } }, oportunidade: { select: { id: true, nome: true } }, responsavel: { select: { name: true } } },
  });
  return eventos.map(paraCompromisso);
}
