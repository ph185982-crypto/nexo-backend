// Rotina diária do Comercial (F5/C11), chamada pelo /api/cron/comercial (cron da Vercel a cada 10 min).
// O CRM antigo rodava isto 1×/dia (/api/cron/automacoes): rotina das entregas (responsáveis, planejamento da semana,
// conclusão, renovação 60 dias antes) e, depois, a varredura das automações de tempo. Aqui ela roda uma vez por dia,
// na primeira chamada a partir da HORA (horário de Brasília); a trava é a linha "comercial:rotina-diaria" de
// ComConfiguracao (dia já rodado), reivindicada de forma atômica: dois crons simultâneos não rodam duas vezes.
// As duas funções já são idempotentes por conta própria; a trava só evita trabalho repetido a cada 10 minutos.
import { prisma } from "@/lib/prisma/client";
import { rodarRotinaDeEntregas } from "@/lib/comercial/entrega/rotina";
import { varrerTempo } from "@/lib/comercial/automacao/motor";

export const CHAVE_ROTINA = "comercial:rotina-diaria";
/** Hora local (Brasília) a partir da qual a rotina do dia roda. COMERCIAL_HORA_ROTINA muda (0–23). */
export const horaDaRotina = (env: NodeJS.ProcessEnv = process.env) => {
  const h = Number(env.COMERCIAL_HORA_ROTINA);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 7;
};

/** Data (AAAA-MM-DD) e hora em Brasília. */
export function agoraEmBrasilia(agora: Date): { dia: string; hora: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(agora).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) };
}

/** Reivindica o dia: true só para quem gravou primeiro. */
async function reivindicarDia(dia: string): Promise<boolean> {
  const r = await prisma.comConfiguracao.updateMany({ where: { chave: CHAVE_ROTINA, valor: { lt: dia } }, data: { valor: dia } });
  if (r.count === 1) return true;
  // Não existe ainda: cria; se já existe (com o dia de hoje, ou outro cron criou agora), count = 0.
  const c = await prisma.comConfiguracao.createMany({ data: [{ chave: CHAVE_ROTINA, valor: dia }], skipDuplicates: true });
  return c.count === 1;
}

export type ResultadoRotinaDiaria =
  | { status: "fora-da-hora" | "ja-rodou"; dia: string }
  | { status: "rodou"; dia: string; entregas: { responsaveis: number; planejados: number; concluidas: number; renovacoes: number; erros: number }; varredura: Awaited<ReturnType<typeof varrerTempo>> };

export async function rodarRotinaDiariaSeHora(agora: Date = new Date(), o: { hora?: number } = {}): Promise<ResultadoRotinaDiaria> {
  const { dia, hora } = agoraEmBrasilia(agora);
  if (hora < (o.hora ?? horaDaRotina())) return { status: "fora-da-hora", dia };
  if (!(await reivindicarDia(dia))) return { status: "ja-rodou", dia };
  // A rotina vem antes: o que ela muda (dono do cartão, "Essa semana") já vale para as automações.
  const r = await rodarRotinaDeEntregas(agora);
  if (r.erros.length) console.error(`[comercial] rotina de entregas: ${r.erros.length} erro(s)`);
  const varredura = await varrerTempo(agora);
  return { status: "rodou", dia, entregas: { ...r, erros: r.erros.length }, varredura };
}
