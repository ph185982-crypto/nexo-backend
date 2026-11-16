import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma/client";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";
import { concluirTarefa, normalizarChecklist, PRIORIDADES } from "@/lib/comercial/atividades/tarefas";
import { comEntrada, dataOpc, escolha, texto } from "@/lib/comercial/validar";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const atual = await prisma.comTarefa.findUnique({ where: { id } });
    if (!atual) return Response.json({ erro: "Tarefa não encontrada" }, { status: 404 });
    if (c.acao === "concluir") {
      const r = await concluirTarefa(id);
      return Response.json({ ok: true, proximaId: r.proxima?.id ?? null });
    }
    if (c.acao === "reabrir") {
      await prisma.comTarefa.update({ where: { id }, data: { status: "ABERTA", concluidaEm: null } });
      return Response.json({ ok: true });
    }
    if (c.acao === "cancelar") {
      await prisma.comTarefa.update({ where: { id }, data: { status: "CANCELADA" } });
      return Response.json({ ok: true });
    }
    await prisma.comTarefa.update({
      where: { id },
      data: {
        ...(c.titulo !== undefined && { titulo: texto(c.titulo, "Título", { min: 1, max: 200 }) }),
        ...(c.prioridade !== undefined && { prioridade: escolha(c.prioridade, "prioridade", PRIORIDADES) }),
        ...(c.prazoEm !== undefined && { prazoEm: dataOpc(c.prazoEm, "Prazo") }),
        ...(c.checklist !== undefined && { checklist: normalizarChecklist(c.checklist) as unknown as Prisma.InputJsonValue }),
      },
    });
    return Response.json({ ok: true });
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  const r = await prisma.comTarefa.deleteMany({ where: { id } });
  return r.count ? Response.json({ ok: true }) : Response.json({ erro: "Tarefa não encontrada" }, { status: 404 });
}
