import { listarModelos } from "@/lib/comercial/entrega/modelo";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const modelos = await listarModelos();
  return Response.json({ modelos });
}
