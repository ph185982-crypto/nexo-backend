import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";
import { listarPropostas, STATUS_PROPOSTA } from "@/lib/comercial/propostas/servico";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const status = new URL(req.url).searchParams.get("status");
  if (status && !(STATUS_PROPOSTA as readonly string[]).includes(status)) return Response.json({ erro: "status inválido" }, { status: 400 });
  return Response.json({ propostas: await listarPropostas({ status }) });
}
