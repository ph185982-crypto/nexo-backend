// "Analisar texto": a pessoa cola uma transcrição de reunião (ou qualquer texto) e o agente procura combinados.
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada, escolha, texto } from "@/lib/validar";
import { registrarFonte } from "@/lib/combinados/fontes";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // a análise roda depois da resposta, dentro desta mesma função

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    if (!(await prisma.oportunidade.findUnique({ where: { id }, select: { id: true } }))) return Response.json({ erro: "Oportunidade não encontrada" }, { status: 404 });
    const t = texto(c.texto, "Texto", { min: 20, max: 200_000 });
    const fonte = escolha(c.fonte, "fonte", ["REUNIAO", "TEXTO"] as const, "TEXTO");
    const a = await registrarFonte({ oportunidadeId: id, fonte, fonteRef: createHash("sha256").update(t).digest("hex").slice(0, 32), texto: t });
    return Response.json({ analiseId: a!.id, status: a!.status }, { status: 202 });
  });
}
