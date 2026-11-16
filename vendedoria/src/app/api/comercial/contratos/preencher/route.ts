// "Gerar contrato" na ficha da oportunidade: o formulário vem pré-preenchido com contato, pessoa e valor.
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";
import { responder } from "@/lib/comercial/contratos/http";
import { preencherDaOportunidade } from "@/lib/comercial/contratos/servico";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const op = new URL(req.url).searchParams.get("oportunidade");
  if (!op) return Response.json({ erro: "Informe a oportunidade" }, { status: 400 });
  return responder(async () => Response.json({ form: await preencherDaOportunidade(op) }));
}
