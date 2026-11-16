import { prisma } from "@/lib/prisma/client";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";
import { comEntrada } from "@/lib/comercial/validar";
import { criarProposta, propostasDaOportunidade } from "@/lib/comercial/propostas/servico";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  const op = await prisma.comOportunidade.findUnique({ where: { id }, select: { contato: { select: { telefone: true } }, pessoa: { select: { telefone: true, nome: true } } } });
  if (!op) return Response.json({ erro: "Oportunidade não encontrada" }, { status: 404 });
  return Response.json({ propostas: await propostasDaOportunidade(id), telefone: op.pessoa?.telefone ?? op.contato.telefone ?? null });
}

/** Nova proposta (ou nova versão) a partir dos produtos de agora. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  const { id } = await ctx.params;
  return comEntrada(async () => {
    const u = await prisma.user.findUnique({ where: { id: uid }, select: { name: true } }).then((x) => (x ? { nome: x.name } : null));
    const p = await criarProposta(id, { id: uid, nome: u?.nome ?? null });
    if (!p) return Response.json({ erro: "Oportunidade não encontrada" }, { status: 404 });
    return Response.json({ id: p.id }, { status: 201 });
  });
}
