import { comChaveAvanteza, corpoJson } from "@/lib/integracao/avanteza";
import { criarCartaoValidado } from "@/lib/entrega/edicao";

/** Corpo: titulo (obrigatório), descricao, pilar, coluna, dataAlvo, cliente, responsavelId, checklist [{texto, feito}]. */
export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) => comChaveAvanteza(req, async () => {
  const { id } = await ctx.params;
  const r = await criarCartaoValidado(id, await corpoJson(req));
  return r ? Response.json({ id: r.id }, { status: 201 }) : Response.json({ erro: "Entrega não encontrada" }, { status: 404 });
});
