import { prisma } from "@/lib/prisma";
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { comEntrada, escolha } from "@/lib/validar";
import { validarEdicao } from "@/lib/combinados/modelo";
import { aceitarCombinado, descartarCombinado, editarCombinado, marcarEntregue } from "@/lib/combinados/servico";

export const dynamic = "force-dynamic";
const OPERACOES = ["aceitar", "descartar", "entregue", "editar"] as const;

/** { operacao: "aceitar" | "descartar" | "entregue" | "editar", ...campos (descricao, prazoEm, responsavel, tipo, pilar) } */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  const { id } = await ctx.params;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    if (!(await prisma.combinado.findUnique({ where: { id }, select: { id: true } }))) return Response.json({ erro: "Combinado não encontrado" }, { status: 404 });
    const operacao = escolha(c.operacao, "operação", OPERACOES);
    const campos = validarEdicao(c);
    if (operacao === "aceitar") return Response.json(await aceitarCombinado(id, uid, campos));
    if (operacao === "descartar") { await descartarCombinado(id, uid); return Response.json({ ok: true }); }
    if (operacao === "entregue") return Response.json(await marcarEntregue(id));
    return Response.json(await editarCombinado(id, campos));
  });
}
