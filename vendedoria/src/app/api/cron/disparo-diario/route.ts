import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { executarDisparoDiario, incrementarWarmupSemanal, getHoraBRT } from "@/lib/prospeccao/disparo";
import { criarOrcamento, enfileirar } from "@/lib/jobs/fila";

// Teto da função. A fila que não couber aqui é retomada numa nova invocação.
export const maxDuration = 60;

/**
 * Aceita as três formas de chamada: o cron da Vercel (Authorization: Bearer),
 * um cron externo (?secret=) e o encadeamento interno (x-cron-secret).
 */
function autorizado(req: NextRequest): boolean {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) return false;

  const auth = req.headers.get("authorization");
  const header = req.headers.get("x-cron-secret");
  const query = new URL(req.url).searchParams.get("secret");

  return auth === `Bearer ${esperado}` || header === esperado || query === esperado;
}

async function executar(req: NextRequest, continuacao: boolean, esperarSegundos = 0) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgsProspeccao = await prisma.whatsappBusinessOrganization.findMany({
    where: { tipo: "PROSPECCAO", status: "ACTIVE" },
    select: { id: true },
  });

  const resultados: Record<string, unknown> = {};
  const { diaSemana } = getHoraBRT();
  const ehSexta = diaSemana === 5;

  // O warm-up é semanal e só deve subir uma vez, na primeira leva do dia —
  // por isso as continuações encadeadas não mexem nele.
  // Sem QStash o agendador não honra atraso: quem recebe a continuação espera,
  // para o intervalo entre envios não ser pulado.
  const espera = Math.min(Math.max(esperarSegundos, 0), 25);
  if (espera > 0) await new Promise((r) => setTimeout(r, espera * 1_000));
  const orcamento = criarOrcamento(maxDuration - espera);

  let restantesTotais = 0;
  let esperaSegundos = 0;

  for (const org of orgsProspeccao) {
    const resultado = await executarDisparoDiario(org.id, orcamento);
    resultados[org.id] = resultado;

    restantesTotais += resultado.restantes;
    esperaSegundos = Math.max(esperaSegundos, resultado.esperaSegundos ?? 0);

    if (ehSexta && !continuacao) {
      await incrementarWarmupSemanal(org.id);
      (resultados[org.id] as Record<string, unknown>).warmupIncrementado = true;
    }

    // Invocação sem fôlego: as orgs restantes ficam para a continuação.
    if (orcamento.estourou()) break;
  }

  let reagendado = false;
  if (restantesTotais > 0) {
    const fila = await enfileirar("/api/cron/disparo-diario", {
      delaySegundos: esperaSegundos,
      corpo: { continuacao: true },
    });
    reagendado = fila.ok;

    if (!fila.atrasoHonrado) {
      console.warn(
        `[Disparo] Continuação agendada sem atraso real (via ${fila.via}) — ` +
          "configure QSTASH_TOKEN para respeitar o intervalo anti-bloqueio.",
      );
    }
  }

  return NextResponse.json({
    ok: true,
    orgsProcessadas: orgsProspeccao.length,
    restantes: restantesTotais,
    reagendado,
    resultados,
  });
}

// GET — cron da Vercel e crons externos: sempre a primeira leva do dia.
export async function GET(req: NextRequest) {
  return executar(req, false);
}

// POST — continuação encadeada (QStash ou self-fetch).
export async function POST(req: NextRequest) {
  const corpo = await req.json().catch(() => ({}));
  const c = corpo as { continuacao?: boolean; esperarSegundos?: number };
  return executar(req, Boolean(c.continuacao), Number(c.esperarSegundos) || 0);
}
