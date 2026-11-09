// Reunião sem cliente identificado: vincular a uma oportunidade (a transcrição vai para o agente) ou ignorar.
import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada, escolha, texto } from "@/lib/validar";
import { vincularReuniao } from "@/lib/google/reunioes";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  const { id } = await ctx.params;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  const r = await prisma.reuniaoGoogle.findUnique({ where: { id }, select: { status: true, conta: { select: { usuarioId: true } } } });
  if (!r || r.conta.usuarioId !== uid) return Response.json({ erro: "Reunião não encontrada" }, { status: 404 });
  return comEntrada(async () => {
    const operacao = escolha(c.operacao, "operação", ["vincular", "ignorar"] as const);
    if (operacao === "ignorar") {
      await prisma.reuniaoGoogle.update({ where: { id }, data: { status: "IGNORADA" } });
      return Response.json({ ok: true });
    }
    if (r.status !== "SEM_CLIENTE" && r.status !== "IGNORADA") return Response.json({ erro: "Esta reunião já foi vinculada ou não tem transcrição" }, { status: 400 });
    try { await vincularReuniao(id, texto(c.oportunidadeId, "Oportunidade", { min: 1, max: 60 })); }
    catch (e) { return Response.json({ erro: e instanceof Error ? e.message : "Falha ao vincular" }, { status: 400 }); }
    return Response.json({ ok: true });
  });
}
