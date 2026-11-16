import { prisma } from "@/lib/prisma/client";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";
import { comEntrada, escolha } from "@/lib/comercial/validar";
import { statusParaEvento } from "@/lib/comercial/atividades/compromissos";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  const c = (await req.json().catch(() => null)) as { status?: unknown } | null;
  return comEntrada(async () => {
    const status = escolha(c?.status, "status", ["AGENDADO", "REALIZADO", "CANCELADO"] as const);
    const r = await prisma.calendarEvent.updateMany({ where: { id, OR: [{ oportunidadeId: { not: null } }, { contatoId: { not: null } }, { origem: { not: null } }] }, data: { status: statusParaEvento(status) } });
    return r.count ? Response.json({ ok: true }) : Response.json({ erro: "Compromisso não encontrado" }, { status: 404 });
  });
}
