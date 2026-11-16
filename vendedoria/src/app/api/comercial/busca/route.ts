import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";
import { buscar } from "@/lib/comercial/navegacao";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  return Response.json({ resultados: await buscar(new URL(req.url).searchParams.get("q") ?? "") });
}
