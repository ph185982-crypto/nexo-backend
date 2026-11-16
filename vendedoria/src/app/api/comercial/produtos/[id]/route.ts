import { prisma } from "@/lib/prisma/client";
import { exigirAdmin } from "@/lib/comercial/auth/admin";
import { comEntrada } from "@/lib/comercial/validar";
import { validarProduto } from "@/lib/comercial/oportunidades/produtos";

export const dynamic = "force-dynamic";

/** Editar o catálogo não muda oportunidades que já têm o produto (a linha guarda o valor da época). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  const { id } = await ctx.params;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const d = validarProduto(c, true);
    if (d.nome && (await prisma.comProduto.findFirst({ where: { nome: d.nome, NOT: { id } } }))) return Response.json({ erro: "Já existe produto com esse nome" }, { status: 409 });
    const r = await prisma.comProduto.updateMany({ where: { id }, data: d });
    return r.count ? Response.json({ ok: true }) : Response.json({ erro: "Produto não encontrado" }, { status: 404 });
  });
}
