// Download do PDF guardado: ?tipo=ORIGINAL (padrão) ou ASSINADO.
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";
import { arquivoDoContrato } from "@/lib/comercial/contratos/servico";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  const tipo = new URL(req.url).searchParams.get("tipo") === "ASSINADO" ? "ASSINADO" : "ORIGINAL";
  const a = await arquivoDoContrato(id, tipo);
  if (!a) return Response.json({ erro: "Arquivo não encontrado" }, { status: 404 });
  const nome = a.nome.replace(/[^\w.\-]/g, "_");
  return new Response(new Uint8Array(a.bytes), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${nome}"`, "cache-control": "private, no-store", "x-content-sha256": a.sha256 },
  });
}
