import { prisma } from "@/lib/prisma/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { getOwnerProvider, MAX_OWNER_NUMBER, resolveToken } from "../config";

export async function dispatchLembretes(): Promise<number> {
  const now = new Date();
  const pendentes = await prisma.lembreteMax.findMany({
    where: { enviado: false, data_hora: { lte: now } },
    take: 20,
    orderBy: { data_hora: "asc" },
  });

  if (pendentes.length === 0) return 0;

  const provider = await getOwnerProvider();
  if (!provider) return 0;
  const token = resolveToken(provider.accessToken);

  let enviados = 0;
  for (const lem of pendentes) {
    try {
      await sendWhatsAppMessage(
        provider.businessPhoneNumberId,
        MAX_OWNER_NUMBER,
        `⏰ Lembrete: ${lem.descricao}`,
        token,
      );

      await prisma.lembreteMax.update({
        where: { id: lem.id },
        data: { enviado: true },
      });

      if (lem.recorrente && lem.frequencia) {
        const next = new Date(lem.data_hora);
        if (lem.frequencia === "diario") next.setDate(next.getDate() + 1);
        else if (lem.frequencia === "semanal") next.setDate(next.getDate() + 7);
        else if (lem.frequencia === "mensal") next.setMonth(next.getMonth() + 1);

        await prisma.lembreteMax.create({
          data: {
            descricao: lem.descricao,
            data_hora: next,
            recorrente: true,
            frequencia: lem.frequencia,
          },
        });
      }

      enviados++;
    } catch (err) {
      console.error(`[Max/Cron] Lembrete ${lem.id} failed:`, err);
    }
  }

  return enviados;
}

export async function cobrarTarefas(): Promise<number> {
  const now = new Date();
  const tarefas = await prisma.tarefaMax.findMany({
    where: {
      status: "ativa",
      proxima_cobranca: { lte: now },
    },
    take: 10,
  });

  if (tarefas.length === 0) return 0;

  const provider = await getOwnerProvider();
  if (!provider) return 0;
  const token = resolveToken(provider.accessToken);

  let cobradas = 0;
  for (const t of tarefas) {
    try {
      await sendWhatsAppMessage(
        provider.businessPhoneNumberId,
        MAX_OWNER_NUMBER,
        `📋 Cobrança do Max: ${t.descricao} — E aí, como está isso? Me responde que eu registro.`,
        token,
      );

      const next = new Date(now);
      next.setHours(next.getHours() + 4);
      const brasiliaHour = new Date(next.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })).getHours();
      if (brasiliaHour >= 22 || brasiliaHour < 8) {
        next.setDate(next.getDate() + (brasiliaHour >= 22 ? 1 : 0));
        next.setHours(11, 0, 0, 0);
      }

      await prisma.tarefaMax.update({
        where: { id: t.id },
        data: { proxima_cobranca: next },
      });

      cobradas++;
    } catch (err) {
      console.error(`[Max/Cron] Tarefa cobrança ${t.id} failed:`, err);
    }
  }

  return cobradas;
}
