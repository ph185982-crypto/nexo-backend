import { comChaveAvanteza } from "@/lib/comercial/integracao/avanteza";
import { atualizarEntrega } from "@/lib/comercial/entrega/edicao";

/** Marca a entrega como concluída (dispara "Entrega concluída"). */
export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) => comChaveAvanteza(req, async () => {
  const { id } = await ctx.params;
  return (await atualizarEntrega(id, { status: "CONCLUIDA" })) ? Response.json({ ok: true }) : Response.json({ erro: "Entrega não encontrada" }, { status: 404 });
});
