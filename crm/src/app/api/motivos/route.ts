import { listarMotivos } from "@/lib/funil/motivos";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const tipo = new URL(req.url).searchParams.get("tipo");
  if (tipo && tipo !== "GANHO" && tipo !== "PERDA") return Response.json({ erro: "tipo deve ser GANHO ou PERDA" }, { status: 400 });
  const motivos = await listarMotivos(tipo);
  return Response.json({ motivos: motivos.map((m) => ({ id: m.id, tipo: m.tipo, nome: m.nome })) });
}
