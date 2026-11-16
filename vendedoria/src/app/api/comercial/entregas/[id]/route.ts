import { detalheEntrega } from "@/lib/comercial/entrega/servico";
import { atualizarEntrega } from "@/lib/comercial/entrega/edicao";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";
import { comEntrada } from "@/lib/comercial/validar";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const e = await detalheEntrega((await ctx.params).id);
  return e ? Response.json(e) : Response.json({ erro: "Entrega não encontrada" }, { status: 404 });
}

export async function PATCH(req: Request, ctx: Ctx) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => (await atualizarEntrega(id, c)) ? Response.json({ ok: true }) : Response.json({ erro: "Entrega não encontrada" }, { status: 404 }));
}
