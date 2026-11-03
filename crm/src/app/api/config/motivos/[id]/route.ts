import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/auth/admin";
import { comEntrada, ErroEntrada, texto } from "@/lib/validar";

/** Motivo não se apaga (o histórico aponta para ele): desativa e some da lista de escolha. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    try {
      await prisma.motivoEncerramento.update({ where: { id: (await ctx.params).id }, data: { ...(c.nome !== undefined && { nome: texto(c.nome, "Nome", { min: 1, max: 80 }) }), ...(c.ativo !== undefined && { ativo: c.ativo === true }) } });
      return Response.json({ ok: true });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === "P2025") return Response.json({ erro: "Motivo não encontrado" }, { status: 404 });
        if (e.code === "P2002") throw new ErroEntrada("Já existe um motivo com esse nome");
      }
      throw e;
    }
  });
}
