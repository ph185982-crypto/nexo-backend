// Google Calendar integration — OAuth2 com refresh token
// Env vars: GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET,
//           GOOGLE_CALENDAR_REFRESH_TOKEN, GOOGLE_CALENDAR_ID

const GOOGLE_AUTH_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface SlotDisponivel {
  inicio: Date;
  fim: Date;
  label: string; // ex: "Quarta 18/06 às 10h"
}

export interface EventoReuniao {
  eventId: string;
  eventLink: string;
  meetLink?: string;
}

// ── OAuth2: obtém access token via refresh token ───────────────────────────────

async function getAccessToken(): Promise<string | null> {
  const clientId     = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    console.warn("[GoogleCalendar] Credenciais não configuradas (GOOGLE_CALENDAR_*)");
    return null;
  }

  try {
    const res = await fetch(GOOGLE_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type:    "refresh_token",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[GoogleCalendar] Token refresh falhou:", err);
      return null;
    }

    const data = await res.json() as { access_token?: string };
    return data.access_token ?? null;
  } catch (e) {
    console.error("[GoogleCalendar] Erro ao obter token:", e);
    return null;
  }
}

function getCalendarId(): string {
  return process.env.GOOGLE_CALENDAR_ID ?? "primary";
}

// ── Cria evento de reunião ─────────────────────────────────────────────────────

export async function criarEventoReuniao(params: {
  nomeNegocio: string;
  telefone: string;
  dataHoraInicio: Date;
  duracaoMinutos?: number;
  descricao?: string;
}): Promise<EventoReuniao | null> {
  const token = await getAccessToken();
  if (!token) return null;

  const { nomeNegocio, telefone, dataHoraInicio, duracaoMinutos = 30, descricao } = params;
  const calendarId = getCalendarId();

  const fim = new Date(dataHoraInicio.getTime() + duracaoMinutos * 60_000);

  const body = {
    summary: `Reunião — ${nomeNegocio}`,
    description: descricao ?? `Reunião de apresentação via WhatsApp.\nContato: ${telefone}`,
    start: { dateTime: dataHoraInicio.toISOString(), timeZone: "America/Sao_Paulo" },
    end:   { dateTime: fim.toISOString(),             timeZone: "America/Sao_Paulo" },
    conferenceData: {
      createRequest: {
        requestId:             `nexos-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };

  try {
    const res = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=none`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      console.error("[GoogleCalendar] Erro ao criar evento:", err);
      return null;
    }

    const data = await res.json() as {
      id: string;
      htmlLink: string;
      conferenceData?: { entryPoints?: Array<{ entryPointType: string; uri: string }> };
    };

    const meetLink = data.conferenceData?.entryPoints?.find(
      (e) => e.entryPointType === "video",
    )?.uri;

    console.log(`[GoogleCalendar] Evento criado: ${data.id} | ${data.htmlLink}`);
    return { eventId: data.id, eventLink: data.htmlLink, meetLink };
  } catch (e) {
    console.error("[GoogleCalendar] Erro ao criar evento:", e);
    return null;
  }
}

// ── Verifica disponibilidade (freebusy) ───────────────────────────────────────

export async function verificarDisponibilidade(
  dataHoraInicio: Date,
  duracaoMinutos = 30,
): Promise<boolean> {
  const token = await getAccessToken();
  if (!token) return true; // assume disponível se não há credenciais

  const calendarId = getCalendarId();
  const fim = new Date(dataHoraInicio.getTime() + duracaoMinutos * 60_000);

  try {
    const res = await fetch(`${CALENDAR_API}/freeBusy`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify({
        timeMin:  dataHoraInicio.toISOString(),
        timeMax:  fim.toISOString(),
        timeZone: "America/Sao_Paulo",
        items:    [{ id: calendarId }],
      }),
    });

    if (!res.ok) {
      console.error("[GoogleCalendar] freebusy falhou:", await res.text());
      return true;
    }

    const data = await res.json() as {
      calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
    };

    const busy = data.calendars?.[calendarId]?.busy ?? [];
    return busy.length === 0;
  } catch (e) {
    console.error("[GoogleCalendar] Erro ao verificar disponibilidade:", e);
    return true;
  }
}

// ── Retorna próximos slots disponíveis ────────────────────────────────────────

export async function buscarSlotsDisponiveis(quantidade = 5): Promise<SlotDisponivel[]> {
  const token = await getAccessToken();
  if (!token) return gerarSlotsFallback(quantidade);

  const calendarId = getCalendarId();
  const agora = new Date();
  // Começa a partir da próxima hora cheia
  const inicio = new Date(agora);
  inicio.setMinutes(0, 0, 0);
  inicio.setHours(inicio.getHours() + 1);

  // Janela de busca: próximos 14 dias
  const fim = new Date(inicio.getTime() + 14 * 24 * 60 * 60_000);

  try {
    const res = await fetch(`${CALENDAR_API}/freeBusy`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify({
        timeMin:  inicio.toISOString(),
        timeMax:  fim.toISOString(),
        timeZone: "America/Sao_Paulo",
        items:    [{ id: calendarId }],
      }),
    });

    if (!res.ok) return gerarSlotsFallback(quantidade);

    const data = await res.json() as {
      calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
    };

    const ocupados = (data.calendars?.[calendarId]?.busy ?? []).map((b) => ({
      start: new Date(b.start).getTime(),
      end:   new Date(b.end).getTime(),
    }));

    const slots: SlotDisponivel[] = [];
    const cursor = new Date(inicio);

    while (slots.length < quantidade && cursor < fim) {
      const dayOfWeek = cursor.getDay(); // SP locale — approx
      const hour = cursor.getHours();

      // Expediente: seg-sex 9h-18h, sáb 9h-13h
      const dentroExpediente =
        (dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 9 && hour < 18) ||
        (dayOfWeek === 6 && hour >= 9 && hour < 13);

      if (dentroExpediente) {
        const slotFim = cursor.getTime() + 30 * 60_000;
        const conflito = ocupados.some(
          (o) => cursor.getTime() < o.end && slotFim > o.start,
        );

        if (!conflito) {
          slots.push({
            inicio: new Date(cursor),
            fim:    new Date(slotFim),
            label:  formatarSlot(cursor),
          });
        }
      }

      cursor.setHours(cursor.getHours() + 1);
    }

    return slots.length > 0 ? slots : gerarSlotsFallback(quantidade);
  } catch (e) {
    console.error("[GoogleCalendar] Erro ao buscar slots:", e);
    return gerarSlotsFallback(quantidade);
  }
}

// ── Formatação de slot ─────────────────────────────────────────────────────────

function formatarSlot(data: Date): string {
  const dias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const dia = dias[data.getDay()];
  const dd  = String(data.getDate()).padStart(2, "0");
  const mm  = String(data.getMonth() + 1).padStart(2, "0");
  const hh  = String(data.getHours()).padStart(2, "0");
  return `${dia} ${dd}/${mm} às ${hh}h`;
}

function gerarSlotsFallback(quantidade: number): SlotDisponivel[] {
  const slots: SlotDisponivel[] = [];
  const cursor = new Date();
  cursor.setMinutes(0, 0, 0);
  cursor.setHours(cursor.getHours() + 1);

  while (slots.length < quantidade) {
    const dayOfWeek = cursor.getDay();
    const hour      = cursor.getHours();
    const valido =
      (dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 9 && hour < 18) ||
      (dayOfWeek === 6 && hour >= 9 && hour < 13);

    if (valido) {
      const slotFim = new Date(cursor.getTime() + 30 * 60_000);
      slots.push({ inicio: new Date(cursor), fim: slotFim, label: formatarSlot(cursor) });
    }

    cursor.setHours(cursor.getHours() + 1);
    if (slots.length === 0 && cursor.getTime() - Date.now() > 7 * 24 * 60 * 60_000) break;
  }

  return slots;
}
