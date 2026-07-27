import { NextRequest, NextResponse } from "next/server";
import { buscarLeadsPorSegmento } from "@/lib/prospeccao/sourcing";

export const maxDuration = 800;

// Estado em memória da busca em andamento (processo único no PM2 fork)
const emAndamento = new Map<string, { iniciadoEm: string }>();
const ultimoResultado = new Map<string, { finalizadoEm: string; resultado: unknown }>();

// POST /api/prospeccao/sourcing/:segmentId — dispara busca de empresas
// Buscas grandes (meta alta) rodam em background para não estourar o timeout.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ segmentId: string }> },
) {
  const { segmentId } = await params;

  if (emAndamento.has(segmentId)) {
    return NextResponse.json(
      { ok: false, error: "Busca já em andamento", ...emAndamento.get(segmentId) },
      { status: 409 },
    );
  }

  emAndamento.set(segmentId, { iniciadoEm: new Date().toISOString() });

  const execucao = buscarLeadsPorSegmento(segmentId)
    .then((resultado) => {
      ultimoResultado.set(segmentId, { finalizadoEm: new Date().toISOString(), resultado });
      console.log(`[Sourcing] Busca concluída para ${segmentId}:`, resultado);
      return resultado;
    })
    .catch((e) => {
      const resultado = { inseridos: 0, ignorados: 0, erros: 1, motivo: String(e).slice(0, 200) };
      ultimoResultado.set(segmentId, { finalizadoEm: new Date().toISOString(), resultado });
      console.error(`[Sourcing] Busca falhou para ${segmentId}:`, e);
      return resultado;
    })
    .finally(() => emAndamento.delete(segmentId));

  // Se terminar rápido (< 8s: erro de config ou poucos resultados), devolve na hora.
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 8_000));
  const rapido = await Promise.race([execucao, timeout]);

  if (rapido) {
    return NextResponse.json({ ok: true, status: "concluido", ...rapido });
  }
  return NextResponse.json({ ok: true, status: "iniciado" }, { status: 202 });
}

// GET /api/prospeccao/sourcing/:segmentId — status da busca
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ segmentId: string }> },
) {
  const { segmentId } = await params;
  return NextResponse.json({
    emAndamento: emAndamento.get(segmentId) ?? null,
    ultimoResultado: ultimoResultado.get(segmentId) ?? null,
  });
}
