import { NextRequest, NextResponse } from "next/server";
import { executarDisparoDiario } from "@/lib/prospeccao/disparo";

// Estado em memória do disparo em andamento (processo único no PM2 fork mode)
const emAndamento = new Map<string, { iniciadoEm: string }>();
const ultimoResultado = new Map<string, { finalizadoEm: string; resultado: unknown }>();

// POST /api/prospeccao/disparo/executar/:organizationId
// Retorna 202 imediatamente — o loop de disparo tem delays de 30-90s por lead
// e estouraria o timeout do Nginx se fosse síncrono.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await params;

  if (emAndamento.has(organizationId)) {
    return NextResponse.json(
      { ok: false, error: "Disparo já em andamento", ...emAndamento.get(organizationId) },
      { status: 409 },
    );
  }

  emAndamento.set(organizationId, { iniciadoEm: new Date().toISOString() });

  const execucao = executarDisparoDiario(organizationId)
    .then((resultado) => {
      ultimoResultado.set(organizationId, { finalizadoEm: new Date().toISOString(), resultado });
      console.log(`[Disparo] Rodada manual concluída para ${organizationId}:`, resultado);
      return resultado;
    })
    .catch((e) => {
      const resultado = { disparados: 0, ignorados: 0, erros: 1, motivo: `erro interno: ${String(e).slice(0, 200)}` };
      ultimoResultado.set(organizationId, { finalizadoEm: new Date().toISOString(), resultado });
      console.error(`[Disparo] Rodada manual falhou para ${organizationId}:`, e);
      return resultado;
    })
    .finally(() => emAndamento.delete(organizationId));

  // Se um gate bloquear (pausa, janela, template, leads…), executarDisparoDiario
  // retorna em <5s com `motivo` — devolve isso ao usuário na hora em vez de 202 mudo.
  // Se realmente começou a disparar (delays de 30-90s/lead), responde 202 e segue em background.
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 5_000));
  const rapido = await Promise.race([execucao, timeout]);

  if (rapido) {
    const bloqueado = rapido.disparados === 0 && rapido.motivo;
    return NextResponse.json(
      { ok: !bloqueado, status: "concluido", ...rapido },
      { status: bloqueado ? 422 : 200 },
    );
  }

  return NextResponse.json({ ok: true, status: "iniciado" }, { status: 202 });
}

// GET /api/prospeccao/disparo/executar/:organizationId — status da rodada
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await params;
  return NextResponse.json({
    emAndamento: emAndamento.get(organizationId) ?? null,
    ultimoResultado: ultimoResultado.get(organizationId) ?? null,
  });
}
