import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { gerarResumo, SemChave } from "@/lib/oportunidades/resumo";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Gera (ou refaz) o resumo da IA. Leva alguns segundos: a tela mostra "gerando…". */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  try {
    const r = await gerarResumo(id);
    if (!r) return Response.json({ erro: "Oportunidade não encontrada" }, { status: 404 });
    return Response.json({ resumo: r });
  } catch (e) {
    if (e instanceof SemChave) return Response.json({ erro: "O resumo da IA precisa da chave ANTHROPIC_API_KEY no CRM" }, { status: 503 });
    console.error("[resumo]", e);
    return Response.json({ erro: "Não foi possível gerar o resumo agora. Tente de novo em instantes." }, { status: 502 });
  }
}
