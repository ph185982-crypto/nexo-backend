import { exigirAdmin } from "@/lib/auth/admin";
import { reordenarEtapas } from "@/lib/config/funis";
import { comEntrada, ErroEntrada } from "@/lib/validar";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await exigirAdmin(req); if ("resposta" in a) return a.resposta;
  const c = (await req.json().catch(() => null)) as { etapaIds?: unknown } | null;
  return comEntrada(async () => {
    if (!Array.isArray(c?.etapaIds) || !c.etapaIds.every((x) => typeof x === "string")) throw new ErroEntrada("etapaIds deve ser uma lista de ids");
    return (await reordenarEtapas((await ctx.params).id, c.etapaIds as string[])) ? Response.json({ ok: true }) : Response.json({ erro: "Funil não encontrado" }, { status: 404 });
  });
}
