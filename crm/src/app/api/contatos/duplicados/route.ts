import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { acharDuplicados } from "@/lib/contatos/servico";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  return Response.json({ grupos: await acharDuplicados() });
}
