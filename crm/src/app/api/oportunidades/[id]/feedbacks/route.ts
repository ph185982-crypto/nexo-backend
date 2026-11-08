import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { calcularSaude, registrarFeedback } from "@/lib/atividades/feedback";
import { INTENCOES, TIPOS_FEEDBACK, type Intencao } from "@/lib/atividades/intencoes";
import { diasDesde } from "@/lib/funil/encerramento";
import { comEntrada, escolha, texto } from "@/lib/validar";
import { registrarFonte } from "@/lib/combinados/fontes";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // o agente de combinados lê o feedback depois da resposta

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  const op = await prisma.oportunidade.findUnique({ where: { id }, select: { ultimaAtividadeEm: true } });
  if (!op) return Response.json({ erro: "Oportunidade não encontrada" }, { status: 404 });
  const feedbacks = await prisma.feedback.findMany({ where: { oportunidadeId: id }, orderBy: { criadoEm: "desc" }, take: 100 });
  const recentes = feedbacks.filter((f) => f.criadoEm.getTime() > Date.now() - 30 * 86_400_000).map((f) => f.intencao);
  return Response.json({ feedbacks, saude: calcularSaude(recentes, diasDesde(op.ultimaAtividadeEm)) });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  const { id } = await ctx.params;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    if (!(await prisma.oportunidade.findUnique({ where: { id }, select: { id: true } }))) return Response.json({ erro: "Oportunidade não encontrada" }, { status: 404 });
    const usuario = await prisma.usuario.findUnique({ where: { id: uid }, select: { nome: true } });
    const f = await registrarFeedback({
      oportunidadeId: id, tipo: escolha(c.tipo, "tipo", TIPOS_FEEDBACK.filter((t) => t !== "SISTEMA"), "NOTA"),
      texto: texto(c.texto, "Texto", { min: 1, max: 5000 }),
      intencao: c.intencao ? (escolha(c.intencao, "intenção", INTENCOES) as Intencao) : null,
      importante: c.importante === true, autor: uid, autorNome: usuario?.nome ?? null,
    });
    // O agente procura combinados no que a pessoa escreveu (em segundo plano; texto curto é ignorado).
    await registrarFonte({ oportunidadeId: id, fonte: "FEEDBACK", fonteRef: f.id, texto: f.texto });
    return Response.json({ id: f.id }, { status: 201 });
  });
}
