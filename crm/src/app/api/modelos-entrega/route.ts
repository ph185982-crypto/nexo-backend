import { listarModelos } from "@/lib/entrega/modelo";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const modelos = await listarModelos();
  return Response.json({ modelos });
}
