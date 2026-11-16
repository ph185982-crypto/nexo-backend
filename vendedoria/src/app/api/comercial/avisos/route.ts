import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";
import { avisosDoUsuario } from "@/lib/comercial/navegacao";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  return Response.json({ avisos: await avisosDoUsuario(uid) });
}
