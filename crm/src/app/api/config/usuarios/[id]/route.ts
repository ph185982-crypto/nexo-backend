import { exigirAdmin } from "@/lib/auth/admin";
import { atualizarUsuario, PAPEIS } from "@/lib/config/usuarios";
import { comEntrada, escolha, texto } from "@/lib/validar";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return comEntrada(async () => {
    const r = await atualizarUsuario((await ctx.params).id, a.uid, {
      ...(c.nome !== undefined && { nome: texto(c.nome, "Nome", { min: 1, max: 80 }) }), ...(c.papel !== undefined && { papel: escolha(c.papel, "papel", PAPEIS) }),
      ...(c.ativo !== undefined && { ativo: c.ativo === true }), ...(c.senha !== undefined && { senha: typeof c.senha === "string" ? c.senha : "" }),
    });
    return r ? Response.json({ ok: true }) : Response.json({ erro: "Usuário não encontrado" }, { status: 404 });
  });
}
