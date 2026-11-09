// Resposta do cliente pelo link público da proposta (sem login: o token de 32 caracteres aleatórios é a credencial).
import { responderProposta } from "@/lib/propostas/servico";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const nome = typeof c?.nome === "string" ? c.nome.trim().slice(0, 120) : "";
  if (!c || typeof c.aceitar !== "boolean" || nome.length < 2) return Response.json({ erro: "Informe seu nome para responder" }, { status: 400 });
  const comentario = typeof c.comentario === "string" && c.comentario.trim() ? c.comentario.trim().slice(0, 2000) : null;
  const r = await responderProposta(token, { aceitar: c.aceitar, nome, comentario });
  if (!r.ok) return Response.json({ erro: r.erro }, { status: r.status });
  return Response.json({ status: r.resultado });
}
