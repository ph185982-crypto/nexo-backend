// Mensagens importadas (WhatsApp) das pessoas e da empresa desta oportunidade, para a linha do tempo da ficha.
import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  const op = await prisma.oportunidade.findUnique({ where: { id }, select: { contatoId: true, pessoaId: true, contato: { select: { pessoas: { select: { id: true } } } } } });
  if (!op) return Response.json({ erro: "Oportunidade não encontrada" }, { status: 404 });
  const contatos = [op.contatoId, op.pessoaId, ...op.contato.pessoas.map((p) => p.id)].filter((x): x is string => Boolean(x));
  const mensagens = await prisma.mensagem.findMany({ where: { contatoId: { in: contatos } }, orderBy: { enviadaEm: "desc" }, take: 300, select: { id: true, autor: true, deMim: true, texto: true, enviadaEm: true, origem: true } });
  return Response.json({ mensagens: mensagens.reverse() });
}
