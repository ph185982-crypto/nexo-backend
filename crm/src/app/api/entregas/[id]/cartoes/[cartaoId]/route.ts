import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { moverCartao } from "@/lib/entrega/servico";
import { COLUNAS, PILARES, type Coluna } from "@/lib/entrega/constantes";
import { normalizarChecklist } from "@/lib/atividades/tarefas";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada, dataOpc, ErroEntrada, escolha, texto, textoOpc } from "@/lib/validar";

type Ctx = { params: Promise<{ id: string; cartaoId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id, cartaoId } = await ctx.params;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const atual = await prisma.entregaCartao.findFirst({ where: { id: cartaoId, entregaId: id }, select: { id: true } });
    if (!atual) return Response.json({ erro: "Cartão não encontrado" }, { status: 404 });
    if (c.coluna !== undefined) {
      const coluna = escolha<Coluna>(c.coluna, "coluna", COLUNAS);
      const posicao = c.posicao === undefined ? undefined : Number(c.posicao);
      if (posicao !== undefined && (!Number.isInteger(posicao) || posicao < 0 || posicao > 1000)) throw new ErroEntrada("posicao inválida");
      await moverCartao(cartaoId, coluna, posicao);
    }
    const dados: Prisma.EntregaCartaoUpdateInput = {
      ...(c.titulo !== undefined && { titulo: texto(c.titulo, "Título", { min: 1, max: 200 }) }),
      ...(c.descricao !== undefined && { descricao: textoOpc(c.descricao, "Descrição", 5000) }),
      ...(c.pilar !== undefined && { pilar: escolha(c.pilar, "pilar", PILARES) }),
      ...(c.dataAlvo !== undefined && { dataAlvo: dataOpc(c.dataAlvo, "Data alvo") }),
      ...(c.checklist !== undefined && { checklist: normalizarChecklist(c.checklist) as unknown as Prisma.InputJsonValue }),
    };
    if (Object.keys(dados).length) await prisma.entregaCartao.update({ where: { id: cartaoId }, data: dados });
    return Response.json({ ok: true });
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id, cartaoId } = await ctx.params;
  const r = await prisma.entregaCartao.deleteMany({ where: { id: cartaoId, entregaId: id } });
  return r.count ? Response.json({ ok: true }) : Response.json({ erro: "Cartão não encontrado" }, { status: 404 });
}
