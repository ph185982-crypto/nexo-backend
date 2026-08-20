import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { executarDisparoDiario } from "@/lib/prospeccao/disparo";
import { criarOrcamento, enfileirar } from "@/lib/jobs/fila";

// Teto da função. O que não couber fica na fila e sai numa nova invocação.
export const maxDuration = 60;

/** Janela usada para resumir a última rodada quando a fila já esvaziou. */
const HORAS_RESUMO = 6;

function pendentes(organizationId: string) {
  return prisma.disparoJob.count({
    where: { organizationId, status: { in: ["QUEUED", "RUNNING"] } },
  });
}

/**
 * POST /api/prospeccao/disparo/executar/:organizationId
 *
 * Envia o que couber no orçamento da invocação. Como há intervalo de 30–90s
 * entre mensagens, uma rodada grande não cabe numa função só: o restante fica
 * na fila DisparoJob e uma continuação é agendada.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await params;

  if (await pendentes(organizationId) > 0) {
    return NextResponse.json(
      { ok: false, error: "Disparo já em andamento" },
      { status: 409 },
    );
  }

  const orcamento = criarOrcamento(maxDuration);

  try {
    const resultado = await executarDisparoDiario(organizationId, orcamento);

    // Gate bloqueou (pausa manual, fora da janela, sem template, sem lead…)
    if (resultado.disparados === 0 && resultado.motivo) {
      return NextResponse.json({ ok: false, status: "concluido", ...resultado }, { status: 422 });
    }

    if (resultado.restantes > 0) {
      const fila = await enfileirar("/api/cron/disparo-diario", {
        delaySegundos: resultado.esperaSegundos ?? 0,
        corpo: { continuacao: true },
      });

      if (!fila.ok) {
        return NextResponse.json(
          { ok: false, error: "Rodada iniciada, mas a continuação não pôde ser agendada", ...resultado },
          { status: 500 },
        );
      }

      return NextResponse.json({ ok: true, status: "em_andamento", ...resultado }, { status: 202 });
    }

    return NextResponse.json({ ok: true, status: "concluido", ...resultado });
  } catch (e) {
    const motivo = `erro interno: ${String(e).slice(0, 200)}`;
    console.error(`[Disparo] Rodada manual falhou para ${organizationId}:`, e);
    return NextResponse.json({ ok: false, error: motivo }, { status: 500 });
  }
}

/** GET /api/prospeccao/disparo/executar/:organizationId — status da rodada. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await params;
  const desde = new Date(Date.now() - HORAS_RESUMO * 60 * 60_000);

  const [restantes, enviados, falhos] = await Promise.all([
    pendentes(organizationId),
    prisma.disparoJob.count({
      where: { organizationId, status: "DONE", atualizadoEm: { gte: desde } },
    }),
    prisma.disparoJob.count({
      where: { organizationId, status: "FAILED", atualizadoEm: { gte: desde } },
    }),
  ]);

  return NextResponse.json({
    emAndamento: restantes > 0 ? { restantes } : null,
    ultimoResultado:
      restantes === 0 && (enviados > 0 || falhos > 0)
        ? { resultado: { disparados: enviados, erros: falhos } }
        : null,
  });
}
