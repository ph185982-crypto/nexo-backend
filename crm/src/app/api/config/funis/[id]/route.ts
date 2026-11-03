import { exigirAdmin } from "@/lib/auth/admin";
import { atualizarFunil, excluirFunil } from "@/lib/config/funis";
import { comEntrada, ErroEntrada, texto } from "@/lib/validar";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const ordem = c.ordem === undefined ? undefined : Number(c.ordem);
    if (ordem !== undefined && (!Number.isInteger(ordem) || ordem < 0 || ordem > 1000)) throw new ErroEntrada("ordem inválida");
    const r = await atualizarFunil((await ctx.params).id, {
      ...(c.nome !== undefined && { nome: texto(c.nome, "Nome", { min: 1, max: 80 }) }),
      ...(c.ativo !== undefined && { ativo: c.ativo === true }), ...(c.padrao !== undefined && { padrao: c.padrao === true }), ...(ordem !== undefined && { ordem }),
    });
    return r ? Response.json({ ok: true }) : Response.json({ erro: "Funil não encontrado" }, { status: 404 });
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  return comEntrada(async () => ((await excluirFunil((await ctx.params).id)) ? Response.json({ ok: true }) : Response.json({ erro: "Funil não encontrado" }, { status: 404 })));
}
