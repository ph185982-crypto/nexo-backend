import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";
import { acharDuplicados } from "@/lib/comercial/contatos/servico";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  return Response.json({ grupos: await acharDuplicados() });
}
