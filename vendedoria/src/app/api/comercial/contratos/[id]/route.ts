// Ficha do contrato (GET: versões, eventos, arquivos) e ações (POST {acao}): enviar, reenviar, cancelar, status
// (consulta a ClickSign), pdf (anexa o PDF refeito por "Gerar de novo" a um contrato ainda não enviado).
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";
import { responder } from "@/lib/comercial/contratos/http";
import {
  anexarPdf, atualizarDaClickSign, cancelarContrato, detalheContrato, enviarContrato, reenviarContrato, ErroContrato,
} from "@/lib/comercial/contratos/servico";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const { id } = await ctx.params;
  return responder(async () => {
    const c = await detalheContrato(id);
    return c ? Response.json({ contrato: c }) : Response.json({ erro: "Contrato não encontrado" }, { status: 404 });
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  const { id } = await ctx.params;
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  return responder(async () => {
    switch (c.acao) {
      case "enviar": {
        const r = await enviarContrato(id, { canal: c.canal === "whatsapp" ? "whatsapp" : "email", emailContratada: typeof c.emailContratada === "string" ? c.emailContratada : null, cancelarAnterior: c.cancelarAnterior !== false }, uid);
        return Response.json({ ok: true, status: r.contrato.status, notificado: r.notificado, aviso: r.aviso });
      }
      case "reenviar": await reenviarContrato(id, uid); return Response.json({ ok: true });
      case "cancelar": await cancelarContrato(id, uid); return Response.json({ ok: true });
      case "status": return Response.json({ ok: true, ...(await atualizarDaClickSign(id)) });
      case "pdf": {
        if (typeof c.base64_pdf !== "string") throw new ErroContrato("PDF ausente");
        await anexarPdf(id, c.base64_pdf);
        return Response.json({ ok: true });
      }
      default: return Response.json({ erro: "Ação inválida" }, { status: 400 });
    }
  });
}
