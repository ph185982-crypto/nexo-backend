import { NextRequest, NextResponse } from "next/server";
import { getBrasiliaHour } from "@/lib/max/config";
import { dispatchLembretes, cobrarTarefas } from "@/lib/max/crons/lembretes";
import { dispatchAlertas } from "@/lib/max/crons/alertas";
import {
  enviarBriefingMatinal,
  enviarFechamentoDia,
  enviarAnaliseSemanal,
  enviarFechamentoMensal,
} from "@/lib/max/crons/briefing";
import { prisma } from "@/lib/prisma/client";

export const maxDuration = 120;

async function tryDedup(chave: string): Promise<boolean> {
  try {
    await prisma.alertaEnviadoMax.create({ data: { chave } });
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.CRON_SECRET || (auth !== `Bearer ${process.env.CRON_SECRET}` && secret !== process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ran: string[] = [];
  const errors: string[] = [];

  const now = new Date();
  const hora = getBrasiliaHour();
  const hoje = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const hojeStr = hoje.toISOString().slice(0, 10);
  const diaSemana = hoje.getDay();
  const diaDoMes = hoje.getDate();
  const ano = hoje.getFullYear();
  const semana = Math.ceil((hoje.getDate() + new Date(ano, hoje.getMonth(), 1).getDay()) / 7);

  // Per-minute: lembretes + cobranças
  try {
    const lem = await dispatchLembretes();
    if (lem > 0) ran.push(`lembretes:${lem}`);
  } catch (e) {
    errors.push(`lembretes: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const cob = await cobrarTarefas();
    if (cob > 0) ran.push(`cobrancas:${cob}`);
  } catch (e) {
    errors.push(`cobrancas: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Hourly gated jobs (only run within the target hour)
  if (hora === 8) {
    // Daily briefing
    if (await tryDedup(`briefing-${hojeStr}`)) {
      try {
        await enviarBriefingMatinal();
        ran.push("briefing");
      } catch (e) {
        errors.push(`briefing: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Weekly analysis (Monday)
    if (diaSemana === 1 && await tryDedup(`semanal-${ano}-W${String(semana).padStart(2, "0")}`)) {
      try {
        await enviarAnaliseSemanal();
        ran.push("semanal");
      } catch (e) {
        errors.push(`semanal: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Monthly close (day 1)
    if (diaDoMes === 1) {
      const mesAnterior = `${hoje.getMonth() === 0 ? ano - 1 : ano}-${String(hoje.getMonth() === 0 ? 12 : hoje.getMonth()).padStart(2, "0")}`;
      if (await tryDedup(`mensal-${mesAnterior}`)) {
        try {
          await enviarFechamentoMensal();
          ran.push("mensal");
        } catch (e) {
          errors.push(`mensal: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  // Day close at 20h
  if (hora === 20 && await tryDedup(`fechamento-${hojeStr}`)) {
    try {
      await enviarFechamentoDia();
      ran.push("fechamento");
    } catch (e) {
      errors.push(`fechamento: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Hourly alerts 8-22
  if (hora >= 8 && hora < 22) {
    try {
      const alertas = await dispatchAlertas();
      if (alertas > 0) ran.push(`alertas:${alertas}`);
    } catch (e) {
      errors.push(`alertas: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({ ok: true, hora, ran, errors: errors.length > 0 ? errors : undefined });
}
