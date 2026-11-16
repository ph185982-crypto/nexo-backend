// Consulta de CNPJ do formulário de contrato (SERPRO com SERPRO_TOKEN; senão BrasilAPI).
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";
import { consultarCnpj, validarCnpj } from "@/lib/comercial/contratos/cnpj";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const cnpj = (new URL(req.url).searchParams.get("cnpj") ?? "").replace(/\D/g, "");
  if (!cnpj) return Response.json({ erro: "CNPJ obrigatório" }, { status: 400 });
  if (!validarCnpj(cnpj)) return Response.json({ erro: "CNPJ inválido" }, { status: 400 });
  const d = await consultarCnpj(cnpj);
  return d ? Response.json(d, { headers: { "cache-control": "no-store" } }) : Response.json({ erro: "CNPJ não encontrado na Receita Federal" }, { status: 404 });
}
