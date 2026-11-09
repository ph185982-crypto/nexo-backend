// A página pública avisa que abriu (pelo navegador do cliente). Feito no navegador, e não ao montar a página,
// para a prévia de link do WhatsApp não contar como "o cliente abriu".
import { propostaPublica } from "@/lib/propostas/servico";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return (await propostaPublica(token, { registrarVisita: true })) ? new Response(null, { status: 204 }) : Response.json({ erro: "Proposta não encontrada" }, { status: 404 });
}
