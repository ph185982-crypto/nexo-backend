import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { processarLoteSourcing, type EstadoSourcing } from "@/lib/prospeccao/sourcing";
import { criarOrcamento, enfileirar } from "@/lib/jobs/fila";

// Teto de duração da função. Cada lote para antes disso e encadeia o próximo.
export const maxDuration = 60;

/** Uma execução parada há mais que isso é considerada órfã e pode ser retomada. */
const MINUTOS_ATE_ORFA = 5;

function estadoDe(run: { indice: number; inseridos: number; ignorados: number; erros: number }): EstadoSourcing {
  return {
    indice: run.indice,
    inseridos: run.inseridos,
    ignorados: run.ignorados,
    erros: run.erros,
  };
}

async function execucaoAtiva(segmentId: string) {
  return prisma.sourcingRun.findFirst({
    where: { segmentId, status: "EXECUTANDO" },
    orderBy: { iniciadoEm: "desc" },
  });
}

/**
 * POST /api/prospeccao/sourcing/:segmentId — inicia ou continua uma busca.
 *
 * Buscas grandes não cabem numa invocação, então o progresso vive na tabela
 * SourcingRun e cada chamada processa um lote e agenda a continuação. O corpo
 * `{ continuar: true }` marca as chamadas que a própria aplicação encadeia.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ segmentId: string }> },
) {
  const { segmentId } = await params;

  const corpo = await req.json().catch(() => ({}));
  const continuando = Boolean((corpo as { continuar?: boolean }).continuar);

  const ativa = await execucaoAtiva(segmentId);
  const limiteOrfa = new Date(Date.now() - MINUTOS_ATE_ORFA * 60_000);

  let run = ativa;

  if (!continuando) {
    // Pedido novo enquanto outra busca corre: recusa, a menos que esteja órfã.
    if (ativa && ativa.atualizadoEm > limiteOrfa) {
      return NextResponse.json(
        {
          ok: false,
          error: "Busca já em andamento",
          runId: ativa.id,
          iniciadoEm: ativa.iniciadoEm,
          inseridos: ativa.inseridos,
        },
        { status: 409 },
      );
    }

    if (ativa) {
      await prisma.sourcingRun.update({
        where: { id: ativa.id },
        data: { status: "ERRO", motivo: "Execução órfã substituída", finalizadoEm: new Date() },
      });
    }

    const segment = await prisma.prospectSegment.findUnique({
      where: { id: segmentId },
      select: { metaEmpresas: true },
    });

    run = await prisma.sourcingRun.create({
      data: { segmentId, meta: segment?.metaEmpresas ?? 200 },
    });
  }

  if (!run) {
    return NextResponse.json(
      { ok: false, error: "Nenhuma busca em andamento para continuar" },
      { status: 404 },
    );
  }

  const orcamento = criarOrcamento(maxDuration);

  try {
    const { estado, concluido, combinacoes } = await processarLoteSourcing(
      segmentId,
      estadoDe(run),
      orcamento,
    );

    const atualizado = await prisma.sourcingRun.update({
      where: { id: run.id },
      data: {
        ...estado,
        lotes: { increment: 1 },
        status: concluido ? "CONCLUIDO" : "EXECUTANDO",
        finalizadoEm: concluido ? new Date() : null,
      },
    });

    if (concluido) {
      console.log(
        `[Sourcing] Busca ${run.id} concluída — inseridos=${estado.inseridos} ignorados=${estado.ignorados} erros=${estado.erros}`,
      );
      return NextResponse.json({
        ok: true,
        status: "concluido",
        runId: run.id,
        inseridos: estado.inseridos,
        ignorados: estado.ignorados,
        erros: estado.erros,
      });
    }

    // Ainda há combinações: agenda o próximo lote.
    const fila = await enfileirar(`/api/prospeccao/sourcing/${segmentId}`, {
      corpo: { continuar: true },
    });

    if (!fila.ok) {
      await prisma.sourcingRun.update({
        where: { id: run.id },
        data: {
          status: "ERRO",
          motivo: `Falha ao encadear próximo lote: ${fila.erro ?? "desconhecida"}`,
          finalizadoEm: new Date(),
        },
      });
      return NextResponse.json(
        { ok: false, error: "Não foi possível continuar a busca", runId: run.id },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        status: "em_andamento",
        runId: run.id,
        progresso: `${atualizado.indice}/${combinacoes}`,
        inseridos: estado.inseridos,
      },
      { status: 202 },
    );
  } catch (e) {
    const motivo = String(e).slice(0, 200);
    console.error(`[Sourcing] Busca ${run.id} falhou:`, e);

    await prisma.sourcingRun.update({
      where: { id: run.id },
      data: { status: "ERRO", motivo, finalizadoEm: new Date() },
    });

    return NextResponse.json({ ok: false, error: motivo, runId: run.id }, { status: 500 });
  }
}

/** GET /api/prospeccao/sourcing/:segmentId — progresso da busca. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ segmentId: string }> },
) {
  const { segmentId } = await params;

  const [ativa, ultima] = await Promise.all([
    execucaoAtiva(segmentId),
    prisma.sourcingRun.findFirst({
      where: { segmentId, status: { in: ["CONCLUIDO", "ERRO"] } },
      orderBy: { finalizadoEm: "desc" },
    }),
  ]);

  return NextResponse.json({
    emAndamento: ativa
      ? {
          runId: ativa.id,
          iniciadoEm: ativa.iniciadoEm,
          atualizadoEm: ativa.atualizadoEm,
          inseridos: ativa.inseridos,
          ignorados: ativa.ignorados,
          erros: ativa.erros,
          meta: ativa.meta,
          lotes: ativa.lotes,
        }
      : null,
    ultimoResultado: ultima
      ? {
          runId: ultima.id,
          finalizadoEm: ultima.finalizadoEm,
          status: ultima.status,
          motivo: ultima.motivo,
          resultado: {
            inseridos: ultima.inseridos,
            ignorados: ultima.ignorados,
            erros: ultima.erros,
          },
        }
      : null,
  });
}
