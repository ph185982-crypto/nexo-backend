import { prisma } from "@/lib/prisma/client";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const funis = await prisma.comFunil.findMany({
    where: { ativo: true },
    orderBy: { ordem: "asc" },
    select: { id: true, nome: true, padrao: true, etapas: { orderBy: { ordem: "asc" }, select: { id: true, nome: true, tipo: true } } },
  });
  return Response.json({ funis });
}
