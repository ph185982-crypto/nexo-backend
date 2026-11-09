import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada } from "@/lib/validar";
import { editarProposta, validarEdicaoProposta } from "@/lib/propostas/servico";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => ((await editarProposta(id, validarEdicaoProposta(c))) ? Response.json({ ok: true }) : Response.json({ erro: "Proposta não encontrada" }, { status: 404 })));
}
