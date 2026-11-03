import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/auth/admin";
import { garantirMotivosPadrao } from "@/lib/funil/motivos";
import { comEntrada, ErroEntrada, escolha, texto } from "@/lib/validar";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  await garantirMotivosPadrao();
  const motivos = await prisma.motivoEncerramento.findMany({ orderBy: [{ tipo: "asc" }, { ordem: "asc" }, { nome: "asc" }], include: { _count: { select: { oportunidades: true } } } });
  return Response.json({ motivos: motivos.map((m) => ({ id: m.id, tipo: m.tipo, nome: m.nome, ativo: m.ativo, usos: m._count.oportunidades })) });
}

export async function POST(req: Request) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const tipo = escolha(c.tipo, "tipo", ["GANHO", "PERDA"] as const), nome = texto(c.nome, "Nome", { min: 1, max: 80 });
    try {
      const ultimo = await prisma.motivoEncerramento.aggregate({ where: { tipo }, _max: { ordem: true } });
      const m = await prisma.motivoEncerramento.create({ data: { tipo, nome, ordem: (ultimo._max.ordem ?? -1) + 1 } });
      return Response.json({ id: m.id }, { status: 201 });
    } catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ErroEntrada("Já existe um motivo com esse nome"); throw e; }
  });
}
