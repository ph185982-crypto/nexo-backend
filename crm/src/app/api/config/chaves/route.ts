import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/auth/admin";
import { gerarChave } from "@/lib/integracao/chave";
import { comEntrada, texto } from "@/lib/validar";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  return Response.json({ chaves: await prisma.chaveIntegracao.findMany({ orderBy: { criadaEm: "desc" }, select: { id: true, nome: true, prefixo: true, criadaEm: true, ultimoUsoEm: true, revogadaEm: true } }) });
}

/** A chave inteira só aparece nesta resposta; o banco guarda o hash. */
export async function POST(req: Request) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const nome = texto(c.nome, "Nome", { min: 1, max: 80 });
    const { chave, prefixo, hash } = gerarChave();
    const r = await prisma.chaveIntegracao.create({ data: { nome, prefixo, hash } });
    return Response.json({ id: r.id, chave }, { status: 201 });
  });
}
