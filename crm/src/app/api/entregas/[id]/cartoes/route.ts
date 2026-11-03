import { prisma } from "@/lib/prisma";
import { criarCartao } from "@/lib/entrega/servico";
import { COLUNAS, PILARES, type Coluna } from "@/lib/entrega/constantes";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada, dataOpc, escolha, texto, textoOpc } from "@/lib/validar";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    if (!(await prisma.entrega.findUnique({ where: { id }, select: { id: true } }))) return Response.json({ erro: "Entrega não encontrada" }, { status: 404 });
    const cartao = await criarCartao({
      entregaId: id, titulo: texto(c.titulo, "Título", { min: 1, max: 200 }), descricao: textoOpc(c.descricao, "Descrição", 5000),
      pilar: escolha(c.pilar, "pilar", PILARES, "COMERCIAL"), coluna: escolha<Coluna>(c.coluna, "coluna", COLUNAS, "BACKLOG"),
      dataAlvo: dataOpc(c.dataAlvo, "Data alvo"), cliente: c.cliente === true, checklist: c.checklist,
    });
    return Response.json({ id: cartao.id }, { status: 201 });
  });
}
