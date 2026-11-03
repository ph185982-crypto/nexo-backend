import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const modelos = await prisma.modeloEntrega.findMany({ orderBy: { nome: "asc" }, include: { itens: { orderBy: { ordem: "asc" } } } });
  return Response.json({ modelos });
}
