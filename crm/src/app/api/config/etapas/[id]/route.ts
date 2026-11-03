import { exigirAdmin } from "@/lib/auth/admin";
import { atualizarEtapa, excluirEtapa } from "@/lib/config/funis";
import { comEntrada, texto, textoOpc } from "@/lib/validar";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const r = await atualizarEtapa((await ctx.params).id, {
      ...(c.nome !== undefined && { nome: texto(c.nome, "Nome", { min: 1, max: 80 }) }),
      ...(c.tipo !== undefined && { tipo: String(c.tipo) }),
      ...(c.descricao !== undefined && { descricao: textoOpc(c.descricao, "Descrição", 1000) }),
    });
    return r ? Response.json({ ok: true }) : Response.json({ erro: "Etapa não encontrada" }, { status: 404 });
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  return comEntrada(async () => ((await excluirEtapa((await ctx.params).id)) ? Response.json({ ok: true }) : Response.json({ erro: "Etapa não encontrada" }, { status: 404 })));
}
