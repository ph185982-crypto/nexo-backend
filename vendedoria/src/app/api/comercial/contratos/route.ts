// Contratos: histórico (GET, com filtros) e novo contrato (POST: formulário + PDF gerado no navegador; com
// "enviar" já manda para a ClickSign). Só o servidor fala com a ClickSign.
import { naoAutenticado, usuarioDaRequisicao } from "@/lib/comercial/auth/requisicao";
import { statusDaConta } from "@/lib/comercial/contratos/clicksign";
import { responder } from "@/lib/comercial/contratos/http";
import { criarContrato, emailContratadaPadrao, enviarContrato, listarContratos, type OpcoesEnvio } from "@/lib/comercial/contratos/servico";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const u = new URL(req.url).searchParams;
  return responder(async () => {
    const contratos = await listarContratos({ status: u.get("status"), q: u.get("q"), oportunidadeId: u.get("oportunidade"), contatoId: u.get("contato") });
    const clicksign = u.get("conta") === "1" ? await statusDaConta() : undefined;
    return Response.json({ contratos, emailContratada: emailContratadaPadrao(), ...(clicksign ? { clicksign } : {}) });
  });
}

export async function POST(req: Request) {
  const uid = await usuarioDaRequisicao(req);
  if (!uid) return naoAutenticado();
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c || typeof c.form !== "object") return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  return responder(async () => {
    const contrato = await criarContrato({
      form: c.form, base64Pdf: s(c.base64_pdf), oportunidadeId: s(c.oportunidadeId), contatoId: s(c.contatoId), substituiId: s(c.substituiId), uid,
    });
    if (!c.enviar) return Response.json({ contrato: { id: contrato.id, status: contrato.status, filename: contrato.filename } }, { status: 201 });
    const o = (typeof c.enviar === "object" ? c.enviar : {}) as OpcoesEnvio;
    try {
      const r = await enviarContrato(contrato.id, { canal: o.canal, emailContratada: o.emailContratada, cancelarAnterior: o.cancelarAnterior }, uid);
      return Response.json({ contrato: { id: contrato.id, status: r.contrato.status, filename: contrato.filename }, notificado: r.notificado, aviso: r.aviso }, { status: 201 });
    } catch (e) {
      // Contrato gravado; o envio falhou: a tela mostra o erro e oferece "Enviar" de novo.
      return Response.json({ contrato: { id: contrato.id, status: "ERRO", filename: contrato.filename }, erroEnvio: (e as Error).message }, { status: 201 });
    }
  });
}
