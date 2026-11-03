import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";

export const dynamic = "force-dynamic";
const POR_PAGINA = 25;

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const u = new URL(req.url).searchParams;
  const q = u.get("q")?.trim();
  const pagina = Math.max(1, Number(u.get("pagina")) || 1);
  const tipo = u.get("tipo");
  const where = {
    ...(tipo === "EMPRESA" || tipo === "PESSOA" ? { tipo } : {}),
    ...(q ? { OR: [{ nome: { contains: q, mode: "insensitive" as const } }, { telefone: { contains: q.replace(/\D/g, "") || "§" } }, { email: { contains: q, mode: "insensitive" as const } }] } : {}),
  };
  const [total, itens] = await Promise.all([
    prisma.contato.count({ where }),
    prisma.contato.findMany({
      where, orderBy: { criadoEm: "desc" }, skip: (pagina - 1) * POR_PAGINA, take: POR_PAGINA,
      select: { id: true, tipo: true, nome: true, telefone: true, email: true, segmento: true, cicloDeVida: true, empresa: { select: { nome: true } }, _count: { select: { oportunidades: true } } },
    }),
  ]);
  return Response.json({ total, pagina, porPagina: POR_PAGINA, itens });
}
