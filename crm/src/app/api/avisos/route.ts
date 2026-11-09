import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { avisosDoUsuario } from "@/lib/navegacao";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  return Response.json({ avisos: await avisosDoUsuario(uid) });
}
