import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { reprocessar } from "@/lib/combinados/fontes";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const ok = await reprocessar((await ctx.params).id);
  return ok ? Response.json({ ok: true }, { status: 202 }) : Response.json({ erro: "Só uma análise com erro (ou sem chave) pode ser refeita" }, { status: 400 });
}
