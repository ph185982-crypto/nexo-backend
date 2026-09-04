import { prisma } from "@/lib/prisma/client";
import { getBrasiliaNow, getOwnerProvider } from "../config";

export async function criarLembrete(args: Record<string, unknown>): Promise<string> {
  const descricao = args.descricao as string;
  const dataHora = new Date(args.data_hora as string);
  const recorrente = (args.recorrente as boolean) ?? false;
  const frequencia = (args.frequencia as string) ?? null;

  const lembrete = await prisma.lembreteMax.create({
    data: {
      descricao,
      data_hora: dataHora,
      recorrente,
      frequencia,
      enviado: false,
    },
  });

  // Best-effort: create CalendarEvent
  const provider = await getOwnerProvider();
  if (provider) {
    await prisma.calendarEvent
      .create({
        data: {
          title: descricao,
          startTime: dataHora,
          endTime: new Date(dataHora.getTime() + 30 * 60_000),
          provider: "LOCAL",
          status: "SCHEDULED",
          timezone: "America/Sao_Paulo",
          organizationId: provider.organizationId,
          whatsappProviderConfigId: undefined,
        },
      })
      .catch((e) => console.error("[Max] CalendarEvent create failed:", e));
  }

  const fmtData = dataHora.toLocaleDateString("pt-BR");
  const fmtHora = dataHora.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return [
    `Lembrete criado (ID: ${lembrete.id}):`,
    `  "${descricao}"`,
    `  Data/Hora: ${fmtData} as ${fmtHora}`,
    recorrente ? `  Recorrente: ${frequencia}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function listarLembretes(): Promise<string> {
  const now = getBrasiliaNow();

  const lembretes = await prisma.lembreteMax.findMany({
    where: {
      enviado: false,
      data_hora: { gte: now },
    },
    orderBy: { data_hora: "asc" },
    take: 10,
  });

  if (lembretes.length === 0) return "Nenhum lembrete pendente encontrado.";

  const lines = lembretes.map((l, i) => {
    const data = l.data_hora.toLocaleDateString("pt-BR");
    const hora = l.data_hora.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${i + 1}. [${l.id}] ${data} ${hora} — ${l.descricao}${l.recorrente ? ` (${l.frequencia})` : ""}`;
  });

  return [`Proximos lembretes:`, "", ...lines].join("\n");
}
