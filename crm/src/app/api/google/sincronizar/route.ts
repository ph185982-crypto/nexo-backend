import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { sincronizarConta } from "@/lib/google/reunioes";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** "Sincronizar agora": busca as reuniões novas do Meet do usuário. */
export async function POST(req: Request) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  const conta = await prisma.contaGoogle.findUnique({ where: { usuarioId: uid }, select: { id: true, ativa: true } });
  if (!conta?.ativa) return Response.json({ erro: "Conecte sua conta Google primeiro" }, { status: 400 });
  try {
    return Response.json(await sincronizarConta(conta.id));
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : "Falha ao sincronizar" }, { status: 502 });
  }
}
