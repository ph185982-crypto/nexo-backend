import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada } from "@/lib/validar";
import { enviarProposta } from "@/lib/propostas/servico";

export const dynamic = "force-dynamic";

/** Marca como enviada e libera o link público. O envio em si (WhatsApp, e-mail) é feito por quem usa o CRM. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  const { id } = await ctx.params;
  return comEntrada(async () => {
    const u = await prisma.usuario.findUnique({ where: { id: uid }, select: { nome: true } });
    const p = await enviarProposta(id, { id: uid, nome: u?.nome ?? null });
    if (!p) return Response.json({ erro: "Proposta não encontrada" }, { status: 404 });
    return Response.json({ link: `${new URL(req.url).origin}/p/${p.token}` });
  });
}
