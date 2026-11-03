import { moverOportunidade } from "@/lib/funil/mover";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  const { id } = await ctx.params;
  const c = (await req.json().catch(() => null)) as { etapaId?: string; motivoId?: string | null; motivoDetalhe?: string | null } | null;
  if (!c?.etapaId) return Response.json({ erro: "etapaId obrigatório" }, { status: 400 });
  try {
    const r = await moverOportunidade({ oportunidadeId: id, etapaId: c.etapaId, origem: "MANUAL", ator: uid, motivoId: c.motivoId, motivoDetalhe: c.motivoDetalhe });
    return Response.json({ mudou: r.mudou });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao mover";
    return Response.json({ erro: msg }, { status: /não encontrad/i.test(msg) ? 404 : 400 });
  }
}
