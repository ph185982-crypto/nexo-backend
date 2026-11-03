import { prisma } from "@/lib/prisma";
import { atualizarAutomacao } from "@/lib/automacao/servico";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada } from "@/lib/validar";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const corpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!corpo) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const r = await atualizarAutomacao((await ctx.params).id, corpo);
    return r ? Response.json({ ok: true }) : Response.json({ erro: "Automação não encontrada" }, { status: 404 });
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const r = await prisma.automacao.deleteMany({ where: { id: (await ctx.params).id } });
  return r.count ? Response.json({ ok: true }) : Response.json({ erro: "Automação não encontrada" }, { status: 404 });
}
