import { exigirAdmin } from "@/lib/auth/admin";
import { criarEtapa } from "@/lib/config/funis";
import { comEntrada, escolha, texto, textoOpc } from "@/lib/validar";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const e = await criarEtapa((await ctx.params).id, { nome: texto(c.nome, "Nome", { min: 1, max: 80 }), tipo: escolha(c.tipo, "tipo", ["ABERTA", "GANHA", "PERDIDA"] as const, "ABERTA"), descricao: textoOpc(c.descricao, "Descrição", 1000) });
    return e ? Response.json({ id: e.id }, { status: 201 }) : Response.json({ erro: "Funil não encontrado" }, { status: 404 });
  });
}
