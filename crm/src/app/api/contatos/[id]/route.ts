import { naoAutenticado, usuarioDaRequisicao } from "@/lib/auth/requisicao";
import { atualizarContato, CICLOS, detalheContato, ErroDuplicado, excluirContato } from "@/lib/contatos/servico";
import { comEntrada, escolha, texto, textoOpc } from "@/lib/validar";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const c = await detalheContato((await ctx.params).id);
  return c ? Response.json(c) : Response.json({ erro: "Contato não encontrado" }, { status: 404 });
}

export async function PATCH(req: Request, ctx: Ctx) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c) return Response.json({ erro: "Corpo inválido" }, { status: 400 });
  try {
    return await comEntrada(async () => {
      const r = await atualizarContato((await ctx.params).id, {
        ...(c.nome !== undefined && { nome: texto(c.nome, "Nome", { min: 1, max: 200 }) }), ...(c.telefone !== undefined && { telefone: textoOpc(c.telefone, "Telefone", 40) }),
        ...(c.email !== undefined && { email: textoOpc(c.email, "E-mail", 200) }), ...(c.documento !== undefined && { documento: textoOpc(c.documento, "Documento", 30) }),
        ...(c.segmento !== undefined && { segmento: textoOpc(c.segmento, "Segmento", 100) }), ...(c.cargo !== undefined && { cargo: textoOpc(c.cargo, "Cargo", 100) }),
        ...(c.origem !== undefined && { origem: textoOpc(c.origem, "Origem", 100) }), ...(c.empresaId !== undefined && { empresaId: textoOpc(c.empresaId, "empresaId", 60) }),
        ...(c.cicloDeVida !== undefined && { cicloDeVida: escolha(c.cicloDeVida, "ciclo de vida", CICLOS) }),
      });
      return r ? Response.json({ ok: true }) : Response.json({ erro: "Contato não encontrado" }, { status: 404 });
    });
  } catch (e) {
    if (e instanceof ErroDuplicado) return Response.json({ erro: e.message, existenteId: e.existenteId }, { status: 409 });
    throw e;
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  if (!(await usuarioDaRequisicao(req))) return naoAutenticado();
  return comEntrada(async () => ((await excluirContato((await ctx.params).id)) ? Response.json({ ok: true }) : Response.json({ erro: "Contato não encontrado" }, { status: 404 })));
}
