import { criarCartaoValidado } from "@/lib/comercial/entrega/edicao";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";
import { comEntrada } from "@/lib/comercial/validar";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const r = await criarCartaoValidado(id, c);
    return r ? Response.json({ id: r.id }, { status: 201 }) : Response.json({ erro: "Entrega não encontrada" }, { status: 404 });
  });
}
