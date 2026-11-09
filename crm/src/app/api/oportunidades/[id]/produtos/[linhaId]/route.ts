import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada } from "@/lib/validar";
import { editarLinha, removerLinha, validarLinha } from "@/lib/oportunidades/produtos";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; linhaId: string }> };
const naoAchou = () => Response.json({ erro: "Produto não encontrado nesta oportunidade" }, { status: 404 });

export async function PATCH(req: Request, ctx: Ctx) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id, linhaId } = await ctx.params;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => ((await editarLinha(id, linhaId, await validarLinha(c, true))) ? Response.json({ ok: true }) : naoAchou()));
}

export async function DELETE(req: Request, ctx: Ctx) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id, linhaId } = await ctx.params;
  return (await removerLinha(id, linhaId)) ? Response.json({ ok: true }) : naoAchou();
}
