import { criarUpsell } from "@/lib/entrega/servico";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  try {
    const op = await criarUpsell((await ctx.params).id, uid);
    return Response.json({ oportunidadeId: op.id }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro";
    return Response.json({ erro: msg }, { status: /não encontrada/.test(msg) ? 404 : 400 });
  }
}
