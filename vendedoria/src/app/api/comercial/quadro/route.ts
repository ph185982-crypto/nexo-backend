import { montarQuadro } from "@/lib/comercial/funil/quadro";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const funilId = new URL(req.url).searchParams.get("funilId");
  if (!funilId) return Response.json({ erro: "funilId obrigatório" }, { status: 400 });
  const quadro = await montarQuadro(funilId);
  return quadro ? Response.json(quadro) : Response.json({ erro: "Funil não encontrado" }, { status: 404 });
}
