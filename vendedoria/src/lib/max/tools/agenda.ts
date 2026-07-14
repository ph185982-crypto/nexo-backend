import { prisma } from "@/lib/prisma/client";
import { getBrasiliaNow, getOwnerProvider } from "../config";
import {
  criarEventoReuniao,
  verificarDisponibilidade,
  buscarSlotsDisponiveis,
} from "@/lib/integrations/google-calendar";

function fmtDateTime(d: Date): string {
  return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

export async function gerenciarAgenda(args: Record<string, unknown>): Promise<string> {
  const acao = args.acao as string;

  switch (acao) {
    case "criar_evento": {
      const titulo = args.titulo as string;
      const dataHoraStr = args.data_hora as string;
      const duracao = (args.duracao_minutos as number) ?? 30;
      const descricao = (args.descricao as string) ?? undefined;
      const comMeet = (args.google_meet as boolean) ?? false;

      const dataHora = new Date(dataHoraStr);
      if (isNaN(dataHora.getTime())) return "Data/hora invalida. Use formato ISO (ex: 2026-07-15T14:00:00).";

      const disponivel = await verificarDisponibilidade(dataHora, duracao);
      if (!disponivel) {
        const slots = await buscarSlotsDisponiveis(3);
        const sugestoes = slots.map((s) => `  - ${s.label}`).join("\n");
        return `Horario indisponivel (${fmtDateTime(dataHora)}). Sugestoes de horarios livres:\n${sugestoes}`;
      }

      let googleEventId: string | null = null;
      let meetLink: string | null = null;
      let eventLink: string | null = null;

      if (comMeet) {
        const result = await criarEventoReuniao({
          nomeNegocio: titulo,
          telefone: "",
          dataHoraInicio: dataHora,
          duracaoMinutos: duracao,
          descricao,
        });
        if (result) {
          googleEventId = result.eventId;
          meetLink = result.meetLink ?? null;
          eventLink = result.eventLink;
        }
      } else {
        const token = await getGoogleAccessToken();
        if (token) {
          const result = await criarEventoGoogle(token, titulo, dataHora, duracao, descricao);
          if (result) {
            googleEventId = result.eventId;
            eventLink = result.eventLink;
          }
        }
      }

      const provider = await getOwnerProvider();
      const calEvent = await prisma.calendarEvent.create({
        data: {
          title: titulo,
          description: descricao ?? null,
          startTime: dataHora,
          endTime: new Date(dataHora.getTime() + duracao * 60_000),
          provider: googleEventId ? "GOOGLE" : "LOCAL",
          externalEventId: googleEventId,
          googleMeetLink: meetLink,
          status: "SCHEDULED",
          timezone: "America/Sao_Paulo",
          organizationId: provider?.organizationId ?? "",
        },
      });

      const lines = [
        `Evento criado:`,
        `  ${titulo}`,
        `  ${fmtDateTime(dataHora)} (${duracao}min)`,
        descricao ? `  ${descricao}` : null,
        googleEventId ? `  Google Calendar: sincronizado` : `  Salvo localmente (Google Calendar nao conectado)`,
        meetLink ? `  Google Meet: ${meetLink}` : null,
        eventLink ? `  Link: ${eventLink}` : null,
        `  ID: ${calEvent.id}`,
      ];
      return lines.filter(Boolean).join("\n");
    }

    case "listar_eventos": {
      const now = getBrasiliaNow();
      const diasFuturos = (args.dias as number) ?? 7;
      const fim = new Date(now.getTime() + diasFuturos * 24 * 60 * 60_000);

      const provider = await getOwnerProvider();
      if (!provider) return "Nenhuma organizacao configurada.";

      const eventos = await prisma.calendarEvent.findMany({
        where: {
          organizationId: provider.organizationId,
          status: { not: "CANCELLED" },
          startTime: { gte: now, lte: fim },
        },
        orderBy: { startTime: "asc" },
        take: 20,
      });

      if (eventos.length === 0) return `Nenhum evento nos proximos ${diasFuturos} dias.`;

      const lines = eventos.map((e, i) => {
        const dur = Math.round((e.endTime.getTime() - e.startTime.getTime()) / 60_000);
        return `${i + 1}. [${e.id}] ${fmtDateTime(e.startTime)} (${dur}min) — ${e.title}${e.googleMeetLink ? " [Meet]" : ""}${e.status === "COMPLETED" ? " [concluido]" : ""}`;
      });

      return [`Proximos eventos (${diasFuturos} dias):`, "", ...lines].join("\n");
    }

    case "ver_disponibilidade": {
      const quantidade = (args.quantidade as number) ?? 5;
      const slots = await buscarSlotsDisponiveis(quantidade);

      if (slots.length === 0) return "Nao encontrei horarios disponiveis nos proximos 14 dias.";

      const lines = slots.map((s, i) => `${i + 1}. ${s.label}`);
      return [`Proximos horarios disponiveis:`, "", ...lines].join("\n");
    }

    case "cancelar_evento": {
      const id = args.id as string;
      const evento = await prisma.calendarEvent.findUnique({ where: { id } });
      if (!evento) return `Evento com ID "${id}" nao encontrado.`;
      if (evento.status === "CANCELLED") return "Evento ja estava cancelado.";

      await prisma.calendarEvent.update({
        where: { id },
        data: { status: "CANCELLED" },
      });

      return `Evento cancelado: ${evento.title} (${fmtDateTime(evento.startTime)})`;
    }

    default:
      return `Acao "${acao}" nao reconhecida. Use: criar_evento, listar_eventos, ver_disponibilidade, cancelar_evento.`;
  }
}

async function getGoogleAccessToken(): Promise<string | null> {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;

  const cred = await prisma.integrationCredential.findUnique({
    where: { provider: "GOOGLE_CALENDAR" },
    select: { refreshToken: true },
  }).catch(() => null);

  const refreshToken = cred?.refreshToken ?? process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) return null;
  const data = await res.json() as { access_token?: string };
  return data.access_token ?? null;
}

async function criarEventoGoogle(
  token: string,
  titulo: string,
  dataHora: Date,
  duracao: number,
  descricao?: string,
): Promise<{ eventId: string; eventLink: string } | null> {
  const cred = await prisma.integrationCredential.findUnique({
    where: { provider: "GOOGLE_CALENDAR" },
    select: { calendarId: true },
  }).catch(() => null);

  const calendarId = cred?.calendarId ?? process.env.GOOGLE_CALENDAR_ID ?? "primary";
  const fim = new Date(dataHora.getTime() + duracao * 60_000);

  const body = {
    summary: titulo,
    description: descricao ?? "",
    start: { dateTime: dataHora.toISOString(), timeZone: "America/Sao_Paulo" },
    end: { dateTime: fim.toISOString(), timeZone: "America/Sao_Paulo" },
  };

  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) return null;
    const data = await res.json() as { id: string; htmlLink: string };
    return { eventId: data.id, eventLink: data.htmlLink };
  } catch {
    return null;
  }
}
