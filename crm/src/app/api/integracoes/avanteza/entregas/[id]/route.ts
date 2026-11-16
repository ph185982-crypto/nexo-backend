import { comChaveAvanteza, corpoJson } from "@/lib/integracao/avanteza";
import { detalheEntrega } from "@/lib/entrega/servico";
import { atualizarEntrega } from "@/lib/entrega/edicao";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = (req: Request, ctx: Ctx) => comChaveAvanteza(req, async () => {
  const e = await detalheEntrega((await ctx.params).id);
  return e ? Response.json(e) : Response.json({ erro: "Entrega não encontrada" }, { status: 404 });
});

/** Corpo: status, renovacaoEm, fimPrevistoEm, diagnostico { PILAR: texto }. */
export const PATCH = (req: Request, ctx: Ctx) => comChaveAvanteza(req, async () => {
  const { id } = await ctx.params;
  const c = await corpoJson(req);
  return (await atualizarEntrega(id, c)) ? Response.json({ ok: true }) : Response.json({ erro: "Entrega não encontrada" }, { status: 404 });
});
