import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { buscar } from "@/lib/navegacao";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  return Response.json({ resultados: await buscar(new URL(req.url).searchParams.get("q") ?? "") });
}
