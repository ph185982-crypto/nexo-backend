import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const funis = await prisma.funil.findMany({
    where: { ativo: true },
    orderBy: { ordem: "asc" },
    select: { id: true, nome: true, padrao: true, etapas: { orderBy: { ordem: "asc" }, select: { id: true, nome: true, tipo: true } } },
  });
  return Response.json({ funis });
}
