import { comChaveAvanteza } from "@/lib/integracao/avanteza";
import { criarUpsell } from "@/lib/entrega/servico";
import { primeiroAdminAtivo } from "@/lib/auth/admin";

/** Abre a oportunidade de upsell (pelo mesmo caminho do CRM: funil/mover.ts), com o administrador ativo como responsável. */
export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) => comChaveAvanteza(req, async () => {
  const admin = await primeiroAdminAtivo();
  if (!admin) return Response.json({ erro: "Nenhum administrador ativo" }, { status: 409 });
  try {
    const op = await criarUpsell((await ctx.params).id, admin.id);
    return Response.json({ oportunidadeId: op.id }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && /não encontrada/.test(e.message)) return Response.json({ erro: e.message }, { status: 404 });
    throw e;
  }
});
