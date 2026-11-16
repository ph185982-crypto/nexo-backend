import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";
import { comEntrada } from "@/lib/comercial/validar";
import { editarProposta, validarEdicaoProposta } from "@/lib/comercial/propostas/servico";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => ((await editarProposta(id, validarEdicaoProposta(c))) ? Response.json({ ok: true }) : Response.json({ erro: "Proposta não encontrada" }, { status: 404 })));
}
